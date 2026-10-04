/* SYNTHETIC — shared helpers for zugmatch's Playwright tests. All data here is made up:
   phone numbers contain "000", emails are at example.com. */
import type { Page } from '@playwright/test';

export async function gotoFresh(page: Page) {
  await page.goto('/index.html');
  await page.waitForTimeout(400);
}

export async function clearDb(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase('ZugMatchDB');
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve();
    });
  });
}

type SeedState = {
  shadchanim?: Record<string, unknown>[];
  guys?: Record<string, unknown>[];
  girls?: Record<string, unknown>[];
};

/** Writes state straight into ZugMatchDB and reloads, bypassing the UI for fast setup. */
export async function seed(page: Page, state: SeedState) {
  await page.evaluate(async (s) => {
    const full = { shadchanim: s.shadchanim || [], guys: s.guys || [], girls: s.girls || [] };
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('ZugMatchDB', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox');
      };
      r.onsuccess = () => {
        const t = r.result.transaction('kv', 'readwrite');
        t.objectStore('kv').put(full, 'state');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      };
      r.onerror = () => reject(r.error);
    });
  }, state);
  await page.reload();
  await page.waitForTimeout(500);
}

export async function readState(page: Page) {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('ZugMatchDB');
      r.onsuccess = () => {
        const t = r.result.transaction('kv', 'readonly');
        const rq = t.objectStore('kv').get('state');
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      };
      r.onerror = () => reject(r.error);
    });
  });
}

/** Blocks WhatsApp/tel/sms/mailto navigation so a test can inspect the resulting URL
    without the page actually navigating away. */
export async function captureOutboundNav(page: Page) {
  const urls: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (/^(whatsapp:|https:\/\/wa\.me|tel:|sms:|mailto:)/.test(url)) {
      urls.push(url);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
    }
    route.continue();
  });
  return urls;
}
