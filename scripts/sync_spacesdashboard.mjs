#!/usr/bin/env node
/**
 * scripts/sync_spacesdashboard.mjs
 *
 * Automates tracking of Spaces on SpacesDashboard (spacesdashboard.com/u/AngelaMaggard3).
 * Specifically monitors the "Spoke in", "CoHosted", and "Hosted" tabs so that any Space
 * where @AngelaMaggard3 participates as a speaker is automatically detected and dispatched
 * to the ingest pipeline (GitHub Actions -> Kaggle Whisper -> Claims -> Clips).
 *
 * Resilience features:
 * - Checks existing GitHub Releases to prevent duplicate ingestion.
 * - Checks config/quarantined_spaces.json to skip permanently dead/unavailable spaces.
 * - Checks open Dead-Letter Queue (DLQ) issues to avoid retry loops on failing items.
 * - Performs pre-flight yt-dlp probe before dispatching to verify replay availability.
 * - Automatically quarantines newly discovered dead spaces (replay disabled, deleted, access denied).
 *
 * Usage:
 *   node scripts/sync_spacesdashboard.mjs [--handle AngelaMaggard3] [--limit 5] [--dry-run]
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const ARGS = process.argv.slice(2);
const HANDLE = getArg('--handle') || process.env.SPACESDASHBOARD_HANDLE || 'AngelaMaggard3';
const LIMIT = parseInt(getArg('--limit') || process.env.DISPATCH_LIMIT || '5', 10);
const DRY_RUN = ARGS.includes('--dry-run') || process.env.DRY_RUN === 'true';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const QUARANTINE_FILE = path.resolve('config/quarantined_spaces.json');

function getArg(flag) {
  const idx = ARGS.indexOf(flag);
  return idx !== -1 && ARGS[idx + 1] ? ARGS[idx + 1] : null;
}

function getExistingReleases() {
  try {
    return execSync('gh release list --limit 1000', {
      encoding: 'utf-8',
      env: { ...process.env, GITHUB_TOKEN }
    });
  } catch (err) {
    console.warn(`⚠️ Could not read release list: ${err.message}`);
    return '';
  }
}

function loadQuarantinedSpaces() {
  if (!existsSync(QUARANTINE_FILE)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(QUARANTINE_FILE, 'utf-8'));
    const list = Array.isArray(raw) ? raw : (raw.quarantined_spaces || []);
    const map = new Map();
    for (const item of list) {
      const id = item.space_id || item.spaceId;
      if (id) map.set(id, item);
    }
    return map;
  } catch (err) {
    console.warn(`⚠️ Could not parse ${QUARANTINE_FILE}: ${err.message}`);
    return new Map();
  }
}

function saveQuarantinedSpaces(map) {
  try {
    const data = {
      quarantined_spaces: Array.from(map.values())
    };
    writeFileSync(QUARANTINE_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`💾 Quarantined spaces saved to ${QUARANTINE_FILE} (${map.size} spaces).`);
  } catch (err) {
    console.warn(`⚠️ Could not save ${QUARANTINE_FILE}: ${err.message}`);
  }
}

function getOpenDlqSpaces() {
  try {
    const out = execSync(`gh issue list --label dlq-quarantine --state open --json title,body --limit 100`, {
      encoding: 'utf-8',
      env: { ...process.env, GITHUB_TOKEN }
    });
    const issues = JSON.parse(out || '[]');
    const ids = new Set();
    for (const iss of issues) {
      const text = `${iss.title} ${iss.body || ''}`;
      const matches = text.match(/[a-zA-Z0-9]{13}/g);
      if (matches) {
        matches.forEach(id => ids.add(id));
      }
    }
    return ids;
  } catch (err) {
    console.warn(`⚠️ Could not list open DLQ issues: ${err.message}`);
    return new Set();
  }
}

function probeSpace(url) {
  try {
    const output = execSync(
      `yt-dlp --print "%(live_status)s|||%(title)s" --no-warnings "${url}"`,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 25000,
        encoding: 'utf-8'
      }
    ).trim();
    const parts = output.split('\n')[0].split('|||');
    return {
      ok: true,
      liveStatus: parts[0] || 'unknown',
      title: parts[1] || ''
    };
  } catch (err) {
    const stderr = (err.stderr || err.stdout || err.message || '').toString();
    return {
      ok: false,
      error: stderr
    };
  }
}

function isPermanentFailure(errorMsg) {
  const lower = (errorMsg || '').toLowerCase();
  return (
    lower.includes('replay is disabled') ||
    lower.includes('space not found') ||
    lower.includes('denied by access control') ||
    lower.includes('this space is no longer available') ||
    lower.includes('private')
  );
}

async function scrapeSpacesDashboard() {
  console.log(`\n======================================================`);
  console.log(`[*] Scraping SpacesDashboard for @${HANDLE}...`);
  console.log(`======================================================`);

  let playwright;
  try {
    playwright = await import('playwright');
  } catch (e) {
    console.error(`[!] Playwright is required. Please run: npm install playwright`);
    process.exit(1);
  }

  const { chromium } = playwright;
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();
  const profileUrl = `https://spacesdashboard.com/u/${HANDLE}`;
  console.log(`[*] Navigating to: ${profileUrl}`);

  const discovered = new Map();

  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // List of tabs to inspect: "Spoke in", "CoHosted", "Hosted"
    const tabs = ['Spoke in', 'CoHosted', 'Hosted'];

    for (const tabName of tabs) {
      console.log(`\n[*] Inspecting tab: "${tabName}"...`);
      try {
        const tabBtn = page.locator(`button:has-text("${tabName}")`).first();
        if (await tabBtn.count() > 0) {
          await tabBtn.click({ timeout: 5000 });
          await page.waitForTimeout(3000);
        } else {
          console.log(`    Notice: Tab button "${tabName}" not found or already active.`);
        }

        // Extract Space links from page
        const extracted = await page.evaluate((currentTab) => {
          const results = [];
          const spaceRegex = /(?:spaces\/|\/space\/|^)([a-zA-Z0-9]{13})(?:[/?#]|$)/;

          // Scan all anchors first
          document.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || '';
            const m = href.match(spaceRegex);
            if (m) {
              const spaceId = m[1];
              const row = a.closest('div.flex, tr, li') || a.parentElement;
              const text = row ? row.innerText : a.innerText;
              results.push({
                spaceId,
                url: `https://x.com/i/spaces/${spaceId}`,
                rawText: text,
                tab: currentTab
              });
            }
          });

          // Also check for Play buttons with wire:click or custom attributes
          document.querySelectorAll('button, a').forEach(el => {
            const attrText = (el.getAttribute('wire:click') || '') + ' ' + (el.getAttribute('onclick') || '') + ' ' + (el.innerText || '');
            const m = attrText.match(/([a-zA-Z0-9]{13})/);
            if (m && !results.some(r => r.spaceId === m[1])) {
              results.push({
                spaceId: m[1],
                url: `https://x.com/i/spaces/${m[1]}`,
                rawText: el.innerText,
                tab: currentTab
              });
            }
          });

          return results;
        }, tabName);

        console.log(`    Found ${extracted.length} candidate entries on "${tabName}".`);
        for (const item of extracted) {
          if (!discovered.has(item.spaceId)) {
            discovered.set(item.spaceId, item);
          }
        }
      } catch (tabErr) {
        console.warn(`    ⚠️ Notice checking tab "${tabName}": ${tabErr.message}`);
      }
    }
  } catch (navErr) {
    console.error(`[!] Failed loading SpacesDashboard profile: ${navErr.message}`);
  } finally {
    await browser.close();
  }

  console.log(`\n[✓] Total unique Space IDs extracted from SpacesDashboard: ${discovered.size}`);

  const quarantinedMap = loadQuarantinedSpaces();
  const openDlqIds = getOpenDlqSpaces();
  const existingReleasesText = getExistingReleases();

  const toDispatch = [];
  const newlyQuarantined = [];
  let skippedArchived = 0;
  let skippedQuarantined = 0;
  let skippedDlq = 0;

  for (const [spaceId, info] of discovered.entries()) {
    if (existingReleasesText.includes(spaceId)) {
      skippedArchived++;
      continue;
    }
    if (quarantinedMap.has(spaceId)) {
      skippedQuarantined++;
      continue;
    }
    if (openDlqIds.has(spaceId)) {
      console.log(`⚠️ Space ${spaceId} currently has an open DLQ issue — skipping automated re-dispatch`);
      skippedDlq++;
      continue;
    }

    // Pre-flight probe before dispatching
    console.log(`\n🔎 Probing availability for ${spaceId}: ${info.url}...`);
    const probe = probeSpace(info.url);
    if (!probe.ok) {
      const firstErrorLine = probe.error.trim().split('\n')[0];
      console.warn(`   ❌ Probe failed for ${spaceId}: ${firstErrorLine}`);
      if (isPermanentFailure(probe.error)) {
        const cleanReason = firstErrorLine.replace(/^ERROR:\s*\[twitter:spaces\]\s*[a-zA-Z0-9]+\s*:\s*/, '').replace(/^ERROR:\s*/, '');
        console.log(`   🚨 Space ${spaceId} is permanently unavailable (${cleanReason}). Quarantining.`);
        const record = {
          space_id: spaceId,
          url: info.url,
          reason: cleanReason,
          quarantined_at: new Date().toISOString(),
          permanent: true
        };
        quarantinedMap.set(spaceId, record);
        newlyQuarantined.push(record);
      }
      continue;
    }

    if (probe.liveStatus === 'is_live') {
      console.log(`   🔴 Space ${spaceId} is currently BROADCASTING LIVE. Deferring until conclusion.`);
      continue;
    }
    if (probe.liveStatus === 'is_upcoming') {
      console.log(`   ⏰ Space ${spaceId} is scheduled/upcoming — skipping.`);
      continue;
    }

    console.log(`   ✅ Space ${spaceId} is verified playable ("${probe.title || 'concluded space'}"). Ready to ingest.`);
    toDispatch.push({ ...info, title: probe.title });

    if (toDispatch.length >= LIMIT) {
      console.log(`Reached dispatch limit (${LIMIT}).`);
      break;
    }
  }

  console.log(`\n📊 Status Summary:`);
  console.log(`   - Discovered: ${discovered.size}`);
  console.log(`   - Already archived: ${skippedArchived}`);
  console.log(`   - Quarantined dead spaces: ${skippedQuarantined}`);
  console.log(`   - In open DLQ: ${skippedDlq}`);
  console.log(`   - Newly quarantined: ${newlyQuarantined.length}`);
  console.log(`   - Verified candidate spaces to dispatch: ${toDispatch.length}`);

  if (newlyQuarantined.length > 0) {
    saveQuarantinedSpaces(quarantinedMap);
    try {
      execSync('git config user.name "github-actions[bot]" && git config user.email "github-actions[bot]@users.noreply.github.com"');
      execSync('git add config/quarantined_spaces.json');
      execSync('git commit -m "chore(dlq): auto-quarantine dead spaces [skip ci]" || true');
      execSync('git push || true');
    } catch (gitErr) {
      console.warn(`Notice: Could not commit updated quarantine list: ${gitErr.message}`);
    }
  }

  if (toDispatch.length === 0) {
    console.log('[✓] No new playable Spaces to ingest at this time.');
    return;
  }

  if (DRY_RUN) {
    console.log(`[✓] Dry-run enabled. Skipping ingest workflow dispatch.`);
    return;
  }

  console.log(`\n🚀 Dispatching ingest.yml for ${toDispatch.length} verified Space(s)...`);
  for (const sp of toDispatch) {
    console.log(`   Dispatching: ${sp.url} ("${sp.title || sp.spaceId}") from tab: ${sp.tab}`);
    try {
      execSync(`gh workflow run ingest.yml -f space_url="${sp.url}"`, {
        encoding: 'utf-8',
        env: { ...process.env, GITHUB_TOKEN }
      });
      console.log(`   [✓] Dispatched: ${sp.spaceId}`);
    } catch (e) {
      console.error(`   [!] Failed dispatching ${sp.spaceId}: ${e.message}`);
    }
  }

  console.log(`\n[✓] SpacesDashboard sync finished!`);
}

scrapeSpacesDashboard().catch(err => {
  console.error(`[!] Fatal error:`, err);
  process.exit(1);
});
