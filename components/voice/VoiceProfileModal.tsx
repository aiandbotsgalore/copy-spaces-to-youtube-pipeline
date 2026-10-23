import React from 'react';
import {
  AudioWaveform, X, UploadCloud, Music, Volume2, Loader, Sparkles, Check
} from 'lucide-react';
import { VoiceProfile } from '../../types';
import { AudioPreCheckResult, ColorOption } from './types';

interface VoiceProfileModalProps {
  isOpen: boolean;
  modalMode: 'CREATE' | 'EDIT' | 'DIARIZATION_INFO' | 'RAW_JSON' | 'CLI_GUIDE' | 'SEPARATION_MATRIX' | null;
  targetProfile: VoiceProfile | null;
  formName: string;
  setFormName: (val: string) => void;
  formRole: string;
  setFormRole: (val: string) => void;
  formColor: string;
  setFormColor: (val: string) => void;
  formEmoji: string;
  setFormEmoji: (val: string) => void;
  formNotes: string;
  setFormNotes: (val: string) => void;
  formAudioUrl: string;
  setFormAudioUrl: (val: string) => void;
  audioSourceTab: 'COMPUTER' | 'URL';
  setAudioSourceTab: (val: 'COMPUTER' | 'URL') => void;
  localAudioFile: File | null;
  setLocalAudioFile: (f: File | null) => void;
  localAudioPreviewUrl: string | null;
  setLocalAudioPreviewUrl: (url: string | null) => void;
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  inspectingAudio: boolean;
  audioPreCheck: AudioPreCheckResult | null;
  handleSelectAudioFile: (f: File) => void;
  handleUploadFromComputerAndEnroll: () => void;
  uploadingAudio: boolean;
  hasGitHub: boolean;
  handleCloudEnroll: () => void;
  enrollingCloud: boolean;
  handleSaveForm: () => void;
  onClose: () => void;
  roleOptions: string[];
  colorOptions: ColorOption[];
  emojiOptions: string[];
}

