/**
 * copilotText.ts
 *
 * Text utilities for SpacePipe AI Copilot:
 * - Deterministic sanitization of leaked action code blocks and JSON artifacts.
 * - Timestamp parsing and formatting.
 */

/**
 * Strips all action-related JSON blocks, fences, XML tags, and leaked orphan fragments
 * from model responses so the user sees clean, scannable markdown prose.
 */
export function sanitizeCopilotText(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // 1. Strip fenced action blocks (```action ... ``` or ```json:action ... ```)
  text = text.replace(/```(?:action|json:action)\s*[\r\n]+[\s\S]*?[\r\n]+```/gi, '');

  // 2. Strip XML <action> ... </action> blocks
  text = text.replace(/<action>[\s\S]*?<\/action>/gi, '');

  // 3. Strip fenced json blocks that contain "action": "..."
  text = text.replace(/```(?:json)?\s*[\r\n]+\s*\{[\s\S]*?"action"\s*:[\s\S]*?\}\s*[\r\n]+```/gi, '');

  // 4. Strip unclosed fenced blocks at the end of output containing "action"
  text = text.replace(/```(?:action|json:action|json)?\s*[\r\n]+\s*\{[\s\S]*?"action"[\s\S]*$/gi, '');

  // 5. Strip any balanced { ... } object that contains "action": "..."
  text = stripBalancedActionObjects(text);

  // 6. Strip stray/orphaned JSON key-value fragments left behind by malformed outputs
  // e.g.
  //   "title": "Retry of failed ingest (Run #220)"
  //   },
  //   "explanation": "Retrying failed ingest..."
  // }
  text = stripOrphanActionFragments(text);

  // 7. Collapse excessive consecutive blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

/**
 * Scans text and strips any JSON object enclosed in { ... } where the object
 * contains an "action": "ACTION_NAME" field, respecting nested braces and quoted strings.
 */
function stripBalancedActionObjects(text: string): string {
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === '{') {
      let depth = 1;
      let j = i + 1;
      let inString = false;
      let escape = false;

      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = !inString;
        } else if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        j++;
      }

      if (depth === 0) {
        const candidate = text.slice(i, j);
        if (/"action"\s*:\s*"[A-Z0-9_]+"/i.test(candidate)) {
          // Skip this entire JSON object!
          i = j;
          // Also skip trailing whitespace/newlines after the object if followed by another newline
          while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
          if (i < text.length && text[i] === '\r') i++;
          if (i < text.length && text[i] === '\n') i++;
          continue;
        }
      }
    }

    out += text[i];
    i++;
  }

  return out;
}

/**
 * Strips orphaned JSON fragments (e.g. key-value pairs and closing braces) that appear
 * outside valid markdown or code blocks.
 */
function stripOrphanActionFragments(text: string): string {
  // Pattern matches clusters of JSON-like lines such as:
  //   "title": "..."
  //   },
  //   "explanation": "..."
  // }
  // or lone closing braces left behind
  const lines = text.split(/\r?\n/);
  const filtered: string[] = [];
  let inOrphanJson = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if line looks like an action JSON fragment key:
    const isActionKey = /^\s*"(?:title|explanation|params|action|reason|spaceUrl|queueType|workflowFile|ref|inputs|startSec|endSec|viralScore)"\s*:/.test(line);
    const isClosingBrace = /^\s*\}[\],]*\s*$/.test(line);

    if (isActionKey) {
      inOrphanJson = true;
      continue;
    }

    if (inOrphanJson) {
      if (isClosingBrace || isActionKey || /^\s*"[^"]+"\s*:\s*/.test(line) || /^\s*[\],]\s*$/.test(line)) {
        continue; // continue skipping orphan JSON lines
      } else {
        inOrphanJson = false; // exit orphan block when real text resumes
      }
    }

    // Skip stray lone closing braces on empty lines
    if (isClosingBrace && (i === 0 || i === lines.length - 1 || filtered.length === 0)) {
      continue;
    }

    filtered.push(line);
  }

  return filtered.join('\n');
}

/**
 * Converts seconds into a formatted timestamp string (MM:SS or HH:MM:SS).
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parses a timestamp string (MM:SS or HH:MM:SS) into seconds.
 */
export function parseTimestampSec(ts: string): number | null {
  const cleaned = ts.replace(/^[▶@\[\s]+|[\]\s]+$/g, '').trim();
  const parts = cleaned.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseInt(parts[1], 10);
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
  } else if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseInt(parts[2], 10);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s;
  }
  return null;
}
