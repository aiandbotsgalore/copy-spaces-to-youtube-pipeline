import React, { useMemo } from 'react';
import { Play, Sparkles, ExternalLink } from 'lucide-react';
import { sanitizeCopilotText } from '../utils/copilotText';

export { sanitizeCopilotText };

export interface TimestampPlayMeta {
  audioUrl?: string;
  episodeTitle?: string;
  episodeId?: string | number;
}

export interface CopilotMarkdownProps {
  content: string;
  onSeek?: (sec: number) => void;
  onPlay?: (sec: number, meta?: TimestampPlayMeta) => void;
  onAppendToReel?: (meta?: TimestampPlayMeta) => void;
  className?: string;
}

/**
 * Parses inline formatting: bold, italic, code, links, timestamps, and quick action chips.
 */
function renderInlineText(
  text: string,
  keyPrefix: string,
  callbacks?: {
    onSeek?: (sec: number) => void;
    onPlay?: (sec: number, meta?: TimestampPlayMeta) => void;
    onAppendToReel?: (meta?: TimestampPlayMeta) => void;
  }
): React.ReactNode[] {
  if (!text) return [];

  // Tokenize regex matching:
  // 1. [+ Append to Reel]
  // 2. Combined timestamp audio link: [▶ MM:SS](url) or ▶ MM:SS (url)
  // 3. Standalone bracketed/arrow timestamp: [▶ MM:SS], ▶ MM:SS, MM:SS
  // 4. [text](url)
  // 5. `inline code`
  // 6. **bold** or __bold__
  // 7. *italic* or _italic_
  const tokenRegex = /(\[\+\s*Append to Reel\]|\[▶?\s*(?:Jump to|Play)?\s*\d{1,2}:\d{2}(?::\d{2})?\]\([^\)]+\)|▶\s*\d{1,2}:\d{2}(?::\d{2})?\s*\([^\)]+\)|\[▶?\s*(?:Jump to|Play)?\s*\d{1,2}:\d{2}(?::\d{2})?\]|▶\s*\d{1,2}:\d{2}(?::\d{2})?|\b\d{1,2}:\d{2}(?::\d{2})?\b|\[[^\]]+\]\([^\)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

  const parts = text.split(tokenRegex);
  return parts.map((part, idx) => {
    const key = `${keyPrefix}_${idx}`;

    if (!part) return null;

    // 1. [+ Append to Reel]
    if (/\[\+\s*Append to Reel\]/i.test(part)) {
      return (
        <button
          key={key}
          type="button"
          onClick={() => callbacks?.onAppendToReel?.()}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded border border-emerald-500/30 transition-colors cursor-pointer align-baseline"
          title="Append to active montage reel"
        >
          <Sparkles size={10} />
          <span>+ Append to Reel</span>
        </button>
      );
    }

    // 2. Combined or standalone timestamps
    const combinedMatch = part.match(/^(?:\[▶?\s*(?:Jump to|Play)?\s*(\d{1,2}:\d{2}(?::\d{2})?)\]|▶\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*)\((https?:\/\/[^\s\)]+)\)$/i);
    const standaloneTimeMatch = !combinedMatch && part.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const isTimestamp = combinedMatch || (
      standaloneTimeMatch &&
      (/▶|play|jump/i.test(part) || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part) || /^\[▶/.test(part))
    );

    if (isTimestamp) {
      let totalSec = 0;
      let displayTime = '';
      let targetAudioUrl: string | undefined = undefined;

      if (combinedMatch) {
        const timeStr = combinedMatch[1] || combinedMatch[2];
        targetAudioUrl = combinedMatch[3]?.trim();
        const segs = timeStr.split(':').map(Number);
        if (segs.length === 3) totalSec = segs[0] * 3600 + segs[1] * 60 + segs[2];
        else totalSec = segs[0] * 60 + segs[1];
        displayTime = timeStr;
      } else if (standaloneTimeMatch) {
        const timeStr = standaloneTimeMatch[0];
        const segs = timeStr.split(':').map(Number);
        if (segs.length === 3) totalSec = segs[0] * 3600 + segs[1] * 60 + segs[2];
        else totalSec = segs[0] * 60 + segs[1];
        displayTime = timeStr;
      }

      return (
        <button
          key={key}
          type="button"
          onClick={() => {
            const meta = targetAudioUrl ? { audioUrl: targetAudioUrl } : undefined;
            if (callbacks?.onPlay) callbacks.onPlay(totalSec, meta);
            else if (callbacks?.onSeek) callbacks.onSeek(totalSec);
          }}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 rounded border border-indigo-500/30 transition-colors cursor-pointer align-baseline"
          title={`Play audio from ${displayTime}`}
        >
          <Play size={10} className="fill-current" />
          <span>{displayTime}</span>
        </button>
      );
    }

    // 3. Links [label](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      return (
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-indigo-400 hover:text-indigo-300 underline font-medium text-xs transition-colors"
        >
          <span>{label}</span>
          <ExternalLink size={10} className="opacity-70" />
        </a>
      );
    }

    // 4. Inline code `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = part.slice(1, -1);
      return (
        <code
          key={key}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-800/90 text-indigo-300 font-mono text-[11px] border border-slate-700/60"
        >
          {code}
        </code>
      );
    }

    // 5. Bold **bold** or __bold__
    if ((part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
        (part.startsWith('__') && part.endsWith('__') && part.length >= 4)) {
      const boldText = part.slice(2, -2);
      return (
        <strong key={key} className="font-bold text-white">
          {renderInlineText(boldText, `${key}_b`, callbacks)}
        </strong>
      );
    }

    // 6. Italic *italic* or _italic_
    if ((part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
        (part.startsWith('_') && part.endsWith('_') && part.length >= 2)) {
      const italicText = part.slice(1, -1);
      return (
        <em key={key} className="italic text-slate-300">
          {renderInlineText(italicText, `${key}_i`, callbacks)}
        </em>
      );
    }

    return <span key={key}>{part}</span>;
  });
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'hr' }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'codeblock'; language: string; code: string }
  | { type: 'paragraph'; text: string };