export const VoiceProfileModal: React.FC<VoiceProfileModalProps> = ({
  isOpen,
  modalMode,
  targetProfile,
  formName,
  setFormName,
  formRole,
  setFormRole,
  formColor,
  setFormColor,
  formEmoji,
  setFormEmoji,
  formNotes,
  setFormNotes,
  formAudioUrl,
  setFormAudioUrl,
  audioSourceTab,
  setAudioSourceTab,
  localAudioFile,
  setLocalAudioFile,
  localAudioPreviewUrl,
  setLocalAudioPreviewUrl,
  dragOver,
  setDragOver,
  inspectingAudio,
  audioPreCheck,
  handleSelectAudioFile,
  handleUploadFromComputerAndEnroll,
  uploadingAudio,
  hasGitHub,
  handleCloudEnroll,
  enrollingCloud,
  handleSaveForm,
  onClose,
  roleOptions,
  colorOptions,
  emojiOptions,
}) => {
  if (!isOpen || (modalMode !== 'CREATE' && modalMode !== 'EDIT')) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <AudioWaveform size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {modalMode === 'CREATE' ? 'Add New Voice Profile' : `Edit Profile: ${targetProfile?.name}`}
              </h3>
              <p className="text-xs text-slate-400">Configure identity and acoustic metadata</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Speaker Name */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Speaker Name</label>
            <input
              type="text"
              placeholder="e.g. Angela, Logan, Rick Doty…"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              className="w-full px-3.5 py-2 text-xs font-semibold bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 shadow-inner"
            />
          </div>

          {/* Role & Color */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Role</label>
              <select
                value={formRole}
                onChange={e => setFormRole(e.target.value)}
                className="w-full px-3 py-2 text-xs font-medium bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {roleOptions.map(r => (
                  <option key={r} value={r} className="bg-slate-900 text-white">{r}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Color Theme</label>
              <select
                value={formColor}
                onChange={e => setFormColor(e.target.value)}
                className="w-full px-3 py-2 text-xs font-medium bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {colorOptions.map(c => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-white">{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Avatar Emoji */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Avatar Emoji</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {emojiOptions.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setFormEmoji(emoji)}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm transition-all cursor-pointer ${
                    formEmoji === emoji ? 'bg-indigo-600 text-white scale-110 shadow-md ring-2 ring-indigo-400' : 'bg-slate-950 hover:bg-slate-800'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Bio / Vocal Characteristics</label>
            <textarea
              rows={2}
              placeholder="e.g. Host on tech spaces. Lower register, clear articulation."
              value={formNotes}
              onChange={e => setFormNotes(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 shadow-inner"
            />
          </div>

          {/* Audio Sample Reference */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Audio Sample Reference</span>
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                <button
                  type="button"
                  onClick={() => setAudioSourceTab('COMPUTER')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                    audioSourceTab === 'COMPUTER' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  💻 From Computer
                </button>
                <button
                  type="button"
                  onClick={() => setAudioSourceTab('URL')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                    audioSourceTab === 'URL' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🌐 Web URL / Path
                </button>
              </div>
            </div>

            {audioSourceTab === 'COMPUTER' ? (
              <div className="space-y-3">
                {!localAudioFile ? (
                  <label
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      if (e.dataTransfer.files?.[0]) {
                        handleSelectAudioFile(e.dataTransfer.files[0]);
                      }
                    }}
                    className={`flex flex-col items-center justify-center p-5 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                      dragOver ? 'border-indigo-500 bg-indigo-950/20' : 'border-slate-700 hover:border-indigo-500/60 bg-slate-950/60 hover:bg-slate-950'
                    }`}
                  >
                    <input
                      type="file"
                      accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          handleSelectAudioFile(e.target.files[0]);
                        }
                      }}
                    />
                    <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 mb-2">
                      <UploadCloud size={20} />
                    </div>
                    <span className="text-xs font-bold text-slate-200">
                      Click to browse or drag &amp; drop audio sample
                    </span>
                    <span className="text-[11px] text-slate-400 mt-0.5">
                      Direct from your computer: WAV, MP3, M4A, OGG (3s – 15s clean monologue recommended)
                    </span>
                  </label>
                ) : (
                  <div className="p-3.5 bg-slate-950 border border-slate-700/80 rounded-xl space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex-shrink-0">
                          <Music size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{localAudioFile.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {(localAudioFile.size / 1024).toFixed(1)} KB • {localAudioFile.type || 'audio file'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLocalAudioFile(null);
                          if (localAudioPreviewUrl) URL.revokeObjectURL(localAudioPreviewUrl);
                          setLocalAudioPreviewUrl(null);
                        }}
                        className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="Remove file"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    {/* Audio Player Preview */}
                    {localAudioPreviewUrl && (
                      <div className="space-y-1">
                        <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
                          <Volume2 size={11} className="text-indigo-400" /> Listen to Audio Sample
                        </span>
                        <audio
                          controls
                          src={localAudioPreviewUrl}
                          className="w-full h-8 rounded-lg bg-slate-900 border border-slate-800"
                        />
                      </div>
                    )}

                    {/* Web Audio Pre-Flight Inspection Card */}
                    {inspectingAudio && (
                      <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/25 flex items-center gap-2 text-xs text-indigo-300">
                        <Loader size={13} className="animate-spin text-indigo-400" />
                        <span>Analyzing acoustic waveform with Web Audio API…</span>
                      </div>
                    )}

                    {audioPreCheck && (
                      <div className={`p-3 rounded-xl border space-y-2 text-xs ${
                        audioPreCheck.qualityLevel === 'excellent' ? 'bg-emerald-500/10 border-emerald-500/30' :
                        audioPreCheck.qualityLevel === 'good' ? 'bg-indigo-500/10 border-indigo-500/30' :
                        audioPreCheck.qualityLevel === 'warning' ? 'bg-amber-500/10 border-amber-500/30' :
                        'bg-rose-500/10 border-rose-500/30'
                      }`}>
                        <div className="flex items-center justify-between font-bold">
                          <span className="flex items-center gap-1.5 text-white">
                            <Sparkles size={13} className={audioPreCheck.qualityLevel === 'error' ? 'text-rose-400' : audioPreCheck.qualityLevel === 'warning' ? 'text-amber-400' : 'text-emerald-400'} />
                            Pre-Flight Quality Check
                          </span>
                          <span className={`text-[11px] uppercase font-mono px-2 py-0.5 rounded font-bold ${
                            audioPreCheck.qualityLevel === 'excellent' ? 'bg-emerald-500/20 text-emerald-300' :
                            audioPreCheck.qualityLevel === 'good' ? 'bg-indigo-500/20 text-indigo-300' :
                            audioPreCheck.qualityLevel === 'warning' ? 'bg-amber-500/20 text-amber-300' :
                            'bg-rose-500/20 text-rose-300'
                          }`}>
                            {audioPreCheck.qualityLevel}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                          <div className="bg-slate-950/70 p-1.5 rounded-lg border border-slate-800 text-center">
                            <span className="text-slate-400 block text-[11px]">DURATION</span>
                            <span className="font-bold text-white">{audioPreCheck.duration.toFixed(1)}s</span>
                          </div>
                          <div className="bg-slate-950/70 p-1.5 rounded-lg border border-slate-800 text-center">
                            <span className="text-slate-400 block text-[11px]">PEAK LEVEL</span>
                            <span className="font-bold text-white">{audioPreCheck.peakDb.toFixed(1)} dBFS</span>
                          </div>
                          <div className="bg-slate-950/70 p-1.5 rounded-lg border border-slate-800 text-center">
                            <span className="text-slate-400 block text-[11px]">SAMPLE RATE</span>
                            <span className="font-bold text-white">{audioPreCheck.sampleRate / 1000} kHz</span>
                          </div>
                        </div>

                        <div className="space-y-0.5 text-[11px] text-slate-300">
                          {audioPreCheck.qualityNotes.map((note, idx) => (
                            <p key={idx} className="flex items-start gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                              <span>{note}</span>
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action: Upload & Cloud Enroll */}
                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                        Uploads file directly to <code className="text-indigo-300 font-mono">speaker_samples/</code> and triggers cloud enrollment.
                      </p>
                      <button
                        type="button"
                        onClick={handleUploadFromComputerAndEnroll}
                        disabled={uploadingAudio || !hasGitHub || !formName.trim()}
                        title={!hasGitHub ? 'Configure GitHub Token in Settings' : 'Upload file to repo and enroll'}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-md cursor-pointer transition-all hover:scale-105"
                      >
                        {uploadingAudio ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {uploadingAudio ? 'Uploading…' : 'Upload & Enroll'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="e.g. https://domain.com/sample.wav or speaker_samples/Angela/clip_01.wav"
                  value={formAudioUrl}
                  onChange={e => setFormAudioUrl(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 shadow-inner"
                />
                {formAudioUrl.trim().startsWith('http') && (
                  <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
                          <Sparkles size={13} className="text-indigo-400" /> 1-Click Cloud Neural Enrollment
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Extract the 192-dim SpeechBrain ECAPA-TDNN vector in GitHub Actions cloud runner and auto-commit to <code className="text-indigo-300 font-mono">voice_profiles.json</code>.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCloudEnroll}
                        disabled={enrollingCloud || !hasGitHub || !formName.trim()}
                        title={!hasGitHub ? 'Configure GitHub Token in Settings first' : 'Dispatch enroll_voice.yml workflow'}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-md cursor-pointer transition-all hover:scale-105"
                      >
                        {enrollingCloud ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {enrollingCloud ? 'Dispatching…' : 'Enroll in Cloud'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveForm}
            disabled={!formName.trim()}
            className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all shadow-lg cursor-pointer hover:scale-105"
          >
            <Check size={14} /> Save Profile
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceProfileModal;
