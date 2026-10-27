import React, { useState, useMemo } from 'react';
import { Copy, Check, Download, Bot } from 'lucide-react';
import { PipelineFile, EnhancedConfig } from '../types';
import { normalizeLineEndings } from '../utils/posixUtils';

interface FileViewerProps {
  file: PipelineFile;
  config: EnhancedConfig;
  onAskAi?: (file: PipelineFile) => void;
}

const FileViewer: React.FC<FileViewerProps> = ({ file, config, onAskAi }) => {
  const [copied, setCopied] = useState(false);
  const content = useMemo(() => normalizeLineEndings(file.content(config)), [file, config]);
  const lines = useMemo(() => content.split('\n'), [content]);

  const handleCopy = () => {
    const cleanContent = normalizeLineEndings(content);
    navigator.clipboard.writeText(cleanContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        console.warn('Clipboard copy failed:', err);
      });
  };

  const handleDownload = () => {
    const cleanContent = normalizeLineEndings(content);
    const mimeType = file.language === 'bash' ? 'text/x-shellscript;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([cleanContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = file.path.split('/').pop() || file.name;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const lineCount = lines.length;

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
        <div className="flex flex-col min-w-0">
          <span className="font-mono text-sm font-semibold text-slate-300 truncate">{file.path}</span>
          <span className="text-xs text-slate-400 mt-0.5">{file.description} · {lineCount} lines</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onAskAi && (
            <button
              onClick={() => onAskAi(file)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 rounded-md transition-colors cursor-pointer"
              title="Ask AI Copilot to inspect or modify this file"
            >
              <Bot size={13} />
              Ask AI
            </button>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
          >
            <Download size={13} />
            Download
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-md transition-colors cursor-pointer"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                <td className="select-none w-10 px-3 py-0 text-right text-[11px] font-mono text-slate-500 border-r border-slate-800/50 sticky left-0 bg-slate-900">
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