/**
 * Splits sanitized markdown text into structured blocks (tables, headings, lists, paragraphs).
 */
function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Skip completely blank lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. Horizontal rule: ---, ***, ___
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 3. Code block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: 'codeblock', language, code: codeLines.join('\n') });
      continue;
    }

    // 4. Headings: #, ##, ###, ####
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 5. GFM Table: line has pipes and next line has separator |-|-|
    if (trimmed.includes('|') && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1]?.trim() || '';
      const isSeparator = /^[\s|:-]+$/.test(nextTrimmed) && nextTrimmed.includes('-') && nextTrimmed.includes('|');

      if (isSeparator) {
        const splitRow = (r: string) =>
          r
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map(c => c.trim());

        const headers = splitRow(trimmed);
        const rows: string[][] = [];
        i += 2; // skip header + separator

        while (i < lines.length) {
          const rowTrimmed = lines[i].trim();
          if (!rowTrimmed || !rowTrimmed.includes('|') || rowTrimmed.startsWith('#')) {
            break;
          }
          rows.push(splitRow(rowTrimmed));
          i++;
        }

        blocks.push({ type: 'table', headers, rows });
        continue;
      }
    }

    // 6. Blockquote: > text
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join(' ') });
      continue;
    }

    // 7. Ordered list: 1. Item
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // 8. Unordered list: - Item or * Item
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // 9. Regular paragraph: gather consecutive lines until blank line or block start
    const pLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !/^(?:---|\*\*\*|___)$/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('>')
    ) {
      pLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', text: pLines.join(' ') });
  }

  return blocks;
}

