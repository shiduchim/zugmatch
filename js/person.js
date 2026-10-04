/* Guy/Girl detail and Shadchan detail: every section in order (moving a section means
   moving one line in the arrays at the bottom of openGuyGirl/openShadchan). */

import { state, save } from './db.js';
import { esc, stamp, objectUrl, normalizePhone, phoneType, isLandline, dueLabel, todayKey, renderBoldHtml, phoneKey } from './util.js';
import { renderHistory, wireHistoryDeletes, mountComposer, callBannerHtml, setActiveCallContext, addActivity } from './history.js';
import { openSheet, closeSheet, setReopen, getSelected } from './app.js';
import { contactRowHtml, wireContactRow, contactsCardHtml, wireContactsCard, openPhonePicker } from './send.js';
import { renderAttachmentDetail, wireAttachmentDetail, mountTranslate } from './attach.js';
import { renderGuys, renderGirls, renderShadchanim } from './lists.js';
import { openEditGuyGirl, openEditShadchan } from './forms.js';

/* ---------- Shared bits ---------- */

function fullMedia(x) { return x?.profileMediaFull || x?.profileMedia || x?.profileImage || x?.photo || null; }
function thumbMedia(x) { return x?.profileMediaThumb || x?.photo || x?.profileMediaFull || x?.profileMedia || x?.profileImage || null; }

function openFullImage(blob) {
  if (!blob) return;
  document.getElementById('fullViewer')?.remove();
  const u = URL.createObjectURL(blob);
  const d = document.createElement('div');
  d.id = 'fullViewer';
  d.className = 'fullImage';
  d.innerHTML = `<button type="button" id="fullImageClose">Close</button><img src="${u}" alt="Photo">`;
  document.body.appendChild(d);
  const done = () => { URL.revokeObjectURL(u); d.remove(); };
  d.querySelector('#fullImageClose').onclick = done;
  d.onclick = (e) => { if (e.target === d) done(); };
}

function linkPhoneNumbers(container, record) {
  container.querySelectorAll('.profileText, .shadNotesText').forEach((el) => {
    if (el.dataset.linked === '1') return;
    el.dataset.linked = '1';
    el.querySelectorAll('a[data-phone]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); openPhonePicker(record, a.dataset.phone); });
    });
  });
}

function bindQuickSave(root, record, onChanged) {
  let timer = null;
  root.querySelectorAll('[data-field]').forEach((el) => {
    const key = el.dataset.field;
    const setValue = () => {
      if (el.type === 'checkbox') record[key] = !!el.checked;
      else record[key] = el.value;
    };
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      setValue();
      clearTimeout(timer);
      timer = setTimeout(async () => { await save(); onChanged?.(); }, 250);
    });
  });
}

/* ---------- Guy/Girl: meta pills ---------- */

function metaPillsHtml(x) {
  const phone = x.contact1Phone || x.sourcePhone || '';
  const type = phoneType(phone);
  const badges = [
    x.age ? `<span class="pill">Age ${esc(x.age)}</span>` : '',
    type === 'landline' ? '<span class="pill">Landline</span>' : '',
    type === 'voip' ? '<span class="pill">VoIP / nationwide</span>' : ''
  ].filter(Boolean).join('');
  return badges ? `<div class="meta">${badges}</div>` : '';
}

/* ---------- Guy/Girl: profile text with bold + phone links ---------- */

const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
function linkedPhoneHtml(text) {
  let html = renderBoldHtml(text);
  // renderBoldHtml already escaped the text; find phone numbers in the ESCAPED text (digits/punct are unaffected by escaping) and wrap them.
  return html.replace(PHONE_RE, (m) => `<a href="#" data-phone="${esc(m.trim())}">${m}</a>`);
}

/* ---------- Guy/Girl: Looking for / To what age ---------- */

function lookingForHtml(x) {
  if (!x.lookingFor && !x.lookingForMaxAge) return '';
  return `<div class="card"><div class="sectionTitle" style="margin-top:0">Looking for</div>${x.lookingFor ? `<div class="profileText">${esc(x.lookingFor)}</div>` : ''}${x.lookingForMaxAge ? `<div class="small" style="margin-top:5px"><b>To what age:</b> ${esc(x.lookingForMaxAge)}</div>` : ''}</div>`;
}

/* ---------- Quick details 1: Talked by phone / Talked in person ---------- */

