/**
 * Script and Evidence upload parser for Script Studio.
 * Parses user-uploaded script files (Markdown, Plain Text, JSON) into valid Segments,
 * Scenes, and Blocks (narration, pause, music cues). Also handles evidence context documents.
 */
import type { Block, MusicCue, Scene, Segment, ScriptEvidenceDoc } from './scriptTypes';

export interface ParseScriptOptions {
  idGenerator?: (prefix: string) => string;
  defaultTitle?: string;
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
                  text: String(rawB.text || '').trim() || 'Narration.',
                  mode: rawB.mode === 'polished' ? 'polished' : 'live',
                  claims: Array.isArray(rawB.claims) ? rawB.claims : [],
                  locked: !!rawB.locked,
                  takeUrl: rawB.takeUrl,
                  takeSec: rawB.takeSec,
                  takeTextHash: rawB.takeTextHash,
                });
              } else if (rawB?.kind === 'pause') {
                blocks.push({
                  id: bId,
                  kind: 'pause',
                  sec: Math.min(30, Math.max(0.3, Number(rawB.sec) || 1)),
                  locked: !!rawB.locked,
                });
              } else if (rawB?.kind === 'music') {
                const cue: MusicCue = ['sting', 'bed_in', 'bed_out', 'transition'].includes(rawB.cue)
                  ? rawB.cue
                  : 'sting';
                blocks.push({
                  id: bId,
                  kind: 'music',
                  cue,
                  note: String(rawB.note || '').slice(0, 200),
                  locked: !!rawB.locked,
                });
              } else if (rawB?.kind === 'clip' && rawB.clipId) {
                blocks.push({
                  id: bId,
                  kind: 'clip',
                  clipId: String(rawB.clipId),
                  keptText: String(rawB.keptText || ''),
                  inSec: Number(rawB.inSec) || 0,
                  outSec: Number(rawB.outSec) || 1,
                  trimBasis: rawB.trimBasis || 'segment',
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
          text: 'Narration.',
          mode: 'live',
          claims: [],
        }],
      });
    }
    segments.push(curSeg);
    curSeg = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Empty line separates paragraphs
    if (!line) {
      flushParagraph();
      continue;
    }

    // Segment Heading (e.g., "# Act 1: The Hook" or "ACT 1: ...")
    const h1Match = /^#\s+(.+)$/.exec(line) || /^(?:ACT|PART|SEGMENT)\s+(\d+[:\s-]*.+)$/i.exec(line);
    if (h1Match) {
      flushSegment();
      curSeg = {
        id: newId('seg'),
        title: h1Match[1].trim(),
        scenes: [],
      };
      continue;
    }

    // Scene Heading (e.g., "## Scene 1: The Revelation" or "SCENE 1: ...")
    const h2Match =
      /^#{2,3}\s+(.+)$/.exec(line) ||
      /^SCENE\s+(\d+[:\s-]*.+)$/i.exec(line) ||
      /^\[Scene:?\s*(.+)\]$/i.exec(line);
    if (h2Match) {
      flushScene();
      if (!curSeg) {
        curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
      }
      curScene = {
        id: newId('sc'),
        title: h2Match[1].trim(),
        purpose: 'Narrative scene',
        blocks: [],
      };
      continue;
    }

    // Pause tag: [Pause: 1.5s]
    const pauseMatch = /^\[Pause:\s*(\d+(?:\.\d+)?)\s*s?\]$/i.exec(line);
    if (pauseMatch) {
      flushParagraph();
      if (!curSeg) curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
      if (!curScene) curScene = { id: newId('sc'), title: `Scene ${curSeg.scenes.length + 1}`, purpose: 'Narrative scene', blocks: [] };
      curScene.blocks.push({
        id: newId('b'),
        kind: 'pause',
        sec: Math.min(30, Math.max(0.3, parseFloat(pauseMatch[1]))),
      });
      continue;
    }

    // Music cue tag: [Music: sting - dramatic drum]
    const musicMatch = /^\[Music:\s*(sting|bed_in|bed_out|transition)\s*(?:[-–:]\s*(.*))?\]$/i.exec(line);
    if (musicMatch) {
      flushParagraph();
      if (!curSeg) curSeg = { id: newId('seg'), title: opts.defaultTitle || 'Act 1', scenes: [] };
      if (!curScene) curScene = { id: newId('sc'), title: `Scene ${curSeg.scenes.length + 1}`, purpose: 'Narrative scene', blocks: [] };
      const cue = musicMatch[1].toLowerCase() as MusicCue;
      curScene.blocks.push({
        id: newId('b'),
        kind: 'music',
        cue,
        note: (musicMatch[2] || '').trim(),
      });
      continue;
    }

    // Regular narration line
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
