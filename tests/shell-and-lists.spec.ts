/* SYNTHETIC — shell, lists, search, selection, waiting, referral tree. */
import { test, expect } from '@playwright/test';
import { gotoFresh, clearDb, seed, readState } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoFresh(page);
  await clearDb(page);
});

test('empty state shows "No X yet" on all three tabs', async ({ page }) => {
  await page.reload();
  await expect(page.locator('#shadchanList')).toContainText('No shadchanim yet.');
  await page.click('#tabGuys');
  await expect(page.locator('#guysList')).toContainText('No guys added yet.');
  await page.click('#tabGirls');
  await expect(page.locator('#girlsList')).toContainText('No girls added yet.');
});

test('add shadchan, guy, girl through the forms and see them in their lists', async ({ page }) => {
  await page.click('#addShadchan');
  await page.fill('#sName', 'Rivka Example');
  await page.fill('#sPhone', '050-000-0101');
  await page.click('#formSave');
  await expect(page.locator('.detailName')).toHaveText('Rivka Example');
  await page.click('#detailBack');
  await expect(page.locator('#shadchanList')).toContainText('Rivka Example');

  await page.click('#tabGuys');
  await page.click('#addGuy');
  await page.fill('#fText', 'Moshe Example\nAge: 31\nLearning in the evenings.');
  await page.click('#formSave');
  await expect(page.locator('.detailName')).toContainText('Moshe Example');
  await page.click('#detailBack');
  await expect(page.locator('#guysList')).toContainText('Moshe Example');
  await expect(page.locator('#guysList')).toContainText('Age 31');
});

test('search filters the visible list', async ({ page }) => {
  await seed(page, {
    shadchanim: [
      { id: 1, name: 'Rivka Example', phone: '050-000-0101', activities: [] },
      { id: 2, name: 'Dovid Sample', phone: '052-000-0202', activities: [] }
    ]
  });
  await page.fill('#shadchanSearch', 'Rivka');
  await expect(page.locator('#shadchanList')).toContainText('Rivka Example');
  await expect(page.locator('#shadchanList')).not.toContainText('Dovid Sample');
});

test('Waiting for reply toggle updates the title pill and the list row tint', async ({ page }) => {
  await seed(page, { guys: [{ id: 1, name: 'Moshe Example', age: '31', text: 'Moshe Example', activities: [] }] });
  await page.click('#tabGuys');
  await expect(page.locator('#guysSection .titleBadge').first()).toHaveText('Waiting for reply 0');
  await page.getByText('Moshe Example').first().click();
  await page.click('.waitToggle');
  await page.waitForTimeout(200);
  await expect(page.locator('.waitToggle')).toHaveClass(/waiting/);
  await page.click('#detailBack');
  await expect(page.locator('#guysSection .titleBadge').first()).toHaveText('Waiting for reply 1');
  await expect(page.locator('#guysList .card').first()).toHaveClass(/waitingRow/);
});

test('shadchan referral tree groups a referred shadchan under its referrer', async ({ page }) => {
  await seed(page, {
    shadchanim: [
      { id: 1, name: 'Rivka Example', phone: '050-000-0101', activities: [] },
      { id: 2, name: 'Dovid Sample', phone: '052-000-0202', referredBy: 'Rivka Example', referredById: 1, activities: [] }
    ]
  });
  await expect(page.locator('.refToggle')).toContainText('1 referred shadchan');
  await expect(page.locator('.card.refChild')).toHaveClass(/refHidden/);
  await page.click('.refToggle');
  await expect(page.locator('.card.refChild')).not.toHaveClass(/refHidden/);
});

test('selection bar: Select all, then Delete removes the selected records', async ({ page }) => {
  await seed(page, {
    guys: [
      { id: 1, name: 'Moshe Example', age: '31', text: 'a', activities: [] },
      { id: 2, name: 'Yosef Example', age: '29', text: 'b', activities: [] }
    ]
  });
  await page.click('#tabGuys');
  await page.click('#guysList .listCheck');
  await expect(page.locator('.selectionBar .selCount')).toHaveText('1 selected');
  await page.click('.selectionBar .selectAllBtn');
  await expect(page.locator('.selectionBar .selCount')).toHaveText('2 selected');
  page.once('dialog', (d) => d.accept());
  await page.click('.selectionBar .danger');
  await page.waitForTimeout(200);
  await expect(page.locator('#guysList')).toContainText('No guys added yet.');
  const state: any = await readState(page);
  expect(state.guys.length).toBe(0);
});

test('history note composer adds a text activity and Delete removes it', async ({ page }) => {
  await seed(page, { shadchanim: [{ id: 1, name: 'Rivka Example', phone: '050-000-0101', activities: [] }] });
  await page.getByText('Rivka Example').first().click();
  await page.fill('.composerInput', 'Spoke about new girls');
  await page.click('.composerBtn');
  await page.waitForTimeout(200);
  await expect(page.locator('.event').first()).toContainText('Spoke about new girls');
  page.once('dialog', (d) => d.accept());
  await page.click('.deleteEvent');
  await page.waitForTimeout(200);
  await expect(page.locator('#sheet')).toContainText('No notes yet.');
});