function talkedHtml(x) {
  return `<div class="card"><label class="inlineCheck"><input type="checkbox" data-field="talkedPhone" ${x.talkedPhone ? 'checked' : ''}> Talked by phone</label>
    <label class="inlineCheck"><input type="checkbox" data-field="talkedInPerson" ${x.talkedInPerson ? 'checked' : ''}> Talked in person</label>
    <textarea class="talkNote${x.talkedPhone || x.phoneConversationNote ? ' show' : ''}" data-field="phoneConversationNote" placeholder="Phone conversation: length, importance, what it was like…">${esc(x.phoneConversationNote || '')}</textarea>
    <textarea class="talkNote${x.talkedInPerson || x.inPersonConversationNote ? ' show' : ''}" data-field="inPersonConversationNote" placeholder="In-person conversation: length, importance, what it was like…">${esc(x.inPersonConversationNote || '')}</textarea>
    </div>`;
}
function wireTalked(container) {
  const phoneCb = container.querySelector('[data-field="talkedPhone"]');
  const personCb = container.querySelector('[data-field="talkedInPerson"]');
  const phoneNote = container.querySelector('[data-field="phoneConversationNote"]');
  const personNote = container.querySelector('[data-field="inPersonConversationNote"]');
  phoneCb?.addEventListener('change', () => phoneNote.classList.toggle('show', phoneCb.checked));
  personCb?.addEventListener('change', () => personNote.classList.toggle('show', personCb.checked));
}

/* ---------- Quick details 2: flags, languages, body type, tags, religious ---------- */

const FLAGS = [
  ['divorced', 'Divorced'], ['withKids', 'With kids'], ['kosherForKohen', 'Kosher for Kohen'],
  ['kohen', 'Kohen'], ['baalTeshuvah', 'Baal teshuvah'], ['watchesMovies', 'Watches movies'],
  ['prays3Daily', 'Prays 3x daily'], ['smokes', 'Smokes']
];
const LANGUAGES = [['langEnglish', 'English'], ['langHebrew', 'Hebrew'], ['langRussian', 'Russian']];
const BODY_TYPES = [['regular', 'Regular'], ['overweight', 'Overweight']];

