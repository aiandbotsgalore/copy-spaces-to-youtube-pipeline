import React, { useState } from 'react';
import { Copy, Check, Download } from 'lucide-react';
import { PipelineFile, EnhancedConfig } from '../types';

interface FileViewerProps {
  file: PipelineFile;
  config: EnhancedConfig;
}

const FileViewer: React.FC<FileViewerProps> = ({ file, config }) => {
  const [copied, setCopied] = useState(false);
  const content = file.content(config);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = file.path.split('/').pop() || file.name;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lineCount = content.split('\n').length;

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
        <div className="flex flex-col min-w-0">
          <span className="font-mono text-sm font-semibold text-sky-400 truncate">{file.path}</span>
          <span className="text-xs text-slate-500 mt-0.5">{file.description} · {lineCount} lines</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors"
          >
            <Download size={13} />
            Download
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-md transition-colors"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <tbody>
            {content.split('\n').map((line, i) => (
              <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                <td className="select-none w-10 px-3 py-0 text-right text-[11px] font-mono text-slate-700 border-r border-slate-800/50 sticky left-0 bg-slate-900">
                  {i + 1}
                </td>
                <td className="px-4 py-0">
                  <pre className="text-xs sm:text-sm font-mono leading-6 text-slate-300 whitespace-pre">{line || ' '}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FileViewer;
