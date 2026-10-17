import { useEffect, useRef } from 'react';
import { CheckCircle2, Copy, Trash2 } from 'lucide-react';

export interface Utterance {
  id: string;
  text: string;
  index: number;
  ts: number;
}

interface TranscriptPanelProps {
  liveText: string | null;
  utterances: Utterance[];
  onClear?: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export function TranscriptPanel({ liveText, utterances, onClear }: TranscriptPanelProps) {
  const topRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top whenever content changes (newest at top)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [liveText, utterances]);

  return (
    <div className="flex flex-col h-full bg-[#0f172a] rounded-xl border border-slate-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 bg-slate-900/40 shrink-0">
        <h3 className="text-sm font-semibold text-slate-200">
          Transcription
        </h3>
        {utterances.length > 0 && onClear && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-400 transition-colors px-2 py-1 rounded-md hover:bg-red-500/10"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Content */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin min-h-0">
        {/* Scroll anchor — always at the top */}
        <div ref={topRef} className="h-0" />

        {/* Live transcript — newest, at top */}
        {liveText && (
          <div className="flex items-start gap-3 animate-pulse-slow">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mt-0.5">
              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-3.5 py-2.5">
                <p className="text-sm text-blue-100 leading-relaxed">
                  {liveText}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-blue-400/60 font-medium uppercase tracking-wide">
                    Transcribing…
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {utterances.map((u) => (
          <div
            key={u.id}
            className="group relative animate-fade-in"
          >
            <div className="flex items-start gap-3">
              {/* Index badge */}
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mt-0.5">
                <span className="text-[10px] font-bold text-blue-400">{u.index}</span>
              </div>

              {/* Utterance card */}
              <div className="flex-1 min-w-0">
                <div className="bg-slate-800/40 hover:bg-slate-800/60 border border-slate-700/30 rounded-lg px-3.5 py-2.5 transition-colors">
                  <p className="text-sm text-slate-100 leading-relaxed font-medium">
                    {u.text}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] text-slate-500 font-mono">
                      {formatTime(u.ts)}
                    </span>
                    <button
                      onClick={() => copyToClipboard(u.text)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-blue-400 p-1 rounded"
                      title="Copy"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        {utterances.length === 0 && !liveText && (
          <div className="flex flex-col items-center justify-center h-40 text-slate-600">
            <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-5 h-5 text-slate-600" />
            </div>
            <p className="text-sm text-slate-500">Start speaking to see transcription</p>
            <p className="text-xs text-slate-600 mt-1">বাংলা বা ইংরেজিতে কথা বলুন</p>
          </div>
        )}
      </div>
    </div>
  );
}