function quickDetails2Html(x, isProfile) {
  const flagsHtml = isProfile ? `<div class="flagRow">${FLAGS.map(([k, l]) => `<label><input type="checkbox" data-field="${k}" ${x[k] ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>
    <div class="groupTitle">Speaks languages</div><div class="flagRow">${LANGUAGES.map(([k, l]) => `<label><input type="checkbox" data-field="${k}" ${x[k] ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>
    <div class="groupTitle">Body type</div><div class="flagRow" id="bodyTypeRow">${BODY_TYPES.map(([k, l]) => `<label><input type="checkbox" data-body="${k}" ${x.bodyType === k ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>` : '';
  return `<div class="card quickDetails2">${flagsHtml}
    <div class="fieldRow"><span>Tags</span><input data-field="tags" value="${esc(x.tags || '')}" placeholder="Add tags"></div>
    <div class="fieldRow"><span>Religious level</span><input data-field="religiousLevel" value="${esc(x.religiousLevel || '')}" placeholder="e.g. strong, moderate, light"></div>
    <div class="fieldRow"><span>Religious details</span><input data-field="religiousDetails" value="${esc(x.religiousDetails || '')}" placeholder="e.g. Chabad, Breslev, Yeshivish, tzniut"></div>
    </div>`;
}
function wireBodyType(container, record, onChanged) {
  const row = container.querySelector('#bodyTypeRow');
  if (!row) return;
  row.querySelectorAll('input[data-body]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      record.bodyType = cb.checked ? cb.dataset.body : '';
      row.querySelectorAll('input[data-body]').forEach((c) => { c.checked = c.dataset.body === record.bodyType; });
      await save();
      onChanged?.();
    });
  });
}

/* ---------- Linked Shadchan (Guy/Girl) ---------- */

function normName(s) {
  return String(s || '').trim().toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function legacyLinkedShad(x) {
  for (const id of [x.sourceShadchanId, x.importedFromShadchanId, x.sourceShadchanId2]) {
    if (id != null) { const s = state.shadchanim.find((z) => String(z.id) === String(id)); if (s) return s; }
  }
  const phones = [x.sourcePhone, x.sourcePhone2].map(phoneKey).filter(Boolean);
  for (const p of phones) { const s = state.shadchanim.find((z) => phoneKey(z.phone) === p); if (s) return s; }
  const names = [x.sourceName, x.source, x.importedFromShadchan].map(normName).filter(Boolean);
  for (const n of names) { const s = state.shadchanim.find((z) => normName(z.name) === n); if (s) return s; }
  return null;
}
function resolveLinkedShad(x) {
  if (x.linkedShadchanManual === true) return x.linkedShadchanId == null ? null : state.shadchanim.find((s) => String(s.id) === String(x.linkedShadchanId)) || null;
  if (x.linkedShadchanId != null) { const s = state.shadchanim.find((z) => String(z.id) === String(x.linkedShadchanId)); if (s) return s; }
  return legacyLinkedShad(x);
}
function linkedShadchanHtml(x) {
  const current = resolveLinkedShad(x);
  return `<div class="card linkedShadchanBox"><div class="sectionTitle" style="margin-top:0">Linked Shadchan</div>
    <div class="row"><button type="button" class="secondary" id="linkedPicker" style="flex:1;text-align:left">${current ? esc(current.name || 'Unnamed Shadchan') : 'Add linked Shadchan… ▾'}</button>${current ? '<button type="button" class="lightblue" id="linkedOpen">Open</button>' : ''}</div>
    <div class="linkedMenu hidden" id="linkedMenu"></div></div>`;
}
function wireLinkedShadchan(container, record, kind, onChanged) {
  const picker = container.querySelector('#linkedPicker');
  const menu = container.querySelector('#linkedMenu');
  if (!picker) return;
  container.querySelector('#linkedOpen')?.addEventListener('click', () => { const s = resolveLinkedShad(record); if (s) openShadchan(s.id); });
  picker.onclick = () => {
    const current = resolveLinkedShad(record);
    const options = [{ id: '', label: 'No linked Shadchan' }, ...[...state.shadchanim].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map((s) => ({ id: s.id, label: (s.name || 'Unnamed Shadchan') + (s.phone ? ' • ' + s.phone : '') }))];
    menu.innerHTML = options.map((o) => `<button type="button" class="linkedOption${current && String(current.id) === String(o.id) ? ' current' : ''}" data-id="${o.id}">${esc(o.label)}</button>`).join('');
    menu.classList.toggle('hidden');
    menu.querySelectorAll('.linkedOption').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        record.linkedShadchanManual = true;
        record.linkedShadchanId = id === '' ? null : Number(id) || id;
        record.sourceShadchanId = record.linkedShadchanId;
        await save();
        onChanged?.();
      };
    });
  };
}

/* ---------- Guy / Girl detail ---------- */

export function openGuyGirl(kind, id) {
  const x = (state[kind] || []).find((z) => String(z.id) === String(id));
  if (!x) return;
  setReopen(() => openGuyGirl(kind, id));
  setActiveCallContext(kind, id, x);

  const label = kind === 'guys' ? 'Guy' : 'Girl';
  const media = thumbMedia(x);
  const showTile = kind === 'guys' && media;

  const headerMedia = showTile
    ? `<div class="mediaTile" id="detailMedia"><img src="${objectUrl(media)}" alt="Photo"></div>`
    : '';
  const girlPhotoBtn = kind === 'girls' ? `<button type="button" class="secondary girlPhotoBtn" id="girlPhotoBtn">Photo</button>` : '';

  const sections = [];
  sections.push(callBannerHtml(x));
  sections.push(metaPillsHtml(x));
  sections.push(contactRowHtml({ label: '', showWaiting: true, waiting: x.waitingForReply }));
  if (x.text?.trim()) sections.push(`<div id="translateHolder"></div>`);
  if (x.text?.trim()) sections.push(`<div class="card"><div class="profileText">${linkedPhoneHtml(x.text)}</div></div>`);
  sections.push(renderAttachmentDetail(x));
  sections.push(talkedHtml(x));
  const contactRows = [
    { kind: 'Profile', name: x.name, phone: x.profilePhone || '' },
    { kind: 'Contact 1', name: x.contact1Name || x.sourceName || x.source || '', phone: x.contact1Phone || x.sourcePhone || '' },
    { kind: 'Contact 2', name: x.contact2Name || '', phone: x.contact2Phone || x.sourcePhone2 || '' }
  ];
  sections.push(contactsCardHtml(contactRows));
  sections.push(quickDetails2Html(x, true));
  sections.push(linkedShadchanHtml(x));
  sections.push(lookingForHtml(x));
  sections.push(`<div class="sectionTitle bandTitle">History</div>${renderHistory(x)}`);
  sections.push(x.createdAt ? `<div class="addedDate">Added to PeerMatch: ${esc(new Date(x.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>` : '');

  openSheet(`<div class="detailHead">
      <button type="button" class="backBtn" id="detailBack">‹</button>
      <h2 class="detailName">${esc(x.name || 'Unnamed profile')}</h2>
      ${headerMedia}
      <div class="headRight">${girlPhotoBtn}<div class="bhe">ב"ה</div><button type="button" class="secondary" id="detailEdit">Edit</button></div>
    </div>${sections.join('')}`);

  const sheet = document.getElementById('sheet');
  document.getElementById('detailBack').onclick = () => closeSheet();
  document.getElementById('detailEdit').onclick = () => openEditGuyGirl(kind, id);
  document.getElementById('detailMedia')?.addEventListener('click', () => openFullImage(fullMedia(x)));
  document.getElementById('girlPhotoBtn')?.addEventListener('click', () => openFullImage(fullMedia(x)));

  const rerender = () => openGuyGirl(kind, id);
  wireContactRow(sheet, x, { name: x.contact1Name || x.sourceName || x.source, phone: x.contact1Phone || x.sourcePhone, email: x.sourceEmail }, async () => {
    x.waitingForReply = !x.waitingForReply;
    addActivity(x, x.waitingForReply ? { type: 'action', action: 'Waiting for reply', text: 'Marked waiting for reply.' } : { type: 'action', action: 'Reply received', text: 'Cleared waiting for reply.' });
    x.waitingForReplySince = x.waitingForReply ? stamp() : '';
    await save();
    rerender();
    renderGuys(); renderGirls();
  });
  if (x.text?.trim()) mountTranslate(document.getElementById('translateHolder'), x.text);
  wireAttachmentDetail(sheet, x);
  linkPhoneNumbers(sheet, x);
  wireTalked(sheet);
  wireContactsCard(sheet, x, contactRows);
  wireBodyType(sheet, x, rerender);
  wireLinkedShadchan(sheet, x, kind, rerender);
  bindQuickSave(sheet, x, () => { renderGuys(); renderGirls(); });
  wireHistoryDeletes(sheet, state, kind, id, async () => { rerender(); renderGuys(); renderGirls(); });
  mountComposer(sheet, x, async () => { rerender(); renderGuys(); renderGirls(); });
}

/* ---------- Shadchan detail ---------- */

function referredByHtml(x) {
  return x.referredBy?.trim() ? `<div class="small" style="margin:6px 2px">Referred by: ${esc(x.referredBy)}</div>` : '';
}
function linkedProfilesFor(shadId) {
  const out = [];
  for (const k of ['guys', 'girls']) for (const x of state[k]) if (resolveLinkedShad(x) && String(resolveLinkedShad(x).id) === String(shadId)) out.push({ k, x });
  return out;
}
function linkedProfilesHtml(shadId) {
  const links = linkedProfilesFor(shadId);
  if (!links.length) return '';
  return `<div class="card linkedProfilesBox"><div class="sectionTitle" style="margin-top:0">Linked profiles (${links.length})</div><div class="chips">${links.map((p) => `<button type="button" class="lightblue chipBtn" data-k="${p.k}" data-id="${p.x.id}">${p.k === 'guys' ? 'Guy: ' : 'Girl: '}${esc(p.x.name || 'Unnamed')}</button>`).join('')}</div></div>`;
}
function callReminderHtml(x) {
  const today = todayKey(0), tomorrow = todayKey(1);
  return `<div class="callReminderRow">
    <button type="button" class="reminderBtn${x.callReminderDate === today ? ' active' : ''}" data-offset="0">Call today</button>
    <button type="button" class="reminderBtn${x.callReminderDate === tomorrow ? ' active' : ''}" data-offset="1">Call tomorrow</button>
    <button type="button" class="reminderBtn" id="reminderClear" ${x.callReminderDate ? '' : 'disabled'}>${x.callReminderDate ? 'Clear' : 'No reminder'}</button>
    </div>`;
}
export function getShadchanReminderInfo(id) {
  const x = state.shadchanim.find((z) => String(z.id) === String(id));
  if (!x || !x.callReminderDate?.trim()) return null;
  return { date: x.callReminderDate, label: dueLabel(x.callReminderDate) };
}
export async function clearShadchanReminder(id) {
  const x = state.shadchanim.find((z) => String(z.id) === String(id));
  if (!x || !x.callReminderDate) return;
  addActivity(x, { type: 'action', action: 'Call reminder cleared', text: `Call reminder for ${x.name || 'Shadchan'} cleared.` });
  x.callReminderDate = '';
  await save();
}

export function openShadchan(id) {
  const x = state.shadchanim.find((z) => String(z.id) === String(id));
  if (!x) return;
  setReopen(() => openShadchan(id));
  setActiveCallContext('shadchanim', id, x);

  const attachmentTile = x.profileAttachment
    ? `<div class="mediaTile attachTile" id="shadAttachTile">PDF / screenshot</div>`
    : '';

  const sections = [];
  sections.push(callBannerHtml(x));
  sections.push(contactRowHtml({ label: 'Contact shadchan', showWaiting: true, waiting: x.waitingForReply }));
  sections.push(callReminderHtml(x));
  sections.push(linkedProfilesHtml(id));
  sections.push(referredByHtml(x));
  sections.push(quickDetails2Html(x, false));
  sections.push(talkedHtml(x));
  const hasNotes = x.profileText?.trim();
  sections.push(hasNotes ? `<div class="card"><div class="small">Shadchan profile / notes</div><div class="shadNotesText profileText">${linkedPhoneHtml(x.profileText)}</div></div>` : '');
  sections.push(renderAttachmentDetail(x));
  sections.push(`<div class="sectionTitle bandTitle">History</div>${renderHistory(x)}`);
  sections.push(x.createdAt ? `<div class="addedDate">Added to PeerMatch: ${esc(new Date(x.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>` : '');

  openSheet(`<div class="detailHead">
      <button type="button" class="backBtn" id="detailBack">‹</button>
      <h2 class="detailName">${esc(x.name || 'Unnamed shadchan')}</h2>
      ${attachmentTile}
      <button type="button" class="secondary" id="detailEdit" style="order:4">Edit</button>
    </div>${sections.join('')}`);

  const sheet = document.getElementById('sheet');
  document.getElementById('detailBack').onclick = () => closeSheet();
  document.getElementById('detailEdit').onclick = () => openEditShadchan(id);
  document.getElementById('shadAttachTile')?.addEventListener('click', () => { document.getElementById('openAttachment')?.click(); });

  const rerender = () => openShadchan(id);
  wireContactRow(sheet, x, { name: x.name, phone: x.phone, email: x.email }, async () => {
    x.waitingForReply = !x.waitingForReply;
    addActivity(x, x.waitingForReply ? { type: 'action', action: 'Waiting for reply', text: 'Marked waiting for reply.' } : { type: 'action', action: 'Reply received', text: 'Cleared waiting for reply.' });
    x.waitingForReplySince = x.waitingForReply ? stamp() : '';
    await save();
    rerender();
    renderShadchanim();
  });
  sheet.querySelectorAll('.reminderBtn[data-offset]').forEach((btn) => {
    btn.onclick = async () => {
      const offset = Number(btn.dataset.offset);
      const value = todayKey(offset);
      if (x.callReminderDate === value) return;
      x.callReminderDate = value;
      addActivity(x, { type: 'action', action: 'Call reminder set', text: `Call ${x.name || 'Shadchan'} ${offset === 0 ? 'today' : 'tomorrow'}.` });
      await save();
      rerender();
      renderShadchanim();
    };
  });
  document.getElementById('reminderClear').onclick = async () => { await clearShadchanReminder(id); rerender(); renderShadchanim(); };
  sheet.querySelectorAll('.chipBtn').forEach((btn) => { btn.onclick = () => openGuyGirl(btn.dataset.k, Number(btn.dataset.id) || btn.dataset.id); });
  wireAttachmentDetail(sheet, x);
  linkPhoneNumbers(sheet, x);
  wireTalked(sheet);
  bindQuickSave(sheet, x, () => renderShadchanim());
  wireHistoryDeletes(sheet, state, 'shadchanim', id, async () => { rerender(); renderShadchanim(); });
  mountComposer(sheet, x, async () => { rerender(); renderShadchanim(); });
}
