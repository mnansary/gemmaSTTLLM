import { Wifi, WifiOff, ShieldCheck } from 'lucide-react';

interface StatusBarProps {
  state: string;
  detail: string | null;
}

export function StatusBar({ state, detail }: StatusBarProps) {
  const isConnected = state === 'ready' || state === 'live';

  return (
    <div className="flex items-center justify-between px-3 sm:px-6 py-2 bg-[#0f172a]/60 backdrop-blur-sm border-b border-slate-800/40 text-xs">
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {/* Connection */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isConnected ? (
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className={`font-semibold uppercase tracking-wider ${
            isConnected ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {isConnected ? 'Live' : state}
          </span>
          {detail && (
            <span className="text-slate-500 ml-1 truncate max-w-[120px] sm:max-w-none">{detail}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Language validation badge */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          <span className="text-emerald-400 font-medium hidden sm:inline">BN · EN Only</span>
          <span className="text-emerald-400 font-medium sm:hidden">BN·EN</span>
        </div>
      </div>
    </div>
  );
}
