import React from 'react';
import {
  AudioWaveform, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock,
  Database, ExternalLink, FileText, Film, Pencil, Plus, Search, Sparkles, Star,
  Tag, Users, X, Zap,
} from 'lucide-react';
import type { InspectorTab, TranscriptLayout } from './transcriptLayout';

export interface InspectorSpeaker { rawSpeaker: string; displayName: string; count: number }
export interface InspectorSection { index: number; label: string; time: number; timeLabel: string; endLabel: string; turns: number }
export interface InspectorClip { id: string; title: string; quote: string; startSec: number; endSec: number }
export interface InspectorFacts {
  title: string; date: string; host: string | null; turns: number; speakers: number;
  language: string | null; model: string | null; audioSize: number | null; duration: string;
  sourceUrl: string; transcriptReady: boolean;
}
export type TranscriptAIAction = 'summary' | 'topics' | 'moments' | 'chapters';

interface Props {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  sectionOpen: TranscriptLayout['sectionOpen'];
  onToggleSection: (name: keyof TranscriptLayout['sectionOpen']) => void;
  facts: InspectorFacts;
  speakers: InspectorSpeaker[];
  sections: InspectorSection[];
  clips: InspectorClip[];
  tags: string[];
  tagDraft: string;
  onTagDraftChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (value: string) => void;
  onEditSpeaker: (rawName: string, displayName: string) => void;
  onJump: (time: number) => void;
  onAI: (task: TranscriptAIAction) => void;
}

function Accordion({ title, open, onClick, children }: {
  title: string; open: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <section className="sp-inspector-card">
      <header>
        <span>{title}</span>
        <button type="button" aria-label={(open ? 'Collapse ' : 'Expand ') + title}
          aria-expanded={open} onClick={onClick}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </header>
      {open && <div className="sp-inspector-content">{children}</div>}
    </section>
  );
}

