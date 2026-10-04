/* Screenshots of zugmatch with the SAME made-up data and screens as
   tools/peermatch-shots.spec.ts, for side-by-side comparison. Not part of the test suite —
   run it against the app's own dev server (npm run serve / the playwright webServer). */
import { test } from '@playwright/test';

const APP = process.env.ZM_BASE ?? 'http://localhost:8787';
const OUT = process.env.ZM_SHOTS ?? 'test-results/zugmatch';
test.setTimeout(120_000);

test('zugmatch reference screenshots', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();

  await page.goto(APP + '/index.html');
  await page.evaluate(async () => {
    const now = Date.now();
    const state = {
      shadchanim: [
        { id: now - 5000, name: 'Rivka Example', phone: '050-000-0101', email: 'rivka@example.com', tags: 'Chabad', activities: [{ id: now - 4000, type: 'text', text: 'Spoke about new girls', ts: 'Sep 20, 2026, 10:00' }] },
        { id: now - 6000, name: 'Dovid Sample', phone: '052-000-0202', email: '', tags: '', referredBy: 'Rivka Example', activities: [] }
      ],
      guys: [{ id: now - 3000, name: 'Moshe Example', age: '31', text: 'Moshe Example\n31 • Never married\nLearning in the evenings, works in tech.\nLooking for a warm, family-oriented girl.', sourceName: 'Rivka Example', sourcePhone: '050-000-0101', contact1Name: 'Rivka Example', contact1Phone: '050-000-0101', lookingFor: 'Kind, family oriented', lookingForMaxAge: '30', tags: 'Chabad', activities: [{ id: now - 2000, type: 'text', text: 'Test note', ts: 'Sep 21, 2026, 11:00' }] }],
      girls: [{ id: now - 1000, name: 'Chaya Example', age: '28', text: 'Chaya Example\n28, Jerusalem', sourceName: 'Rivka Example', sourcePhone: '050-000-0101', activities: [] }]
    };
    await new Promise<void>((ok, no) => {
      const r = indexedDB.open('ZugMatchDB', 2);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox'); };
      r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(state, 'state'); t.oncomplete = () => ok(); t.onerror = () => no(t.error); };
      r.onerror = () => no(r.error);
    });
  });
  await page.reload();
  await page.waitForTimeout(1200);

  const sheet = page.locator('#sheet');
  const scrollShots = async (name: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await sheet.evaluate((el, y) => { el.scrollTop = y; }, i * 800);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name}-${i}.png` });
    }
  };

  await page.screenshot({ path: `${OUT}/shadchanim-list.png` });
  await page.click('#tabGuys'); await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/guys-list.png` });
  await page.getByText('Moshe Example').first().click(); await page.waitForTimeout(1000);
  await scrollShots('guy', 4);
  await page.click('#detailEdit'); await page.waitForTimeout(800);
  await scrollShots('guy-edit', 3);
  await page.click('#formCancel'); await page.waitForTimeout(500);
  await page.click('#detailBack'); await page.waitForTimeout(500);
  await page.click('#tabShadchanim'); await page.waitForTimeout(500);
  await page.getByText('Rivka Example').first().click(); await page.waitForTimeout(1000);
  await scrollShots('shadchan', 2);
  await page.click('#detailEdit'); await page.waitForTimeout(800);
  await scrollShots('shadchan-edit', 2);
  await page.click('#formCancel'); await page.waitForTimeout(500);
  await page.click('#detailBack'); await page.waitForTimeout(500);

  await page.click('#backupTop'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/backup-0.png` });
  await page.click('#backupClose'); await page.waitForTimeout(500);

  await page.click('#tabGuys'); await page.waitForTimeout(400);
  await page.click('#guysList .listCheck'); await page.waitForTimeout(200);
  await page.click('#tabGirls'); await page.waitForTimeout(400);
  await page.click('#girlsList .listCheck'); await page.waitForTimeout(200);
  await page.click('#makeMatchTop'); await page.waitForTimeout(800);
  await scrollShots('match', 3);

  await ctx.close();
});
