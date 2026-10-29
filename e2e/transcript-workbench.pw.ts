import { test, expect } from 'playwright/test';

test('approved workspace panels, presets, and persistence survive reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transcripts', exact: true })).toBeVisible();

  const toolbar = page.locator('.sp-workspace-toolbar');
  const episodes = toolbar.getByRole('button', { name: 'Episodes', exact: true });
  const inspector = toolbar.getByRole('button', { name: 'Inspector', exact: true });
  const presets = page.getByLabel('Layout preset');
  const rail = page.locator('.sp-rail');

  await page.locator('.sp-rail-card').first().click();
  await expect(episodes).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sp-inspector')).toBeVisible();

  await inspector.click();
  await expect(inspector).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sp-inspector')).toHaveCount(0);

  const resize = page.getByRole('separator', { name: 'Resize episode browser' });
  await resize.focus();
  await page.keyboard.press('ArrowRight');
  await expect(rail).toHaveAttribute('style', /width: 305px/);

  await presets.selectOption('no-episodes');
  await expect(episodes).toHaveAttribute('aria-pressed', 'false');
  await expect(rail).toHaveCount(0);

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('spacepipe:transcripts:approved-layout:v1') || '{}'));
  expect(persisted).toMatchObject({ episodeOpen: false, inspectorOpen: true, episodeWidth: 305 });

  await page.reload();
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show episode browser' })).toBeVisible();

  await page.getByRole('button', { name: 'Show episode browser' }).click();
  await expect(rail).toHaveAttribute('style', /width: 305px/);
  await page.locator('.sp-rail-card').first().click();
  await expect(episodes).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sp-inspector')).toBeVisible();

  await toolbar.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(episodes).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toHaveAttribute('aria-pressed', 'true');
  await expect(rail).toHaveAttribute('style', /width: 285px/);
  await expect(page.locator('.sp-inspector')).toHaveAttribute('style', /width: 290px/);

  await presets.selectOption('minimal');
  await expect(episodes).toHaveAttribute('aria-pressed', 'false');
  await expect(inspector).toHaveAttribute('aria-pressed', 'false');
});

test('approved inspector modules and panels work against real indexed recordings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();

  const episodes = page.locator('.sp-rail-card');
  await expect(episodes.first()).toBeVisible({ timeout: 30_000 });
  const firstName = await episodes.first().locator('p').first().innerText();
  await episodes.first().click();

  await expect(page.locator('.sp-turn-list .sp-turn').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute('aria-selected', 'true');

  const details = page.getByRole('button', { name: 'Episode Details' });
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();

  await page.getByRole('tab', { name: 'Speakers', exact: true }).click();
  await expect(page.getByText(/diarized speakers/i)).toBeVisible();
  await page.getByRole('tab', { name: 'Details', exact: true }).click();

  page.once('dialog', dialog => dialog.accept('UAP'));
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  await expect(page.getByRole('button', { name: /^UAP/ })).toBeVisible();

  const resize = page.getByRole('separator', { name: 'Resize inspector' });
  await resize.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.sp-inspector')).toHaveAttribute('style', /width: 310px/);

  await expect(episodes.first().locator('p').first()).toContainText(firstName);
});