export const CopilotMarkdown: React.FC<CopilotMarkdownProps> = ({
  content,
  onSeek,
  onPlay,
  onAppendToReel,
  className = '',
}) => {
  const sanitized = useMemo(() => sanitizeCopilotText(content), [content]);
  const blocks = useMemo(() => parseBlocks(sanitized), [sanitized]);

  const callbacks = useMemo(
    () => ({ onSeek, onPlay, onAppendToReel }),
    [onSeek, onPlay, onAppendToReel]
  );

  return (
    <div className={`space-y-2.5 text-xs text-slate-200 leading-relaxed ${className}`}>
      {blocks.map((block, idx) => {
        const blockKey = `b_${idx}`;

        switch (block.type) {
          case 'heading': {
            if (block.level === 1) {
              return (
                <h1
                  key={blockKey}
                  className="text-base font-bold text-white border-b border-slate-800 pb-1.5 mt-3 mb-2 flex items-center gap-2"
                >
                  {renderInlineText(block.text, blockKey, callbacks)}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2
                  key={blockKey}
                  className="text-sm font-bold text-indigo-300 border-b border-slate-800/60 pb-1 mt-3 mb-1.5 flex items-center gap-2"
                >
                  {renderInlineText(block.text, blockKey, callbacks)}
                </h2>
              );
            }
            if (block.level === 3) {
              return (
                <h3
                  key={blockKey}
                  className="text-xs font-bold text-slate-100 mt-2.5 mb-1 flex items-center gap-1.5 tracking-wide"
                >
                  {renderInlineText(block.text, blockKey, callbacks)}
                </h3>
              );
            }
            return (
              <h4
                key={blockKey}
                className="text-xs font-semibold text-slate-300 mt-2 mb-0.5"
              >
                {renderInlineText(block.text, blockKey, callbacks)}
              </h4>
            );
          }

          case 'hr':
            return <hr key={blockKey} className="border-t border-slate-800/80 my-2.5" />;

          case 'table':
            return (
              <div
                key={blockKey}
                className="my-2.5 overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-950/80 shadow-inner"
              >
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-800/70 border-b border-slate-700/70 text-slate-200">
                      {block.headers.map((h, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-3.5 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider"
                        >
                          {renderInlineText(h, `${blockKey}_th_${hIdx}`, callbacks)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {block.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className={
                          rIdx % 2 === 1
                            ? 'bg-slate-900/40 hover:bg-slate-800/30 transition-colors'
                            : 'hover:bg-slate-800/30 transition-colors'
                        }
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-3.5 py-2 align-middle text-slate-300 text-[11px]"
                          >
                            {renderInlineText(cell, `${blockKey}_td_${rIdx}_${cIdx}`, callbacks)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'list': {
            if (block.ordered) {
              return (
                <div key={blockKey} className="space-y-1.5 my-2 pl-0.5">
                  {block.items.map((item, iIdx) => (
                    <div key={iIdx} className="flex items-start gap-2.5 text-xs text-slate-300 leading-relaxed">
                      <span className="flex-shrink-0 w-4.5 h-4.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold text-[10px] flex items-center justify-center mt-0.5 select-none">
                        {iIdx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        {renderInlineText(item, `${blockKey}_li_${iIdx}`, callbacks)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            return (
              <div key={blockKey} className="space-y-1.5 my-2 pl-1">
                {block.items.map((item, iIdx) => (
                  <div key={iIdx} className="flex items-start gap-2.5 text-xs text-slate-300 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      {renderInlineText(item, `${blockKey}_ul_${iIdx}`, callbacks)}
                    </div>
                  </div>
                ))}
              </div>
            );
          }

          case 'blockquote':
            return (
              <blockquote
                key={blockKey}
                className="border-l-3 border-indigo-500 bg-indigo-950/30 px-3.5 py-2 rounded-r-xl my-2 text-xs text-indigo-200/90 shadow-sm leading-relaxed"
              >
                {renderInlineText(block.text, blockKey, callbacks)}
              </blockquote>
            );

          case 'codeblock':
            return (
              <pre
                key={blockKey}
                className="bg-slate-950 border border-slate-800 rounded-xl p-3 my-2 text-[11px] font-mono text-emerald-300 overflow-x-auto shadow-sm"
              >
                <code>{block.code}</code>
              </pre>
            );

          case 'paragraph': {
            // Special styling if paragraph is an Executive Summary or Takeaway
            const isSummary = /^\*\*(?:Summary|TL;?DR|Key Finding|Key Pattern|Takeaway):\*\*/i.test(block.text);
            if (isSummary) {
              return (
                <div
                  key={blockKey}
                  className="bg-slate-900/90 border border-indigo-500/30 rounded-xl p-3 my-2 text-xs text-slate-200 shadow-sm leading-relaxed"
                >
                  {renderInlineText(block.text, blockKey, callbacks)}
                </div>
              );
            }
            return (
              <p key={blockKey} className="text-xs leading-relaxed text-slate-200 my-1">
                {renderInlineText(block.text, blockKey, callbacks)}
              </p>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
};