export const TranscriptInspector: React.FC<Props> = ({
  tab, onTabChange, onClose, sectionOpen, onToggleSection, facts,
  speakers, sections, clips, tags, tagDraft, onTagDraftChange, onAddTag, onRemoveTag,
  onEditSpeaker, onJump, onAI,
}) => {
  const toolActions: Array<{ id: TranscriptAIAction; label: string; icon: React.ReactNode }> = [
    { id: 'summary', label: 'Generate Summary', icon: <Sparkles size={14} /> },
    { id: 'topics', label: 'Detect Topics', icon: <Tag size={14} /> },
    { id: 'moments', label: 'Find Key Moments', icon: <Search size={14} /> },
    { id: 'chapters', label: 'Generate Chapters', icon: <Film size={14} /> },
  ];
  return (
    <aside className="sp-inspector" aria-label="Episode inspector">
      <div className="sp-inspector-tabs" role="tablist" aria-label="Inspector views">
        {(['details', 'speakers', 'chapters', 'clips'] as InspectorTab[]).map(name =>
          <button type="button" key={name} role="tab"
            aria-selected={name === tab} onClick={() => onTabChange(name)}>
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </button>
        )}
      </div>
      <div className="sp-inspector-section">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {tab === 'details' ? 'Episode inspector' : tab === 'speakers' ? 'Diarized speakers' : tab === 'chapters' ? 'Timeline navigation' : 'Montage clips'}
          </span>
          <button type="button" onClick={onClose} className="sp-icon-btn" aria-label="Close episode inspector" title="Hide inspector"><X size={13} /></button>
        </div>

        {tab === 'details' && (
          <>
            <Accordion title="Episode Details" open={sectionOpen.details} onClick={() => onToggleSection('details')}>
              <div className="sp-source-card">
                <span className="sp-source-icon"><AudioWaveform size={20} /></span>
                <div className="min-w-0"><strong title={facts.title}>{facts.title}</strong><span>{facts.date} · {facts.duration}</span></div>
              </div>
              <dl className="sp-facts">
                <div><dt>Source</dt><dd>{facts.host ? '@' + facts.host : 'Unknown'}</dd></div>
                <div><dt>Turns</dt><dd>{facts.turns.toLocaleString()}</dd></div>
                <div><dt>Speakers</dt><dd>{facts.speakers}</dd></div>
                <div><dt>Language</dt><dd>{facts.language || 'Not specified'}</dd></div>
                <div><dt>Audio size</dt><dd>{facts.audioSize && facts.audioSize > 0 ? (facts.audioSize / (1024 * 1024)).toFixed(1) + ' MB' : 'Unknown'}</dd></div>
                <div><dt>Model</dt><dd>{facts.model || 'Not specified'}</dd></div>
              </dl>
              <div className="sp-inspector-note"><CheckCircle2 size={12} className="inline mr-1" /> {facts.transcriptReady ? 'Transcript Ready' : 'Awaiting transcription'}</div>
              {facts.sourceUrl && <a className="sp-sub-action mt-2" href={facts.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/> View source release</a>}
            </Accordion>
            <Accordion title="Quick Actions" open={sectionOpen.actions} onClick={() => onToggleSection('actions')}>
              <div className="sp-action-list">
                {toolActions.map(action =>
                  <button type="button" key={action.id} disabled={!facts.transcriptReady}
                    title={facts.transcriptReady ? 'Run this task through the connected AI Copilot' : 'Requires a transcript'}
                    onClick={() => onAI(action.id)}>
                    <span className="sp-action-icon">{action.icon}</span>
                    {action.label}<ChevronRight size={13} />
                  </button>)}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">AI actions use the current episode context. Results are shown in Copilot.</p>
            </Accordion>
            <Accordion title="Tags" open={sectionOpen.tags} onClick={() => onToggleSection('tags')}>
              {tags.length ? (
                <div className="sp-tags" aria-label="Saved episode tags">
                  {tags.map(tag => <button key={tag} onClick={() => onRemoveTag(tag)} title={'Remove tag ' + tag}>{tag} <X size={10} className="inline ml-1" /></button>)}
                </div>
              ) : <p className="text-[11px] text-slate-400">No tags yet. Add a label to organize this episode.</p>}
              <form className="sp-tag-add" onSubmit={event => { event.preventDefault(); onAddTag(); }}>
                <input value={tagDraft} onChange={event => onTagDraftChange(event.target.value)}
                  aria-label="New episode tag" maxLength={36} placeholder="Add a tag..." />
                <button type="submit" title="Save episode tag"><Plus size={14} /></button>
              </form>
              <p className="text-[10px] text-slate-500 mt-2">Saved in this browser, per episode.</p>
            </Accordion>
          </>
        )}

        {tab === 'speakers' && (
          <div className="sp-inspector-card">
            <header><span>{speakers.length} speakers · {facts.turns.toLocaleString()} turns</span><Users size={14}/></header>
            <div className="sp-inspector-content">
              {speakers.length === 0 && <p className="text-xs text-slate-400">No speakers detected.</p>}
              {[...speakers].sort((a,b) => b.count - a.count).map(speaker =>
                <button type="button" key={speaker.rawSpeaker} className="sp-list-row"
                  title={'Rename ' + speaker.displayName}
                  onClick={() => onEditSpeaker(speaker.rawSpeaker, speaker.displayName)}>
                  <Users size={12} className="text-indigo-400" />
                  <span className="flex-1 truncate">{speaker.displayName}</span>
                  <span className="text-slate-400">{speaker.count}</span>
                  <Pencil size={12} className="text-slate-400"/>
                </button>)}
            </div>
          </div>
        )}

        {tab === 'chapters' && (
          <div className="sp-inspector-card">
            <header><span>Time-based sections</span><Clock size={14}/></header>
            <div className="sp-inspector-content">
              <p className="text-[10px] text-slate-400 mb-2">Navigation sections are based on transcript position, not generated chapters.</p>
              {sections.length === 0 && <p className="text-xs text-slate-400">Load a transcript to see sections.</p>}
              {sections.map(section =>
                <button type="button" key={section.index} className="sp-list-row" onClick={() => onJump(section.time)}>
                  <Clock size={12}/><span className="flex-1">{section.label}</span><span>{section.timeLabel}</span>
                </button>)}
              <button type="button" className="sp-sub-action mt-3" disabled={!facts.transcriptReady} onClick={() => onAI('chapters')}>
                <Sparkles size={13}/> Generate semantic chapters with Copilot
              </button>
            </div>
          </div>
        )}

        {tab === 'clips' && (
          <div className="sp-inspector-card">
            <header><span>Clips in the Montage reel</span><Film size={14}/></header>
            <div className="sp-inspector-content">
              {clips.length === 0 && <p className="text-xs text-slate-400">No clips from this episode in the Montage reel. Use + Reel on any turn to add one.</p>}
              {clips.map(clip =>
                <button type="button" key={clip.id} className="sp-list-row"
                  onClick={() => onJump(clip.startSec)} title={clip.quote}>
                  <Film size={12} className="text-indigo-400"/><span className="flex-1 truncate">{clip.title}</span>
                  <span>{Math.max(0, Math.round(clip.endSec - clip.startSec))}s</span>
                </button>)}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
