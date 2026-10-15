import type { MontageClipItem } from '../contexts/MontageContext';
import type { ExtractedQuote } from './quoteExtractor';

/**
 * utils/quoteMatcher.ts
 *
 * Matches extracted quotes to available audio clips and transcript segments.
 */

export interface QuoteMatchResult {
  quote: ExtractedQuote;
  matchedClip: MontageClipItem | null;
  confidence: number; // 0..1
  matchSource: 'catalog' | 'manifest' | 'transcript' | 'none';
  matchSnippet?: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'for', 'who', 'what', 'where', 'when',
  'how', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'would', 'could', 'should',
  'said', 'just', 'like', 'man', 'people', 'they', 'them', 'then', 'there', 'some',
  'about', 'into', 'over', 'after', 'before', 'out', 'all', 'any', 'not', 'you', 'your',
  'she', 'her', 'his', 'him', 'our', 'their', 'dont', 'doesnt', 'didnt', 'wont', 'cant'
]);

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTokens(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function getSignificantTokens(str: string): string[] {
  return cleanTokens(str).filter(t => !STOP_WORDS.has(t));
}

function computeDynamicGap(text: string, isLast: boolean): number {
  if (isLast) return 0.0;
  const trimmed = text.trim();
  if (trimmed.endsWith('!')) return 0.25;
  if (trimmed.endsWith('?')) return 0.40;
  if (trimmed.endsWith('...') || trimmed.endsWith('…')) return 0.65;
  if (trimmed.endsWith('.')) return 0.45;
  return 0.35;
}

export function matchQuoteToPool(
  quote: ExtractedQuote,
  pool: MontageClipItem[],
  isLast: boolean = false
): QuoteMatchResult {
  const queryClean = quote.cleanText.toLowerCase();
  const queryNorm = normalizeText(quote.cleanText);
  const queryTokens = cleanTokens(quote.cleanText);
  const querySigTokens = getSignificantTokens(quote.cleanText);

  let bestMatch: MontageClipItem | null = null;
  let bestScore = 0;
  let bestSnippet = '';

  for (const clip of pool) {
    const clipQuote = (clip.quote || '').toLowerCase();
    const clipTitle = (clip.title || '').toLowerCase();
    const clipQuoteNorm = normalizeText(clip.quote || '');
    const clipTitleNorm = normalizeText(clip.title || '');

    // 1. Exact verbatim substring match in quote
    if (clipQuoteNorm.includes(queryNorm)) {
      bestScore = 1.0;
      bestMatch = clip;
      bestSnippet = clip.quote;
      break;
    }

    // 2. Exact substring match in title
    if (clipTitleNorm.includes(queryNorm)) {
      bestScore = 0.95;
      bestMatch = clip;
      bestSnippet = clip.title;
      break;
    }

    // 3. Reverse substring match (if quote contains the clip's title or quote)
    if (clipQuoteNorm.length > 20 && queryNorm.includes(clipQuoteNorm)) {
      const score = 0.92;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = clip;
        bestSnippet = clip.quote;
      }
    }

    // 4. Multi-word contiguous n-gram matching
    // Extract 3-word or 4-word windows from query
    if (queryTokens.length >= 3) {
      const windowSize = Math.min(4, queryTokens.length);
      let matchedNgrams = 0;
      let totalNgrams = 0;

      for (let i = 0; i <= queryTokens.length - windowSize; i++) {
        totalNgrams++;
        const ngram = queryTokens.slice(i, i + windowSize).join(' ');
        if (clipQuoteNorm.includes(ngram)) {
          matchedNgrams++;
        }
      }

      if (totalNgrams > 0 && matchedNgrams > 0) {
        const ngramRatio = matchedNgrams / totalNgrams;
        if (ngramRatio >= 0.5) {
          const score = 0.80 + (ngramRatio * 0.15);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = clip;
            bestSnippet = clip.quote;
          }
        }
      }
    }

    // 5. Significant keywords match (strict: requires >= 75% of non-stopword tokens to match)
    if (querySigTokens.length >= 2) {
      const clipSigTokens = new Set(getSignificantTokens((clip.quote || '') + ' ' + (clip.title || '')));
      let matchedSig = 0;
      for (const t of querySigTokens) {
        if (clipSigTokens.has(t)) matchedSig++;
      }

      const sigRatio = matchedSig / querySigTokens.length;
      // If query has only 2 or 3 significant words, ALL must match!
      const requiresAll = querySigTokens.length <= 3;
      const isSigMatch = requiresAll ? (matchedSig === querySigTokens.length) : (sigRatio >= 0.75);

      if (isSigMatch) {
        const score = 0.75 + (sigRatio * 0.15);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = clip;
          bestSnippet = clip.quote || clip.title;
        }
      }
    }
  }

  if (bestMatch && bestScore >= 0.78) {
    const gap = computeDynamicGap(quote.cleanText, isLast);
    const source: QuoteMatchResult['matchSource'] = bestMatch.id.startsWith('man_')
      ? 'manifest'
      : bestMatch.id.startsWith('cat_')
      ? 'catalog'
      : 'catalog';

    // Clone clip with computed gap
    const customizedClip: MontageClipItem = {
      ...bestMatch,
      gapAfterSec: gap,
      directorNote: `Exact match for: "${quote.cleanText.slice(0, 50)}..."`,
    };

    return {
      quote,
      matchedClip: customizedClip,
      confidence: bestScore,
      matchSource: source,
      matchSnippet: bestSnippet,
    };
  }

  return {
    quote,
    matchedClip: null,
    confidence: 0,
    matchSource: 'none',
  };
}

export function matchAllQuotes(
  quotes: ExtractedQuote[],
  pool: MontageClipItem[]
): QuoteMatchResult[] {
  return quotes.map((q, idx) => {
    const isLast = idx === quotes.length - 1;
    return matchQuoteToPool(q, pool, isLast);
  });
}
