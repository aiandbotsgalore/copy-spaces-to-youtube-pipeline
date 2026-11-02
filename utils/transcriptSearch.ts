import React from 'react';

/**
 * utils/transcriptSearch.ts
 *
 * Google Search Query Syntax Parser, Match Evaluator & Boundary-Aware Highlighter
 * Supports:
 *  - Implicit AND (space-separated tokens)
 *  - Exact Phrases ("quoted string")
 *  - Word Boundaries (\b) to prevent substring collision
 *  - Negation / Exclusions (-term and -"quoted phrase")
 *  - Explicit OR / pipe (|)
 *  - Case-insensitive & punctuation-agnostic token boundaries
 */

export interface SearchQueryAST {
  exactPhrases: string[];     // ["murder me"]
  mustTerms: string[];        // ["murder", "suicide"] (Implicit AND)
  excludedTerms: string[];    // terms prefixed with -
  excludedPhrases: string[];  // phrases prefixed with -"..."
  orGroups: string[][];       // terms joined by OR / |
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParsedSpeakerQuery {
  speaker?: string;
  query: string;
}

/**
 * Parses optional `speaker:Name` or `from:Name` prefix from a search query.
 * Example: `speaker:Angela why she left` -> `{ speaker: 'Angela', query: 'why she left' }`
 * Example: `from:"Eric Hecker" south pole` -> `{ speaker: 'Eric Hecker', query: 'south pole' }`
 */
export function extractSpeakerPrefix(query: string): ParsedSpeakerQuery {
  if (!query) return { query: '' };
  const trimmed = query.trim();
  const match = trimmed.match(/^(?:speaker|from):\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*(.*)$/i);
  if (match) {
    const speaker = (match[1] || match[2] || match[3] || '').trim();
    const rest = (match[4] || '').trim();
    if (speaker) {
      return { speaker, query: rest };
    }
  }
  return { query: trimmed };
}

/**
 * Normalizes a speaker name by trimming whitespace and lowercasing.
 */
export function normalizeSpeakerName(speaker?: string | null): string {
  if (!speaker) return '';
  return speaker.trim().toLowerCase();
}

/**
 * Checks whether two speaker names match exactly after whitespace trimming and lowercasing.
 * Ensures:
 * - Case-insensitive ('angela' === 'Angela')
 * - Whitespace trimmed (' Dan ' === 'Dan')
 * - No partial/substring matches ('Dan' !== 'Danny', 'Logan' !== 'Logan Smith')
 * - Generic diarization labels remain distinct ('Speaker 1' !== 'SPEAKER_01')
 */
export function isNormalizedSpeakerMatch(speakerA?: string | null, speakerB?: string | null): boolean {
  if (!speakerA || !speakerB) return false;
  const normA = normalizeSpeakerName(speakerA);
  const normB = normalizeSpeakerName(speakerB);
  return Boolean(normA && normB && normA === normB);
}

export function parseGoogleQuery(query: string): SearchQueryAST {
  const trimmed = query.trim();
  const ast: SearchQueryAST = {
    exactPhrases: [],
    mustTerms: [],
    excludedTerms: [],
    excludedPhrases: [],
    orGroups: [],
  };

  if (!trimmed) return ast;

  // 1. Extract excluded exact phrases: -"some phrase"
  const excludedPhraseRegex = /-"([^"]+)"/g;
  let match;
  while ((match = excludedPhraseRegex.exec(trimmed)) !== null) {
    if (match[1].trim()) ast.excludedPhrases.push(match[1].trim().toLowerCase());
  }

  // 2. Extract exact phrases: "some phrase"
  const exactPhraseRegex = /(?<!-)"([^"]+)"/g;
  while ((match = exactPhraseRegex.exec(trimmed)) !== null) {
    if (match[1].trim()) ast.exactPhrases.push(match[1].trim().toLowerCase());
  }

  // Strip all quoted expressions to parse remaining terms
  const unquoted = trimmed
    .replace(/-"[^"]+"/g, ' ')
    .replace(/"[^"]+"/g, ' ')
    .trim();

  // 3. Handle OR groups: term1 OR term2 or term1 | term2
  const orSplit = unquoted.split(/\s+OR\s+|\s*\|\s*/i);
  if (orSplit.length > 1) {
    ast.orGroups.push(
      orSplit
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0)
    );
    return ast;
  }

  // 4. Tokenize remaining terms into mustTerms and excludedTerms
  const tokens = unquoted.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith('-') && token.length > 1) {
      ast.excludedTerms.push(token.slice(1).toLowerCase());
    } else {
      ast.mustTerms.push(token.toLowerCase());
    }
  }

  return ast;
}

