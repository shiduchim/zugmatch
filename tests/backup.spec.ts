/* SYNTHETIC — backup round trip: zugmatch ZIP, zugmatch TXT, and a ZIP built by real
   PeerMatch code (tests/fixtures/peermatch-backup-synthetic.zip), restored both ways. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gotoFresh, clearDb, seed, readState } from './helpers';

const FIXTURE_ZIP = fileURLToPath(new URL('./fixtures/peermatch-backup-synthetic.zip', import.meta.url));

test.beforeEach(async ({ page }) => {
  await gotoFresh(page);
  await clearDb(page);
});

test('zugmatch ZIP round trip: back up, restore, and the data comes back unchanged', async ({ page }) => {
  await seed(page, {
    shadchanim: [{ id: 1, name: 'Rivka Example', phone: '050-000-0101', email: 'rivka@example.com', tags: 'Chabad', activities: [] }],
    guys: [{ id: 2, name: 'Moshe Example', age: '31', text: 'Moshe Example profile text', contact1Name: 'Rivka Example', contact1Phone: '050-000-0101', activities: [] }]
  });

  await page.click('#backupTop');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backupSave')]);
  const zipPath = await download.path();
  expect(zipPath).toBeTruthy();

  // Wipe the database, then restore from the file we just saved.
  await clearDb(page);
  await page.click('#backupClose').catch(() => {});
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#backupTop');
  await page.setInputFiles('#restoreFile', zipPath!);
  await page.waitForTimeout(500);
  await expect(page.locator('#sheet')).toContainText('1 shadchanim');
  await expect(page.locator('#sheet')).toContainText('1 guys');
  await page.click('#restoreConfirm');
  await page.waitForTimeout(800); // page reloads itself after restore

  const state: any = await readState(page);
  expect(state.shadchanim[0].name).toBe('Rivka Example');
  expect(state.guys[0].name).toBe('Moshe Example');
});

test('restores a ZIP backup made by real PeerMatch code', async ({ page }) => {
  const zipBytes = readFileSync(FIXTURE_ZIP);

  await page.click('#backupTop');
  await page.evaluate(async (bytes) => {
    const input = document.getElementById('restoreFile') as HTMLInputElement;
    const file = new File([new Uint8Array(bytes)], 'PeerMatch_Backup_2026-09-20.zip', { type: 'application/zip' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, Array.from(zipBytes));
  await page.waitForTimeout(500);
  await expect(page.locator('#sheet')).toContainText('1 shadchanim');
  await page.click('#restoreConfirm');
  await page.waitForTimeout(800);

  const state: any = await readState(page);
  expect(state.shadchanim[0].name).toBe('Rivka Example');
  expect(state.guys[0].name).toBe('Moshe Example');
  // The pair PeerMatch wrote (shareLinkId pm-fixture-link-1) survives unchanged — repair is
  // additive only, it must not duplicate an already-complete pair.
  expect(state.guys[0].activities.length).toBe(1);
  expect(state.shadchanim[0].activities.length).toBe(1);
  expect(state.guys[0].activities[0].shareLinkId).toBe('pm-fixture-link-1');
});

test('restores the same PeerMatch backup wrapped as the emailed TXT format', async ({ page }) => {
  const zipBytes = readFileSync(FIXTURE_ZIP);
  // Same chunk-boundary rule as PeerMatch's v125-email-backup-direct.js: encode in
  // multiples of 3 so the Base64 stream has no mid-stream padding.
  function bytesToB64(bytes: Buffer) {
    let out = '';
    const size = 0x6000;
    for (let i = 0; i < bytes.length; i += size) out += bytes.subarray(i, Math.min(i + size, bytes.length)).toString('base64');
    return out;
  }
  const txt = 'PEERMATCH-BACKUP-TEXT-V1\n' + bytesToB64(zipBytes);

  await page.click('#backupTop');
  await page.evaluate((text) => {
    const input = document.getElementById('restoreFile') as HTMLInputElement;
    const file = new File([text], 'PeerMatch_Backup_2026-09-20.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, txt);
  await page.waitForTimeout(500);
  await expect(page.locator('#sheet')).toContainText('1 shadchanim');
  await page.click('#restoreConfirm');
  await page.waitForTimeout(800);

  const state: any = await readState(page);
  expect(state.shadchanim[0].name).toBe('Rivka Example');
  expect(state.guys[0].name).toBe('Moshe Example');
});
