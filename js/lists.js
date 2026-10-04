/* The three lists: cards, search, selection bar, Waiting-for-reply pill and list, Calls
   pill and "Calls to make" (shadchanim), yellow rows, referral grouping for shadchanim. */

import { state, save } from './db.js';
import { esc, stripBold, todayKey, dueLabel } from './util.js';
import { lastActivitySummary, lastWhatsAppState } from './history.js';
import { getSelected, toggleSelected, isSelected, selectAll, clearSelected, selectionCount } from './app.js';
import { shareSelectionWhatsApp, shareSelectionSms, shareSelectionEmail } from './send.js';
import { openGuyGirl, openShadchan } from './person.js';
import { openAddForm, openAddShadchan } from './forms.js';
import { chooseZip } from './import-whatsapp.js';

const $ = (id) => document.getElementById(id);

$('addShadchan').onclick = () => openAddShadchan();
$('addGuy').onclick = () => openAddForm('guys');
$('addGirl').onclick = () => openAddForm('girls');
$('importWa').onclick = () => $('importWaFile').click();
$('importWaFile').onchange = () => {
  const f = $('importWaFile').files?.[0];
  $('importWaFile').value = '';
  if (f) chooseZip(f);
};

/* ---------- Search ---------- */

function searchHay(kind, x) {
  if (kind === 'shadchanim') {
    return [x.name, x.phone, x.email, x.tags, ...(x.activities || []).map((a) => a.text || a.action || '')].join(' ');
  }
  const contactName = x.contact1Name || x.sourceName || x.source || '';
  const contactPhone = x.contact1Phone || x.sourcePhone || '';
  return [x.name, x.text, contactName, contactPhone, ...(x.activities || []).map((a) => a.text || a.action || '')].join(' ');
}

function visible(kind) {
  const q = ($(kind === 'shadchanim' ? 'shadchanSearch' : kind + 'Search').value || '').toLowerCase();
  const list = state[kind] || [];
  if (!q) return list;
  return list.filter((x) => searchHay(kind, x).toLowerCase().includes(q));
}

/* ---------- Selection bar ---------- */

function selectionBarHtml(kind) {
  const n = selectionCount(kind);
  if (!n) return '';
  return `<div class="selectionBar"><div class="selTitle">${kind === 'shadchanim' ? 'Share this shadchan' : 'Share this profile'}</div>
    <div class="selShare"><button type="button" data-share="email">Email</button><button type="button" data-share="sms">SMS</button><button type="button" data-share="wa">WhatsApp</button></div>
    <div class="selManage"><span class="selCount">${n} selected</span><button type="button" class="selectAllBtn" data-share="all">Select all</button><button type="button" class="danger" data-share="delete">Delete</button><button type="button" data-share="clear">Clear</button></div>
    </div>`;
}

function wireSelectionBar(container, kind, allIds, rerender) {
  const bar = container.querySelector('.selectionBar');
  if (!bar) return;
  bar.querySelector('[data-share="email"]').onclick = () => shareSelectionEmail(kind);
  bar.querySelector('[data-share="sms"]').onclick = () => shareSelectionSms(kind);
  bar.querySelector('[data-share="wa"]').onclick = () => shareSelectionWhatsApp(kind);
  bar.querySelector('[data-share="all"]').onclick = () => { selectAll(kind, allIds); rerender(); };
  bar.querySelector('[data-share="clear"]').onclick = () => { clearSelected(kind); rerender(); };
  bar.querySelector('[data-share="delete"]').onclick = async () => {
    const n = selectionCount(kind);
    if (!n) return;
    if (!confirm(`Delete ${n} selected ${kind === 'shadchanim' ? 'contacts' : 'profiles'}? This cannot be undone.`)) return;
    state[kind] = state[kind].filter((x) => !isSelected(kind, x.id));
    clearSelected(kind);
    await save();
    rerender();
  };
}

/* ---------- Waiting for reply (title-row pill + list) ---------- */

function waiters(kind) {
  return (state[kind] || []).filter((x) => x.waitingForReply === true);
}

