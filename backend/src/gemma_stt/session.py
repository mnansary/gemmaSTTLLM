"""WebSocket session orchestrator for live transcription."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import WebSocket
from fastapi.websockets import WebSocketState

from .transcribe import TranscriptionClient
from .lang_filter import is_bangla_or_english, filter_to_bangla_english
from .reply import stream_reply
from .metrics import REGISTRY

logger = logging.getLogger(__name__)

QUERY_INTERVAL = 0.70
TRANSCRIBE_OFFSET = 0.35
SILENT_MARKERS = {"(silent)", "( silent )", "(silent)", ""}
REPLY_HISTORY_TURNS = 6  # user/assistant pairs kept for context


class TranscriptionSession:
    def __init__(self, ws: WebSocket, session_id: str = "anon") -> None:
        self._ws = ws
        self._session_id = session_id
        self._transcribe = TranscriptionClient()
        self._closed = False
        self._pending_transcript: str | None = None
        self._utterance_count = 0
        # Metrics + reply state
        self._utterance_start_ts: float | None = None  # first speech chunk of current utterance
        self._query_count = 0
        self._last_ttft_ms: float | None = None
        self._last_query_ms: float | None = None
        self._history: list[dict] = []  # OpenAI-style messages for reply context

    @property
    def session_id(self) -> str:
        return self._session_id

    async def run(self) -> None:
        await self._send_status("connecting")

        try:
            await self._transcribe.connect()
        except Exception as exc:
            logger.warning("[%s] connect failed: %s", self._session_id, exc)
            await self._send_status("error", detail=str(exc))
            return

        logger.info("[%s] vLLM reachable, session ready", self._session_id)
        await self._send_status("ready")

        async with asyncio.TaskGroup() as tg:
            tg.create_task(self._receive_browser())
            tg.create_task(self._transcribe_scheduler())
            tg.create_task(self._collect_transcriptions())

    async def _receive_browser(self) -> None:
        try:
            while not self._closed:
                data = await self._ws.receive()
                if data.get("type") == "websocket.disconnect":
                    break
                raw_bytes = data.get("bytes")
                if raw_bytes and len(raw_bytes) >= 2:
                    type_byte = raw_bytes[0]
                    payload = raw_bytes[1:]
                    if type_byte == 0x01:  # AUDIO_TYPE
                        if self._utterance_start_ts is None:
                            from .transcribe import _rms_pcm16
                            if _rms_pcm16(payload) >= self._transcribe.SILENCE_RMS_THRESHOLD:
                                self._utterance_start_ts = time.perf_counter()
                        self._transcribe.add_audio(payload)
        except Exception as exc:
            logger.debug("[%s] browser receive loop ended: %s", self._session_id, exc)
        finally:
            self._closed = True
            await self._transcribe.close()

    async def _transcribe_scheduler(self) -> None:
        await asyncio.sleep(TRANSCRIBE_OFFSET)
        while not self._closed:
            await asyncio.sleep(QUERY_INTERVAL)
            if self._closed:
                break
            # Query when there is active speech, OR during the grace period
            # after speech ends (tail-capture: ensures the final words are
            # included before the utterance is finalized).
            if self._transcribe.has_speech() or self._transcribe.needs_tail_query():
                logger.info("[%s] query fired (speech=%s tail=%s buf=%.2fs trailing_sil=%.2fs)",
                    self._session_id,
                    self._transcribe.has_speech(),
                    self._transcribe.needs_tail_query(),
                    sum(self._transcribe._chunk_dur_s),
                    self._transcribe.trailing_silence_s(),
                )
                asyncio.create_task(self._transcribe.send_query())

    def _sanitize_text(self, text: str) -> str | None:
        """Validate language and filter to Bangla + English only.

        Returns None if the text is completely invalid (silent marker, etc).
        """
        text = text.strip()
        if not text:
            return None
        if text.lower() in {m.lower() for m in SILENT_MARKERS}:
            return None

        # First try strict validation
        valid, reason = is_bangla_or_english(text)
        if valid:
            return text

        # If invalid, try aggressive filtering
        filtered = filter_to_bangla_english(text)
        if filtered:
            logger.info(
                "[%s] Language filter applied: %r → %r (reason: %s)",
                self._session_id,
                text,
                filtered,
                reason,
            )
            return filtered

        logger.warning(
            "[%s] Utterance rejected entirely: %r (reason: %s)",
            self._session_id,
            text,
            reason,
        )
        return None

    async def _collect_transcriptions(self) -> None:
        async for event in self._transcribe.iter_events():
            if self._closed and event.type != "closed":
                break
            if event.type == "done":
                self._query_count += 1
                if event.ttft_ms is not None:
                    self._last_ttft_ms = event.ttft_ms
                if event.latency_ms is not None:
                    self._last_query_ms = event.latency_ms
                text = (event.text or "").strip()
                is_silent = text.lower() in {m.lower() for m in SILENT_MARKERS}

                if not is_silent:
                    self._transcribe.signal_model_speech()
                    # Apply language filter to live deltas too (best-effort)
                    safe_text = self._sanitize_text(text) or text
                    self._pending_transcript = safe_text
                    await self._send_json({
                        "type": "transcript_delta",
                        "text": safe_text,
                        "is_final": False,
                        "ts": time.time(),
                    })
                else:
                    self._transcribe.signal_model_silent()

                if (
                    self._transcribe.is_end_of_utterance()
                    and self._pending_transcript is not None
                ):
                    final_raw = self._pending_transcript
                    final = self._sanitize_text(final_raw)
                    self._utterance_count += 1
                    logger.info("[%s] utterance finalized: %r -> %r", self._session_id, final_raw, final)

                    # ---- Metrics ----
                    audio_s = self._transcribe.total_speech_dur_s()
                    utterance_ms = (
                        (time.perf_counter() - self._utterance_start_ts) * 1000.0
                        if self._utterance_start_ts is not None
                        else None
                    )
                    utt_metrics = {
                        "index": self._utterance_count,
                        "audio_s": round(audio_s, 3),
                        "utterance_ms": round(utterance_ms, 1) if utterance_ms is not None else None,
                        "ttft_ms": self._last_ttft_ms,
                        "query_latency_ms": self._last_query_ms,
                        "queries": self._query_count,
                    }
                    REGISTRY.record_utterance(utt_metrics)

                    await self._send_json({
                        "type": "transcript_delta",
                        "text": final_raw,
                        "is_final": True,
                        "ts": time.time(),
                    })

                    if final:
                        await self._send_json({
                            "type": "utterance",
                            "text": final,
                            "id": f"utt-{self._session_id}-{self._utterance_count}",
                            "index": self._utterance_count,
                            "ts": time.time(),
                            "metrics": utt_metrics,
                        })
                        # Parallel branch: stream a conversational reply
                        self._history.append({"role": "user", "content": final})
                        self._history = self._history[-2 * REPLY_HISTORY_TURNS:]
                        asyncio.create_task(self._stream_reply(self._utterance_count))
                    else:
                        logger.info(
                            "[%s] Utterance %d filtered out: %r",
                            self._session_id,
                            self._utterance_count,
                            final_raw,
                        )

                    self._pending_transcript = None
                    self._transcribe.reset_utterance()
                    self._utterance_start_ts = None
                    self._query_count = 0
            elif event.type == "error":
                logger.warning(
                    "[%s] transcription client error: %s",
                    self._session_id,
                    event.text,
                )
            elif event.type == "closed":
                break

    async def _send_status(self, state: str, detail: str | None = None) -> None:
        await self._send_json({
            "type": "status",
            "state": state,
            "detail": detail,
            "session_id": self._session_id,
        })

    async def _send_json(self, payload: dict) -> None:
        if self._ws.client_state == WebSocketState.CONNECTED:
            try:
                await self._ws.send_text(json.dumps(payload))
            except Exception:
                pass

    async def _stream_reply(self, utterance_index: int) -> None:
        """Parallel branch: stream a conversational reply to the user's text."""
        reply_id = f"reply-{self._session_id}-{utterance_index}"
        accumulated = ""
        try:
            async for chunk in stream_reply(list(self._history)):
                if self._closed:
                    return
                if chunk.done:
                    m = chunk.metrics or {}
                    REGISTRY.record_reply(m)
                    logger.info(
                        "[%s] reply %d done: ttft=%.0fms total=%.0fms tokens=%d",
                        self._session_id, utterance_index,
                        m.get("ttft_ms") or 0, m.get("total_ms") or 0, m.get("tokens") or 0,
                    )
                    self._history.append({"role": "assistant", "content": accumulated})
                    self._history = self._history[-2 * REPLY_HISTORY_TURNS:]
                    await self._send_json({
                        "type": "reply_done",
                        "id": reply_id,
                        "utterance_index": utterance_index,
                        "metrics": m,
                        "ts": time.time(),
                    })
                else:
                    accumulated += chunk.text
                    await self._send_json({
                        "type": "reply_delta",
                        "id": reply_id,
                        "utterance_index": utterance_index,
                        "delta": chunk.text,
                        "ts": time.time(),
                    })
        except Exception as exc:
            logger.warning("[%s] reply stream failed: %s", self._session_id, exc)
            await self._send_json({
                "type": "reply_error",
                "id": reply_id,
                "detail": str(exc),
                "ts": time.time(),
            })

    async def close(self) -> None:
        self._closed = True
        await self._transcribe.close()
