"""Global metrics registry — aggregates STT and reply latency stats.

Sessions record every completed utterance and reply here; the REST
`/metrics` endpoint and the UI read from this registry.
"""

from __future__ import annotations

import threading
import time
from collections import deque


class MetricsRegistry:
    def __init__(self, max_samples: int = 200) -> None:
        self._lock = threading.Lock()
        self._max = max_samples
        # Per completed utterance
        self.utterances: deque[dict] = deque(maxlen=max_samples)
        # Per reply stream
        self.replies: deque[dict] = deque(maxlen=max_samples)
        self.started_at = time.time()

    # ------------------------------------------------------------------
    def record_utterance(self, m: dict) -> None:
        with self._lock:
            self.utterances.append(m)

    def record_reply(self, m: dict) -> None:
        with self._lock:
            self.replies.append(m)

    # ------------------------------------------------------------------
    def _agg(self, items: list[dict], keys: list[str]) -> dict:
        out: dict = {}
        for k in keys:
            vals = [i[k] for i in items if i.get(k) is not None]
            if vals:
                out[k] = {
                    "last": vals[-1],
                    "avg": sum(vals) / len(vals),
                    "min": min(vals),
                    "max": max(vals),
                    "count": len(vals),
                }
        return out

    def snapshot(self) -> dict:
        with self._lock:
            utt = list(self.utterances)
            rep = list(self.replies)
        return {
            "uptime_s": round(time.time() - self.started_at, 1),
            "utterance_count": len(utt),
            "reply_count": len(rep),
            "stt": self._agg(
                utt,
                ["ttft_ms", "query_latency_ms", "utterance_ms", "audio_s", "queries"],
            ),
            "reply": self._agg(
                rep,
                ["ttft_ms", "total_ms", "tokens", "tokens_per_s"],
            ),
        }


REGISTRY = MetricsRegistry()
