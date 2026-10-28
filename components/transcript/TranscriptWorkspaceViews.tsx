import React from 'react';
import { BarChart3, Clock, FileText, Film, Search, Users } from 'lucide-react';
import type { WorkspaceTab } from './transcriptLayout';
import type { InspectorSection, InspectorSpeaker } from './TranscriptInspector';

export interface TimelineBucket {
  index: number;
  startSec: number;
  label: string;
  density: number;
  isHot: boolean;
  count: number;
  mentionCount: number;
}
interface Props {
  tab: Exclude<WorkspaceTab, 'transcript'>;
  speakerStats: InspectorSpeaker[];
  sections: InspectorSection[];
  buckets: TimelineBucket[];
  totalTurns: number;
  totalWords: number;
  onSeek: (time: number) => void;
  onFilterSpeaker: (speaker: string) => void;
  onTranscript: () => void;
}

export const TranscriptWorkspaceViews: React.FC<Props> = ({
  tab, speakerStats, sections, buckets, totalTurns, totalWords, onSeek, onFilterSpeaker, onTranscript,
}) => (
  <div className="sp-tab-view">
    {tab === 'speakers' && (
      <>
        <h3><Users size={16} className="inline mr-2 text-indigo-400"/>Speaker Overview</h3>
        <p className="text-xs text-slate-400 mb-4">Select a speaker to filter the transcript. Speaker identities can be edited in the inspector.</p>
        {speakerStats.length === 0 && <p className="text-sm text-slate-400">No diarized speakers found.</p>}
        {[...speakerStats].sort((a,b) => b.count-a.count).map(speaker => (
          <button key={speaker.rawSpeaker} type="button" className="sp-data-card block w-full text-left"
            onClick={() => { onFilterSpeaker(speaker.displayName); onTranscript(); }}>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-slate-100 font-semibold">{speaker.displayName}</span>
              <small>{speaker.count.toLocaleString()} turns · {totalTurns ? Math.round(100 * speaker.count / totalTurns) : 0}%</small>
            </div>
            <div className="sp-bar-track"><span style={{ width: (totalTurns ? 100 * speaker.count / totalTurns : 0) + '%' }} /></div>
          </button>
        ))}
      </>
    )}
    {tab === 'timeline' && (
      <>
        <h3><BarChart3 size={16} className="inline mr-2 text-indigo-400"/>Conversation Density</h3>
        <p className="text-xs text-slate-400 mb-4">Based on timestamped transcript turns, not raw audio waveform samples. Select a time region to seek.</p>
        <div className="sp-data-card">
          <div className="flex h-28 gap-[3px] items-end p-3 bg-slate-950 rounded-lg border border-slate-800" role="group" aria-label="Conversation density timeline">
            {buckets.map(bucket => <button type="button" key={bucket.index}
              className={"flex-1 min-w-[2px] rounded-sm hover:brightness-150 " + (bucket.isHot ? 'bg-fuchsia-500' : 'bg-indigo-500')}
              style={{height: (16 + Math.round(bucket.density * 84)) + '%'}}
              title={bucket.label + ' · ' + bucket.count + ' speaker turns'}
              onClick={() => onSeek(bucket.startSec)} />)}
          </div>
          <small className="mt-3 block">Pink segments contain configured keyword mentions. Counts are derived from the transcript.</small>
        </div>
      </>
    )}
    {tab === 'chapters' && (
      <>
        <h3><Clock size={16} className="inline mr-2 text-indigo-400"/>Timeline Sections</h3>
        <p className="text-xs text-slate-400 mb-4">Navigation divisions derived from available transcript turns, not AI-generated chapter titles.</p>
        {sections.map(section =>
          <button type="button" key={section.index} className="sp-list-row" onClick={() => onSeek(section.time)}>
            <Clock size={14} className="text-indigo-400" />
            <span className="flex-1">{section.label}</span>
            <span className="text-slate-400">{section.timeLabel} – {section.endLabel} · {section.turns} turns</span>
          </button>)}
        {!sections.length && <p className="text-xs text-slate-400">No transcript positions available.</p>}
      </>
    )}
    {tab === 'analysis' && (
      <>
        <h3><Search size={16} className="inline mr-2 text-indigo-400"/>Transcript Analysis</h3>
        <p className="text-xs text-slate-400 mb-4">Verified counts calculated from the currently loaded episode transcript.</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="sp-data-card"><small>Speaker turns</small><div className="text-2xl font-bold text-slate-100">{totalTurns.toLocaleString()}</div></div>
          <div className="sp-data-card"><small>Unique speakers</small><div className="text-2xl font-bold text-slate-100">{speakerStats.length}</div></div>
          <div className="sp-data-card"><small>Transcribed words</small><div className="text-2xl font-bold text-slate-100">{totalWords.toLocaleString()}</div></div>
          <div className="sp-data-card"><small>Timeline sections</small><div className="text-2xl font-bold text-slate-100">{sections.length}</div></div>
        </div>
        <h3 className="mt-4"><Users size={16} className="inline mr-2 text-indigo-400"/>Speaker Participation</h3>
        {[...speakerStats].sort((a,b) => b.count-a.count).map(speaker =>
          <div key={speaker.rawSpeaker} className="sp-data-card">
            <div className="flex justify-between text-xs"><span>{speaker.displayName}</span><span>{speaker.count} turns</span></div>
            <div className="sp-bar-track"><span style={{ width: (totalTurns ? 100 * speaker.count / totalTurns : 0) + '%' }} /></div>
          </div>)}
      </>
    )}
  </div>
);
