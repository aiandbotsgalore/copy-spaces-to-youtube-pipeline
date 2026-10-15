/**
 * utils/quoteExtractor.ts
 *
 * Extracts ordered target quotes from free-form user prompts.
 * Supports:
 *  - Standard double and single quotation marks ("...", '...')
 *  - Typographic / curly / smart quotes (“...”, ‘...’, «...»)
 *  - Bulleted lines (- ..., * ..., • ...)
 *  - Numbered lists (1. ..., 2) ...)
 */

export interface ExtractedQuote {
  rawText: string;
  cleanText: string;
  orderIndex: number;
}

const COMMAND_PREFIXES = [
  /^build\s+(?:a\s+)?montage\s+(?:using|with|from)\s+(?:these\s+)?(?:quotes|clips)?:?\s*/i,
  /^create\s+(?:a\s+)?montage\s+(?:using|with|from)\s+(?:these\s+)?(?:quotes|clips)?:?\s*/i,
  /^make\s+(?:a\s+)?montage\s+(?:using|with|from)\s+(?:these\s+)?(?:quotes|clips)?:?\s*/i,
  /^assemble\s+(?:a\s+)?montage\s+(?:using|with|from)\s+(?:these\s+)?(?:quotes|clips)?:?\s*/i,
  /^use\s+(?:these\s+)?quotes?:?\s*/i,
  /^quotes?:?\s*/i,
];

export function cleanQuoteText(str: string): string {
  let cleaned = str.trim();
  // Strip outer quotation marks
  cleaned = cleaned.replace(/^[\"“'‘«\s]+|[\"”'’»\s]+$/g, '').trim();
  return cleaned;
}

export function isExactQuotesPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;

  // Check for command intent
  for (const rx of COMMAND_PREFIXES) {
    if (rx.test(trimmed)) return true;
  }

  // Count quoted strings (standard or smart quotes)
  const quoteMatches = trimmed.match(/[\"“«][^\"”»\n]+[\"”»]/g);
  if (quoteMatches && quoteMatches.length >= 2) return true;

  // Count bulleted lines
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bulletLines = lines.filter(l => /^(?:[-*•]|\d+[\.)])\s+/.test(l));
  if (bulletLines.length >= 2) return true;

  return false;
}

export function extractQuotesFromPrompt(prompt: string): ExtractedQuote[] {
  let text = prompt.trim();
  if (!text) return [];

  // Strip leading command wrapper if present
  for (const rx of COMMAND_PREFIXES) {
    if (rx.test(text)) {
      text = text.replace(rx, '').trim();
      break;
    }
  }

  const quotes: ExtractedQuote[] = [];

  // 1. Try matching quotes inside quotation marks (including smart typographic quotes)
  // Handles quotes that may be back-to-back: "Quote 1""Quote 2" or “Quote 1”“Quote 2”
  const quoteRegex = /[\"“«]([^\"”»\r\n]+)[\"”»]/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRegex.exec(text)) !== null) {
    const raw = match[0];
    const clean = cleanQuoteText(match[1]);
    if (clean.length > 2) {
      quotes.push({
        rawText: raw,
        cleanText: clean,
        orderIndex: quotes.length,
      });
    }
  }

  // 2. If no quotation marks matched, try bulleted or numbered lines
  if (quotes.length === 0) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      const bulletMatch = trimmed.match(/^(?:[-*•]|\d+[\.)])\s+(.+)$/);
      if (bulletMatch) {
        const clean = cleanQuoteText(bulletMatch[1]);
        if (clean.length > 2) {
          quotes.push({
            rawText: trimmed,
            cleanText: clean,
            orderIndex: quotes.length,
          });
        }
      }
    }
  }

  // 3. If still nothing and text has multiple lines, treat each non-empty line as a quote
  if (quotes.length === 0 && text.includes('\n')) {
    const lines = text.split(/\r?\n/).map(l => cleanQuoteText(l)).filter(l => l.length > 3);
    if (lines.length >= 2) {
      lines.forEach((line, idx) => {
        quotes.push({
          rawText: line,
          cleanText: line,
          orderIndex: idx,
        });
      });
    }
  }

  return quotes;
}
