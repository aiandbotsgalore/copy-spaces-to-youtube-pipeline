import React, { useState } from 'react';
import { FileText, Image as ImageIcon, X, Maximize2, ChevronDown, ChevronUp, Download } from 'lucide-react';
import type { CopilotAttachment } from '../utils/copilotTypes';
import { formatFileSize } from '../utils/attachmentUtils';

export interface CopilotAttachmentViewerProps {
  attachments?: CopilotAttachment[];
  className?: string;
  isUserMessage?: boolean;
}

export const CopilotAttachmentViewer: React.FC<CopilotAttachmentViewerProps> = ({
  attachments,
  className = '',
  isUserMessage = false,
}) => {
  const [selectedImage, setSelectedImage] = useState<CopilotAttachment | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <div className={`mt-2.5 flex flex-col gap-2 ${className}`}>
      {/* Attachments List */}
      <div className="flex flex-wrap gap-2">
        {attachments.map((att) => {
          if (att.type === 'image' && att.dataUrl) {
            return (
              <div
                key={att.id}
                className="group relative rounded-xl overflow-hidden border border-white/20 bg-black/40 hover:border-indigo-400/80 transition-all cursor-pointer shadow-md"
                onClick={() => setSelectedImage(att)}
                title={`Click to preview ${att.name}`}
              >
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="h-24 w-28 object-cover group-hover:scale-105 transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-1.5">
                  <div className="flex items-center justify-between text-white text-[10px]">
                    <span className="truncate max-w-[70px]">{att.name}</span>
                    <Maximize2 size={11} className="flex-shrink-0" />
                  </div>
                </div>
              </div>
            );
          }

          const isExpanded = expandedDocId === att.id;

          return (
            <div
              key={att.id}
              className={`rounded-xl border transition-all text-xs max-w-sm ${
                isUserMessage
                  ? 'bg-white/10 hover:bg-white/15 border-white/20 text-white'
                  : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5 p-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isUserMessage ? 'bg-white/20 text-white' : 'bg-indigo-600/20 text-indigo-400'
                }`}>
                  <FileText size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate text-xs">{att.name}</p>
                  <p className={`text-[10px] ${isUserMessage ? 'text-indigo-100' : 'text-slate-400'}`}>
                    {formatFileSize(att.size)}
                  </p>
                </div>
                {att.textContent && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDocId(isExpanded ? null : att.id);
                    }}
                    className={`p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${
                      isUserMessage ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={isExpanded ? 'Collapse preview' : 'View document preview'}
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
              </div>

              {/* Collapsible Document Text Content Preview */}
              {isExpanded && att.textContent && (
                <div className="border-t border-white/10 p-3 bg-black/40 rounded-b-xl text-[11px] font-mono max-h-48 overflow-y-auto leading-relaxed text-slate-300">
                  <pre className="whitespace-pre-wrap break-words">{att.textContent.slice(0, 5000)}</pre>
                  {att.textContent.length > 5000 && (
                    <p className="text-[10px] text-amber-400/80 mt-1 italic">
                      (Preview truncated — full {formatFileSize(att.size)} document sent to Copilot)
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Image Modal Lightbox */}
      {selectedImage && selectedImage.dataUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center gap-2 min-w-0">
                <ImageIcon size={16} className="text-indigo-400 flex-shrink-0" />
                <span className="font-semibold text-sm text-white truncate">{selectedImage.name}</span>
                <span className="text-xs text-slate-400">({formatFileSize(selectedImage.size)})</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Image */}
            <div className="p-4 overflow-auto flex items-center justify-center bg-black/60 max-h-[80vh]">
              <img
                src={selectedImage.dataUrl}
                alt={selectedImage.name}
                className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
