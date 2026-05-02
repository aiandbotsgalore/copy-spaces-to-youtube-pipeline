import React, { useRef, useState } from 'react';
import { Upload, ImageIcon, X, CheckCircle } from 'lucide-react';
import { EnhancedConfig } from '../types';

interface Props {
  config: EnhancedConfig;
  onChange: (updates: Partial<EnhancedConfig>) => void;
}

const ArtworkUpload: React.FC<Props> = ({ config, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target?.result as string;
      onChange({ artworkDataUrl: dataUrl, imageUrl: '' });
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const clearArtwork = () => {
    onChange({ artworkDataUrl: '' });
    if (inputRef.current) inputRef.current.value = '';
  };

  const hasUploadedArtwork = !!config.artworkDataUrl;

  return (
    <div className="space-y-3">
      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Podcast Artwork</label>

      {hasUploadedArtwork ? (
        <div className="flex items-center gap-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
          <img
            src={config.artworkDataUrl}
            alt="Artwork preview"
            className="w-16 h-16 rounded-lg object-cover ring-2 ring-emerald-500/40"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">Artwork uploaded</span>
            </div>
            <p className="text-xs text-slate-500">Will be deployed as <code className="bg-slate-800 px-1 rounded">artwork.jpg</code> to your repo</p>
          </div>
          <button onClick={clearArtwork} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-xl transition-colors ${
            dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-900'
          }`}
        >
          <div className="p-3 bg-slate-800 rounded-xl">
            <ImageIcon size={24} className="text-slate-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-slate-300">Drop artwork here or click to upload</p>
            <p className="text-xs text-slate-600 mt-1">PNG, JPG, WebP · Recommended 1400×1400px minimum</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
            <Upload size={13} className="text-slate-400" />
            <span className="text-xs text-slate-400 font-medium">Choose file</span>
          </div>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />

      {!hasUploadedArtwork && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-xs text-slate-600">or use a URL</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>
          <input
            type="text"
            placeholder="https://example.com/artwork.jpg"
            value={config.imageUrl}
            onChange={e => onChange({ imageUrl: e.target.value })}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <p className="text-[10px] text-slate-600">Must be a publicly accessible square image (min 1400×1400px).</p>
        </div>
      )}
    </div>
  );
};

export default ArtworkUpload;
