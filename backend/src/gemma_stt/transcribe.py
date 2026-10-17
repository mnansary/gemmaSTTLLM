"""HTTP client for vLLM's /v1/chat/completions endpoint with SSE streaming.

State carry-over is achieved through vLLM's prefix cache:
  - The system prompt is byte-identical across requests → cache hit.
  - The growing utterance buffer is stable until end-of-utterance, so each
    new query only pays prefill cost for the newest audio.
"""

from __future__ import annotations

import array
import asyncio
import base64
import io
import json
import logging
import math
import time
import wave
from collections import deque
from typing import AsyncIterator

import httpx

from .prompts import TRANSCRIPTION_PROMPT
from .config import VLLM_BASE_URL, MODEL_NAME, AUDIO_SR

logger = logging.getLogger(__name__)


def _rms_pcm16(pcm16_bytes: bytes) -> float:
    """Root-mean-square of mono PCM16 samples."""
    if not pcm16_bytes:
        return 0.0
    samples = array.array("h")
    samples.frombytes(pcm16_bytes[: (len(pcm16_bytes) // 2) * 2])
    n = len(samples)
    if n == 0:
        return 0.0
    ssum = 0
    for s in samples:
        ssum += s * s
    return math.sqrt(ssum / n)


def _pcm16_to_wav(pcm: bytes, sample_rate: int = AUDIO_SR) -> bytes:
    """Wrap raw mono 16-bit PCM in a minimal WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


class TranscriptionEvent:
    __slots__ = ("type", "text", "done", "latency_ms", "ttft_ms")

    def __init__(
        self,
        type_: str,
        text: str = "",
        done: bool = False,
        latency_ms: float | None = None,
        ttft_ms: float | None = None,
    ) -> None:
        self.type = type_
        self.text = text
        self.done = done
        self.latency_ms = latency_ms
        self.ttft_ms = ttft_ms


class TranscriptionClient:
    """Audio-only client for streaming transcriptions, with utterance-level VAD.

    Keeps a growing per-utterance buffer that is cleared only when end-of-utterance
    is detected. Every poll sees the full utterance so far, so each result is a
    complete-to-now transcript — not just the tail.
    """

    UTTERANCE_MAX_S = 15.0
    SILENCE_RMS_THRESHOLD = 500.0
    SILENCE_END_S = 0.9       # trailing silence required to finalize an utterance
    MIN_SPEECH_DURATION_S = 0.3  # minimum speech before utterance can end
    GRACE_PERIOD_S = 1.5      # keep querying this long after speech ends
    MODEL_SILENT_THRESHOLD = 2   # consecutive silent model responses to trigger early finalization
    MODEL_SILENT_MIN_TRAILING_S = 0.3  # shorter trailing silence when model agrees it's silent

    def __init__(self) -> None:
        self._audio_chunks: deque[bytes] = deque()
        self._chunk_silent: deque[bool] = deque()
        self._chunk_dur_s: deque[float] = deque()
        self._http: httpx.AsyncClient | None = None
        self._event_queue: asyncio.Queue[TranscriptionEvent] = asyncio.Queue(maxsize=64)
        self._closed = False
        self._inflight = False
        self._inflight_lock = asyncio.Lock()
        # Track when we last saw speech (for grace-period tail queries)
        self._last_speech_ts: float = 0.0
        self._total_speech_dur_s: float = 0.0
        self._consecutive_model_silent: int = 0

    async def connect(self) -> None:
        self._http = httpx.AsyncClient(
            base_url=VLLM_BASE_URL,
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
            limits=httpx.Limits(max_connections=4),
        )
        r = await self._http.get("/health")
        r.raise_for_status()
        logger.info("TranscriptionClient connected to vLLM at %s", VLLM_BASE_URL)

    def add_audio(self, pcm16_bytes: bytes) -> None:
        if self._closed:
            return
        rms = _rms_pcm16(pcm16_bytes)
        dur_s = len(pcm16_bytes) / (AUDIO_SR * 2.0)
        is_silent = rms < self.SILENCE_RMS_THRESHOLD

        self._audio_chunks.append(pcm16_bytes)
        self._chunk_silent.append(is_silent)
        self._chunk_dur_s.append(dur_s)

        if not is_silent:
            self._last_speech_ts = time.time()
            self._total_speech_dur_s += dur_s

        total_s = sum(self._chunk_dur_s)
        while total_s > self.UTTERANCE_MAX_S and self._audio_chunks:
            dropped_dur = self._chunk_dur_s.popleft()
            was_silent = self._chunk_silent.popleft()
            self._audio_chunks.popleft()
            total_s -= dropped_dur
            if not was_silent:
                self._total_speech_dur_s = max(0.0, self._total_speech_dur_s - dropped_dur)

        # Debug: log VAD state periodically


    def reset_utterance(self) -> None:
        """Clear the audio buffer — call after finalizing an utterance."""
        self._audio_chunks.clear()
        self._chunk_silent.clear()
        self._chunk_dur_s.clear()
        self._last_speech_ts = 0.0
        self._total_speech_dur_s = 0.0
        self._consecutive_model_silent = 0

    def total_speech_dur_s(self) -> float:
        return self._total_speech_dur_s

    def has_speech(self) -> bool:
        """True if any chunk in the buffer is above the silence threshold."""
        return any(not s for s in self._chunk_silent)

    def trailing_silence_s(self) -> float:
        """Seconds of silence at the tail of the buffer."""
        total = 0.0
        for is_sil, dur in zip(
            reversed(self._chunk_silent), reversed(self._chunk_dur_s)
        ):
            if not is_sil:
                break
            total += dur
        return total

    def signal_model_silent(self) -> None:
        """Called by the session when the model returns a silent marker."""
        self._consecutive_model_silent += 1

    def signal_model_speech(self) -> None:
        """Called by the session when the model returns transcribed text."""
        self._consecutive_model_silent = 0

    def is_end_of_utterance(self) -> bool:
        """True if VAD says speech ended, OR if the model consistently reports
        silence while there is still a moderate trailing silence buffer."""
        if not self.has_speech() or self._total_speech_dur_s < self.MIN_SPEECH_DURATION_S:
            return False
        trailing = self.trailing_silence_s()
        # Primary: VAD-based (long trailing silence)
        if trailing >= self.SILENCE_END_S:
            return True
        # Secondary: model also says silent + shorter trailing silence
        if (
            self._consecutive_model_silent >= self.MODEL_SILENT_THRESHOLD
            and trailing >= self.MODEL_SILENT_MIN_TRAILING_S
        ):
            return True
        return False

    def needs_tail_query(self) -> bool:
        """True if we recently had speech but the most recent chunk is silent —
        need one more query to capture the tail before finalizing."""
        if not self._audio_chunks or not self._chunk_silent:
            return False
        time_since_speech = time.time() - self._last_speech_ts
        # Most recent chunk is silent, but we had speech recently within
        # the grace period — fire one more query to get the complete tail.
        return (
            self._last_speech_ts > 0
            and self._chunk_silent[-1]
            and 0 < time_since_speech <= self.GRACE_PERIOD_S
        )

    async def send_query(self) -> None:
        if self._closed or self._http is None:
            return
        if self._inflight:
            logger.debug("Skipping transcription query, previous still in flight")
            return
        if not self._audio_chunks:
            return

        async with self._inflight_lock:
            self._inflight = True

        try:
            content = self._build_content()
            body = {
                "model": MODEL_NAME,
                "messages": [
                    {"role": "system", "content": TRANSCRIPTION_PROMPT},
                    {"role": "user", "content": content},
                ],
                "stream": True,
                "temperature": 0.0,
                "max_tokens": 180,
            }
            await self._stream(body)
        except Exception as exc:
            logger.warning("Transcription query failed: %s", exc)
            await self._event_queue.put(
                TranscriptionEvent(type_="error", text=str(exc), done=True)
            )
        finally:
            self._inflight = False

    def _build_content(self) -> list[dict]:
        items: list[dict] = []
        if self._audio_chunks:
            pcm = b"".join(self._audio_chunks)
            wav = _pcm16_to_wav(pcm)
            b64 = base64.b64encode(wav).decode()
            items.append(
                {
                    "type": "audio_url",
                    "audio_url": {"url": f"data:audio/wav;base64,{b64}"},
                }
            )
        items.append({"type": "text", "text": "Transcribe the audio."})
        return items

    async def _stream(self, body: dict) -> None:
        assert self._http is not None
        accumulated_text = ""
        t_start = time.perf_counter()
        ttft_ms: float | None = None

        async with self._http.stream(
            "POST", "/v1/chat/completions", json=body
        ) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"HTTP {resp.status_code}: {detail[:200]}")

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    break
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue

                choices = obj.get("choices", [])
                if not choices:
                    continue
                choice = choices[0]

                delta_obj = choice.get("delta", {}) or {}
                delta_text = delta_obj.get("content")
                if delta_text:
                    if ttft_ms is None:
                        ttft_ms = (time.perf_counter() - t_start) * 1000.0
                    accumulated_text += delta_text
                    await self._event_queue.put(
                        TranscriptionEvent(type_="delta", text=delta_text)
                    )

                if choice.get("finish_reason"):
                    break

        latency_ms = (time.perf_counter() - t_start) * 1000.0
        await self._event_queue.put(
            TranscriptionEvent(
                type_="done",
                text=accumulated_text,
                done=True,
                latency_ms=latency_ms,
                ttft_ms=ttft_ms,
            )
        )

    async def iter_events(self) -> AsyncIterator[TranscriptionEvent]:
        while not self._closed:
            try:
                event = await asyncio.wait_for(self._event_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            yield event
            if event.done and event.type == "closed":
                break

    async def close(self) -> None:
        self._closed = True
        if self._http is not None:
            await self._http.aclose()
            self._http = None
        await self._event_queue.put(TranscriptionEvent(type_="closed", done=True))