export function hasActiveQuery(ast: SearchQueryAST): boolean {
  return (
    ast.exactPhrases.length > 0 ||
    ast.mustTerms.length > 0 ||
    ast.excludedTerms.length > 0 ||
    ast.excludedPhrases.length > 0 ||
    ast.orGroups.length > 0
  );
}

export function evaluateTurnMatch(text: string, ast: SearchQueryAST): boolean {
  const normalizedText = text.toLowerCase();

  // 1. Exclusions check (Fail immediately if any excluded term is present)
  for (const phrase of ast.excludedPhrases) {
    const rx = new RegExp(`\\b${escapeRegex(phrase).replace(/\s+/g, '[\\s,.:;!?\"\'\\-–—]+')}\\b`, 'i');
    if (rx.test(normalizedText)) return false;
  }
  for (const term of ast.excludedTerms) {
    const leadingBoundary = /^\w/.test(term) ? '\\b' : '';
    const trailingBoundary = /\w$/.test(term) ? '\\b' : '';
    const rx = new RegExp(`${leadingBoundary}${escapeRegex(term)}${trailingBoundary}`, 'i');
    if (rx.test(normalizedText)) return false;
  }

  // 2. Exact phrases check (Must match all exact phrases)
  for (const phrase of ast.exactPhrases) {
    const rx = new RegExp(`\\b${escapeRegex(phrase).replace(/\s+/g, '[\\s,.:;!?\"\'\\-–—]+')}\\b`, 'i');
    if (!rx.test(normalizedText)) return false;
  }

  // 3. OR groups check
  for (const group of ast.orGroups) {
    const matchedAny = group.some((term) => {
      const leadingBoundary = /^\w/.test(term) ? '\\b' : '';
      const trailingBoundary = /\w$/.test(term) ? '\\b' : '';
      const rx = new RegExp(`${leadingBoundary}${escapeRegex(term).replace(/\s+/g, '[\\s,.:;!?\"\'\\-–—]+')}${trailingBoundary}`, 'i');
      return rx.test(normalizedText);
    });
    if (!matchedAny) return false;
  }

  // 4. Implicit AND check (All mustTerms must appear with word boundaries)
  for (const term of ast.mustTerms) {
    const leadingBoundary = /^\w/.test(term) ? '\\b' : '';
    const trailingBoundary = /\w$/.test(term) ? '\\b' : '';
    const rx = new RegExp(`${leadingBoundary}${escapeRegex(term)}${trailingBoundary}`, 'i');
    if (!rx.test(normalizedText)) return false;
  }

  return true;
}

/**
 * Returns raw HTML string with matches wrapped in <mark>
 */
export function highlightTranscriptMatches(text: string, ast: SearchQueryAST): string {
  const matchPatterns: string[] = [];

  // Add quoted phrases first (longer matches take priority)
  for (const phrase of ast.exactPhrases) {
    matchPatterns.push(`\\b${escapeRegex(phrase).replace(/\s+/g, '[\\s,.:;!?\"\'\\-–—]+')}\\b`);
  }

  // Add individual AND / OR tokens
  const singleTokens = [
    ...ast.mustTerms,
    ...ast.orGroups.flat(),
  ];

  for (const token of singleTokens) {
    if (token) {
      const leadingBoundary = /^\w/.test(token) ? '\\b' : '';
      const trailingBoundary = /\w$/.test(token) ? '\\b' : '';
      matchPatterns.push(`${leadingBoundary}${escapeRegex(token)}${trailingBoundary}`);
    }
  }

  if (matchPatterns.length === 0) return text;

  // Sort by length descending to match full phrases before individual words
  matchPatterns.sort((a, b) => b.length - a.length);

  const combinedRegex = new RegExp(`(${matchPatterns.join('|')})`, 'gi');
  return text.replace(combinedRegex, '<mark class="bg-amber-400 text-black font-semibold rounded px-0.5">$1</mark>');
}

/**
 * Returns React.ReactNode elements for native safe JSX rendering
 */
export function renderTranscriptMatch(text: string, queryOrAst: string | SearchQueryAST): React.ReactNode {
  if (!text) return text;
  const ast = typeof queryOrAst === 'string' ? parseGoogleQuery(queryOrAst) : queryOrAst;
  const matchPatterns: string[] = [];

  for (const phrase of ast.exactPhrases) {
    matchPatterns.push(`\\b${escapeRegex(phrase).replace(/\s+/g, '[\\s,.:;!?\"\'\\-–—]+')}\\b`);
  }

  const singleTokens = [
    ...ast.mustTerms,
    ...ast.orGroups.flat(),
  ];

  for (const token of singleTokens) {
    if (token) {
      const leadingBoundary = /^\w/.test(token) ? '\\b' : '';
      const trailingBoundary = /\w$/.test(token) ? '\\b' : '';
      matchPatterns.push(`${leadingBoundary}${escapeRegex(token)}${trailingBoundary}`);
    }
  }

  if (matchPatterns.length === 0) return text;

  matchPatterns.sort((a, b) => b.length - a.length);

  const combinedRegex = new RegExp(`(${matchPatterns.join('|')})`, 'gi');
  const matcher = new RegExp(`^(?:${matchPatterns.join('|')})$`, 'i');

  const parts = text.split(combinedRegex);
  return parts.map((part, i) =>
    matcher.test(part)
      ? React.createElement(
          'mark',
          { key: i, className: 'bg-amber-400 text-black font-semibold rounded px-0.5' },
          part
        )
      : part
  );
}

