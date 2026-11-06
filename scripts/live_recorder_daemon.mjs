#!/usr/bin/env node
/**
 * scripts/live_recorder_daemon.mjs
 * SpacePipe 24/7 Always-On Live Space Detection & Recording Daemon
 *
 * Runs continuously on a Vultr VPS to:
 * 1. Monitor core hosts (@AngelaMaggard3, @txrrxstrxxl, @LoganBlack, @nooneyoufollow_)
 * 2. Authenticate with X session cookies (using @Michael50466192 mutual-follow credentials)
 * 3. Detect when a Space is broadcasting live
 * 4. Immediately stream and record audio via scripts/record_live_space.sh
 * 5. Upload finished audio to GitHub Releases and trigger Kaggle transcription
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, appendFileSync } from 'fs';
import os from 'os';
import path from 'path';

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_SECS || '60', 10) * 1000;
const RAW_HANDLES = process.env.X_HANDLES || 'AngelaMaggard3,txrrxstrxxl,LoganBlack,nooneyoufollow_';
const HANDLES = RAW_HANDLES.split(',').map(h => h.trim().replace(/^@/, '')).filter(Boolean);
const TWEET_LIMIT = parseInt(process.env.TWEET_LIMIT || '15', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || 'aiandbotsgalore/copy-spaces-to-youtube-pipeline';

// Configure authenticated session if tokens provided
const authToken = process.env.X_AUTH_TOKEN || process.env.TWITTER_AUTH_TOKEN;
const csrfToken = process.env.X_CT0 || process.env.X_CSRF_TOKEN || process.env.TWITTER_CT0;

if (authToken) {
  try {
    const configDir = path.join(os.homedir(), '.xactions');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ authToken, ...(csrfToken ? { csrfToken } : {}) }, null, 2)
    );
    console.log('🔑 Authenticated X session configured for xactions (burner bot active).');
  } catch (err) {
    console.warn(`⚠️ Could not write xactions config: ${err.message}`);
  }
}

// Generate Netscape cookies.txt for yt-dlp if auth tokens are present
if (authToken && !existsSync('cookies.txt')) {
  try {
    const lines = [
      '# Netscape HTTP Cookie File',
      `.x.com\tTRUE\t/\tTRUE\t1893456000\tauth_token\t${authToken}`,
      csrfToken ? `.x.com\tTRUE\t/\tTRUE\t1893456000\tct0\t${csrfToken}` : '',
      `.twitter.com\tTRUE\t/\tTRUE\t1893456000\tauth_token\t${authToken}`,
      csrfToken ? `.twitter.com\tTRUE\t/\tTRUE\t1893456000\tct0\t${csrfToken}` : '',
    ].filter(Boolean).join('\n') + '\n';
    writeFileSync('cookies.txt', lines, 'utf-8');
    console.log('🍪 cookies.txt generated for yt-dlp authenticated streaming.');
  } catch (cErr) {
    console.warn(`⚠️ Could not write cookies.txt: ${cErr.message}`);
  }
}

const CORE_CREATORS = new Set(['loganblack', 'angelamaggard3', 'txrrxstrxxl'].map(h => h.toLowerCase()));

console.log('======================================================================');
console.log('🛰️ SpacePipe Live Recording Daemon Initialized');
console.log(`📡 Monitored Handles: ${HANDLES.map(h => '@' + h).join(', ')}`);
console.log(`⏱️ Polling Interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`📦 GitHub Repo: ${GITHUB_REPO}`);
console.log('======================================================================');

// ─── State & Helpers ──────────────────────────────────────────────────────────

const activeRecordingPids = new Map(); // spaceId -> pid
let cachedReleases = new Set();
let lastReleaseFetchTime = 0;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function refreshExistingReleases(force = false) {
  const now = Date.now();
  if (!force && now - lastReleaseFetchTime < 120000 && cachedReleases.size > 0) {
    return cachedReleases;
  }
  try {
    const raw = execSync(`gh release list --repo "${GITHUB_REPO}" --limit 500`, {
      encoding: 'utf-8',
      env: { ...process.env, GH_TOKEN: GITHUB_TOKEN }
    });
    cachedReleases = new Set(raw.split('\n').map(l => l.split('\t')[2] || l.split('\t')[0] || '').filter(Boolean));
    lastReleaseFetchTime = now;
  } catch (err) {
    console.warn(`⚠️ Could not refresh release list: ${err.message}`);
  }
  return cachedReleases;
}

function fetchTweetsForHandle(handle) {
  let tweets = [];
  try {
    const rawOutput = execSync(
      `npx -y xactions tweets ${handle} --limit ${TWEET_LIMIT} --json`,
      {
        encoding: 'utf-8',
        timeout: 45000,
        env: { ...process.env, CI: '1' }
      }
    );
    const jsonStart = rawOutput.indexOf('[');
    if (jsonStart !== -1) {
      tweets = JSON.parse(rawOutput.slice(jsonStart));
    }
  } catch (err) {
    // If authenticated session failed (e.g. cookie expired), gracefully fallback to guest mode
    try {
      const guestEnv = { ...process.env, CI: '1', HOME: '/tmp/guest_xactions' };
      delete guestEnv.X_AUTH_TOKEN;
      delete guestEnv.X_CT0;
      delete guestEnv.TWITTER_AUTH_TOKEN;
      delete guestEnv.TWITTER_CT0;

      const fallbackOutput = execSync(
        `npx -y xactions tweets ${handle} --limit ${TWEET_LIMIT} --json`,
        {
          encoding: 'utf-8',
          timeout: 45000,
          env: guestEnv
        }
      );
      const jsonStart = fallbackOutput.indexOf('[');
      if (jsonStart !== -1) {
        tweets = JSON.parse(fallbackOutput.slice(jsonStart));
        console.warn(`⚠️ @${handle}: Authenticated fetch had an issue, successfully recovered via public guest mode.`);
      }
    } catch {}
  }
  return tweets;
}

const spaceRegex = /(?:twitter\.com|x\.com)\/i\/spaces\/([a-zA-Z0-9]{12,14})/g;

function extractSpacesFromTweets(tweets, handle) {
  const discovered = new Map();
  for (const tweet of tweets) {
    const urls = tweet.urls || [];
    for (const u of urls) {
      const target = typeof u === 'string' ? u : (u.expanded_url || u.url || '');
      for (const match of target.matchAll(spaceRegex)) {
        const id = match[1];
        if (!discovered.has(id)) {
          discovered.set(id, {
            spaceId: id,
            url: `https://x.com/i/spaces/${id}`,
            tweetText: tweet.text || tweet.fullText || '',
            foundVia: handle,
          });
        }
      }
    }
    const text = tweet.fullText || tweet.text || '';
    for (const match of text.matchAll(spaceRegex)) {
      const id = match[1];
      if (!discovered.has(id)) {
        discovered.set(id, {
          spaceId: id,
          url: `https://x.com/i/spaces/${id}`,
          tweetText: text,
          foundVia: handle,
        });
      }
    }
  }
  return discovered;
}

function isAlreadyRecording(spaceId) {
  const pidFile = `/tmp/spacepipe_recording_${spaceId}.pid`;
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      if (pid && isProcessAlive(pid)) {
        return true;
      }
    } catch {}
  }
  return false;
}

// ─── Main Poll Cycle ──────────────────────────────────────────────────────────

async function pollOnce() {
  const releases = refreshExistingReleases();
  const allDiscovered = new Map();

  for (const handle of HANDLES) {
    const tweets = fetchTweetsForHandle(handle);
    const spaces = extractSpacesFromTweets(tweets, handle);
    for (const [id, spaceInfo] of spaces.entries()) {
      allDiscovered.set(id, spaceInfo);
    }
  }

  for (const [spaceId, space] of allDiscovered.entries()) {
    // 1. Skip if already archived in GitHub Releases
    const isArchived = Array.from(releases).some(tag => tag.includes(spaceId));
    if (isArchived) continue;

    // 2. Skip if already actively recording
    if (isAlreadyRecording(spaceId)) {
      // console.log(`   ⏳ Space ${spaceId} is currently being recorded.`);
      continue;
    }

    // 3. Inspect live broadcast status via yt-dlp
    let liveStatus = 'unknown';
    let uploaderId = '';
    let uploader = '';
    let title = '';
    let description = '';

    try {
      const output = execSync(
        `yt-dlp --print "%(live_status)s|||%(uploader_id)s|||%(uploader)s|||%(title)s|||%(description)s" --no-warnings "${space.url}"`,
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000, encoding: 'utf-8' }
      ).trim();
      const parts = output.split('\n').filter(Boolean).pop()?.split('|||') || [];
      liveStatus = parts[0] || 'unknown';
      uploaderId = parts[1] || '';
      uploader = parts[2] || '';
      title = parts[3] || '';
      description = parts[4] || '';
    } catch {
      continue; // Unreachable or deleted
    }

    // 4. Trigger live recording when broadcasting live
    if (liveStatus === 'is_live') {
      const uploaderIdLower = (uploaderId || '').toLowerCase().trim();
      const uploaderLower = (uploader || '').toLowerCase().trim();
      const foundViaLower = (space.foundVia || '').toLowerCase().trim();

      const isCoreHost = CORE_CREATORS.has(uploaderIdLower) || CORE_CREATORS.has(uploaderLower);
      const isFoundViaCoreFeed = CORE_CREATORS.has(foundViaLower);
      const combined = `${title} ${description} ${space.tweetText || ''}`.toLowerCase();
      const mentionsCoreCreator =
        combined.includes('logan') ||
        combined.includes('loganblack') ||
        combined.includes('@loganblack') ||
        combined.includes('angela') ||
        combined.includes('angelamaggard') ||
        combined.includes('@angelamaggard3') ||
        combined.includes('txrrxstrxxl');

      const isAllowed = isCoreHost || isFoundViaCoreFeed || mentionsCoreCreator;

      if (!isAllowed) {
        console.log(`⛔ Space ${spaceId} by @${uploaderId || uploader} not in approved circle. Skipping.`);
        continue;
      }

      console.log(`\n🔴 DETECTED LIVE BROADCAST: ${spaceId} ("${title}") by @${uploaderId || uploader}!`);
      console.log(`🚀 Spawning live stream recorder worker...`);

      mkdirSync('logs', { recursive: true });
      const logFile = path.resolve(`logs/record_${spaceId}.log`);
      const logStream = openLogFile(logFile);

      const worker = spawn(
        'bash',
        ['./scripts/record_live_space.sh', space.url, spaceId, uploaderId || uploader, title],
        {
          detached: true,
          stdio: ['ignore', logStream, logStream],
          env: { ...process.env, GITHUB_TOKEN }
        }
      );
      worker.unref();

      activeRecordingPids.set(spaceId, worker.pid);
      console.log(`✅ Worker spawned with PID ${worker.pid}. Recording live to ${logFile}\n`);
    }
  }

  console.log(`[⏱️ ${new Date().toISOString().slice(11, 19)} UTC] Scan completed. ${allDiscovered.size} space link(s) found across monitored handles.`);
}

function openLogFile(filePath) {
  try {
    appendFileSync(filePath, `=== Recording Started at ${new Date().toISOString()} ===\n`);
  } catch {}
  return openSync(filePath, 'a');
}

// ─── Run Loop ─────────────────────────────────────────────────────────────────

async function runDaemon() {
  console.log(`[*] Daemon loop running. Scanning every ${POLL_INTERVAL_MS / 1000}s...`);
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      console.warn(`[!] Daemon poll error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

runDaemon().catch(err => {
  console.error(`FATAL Daemon Crash: ${err.message}`);
  process.exit(1);
});
