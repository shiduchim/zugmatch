/* Screenshots of the real PeerMatch (shiduchim/match) with MADE-UP data, to copy its look exactly.
   Not part of the test suite — run it by hand:

     1. In a clone of shiduchim/match:   python3 -m http.server 8765
     2. Copy this file into your Playwright test folder for one run, then:
        npx playwright test peermatch-shots --workers=1
     3. Screenshots land in OUT (below). Take the same screens in zugmatch at 412 px, 2×, and compare.

   It blocks PeerMatch's service worker, writes made-up data into its IndexedDB, loads
   index.html, then adds every live script from sw.js → SCRIPTS in order, as the service
   worker would. */
import { test } from '@playwright/test';

const PM = 'http://localhost:8765';
const OUT = process.env.PM_SHOTS ?? 'test-results/peermatch';
test.setTimeout(120_000);

test('peermatch reference screenshots', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();

  /* 1. Made-up data (phone numbers contain 000; emails at example.com). */
  await page.goto(PM + '/icon.svg');
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
      const r = indexedDB.open('PeerMatchDB', 2);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox'); };
      r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(state, 'state'); t.oncomplete = () => ok(); t.onerror = () => no(t.error); };
      r.onerror = () => no(r.error);
    });
  });

  /* 2. Load the shell, then the live scripts in order. */
  await page.goto(PM + '/index.html');
  const sw = await (await fetch(PM + '/sw.js')).text();
  const scripts = [...sw.slice(sw.indexOf('SCRIPTS=['), sw.indexOf('];')).matchAll(/'([^']+\.js)'/g)].map((m) => m[1]!);
  for (const name of scripts) await page.addScriptTag({ url: '/' + name });
  await page.evaluate(() => { try { (window as unknown as { render: () => void }).render(); } catch { /* fine */ } });
  await page.waitForTimeout(2500);

  /* 3. The screens. The detail/form sheets scroll inside #sheet. */
  const sheet = page.locator('#sheet');
  const scrollShots = async (name: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await sheet.evaluate((el, y) => { el.scrollTop = y; }, i * 800);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name}-${i}.png` });
    }
  };
  const tapEdit = () => page.evaluate(() => { [...document.querySelectorAll('#sheet button')].find((b) => b.textContent?.trim() === 'Edit')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

  await page.screenshot({ path: `${OUT}/shadchanim-list.png` });
  await page.click('#tabGuys'); await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/guys-list.png` });
  await page.getByText('Moshe Example').first().click(); await page.waitForTimeout(1500);
  await scrollShots('guy', 4);
  await tapEdit(); await page.waitForTimeout(1200);
  await scrollShots('guy-edit', 3);
  await page.evaluate(() => (window as unknown as { close: () => void }).close());
  await page.click('#tabShadchanim'); await page.waitForTimeout(500);
  await page.getByText('Rivka Example').first().click(); await page.waitForTimeout(1500);
  await scrollShots('shadchan', 2);
  await tapEdit(); await page.waitForTimeout(1200);
  await scrollShots('shadchan-edit', 2);
  await ctx.close();
});
