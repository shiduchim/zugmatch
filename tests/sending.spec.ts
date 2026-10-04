/* SYNTHETIC — the one WhatsApp opener and the one send queue (approved fixes #1 and #5). */
import { test, expect } from '@playwright/test';
import { gotoFresh, clearDb, seed, readState, captureOutboundNav } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoFresh(page);
  await clearDb(page);
});

test('selection bar WhatsApp: profile + exactly one shadchan sends directly and writes one history pair', async ({ page }) => {
  await seed(page, {
    shadchanim: [{ id: 1, name: 'Rivka Example', phone: '050-000-0101', activities: [] }],
    guys: [{ id: 2, name: 'Moshe Example', age: '31', text: 'Moshe Example\n31\nLearning.', contact1Name: 'Rivka Example', contact1Phone: '050-000-0101', activities: [] }]
  });
  const urls = await captureOutboundNav(page);

  await page.click('#shadchanList .listCheck');
  await page.click('#tabGuys');
  await page.click('#guysList .listCheck');
  await page.click('#guysSection button[data-share="wa"]');
  await page.waitForTimeout(400);

  expect(urls.length).toBe(1);
  expect(urls[0]).toContain('972500000101');
  expect(decodeURIComponent(urls[0])).toContain('Moshe Example');

  await page.goto('/index.html');
  await page.waitForTimeout(300);
  const state: any = await readState(page);
  const guyAct = state.guys[0].activities[0];
  const shadAct = state.shadchanim[0].activities[0];
  expect(guyAct.action).toBe('Profile sent • WhatsApp');
  expect(shadAct.action).toBe('Profile received • WhatsApp');
  expect(guyAct.shareLinkId).toBe(shadAct.shareLinkId);
});

test('selection bar WhatsApp with no shadchan selected opens the recipient picker', async ({ page }) => {
  await seed(page, { guys: [{ id: 1, name: 'Moshe Example', age: '31', text: 'Moshe Example profile text', activities: [] }] });
  await page.click('#tabGuys');
  await page.click('#guysList .listCheck');
  await page.click('#guysSection button[data-share="wa"]');
  await page.waitForTimeout(300);
  await expect(page.locator('.pickerTitle')).toHaveText('Who are you sending this to?');
  await page.fill('#pickName', 'Someone Example');
  await page.fill('#pickPhone', '053-000-0303');

  const urls = await captureOutboundNav(page);
  await page.click('#pickGo');
  await page.waitForTimeout(300);
  expect(urls.length).toBe(1);
  expect(urls[0]).toContain('972530000303');
});

test('Contacts card WhatsApp button opens directly with no text (approved fix #5)', async ({ page }) => {
  await seed(page, {
    guys: [{ id: 1, name: 'Moshe Example', age: '31', text: 'x', contact1Name: 'Rivka Example', contact1Phone: '050-000-0101', activities: [] }]
  });
  await page.click('#tabGuys');
  await page.getByText('Moshe Example').first().click();
  const urls = await captureOutboundNav(page);
  await page.locator('.contactCardRow').filter({ hasText: 'Contact 1' }).locator('[data-act="wa"]').click();
  await page.waitForTimeout(300);
  expect(urls.length).toBe(1);
  expect(urls[0]).toContain('972500000101');
  expect(urls[0]).not.toContain('text=');
});

test('Shadchanim-tab WhatsApp with no profile selected shares the contact card', async ({ page }) => {
  await seed(page, { shadchanim: [{ id: 1, name: 'Rivka Example', phone: '050-000-0101', email: 'rivka@example.com', tags: 'Chabad', activities: [] }] });
  await page.click('#shadchanList .listCheck');
  const urls = await captureOutboundNav(page);
  await page.click('#shadchanimSection button[data-share="wa"]');
  await page.waitForTimeout(300);
  expect(urls.length).toBe(1);
  expect(decodeURIComponent(urls[0])).toContain('Rivka Example');
  expect(decodeURIComponent(urls[0])).toContain('050-000-0101');
});