function openPickerList(title, items, labelFn, subFn, onPick, dueClass) {
  document.getElementById('waitList')?.remove();
  if (items.length === 1) { onPick(items[0]); return; }
  const shade = document.createElement('div');
  shade.id = 'waitList';
  shade.className = 'pickerShade';
  shade.innerHTML = `<div class="pickerSheet"><div class="pickerTitle">${esc(title)} (${items.length})</div>
    ${items.length ? '' : '<div class="pickerEmpty">Nothing here.</div>'}
    <div class="pickerRows"></div><button type="button" class="secondary full" style="margin-top:9px" id="waitListClose">Close</button></div>`;
  document.body.appendChild(shade);
  const rows = shade.querySelector('.pickerRows');
  items.forEach((x) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pickerRow' + (dueClass && dueClass(x) ? ' due' : '');
    b.innerHTML = `<b>${esc(stripBold(x.name) || 'Unnamed')}</b><span>${esc(subFn(x))}</span>`;
    b.onclick = () => { shade.remove(); onPick(x); };
    rows.appendChild(b);
  });
  shade.querySelector('#waitListClose').onclick = () => shade.remove();
  shade.onclick = (e) => { if (e.target === shade) shade.remove(); };
}

function waitingBadgeHtml(kind) {
  const n = waiters(kind).length;
  return `<button type="button" class="titleBadge${n === 0 ? ' zero' : ''}" data-badge="waiting">Waiting for reply ${n}</button>`;
}

function openWaiting(kind) {
  const opener = kind === 'shadchanim' ? openShadchan : (id) => openGuyGirl(kind, id);
  openPickerList('Waiting for reply', waiters(kind), (x) => x.name, (x) => x.waitingForReplySince || '', (x) => opener(x.id));
}

/* ---------- Calls to make (shadchanim only) ---------- */

function scheduledCalls() {
  return state.shadchanim
    .filter((x) => (x.callReminderDate || '').trim())
    .sort((a, b) => a.callReminderDate.localeCompare(b.callReminderDate) || String(a.name || '').localeCompare(String(b.name || '')));
}
function callsBadgeHtml() {
  const n = scheduledCalls().length;
  return `<button type="button" class="titleBadge${n === 0 ? ' zero' : ''}" data-badge="calls">Calls ${n}</button>`;
}
function openCalls() {
  openPickerList('Calls to make', scheduledCalls(), (x) => x.name, (x) => dueLabel(x.callReminderDate), (x) => openShadchan(x.id), (x) => { const l = dueLabel(x.callReminderDate); return l === 'Today' || l === 'Overdue'; });
}

/* ---------- Referral tree (shadchanim) ---------- */

function parentOf(x) {
  if (x.referredById != null) {
    const p = state.shadchanim.find((z) => String(z.id) === String(x.referredById));
    if (p && p !== x) return p;
  }
  return null;
}
function orderedShadchanim(arr) {
  const children = new Map();
  const childIds = new Set();
  for (const x of arr) {
    const p = parentOf(x);
    if (!p) continue;
    const key = String(p.id);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(x);
    childIds.add(String(x.id));
  }
  const out = [];
  const seen = new Set();
  const add = (x) => {
    const key = String(x.id);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(x);
    for (const c of children.get(key) || []) add(c);
  };
  for (const x of arr) if (!childIds.has(String(x.id))) add(x);
  for (const x of arr) add(x);
  return { out, children };
}

/* ---------- Card rendering ---------- */

function shadchanCardHtml(x, checked) {
  const initials = (x.name || '?').split(/\s+/).map((z) => z[0]).join('').slice(0, 2).toUpperCase();
  return `<div class="card${checked ? ' selected' : ''}${x.waitingForReply ? ' waitingRow' : ''}" data-id="${x.id}">
    <div class="cardRow"><div class="left"><input type="checkbox" class="listCheck" ${checked ? 'checked' : ''} aria-label="Select ${esc(x.name || 'shadchan')}">
    <div class="avatar">${esc(initials)}</div>
    <div><div class="name">${esc(stripBold(x.name) || 'Unnamed shadchan')}</div>
    <div class="small">${esc(stripBold(lastActivitySummary(x)).slice(0, 95))}</div>
    <div class="small">WhatsApp${esc(lastWhatsAppState(x))}</div></div></div><div class="chevron">›</div></div></div>`;
}

function profileCardHtml(kind, x, checked) {
  const contactName = x.contact1Name || x.sourceName || x.source || '';
  const contactPhone = x.contact1Phone || x.sourcePhone || '';
  const pills = [x.age ? `<span class="pill">Age ${esc(x.age)}</span>` : '', contactName ? `<span class="pill">From ${esc(stripBold(contactName))}</span>` : '', x.profileImage || x.profileMediaFull ? '<span class="pill">Screenshot</span>' : ''].filter(Boolean).join('');
  return `<div class="card${checked ? ' selected' : ''}${x.waitingForReply ? ' waitingRow' : ''}" data-id="${x.id}">
    <div class="cardRow"><div class="left"><input type="checkbox" class="listCheck" ${checked ? 'checked' : ''} aria-label="Select ${esc(x.name || 'profile')}">
    <div><div class="name">${esc(stripBold(x.name) || 'Unnamed profile')}</div>
    <div class="meta">${pills}</div>
    ${contactPhone ? `<div class="small">${esc(contactPhone)}</div>` : ''}
    <div class="small">${esc(stripBold(lastActivitySummary(x)).slice(0, 85))}</div></div></div><div class="chevron">›</div></div></div>`;
}

