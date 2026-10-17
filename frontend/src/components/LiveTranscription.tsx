import { useCallback, useRef, useState } from 'react';
import { Mic, Power } from 'lucide-react';
import { Header } from './Header';
import { StatusBar } from './StatusBar';
import { WaveformVisualizer } from './WaveformVisualizer';
import { TranscriptPanel, type Utterance } from './TranscriptPanel';
import { MetricsPanel } from './MetricsPanel';
import { ReplyPanel, type Reply } from './ReplyPanel';
import { AudioPipeline } from '../lib/audio';
import { SttSocket } from '../lib/socket';

type AppState = 'idle' | 'requesting' | 'connecting' | 'ready' | 'live' | 'error';

export function LiveTranscription() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [language, setLanguage] = useState<'auto' | 'bangla' | 'english'>('auto');
  const [showStt, setShowStt] = useState(false);
  const [liveText, setLiveText] = useState<string | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [uttMetrics, setUttMetrics] = useState<{ count: number; totalMs: number; lastTimeMs: number | null; lastTtftMs: number | null }>({ count: 0, totalMs: 0, lastTimeMs: null, lastTtftMs: null });
  const [replyMetrics, setReplyMetrics] = useState<{ count: number; lastTtftMs: number | null; lastTotalMs: number | null; tokensPerS: number | null }>({ count: 0, lastTtftMs: null, lastTotalMs: null, tokensPerS: null });

  const socketRef = useRef<SttSocket | null>(null);
  const audioRef = useRef<AudioPipeline | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const clearHistory = useCallback(() => {
    setUtterances([]);
    setLiveText(null);
    setReplies([]);
  }, []);

  const stopSession = useCallback(() => {
    audioRef.current?.stop();
    audioRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setAppState('idle');
    setStatusDetail(null);
    setLiveText(null);
  }, []);

  const startSession = useCallback(async () => {
    setAppState('requesting');
    setLiveText(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
      });
    } catch {
      setAppState('error');
      setStatusDetail('Microphone permission denied');
      return;
    }

    streamRef.current = stream;
    setAppState('connecting');

    const socket = new SttSocket();
    socketRef.current = socket;

    socket.onStateChange((state, detail) => {
      if (state === 'open') {
        setAppState('connecting');
        setStatusDetail(null);
      } else if (state === 'closed') {
        setStatusDetail(detail ?? 'Disconnected');
      } else if (state === 'error') {
        setAppState('error');
        setStatusDetail(detail ?? 'Connection error');
      }
    });

    socket.onMessage((msg: any) => {
      if (msg.type === 'status') {
        if (msg.state === 'ready') {
          setAppState('live');
          setStatusDetail(null);
        } else if (msg.state === 'error') {
          setAppState('error');
          setStatusDetail(msg.detail);
        }
      } else if (msg.type === 'transcript_delta') {
        setLiveText(msg.text);
      } else if (msg.type === 'utterance') {
        setLiveText(null);
        const m = msg.metrics;
        if (m) {
          setUttMetrics((prev) => ({
            count: prev.count + 1,
            totalMs: prev.totalMs + (m.utterance_ms ?? 0),
            lastTimeMs: m.utterance_ms ?? null,
            lastTtftMs: m.ttft_ms ?? null,
          }));
        }
        setUtterances((prev) => [
          { id: msg.id || `${msg.ts}`, text: msg.text, index: msg.index || prev.length + 1, ts: msg.ts },
          ...prev,
        ].slice(0, 15));
      } else if (msg.type === 'reply_delta') {
        setReplies((prev) => {
          const existing = prev.find((r) => r.id === msg.id);
          if (existing) {
            return prev.map((r) => r.id === msg.id ? { ...r, text: r.text + msg.delta } : r);
          }
          return [{ id: msg.id, utteranceIndex: msg.utterance_index, text: msg.delta, streaming: true }, ...prev].slice(0, 20);
        });
      } else if (msg.type === 'reply_done') {
        setReplies((prev) => prev.map((r) => r.id === msg.id ? { ...r, streaming: false, metrics: msg.metrics } : r));
        const m = msg.metrics;
        if (m) {
          setReplyMetrics((prev) => ({
            count: prev.count + 1,
            lastTtftMs: m.ttft_ms ?? null,
            lastTotalMs: m.total_ms ?? null,
            tokensPerS: m.tokens_per_s ?? null,
          }));
        }
      }
    });

    socket.connect();

    const audio = new AudioPipeline({
      onPcm16: (pcm16) => {
        socket.sendAudio(pcm16);
      },
      onVadScore: () => {
        // VAD score consumed by visualizer via direct hook if needed later
      },
    });
    audioRef.current = audio;

    try {
      await audio.start(stream);
    } catch (err) {
      setAppState('error');
      setStatusDetail('Audio pipeline failed');
    }
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0a0e1a]">
      <Header language={language} onLanguageChange={setLanguage} />
      <StatusBar
        state={appState}
        detail={statusDetail}
      />

      <main className="flex-1 flex flex-col lg:flex-row gap-3 lg:gap-4 p-3 lg:p-4 overflow-y-auto lg:overflow-hidden min-h-0">
        {/* Left: Controls + Waveform */}
        <div className="flex flex-col gap-3 lg:gap-4 lg:w-[380px] min-w-0 shrink-0">
          <WaveformVisualizer active={appState === 'live'} />

          {/* STT toggle */}
          <label className="flex items-start gap-3 bg-slate-800/40 border border-slate-700/30 rounded-lg px-3.5 py-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showStt}
              onChange={(e) => setShowStt(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-200">Show live transcription</span>
              <span className="block text-xs text-slate-500 leading-snug mt-0.5">
                Adds a parallel STT branch — your speech is transcribed and shown alongside the assistant's replies. The reply branch always runs.
              </span>
            </span>
          </label>

          {/* Start/Stop Button */}
          <div className="flex flex-col gap-3">
            {appState === 'idle' || appState === 'error' ? (
              <button
                onClick={startSession}
                className="flex items-center justify-center gap-2.5 w-full max-w-[260px] mx-auto py-3.5 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-900/30 transition-all active:scale-[0.98] border border-blue-500/20"
              >
                <Mic className="w-5 h-5" />
                Start Transcription
              </button>
            ) : appState === 'requesting' || appState === 'connecting' ? (
              <button
                disabled
                className="flex items-center justify-center gap-2.5 w-full max-w-[260px] mx-auto py-3.5 px-6 bg-slate-800/80 text-slate-500 font-semibold rounded-xl cursor-wait border border-slate-700/40"
              >
                <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                {appState === 'requesting' ? 'Requesting microphone…' : 'Connecting to engine…'}
              </button>
            ) : (
              <button
                onClick={stopSession}
                className="flex items-center justify-center gap-2.5 w-full max-w-[260px] mx-auto py-3.5 px-6 bg-red-500/90 hover:bg-red-500 text-white font-semibold rounded-xl shadow-lg shadow-red-900/20 transition-all active:scale-[0.98] border border-red-400/20"
              >
                <Power className="w-5 h-5" />
                Stop Session
              </button>
            )}

            {appState === 'error' && statusDetail && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300">
                {statusDetail}
              </div>
            )}
          </div>

          {/* Metrics */}
          <MetricsPanel
            showStt={showStt}
            utterances={{
              count: uttMetrics.count,
              avgTimeMs: uttMetrics.count > 0 ? uttMetrics.totalMs / uttMetrics.count : null,
              lastTimeMs: uttMetrics.lastTimeMs,
              lastTtftMs: uttMetrics.lastTtftMs,
            }}
            reply={replyMetrics}
          />
        </div>

        {/* Right: Transcript (optional) + Reply — always visible */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 min-h-[420px] lg:min-h-0">
          {showStt && (
            <div className="flex-1 min-h-0">
              <TranscriptPanel
                liveText={liveText}
                utterances={utterances}
                onClear={clearHistory}
              />
            </div>
          )}
          <div className={`shrink-0 ${showStt ? 'h-[320px] lg:h-[38%] lg:min-h-[160px]' : 'flex-1'}`}>
            <ReplyPanel replies={replies} showStt={showStt} utterances={utterances} liveText={liveText} />
          </div>
        </div>
      </main>
    </div>
  );
}
