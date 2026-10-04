/* SYNTHETIC — Make Match: template, Contact/SMS/WhatsApp/Email, matchId history on all three. */
import { test, expect } from '@playwright/test';
import { gotoFresh, clearDb, seed, readState, captureOutboundNav } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoFresh(page);
  await clearDb(page);
  await seed(page, {
    shadchanim: [{ id: 1, name: 'Rivka Example', phone: '050-000-0101', email: 'rivka@example.com', activities: [] }],
    guys: [{ id: 2, name: 'Moshe Example', age: '31', text: 'Moshe Example\n31\nLearning.', contact1Name: 'Rivka Example', contact1Phone: '050-000-0101', activities: [] }],
    girls: [{ id: 3, name: 'Chaya Example', age: '28', text: 'Chaya Example, 28.', activities: [] }]
  });
});

test('Make Match requires exactly one guy and one girl', async ({ page }) => {
  page.once('dialog', (d) => { expect(d.message()).toContain('Guy'); d.accept(); });
  await page.click('#makeMatchTop');
});

test('Make Match builds the template and WhatsApp send writes matchId history on guy, girl and shadchan', async ({ page }) => {
  await page.click('#tabGuys');
  await page.click('#guysList .listCheck');
  await page.click('#tabGirls');
  await page.click('#girlsList .listCheck');
  await page.click('#tabShadchanim');
  await page.click('#shadchanList .listCheck');
  await page.click('#makeMatchTop');
  await page.waitForTimeout(300);

  const message = await page.locator('#matchMessage').inputValue();
  expect(message).toContain('Shidduch suggestion');
  expect(message).toContain('Guy: Moshe Example');
  expect(message).toContain('Girl: Chaya Example');
  expect(message).toContain('GUY — Moshe Example (age 31)');

  const urls = await captureOutboundNav(page);
  await page.click('#matchWa');
  await page.waitForTimeout(300);
  expect(urls.length).toBe(1);

  await page.goto('/index.html');
  await page.waitForTimeout(300);
  const state: any = await readState(page);
  const guyAct = state.guys[0].activities[0];
  const girlAct = state.girls[0].activities[0];
  const shadAct = state.shadchanim[0].activities[0];
  expect(guyAct.action).toBe('Match sent • WhatsApp');
  expect(girlAct.action).toBe('Match sent • WhatsApp');
  expect(shadAct.action).toBe('Match sent • WhatsApp');
  expect(guyAct.matchId).toBe(girlAct.matchId);
  expect(guyAct.matchId).toBe(shadAct.matchId);
});

test('Make Match Contact calls the selected recipient and logs "Match contact"', async ({ page }) => {
  await page.click('#tabGuys');
  await page.click('#guysList .listCheck');
  await page.click('#tabGirls');
  await page.click('#girlsList .listCheck');
  await page.click('#makeMatchTop');
  await page.waitForTimeout(300);

  const urls = await captureOutboundNav(page);
  await page.click('#matchContact');
  await page.waitForTimeout(300);
  expect(urls.some((u) => u.startsWith('tel:'))).toBeTruthy();

  await page.goto('/index.html');
  await page.waitForTimeout(300);
  const state: any = await readState(page);
  expect(state.guys[0].activities[0].action).toContain('Match contact');
});
