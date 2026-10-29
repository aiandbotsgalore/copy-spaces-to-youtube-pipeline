/**
 * Script and Evidence upload parser for Script Studio.
 * Parses user-uploaded script files (Markdown, Plain Text, JSON) into valid Segments,
 * Scenes, and Blocks (narration, pause, music cues). Also handles evidence context documents.
 */
import type { Block, MusicCue, Scene, Segment, ScriptEvidenceDoc, StudioClip } from './scriptTypes';

export interface ParseScriptOptions {
  idGenerator?: (prefix: string) => string;
  defaultTitle?: string;
}

export interface ParsedManuscriptClip {
  clipNumber?: string;
  clipId: string;
  id?: string;
  title: string;
  spaceTitle?: string;
  speaker: string;
  time?: string;
  timestamp?: string;
  quote: string;
  date?: string;
  label?: string;
  source?: string;
  episodeStartSec?: number;
  durationSec: number;
  isInline: boolean;
}

/**
 * Canonical clip tag:
 * [CLIP #42 | Space Title, Alice 12:34 - "Quote"]
 */
export const CANONICAL_CLIP_REGEX =
  /\[CLIP #(?<id>\d+)\s*\|\s*(?<title>[^,]+),\s*(?<speaker>[^0-9]+)\s+(?<time>\d+:\d+(?::\d+)?)\s*-\s*[“"](?<quote>[^”"]+)[”"]\]/gi;

/**
 * Inline speaker quote tag:
 * [Angela 12:34 "Nobody will ever trace this back to us."]
 */
export const INLINE_QUOTE_REGEX =
  /\[(?<speaker>[^0-9]+)\s+(?<time>\d+:\d+(?::\d+)?)\s+[“"](?<quote>[^”"]+)[”"]\]/gi;

/**
 * Legacy clip tag variant with dates/asterisks:
 * [CLIP #42 | *Night Shift Space*, 2023-11-04, 02:15: Alice - "Quote"]
 */
export const LEGACY_CLIP_REGEX =
  /\[CLIP\s*#?(?<id>\d+)\s*\|\s*(?:\*(?<space>[^*]+)\*|(?<space2>[^,]+)),\s*(?<date>[^,]+),\s*(?<time>[\d:]+(?:\s*[ap]m)?):\s*(?<speaker>[^-]+)-\s*[“"](?<quote>[^”"]+)[”"]\]/gi;

export function parseTimeToSeconds(timeStr?: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(/\s*[ap]m$/i, '');
  const parts = cleaned.split(':').map(p => parseFloat(p));
  if (parts.some(p => isNaN(p))) return 0;
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 10) / 10;
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 10) / 10;
  if (parts.length === 1) return parts[0];
  return 0;
}

/**
 * Scans text and extracts all canonical and inline speaker quote tags.
 */
export function extractClipsFromText(text: string, defaultTitle = 'Archival Tape'): ParsedManuscriptClip[] {
  if (!text || typeof text !== 'string') return [];
  const results: ParsedManuscriptClip[] = [];
  const matchedSpans: [number, number][] = [];

  // 1. Match canonical tags
  const canonicalRe = new RegExp(CANONICAL_CLIP_REGEX.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = canonicalRe.exec(text)) !== null) {
    matchedSpans.push([match.index, match.index + match[0].length]);
    const g = match.groups || {};
    const id = g.id || '1';
    const title = (g.title || defaultTitle).trim();
    const speaker = (g.speaker || 'Unknown').trim();
    const time = (g.time || '').trim();
    const quote = (g.quote || '').trim();
    const wordsCount = quote.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);
    results.push({
      clipId: `clip_${id}`,
      clipNumber: id,
      title: `${title} (#${id})`,
      spaceTitle: title,
      speaker,
      time,
      quote,
      episodeStartSec: parseTimeToSeconds(time),
      durationSec,
      isInline: false,
    });
  }

  // 2. Match legacy tags (with date and asterisks)
  const legacyRe = new RegExp(LEGACY_CLIP_REGEX.source, 'gi');
  while ((match = legacyRe.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    if (matchedSpans.some(([s, e]) => !(end <= s || start >= e))) continue;
    matchedSpans.push([start, end]);
    const g = match.groups || {};
    const id = g.id || '1';
    const space = (g.space || g.space2 || defaultTitle).replace(/^\*|\*$/g, '').trim();
    const date = (g.date || '').trim();
    const time = (g.time || '').trim();
    const speaker = (g.speaker || 'Unknown').trim();
    const quote = (g.quote || '').trim();
    const wordsCount = quote.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);
    results.push({
      clipId: `clip_${id}`,
      clipNumber: id,
      title: `${space} (#${id})`,
      spaceTitle: space,
      date,
      speaker,
      time,
      quote,
      episodeStartSec: parseTimeToSeconds(time),
      durationSec,
      isInline: false,
    });
  }

  // 3. Match inline speaker quotes
  const inlineRe = new RegExp(INLINE_QUOTE_REGEX.source, 'gi');
  while ((match = inlineRe.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    if (matchedSpans.some(([s, e]) => !(end <= s || start >= e))) continue;
    matchedSpans.push([start, end]);
    const g = match.groups || {};
    const speaker = (g.speaker || 'Unknown').trim();
    if (/^CLIP\b/i.test(speaker)) continue;
    const time = (g.time || '').trim();
    const quote = (g.quote || '').trim();
    const speakerSlug = speaker.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tape';
    const timeSlug = time.replace(/[:.]/g, '_');
    const clipId = `clip_${speakerSlug}_${timeSlug}`;
    const wordsCount = quote.split(/\s+/).filter(Boolean).length;
    const durationSec = Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);
    results.push({
      clipId,
      clipNumber: `${speakerSlug}_${timeSlug}`,
      title: `${speaker} (${time})`,
      spaceTitle: defaultTitle,
      speaker,
      time,
      quote,
      episodeStartSec: parseTimeToSeconds(time),
      durationSec,
      isInline: true,
    });
  }

  return results;
}

