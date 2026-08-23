#!/usr/bin/env node
/**
 * Auto-detect newly broadcast X Spaces for a given Twitter/X handle.
 * Uses xactions (0 API keys, 0 cookies, 0 account risk) and checks against existing releases.
 */

import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, readFileSync, existsSync } from 'fs';

const HANDLE = process.env.X_HANDLE || process.env.INPUT_X_HANDLE || 'LoganBlack';
const TWEET_LIMIT = parseInt(process.env.TWEET_LIMIT || process.env.INPUT_LIMIT || '15', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

console.log(`🔍 Checking @${HANDLE} for new Twitter/X Spaces (scanning last ${TWEET_LIMIT} tweets)...`);

async function run() {
  let tweets = [];
  try {
    const rawOutput = execSync(`npx -y xactions tweets ${HANDLE} --limit ${TWEET_LIMIT} --json`, {
      encoding: 'utf-8',
      timeout: 60000,
      env: { ...process.env, CI: '1' }
    });

    const jsonStart = rawOutput.indexOf('[');
    if (jsonStart !== -1) {
      tweets = JSON.parse(rawOutput.slice(jsonStart));
    }
  } catch (err) {
    console.warn(`⚠️ Warning: Failed to fetch tweets via xactions: ${err.message}`);
    process.exit(0); // Non-fatal so scheduled workflow stays clean
  }

  if (!tweets || tweets.length === 0) {
    console.log('No recent tweets returned.');
    process.exit(0);
  }

  // 1. Extract Space IDs from URLs and text
  const discoveredSpaces = new Map(); // spaceId -> { spaceId, url, tweetUrl, tweetText, timestamp }
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
            createdAt: tweet.timeParsed || ''
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
          createdAt: tweet.timeParsed || ''
        });
      }
    }
  }

  console.log(`📡 Discovered ${discoveredSpaces.size} Space ID(s) in recent tweets.`);
  if (discoveredSpaces.size === 0) {
    console.log('No active or recent Space links found in latest tweets.');
    recordStepSummary(HANDLE, [], []);
    process.exit(0);
  }

  // 2. Fetch existing releases to prevent duplicate ingestion
  let existingReleasesText = '';
  try {
    existingReleasesText = execSync('gh release list --limit 1000', {
      encoding: 'utf-8',
      env: { ...process.env, GITHUB_TOKEN }
    });
  } catch (err) {
    console.warn(`Could not read release list via gh cli: ${err.message}`);
  }

  const newSpaces = [];
  const alreadyArchivedSpaces = [];

  for (const [spaceId, spaceInfo] of discoveredSpaces.entries()) {
    if (existingReleasesText.includes(spaceId)) {
      alreadyArchivedSpaces.push(spaceInfo);
      console.log(`✓ Space ${spaceId} is already archived in releases.`);
    } else {
      newSpaces.push(spaceInfo);
      console.log(`⭐ Found NEW Space: ${spaceInfo.url}`);
    }
  }

  if (newSpaces.length === 0) {
    console.log('All discovered Spaces are already archived.');
    recordStepSummary(HANDLE, [], alreadyArchivedSpaces, []);
    process.exit(0);
  }

  // 3. Trigger ingestion for new spaces via space_queue.txt commit
  // If multiple new spaces are found, enqueue the latest into space_queue.txt and rest into batch_queue.txt
  const primarySpace = newSpaces[0];
  const additionalSpaces = newSpaces.slice(1);
  const dispatched = [];

  try {
    // Write primary space to space_queue.txt to trigger ingest.yml
    writeFileSync('space_queue.txt', `${primarySpace.url}\n`, 'utf-8');
    dispatched.push(primarySpace);
    console.log(`🚀 Queued primary Space into space_queue.txt: ${primarySpace.url}`);

    // If there are additional new spaces, append to batch_queue.txt
    if (additionalSpaces.length > 0) {
      for (const extra of additionalSpaces) {
        appendFileSync('batch_queue.txt', `${extra.url}\n`, 'utf-8');
        dispatched.push(extra);
        console.log(`📥 Queued additional Space into batch_queue.txt: ${extra.url}`);
      }
    }

    execSync('git config user.name "github-actions[bot]"', { stdio: 'inherit' });
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { stdio: 'inherit' });
    execSync('git add space_queue.txt batch_queue.txt', { stdio: 'inherit' });
    execSync(`git commit -m "chore(auto-detect): enqueue Space ${primarySpace.spaceId} for ingestion"`, { stdio: 'inherit' });
    execSync('git push origin master', { stdio: 'inherit' });

    console.log(`✅ Successfully pushed queue update to trigger ingest pipeline!`);
  } catch (queueErr) {
    console.error(`❌ Failed to commit space queue update: ${queueErr.message}`);
  }

  recordStepSummary(HANDLE, newSpaces, alreadyArchivedSpaces, dispatched);
  console.log(`✨ Done. Queued ${dispatched.length} new Space(s).`);
}

function recordStepSummary(handle, newSpaces, archivedSpaces, dispatched = []) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const lines = [
    `# 🛰️ SpacePipe Auto-Detection for @${handle}`,
    '',
    `- **Timestamp:** ${new Date().toISOString()}`,
    `- **New Spaces Dispatched:** ${dispatched.length}`,
    `- **Already Archived:** ${archivedSpaces.length}`,
    ''
  ];

  if (dispatched.length > 0) {
    lines.push('## 🚀 Dispatched for Ingestion');
    for (const s of dispatched) {
      lines.push(`- **[${s.spaceId}](${s.url})** — ${s.tweetText ? s.tweetText.slice(0, 80) + '…' : 'No description'}`);
    }
    lines.push('');
  }

  if (archivedSpaces.length > 0) {
    lines.push('## 📦 Recently Verified (Already Archived)');
    for (const s of archivedSpaces.slice(0, 5)) {
      lines.push(`- \`${s.spaceId}\` (${s.url})`);
    }
    lines.push('');
  }

  try {
    writeFileSync(summaryFile, lines.join('\n'), { encoding: 'utf-8', flag: 'a' });
  } catch {}
}

run();
