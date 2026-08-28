#!/usr/bin/env node
/**
 * Auto-detect newly broadcast X Spaces for one or more Twitter/X handles.
 * Uses xactions (0 API keys, 0 cookies, 0 account risk) and checks against existing releases.
 *
 * Environment variables:
 *   X_HANDLES   — comma-separated list of handles to scan (no @), e.g. "LoganBlack,ShaneB_Official"
 *   X_HANDLE    — single handle fallback (legacy, still supported)
 *   TWEET_LIMIT — number of recent tweets to scan per handle (default 20)
 *   GITHUB_TOKEN
 *   GITHUB_REPOSITORY
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const RAW_HANDLES = process.env.X_HANDLES || process.env.X_HANDLE || process.env.INPUT_X_HANDLE || 'LoganBlack';
const HANDLES = RAW_HANDLES.split(',').map(h => h.trim()).filter(Boolean);
const TWEET_LIMIT = parseInt(process.env.TWEET_LIMIT || process.env.INPUT_LIMIT || '20', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

console.log(`🔍 Monitoring ${HANDLES.length} handle(s): ${HANDLES.map(h => '@' + h).join(', ')}`);
console.log(`   Scanning last ${TWEET_LIMIT} tweets per handle...`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fetchTweetsForHandle(handle) {
  try {
    const rawOutput = execSync(
      `npx -y xactions tweets ${handle} --limit ${TWEET_LIMIT} --json`,
      {
        encoding: 'utf-8',
        timeout: 60000,
        env: { ...process.env, CI: '1' }
      }
    );
    const jsonStart = rawOutput.indexOf('[');
    if (jsonStart === -1) {
      console.warn(`⚠️  @${handle}: xactions returned no JSON array. Raw output: ${rawOutput.slice(0, 200)}`);
      return [];
    }
    const tweets = JSON.parse(rawOutput.slice(jsonStart));
    console.log(`   @${handle}: fetched ${tweets.length} tweets`);
    return tweets;
  } catch (err) {
    // Surface the error clearly — don't silently pass
    console.error(`❌ @${handle}: xactions failed — ${err.message}`);
    console.error(`   This may mean xactions is broken for this handle, or X rate-limited the request.`);
    console.error(`   The workflow will continue but this handle was NOT checked.`);
    return null; // null = fetch failed (distinguish from empty array = no tweets)
  }
}

function extractSpaceIds(tweets, handle) {
  const discoveredSpaces = new Map();
  const spaceRegex = /spaces\/([a-zA-Z0-9]{13})/g;

  for (const tweet of tweets) {
    const urls = tweet.urls || [];
    for (const url of urls) {
      const match = url.match(/spaces\/([a-zA-Z0-9]{13})/);
      if (match) {
        const id = match[1];
        if (!discoveredSpaces.has(id)) {
          discoveredSpaces.set(id, {
            spaceId: id,
            url: `https://x.com/i/spaces/${id}`,
            tweetUrl: tweet.permanentUrl || '',
            tweetText: tweet.text || '',
            createdAt: tweet.timeParsed || '',
            foundVia: handle,
          });
        }
      }
    }

    const text = tweet.fullText || tweet.text || '';
    for (const match of text.matchAll(spaceRegex)) {
      const id = match[1];
      if (!discoveredSpaces.has(id)) {
        discoveredSpaces.set(id, {
          spaceId: id,
          url: `https://x.com/i/spaces/${id}`,
          tweetUrl: tweet.permanentUrl || '',
          tweetText: text,
          createdAt: tweet.timeParsed || '',
          foundVia: handle,
        });
      }
    }
  }
  return discoveredSpaces;
}

function getExistingReleases() {
  try {
    return execSync('gh release list --limit 1000', {
      encoding: 'utf-8',
      env: { ...process.env, GITHUB_TOKEN }
    });
  } catch (err) {
    console.warn(`⚠️  Could not read release list: ${err.message}`);
    return '';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  // Collect all discovered spaces across all handles
  const allDiscovered = new Map();
  const fetchFailures = [];

  for (const handle of HANDLES) {
    console.log(`\n── Scanning @${handle} ──`);
    const tweets = fetchTweetsForHandle(handle);

    if (tweets === null) {
      // Fetch completely failed for this handle
      fetchFailures.push(handle);
      continue;
    }
    if (tweets.length === 0) {
      console.log(`   @${handle}: no tweets returned (handle may be private or protected)`);
      continue;
    }

    const spaces = extractSpaceIds(tweets, handle);
    console.log(`   @${handle}: found ${spaces.size} Space ID(s) in tweets`);
    for (const [id, info] of spaces) {
      if (!allDiscovered.has(id)) allDiscovered.set(id, info);
    }
  }

  console.log(`\n📡 Total unique Spaces discovered across all handles: ${allDiscovered.size}`);

  if (fetchFailures.length === HANDLES.length) {
    console.error(`\n🚨 ALL handle fetches failed. xactions may be broken. Exiting non-zero to flag the workflow run as failed.`);
    process.exit(1); // Make the workflow show as FAILED, not green
  }

  if (allDiscovered.size === 0) {
    console.log('No active or recent Space links found in latest tweets.');
    recordStepSummary(HANDLES, [], [], [], fetchFailures);
    process.exit(0);
  }

  // Check which ones are new
  const existingReleasesText = getExistingReleases();
  const newSpaces = [];
  const alreadyArchivedSpaces = [];

  for (const [spaceId, spaceInfo] of allDiscovered.entries()) {
    if (existingReleasesText.includes(spaceId)) {
      alreadyArchivedSpaces.push(spaceInfo);
      console.log(`✓ Space ${spaceId} already archived`);
    } else {
      newSpaces.push(spaceInfo);
      console.log(`⭐ NEW Space found via @${spaceInfo.foundVia}: ${spaceInfo.url}`);
    }
  }

  if (newSpaces.length === 0) {
    console.log('\nAll discovered Spaces are already archived. Nothing to do.');
    recordStepSummary(HANDLES, [], alreadyArchivedSpaces, [], fetchFailures);
    process.exit(0);
  }

  // Dispatch ingestion for each new, available Space
  const dispatched = [];
  const unavailableSpaces = [];

  for (const space of newSpaces) {
    console.log(`\n🔎 Checking availability: ${space.url}`);
    let isAvailable = true;
    try {
      execSync(`yt-dlp --simulate --quiet --no-warnings "${space.url}"`, {
        stdio: 'pipe',
        timeout: 25000
      });
    } catch {
      isAvailable = false;
      unavailableSpaces.push(space);
      console.log(`   ⚠️ Space ${space.spaceId} replay is unavailable or expired — skipping`);
    }

    if (isAvailable) {
      console.log(`🚀 Dispatching batch_ingest.yml for ${space.url}...`);
      try {
        execSync(`gh workflow run batch_ingest.yml -f url="${space.url}"`, {
          encoding: 'utf-8',
          env: { ...process.env, GITHUB_TOKEN }
        });
        dispatched.push(space);
        console.log(`✅ Dispatched: ${space.spaceId}`);
      } catch (dispatchErr) {
        console.error(`❌ Failed to dispatch ${space.spaceId}: ${dispatchErr.message}`);
      }
    }
  }

  recordStepSummary(HANDLES, newSpaces, alreadyArchivedSpaces, dispatched, unavailableSpaces, fetchFailures);
  console.log(`\n✨ Done. Dispatched ${dispatched.length} new Space(s).`);
}

function recordStepSummary(handles, newSpaces, archivedSpaces, dispatched = [], unavailableSpaces = [], fetchFailures = []) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const lines = [
    `# 🛰️ SpacePipe Auto-Detection`,
    '',
    `- **Handles monitored:** ${handles.map(h => `@${h}`).join(', ')}`,
    `- **Timestamp:** ${new Date().toISOString()}`,
    `- **New Spaces Dispatched:** ${dispatched.length}`,
    `- **Already Archived:** ${archivedSpaces.length}`,
    `- **Expired / Unavailable:** ${unavailableSpaces.length}`,
    `- **Fetch Failures:** ${fetchFailures.length}`,
    '',
  ];

  if (fetchFailures.length > 0) {
    lines.push('## 🚨 Fetch Failures (xactions could not read these handles)');
    for (const h of fetchFailures) {
      lines.push(`- @${h} — check xactions compatibility or X rate limiting`);
    }
    lines.push('');
  }

  if (dispatched.length > 0) {
    lines.push('## 🚀 Dispatched for Ingestion');
    for (const s of dispatched) {
      lines.push(`- **[${s.spaceId}](${s.url})** (via @${s.foundVia}) — ${s.tweetText ? s.tweetText.slice(0, 80) + '…' : 'No description'}`);
    }
    lines.push('');
  }

  if (unavailableSpaces.length > 0) {
    lines.push('## ⚠️ Unavailable (Replay Disabled or Expired)');
    for (const s of unavailableSpaces) {
      lines.push(`- \`${s.spaceId}\` — ${s.url}`);
    }
    lines.push('');
  }

  if (archivedSpaces.length > 0) {
    lines.push('## 📦 Already Archived');
    for (const s of archivedSpaces.slice(0, 5)) {
      lines.push(`- \`${s.spaceId}\` (${s.url})`);
    }
    if (archivedSpaces.length > 5) lines.push(`  *…and ${archivedSpaces.length - 5} more*`);
    lines.push('');
  }

  try {
    writeFileSync(summaryFile, lines.join('\n'), { encoding: 'utf-8', flag: 'a' });
  } catch {}
}

run();
