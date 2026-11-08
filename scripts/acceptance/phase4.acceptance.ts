/**
 * Phase 4 Acceptance Test Suite:
 * Outline, Whole-Script Draft, Scene Tools, and Voice Calibration
 *
 * Verifies all 11 acceptance criteria from docs/script-studio-plan.md:
 * 1. Exactly one drafting model call for the entire script.
 * 2. Complete coverage of all outline scenes (no silent partial drafts).
 * 3. 100% exact tape wording from resolved library references.
 * 4. 0 unverified speaker names or raw transcript labels in narration.
 * 5. 0 accidental duplicate quotes across scenes (deliberate reprises permitted if justified).
 * 6. Original audio at least 30% in tape led mode (target 35–40%).
 * 7. Estimated runtime within 15% of target runtime, properly accounting for actual tape duration.
 * 8. A scene rewrite changes only that scene's block IDs and leaves all other scenes byte-identical.
 * 9. tape_led and narration_led modes produce visibly different tape balance instructions.
 * 10. Failed drafts do not advance the project head (candidate versions saved).
 * 11. Existing projects without an Evidence Board open and save unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ProcessRunner, RunOutcome } from '../../server/scriptProviders';
import type { EvidenceBoard, ScriptProject, ScriptVersion, StyleCard } from '../../utils/scriptTypes';
import { PROMPT_VERSIONS } from '../../server/scriptPrompts';
import { STYLE_CARD_FILE, readNarrationExamples } from '../../server/scriptStyle';
import { changedPaths, md5File, REPO, removeTempRoot, startStudio, STUDIO, tempStudioRoot, treeHashes } from './helpers';

const MASTER = path.join(REPO, 'docs', 'documentary', 'data', 'angela_quotes_master.json');
const MASTER_MD5 = '3ff45f905a859d04779bc7578de2c96d';

let root = '';
let studio: Awaited<ReturnType<typeof startStudio>>;
let lastPromptUserText = '';
let lastPromptSystemText = '';
let modelCallsCount = 0;
let customModelResponse: any = null;

const testRunner: ProcessRunner = async (file, args, opts) => {
  if (args.includes('auth')) {
    return {
      code: 0,
      stdout: JSON.stringify({ authMethod: 'claude.ai' }),
      stderr: '',
      timedOut: false,
      aborted: false,
    };
  }

  modelCallsCount++;
  lastPromptUserText = opts.stdin ? opts.stdin.toString('utf8') : '';

  // Extract system prompt if passed via file
  const sysFlagIdx = args.indexOf('--system-prompt-file');
  if (sysFlagIdx !== -1 && args[sysFlagIdx + 1] && fs.existsSync(args[sysFlagIdx + 1])) {
    lastPromptSystemText = fs.readFileSync(args[sysFlagIdx + 1], 'utf8');
  }

  const output = customModelResponse || {
    scenes: [
      {
        sceneId: 'sc1',
        blocks: [
          {
            kind: 'clip',
            quoteRef: 'aq:AQ-0207',
            fn: 'establish_question',
            rationale: 'Initial framing clip',
          },
          {
            kind: 'narration',
            mode: 'polished',
            text: 'A Space on a Saturday. A Space on a Sunday. Between them, allegations echoed across dozens of speakers.',
          },
        ],
      },
      {
        sceneId: 'sc2',
        blocks: [
          {
            kind: 'narration',
            mode: 'polished',
            text: 'An unidentified speaker insisted that private screenshots were being circulated without original context.',
          },
          {
            kind: 'clip',
            quoteRef: 'aq:AQ-0210',
            fn: 'evidence',
            rationale: 'Archival tape of controversy',
          },
        ],
      },
      {
        sceneId: 'sc3',
        blocks: [
          {
            kind: 'narration',
            mode: 'polished',
            text: 'The legal threats intensified as participants debated whether defamation laws applied to recorded Spaces.',
          },
          {
            kind: 'clip',
            quoteRef: 'aq:AQ-0211',
            fn: 'close',
            rationale: 'Discussion of discovery and lawsuits',
          },
        ],
      },
    ],
  };

  return {
    code: 0,
    stdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      structured_output: output,
      usage: { input_tokens: 1500, output_tokens: 650 },
    }),
    stderr: '',
    timedOut: false,
    aborted: false,
  };
};

const PROJECT_ID = 'prj_phase4_acceptance';
let baselineVersionId = 'v_outline';

beforeAll(async () => {
  expect(md5File(MASTER)).toBe(MASTER_MD5);
  root = tempStudioRoot();
  studio = await startStudio(root, testRunner);

  // Pre-seed fresh style card so drafting does not trigger background style builds
  const narration = readNarrationExamples(root);
  const episodesRes = await studio.api('GET', '/episodes');
  const allTags = (episodesRes.json.episodes as any[] || []).map((e: any) => e.releaseTag);

  const mockCard: StyleCard = {
    promptVersion: PROMPT_VERSIONS.styleCard,
    traitsPromptVersion: PROMPT_VERSIONS.styleTraits,
    createdAt: Date.now(),
    provider: 'claude_cli',
    model: 'sonnet',
    batchProvider: 'claude_cli',
    batchModel: 'haiku',
    live: { summary: 'Logan live style', traits: [] },
    polished: { summary: 'Logan polished documentary style', traits: [] },
    avoid: ['devastating'],
    stats: {
      recordingsScanned: allTags.length,
      recordingsWithLogan: allTags.length,
      segments: 100,
      words: 50000,
      speakingMinutes: 300,
      shareOfSpeech: 0.5,
      wordsPerMinute: 140,
      turns: 200,
      meanTurnWords: 25,
      medianTurnWords: 20,
      meanSentenceWords: 12,
      shortSentenceShare: 0.2,
      questionShare: 0.1,
      fillersPer100Words: {},
      topOpeners: [],
      signaturePhrases: [],
      firstDate: null,
      lastDate: null,
    },
    sourceHash: 'test',
    narrationHash: narration.hash,
    coverage: {
      segmentsMeasured: 100,
      recordingsWithLogan: allTags.length,
      recordingsScanned: allTags.length,
      turnsRead: 200,
      recordingsRead: allTags.length,
      batches: 1,
      batchesFailed: [],
      narrationFiles: [],
      examplesDropped: 0,
      recordingTags: allTags,
    },
    text: 'Style Card: Direct, grounded, authentic documentary narration.',
  };

  fs.writeFileSync(path.join(root, '.spacepipe-studio', STYLE_CARD_FILE), JSON.stringify(mockCard, null, 2));

  // Initialize quote library in test root
  await studio.api('GET', '/library');

  // Set up test project with an outline version
  const projectDir = path.join(root, '.spacepipe-studio', 'projects', PROJECT_ID);
  fs.mkdirSync(path.join(projectDir, 'versions'), { recursive: true });

  const project: ScriptProject = {
    id: PROJECT_ID,
    title: 'Phase 4 Acceptance Documentary',
    format: 'investigative',
    thesis: 'Multispeaker Evidence Board validation in The Paper Trail',
    sourceTags: ['20260918_1AxRnZMeZNYxl'],
    targetRuntimeSec: 110,
    transcriptHashes: {},
    clips: [],
    excludedClips: [],
    speakerNames: {},
    headVersionId: baselineVersionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const outlineVersion: ScriptVersion = {
    id: baselineVersionId,
    parentId: null,
    projectId: PROJECT_ID,
    author: 'logan',
    label: 'Outline',
    createdAt: Date.now(),
    segments: [
      {
        id: 'seg1',
        title: 'Act 1: The Accusations and the Evidence',
        scenes: [
          {
            id: 'sc1',
            title: 'Scene 1: Framing the Question',
            purpose: 'Introduce the dispute and Logan framing the issue',
            blocks: [],
            suggestedClipIds: ['bq_aq_AQ-0207'],
          },
          {
            id: 'sc2',
            title: 'Scene 2: Unidentified Echoes',
            purpose: 'Examine secondhand claims from unconfirmed participants',
            blocks: [],
            suggestedClipIds: ['bq_aq_AQ-0210'],
          },
          {
            id: 'sc3',
            title: 'Scene 3: Discovery and Legal Limits',
            purpose: 'Explore the legal actions and closing takeaway',
            blocks: [],
            suggestedClipIds: ['bq_aq_AQ-0211'],
          },
        ],
      },
    ],
  };

  const board: EvidenceBoard = {
    projectId: PROJECT_ID,
    items: [
      { ref: 'aq:AQ-0207', starred: true, excluded: false, note: 'Direct reaction' },
      { ref: 'aq:AQ-0210', starred: true, excluded: false, note: 'Screenshot dispute' },
      { ref: 'aq:AQ-0211', starred: true, excluded: false, note: 'Legal threats and attorney Mast' },
    ],
    claims: [
      {
        id: 'CLM-01',
        topic: 'Screenshots',
        claim: 'Private screenshots paraded as public evidence',
        status: 'allegation',
        quotes: ['aq:AQ-0210'],
      },
    ],
    sources: [
      {
        id: 'SRC-01',
        name: 'September 18 Space Recording',
        url: 'https://x.com/i/spaces/20260918_1AxRnZMeZNYxl',
        relevance: 'Primary source recording',
      },
    ],
    tapeBalance: 'tape_led',
  };

  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  fs.writeFileSync(path.join(projectDir, 'board.json'), JSON.stringify(board, null, 2));
  fs.writeFileSync(path.join(projectDir, 'versions', `${baselineVersionId}.json`), JSON.stringify(outlineVersion, null, 2));
});

afterAll(() => {
  studio?.close();
  if (root) removeTempRoot(root);
});

describe('Phase 4 Acceptance and Verification Suite', () => {
  it('Criterion 1: makes exactly one drafting model call for the entire script', async () => {
    modelCallsCount = 0;
    const r = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    if (r.status !== 200) {
      console.error('Draft failed with:', r.status, JSON.stringify(r.json));
    }
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(modelCallsCount, 'Drafting must make exactly 1 model call across all scenes').toBe(1);
    expect(r.json.candidate).toBe(true);
  });

  it('Criterion 2: provides complete coverage of all outline scenes (no silent partial drafts)', async () => {
    // 1. Verify successful candidate covers all 3 scenes
    const r = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(r.status).toBe(200);
    const version = r.json.version as ScriptVersion;
    const sceneIds = version.segments.flatMap(s => s.scenes.map(sc => sc.id));
    expect(sceneIds).toEqual(['sc1', 'sc2', 'sc3']);

    // 2. Verify truncation / partial response detection rejects missing scenes
    customModelResponse = {
      scenes: [
        {
          sceneId: 'sc1',
          blocks: [{ kind: 'narration', mode: 'polished', text: 'Incomplete draft test.' }],
        },
      ],
    };

    const failRes = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(failRes.status).toBe(500);
    expect(failRes.json.message || failRes.json.error).toMatch(/missing scenes sc2, sc3/i);

    // Reset custom model response
    customModelResponse = null;
  });

  it('Criterion 3: guarantees 100% exact tape wording from resolved library references', async () => {
    // Model returns a clip with quoteRef and altered keptText; engine must enforce verified verbatim text
    customModelResponse = {
      scenes: [
        {
          sceneId: 'sc1',
          blocks: [
            {
              kind: 'clip',
              quoteRef: 'aq:AQ-0207',
              keptText: 'Altered, paraphrased, or hallucinated tape text.',
              fn: 'evidence',
              rationale: 'testing verbatim override',
            },
          ],
        },
        {
          sceneId: 'sc2',
          blocks: [
            {
              kind: 'clip',
              quoteRef: 'aq:AQ-0210',
              keptText: 'Another altered text snippet.',
              fn: 'evidence',
              rationale: 'testing verbatim override 2',
            },
          ],
        },
        {
          sceneId: 'sc3',
          blocks: [
            {
              kind: 'clip',
              quoteRef: 'aq:AQ-0211',
              keptText: 'Third altered text snippet.',
              fn: 'evidence',
              rationale: 'testing verbatim override 3',
            },
          ],
        },
      ],
    };

    const r = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(r.status).toBe(200);
    const version = r.json.version as ScriptVersion;

    // Check project clips injected into project
    const projectRes = await studio.api('GET', `/project?id=${PROJECT_ID}`);
    const clips = projectRes.json.project.clips as any[];

    for (const sc of version.segments.flatMap(s => s.scenes)) {
      const clipBlock = sc.blocks.find(b => b.kind === 'clip');
      expect(clipBlock).toBeDefined();
      const resolvedClip = clips.find(c => c.clipId === clipBlock.clipId);
      expect(resolvedClip).toBeDefined();

      // The block's keptText must match the library verified verbatim text, NEVER the altered model string
      expect(clipBlock.keptText).toBe(resolvedClip.text);
      expect(clipBlock.keptText).not.toContain('Altered');
      expect(clipBlock.keptText).not.toContain('hallucinated');
    }

    customModelResponse = null;
  });

  it('Criterion 4: rejects raw diarization labels and enforces unverified speaker protection', async () => {
    // Model returns narration referencing "Speaker 1"
    customModelResponse = {
      scenes: [
        {
          sceneId: 'sc1',
          blocks: [
            {
              kind: 'narration',
              mode: 'polished',
              text: 'As Speaker 1 explained in the space, the screenshots were cropped.',
            },
            {
              kind: 'clip',
              quoteRef: 'aq:AQ-0207',
              fn: 'evidence',
              rationale: 'tape 1',
            },
          ],
        },
        {
          sceneId: 'sc2',
          blocks: [
            {
              kind: 'clip',
              quoteRef: 'aq:AQ-0210',
              fn: 'evidence',
              rationale: 'tape 2',
            },
          ],
        },
        {
          sceneId: 'sc3',
          blocks: [
            {
              kind: 'clip',
              quoteRef: 'aq:AQ-0211',
              fn: 'evidence',
              rationale: 'tape 3',
            },
          ],
        },
      ],
    };

    const r = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(r.status).toBe(200);
    expect(r.json.gates.ok).toBe(false);
    expect(r.json.gates.failures.some((f: string) => f.includes('raw diarization label'))).toBe(true);

    customModelResponse = null;
  });

  it('Criterion 5: forbids accidental duplicate quotes across scenes, but permits justified reprises', async () => {
    // 1. Accidental duplicate without reprise justification -> gate failure
    customModelResponse = {
      scenes: [
        {
          sceneId: 'sc1',
          blocks: [
            { kind: 'clip', quoteRef: 'aq:AQ-0207', fn: 'evidence', rationale: 'first use' },
          ],
        },
        {
          sceneId: 'sc2',
          blocks: [
            { kind: 'clip', quoteRef: 'aq:AQ-0207', fn: 'evidence', rationale: 'accidental second use' },
          ],
        },
        {
          sceneId: 'sc3',
          blocks: [
            { kind: 'clip', quoteRef: 'aq:AQ-0211', fn: 'evidence', rationale: 'third scene' },
          ],
        },
      ],
    };

    const r1 = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(r1.status).toBe(200);
    expect(r1.json.gates.ok).toBe(false);
    expect(r1.json.gates.failures.some((f: string) => f.includes('Duplicate archival clip'))).toBe(true);

    // 2. Intentional reprise with isReprise and rationale -> passes hard gates with advisory warning
    customModelResponse = {
      scenes: [
        {
          sceneId: 'sc1',
          blocks: [
            { kind: 'clip', quoteRef: 'aq:AQ-0207', fn: 'evidence', rationale: 'first use' },
          ],
        },
        {
          sceneId: 'sc2',
          blocks: [
            {
              kind: 'clip',
              quoteRef: 'aq:AQ-0207',
              fn: 'evidence',
              rationale: 'intentional dramatic callback',
              isReprise: true,
              repriseRationale: 'Echoing the initial admission after the contradiction is exposed',
            },
          ],
        },
        {
          sceneId: 'sc3',
          blocks: [
            { kind: 'clip', quoteRef: 'aq:AQ-0211', fn: 'evidence', rationale: 'closing clip' },
          ],
        },
      ],
    };

    const r2 = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(r2.status).toBe(200);
    expect(r2.json.gates.ok).toBe(true);
    expect(r2.json.gates.warnings?.some((w: string) => w.includes('Editorial review advised'))).toBe(true);

    customModelResponse = null;
  });

  it('Criterion 6: achieves >= 30% original audio in tape-led mode', async () => {
    // Draft with valid clips
    const r = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(r.status).toBe(200);
    const version = r.json.version as ScriptVersion;

    const projectRes = await studio.api('GET', `/project?id=${PROJECT_ID}`);
    const clips = projectRes.json.project.clips as any[];
    const clipsById = Object.fromEntries(clips.map(c => [c.clipId, c]));

    let totalTapeSec = 0;
    let totalNarrationWords = 0;

    for (const sc of version.segments.flatMap(s => s.scenes)) {
      for (const b of sc.blocks) {
        if (b.kind === 'clip') {
          const c = clipsById[b.clipId];
          if (c) totalTapeSec += c.durationSec;
        } else if (b.kind === 'narration' && b.text) {
          totalNarrationWords += b.text.split(/\s+/).filter(Boolean).length;
        }
      }
    }

    const estNarrationSec = totalNarrationWords / 2.4;
    const estTotalSec = totalTapeSec + estNarrationSec + 9; // 3 pauses @ 3s
    const tapeShare = totalTapeSec / estTotalSec;

    expect(tapeShare, `Original audio tape share (${Math.round(tapeShare * 100)}%) should be >= 30% in tape-led mode`).toBeGreaterThanOrEqual(0.30);
  });

  it('Criterion 7: estimated runtime is within 15% of target runtime accounting for tape duration', async () => {
    const r = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(r.status).toBe(200);
    const version = r.json.version as ScriptVersion;

    const projectRes = await studio.api('GET', `/project?id=${PROJECT_ID}`);
    const clips = projectRes.json.project.clips as any[];
    const clipsById = Object.fromEntries(clips.map(c => [c.clipId, c]));

    let totalSec = 0;
    for (const sc of version.segments.flatMap(s => s.scenes)) {
      for (const b of sc.blocks) {
        if (b.kind === 'clip') {
          const c = clipsById[b.clipId];
          totalSec += c ? c.durationSec : 0;
        } else if (b.kind === 'narration') {
          const words = b.text.split(/\s+/).filter(Boolean).length;
          totalSec += words / 2.4;
        } else if (b.kind === 'pause') {
          totalSec += b.sec || 3;
        }
      }
    }

    const targetSec = projectRes.json.project.targetRuntimeSec || 110;
    const ratio = Math.abs(totalSec - targetSec) / targetSec;
    expect(ratio, `Runtime ${totalSec.toFixed(1)}s should be within 15% of target ${targetSec}s`).toBeLessThanOrEqual(0.15);
  });

  it('Criterion 8: scene rewrite modifies only target scene block IDs and leaves other scenes byte-identical', async () => {
    // 1. Generate base candidate draft
    const draftRes = await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    const draftVersion = draftRes.json.version as ScriptVersion;

    const scene1Before = draftVersion.segments[0].scenes.find(s => s.id === 'sc1');
    const scene2Before = draftVersion.segments[0].scenes.find(s => s.id === 'sc2');
    const scene3Before = draftVersion.segments[0].scenes.find(s => s.id === 'sc3');

    // 2. Perform rewrite on Scene 2
    customModelResponse = {
      blocks: [
        {
          kind: 'narration',
          mode: 'polished',
          text: 'Completely rewritten narration for scene two focusing on screenshot chain of custody.',
        },
        {
          kind: 'clip',
          quoteRef: 'aq:AQ-0210',
          fn: 'evidence',
          rationale: 're-anchored evidence tape',
        },
      ],
      summary: 'Sharpened focus on chain of custody.',
    };

    const rewriteRes = await studio.api('POST', '/scene/rewrite', {
      projectId: PROJECT_ID,
      versionId: draftVersion.id,
      sceneId: 'sc2',
      instruction: 'Sharpen chain of custody focus.',
    });

    expect(rewriteRes.status).toBe(200);
    const rewrittenVersion = rewriteRes.json.version as ScriptVersion;

    const scene1After = rewrittenVersion.segments[0].scenes.find(s => s.id === 'sc1');
    const scene2After = rewrittenVersion.segments[0].scenes.find(s => s.id === 'sc2');
    const scene3After = rewrittenVersion.segments[0].scenes.find(s => s.id === 'sc3');

    // Scene 1 and Scene 3 MUST be identical byte-for-byte / structurally
    expect(scene1After).toEqual(scene1Before);
    expect(scene3After).toEqual(scene3Before);

    // Scene 2 blocks must be modified
    expect(scene2After?.blocks[0].id).not.toBe(scene2Before?.blocks[0].id);
    expect((scene2After?.blocks[0] as any).text).toContain('screenshot chain of custody');

    customModelResponse = null;
  });

  it('Criterion 9: tape_led and narration_led modes update tape balance setting and prompt instructions', async () => {
    // Test updating to narration_led
    const r1 = await studio.api('POST', '/board/tape-balance', {
      projectId: PROJECT_ID,
      tapeBalance: 'narration_led',
    });
    expect(r1.status).toBe(200);
    expect(r1.json.board.tapeBalance).toBe('narration_led');

    // Draft with narration_led and inspect prompt passed to runner
    await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(lastPromptSystemText).toContain('Narration-led mode');

    // Test updating to tape_led
    const r2 = await studio.api('POST', '/board/tape-balance', {
      projectId: PROJECT_ID,
      tapeBalance: 'tape_led',
    });
    expect(r2.status).toBe(200);
    expect(r2.json.board.tapeBalance).toBe('tape_led');

    // Draft with tape_led and inspect prompt passed to runner
    await studio.api('POST', '/draft', { projectId: PROJECT_ID });
    expect(lastPromptSystemText).toContain('Tape-led mode');
  });

  it('Criterion 10: failed drafts do not advance project head version', async () => {
    const projectBefore = (await studio.api('GET', `/project?id=${PROJECT_ID}`)).json.project as ScriptProject;
    const initialHead = projectBefore.headVersionId;

    // Trigger a draft that fails code gates
    customModelResponse = {
      scenes: [
        {
          sceneId: 'sc1',
          blocks: [
            {
              kind: 'narration',
              mode: 'polished',
              text: 'Speaker 4 gave unverified details.', // raw diarization label fails gates
            },
          ],
        },
        {
          sceneId: 'sc2',
          blocks: [{ kind: 'narration', mode: 'polished', text: 'Clean text.' }],
        },
        {
          sceneId: 'sc3',
          blocks: [{ kind: 'narration', mode: 'polished', text: 'Clean text.' }],
        },
      ],
    };

    const r = await studio.api('POST', '/draft', { projectId: PROJECT_ID, promote: true });
    expect(r.status).toBe(200);
    expect(r.json.gates.ok).toBe(false);
    expect(r.json.headMoved).toBe(false);

    // Project head version MUST NOT have moved
    const projectAfter = (await studio.api('GET', `/project?id=${PROJECT_ID}`)).json.project as ScriptProject;
    expect(projectAfter.headVersionId).toBe(initialHead);

    // Candidate version was still saved and inspectable
    const candidateVersionId = r.json.version.id;
    const verRes = await studio.api('GET', `/project?id=${PROJECT_ID}`);
    expect(verRes.json.versions.some((v: any) => v.id === candidateVersionId)).toBe(true);

    customModelResponse = null;
  });

  it('Criterion 11: legacy projects without an Evidence Board open and save unchanged', async () => {
    // List all projects in test root
    const listRes = await studio.api('GET', '/projects');
    const existing = (listRes.json.projects as any[]).filter(p => p.id !== PROJECT_ID);

    expect(existing.length).toBeGreaterThan(0);
    const legacyProject = existing[0];

    const openRes = await studio.api('GET', `/project?id=${legacyProject.id}`);
    expect(openRes.status).toBe(200);

    if (openRes.json.head) {
      const head = openRes.json.head;
      const saveRes = await studio.api('POST', '/version', {
        projectId: legacyProject.id,
        parentId: legacyProject.headVersionId,
        segments: head.segments,
        label: 'Legacy preservation check',
      });
      expect(saveRes.status).toBe(200);
      expect(saveRes.json.ok).toBe(true);

      const reread = await studio.api('GET', `/project?id=${legacyProject.id}`);
      expect(reread.json.head.segments).toEqual(head.segments);
    }
  });
});
