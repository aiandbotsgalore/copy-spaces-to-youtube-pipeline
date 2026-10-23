import React, { useState } from 'react';
import { Star, X, Trash2, UserPlus, Plus } from 'lucide-react';

export interface SavedSpeaker {
  id: string;
  name: string;
  role?: string;
  color?: string;
  avatarEmoji?: string;
}

interface SavedSpeakersModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedSpeakers: SavedSpeaker[];
  onDeleteSpeaker: (idOrName: string) => void;
  onAddSpeaker: (speaker: SavedSpeaker) => void;
  getSpeakerTheme: (name: string, savedSpeakers?: SavedSpeaker[]) => { avatar: string; [key: string]: any };
}

export const SavedSpeakersModal: React.FC<SavedSpeakersModalProps> = ({
  isOpen,
  onClose,
  savedSpeakers,
  onDeleteSpeaker,
  onAddSpeaker,
  getSpeakerTheme,
}) => {
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [newSpeakerRole, setNewSpeakerRole] = useState('Speaker');
  const [newSpeakerColor, setNewSpeakerColor] = useState('indigo');
  const [newSpeakerEmoji, setNewSpeakerEmoji] = useState('🎙️');

  if (!isOpen) return null;

  const handleAdd = () => {
    if (newSpeakerName.trim()) {
      onAddSpeaker({
        id: newSpeakerName.trim().toLowerCase().replace(/\s+/g, '-'),
        name: newSpeakerName.trim(),
        avatarEmoji: newSpeakerEmoji,
        color: newSpeakerColor,
        role: newSpeakerRole,
      });
      setNewSpeakerName('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Star size={18} className="fill-amber-400/40" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Permanent Saved Speakers</h3>
              <p className="text-xs text-slate-400">These profiles appear as quick-pick options on every space</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {savedSpeakers.map((s) => {
            const theme = getSpeakerTheme(s.name, savedSpeakers);
            return (
              <div key={s.id || s.name} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow-sm ${theme.avatar}`}>
                    {s.avatarEmoji || '🎙️'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{s.name}</span>
                      {s.role && (
                        <span className="px-2 py-0.5 text-[11px] rounded-full bg-slate-800 text-slate-300 font-medium border border-slate-700">
                          {s.role}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 capitalize">{s.color || 'indigo'} theme</span>
                  </div>
                </div>
                <button
                  onClick={() => onDeleteSpeaker(s.id || s.name)}
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <UserPlus size={13} className="text-indigo-400" /> Add New Permanent Speaker
          </span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Speaker Name (e.g. Rick)"
              value={newSpeakerName}
              onChange={(e) => setNewSpeakerName(e.target.value)}
              className="col-span-2 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <select
              value={newSpeakerRole}
              onChange={(e) => setNewSpeakerRole(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="Host">Host</option>
              <option value="Co-Host">Co-Host</option>
              <option value="Special Guest">Special Guest</option>
              <option value="Speaker">Speaker</option>
            </select>
            <select
              value={newSpeakerColor}
              onChange={(e) => setNewSpeakerColor(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="indigo">Indigo</option>
              <option value="purple">Purple</option>
              <option value="emerald">Emerald</option>
              <option value="sky">Sky Blue</option>
              <option value="amber">Amber</option>
              <option value="rose">Rose</option>
              <option value="cyan">Cyan</option>
              <option value="teal">Teal</option>
              <option value="orange">Orange</option>
              <option value="fuchsia">Fuchsia</option>
              <option value="pink">Pink</option>
              <option value="lime">Lime</option>
              <option value="violet">Violet</option>
              <option value="yellow">Yellow</option>
              <option value="blue">Blue</option>
              <option value="red">Red</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <span className="text-[11px] text-slate-400 font-medium">Emoji:</span>
            {['🎙️', '🌹', '⚡', '🛸', '✨', '🧠', '👁️', '💫', '🎧', '👩‍🎨', '🌸', '👑', '👽', '🤖', '🔥', '⭐', '💡', '💬', '🕵️', '🧸', '🌟'].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setNewSpeakerEmoji(emoji)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all cursor-pointer ${
                  newSpeakerEmoji === emoji ? 'bg-indigo-600 text-white scale-110 shadow' : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button
            onClick={handleAdd}
            disabled={!newSpeakerName.trim()}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
          >
            <Plus size={13} /> Add to Permanent Directory
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SavedSpeakersModal;
