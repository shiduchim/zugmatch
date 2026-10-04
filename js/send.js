/* Everything outgoing, in one place: the contact buttons and compose sheets, the inline
   phone picker, the ONE WhatsApp send queue (approved fix #1) built on the ONE WhatsApp
   opener (approved fix #5), SMS/Email with the language dialog, and the shadchan contact
   card share. */

import { state, save, lsGetJSON, lsSetJSON } from './db.js';
import { esc, stamp, whatsAppDigits, isLandline, filterLanguageLines, scriptsIn, stripBold } from './util.js';
import { addActivity, writeSharePair } from './history.js';
import { openSheet, closeSheet, getSelected, clearSelected, reopenCurrent } from './app.js';

const QUEUE_KEY = 'WaSendQueue';
const isAndroid = () => /Android/i.test(navigator.userAgent || '');

/* ---------- The one WhatsApp opener (approved fix #5) ---------- */

export function openWhatsApp(phone, text) {
  const digits = phone ? whatsAppDigits(phone) : '';
  const encoded = encodeURIComponent(text || '');
  if (isAndroid()) {
    location.href = digits ? `whatsapp://send?phone=${encodeURIComponent(digits)}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
    return;
  }
  location.href = digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function callHref(phone) {
  return 'tel:' + String(phone || '').trim();
}
export function smsHref(phone, body) {
  return 'sms:' + String(phone || '').trim() + (body ? '?body=' + encodeURIComponent(body) : '');
}
export function mailtoHref(email, subject, body) {
  const params = [];
  if (subject) params.push('subject=' + encodeURIComponent(subject));
  if (body) params.push('body=' + encodeURIComponent(body));
  return 'mailto:' + encodeURIComponent(email || '') + (params.length ? '?' + params.join('&') : '');
}

/* ---------- Activity logging shared by every outgoing path ---------- */

async function logChannel(record, entry) {
  addActivity(record, entry);
  await save();
}

/* ---------- Direct actions: Contacts card + inline phone picker (no compose sheet) ---------- */

export async function directCall(record, { name, phone, side }) {
  if (!phone) return;
  await logChannel(record, { type: 'action', action: (side ? side + ' • Call' : 'Call'), text: `Call opened to ${name || side || 'contact'} (${phone}).`, recipient: name || '', recipientPhone: phone, recipientSide: side || '' });
  location.href = callHref(phone);
}
export async function directSms(record, { name, phone, side }) {
  if (!phone) return;
  await logChannel(record, { type: 'action', action: (side ? side + ' • SMS' : 'SMS'), text: `SMS opened to ${name || side || 'contact'} (${phone}).`, recipient: name || '', recipientPhone: phone, recipientSide: side || '' });
  location.href = smsHref(phone);
}
export async function directWhatsApp(record, { name, phone, side }) {
  if (!phone) return;
  await logChannel(record, { type: 'action', action: (side ? side + ' • WhatsApp' : 'WhatsApp'), text: `WhatsApp opened to ${name || side || 'contact'} (${phone}).`, recipient: name || '', recipientPhone: phone, recipientSide: side || '' });
  openWhatsApp(phone, '');
}

/* ---------- Inline phone-number picker: "Open phone number" Call | WhatsApp | Cancel ---------- */

export function openPhonePicker(record, rawPhone) {
  document.getElementById('phonePicker')?.remove();
  const shade = document.createElement('div');
  shade.id = 'phonePicker';
  shade.className = 'pickerShade';
  shade.innerHTML = `<div class="pickerSheet"><div class="pickerTitle">Open phone number</div><div class="small" style="margin-bottom:12px">${esc(rawPhone)}</div>
    <div class="row"><button type="button" class="lightblue full" id="phonePickCall">Call</button></div><div class="gap"></div>
    <div class="row"><button type="button" class="lightblue full" id="phonePickWa">WhatsApp</button></div><div class="gap"></div>
    <button type="button" class="secondary full" id="phonePickCancel">Cancel</button></div>`;
  document.body.appendChild(shade);
  const close = () => shade.remove();
  shade.querySelector('#phonePickCall').onclick = async () => { close(); await directCall(record, { name: '', phone: rawPhone, side: 'Profile phone' }); };
  shade.querySelector('#phonePickWa').onclick = async () => { close(); await directWhatsApp(record, { name: '', phone: rawPhone, side: 'Profile phone' }); };
  shade.querySelector('#phonePickCancel').onclick = close;
  shade.onclick = (e) => { if (e.target === shade) close(); };
}

/* ---------- Compose-first sheet: the main Contact row (Guy/Girl -> contact 1, Shadchan -> itself) ---------- */

export function openComposeSheet(record, { name, phone, email }, channel) {
  if ((channel === 'WhatsApp' || channel === 'SMS') && !phone) return alert('Add a phone number first.');
  if (channel === 'Email' && !email) return alert('Add an email first.');
  openSheet(`<h2>${esc(channel)} message</h2><div class="small">To: ${esc(name || '')}${channel === 'Email' ? (email ? ' • ' + esc(email) : '') : (phone ? ' • ' + esc(phone) : '')}</div>
    <label>Message<textarea id="composeText" placeholder="Type your message…"></textarea></label>
    <div class="row"><button type="button" class="primary full" id="composeContinue">Continue</button></div><div class="gap"></div>
    <button type="button" class="secondary full" id="composeCancel">Cancel</button>`);
  document.getElementById('composeCancel').onclick = () => reopenCurrent();
  document.getElementById('composeContinue').onclick = async () => {
    const text = document.getElementById('composeText').value.trim();
    if (!text) return alert('Type a message first.');
    let type, action, target;
    if (channel === 'WhatsApp') { type = 'wa-out'; action = 'You → WhatsApp'; target = null; }
    else if (channel === 'SMS') { type = 'sms-out'; action = 'You → SMS'; target = smsHref(phone, text); }
    else { type = 'email-out'; action = 'You → Email'; target = mailtoHref(email, '', text); }
    await logChannel(record, { type, action, text, recipient: name || '', recipientPhone: phone || '', recipientEmail: email || '' });
    closeSheet();
    if (channel === 'WhatsApp') openWhatsApp(phone, text);
    else location.href = target;
  };
}

/* ---------- Main Contact row markup (Guy/Girl and Shadchan detail) ---------- */

export function contactRowHtml({ label, showWaiting, waiting }) {
  return `<div class="pmContactLabel">${esc(label)}</div><div class="contactRow">
    <button type="button" class="lightblue" data-act="call">Call</button>
    <button type="button" class="lightblue" data-act="email">Email</button>
    <button type="button" class="lightblue" data-act="wa">WhatsApp</button>
    <button type="button" class="lightblue" data-act="sms">SMS</button>
    ${showWaiting ? `<button type="button" class="waitToggle${waiting ? ' waiting' : ''}" data-act="waiting">Waiting<br>for reply</button>` : ''}
  </div>`;
}

export function wireContactRow(container, record, { name, phone, email }, onWaitingToggled) {
  const row = container.querySelector('.contactRow');
  if (!row) return;
  const callBtn = row.querySelector('[data-act="call"]');
  const smsBtn = row.querySelector('[data-act="sms"]');
  callBtn.onclick = async () => { if (!phone) return alert('Add a phone number first.'); await logChannel(record, { type: 'action', action: 'Call', text: `Call opened to ${name || 'contact'} (${phone}).`, recipient: name || '', recipientPhone: phone }); location.href = callHref(phone); };
  row.querySelector('[data-act="email"]').onclick = () => openComposeSheet(record, { name, phone, email }, 'Email');
  row.querySelector('[data-act="wa"]').onclick = () => openComposeSheet(record, { name, phone, email }, 'WhatsApp');
  smsBtn.onclick = () => openComposeSheet(record, { name, phone, email }, 'SMS');
  if (isLandline(phone)) { smsBtn.disabled = true; smsBtn.title = 'SMS unavailable for Israeli landline'; }
  const waitBtn = row.querySelector('[data-act="waiting"]');
  if (waitBtn) waitBtn.onclick = () => onWaitingToggled();
}

/* ---------- Contacts card: Profile / Contact 1 / Contact 2, direct actions ---------- */

export function contactsCardHtml(rows) {
  return `<div class="card"><div class="sectionTitle" style="margin-top:0">Contacts</div>${rows
    .map(
      (r, i) => `<div class="contactCardRow" data-row="${i}"><div class="small"><b>${esc(r.kind)}:</b> ${esc(r.name || 'Not added')}</div>
      ${r.phone ? `<div class="small" style="color:var(--accent);font-weight:800">${esc(r.phone)}</div><div class="actions" style="margin-top:6px"><button type="button" class="lightblue" data-act="call">Call</button><button type="button" class="lightblue" data-act="sms">SMS</button><button type="button" class="lightblue" data-act="wa">WhatsApp</button></div>` : `<div class="small" style="font-style:italic">No phone number</div>`}
      </div>`
    )
    .join('')}</div>`;
}

export function wireContactsCard(container, record, rows) {
  container.querySelectorAll('.contactCardRow').forEach((el) => {
    const r = rows[Number(el.dataset.row)];
    if (!r.phone) return;
    el.querySelector('[data-act="call"]').onclick = () => directCall(record, { name: r.name, phone: r.phone, side: r.kind });
    el.querySelector('[data-act="sms"]').onclick = () => directSms(record, { name: r.name, phone: r.phone, side: r.kind });
    el.querySelector('[data-act="wa"]').onclick = () => directWhatsApp(record, { name: r.name, phone: r.phone, side: r.kind });
  });
}

/* ---------- Shadchan contact card share (Contacts tile, or Shadchanim selection bar with no profiles) ---------- */

function shadContactText(x) {
  return [stripBold(x?.name) || 'Unnamed shadchan', x?.phone ? 'Phone: ' + x.phone : '', x?.email ? 'Email: ' + x.email : '', x?.tags ? 'Tags: ' + x.tags : ''].filter(Boolean).join('\n');
}

/* ---------- SMS / Email language dialog (approved: applies wherever profile text is shared) ---------- */

function languagesPresent(items) {
  const all = items.map((x) => x.text || '').join('\n');
  return scriptsIn(all);
}
function askLanguages(items, channelLabel) {
  return new Promise((resolve) => {
    const present = languagesPresent(items);
    if (!present.en && !present.he && !present.ru) return resolve({ en: true, he: true, ru: true });
    const first = items[0] || {};
    const d = document.createElement('div');
    d.className = 'pickerShade';
    d.innerHTML = `<div class="pickerSheet"><div class="pickerTitle">What language should be included?</div>
      <div style="display:flex;gap:13px;flex-wrap:wrap;margin:8px 0 14px">
      ${present.en ? `<label style="margin:0"><input data-l="en" type="checkbox" ${first.shareEnglish !== false ? 'checked' : ''} style="width:auto"> English</label>` : ''}
      ${present.he ? `<label style="margin:0"><input data-l="he" type="checkbox" ${first.shareHebrew !== false ? 'checked' : ''} style="width:auto"> Hebrew</label>` : ''}
      ${present.ru ? `<label style="margin:0"><input data-l="ru" type="checkbox" ${first.shareRussian !== false ? 'checked' : ''} style="width:auto"> Russian</label>` : ''}
      </div><button type="button" class="primary full" id="langGo">Continue to ${esc(channelLabel)}</button><div class="gap"></div><button type="button" class="secondary full" id="langCancel">Cancel</button></div>`;
    document.body.appendChild(d);
    d.querySelector('#langCancel').onclick = () => { d.remove(); resolve(null); };
    d.onclick = (e) => { if (e.target === d) { d.remove(); resolve(null); } };
    d.querySelector('#langGo').onclick = () => {
      const f = { en: !!d.querySelector('[data-l="en"]')?.checked, he: !!d.querySelector('[data-l="he"]')?.checked, ru: !!d.querySelector('[data-l="ru"]')?.checked };
      if (!f.en && !f.he && !f.ru) return alert('Keep at least one language checked.');
      d.remove();
      resolve(f);
    };
  });
}

export function shareText(x, langFlags) {
  const body = langFlags ? filterLanguageLines(x.text || '', langFlags) : String(x.text || '');
  const senderName = String(x.contact1Name || x.sourceName || x.source || '').trim();
  const senderPhone = String(x.contact1Phone || x.sourcePhone || '').trim();
  return [x.name || 'Unnamed profile', x.age ? 'Age: ' + x.age : '', body, senderName ? 'Sent by: ' + senderName : '', senderPhone ? 'Sender phone: ' + senderPhone : ''].filter(Boolean).join('\n');
}

function fullPhoto(x) {
  return x?.profileMediaFull || x?.profileMedia || x?.profileImage || x?.photo || null;
}
function safeFileBase(s) {
  return String(s || 'profile').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'profile';
}
function photoFile(x) {
  const blob = fullPhoto(x);
  if (!(blob instanceof Blob)) return null;
  const type = blob.type || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg';
  try { return blob instanceof File ? blob : new File([blob], safeFileBase(x.name) + '.' + ext, { type }); } catch { return blob; }
}
function isPdfAttachment(x) {
  return x?.profileAttachment instanceof Blob && (/pdf/i.test(x.profileAttachmentType || x.profileAttachment.type || '') || /\.pdf$/i.test(x.profileAttachmentName || ''));
}
function pdfFile(x) {
  if (!isPdfAttachment(x)) return null;
  const b = x.profileAttachment;
  const name = /\.pdf$/i.test(x.profileAttachmentName || '') ? x.profileAttachmentName : safeFileBase(x.name) + '.pdf';
  try { return b instanceof File ? b : new File([b], name, { type: 'application/pdf' }); } catch { return b; }
}
function canShareFiles(files) {
  if (typeof navigator.share !== 'function') return false;
  if (!navigator.canShare) return true;
  try { return navigator.canShare({ files }); } catch { return false; }
}
function downloadFile(file) {
  const u = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = u; a.download = file.name || 'profile'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}

async function emailProfiles(items, langFlags) {
  const subject = 'Selected profiles';
  const body = items.map((x) => shareText(x, langFlags)).join('\n\n--------------------\n\n');
  const files = items.map(photoFile).filter(Boolean);
  if (files.length && canShareFiles(files)) {
    try {
      await navigator.share({ title: subject, text: body, files });
      for (const x of items) await logChannel(x, { type: 'action', action: 'Profile shared • Email', text: 'Profile sharing opened via Email.' });
      return;
    } catch (e) { if (e?.name === 'AbortError') return; }
  }
  for (const x of items) await logChannel(x, { type: 'action', action: 'Profile shared • Email', text: 'Profile sharing opened via Email.' });
  let url = mailtoHref('', subject, body);
  if (url.length > 16000) { try { await navigator.clipboard.writeText(body); } catch { /* ignore */ } url = mailtoHref('', subject, ''); }
  location.href = url;
}

function smsQueueOverlay(items, langFlags) {
  return new Promise((resolve) => {
    let i = 0;
    const draw = () => {
      document.getElementById('smsQueue')?.remove();
      if (i >= items.length) return resolve();
      const x = items[i];
      const d = document.createElement('div');
      d.id = 'smsQueue'; d.className = 'pickerShade';
      d.innerHTML = `<div class="pickerSheet"><b>SMS profiles separately</b><div class="small" style="margin:6px 0 12px">${i + 1} of ${items.length}: ${esc(stripBold(x.name) || 'Unnamed profile')}</div><button type="button" class="primary full" id="smsNext">Open this SMS</button><div class="gap"></div><button type="button" class="secondary full" id="smsStop">Cancel</button></div>`;
      document.body.appendChild(d);
      d.querySelector('#smsStop').onclick = () => { d.remove(); resolve(); };
      d.querySelector('#smsNext').onclick = async () => {
        const text = filterLanguageLines(x.text || '', langFlags).replace(/\*+/g, '');
        await logChannel(x, { type: 'sms-out', action: 'You → SMS', text });
        i++; draw();
        location.href = smsHref('', text);
      };
    };
    draw();
  });
}

/* ---------- Selection-bar Email / SMS entry points (used by lists.js) ---------- */

export async function shareSelectionEmail(kind) {
  const items = getSelected(kind);
  if (!items.length) return;
  const flags = await askLanguages(items, 'Email');
  if (!flags) return;
  await emailProfiles(items, flags);
}
export async function shareSelectionSms(kind) {
  const items = getSelected(kind);
  if (!items.length) return;
  const flags = await askLanguages(items, 'SMS');
  if (!flags) return;
  if (items.length === 1) {
    const text = filterLanguageLines(items[0].text || '', flags).replace(/\*+/g, '');
    await logChannel(items[0], { type: 'sms-out', action: 'You → SMS', text });
    location.href = smsHref('', text);
    return;
  }
  await smsQueueOverlay(items, flags);
}

/* ---------- Recipient picker: "Who are you sending this to?" ---------- */

function pickRecipient() {
  return new Promise((resolve) => {
    document.getElementById('recipientPicker')?.remove();
    const shade = document.createElement('div');
    shade.id = 'recipientPicker';
    shade.className = 'pickerShade';
    const options = [...state.shadchanim].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    shade.innerHTML = `<div class="pickerSheet"><div class="pickerTitle">Who are you sending this to?</div>
      <label>Existing Shadchan (optional)<select id="pickShad"><option value="">Choose Shadchan (optional)</option>${options.map((s) => `<option value="${s.id}">${esc(s.name)}${s.phone ? ' • ' + esc(s.phone) : ''}</option>`).join('')}</select></label>
      <label>Name<input id="pickName" placeholder="Recipient name (optional)"></label>
      <label>Phone (optional)<input id="pickPhone" type="tel" placeholder="Phone number (optional)"></label>
      <div class="small" style="margin:2px 0 10px">No phone? WhatsApp opens and you choose the recipient there.</div>
      <button type="button" class="primary full" id="pickGo">Continue to WhatsApp</button><div class="gap"></div><button type="button" class="secondary full" id="pickCancel">Cancel</button></div>`;
    document.body.appendChild(shade);
    const sel = shade.querySelector('#pickShad'), nameEl = shade.querySelector('#pickName'), phoneEl = shade.querySelector('#pickPhone');
    sel.onchange = () => { const s = options.find((z) => String(z.id) === sel.value); if (s) { nameEl.value = s.name || ''; phoneEl.value = s.phone || ''; } };
    const close = (v) => { shade.remove(); resolve(v); };
    shade.querySelector('#pickCancel').onclick = () => close(null);
    shade.onclick = (e) => { if (e.target === shade) close(null); };
    shade.querySelector('#pickGo').onclick = () => {
      const s = options.find((z) => String(z.id) === sel.value);
      close({ shadchanId: s ? s.id : null, name: nameEl.value.trim() || (s ? s.name : ''), phone: phoneEl.value.trim() || (s ? s.phone : '') });
    };
  });
}

/* ---------- The ONE WhatsApp send queue (approved fix #1) ---------- */

function loadQueue() { return lsGetJSON(QUEUE_KEY, null); }
function saveQueue(q) { lsSetJSON(QUEUE_KEY, q); }
function findProfile(kind, id) { return (state[kind] || []).find((x) => String(x.id) === String(id)) || null; }
function findShad(id) { return id == null ? null : state.shadchanim.find((x) => String(x.id) === String(id)) || null; }

function taskRecipient(q, task) {
  if (task.shadId != null) { const s = findShad(task.shadId); return s ? { shadchanId: s.id, name: s.name || 'Shadchan', phone: s.phone || '' } : null; }
  return q.recipient || null;
}

function advanceQueue(q) {
  q.index++;
  q.stage = 'main';
  if (q.index >= q.tasks.length) saveQueue(null);
  else saveQueue(q);
  renderQueueBar();
}

async function sendMainTask() {
  const q = loadQueue();
  const task = q?.tasks?.[q.index];
  if (!q || !task || q.stage !== 'main') return;
  if (task.type === 'shadContact') {
    const sh = findShad(task.shadId);
    if (!sh) { advanceQueue(q); return; }
    await logChannel(sh, { type: 'action', action: 'Shadchan shared • WhatsApp', text: shadContactText(sh) });
    advanceQueue(q);
    openWhatsApp('', shadContactText(sh));
    return;
  }
  const x = findProfile(task.profileKind, task.profileId);
  const recipient = taskRecipient(q, task);
  if (!x) { advanceQueue(q); return; }
  const pf = pdfFile(x);
  if (pf) {
    if (canShareFiles([pf])) {
      try { await navigator.share({ title: x.name || 'Shidduch profile', files: [pf] }); } catch (e) { if (e?.name === 'AbortError') return; alert('Could not open the PDF share.'); return; }
    } else { downloadFile(pf); alert('The PDF was saved to your device. Attach it in WhatsApp.'); }
    if (recipient?.shadchanId != null) { const sh = findShad(recipient.shadchanId); if (sh) await writeSharePair({ profileKind: task.profileKind, profile: x, shadchan: sh, text: 'PDF profile shared: ' + (x.profileAttachmentName || 'profile.pdf'), channel: 'WhatsApp' }); await save(); }
    else await logChannel(x, { type: 'action', action: 'Profile PDF shared • WhatsApp', text: 'PDF profile shared: ' + (x.profileAttachmentName || 'profile.pdf') });
    if (recipient?.phone) openWhatsApp(recipient.phone, '');
    advanceQueue(q);
    return;
  }
  const text = shareText(x, { en: x.shareEnglish !== false, he: x.shareHebrew !== false, ru: x.shareRussian !== false });
  if (recipient?.shadchanId != null) {
    const sh = findShad(recipient.shadchanId);
    await writeSharePair({ profileKind: task.profileKind, profile: x, shadchan: sh, text, channel: 'WhatsApp' });
    await save();
  } else {
    await logChannel(x, { type: 'action', action: 'Profile shared • WhatsApp', text, recipient: recipient?.name || '', recipientPhone: recipient?.phone || '' });
  }
  if (photoFile(x)) { q.stage = 'photo'; saveQueue(q); renderQueueBar(); } else advanceQueue(q);
  openWhatsApp(recipient?.phone, text);
}

async function sendPhotoTask(send) {
  const q = loadQueue();
  const task = q?.tasks?.[q.index];
  if (!q || !task || q.stage !== 'photo') return;
  const x = findProfile(task.profileKind, task.profileId);
  const file = x && photoFile(x);
  if (!file) { advanceQueue(q); return; }
  if (!send) { advanceQueue(q); return; }
  if (canShareFiles([file])) {
    try { await navigator.share({ files: [file] }); } catch (e) { if (e?.name === 'AbortError') return; alert('Could not open the photo share.'); return; }
  } else { downloadFile(file); alert('Photo sharing is not supported in this browser, so the photo was downloaded. Attach it in WhatsApp.'); }
  advanceQueue(q);
}

function queueLabel(q, task) {
  if (task.type === 'shadContact') { const sh = findShad(task.shadId); return `Send ${stripBold(sh?.name) || 'shadchan'} (${q.index + 1} of ${q.tasks.length})`; }
  const x = findProfile(task.profileKind, task.profileId);
  const recipient = taskRecipient(q, task);
  const name = stripBold(x?.name) || 'profile';
  if (q.stage === 'photo') return `Send ${name}’s photo?`;
  const who = recipient?.name || recipient?.phone || 'recipient';
  return q.tasks.length > 1 ? `Send ${name} to ${who} (${q.index + 1} of ${q.tasks.length})` : `Send ${name} to ${who}`;
}

export function renderQueueBar() {
  const q = loadQueue();
  let bar = document.getElementById('waQueueBar');
  if (!q || !q.tasks[q.index]) { bar?.remove(); return; }
  const isPhoto = q.stage === 'photo';
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'waQueueBar';
    bar.innerHTML = `<span id="waQueueLabel"></span><span class="waQueueActions">
      <button type="button" id="waQueueSend">Send</button><button type="button" id="waQueueCancel" class="secondary">Cancel</button>
      <button type="button" id="waQueuePhotoYes">Yes</button><button type="button" id="waQueuePhotoNo" class="secondary">No</button></span>`;
    document.body.appendChild(bar);
    bar.querySelector('#waQueueSend').onclick = sendMainTask;
    bar.querySelector('#waQueueCancel').onclick = () => { saveQueue(null); renderQueueBar(); };
    bar.querySelector('#waQueuePhotoYes').onclick = () => sendPhotoTask(true);
    bar.querySelector('#waQueuePhotoNo').onclick = () => sendPhotoTask(false);
  }
  bar.querySelector('#waQueueLabel').textContent = queueLabel(q, q.tasks[q.index]);
  bar.querySelector('#waQueueSend').style.display = isPhoto ? 'none' : '';
  bar.querySelector('#waQueueCancel').style.display = isPhoto ? 'none' : '';
  bar.querySelector('#waQueuePhotoYes').style.display = isPhoto ? '' : 'none';
  bar.querySelector('#waQueuePhotoNo').style.display = isPhoto ? '' : 'none';
}

window.addEventListener('focus', () => setTimeout(renderQueueBar, 80));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(renderQueueBar, 80); });

/* ---------- Selection-bar WhatsApp router (Guys/Girls and Shadchanim tabs) ---------- */

export async function shareSelectionWhatsApp(kind) {
  const guys = getSelected('guys'), girls = getSelected('girls'), shads = getSelected('shadchanim');
  if (kind === 'shadchanim' && !guys.length && !girls.length) {
    if (!shads.length) return;
    saveQueue({ tasks: shads.map((s) => ({ type: 'shadContact', shadId: s.id })), index: 0, stage: 'main' });
    clearSelected('shadchanim');
    await sendMainTask();
    return;
  }

  const profileKind = guys.length ? 'guys' : 'girls';
  const items = guys.length ? guys : girls;
  if (guys.length && girls.length) return alert('Select only Guy profiles or only Girl profiles (not both) before sending on WhatsApp.');
  if (!items.length) return;

  /* Case A: any selected profile has a PDF attachment. */
  if (items.some(isPdfAttachment)) {
    if (shads.length > 1 && items.length !== 1) return alert('When sending to multiple Shadchanim, select only one Guy or one Girl.');
    const build = (recipient) => {
      let tasks;
      if (shads.length > 1) tasks = shads.map((s) => ({ type: 'profile', profileKind, profileId: items[0].id, shadId: s.id }));
      else if (shads.length === 1) tasks = items.map((x) => ({ type: 'profile', profileKind, profileId: x.id, shadId: shads[0].id }));
      else tasks = items.map((x) => ({ type: 'profile', profileKind, profileId: x.id, shadId: null }));
      saveQueue({ tasks, index: 0, stage: 'main', recipient });
      clearSelected(profileKind); if (shads.length) clearSelected('shadchanim');
      sendMainTask();
    };
    if (shads.length) { build(null); return; }
    const recipient = await pickRecipient();
    if (!recipient) return;
    build(recipient);
    return;
  }

  /* Case B: one profile + two or more shadchanim -> recipient by recipient. */
  if (shads.length > 1) {
    if (items.length !== 1) return alert('When sending to multiple Shadchanim, select only one Guy or one Girl.');
    saveQueue({ tasks: shads.map((s) => ({ type: 'profile', profileKind, profileId: items[0].id, shadId: s.id })), index: 0, stage: 'main' });
    clearSelected(profileKind); clearSelected('shadchanim');
    await sendMainTask();
    return;
  }

  /* Case C: profiles + exactly one shadchan. */
  if (shads.length === 1) {
    saveQueue({ tasks: items.map((x) => ({ type: 'profile', profileKind, profileId: x.id, shadId: shads[0].id })), index: 0, stage: 'main' });
    clearSelected(profileKind); clearSelected('shadchanim');
    await sendMainTask();
    return;
  }

  /* Case D: no shadchan selected -> recipient picker. */
  const recipient = await pickRecipient();
  if (!recipient) return;
  saveQueue({ tasks: items.map((x) => ({ type: 'profile', profileKind, profileId: x.id, shadId: recipient.shadchanId })), index: 0, stage: 'main', recipient });
  clearSelected(profileKind);
  await sendMainTask();
}
