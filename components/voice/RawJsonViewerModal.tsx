import React from 'react';
import {
  FileText, X, Copy
} from 'lucide-react';
import { VoiceProfilesCatalog } from '../../types';

interface RawJsonViewerModalProps {
  isOpen: boolean;
  catalog: VoiceProfilesCatalog;
  onClose: () => void;
  onCopySuccess: () => void;
}

export const RawJsonViewerModal: React.FC<RawJsonViewerModalProps> = ({
  isOpen,
  catalog,
  onClose,
  onCopySuccess,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-indigo-400" />
            <h3 className="text-base font-bold text-white">voice_profiles.json</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-300 max-h-96 overflow-y-auto select-all">
          {JSON.stringify(catalog, null, 2)}
        </pre>

        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <button
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(catalog, null, 2));
              onCopySuccess();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg cursor-pointer transition-colors"
          >
            <Copy size={13} /> Copy JSON
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default RawJsonViewerModal;