export interface RelevantSpanInput {
  start: number;
  end: number;
  score?: number;
  text?: string;
}

export interface FocusSegment {
  text: string;
  isFocus: boolean;
  score?: number;
}

/**
 * Validates character offsets and partitions text into continuous segments.
 *
 * Bounds & Validation rules:
 * - start and end must be finite numbers
 * - start must be nonnegative (>= 0)
 * - end must be strictly greater than start (end > start)
 * - end must not exceed text.length (end <= text.length)
 * - If offsets are missing, non-finite, out of order, or out of bounds, they are safely ignored
 * - Spans are sorted by start offset and merged if overlapping or contiguous
 * - Concatenation of all output segment texts is guaranteed to equal the original input text exactly
 */
export function partitionTextWithFocusSpans(
  text: string,
  spans?: RelevantSpanInput[] | null
): FocusSegment[] {
  if (!text) return [];
  if (!spans || !Array.isArray(spans) || spans.length === 0) {
    return [{ text, isFocus: false }];
  }

  const textLen = text.length;
  const validSpans: Array<{ start: number; end: number; score?: number }> = [];

  for (const span of spans) {
    if (!span || typeof span !== 'object') continue;
    const { start, end, score } = span;

    if (
      typeof start === 'number' &&
      typeof end === 'number' &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= textLen
    ) {
      validSpans.push({
        start: Math.floor(start),
        end: Math.floor(end),
        score: typeof score === 'number' && Number.isFinite(score) ? score : undefined,
      });
    }
  }

  if (validSpans.length === 0) {
    return [{ text, isFocus: false }];
  }

  // Sort spans by start offset ASC, then end offset ASC
  validSpans.sort((a, b) => a.start - b.start || a.end - b.end);

  // Merge overlapping or contiguous spans
  const merged: Array<{ start: number; end: number; score?: number }> = [];
  for (const span of validSpans) {
    if (merged.length === 0) {
      merged.push({ ...span });
    } else {
      const last = merged[merged.length - 1];
      if (span.start <= last.end) {
        last.end = Math.max(last.end, span.end);
        if (span.score !== undefined) {
          last.score = last.score !== undefined ? Math.max(last.score, span.score) : span.score;
        }
      } else {
        merged.push({ ...span });
      }
    }
  }

  // Partition text into sequential slices
  const segments: FocusSegment[] = [];
  let cursor = 0;

  for (const span of merged) {
    if (span.start > cursor) {
      segments.push({
        text: text.slice(cursor, span.start),
        isFocus: false,
      });
    }
    segments.push({
      text: text.slice(span.start, span.end),
      isFocus: true,
      score: span.score,
    });
    cursor = span.end;
  }

  if (cursor < textLen) {
    segments.push({
      text: text.slice(cursor),
      isFocus: false,
    });
  }

  return segments;
}

/**
 * Renders transcript text with Context Focus highlighted inline in its original position.
 * If queryOrAst is provided, search keywords are also highlighted using native mark elements.
 */
export function renderTranscriptWithContextFocus(
  text: string,
  spans?: RelevantSpanInput[] | null,
  queryOrAst?: string | SearchQueryAST,
  focusClassName: string = 'bg-amber-500/20 text-slate-100 rounded px-1 py-0.5 border-b border-amber-400/50'
): React.ReactNode {
  if (!text) return text;

  const partitions = partitionTextWithFocusSpans(text, spans);

  // If no focus spans were applied, fall back to standard match rendering
  if (partitions.length === 1 && !partitions[0].isFocus) {
    return queryOrAst ? renderTranscriptMatch(text, queryOrAst) : text;
  }

  return partitions.map((part, idx) => {
    const renderedContent = queryOrAst
      ? renderTranscriptMatch(part.text, queryOrAst)
      : part.text;

    if (part.isFocus) {
      return React.createElement(
        'mark',
        {
          key: idx,
          className: focusClassName,
          title: part.score !== undefined
            ? `Context Focus excerpt (Cohere score: ${part.score.toFixed(3)})`
            : 'Context Focus excerpt',
        },
        renderedContent
      );
    }

    return React.createElement(React.Fragment, { key: idx }, renderedContent);
  });
}
