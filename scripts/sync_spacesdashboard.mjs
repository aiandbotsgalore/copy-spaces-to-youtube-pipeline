#!/usr/bin/env node
/**
 * scripts/sync_spacesdashboard.mjs
 *
 * Automates tracking of Spaces on SpacesDashboard (spacesdashboard.com/u/AngelaMaggard3).
 * Specifically monitors the "Spoke in", "CoHosted", and "Hosted" tabs so that any Space
 * where @AngelaMaggard3 participates as a speaker is automatically detected and dispatched
 * to the ingest pipeline (GitHub Actions -> Kaggle Whisper -> Claims -> Clips).
 *
 * Usage:
 *   node scripts/sync_spacesdashboard.mjs [--handle AngelaMaggard3] [--limit 5] [--dry-run]
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import path from 'path';

const ARGS = process.argv.slice(2);
const HANDLE = getArg('--handle') || process.env.SPACESDASHBOARD_HANDLE || 'AngelaMaggard3';
const LIMIT = parseInt(getArg('--limit') || process.env.DISPATCH_LIMIT || '5', 10);
const DRY_RUN = ARGS.includes('--dry-run') || process.env.DRY_RUN === 'true';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

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
          // Look for all links or elements containing Twitter Space URLs or Space IDs
          const elements = document.querySelectorAll('a, button, div[wire\\:id]');
          
          // Regex matching standard 13-character Space IDs
          const spaceRegex = /(?:spaces\/|\/space\/|^)([a-zA-Z0-9]{13})(?:[/?#]|$)/;

          // Scan all anchors first
          document.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || '';
            const m = href.match(spaceRegex);
            if (m) {
              const spaceId = m[1];
              // Try to find row or container for title & host
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

  const existingReleasesText = getExistingReleases();
  const newSpaces = [];
  const alreadyArchived = [];

  for (const [spaceId, info] of discovered.entries()) {
    if (existingReleasesText.includes(spaceId)) {
      alreadyArchived.push(info);
    } else {
      newSpaces.push(info);
      console.log(`⭐ NEW Space found via SpacesDashboard (${info.tab}): ${info.url}`);
    }
  }

  console.log(`\n📊 Status: ${alreadyArchived.length} already archived, ${newSpaces.length} new.`);

  if (newSpaces.length === 0) {
    console.log('[✓] All Spaces on SpacesDashboard are already archived.');
    return;
  }

  if (DRY_RUN) {
    console.log(`[✓] Dry-run enabled. Skipping ingest workflow dispatch.`);
    return;
  }

  const toDispatch = newSpaces.slice(0, LIMIT);
  console.log(`\n🚀 Dispatching ingest.yml for ${toDispatch.length} new Space(s) (limit: ${LIMIT})...`);

  for (const sp of toDispatch) {
    console.log(`   Dispatching: ${sp.url} (from tab: ${sp.tab})`);
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
