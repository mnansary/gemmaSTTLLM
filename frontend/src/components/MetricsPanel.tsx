import { useEffect, useRef } from 'react';
import { Activity, Gauge, MessageSquare, Timer } from 'lucide-react';

export interface UtteranceMetrics {
  index: number;
  audio_s: number;
  utterance_ms: number | null;
  ttft_ms: number | null;
  query_latency_ms: number | null;
  queries: number;
}

export interface ReplyMetrics {
  ttft_ms: number | null;
  total_ms: number | null;
  tokens: number | null;
  tokens_per_s: number | null;
}

interface MetricsPanelProps {
  utterances: { count: number; avgTimeMs: number | null; lastTimeMs: number | null; lastTtftMs: number | null };
  reply: { count: number; lastTtftMs: number | null; lastTotalMs: number | null; tokensPerS: number | null };
  showStt?: boolean;
}

function Stat({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-slate-800/40 border border-slate-700/30 rounded-lg px-3 py-2">
      <div className="text-blue-400/80 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide truncate">{label}</div>
        <div className="text-sm font-semibold text-slate-100 font-mono">
          {value}
          {unit && <span className="text-[10px] text-slate-500 font-normal ml-1">{unit}</span>}
        </div>
      </div>
    </div>
  );
}

const fmt = (v: number | null, digits = 0) => (v == null ? '—' : v.toFixed(digits));

export function MetricsPanel({ utterances, reply, showStt = true }: MetricsPanelProps) {
  return (
    <div className="bg-[#0f172a] rounded-xl border border-slate-800/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60 bg-slate-900/40">
        <Gauge className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-slate-200">Metrics</h3>
      </div>
      <div className="p-3 grid grid-cols-2 gap-2">
        {showStt && (
          <>
            <Stat icon={<Activity className="w-4 h-4" />} label="Utterances" value={String(utterances.count)} />
            <Stat icon={<Timer className="w-4 h-4" />} label="Last utterance" value={fmt(utterances.lastTimeMs)} unit="ms" />
            <Stat icon={<Timer className="w-4 h-4" />} label="Avg utterance" value={fmt(utterances.avgTimeMs)} unit="ms" />
            <Stat icon={<Gauge className="w-4 h-4" />} label="STT TTFT" value={fmt(utterances.lastTtftMs)} unit="ms" />
          </>
        )}
        <Stat icon={<MessageSquare className="w-4 h-4" />} label="Replies" value={String(reply.count)} />
        <Stat icon={<Gauge className="w-4 h-4" />} label="Reply TTFT" value={fmt(reply.lastTtftMs)} unit="ms" />
        <Stat icon={<Timer className="w-4 h-4" />} label="Reply total" value={fmt(reply.lastTotalMs)} unit="ms" />
        <Stat icon={<Activity className="w-4 h-4" />} label="Reply speed" value={fmt(reply.tokensPerS, 1)} unit="tok/s" />
      </div>
    </div>
  );
}

export function useScrollBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
    }, 30);
    return () => clearTimeout(t);
  }, [dep]);
  return ref;
}
