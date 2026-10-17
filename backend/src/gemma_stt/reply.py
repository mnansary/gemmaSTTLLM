"""Streaming text-reply client — talks to the same vLLM backend.

Takes a finalized utterance and streams back a conversational reply,
measuring TTFT, total latency and tokens/sec.
"""

from __future__ import annotations

import logging
import time
from typing import AsyncIterator

import httpx

from .config import MODEL_NAME, VLLM_BASE_URL
from .prompts import REPLY_PROMPT

logger = logging.getLogger(__name__)


class ReplyChunk:
    __slots__ = ("text", "done", "metrics")

    def __init__(self, text: str = "", done: bool = False, metrics: dict | None = None) -> None:
        self.text = text
        self.done = done
        self.metrics = metrics


async def stream_reply(
    history: list[dict],
    max_tokens: int = 300,
) -> AsyncIterator[ReplyChunk]:
    """Stream a chat reply. `history` is OpenAI-style messages list."""
    body = {
        "model": MODEL_NAME,
        "messages": [{"role": "system", "content": REPLY_PROMPT}, *history],
        "stream": True,
        "temperature": 0.7,
        "max_tokens": max_tokens,
    }
    t_start = time.perf_counter()
    ttft_ms: float | None = None
    tokens = 0
    async with httpx.AsyncClient(
        base_url=VLLM_BASE_URL,
        timeout=httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0),
    ) as http:
        async with http.stream("POST", "/v1/chat/completions", json=body) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"HTTP {resp.status_code}: {detail[:200]}")
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    break
                import json

                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices", [])
                if not choices:
                    continue
                delta = choices[0].get("delta", {}) or {}
                text = delta.get("content")
                if text:
                    if ttft_ms is None:
                        ttft_ms = (time.perf_counter() - t_start) * 1000.0
                    tokens += 1
                    yield ReplyChunk(text=text)
                if choices[0].get("finish_reason"):
                    break
    total_ms = (time.perf_counter() - t_start) * 1000.0
    yield ReplyChunk(
        done=True,
        metrics={
            "ttft_ms": ttft_ms,
            "total_ms": total_ms,
            "tokens": tokens,
            "tokens_per_s": round(tokens / (total_ms / 1000.0), 1) if total_ms > 0 else None,
        },
    )
