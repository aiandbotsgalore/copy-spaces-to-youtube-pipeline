import fs from 'node:fs';
import path from 'node:path';
import { parseTranscriptJson, chunkUtterances, utteranceLine, type Utterance } from '../server/scriptData';
import { analysisPrompt, ANALYSIS_SCHEMA } from '../server/scriptPrompts';
import { createInceptionAdapter, type Budget } from '../server/scriptProviders';

async function runEvaluation() {
  console.log('=== Inception Labs Mercury-3 Real Transcript POC Evaluation ===\n');

  // 1. Read environment and configuration
  let apiKey = process.env.INCEPTION_API_KEY;
  if (!apiKey && fs.existsSync('.env.local')) {
    const envLocal = fs.readFileSync('.env.local', 'utf8');
    const match = /^INCEPTION_API_KEY=(.+)$/m.exec(envLocal);
    if (match) apiKey = match[1].trim();
  }

  if (!apiKey) {
    console.error('ERROR: No INCEPTION_API_KEY found.');
    process.exit(1);
  }

  const env = () => ({ INCEPTION_API_KEY: apiKey });
  const budget: Budget = { maxUsd: 10.0, spentUsd: 0.0 };

  // 2. Load Real Transcript (1h 51m Twitter Space)
  const transcriptPath = path.resolve('transcripts/20260826_1AxRnZYBVdrxl.json');
  console.log(`Loading real transcript: ${transcriptPath}`);
  const rawJson = fs.readFileSync(transcriptPath, 'utf8');
  const transcript = parseTranscriptJson(rawJson, '20260826_1AxRnZYBVdrxl');
  console.log(`Loaded ${transcript.utterances.length} utterances.`);

  const utteranceMap = new Map<string, Utterance>();
  for (const u of transcript.utterances) {
    utteranceMap.set(u.id, u);
  }

  // 3. Format Transcript Chunks
  const chunks = chunkUtterances(transcript.utterances, {});
  console.log(`Chunk count: ${chunks.length}`);
  const transcriptText = chunks[0]; // Full transcript fits in 1 chunk (CHUNK_MAX_TOKENS is 60k tokens, transcript is ~25k tokens)
  
  const charCount = transcriptText.length;
  const wordCount = transcriptText.split(/\s+/).length;
  const tokenEstimate = Math.ceil(charCount / 4);
  console.log(`Transcript text character count: ${charCount}`);
  console.log(`Transcript text word count: ${wordCount}`);
  console.log(`Estimated input token count (~chars / 4): ${tokenEstimate}`);

  // 4. Build Strict Analysis Prompt
  const prompt = analysisPrompt({
    releaseTag: '20260826_1AxRnZYBVdrxl',
    title: 'GOTHIC MILKSHAKE A.I. GOD SEX WAR - PANTS DOWN MICS OPEN',
    chunkIndex: 0,
    chunkCount: 1,
    lines: transcriptText,
    ledger: 'First chunk of recording; establish speakers, main debates, technical claims, and dramatic shifts.',
  });

  console.log(`\nSystem prompt length: ${prompt.system.length} chars`);
  console.log(`User prompt length: ${prompt.user.length} chars`);
  console.log(`Schema name: ${prompt.schemaName}`);

  // 5. Instantiate Mercury-3 Adapter
  const adapter = createInceptionAdapter('mercury-3', {
    env,
    budget,
  });

  const avail = await adapter.available();
  console.log(`Adapter availability: ${avail.ok} (${avail.detail})`);
  if (!avail.ok) {
    console.error('Adapter unavailable:', avail);
    process.exit(1);
  }

  // 6. Execute Live Completion
  console.log('\n--- Sending Request to Inception Labs API (mercury-3) ---');
  const startTime = Date.now();
  const res = await adapter.complete({
    role: 'analyst',
    system: prompt.system,
    user: prompt.user,
    schema: prompt.schema,
    schemaName: prompt.schemaName,
    maxTokens: prompt.maxTokens,
    timeoutMs: 180_000, // 3 minutes timeout
    signal: new AbortController().signal,
  });
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Call finished in ${elapsedSec} seconds.\n`);

  if (!res.ok) {
    console.error('Call failed:', res.code, res.message);
    if (res.rawOutput) console.error('Raw output preview:', res.rawOutput.slice(0, 500));
    process.exit(1);
  }

  // 7. Verify API Response Envelope & Model Identity
  console.log('=== Execution Performance & Token Accounting ===');
  console.log(`Provider: ${res.provider}`);
  console.log(`Model reported: ${res.model}`);
  console.log(`Execution time: ${res.durationMs} ms (${(res.durationMs / 1000).toFixed(2)} s)`);
  console.log(`Prompt Tokens: ${res.usage?.inTok}`);
  console.log(`Completion Tokens: ${res.usage?.outTok}`);
  console.log(`Calculated Cost: $${res.usage?.costUsd.toFixed(6)}`);
  console.log(`Budget spent: $${budget.spentUsd.toFixed(6)} / $${budget.maxUsd.toFixed(2)}`);

  const output = res.json as any;
  fs.writeFileSync('scripts/mercury_poc_output.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('\nSaved full output to scripts/mercury_poc_output.json');

  // 8. In-Depth Qualitative Audit
  console.log('\n=== In-Depth Qualitative Evaluation ===');
  console.log(`Ledger length: ${output.ledger?.length || 0} characters`);
  console.log(`Themes identified: ${output.themes?.length || 0}`);
  for (const t of (output.themes || [])) {
    console.log(`  - [${t.id}] ${t.label}: ${t.summary} (moments: ${t.momentIds?.join(', ')})`);
  }

  console.log(`Dynamics identified: ${output.dynamics?.length || 0}`);
  for (const d of (output.dynamics || [])) {
    console.log(`  - Speaker: ${d.speaker} | Role: ${d.role} | Stance: ${d.stance}`);
  }

  console.log(`Moments identified: ${output.moments?.length || 0}`);
  
  let totalQuotes = 0;
  let exactMatchQuotes = 0;
  let normalizedMatchQuotes = 0;
  let missingUtterances = 0;
  let speakerMismatchQuotes = 0;

  for (let i = 0; i < (output.moments || []).length; i++) {
    const m = output.moments[i];
    console.log(`\n--- Moment ${i + 1}: [${m.id}] (${m.kind}) ---`);
    console.log(`Why: ${m.why}`);
    console.log(`Speakers: ${m.speakers?.join(', ')}`);
    console.log(`Utterance IDs: ${m.utteranceIds?.join(', ')}`);

    for (const q of (m.quotes || [])) {
      totalQuotes++;
      const citedIds = q.utteranceIds || [];
      const verbatim = q.verbatim || '';

      // Verify utterance existence
      let combinedUttText = '';
      let citedSpeakers: string[] = [];
      let allExist = true;

      for (const id of citedIds) {
        const u = utteranceMap.get(id);
        if (!u) {
          allExist = false;
          missingUtterances++;
          console.warn(`  [FAIL] Utterance ID ${id} NOT FOUND in transcript!`);
        } else {
          combinedUttText += (combinedUttText ? ' ' : '') + u.text;
          if (!citedSpeakers.includes(u.speaker)) citedSpeakers.push(u.speaker);
        }
      }

      if (!allExist) continue;

      // Check speaker attribution
      const momentSpeakers = m.speakers || [];
      const speakerOverlap = citedSpeakers.some(s => momentSpeakers.includes(s));
      if (!speakerOverlap) {
        speakerMismatchQuotes++;
        console.warn(`  [WARN] Speaker attribution mismatch: Cited utterance speaker (${citedSpeakers.join(', ')}) not in moment speakers (${momentSpeakers.join(', ')})`);
      }

      // Check quote fidelity
      const normVerbatim = verbatim.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const normSource = combinedUttText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

      if (combinedUttText.includes(verbatim)) {
        exactMatchQuotes++;
        console.log(`  [EXACT QUOTE MATCH] (${citedIds.join(',')}) "${verbatim}"`);
      } else if (normSource.includes(normVerbatim)) {
        normalizedMatchQuotes++;
        console.log(`  [NORMALIZED QUOTE MATCH] (${citedIds.join(',')}) "${verbatim}"`);
      } else {
        console.warn(`  [DISCREPANCY] Verbatim quote not found in cited utterances:`);
        console.warn(`    Model quote:  "${verbatim}"`);
        console.warn(`    Actual text:  "${combinedUttText.slice(0, 150)}..."`);
      }
    }
  }

  console.log('\n=== Summary of Quote & Attribution Audit ===');
  console.log(`Total quotes examined: ${totalQuotes}`);
  console.log(`Exact substring matches: ${exactMatchQuotes} / ${totalQuotes} (${totalQuotes ? ((exactMatchQuotes / totalQuotes) * 100).toFixed(1) : 0}%)`);
  console.log(`Normalized matches: ${normalizedMatchQuotes} / ${totalQuotes} (${totalQuotes ? ((normalizedMatchQuotes / totalQuotes) * 100).toFixed(1) : 0}%)`);
  console.log(`Combined quote fidelity: ${exactMatchQuotes + normalizedMatchQuotes} / ${totalQuotes} (${totalQuotes ? (((exactMatchQuotes + normalizedMatchQuotes) / totalQuotes) * 100).toFixed(1) : 0}%)`);
  console.log(`Missing/fabricated utterance IDs: ${missingUtterances}`);
  console.log(`Speaker mismatches: ${speakerMismatchQuotes}`);
  console.log(`Open questions count: ${output.openQuestions?.length || 0}`);
}

runEvaluation().catch(err => {
  console.error('Fatal error in evaluation:', err);
  process.exit(1);
});
