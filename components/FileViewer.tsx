import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { PipelineFile, PipelineConfig } from '../types';

interface FileViewerProps {
  file: PipelineFile;
  config: PipelineConfig;
}

const FileViewer: React.FC<FileViewerProps> = ({ file, config }) => {
  const [copied, setCopied] = useState(false);
  const content = file.content(config);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
        <div className="flex flex-col">
          <span className="font-mono text-sm font-semibold text-sky-400">{file.path}</span>
          <span className="text-xs text-slate-500 mt-0.5">{file.description}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-md transition-colors"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy File'}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-0 relative group">
        <pre className="p-4 text-xs sm:text-sm font-mono leading-relaxed text-slate-300">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  );
};

export default FileViewer;
