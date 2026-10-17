import { Globe } from 'lucide-react';

interface HeaderProps {
  language: 'auto' | 'bangla' | 'english';
  onLanguageChange: (lang: 'auto' | 'bangla' | 'english') => void;
}

export function Header({ language, onLanguageChange }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 bg-[#0f172a]/80 backdrop-blur-xl border-b border-slate-800/60 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-slate-200 tracking-wide">Gemma Long Test App</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-1 py-1 border border-slate-700/50">
          <Globe className="w-3.5 h-3.5 text-slate-400 ml-2" />
          {(['auto', 'bangla', 'english'] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => onLanguageChange(lang)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                language === lang
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {lang === 'auto' ? 'Auto' : lang === 'bangla' ? 'বাংলা' : 'English'}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
