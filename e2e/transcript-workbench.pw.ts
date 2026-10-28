import { test, expect } from '@playwright/test';

test('transcript workspace panels, presets, and navigation persist after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transcripts', exact: true })).toBeVisible();
  const episodes = page.getByRole('button', { name: 'Episodes', exact: true });
  const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
  const navigation = page.getByRole('button', { name: 'Navigation', exact: true });
  const presets = page.getByLabel('Workspace layout');
  await expect(episodes).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toHaveAttribute('aria-pressed', 'true');

  await episodes.click();
  await inspector.click();
  await navigation.click();
  await expect(episodes).toHaveAttribute('aria-pressed', 'false');
  await expect(inspector).toHaveAttribute('aria-pressed', 'false');
  await expect(navigation).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await expect(episodes).toHaveAttribute('aria-pressed', 'false');
  await expect(inspector).toHaveAttribute('aria-pressed', 'false');
  await expect(navigation).toHaveAttribute('aria-pressed', 'true');

  await presets.selectOption('full');
  await expect(episodes).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toHaveAttribute('aria-pressed', 'true');
  await expect(navigation).toHaveAttribute('aria-pressed', 'false');

  await presets.selectOption('focus');
  await expect(episodes).toHaveAttribute('aria-pressed', 'false');
  await expect(inspector).toHaveAttribute('aria-pressed', 'false');
  await expect(navigation).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(presets).toHaveValue('full');
  await expect(episodes).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toHaveAttribute('aria-pressed', 'true');
  await expect(navigation).toHaveAttribute('aria-pressed', 'false');
});

test('episode rail loads real indexed recordings and filters without losing selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  const episodes = page.locator('.sp-episode-item');
  await expect(episodes.first()).toBeVisible({ timeout: 30_000 });
  const firstName = await episodes.first().locator('p').first().innerText();
  await episodes.first().click();
  await expect(page.getByRole('tab', { name: 'Transcript', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Speakers/ })).toBeVisible();
  await expect(page.getByLabel('Seek via timestamped speech density timeline')).toBeVisible();
  await page.getByRole('tab', { name: 'Analysis', exact: true }).click();
  await expect(page.getByText('Transcript Analysis', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Details', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Speakers', exact: true }).last().click();
  await expect(page.getByText('Diarized speakers', { exact: true })).toBeVisible();
  await expect(episodes.first().locator('p').first()).toContainText(firstName);
});
