import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Bot,
  Play,
  Layers,
  Sparkles,
  Scissors,
  Flame,
  Activity,
  FileText,
  Mic2,
  Settings,
  FolderGit2,
  History,
  X,
  CornerDownLeft,
  ChevronRight,
  Radio,
  FileSearch,
} from 'lucide-react';
import { useCopilot } from '../../contexts/CopilotContext';
import { useMontage } from '../../contexts/MontageContext';
import { usePlayer } from '../../contexts/PlayerContext';

interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigation' | 'Transport' | 'Copilot' | 'Pipeline';
  icon: React.ReactNode;
  onSelect: () => void;
  keywords?: string[];
}

export const CopilotCommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const {
    sendMessage,
    activePanelNavHandler,
    contextPayload,
  } = useCopilot();

  const montage = useMontage();
  const player = usePlayer();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keydown listener for Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsOpen(prev => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const navigateTo = (panel: string) => {
    activePanelNavHandler?.(panel);
    setIsOpen(false);
  };

  const baseItems: PaletteItem[] = useMemo(
    () => [
      {
        id: 'nav_ai_copilot',
        title: 'SpacePipe AI Copilot',
        subtitle: 'Executive Audio Producer & Pipeline Automation chat',
        category: 'Copilot',
        icon: <Bot size={15} className="text-indigo-400" />,
        onSelect: () => navigateTo('ai-copilot'),
        keywords: ['copilot', 'ai', 'chat', 'assistant', 'prompt'],
      },
      {
        id: 'nav_montage',
        title: 'Montage Studio',
        subtitle: 'Multi-clip narrative sequencing, trimming, and broadcast loudness',
        category: 'Navigation',
        icon: <Layers size={15} className="text-pink-400" />,
        onSelect: () => navigateTo('montage'),
        keywords: ['montage', 'reel', 'sequence', 'audio', 'timeline'],
      },
      {
        id: 'nav_transcripts',
        title: 'Transcripts & Diarization',
        subtitle: 'Diarized speaker turns with synchronized waveform audio playback',
        category: 'Navigation',
        icon: <FileSearch size={15} className="text-blue-400" />,
        onSelect: () => navigateTo('transcripts'),
        keywords: ['transcripts', 'turns', 'speakers', 'whisper', 'diarization'],
      },
      {
        id: 'nav_clips',
        title: 'Best Clips Catalog',
        subtitle: 'Extracted viral soundbites, quotes, and severity ratings',
        category: 'Navigation',
        icon: <Flame size={15} className="text-amber-400" />,
        onSelect: () => navigateTo('clips'),
        keywords: ['clips', 'catalog', 'viral', 'quotes', 'soundbites'],
      },
      {
        id: 'nav_script_studio',
        title: 'Script Studio',
        subtitle: 'Multi-agent script writing, scene distillation, and polish',
        category: 'Navigation',
        icon: <FileText size={15} className="text-cyan-400" />,
        onSelect: () => navigateTo('script-studio'),
        keywords: ['script', 'studio', 'writer', 'agent', 'scenes'],
      },
      {
        id: 'nav_voice_profiles',
        title: 'Voice Profiles Library',
        subtitle: 'Recurring speaker registry and vocal signature models',
        category: 'Navigation',
        icon: <Mic2 size={15} className="text-purple-400" />,
        onSelect: () => navigateTo('voice-profiles'),
        keywords: ['voice', 'profiles', 'speakers', 'registry'],
      },
      {
        id: 'nav_live_queue',
        title: 'Live Ingest Queue',
        subtitle: 'Spaces pending download and transcription by GitHub Actions runner',
        category: 'Pipeline',
        icon: <Radio size={15} className="text-emerald-400" />,
        onSelect: () => navigateTo('live-queue'),
        keywords: ['queue', 'batch', 'priority', 'ingest', 'live'],
      },
      {
        id: 'nav_run_history',
        title: 'Workflow Run History',
        subtitle: 'Live status and logs for GitHub Actions runners',
        category: 'Pipeline',
        icon: <History size={15} className="text-violet-400" />,
        onSelect: () => navigateTo('run-history'),
        keywords: ['runs', 'actions', 'github', 'history', 'logs'],
      },
      {
        id: 'nav_config',
        title: 'Pipeline Configuration',
        subtitle: 'Repository targets, cron schedule, and webhook notifications',
        category: 'Pipeline',
        icon: <Settings size={15} className="text-slate-400" />,
        onSelect: () => navigateTo('config'),
        keywords: ['config', 'settings', 'cron', 'webhooks', 'discord'],
      },
      {
        id: 'transport_audition',
        title: montage.isAuditioning ? 'Stop Auditioning Montage' : 'Audition Active Montage Reel',
        subtitle: `${montage.clips.length} clips queued (${montage.clips.reduce((a, c) => a + (c.endSec - c.startSec), 0).toFixed(1)}s)`,
        category: 'Transport',
        icon: <Play size={15} className="text-emerald-400 fill-current" />,
        onSelect: () => {
          if (montage.isAuditioning) {
            montage.stopAudition();
          } else {
            montage.startAudition();
          }
          setIsOpen(false);
        },
        keywords: ['audition', 'play', 'montage', 'reel', 'listen'],
      },
      {
        id: 'transport_play_pause',
        title: player.isPlaying ? 'Pause Audio Player' : 'Play Audio Player',
        subtitle: player.current?.title || 'No active track loaded',
        category: 'Transport',
        icon: <Play size={15} className="text-cyan-400" />,
        onSelect: () => {
          player.togglePlay();
          setIsOpen(false);
        },
        keywords: ['play', 'pause', 'audio', 'player', 'toggle'],
      },
    ],
    [montage, player, activePanelNavHandler]
  );

  const filteredItems: PaletteItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const results: PaletteItem[] = [];

    // If query exists, add dynamic "Ask Copilot" action at the top
    if (q) {
      results.push({
        id: 'copilot_dynamic_prompt',
        title: `Ask Copilot: "${query}"`,
        subtitle: 'Send prompt directly to SpacePipe Executive Audio Producer',
        category: 'Copilot',
        icon: <Sparkles size={15} className="text-amber-400" />,
        onSelect: () => {
          sendMessage(query);
          navigateTo('ai-copilot');
        },
      });
    }

    if (!q) return baseItems;

    const matches = baseItems.filter(item => {
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchSub = item.subtitle?.toLowerCase().includes(q) || false;
      const matchKey = item.keywords?.some(k => k.toLowerCase().includes(q)) || false;
      return matchTitle || matchSub || matchKey;
    });

    return [...results, ...matches];
  }, [query, baseItems, sendMessage]);

  // Adjust selectedIndex boundary
  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].onSelect();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-slate-950/80 backdrop-blur-md transition-all">
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-indigo-950/50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onKeyDown={handleKeyDown}
      >
        {/* Input Bar */}
        <div className="p-3.5 border-b border-slate-800 flex items-center gap-3 bg-slate-950/60">
          <Search size={18} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or ask Copilot (e.g. 'Hunt soundbites', 'Montage', 'Diagnose')..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No matching commands found.
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => item.onSelect()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-indigo-600/20 text-white border border-indigo-500/30'
                      : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 flex-shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{item.title}</p>
                      {item.subtitle && (
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.subtitle}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700/60">
                      {item.category}
                    </span>
                    {isSelected && (
                      <CornerDownLeft size={12} className="text-indigo-400 opacity-80" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400">↑↓</kbd> Navigate</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400">↵</kbd> Select</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-400">Esc</kbd> Close</span>
          </div>
          <span className="text-indigo-400 font-medium">Ctrl+K / ⌘K</span>
        </div>
      </div>
    </div>
  );
};
