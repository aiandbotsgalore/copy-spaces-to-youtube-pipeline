import React, { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';

interface Props {
  file: File | Blob | null;
  speakerName: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

export const AvatarCropModal: React.FC<Props> = ({ file, speakerName, onCancel, onConfirm }) => {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    setZoom(1);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!file || !sourceUrl) return null;

  const confirm = () => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    canvas.toBlob(blob => blob && onConfirm(blob), 'image/jpeg', 0.9);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Frame avatar for {speakerName}</h3>
            <p className="text-[11px] text-slate-400">Center the face inside the square.</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white"><X size={17} /></button>
        </div>
        <div className="mx-auto w-64 h-64 rounded-2xl overflow-hidden border-2 border-indigo-400 bg-slate-950 relative">
          <img
            ref={imageRef}
            src={sourceUrl}
            alt="Avatar crop preview"
            className="absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
            style={{ width: `${Math.max(100, zoom * 100)}%`, height: `${Math.max(100, zoom * 100)}%`, objectFit: 'cover' }}
          />
          <div className="absolute inset-3 rounded-xl border border-white/70 pointer-events-none" />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Zoom</span>
          <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={e => setZoom(Number(e.target.value))} className="flex-1 accent-indigo-500" />
          <span className="w-10 text-right text-[11px] font-mono text-indigo-300">{zoom.toFixed(1)}×</span>
          <button onClick={() => setZoom(1)} title="Reset zoom" className="p-1 text-slate-400 hover:text-white"><RotateCcw size={14} /></button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={confirm} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white flex items-center gap-1.5"><Check size={14} /> Save Avatar</button>
        </div>
      </div>
    </div>
  );
};

