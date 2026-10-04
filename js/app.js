/* Start-up, header, tabs, opening/closing sheets (Back closes the sheet), selection state,
   and the shared-item banner. */

import * as Db from './db.js';
import { esc } from './util.js';
import * as Lists from './lists.js';
import * as Person from './person.js';
import * as Forms from './forms.js';
import { openBackupSheet } from './backup.js';
import { openMakeMatch } from './match.js';
import { initCallFollowup, addActivity } from './history.js';
import { getShadchanReminderInfo, clearShadchanReminder } from './person.js';
import { checkSharedZip } from './import-whatsapp.js';

const VERSION = '1';
const FEATURE_EMAIL = 'feature-requests@example.com';

const $ = (id) => document.getElementById(id);

/* ---------- Sheet infra ---------- */

let sheetOpen = false;
let currentReopen = null;

export function setReopen(fn) {
  currentReopen = fn;
}

export function openSheet(html) {
  $('sheet').innerHTML = html;
  $('modal').classList.remove('hidden');
  if (!sheetOpen) {
    sheetOpen = true;
    history.pushState({ zmSheet: true }, '');
  }
}

export function closeSheet() {
  $('modal').classList.add('hidden');
  $('sheet').innerHTML = '';
  currentReopen = null;
  if (sheetOpen) {
    sheetOpen = false;
    if (history.state && history.state.zmSheet) history.back();
  }
}

export function reopenCurrent() {
  if (currentReopen) currentReopen();
  else closeSheet();
}

window.addEventListener('popstate', () => {
  if (sheetOpen) {
    sheetOpen = false;
    $('modal').classList.add('hidden');
    $('sheet').innerHTML = '';
    currentReopen = null;
  }
});

$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal')) closeSheet();
});

/* ---------- Tabs ---------- */

function show(kind) {
  for (const k of ['shadchanim', 'guys', 'girls']) {
    $(k + 'Section').classList.toggle('hidden', k !== kind);
    $('tab' + k[0].toUpperCase() + k.slice(1)).classList.toggle('active', k === kind);
  }
}
$('tabShadchanim').onclick = () => show('shadchanim');
$('tabGuys').onclick = () => show('guys');
$('tabGirls').onclick = () => show('girls');

/* ---------- Selection state (getSelected(kind) — the one source of truth) ---------- */

const selected = { guys: new Set(), girls: new Set(), shadchanim: new Set() };

export function getSelected(kind) {
  return (Db.state[kind] || []).filter((x) => selected[kind].has(x.id));
}
export function isSelected(kind, id) {
  return selected[kind].has(id);
}
export function toggleSelected(kind, id) {
  if (selected[kind].has(id)) selected[kind].delete(id);
  else selected[kind].add(id);
}
export function selectAll(kind, ids) {
  ids.forEach((id) => selected[kind].add(id));
}
export function clearSelected(kind) {
  selected[kind].clear();
}
export function selectionCount(kind) {
  return selected[kind].size;
}

/* ---------- Header ---------- */

function mountHeader() {
  $('versionPill').textContent = 'v' + VERSION;
  $('backupTop').onclick = (e) => { e.preventDefault(); openBackupSheet(); };
  $('makeMatchTop').onclick = () => openMakeMatch();
  const link = $('featureRequestLink');
  link.href = 'mailto:' + FEATURE_EMAIL + '?subject=' + encodeURIComponent('zugmatch app feature request') + '&body=' + encodeURIComponent('Hi,\n\nI would like to request a new app feature, improvement, or functionality:\n\n\n\nHow I would use it:\n\n');
}

/* ---------- Shared-item banner (approved fix #3: clears once saved or dismissed) ---------- */

export async function refreshBanner() {
  const pending = await Db.getPendingShare();
  $('banner').classList.toggle('hidden', !pending);
}

async function showIncomingShare() {
  const pending = await Db.getPendingShare();
  if (!pending) return;
  const isZip = pending.files?.some((f) => /\.zip$/i.test(f.name || '') || /zip/i.test(f.type || ''));
  if (isZip) return; // handled by import-whatsapp.js's checkSharedZip
  const photo = pending.files?.find((f) => f.type?.startsWith('image/')) || null;
  const textFile = pending.files?.find((f) => f.type === 'text/plain');
  let text = [pending.title, pending.text, pending.url].filter(Boolean).join('\n').trim();
  if (!text && textFile) { try { text = (await textFile.text()).trim(); } catch { /* ignore */ } }

  const shadOptions = Db.state.shadchanim.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  openSheet(`<h2>Import Shared Profile</h2><div class="card"><div class="profileText">${esc(text || 'Shared item received')}</div></div>
    ${Db.state.shadchanim.length ? `<label>Save as a reply from<select id="shareAsShad">${shadOptions}</select></label><button type="button" class="green full" id="shareAsReply">Save as WhatsApp Reply</button><div class="gap"></div>` : ''}
    <div class="actions"><button type="button" class="primary" id="shareGuy">Guy</button><button type="button" class="primary" id="shareGirl">Girl</button></div>
    <div class="gap"></div><button type="button" class="secondary full" id="shareLater">Later</button>`);

  $('shareGuy').onclick = () => { Forms.openAddForm('guys', { text, photo }); };
  $('shareGirl').onclick = () => { Forms.openAddForm('girls', { text, photo }); };
  const replyBtn = $('shareAsReply');
  if (replyBtn) replyBtn.onclick = async () => {
    const sh = Db.state.shadchanim.find((z) => String(z.id) === $('shareAsShad').value);
    if (!sh) return;
    addActivity(sh, { type: 'wa-in', text: text || 'Shared item' });
    await Db.save();
    await Db.clearPendingShare();
    await refreshBanner();
    Person.openShadchan(sh.id);
  };
  $('shareLater').onclick = async () => { await Db.clearPendingShare(); await refreshBanner(); closeSheet(); };
}

/* ---------- Boot ---------- */

async function boot() {
  mountHeader();
  initCallFollowup({ getReminderInfo: getShadchanReminderInfo, clearReminder: clearShadchanReminder, reopen: reopenCurrent });
  await Db.load();
  Lists.renderAll();
  await refreshBanner();
  await checkSharedZip();
  await refreshBanner();
  await showIncomingShare();

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch { /* ignore */ }
  }
}

boot();
