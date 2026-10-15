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