/* ---------- Renderers ---------- */

export function renderShadchanim() {
  const box = $('shadchanList');
  const arr = visible('shadchanim');
  const { out, children } = orderedShadchanim(arr);
  const h1 = document.querySelector('#shadchanimSection h1');
  h1.querySelectorAll('.titleBadge').forEach((b) => b.remove());
  h1.insertAdjacentHTML('beforeend', waitingBadgeHtml('shadchanim') + callsBadgeHtml());
  h1.querySelector('[data-badge="waiting"]').onclick = () => openWaiting('shadchanim');
  h1.querySelector('[data-badge="calls"]').onclick = () => openCalls();

  box.innerHTML = out.length ? '' : '<div class="empty">No shadchanim yet.</div>';
  box.insertAdjacentHTML('beforeend', selectionBarHtml('shadchanim'));
  wireSelectionBar(box, 'shadchanim', arr.map((x) => x.id), renderShadchanim);

  // Descendants of a collapsed group stay in the flow (so nesting still walks correctly)
  // but are hidden, so compute that up front instead of patching the DOM after insertion.
  const hidden = new Set();
  for (const [parentId, kids] of children) {
    if (sessionStorage.getItem('zmRef:' + parentId) !== '1') for (const c of kids) hidden.add(String(c.id));
  }

  for (const x of out) {
    const isChild = !!parentOf(x);
    const wrap = document.createElement('div');
    wrap.innerHTML = shadchanCardHtml(x, isSelected('shadchanim', x.id));
    const card = wrap.firstElementChild;
    if (isChild) card.classList.add('refChild');
    if (hidden.has(String(x.id))) card.classList.add('refHidden');
    card.querySelector('.listCheck').onclick = (e) => { e.stopPropagation(); toggleSelected('shadchanim', x.id); renderShadchanim(); };
    card.querySelector('.cardRow').addEventListener('click', (e) => { if (e.target.closest('.listCheck')) return; openShadchan(x.id); });
    box.appendChild(card);

    const kids = children.get(String(x.id));
    if (kids && kids.length) {
      const key = 'zmRef:' + x.id;
      const open = sessionStorage.getItem(key) === '1';
      const toggle = document.createElement('div');
      toggle.className = 'refToggle';
      toggle.innerHTML = `<span class="arrow">${open ? '▴' : '▾'}</span><span>${kids.length} referred shadchan${kids.length === 1 ? '' : 'im'}</span>`;
      toggle.onclick = () => {
        const now = sessionStorage.getItem(key) === '1';
        sessionStorage.setItem(key, now ? '0' : '1');
        renderShadchanim();
      };
      box.appendChild(toggle);
    }
  }
}

function renderProfiles(kind) {
  const box = $(kind + 'List');
  const arr = visible(kind);
  const h1 = document.querySelector('#' + kind + 'Section h1');
  h1.querySelectorAll('.titleBadge').forEach((b) => b.remove());
  h1.insertAdjacentHTML('beforeend', waitingBadgeHtml(kind));
  h1.querySelector('[data-badge="waiting"]').onclick = () => openWaiting(kind);

  box.innerHTML = arr.length ? '' : `<div class="empty">No ${kind} added yet.</div>`;
  box.insertAdjacentHTML('beforeend', selectionBarHtml(kind));
  wireSelectionBar(box, kind, arr.map((x) => x.id), () => renderProfiles(kind));

  for (const x of arr) {
    const wrap = document.createElement('div');
    wrap.innerHTML = profileCardHtml(kind, x, isSelected(kind, x.id));
    const card = wrap.firstElementChild;
    card.querySelector('.listCheck').onclick = (e) => { e.stopPropagation(); toggleSelected(kind, x.id); renderProfiles(kind); };
    card.querySelector('.cardRow').addEventListener('click', (e) => { if (e.target.closest('.listCheck')) return; openGuyGirl(kind, x.id); });
    box.appendChild(card);
  }
}

export function renderGuys() { renderProfiles('guys'); }
export function renderGirls() { renderProfiles('girls'); }

export function renderAll() {
  renderShadchanim();
  renderGuys();
  renderGirls();
}

$('shadchanSearch').oninput = renderShadchanim;
$('guysSearch').oninput = renderGuys;
$('girlsSearch').oninput = renderGirls;
