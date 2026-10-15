/**
 * scripts/probe-director.mjs - Phase 0 Reconnaissance Probe
 *
 * Verifies CheaperInference gateway connectivity, model availability,
 * schema support, token parameter naming, completion latency, and catalog clip audio windows.
 *
 * NOTE: NEVER prints or logs the API key or any prefix of it.
 */

import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('====================================================');
  console.log('       PHASE 0: RECONNAISSANCE & GATEWAY PROBE       ');
  console.log('====================================================\n');

  // 1. Secrets & Env Check (Zero leak)
  const apiKey = process.env.CHEAPER_INFERENCE_API_KEY;
  const baseUrl = (process.env.CHEAPER_INFERENCE_BASE_URL || 'https://api.cheaperinference.com/v1').replace(/\/+$/, '');
  const targetModel = process.env.DIRECTOR_MODEL || 'claude-sonnet-5.5';

  if (!apiKey) {
    console.error('[-] ERROR: CHEAPER_INFERENCE_API_KEY not found in environment.');
    console.error('    Ensure .env.local exists and run with: node --env-file=.env.local scripts/probe-director.mjs');
    process.exit(1);
  }

  console.log(`[+] API Key detected: YES (Length: ${apiKey.length} chars, Redacted: [REDACTED])`);
  console.log(`[+] Base URL:        ${baseUrl}`);
  console.log(`[+] Target Model:    ${targetModel}\n`);

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'SpacePipe-DirectorProbe/1.0'
  };

  // 2. Probe /models
  console.log('--- 1. Probing GET /models ---');
  let modelsList = [];
  try {
    const modelsResp = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers
    });

    if (!modelsResp.ok) {
      console.error(`[-] /models returned status ${modelsResp.status} ${modelsResp.statusText}`);
      const errText = await modelsResp.text();
      console.error(`    Details: ${errText.slice(0, 300)}`);
    } else {
      const data = await modelsResp.json();
      modelsList = Array.isArray(data) ? data : (data.data || []);
      const modelIds = modelsList.map(m => typeof m === 'string' ? m : m.id);
      
      const hasTarget = modelIds.includes(targetModel);
      const hasSonnet5 = modelIds.includes('claude-sonnet-5');
      const hasHaiku45 = modelIds.includes('claude-haiku-4.5');
      const claudeModels = modelIds.filter(id => id.startsWith('claude-'));

      console.log(`[+] Total models available: ${modelIds.length}`);
      console.log(`[+] Contains '${targetModel}': ${hasTarget ? 'YES ✅' : 'NO ❌'}`);
      console.log(`[+] Contains 'claude-sonnet-5':    ${hasSonnet5 ? 'YES ✅' : 'NO ❌'}`);
      console.log(`[+] Contains 'claude-haiku-4.5':   ${hasHaiku45 ? 'YES ✅' : 'NO ❌'}`);
      console.log(`[+] Claude models found: ${claudeModels.join(', ') || 'None'}`);
    }
  } catch (err) {
    console.error(`[-] Error contacting /models: ${err.message}`);
  }

  // 3. Probe Completion with max_tokens vs max_completion_tokens
  console.log('\n--- 2. Probing Token Control Parameters ---');
  let acceptedTokenParam = null;

  // Test max_tokens
  try {
    const t0 = Date.now();
    const testResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        max_tokens: 10
      })
    });
    const latency = Date.now() - t0;

    if (testResp.ok) {
      acceptedTokenParam = 'max_tokens';
      console.log(`[+] 'max_tokens' accepted: YES ✅ (Latency: ${latency}ms)`);
    } else {
      const errText = await testResp.text();
      console.log(`[-] 'max_tokens' rejected (${testResp.status}): ${errText.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`[-] Error testing max_tokens: ${err.message}`);
  }

  // If max_tokens failed, test max_completion_tokens
  if (!acceptedTokenParam) {
    try {
      const t0 = Date.now();
      const testResp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
          max_completion_tokens: 10
        })
      });
      const latency = Date.now() - t0;

      if (testResp.ok) {
        acceptedTokenParam = 'max_completion_tokens';
        console.log(`[+] 'max_completion_tokens' accepted: YES ✅ (Latency: ${latency}ms)`);
      } else {
        const errText = await testResp.text();
        console.log(`[-] 'max_completion_tokens' rejected (${testResp.status}): ${errText.slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`[-] Error testing max_completion_tokens: ${err.message}`);
    }
  }

  // 4. Probe Structured Output (response_format: json_schema)
  console.log('\n--- 3. Probing response_format: json_schema ---');
  let jsonSchemaSupported = false;
  let testLatencyMs = null;

  try {
    const schemaPayload = {
      model: targetModel,
      messages: [
        { role: 'system', content: 'You are a test helper. Return JSON.' },
        { role: 'user', content: 'Return an object with ok=true.' }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'test_probe',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            },
            required: ['ok'],
            additionalProperties: false
          }
        }
      }
    };
    if (acceptedTokenParam === 'max_completion_tokens') {
      schemaPayload.max_completion_tokens = 50;
    } else {
      schemaPayload.max_tokens = 50;
    }

    const t0 = Date.now();
    const schemaResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(schemaPayload)
    });
    testLatencyMs = Date.now() - t0;

    if (schemaResp.ok) {
      const result = await schemaResp.json();
      jsonSchemaSupported = true;
      console.log(`[+] 'response_format: json_schema' supported: YES ✅ (Latency: ${testLatencyMs}ms)`);
      console.log(`    Content: ${result.choices?.[0]?.message?.content?.trim()}`);
    } else {
      const errText = await schemaResp.text();
      console.log(`[-] 'response_format: json_schema' returned ${schemaResp.status}:`);
      console.log(`    ${errText.slice(0, 250)}`);
      console.log(`[!] Structured output fallback needed: YES (Will use prompt-enforced JSON parsing)`);
    }
  } catch (err) {
    console.log(`[-] Error probing json_schema: ${err.message}`);
  }

  // 5. Verify Section 0.3 Item 4: Catalog Clip Duration vs start_seconds
  console.log('\n--- 4. Verifying Catalog Clips Relative Duration (0.3 Item 4) ---');
  const catalogPath = path.resolve('public/clips/clips_catalog.json');
  if (fs.existsSync(catalogPath)) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    // Select 5 samples that have start_seconds > 600 and a download_url
    const samples = catalog
      .filter(c => c.start_seconds > 600 && c.download_url && c.duration)
      .slice(0, 5);

    console.log(`Found ${samples.length} catalog sample items for probe:`);

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      console.log(`\nSample #${i + 1}: "${s.title}"`);
      console.log(`  Catalog start_seconds: ${s.start_seconds}s (${(s.start_seconds / 60).toFixed(1)}m)`);
      console.log(`  Catalog end_seconds:   ${s.end_seconds}s`);
      console.log(`  Catalog duration:      ${s.duration}s`);
      console.log(`  URL:                   ${s.download_url}`);

      try {
        // Probe first 2048 bytes of the asset to inspect file size / range response
        const headResp = await fetch(s.download_url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'SpacePipe-Probe' },
          redirect: 'follow'
        });

        const contentLength = headResp.headers.get('content-length');
        const acceptRanges = headResp.headers.get('accept-ranges');
        const contentType = headResp.headers.get('content-type');

        console.log(`  HEAD Status: ${headResp.status} | Content-Type: ${contentType} | Size: ${contentLength ? (parseInt(contentLength, 10) / 1024).toFixed(1) + ' KB' : 'Unknown'}`);

        if (contentLength) {
          const bytes = parseInt(contentLength, 10);
          // For MP3 audio around 128-192 kbps: 60s is approx 1 MB - 1.5 MB.
          // A full 2-hour Space is 150 MB - 300 MB.
          const approxMb = bytes / (1024 * 1024);
          if (approxMb < 15.0) {
            console.log(`  -> ASSET IS PRE-CUT SLICE: Size is ${approxMb.toFixed(2)} MB, matching duration ~${s.duration}s.`);
            console.log(`  -> CONFIRMED BUG in current code: Seeking audio to ${s.start_seconds}s will exceed file length!`);
          } else {
            console.log(`  -> ASSET IS FULL EPISODE: Size is ${approxMb.toFixed(2)} MB.`);
          }
        }
      } catch (err) {
        console.log(`  Fetch error: ${err.message}`);
      }
    }
  } else {
    console.log('[-] Catalog file not found at public/clips/clips_catalog.json');
  }

  console.log('\n====================================================');
  console.log('             PHASE 0 RECON COMPLETE                  ');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});
