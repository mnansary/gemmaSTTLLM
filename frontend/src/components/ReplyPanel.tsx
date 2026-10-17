import { useEffect, useRef } from 'react';
import { Bot, CheckCircle2, User } from 'lucide-react';
import type { ReplyMetrics } from './MetricsPanel';
import type { Utterance } from './TranscriptPanel';

export interface Reply {
  id: string;
  utteranceIndex: number;
  text: string;
  streaming: boolean;
  metrics?: ReplyMetrics;
}

interface ReplyPanelProps {
  replies: Reply[];
  showStt?: boolean;
  utterances?: Utterance[];
  liveText?: string | null;
}

export function ReplyPanel({ replies, showStt = false, utterances = [], liveText }: ReplyPanelProps) {
  const latest = replies[0];
  const containerRef = useRef<HTMLDivElement>(null);
  const uttByIndex = new Map(utterances.map((u) => [u.index, u]));

  // Newest is at the top — scroll up on updates
  useEffect(() => {
    const t = setTimeout(() => {
      containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 30);
    return () => clearTimeout(t);
  }, [latest?.text, liveText, replies.length]);

  return (
    <div className="flex flex-col h-full bg-[#0f172a] rounded-xl border border-slate-800/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/60 bg-slate-900/40 shrink-0">
        <Bot className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-slate-200">Assistant Reply</h3>
        {latest?.streaming && (
          <span className="ml-auto text-[10px] text-emerald-400/70 font-medium animate-pulse">streaming…</span>
        )}
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {/* Streaming STT in progress — newest, at top */}
        {showStt && liveText && (
          <div className="flex items-start gap-2.5 animate-pulse-slow">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mt-0.5">
              <User className="w-3 h-3 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2">
              <p className="text-sm text-blue-100 leading-relaxed">{liveText}</p>
              <span className="text-[10px] text-blue-400/60 font-medium uppercase tracking-wide">transcribing…</span>
            </div>
          </div>
        )}

        {/* Replies — newest first (replies[] is already newest-first) */}
        {replies.map((r) => {
          const utt = showStt ? uttByIndex.get(r.utteranceIndex) : undefined;
          return (
            <div key={r.id} className="animate-fade-in space-y-2">
              {/* User's transcribed speech (only when STT branch is shown) */}
              {utt && (
                <div className="flex items-start gap-2.5">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mt-0.5">
                    <User className="w-3 h-3 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0 bg-blue-500/5 border border-blue-500/15 rounded-lg px-3 py-2">
                    <p className="text-sm text-blue-100/90 leading-relaxed">{utt.text}</p>
                  </div>
                </div>
              )}

              {/* Assistant reply */}
              <div className="flex items-start gap-2.5">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mt-0.5">
                  <Bot className="w-3 h-3 text-emerald-400" />
                </div>
                <div className={`flex-1 min-w-0 border rounded-lg px-3 py-2 ${
                  r.streaming
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'bg-slate-800/40 border-slate-700/30'
                }`}>
                  <p className={`text-sm leading-relaxed ${r.streaming ? 'text-emerald-100' : 'text-slate-200'}`}>
                    {r.text}
                    {r.streaming && <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-emerald-400 animate-pulse align-middle" />}
                  </p>
                  {r.metrics && (
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 font-mono">
                      <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500/70" />done</span>
                      {r.metrics.ttft_ms != null && <span>ttft {r.metrics.ttft_ms.toFixed(0)}ms</span>}
                      {r.metrics.total_ms != null && <span>total {r.metrics.total_ms.toFixed(0)}ms</span>}
                      {r.metrics.tokens_per_s != null && <span>{r.metrics.tokens_per_s.toFixed(1)} tok/s</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {replies.length === 0 && !liveText && (
          <div className="flex flex-col items-center justify-center h-32 text-slate-600">
            <Bot className="w-6 h-6 mb-2 text-slate-700" />
            <p className="text-sm text-slate-500">Replies to your speech will stream here</p>
          </div>
        )}
      </div>
    </div>
  );
}
