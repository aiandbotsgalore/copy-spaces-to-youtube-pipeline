import React, { useRef, useState } from 'react';
import { Upload, ImageIcon, X, CheckCircle, AlertCircle } from 'lucide-react';
import { EnhancedConfig } from '../types';

interface Props {
  config: EnhancedConfig;
  onChange: (updates: Partial<EnhancedConfig>) => void;
}

// Always converts the uploaded image to a JPEG data URL via canvas.
// This ensures artwork.jpg in the repo always has the correct format
// regardless of whether the user uploaded a PNG, WebP, HEIC, etc.
function toJpegDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not an image.'));
      return;
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not available.')); return; }
      // Fill white so transparent PNGs become opaque (JPEG has no alpha)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image.'));
    };
    img.src = objectUrl;
  });
}

const ArtworkUpload: React.FC<Props> = ({ config, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');

  const processFile = async (file: File) => {
    setConvertError('');
    setConverting(true);
    try {
      const dataUrl = await toJpegDataUrl(file);
      onChange({ artworkDataUrl: dataUrl, imageUrl: '' });
    } catch (e) {
      setConvertError((e as Error).message);
    } finally {
      setConverting(false);
    }
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
    setConvertError('');
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
              <span className="text-sm font-medium text-emerald-400">Artwork ready</span>
            </div>
            <p className="text-xs text-slate-500">
              Converted to JPEG and will be deployed as <code className="bg-slate-800 px-1 rounded">artwork.jpg</code>
            </p>
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
          onClick={() => !converting && inputRef.current?.click()}
          className={`cursor-pointer flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-xl transition-colors ${
            dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-900'
          } ${converting ? 'cursor-wait opacity-70' : ''}`}
        >
          <div className="p-3 bg-slate-800 rounded-xl">
            <ImageIcon size={24} className={converting ? 'text-indigo-400 animate-pulse' : 'text-slate-500'} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-slate-300">
              {converting ? 'Converting to JPEG…' : 'Drop artwork here or click to upload'}
            </p>
            <p className="text-xs text-slate-600 mt-1">
              PNG, JPG, WebP — converted to JPEG automatically · Min 1400×1400px recommended
            </p>
          </div>
          {!converting && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
              <Upload size={13} className="text-slate-400" />
              <span className="text-xs text-slate-400 font-medium">Choose file</span>
            </div>
          )}
        </div>
      )}

      {convertError && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">{convertError}</p>
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