/* ---------------------------------------------------------------------------------------------- */
/* Structured clip detection (Sync Clips)                                                          */
/* ---------------------------------------------------------------------------------------------- */

const normClipText = (v?: string) =>
  (v || '').toLowerCase().replace(/[“”"'‘’]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Stable identity for a manuscript clip: speaker + timestamp (in seconds) + quote.
 * The same line is therefore never counted twice, whether it arrived as a clip block,
 * a canonical tag, or an inline tag, and whatever clipId each form derived.
 */
export function clipDedupeKey(c: { speaker?: string; time?: string; episodeStartSec?: number; quote?: string; text?: string }): string {
  const sec = c.time ? parseTimeToSeconds(c.time) : (c.episodeStartSec ?? 0);
  return `${normClipText(c.speaker)}|${Math.round(sec || 0)}|${normClipText(c.quote ?? c.text)}`;
}

function asClipTimeString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    const t = Math.round(v);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  return undefined;
}

/** A clip block, or any clip-like item: type "clip", or speaker + time/timestamp + quote/text. */
export function isClipLike(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  const kind = String(item.kind ?? '').toLowerCase();
  const type = String(item.type ?? '').toLowerCase();
  if (kind === 'clip' || type === 'clip' || type === 'archival_clip') return true;
  const spk = item.speaker || item.quoteSpeaker || item.speakerName;
  const quote = item.keptText ?? item.quote ?? item.text;
  return !!spk && (item.time != null || item.timestamp != null) && typeof quote === 'string' && quote.trim().length > 0;
}

const CLIP_SUB_ITEM_KEYS = ['pills', 'quotes', 'clips', 'items', 'children'] as const;

export interface ClipsFromBlockOptions {
  sceneId: string;
  index: number;
  /** The project's Clip Bin, used to fill in speaker/text/start time a block does not carry itself. */
  clipsById?: Record<string, StudioClip | undefined>;
}

/**
 * Collects clips stored as structured data rather than as bracketed text.
 * The editor draws EVERY `kind: 'clip'` block as an archival clip card, so every one counts here,
 * including blocks written by the drafting engine that carry no `type` or `clipNumber`.
 * Also reads clip-like items (and clip-like sub-items in clips/quotes/pills/items/children) so that
 * `time`/`timestamp` and `quote`/`text`/`keptText` spellings all work.
 */
export function clipsFromBlock(block: unknown, opts: ClipsFromBlockOptions): ParsedManuscriptClip[] {
  const out: ParsedManuscriptClip[] = [];
  const visit = (item: any, idx: string, depth: number) => {
    if (!item || typeof item !== 'object' || depth > 3) return;
    if (isClipLike(item)) {
      const clipId = String(item.clipId || item.id || `c_${opts.sceneId}_${idx}`);
      const known = opts.clipsById?.[clipId];
      const speaker = String(item.speaker || item.quoteSpeaker || item.speakerName || known?.speaker || 'Unknown').trim() || 'Unknown';
      const time = asClipTimeString(item.time ?? item.timestamp);
      const quote = String(item.keptText ?? item.quote ?? item.text ?? known?.text ?? '').trim();
      const num = item.clipNumber ? String(item.clipNumber) : undefined;
      const span = Number(item.outSec) - Number(item.inSec);
      const words = quote.split(/\s+/).filter(Boolean).length;
      const durationSec = Number.isFinite(span) && span > 0
        ? Math.max(1.5, span)
        : Math.max(1.5, known?.durationSec ?? Math.round(((words / 155) * 60) * 10) / 10);
      const title = item.spaceTitle
        ? (num ? `${item.spaceTitle} (#${num})` : String(item.spaceTitle))
        : (known?.title || (speaker !== 'Unknown' && time ? `${speaker} (${time})` : num ? `Clip #${num}` : `Clip ${clipId}`));
      out.push({
        clipId,
        id: item.id || clipId,
        clipNumber: num,
        title,
        spaceTitle: item.spaceTitle ? String(item.spaceTitle) : undefined,
        date: item.date ? String(item.date) : undefined,
        speaker,
        time,
        timestamp: time,
        quote,
        label: item.label || `${speaker} (${time || '0:00'})`,
        source: item.source || 'manuscript_extracted',
        episodeStartSec: time ? parseTimeToSeconds(time) : known?.episodeStartSec,
        durationSec,
        isInline: false,
      });
    }
    for (const key of CLIP_SUB_ITEM_KEYS) {
      const arr = item[key];
      if (Array.isArray(arr)) arr.forEach((sub, i) => visit(sub, `${idx}_${i}`, depth + 1));
    }
  };
  visit(block, String(opts.index), 0);
  return out;
}

const defaultIdGen = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const isSafeId = (id: string) => SAFE_ID_RE.test(id);

/**
 * Parses uploaded script text (Markdown, plain text, or JSON) into validated Segments.
 */
export function parseUploadedScript(scriptText: string, opts: ParseScriptOptions = {}): Segment[] {
  const newId = opts.idGenerator || defaultIdGen;
  const trimmed = scriptText.trim();
  if (!trimmed) {
    return [{
      id: newId('seg'),
      title: opts.defaultTitle || 'Main Segment',
      scenes: [{
        id: newId('sc'),
        title: 'Scene 1',
        purpose: 'Narrative scene',
        blocks: [{
          id: newId('b'),
          kind: 'narration',
          text: 'New narration.',
          mode: 'live',
          claims: [],
        }],
      }],
    }];
  }

  // 1. Try parsing as JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const rawSegs = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.segments) ? parsed.segments : null);

      if (rawSegs && rawSegs.length > 0) {
        const idSet = new Set<string>();
        const ensureId = (rawId: unknown, prefix: string) => {
          let id = typeof rawId === 'string' && isSafeId(rawId) ? rawId : newId(prefix);
          while (idSet.has(id)) {
            id = newId(prefix);
          }
          idSet.add(id);
          return id;
        };

        const result: Segment[] = [];
        for (const rawSeg of rawSegs) {
          const segId = ensureId(rawSeg?.id, 'seg');
          const scenes: Scene[] = [];
          const rawScenes = Array.isArray(rawSeg?.scenes) ? rawSeg.scenes : [];
          for (const rawSc of rawScenes) {
            const scId = ensureId(rawSc?.id, 'sc');
            const blocks: Block[] = [];
            const rawBlocks = Array.isArray(rawSc?.blocks) ? rawSc.blocks : [];
            for (const rawB of rawBlocks) {
              const bId = ensureId(rawB?.id, 'b');
              if (rawB?.kind === 'narration') {
                blocks.push({
                  id: bId,
                  kind: 'narration',
                  type: rawB.type || (rawB.readEvidence ? 'QUOTE_READ' : 'NARRATION'),
                  text: String(rawB.text || '').trim() || 'Narration.',
                  mode: rawB.mode === 'polished' ? 'polished' : 'live',
                  claims: Array.isArray(rawB.claims) ? rawB.claims : [],
                  locked: !!rawB.locked,
                  takeUrl: rawB.takeUrl,
                  takeSec: rawB.takeSec,
                  takeTextHash: rawB.takeTextHash,
                  readEvidence: !!rawB.readEvidence,
                  quoteSpeaker: rawB.quoteSpeaker,
                  quoteMeta: rawB.quoteMeta,
                });
              } else if (rawB?.kind === 'pause') {
                blocks.push({
                  id: bId,
                  kind: 'pause',
                  type: rawB.type || 'CUE',
                  sec: Math.min(30, Math.max(0.3, Number(rawB.sec) || 1)),
                  locked: !!rawB.locked,
                  cueType: rawB.cueType || 'silence',
                  label: rawB.label,
                });
              } else if (rawB?.kind === 'music') {
                const cue: MusicCue = ['sting', 'bed_in', 'bed_out', 'transition'].includes(rawB.cue)
                  ? rawB.cue
                  : 'sting';
                blocks.push({
                  id: bId,
                  kind: 'music',
                  type: rawB.type || 'CUE',
                  cue,
                  note: String(rawB.note || '').slice(0, 200),
                  locked: !!rawB.locked,
                  cueType: 'music',
                });
              } else if (rawB?.kind === 'cue') {
                blocks.push({
                  id: bId,
                  kind: 'cue',
                  type: 'CUE',
                  cueType: rawB.cueType || 'sfx',
                  text: String(rawB.text || rawB.note || '').trim(),
                  note: String(rawB.note || rawB.text || '').trim(),
                  sec: Number.isFinite(rawB.sec) ? Number(rawB.sec) : 0,
                  locked: !!rawB.locked,
                });
              } else if (rawB?.kind === 'heading') {
                blocks.push({
                  id: bId,
                  kind: 'heading',
                  type: 'HEADING',
                  text: String(rawB.text || '').trim() || 'Heading',
                  sec: 0,
                  locked: !!rawB.locked,
                });
              } else if (rawB?.kind === 'clip' && (rawB.clipId || rawB.clipNumber)) {
                blocks.push({
                  id: bId,
                  kind: 'clip',
                  type: rawB.type || 'ARCHIVAL_CLIP',
                  clipId: String(rawB.clipId || `clip_${rawB.clipNumber}`),
                  clipNumber: rawB.clipNumber ? String(rawB.clipNumber) : undefined,
                  spaceTitle: rawB.spaceTitle,
                  date: rawB.date,
                  time: rawB.time,
                  speaker: rawB.speaker,
                  keptText: String(rawB.keptText || rawB.quote || ''),
                  inSec: Number(rawB.inSec) || 0,
                  outSec: Number(rawB.outSec) || 1,
                  trimBasis: rawB.trimBasis || 'full',
                  fn: rawB.fn || 'evidence',
                  rationale: String(rawB.rationale || ''),
                  locked: !!rawB.locked,
                });
              }
            }
            if (blocks.length === 0) {
              blocks.push({
                id: ensureId(null, 'b'),
                kind: 'narration',
                text: 'Scene narration.',
                mode: 'live',
                claims: [],
              });
            }
            scenes.push({
              id: scId,
              title: String(rawSc?.title || 'Scene').trim(),
              purpose: String(rawSc?.purpose || 'Narrative scene').trim(),
              blocks,
              suggestedClipIds: Array.isArray(rawSc?.suggestedClipIds) ? rawSc.suggestedClipIds : [],
              momentIds: Array.isArray(rawSc?.momentIds) ? rawSc.momentIds : [],
            });
          }
          if (scenes.length === 0) {
            scenes.push({
              id: ensureId(null, 'sc'),
              title: 'Scene 1',
              purpose: 'Narrative scene',
              blocks: [{
                id: ensureId(null, 'b'),
                kind: 'narration',
                text: 'Narration.',
                mode: 'live',
                claims: [],
              }],
            });
          }
          result.push({
            id: segId,
            title: String(rawSeg?.title || 'Segment').trim(),
            scenes,
          });
        }
        if (result.length > 0) return result;
      }
    } catch {
      // Fall through to plain text / markdown parsing
    }
  }

  // 2. Parse as Markdown or plain text
  const lines = scriptText.split(/\r?\n/);
  const segments: Segment[] = [];
  let curSeg: { id: string; title: string; scenes: Scene[] } | null = null;
  let curScene: { id: string; title: string; purpose: string; blocks: Block[] } | null = null;
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join('\n').trim();
    paragraphBuffer = [];
    if (!text) return;

    if (!curSeg) {
      curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
    }
    if (!curScene) {
      curScene = { id: newId('sc'), title: `Scene ${curSeg.scenes.length + 1}`, purpose: 'Narrative scene', blocks: [] };
    }

    curScene.blocks.push({
      id: newId('b'),
      kind: 'narration',
      type: 'NARRATION',
      text,
      mode: 'live',
      claims: [],
    });
  };

  const flushScene = () => {
    flushParagraph();
    if (!curScene) return;
    if (curScene.blocks.length === 0) {
      curScene.blocks.push({
        id: newId('b'),
        kind: 'narration',
        type: 'NARRATION',
        text: 'Narration.',
        mode: 'live',
        claims: [],
      });
    }
    if (!curSeg) {
      curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
    }
    curSeg.scenes.push(curScene);
    curScene = null;
  };

  const flushSegment = () => {
    flushScene();
    if (!curSeg) return;
    if (curSeg.scenes.length === 0) {
      curSeg.scenes.push({
        id: newId('sc'),
        title: 'Scene 1',
        purpose: 'Narrative scene',
        blocks: [{
          id: newId('b'),
          kind: 'narration',
          type: 'NARRATION',
          text: 'Narration.',
          mode: 'live',
          claims: [],
        }],
      });
    }
    segments.push(curSeg);
    curSeg = null;
  };

  const ensureContext = () => {
    if (!curSeg) curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
    if (!curScene) curScene = { id: newId('sc'), title: `Scene ${curSeg.scenes.length + 1}`, purpose: 'Narrative scene', blocks: [] };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Empty line separates paragraphs
    if (!line) {
      flushParagraph();
      continue;
    }

    // 1. Act / Segment Heading (e.g., "# Act 1: The Hook", "ACT I: THE HOOK", "ACT 1: ...", "PART 1: ...")
    const actMatch =
      /^#\s+(.+)$/.exec(line) ||
      /^((?:ACT|PART|SEGMENT)\s+[IVXLCDM\d]+[:\s-]*.+)$/i.exec(line) ||
      /^((?:ACT|PART|SEGMENT)\s+[IVXLCDM\d]+)$/i.exec(line);
    if (actMatch) {
      flushSegment();
      curSeg = {
        id: newId('seg'),
        title: actMatch[1].trim(),
        scenes: [],
      };
      continue;
    }

    // 2. Scene Container Headings (e.g., "## Scene 1: The Revelation", "SCENE 1", "PROLOGUE", "EPILOGUE", or "### SCENE...")
    const prologueMatch = /^PROLOGUE(?:\s*[:\s-]\s*(.*))?$/i.exec(line);
    const epilogueMatch = /^EPILOGUE(?:\s*[:\s-]\s*(.*))?$/i.exec(line);
    const h3SceneMatch = /^###\s+(?:SCENE|ACT|PROLOGUE|EPILOGUE)\b\s*(.*)$/i.exec(line);
    const sceneMatch =
      prologueMatch ? ['PROLOGUE', prologueMatch[1]?.trim() ? `Prologue: ${prologueMatch[1].trim()}` : 'Prologue'] :
      epilogueMatch ? ['EPILOGUE', epilogueMatch[1]?.trim() ? `Epilogue: ${epilogueMatch[1].trim()}` : 'Epilogue'] :
      h3SceneMatch ? ['H3SCENE', line.replace(/^###\s*/, '').trim()] :
      /^##\s+(.+)$/.exec(line) ||
      /^(SCENE\s+\d+[:\s-]*.+)$/i.exec(line) ||
      /^(SCENE\s+\d+)$/i.exec(line) ||
      /^\[Scene:?\s*(.+)\]$/i.exec(line);

    if (sceneMatch) {
      flushScene();
      if (!curSeg) {
        curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
      }
      const sceneTitle = sceneMatch[1].trim();
      curScene = {
        id: newId('sc'),
        title: sceneTitle,
        purpose: 'Narrative scene',
        blocks: [],
      };
      continue;
    }

    // 2b. Section / Scene In-line Heading (`type: "HEADING"`, lines starting with ###)
    const h3Match = /^###\s+(.+)$/.exec(line);
    if (h3Match) {
      flushParagraph();
      // If curScene has no blocks yet, name the scene after this heading; otherwise add as HEADING block
      if (!curSeg) curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
      if (!curScene) {
        curScene = { id: newId('sc'), title: h3Match[1].trim(), purpose: 'Narrative scene', blocks: [] };
      }
      curScene.blocks.push({
        id: newId('b'),
        kind: 'heading',
        type: 'HEADING',
        text: h3Match[1].trim(),
        sec: 0,
      });
      continue;
    }

    // 3. Archival Tape / Broadcast Clips (`type: "ARCHIVAL_CLIP"`)
    // Match Canonical: [CLIP #(?<id>\d+)\s*\|\s*(?<title>[^,]+),\s*(?<speaker>[^0-9]+)\s+(?<time>\d+:\d+(?::\d+)?)\s*-\s*[“"](?<quote>[^”"]+)[”"]\]
    // Match Legacy: [CLIP #42 | *Night Shift Space*, 2023-11-04, 02:15: Alice - "Quote"]
    // Match Inline quote: [(?<speaker>[A-Za-z0-9_ ]+)\s+(?<time>\d+:\d+(?::\d+)?)\s+[“"](?<quote>[^”"]+)[”"]\]
    const canonicalClipRe = new RegExp(`^${CANONICAL_CLIP_REGEX.source}$`, 'i');
    const legacyClipRe = new RegExp(`^${LEGACY_CLIP_REGEX.source}$`, 'i');
    const inlineQuoteRe = new RegExp(`^${INLINE_QUOTE_REGEX.source}$`, 'i');

    const canonicalMatch = canonicalClipRe.exec(line);
    const legacyMatch = !canonicalMatch ? (
      legacyClipRe.exec(line) ||
      /^\[CLIP\s*#?(?<id>\d+)\s*\|\s*\*(?<space>[^*]+)\*,\s*(?<date>[^,]+),\s*(?<time>[\d:]+(?:\s*[ap]m)?)\s*:\s*(?<speaker>[^-]+)-\s*[“"](?<quote>[^”"]+)[”"]\]/i.exec(line) ||
      /^\[CLIP\s*#?(?<id>\d+)\s*\|\s*\*(?<space>[^*]+)\*,\s*(?<date>[^,]+),\s*(?<time>[^:]+):\s*(?<speaker>[^-]+)-\s*[“"](?<quote>[^”"]+)[”"]\]/i.exec(line) ||
      /^\[CLIP\s*#?(?<id>\d+)\s*\|\s*(?<space>[^,]+),\s*(?<date>[^,]+),\s*(?<time>[^:]+):\s*(?<speaker>[^-]+)-\s*[“"](?<quote>[^”"]+)[”"]\]/i.exec(line)
    ) : null;
    const inlineQuoteMatch = (!canonicalMatch && !legacyMatch) ? inlineQuoteRe.exec(line) : null;

    if (canonicalMatch) {
      flushParagraph();
      ensureContext();
      const g = canonicalMatch.groups || {};
      const id = g.id || '1';
      const space = (g.title || opts.defaultTitle || 'Archival Tape').trim();
      const time = (g.time || '').trim();
      const speaker = (g.speaker || 'Unknown').trim();
      const quote = (g.quote || '').trim();
      const wordsCount = quote.split(/\s+/).filter(Boolean).length;
      const durSec = Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'clip',
        type: 'ARCHIVAL_CLIP',
        clipId: `clip_${id}`,
        clipNumber: id,
        spaceTitle: space,
        time,
        speaker,
        keptText: quote,
        inSec: 0,
        outSec: durSec,
        trimBasis: 'full',
        fn: 'evidence',
        rationale: `Archival tape clip from ${space}`,
        locked: false,
      });
      continue;
    }

    if (legacyMatch) {
      flushParagraph();
      ensureContext();
      const g = legacyMatch.groups || {};
      const id = g.id || '1';
      const space = (g.space || g.space2 || opts.defaultTitle || 'Archival Tape').replace(/^\*|\*$/g, '').trim();
      const date = (g.date || '').trim();
      const time = (g.time || '').trim();
      const speaker = (g.speaker || 'Unknown').trim();
      const quote = (g.quote || '').trim();
      const wordsCount = quote.split(/\s+/).filter(Boolean).length;
      const durSec = Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'clip',
        type: 'ARCHIVAL_CLIP',
        clipId: `clip_${id}`,
        clipNumber: id,
        spaceTitle: space,
        date,
        time,
        speaker,
        keptText: quote,
        inSec: 0,
        outSec: durSec,
        trimBasis: 'full',
        fn: 'evidence',
        rationale: `Archival tape clip from ${space || 'catalog'}`,
        locked: false,
      });
      continue;
    }

    if (inlineQuoteMatch) {
      flushParagraph();
      ensureContext();
      const g = inlineQuoteMatch.groups || {};
      const speaker = (g.speaker || 'Unknown').trim();
      const time = (g.time || '').trim();
      const quote = (g.quote || '').trim();
      const speakerSlug = speaker.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tape';
      const timeSlug = time.replace(/[:.]/g, '_');
      const clipId = `clip_${speakerSlug}_${timeSlug}`;
      const wordsCount = quote.split(/\s+/).filter(Boolean).length;
      const durSec = Math.max(1.5, Math.round(((wordsCount / 155) * 60) * 10) / 10);
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'clip',
        type: 'ARCHIVAL_CLIP',
        clipId,
        clipNumber: `${speakerSlug}_${timeSlug}`,
        spaceTitle: opts.defaultTitle || 'Archival Tape',
        time,
        speaker,
        keptText: quote,
        inSec: 0,
        outSec: durSec,
        trimBasis: 'full',
        fn: 'evidence',
        rationale: `Inline archival quote from ${speaker} (${time})`,
        locked: false,
      });
      continue;
    }

    // 4. SFX, Score, & Stage Direction (`type: "CUE"`)
    // Match: ^\[SFX:.*\]$, ^\[THEME.*\]$, ^\[beat\]$, ^\[Silence:.*\]$, or production notes like NARRATOR:, FORMAT:, AUDIO DNA:.
    const sfxMatch = /^\[SFX:?\s*(.*)\]$/i.exec(line);
    if (sfxMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'sfx',
        text: sfxMatch[1].trim(),
        note: sfxMatch[1].trim(),
        sec: 0,
      });
      continue;
    }

    const themeMatch = /^\[THEME:?\s*(.*)\]$/i.exec(line);
    if (themeMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'theme',
        text: themeMatch[1].trim(),
        note: themeMatch[1].trim(),
        sec: 0,
      });
      continue;
    }

    const beatMatch = /^\[beat\]$/i.exec(line);
    if (beatMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'beat',
        text: 'beat',
        note: '[beat]',
        sec: 0.5,
      });
      continue;
    }

    const silenceMatch = /^\[Silence:?\s*(.*)\]$/i.exec(line);
    if (silenceMatch) {
      flushParagraph();
      ensureContext();
      const raw = silenceMatch[1].trim();
      let pauseSec = 1.2;
      const beatsM = /^(\d+(?:\.\d+)?)\s*beats?$/i.exec(raw);
      const secM = /^(\d+(?:\.\d+)?)\s*s(?:ec)?$/i.exec(raw);
      if (beatsM) {
        pauseSec = Math.min(30, Math.max(0.3, parseFloat(beatsM[1]) * 0.6));
      } else if (secM) {
        pauseSec = Math.min(30, Math.max(0.3, parseFloat(secM[1])));
      } else {
        const num = parseFloat(raw);
        if (Number.isFinite(num) && num > 0) pauseSec = Math.min(30, Math.max(0.3, num));
      }
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'silence',
        text: line,
        note: `[Silence: ${pauseSec.toFixed(1)}s]`,
        sec: Math.round(pauseSec * 10) / 10,
      });
      continue;
    }

    // Pause tag: [Pause: 1.5s]
    const pauseMatch = /^\[Pause:\s*(\d+(?:\.\d+)?)\s*s?\]$/i.exec(line);
    if (pauseMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'pause',
        type: 'CUE',
        cueType: 'silence',
        sec: Math.min(30, Math.max(0.3, parseFloat(pauseMatch[1]))),
      });
      continue;
    }

    // Music cue tag: [Music: sting - dramatic drum]
    const musicMatch = /^\[Music:\s*(sting|bed_in|bed_out|transition)\s*(?:[-–:]\s*(.*))?\]$/i.exec(line);
    if (musicMatch) {
      flushParagraph();
      ensureContext();
      const cue = musicMatch[1].toLowerCase() as MusicCue;
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'music',
        type: 'CUE',
        cueType: 'music',
        cue,
        note: (musicMatch[2] || '').trim(),
      });
      continue;
    }

    // Production notes: NARRATOR:, FORMAT:, AUDIO DNA:
    const prodNoteMatch = /^(?:NARRATOR|FORMAT|AUDIO\s+DNA)\s*:\s*(.*)$/i.exec(line);
    if (prodNoteMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'cue',
        type: 'CUE',
        cueType: 'production_note',
        text: line,
        note: line,
        sec: 0,
      });
      continue;
    }

    // 5. Quoted Transcripts / Evidence Reads (`type: "QUOTE_READ"`)
    // Match: Lines prefixed with LOGAN (READING DM..., LOGAN (READING GROUP CHAT..., etc.
    const quoteReadMatch = /^LOGAN\s*\(\s*READING\b[^)]*\)\s*:?\s*(.*)$/i.exec(line) || /^LOGAN\s*\(\s*READING\b.*$/i.exec(line);
    if (quoteReadMatch) {
      flushParagraph();
      ensureContext();
      curScene!.blocks.push({
        id: newId('b'),
        kind: 'narration',
        type: 'QUOTE_READ',
        text: line,
        mode: 'live',
        claims: [],
        readEvidence: true,
      });
      continue;
    }

    // 6. Standard Narration (`type: "NARRATION"`)
    paragraphBuffer.push(line);
  }

  flushSegment();

  if (segments.length === 0) {
    segments.push({
      id: newId('seg'),
      title: opts.defaultTitle || 'Main Segment',
      scenes: [{
        id: newId('sc'),
        title: 'Scene 1',
        purpose: 'Narrative scene',
        blocks: [{
          id: newId('b'),
          kind: 'narration',
          text: trimmed,
          mode: 'live',
          claims: [],
        }],
      }],
    });
  }

  return segments;
}

/**
 * Creates a valid ScriptEvidenceDoc from text and name.
 */
export function createEvidenceDoc(
  name: string,
  content: string,
  type: ScriptEvidenceDoc['type'] = 'text',
  idGenerator?: (prefix: string) => string
): ScriptEvidenceDoc {
  const newId = idGenerator || defaultIdGen;
  return {
    id: newId('doc'),
    name: name.trim().slice(0, 100) || 'Evidence Document',
    type,
    content: content.trim(),
    addedAt: Date.now(),
    sizeBytes: new TextEncoder().encode(content).length,
  };
}
