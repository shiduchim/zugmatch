/* History: activities on Guy/Girl/Shadchan records.
   Owns: writing activities (including share pairs, written once, correctly — approved fix #2),
   deleting an activity together with its paired side, rendering the History band, the
   Note/mic composer, and the after-call popup. No background reconciliation loop: PeerMatch's
   old history is repaired once (copy from PeerMatch, or WhatsApp import), respecting its
   deletion tombstones; from then on zugmatch's own writes are already correct pairs. */

import { esc, stamp, nextId, newLinkId, phoneKey, objectUrl } from './util.js';
import { save, lsGet, lsSet, lsRemove } from './db.js';

/* ---------- Writing activities ---------- */

export function addActivity(record, partial) {
  record.activities = record.activities || [];
  const a = { id: nextId(), ts: stamp(), ...partial };
  record.activities.push(a);
  return a;
}

/* Both sides of a profile <-> shadchan share, written together, linked by one shareLinkId.
   Matches PeerMatch's dual-share-history-v100.js field shape so backups stay compatible. */
export function writeSharePair({ profileKind, profile, shadchan, text, channel, direction }) {
  const shareLinkId = newLinkId();
  const profileName = String(profile.name || 'Unnamed profile');
  const shadchanName = String(shadchan.name || 'Unnamed shadchan');

  const profileActivity = addActivity(profile, {
    type: 'action',
    action: direction === 'in' ? `Profile received • ${channel}` : `Profile sent • ${channel}`,
    text,
    channel: channel.toLowerCase(),
    recipient: shadchanName,
    recipientPhone: String(shadchan.phone || ''),
    recipientEmail: String(shadchan.email || ''),
    recipientSide: 'Shadchan',
    recipientShadchanId: shadchan.id,
    shadchanId: shadchan.id,
    sharedProfileId: profile.id,
    sharedProfileName: profileName,
    sharedProfileKind: profileKind,
    shareLinkId
  });

  const shadchanActivity = addActivity(shadchan, {
    type: 'action',
    action: direction === 'in' ? `Profile sent • ${channel}` : `Profile received • ${channel}`,
    text,
    channel: channel.toLowerCase(),
    sharedProfileId: profile.id,
    sharedProfileName: profileName,
    sharedProfileKind: profileKind,
    profileId: profile.id,
    profileName,
    shareLinkId
  });

  return { profileActivity, shadchanActivity, shareLinkId };
}

/* A Make Match send: written on the guy, the girl and (if chosen) the shadchan, one matchId.
   `label` is the text after "Match sent • " / "Match contact • " — the channel name for a
   send, or the recipient's description for a plain contact (call). */
export function writeMatchActivities({ guy, girl, shadchan, label, text, isContact, extra }) {
  const matchId = newLinkId();
  const action = (isContact ? 'Match contact • ' : 'Match sent • ') + label;
  const base = { type: 'action', action, text, matchId, guyId: guy.id, girlId: girl.id, shadchanId: shadchan ? shadchan.id : null, ...extra };
  const acts = [addActivity(guy, { ...base }), addActivity(girl, { ...base })];
  if (shadchan) acts.push(addActivity(shadchan, { ...base }));
  return { matchId, activities: acts };
}

/* ---------- Deleting ---------- */

function findRecord(state, kind, id) {
  return (state[kind] || []).find((x) => String(x.id) === String(id)) || null;
}

/* Removes one activity, and — for a linked share — the paired activity on the other record too. */
export function deleteActivity(state, kind, id, activityId) {
  const record = findRecord(state, kind, id);
  if (!record || !Array.isArray(record.activities)) return false;
  const target = record.activities.find((a) => String(a.id) === String(activityId));
  if (!target) return false;

  const link = String(target.shareLinkId || target.matchId || '');
  let removed = 0;
  for (const k of ['shadchanim', 'guys', 'girls']) {
    for (const rec of state[k] || []) {
      if (!Array.isArray(rec.activities)) continue;
      const before = rec.activities.length;
      rec.activities = rec.activities.filter((a) => {
        const same = rec === record && String(a.id) === String(target.id);
        const linked = !!link && String(a.shareLinkId || a.matchId || '') === link;
        return !(same || linked);
      });
      removed += before - rec.activities.length;
    }
  }
  return removed > 0;
}

/* ---------- One-time legacy repair (copy from PeerMatch, or WhatsApp import) ---------- */

const PM_TOMBSTONE_KEY = 'pmDeletedShareHistoryV127';

function norm(s) {
  return String(s || '').trim().toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function hash(s) {
  let h = 0x811c9dc5 >>> 0;
  for (const c of String(s || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
function isProfileWhatsApp(a) {
  if (!a) return false;
  const action = String(a.action || '').toLowerCase(), channel = String(a.channel || '').toLowerCase();
  if (action.includes('match')) return false;
  if (action.includes('profile') && action.includes('whatsapp')) return true;
  return channel === 'whatsapp' && (a.sharedProfileId != null || a.profileId != null || a.recipientSide === 'Profile share');
}
function firstTextName(a) {
  return norm((String(a?.text || '').split(/\r?\n/).find((x) => String(x || '').trim()) || ''));
}
function legacyKey(kind, record, a) {
  if (!record || !a) return '';
  let p = '', s = '';
  if (kind === 'guys' || kind === 'girls') p = 'id:' + String(record.id);
  else if (a.sharedProfileId != null || a.profileId != null) p = 'id:' + String(a.sharedProfileId ?? a.profileId);
  else { const n = norm(a.sharedProfileName || a.profileName) || firstTextName(a); if (n) p = 'name:' + n; }

  if (kind === 'shadchanim') s = 'id:' + String(record.id);
  else if (a.recipientShadchanId != null || a.shadchanId != null || a.linkedShadchanId != null) s = 'id:' + String(a.recipientShadchanId ?? a.shadchanId ?? a.linkedShadchanId);
  else { const ph = phoneKey(a.recipientPhone); if (ph) s = 'phone:' + ph; else { const n = norm(a.recipient); if (n) s = 'name:' + n; } }

  if (!p || !s) return '';
  return 'legacy:' + p + '|' + s + '|' + hash(String(a.text || '').trim()) + '|' + hash(String(a.ts || ''));
}
function readPeerMatchTombstones() {
  try {
    const a = JSON.parse(localStorage.getItem(PM_TOMBSTONE_KEY) || '[]');
    return new Set(Array.isArray(a) ? a : []);
  } catch { return new Set(); }
}
function isDeletedInPeerMatch(kind, record, a, tombs) {
  const link = String(a?.shareLinkId || '');
  if (link) return tombs.has('link:' + link);
  const lk = legacyKey(kind, record, a);
  return !!lk && tombs.has(lk);
}

function shadByRecipient(state, a) {
  const arr = state.shadchanim || [];
  for (const id of [a?.recipientShadchanId, a?.shadchanId, a?.linkedShadchanId]) {
    if (id != null) { const s = arr.find((z) => String(z.id) === String(id)); if (s) return s; }
  }
  const pk = phoneKey(a?.recipientPhone);
  if (pk) { const s = arr.find((z) => phoneKey(z.phone) === pk); if (s) return s; }
  const n = norm(a?.recipient);
  if (n) { const s = arr.find((z) => norm(z.name) === n); if (s) return s; }
  return null;
}
function allProfiles(state) {
  const out = [];
  for (const k of ['guys', 'girls']) for (const x of state[k] || []) out.push({ k, x });
  return out;
}
function profileFromShadActivity(state, a) {
  const profiles = allProfiles(state);
  for (const id of [a?.sharedProfileId, a?.profileId]) {
    if (id != null) { const p = profiles.find((z) => String(z.x.id) === String(id)); if (p) return p; }
  }
  const named = norm(a?.sharedProfileName || a?.profileName);
  if (named) { const p = profiles.find((z) => norm(z.x.name) === named); if (p) return p; }
  const first = firstTextName(a);
  if (first) { const p = profiles.find((z) => norm(z.x.name) === first); if (p) return p; }
  const text = String(a?.text || '').trim();
  if (!text) return null;
  const candidates = profiles.filter((z) => { const n = String(z.x.name || '').trim(); return n && text.includes(n); });
  return candidates.length === 1 ? candidates[0] : null;
}
const sameMessage = (a, text) => String(a?.text || '').trim() === String(text || '').trim();

function profileAlreadyHas(profile, shad, text, source) {
  const sourceId = source?.id, link = String(source?.shareLinkId || '');
  const sp = phoneKey(shad?.phone), sn = norm(shad?.name);
  return (profile.activities || []).some((a) => {
    if (link && String(a.shareLinkId || '') === link) return true;
    if (sourceId != null && String(a.mirroredFromShadchanActivityId || '') === String(sourceId)) return true;
    if (link) return false;
    if (!isProfileWhatsApp(a) || !sameMessage(a, text)) return false;
    const ap = phoneKey(a.recipientPhone), an = norm(a.recipient);
    return (sp && ap === sp) || (sn && an === sn) || String(a.recipientShadchanId || a.shadchanId || '') === String(shad?.id || '');
  });
}
function shadAlreadyHas(shad, profile, text, source) {
  const sourceId = source?.id, link = String(source?.shareLinkId || ''), pn = norm(profile?.name);
  return (shad.activities || []).some((a) => {
    if (link && String(a.shareLinkId || '') === link) return true;
    if (sourceId != null && String(a.mirroredFromProfileActivityId || '') === String(sourceId)) return true;
    if (link) return false;
    if (!isProfileWhatsApp(a) || !sameMessage(a, text)) return false;
    const direct = String(a.sharedProfileId || a.profileId || '') === String(profile?.id || '');
    const named = pn && norm(a.sharedProfileName || a.profileName) === pn;
    if (direct || named) return true;
    return firstTextName(a) === pn;
  });
}

/* Runs once (not on a loop). Fills in whichever side of a legacy PeerMatch share is missing,
   skipping anything PeerMatch's own tombstones say was deliberately deleted. */
export function repairShareHistoryOnce(state) {
  const tombs = readPeerMatchTombstones();
  let changed = false;

  for (const k of ['guys', 'girls']) {
    for (const profile of state[k] || []) {
      for (const a of [...(profile.activities || [])]) {
        if (!isProfileWhatsApp(a) || isDeletedInPeerMatch(k, profile, a, tombs)) continue;
        const shad = shadByRecipient(state, a);
        if (!shad) continue;
        const text = String(a.text || '');
        if (shadAlreadyHas(shad, profile, text, a)) continue;
        addActivity(shad, {
          type: 'action', action: 'Profile received • WhatsApp', text,
          ts: a.ts || stamp(), channel: 'whatsapp', sharedProfileId: profile.id,
          sharedProfileName: String(profile.name || 'Unnamed profile'), sharedProfileKind: k,
          profileId: profile.id, profileName: String(profile.name || 'Unnamed profile'),
          mirroredFromProfileActivityId: a.id,
          shareLinkId: a.shareLinkId || newLinkId()
        });
        changed = true;
      }
    }
  }

  for (const shad of state.shadchanim || []) {
    for (const a of [...(shad.activities || [])]) {
      if (!isProfileWhatsApp(a) || isDeletedInPeerMatch('shadchanim', shad, a, tombs)) continue;
      const found = profileFromShadActivity(state, a);
      if (!found) continue;
      const { k, x: profile } = found;
      const text = String(a.text || '');
      if (profileAlreadyHas(profile, shad, text, a)) continue;
      addActivity(profile, {
        type: 'action', action: 'Profile sent • WhatsApp', text,
        ts: a.ts || stamp(), channel: 'whatsapp', recipient: String(shad.name || 'Shadchan'),
        recipientPhone: String(shad.phone || ''), recipientSide: 'Shadchan',
        recipientShadchanId: shad.id, shadchanId: shad.id, sharedProfileId: profile.id,
        sharedProfileName: String(profile.name || 'Unnamed profile'), sharedProfileKind: k,
        mirroredFromShadchanActivityId: a.id,
        shareLinkId: a.shareLinkId || newLinkId()
      });
      changed = true;
    }
  }

  return changed;
}

/* ---------- Describing activities (list snippets + history cards) ---------- */

export function eventTitle(a) {
  if (a.type === 'audio') return 'Audio note';
  if (a.type === 'call-note') return 'Call status update';
  if (a.type === 'wa-out') return 'You → WhatsApp';
  if (a.type === 'wa-in') return 'WhatsApp → You';
  if (a.type === 'sms-out') return 'You → SMS';
  if (a.type === 'email-out') return 'You → Email';
  if (a.type === 'action') return a.action || 'Action';
  return 'Text note';
}

/* The list card's one-line summary of the most recent activity. */
export function lastActivitySummary(record) {
  if (!record.activities?.length) return 'No notes yet';
  const a = record.activities[record.activities.length - 1];
  const label = a.type === 'wa-out' ? 'You: ' : a.type === 'wa-in' ? 'Reply: ' : a.type === 'audio' ? 'Audio note: ' : '';
  const body = a.type === 'audio' ? 'saved' : (a.text || a.action || '');
  return label + body + ' • ' + (a.ts || '');
}

export function lastWhatsAppState(record) {
  const a = [...(record.activities || [])].reverse().find((z) => z.type === 'wa-out' || z.type === 'wa-in');
  if (!a) return '';
  return a.type === 'wa-out' ? ' • Waiting' : ' • Reply received';
}

/* ---------- History band markup ---------- */

function eventHtml(a, index) {
  const cls = a.type === 'wa-out' ? 'event waOut' : a.type === 'wa-in' ? 'event waIn' : 'event';
  const toLine = a.recipient
    ? `<div class="eventTo">To: ${esc(a.recipient)}${a.recipientPhone ? ' • ' + esc(a.recipientPhone) : ''}${a.recipientEmail ? ' • ' + esc(a.recipientEmail) : ''}</div>`
    : '';
  let body;
  if (a.type === 'audio' || a.type === 'call-note') {
    body = (a.audio ? `<audio controls src="${objectUrl(a.audio)}"></audio>` : '') + (a.text ? `<div class="profileText">${esc(a.text)}</div>` : '');
    if (a.type === 'call-note') body = `<div class="profileText">${esc(a.answered ? 'Answered' : 'Not answered')}${a.durationApproxSec ? ` • ~${a.durationApproxSec}s away` : ''}</div>` + body;
  } else {
    body = `<div class="profileText">${esc(a.text || '')}</div>`;
  }
  return `<div class="${cls}"><div class="eventTop"><span>${esc(eventTitle(a))}</span><span class="eventTopRight"><span>${esc(a.ts || '')}</span><button type="button" class="deleteEvent" data-index="${index}">Delete</button></span></div>${toLine}${body}</div>`;
}

export function renderHistory(record) {
  if (!record.activities?.length) return '<div class="empty">No notes yet.</div>';
  return record.activities
    .map((a, index) => ({ a, index }))
    .reverse()
    .map(({ a, index }) => eventHtml(a, index))
    .join('');
}

/* Wires the Delete links inside a rendered history band. `onChanged` re-renders the caller. */
export function wireHistoryDeletes(container, state, kind, id, onChanged) {
  container.querySelectorAll('.deleteEvent').forEach((btn) => {
    btn.onclick = async () => {
      const record = findRecord(state, kind, id);
      const index = Number(btn.dataset.index);
      const a = record?.activities?.[index];
      if (!a) return;
      if (!confirm('Delete this history entry?\n\n' + eventTitle(a) + '\n' + String(a.ts || ''))) return;
      if (deleteActivity(state, kind, id, a.id)) await onChanged();
    };
  });
}

/* ---------- The fixed Note/mic composer ---------- */

export function mountComposer(container, record, onSaved) {
  const bar = document.createElement('div');
  bar.className = 'composer';
  bar.innerHTML = `<input type="text" class="composerInput" placeholder="Note…" autocomplete="off"><button type="button" class="composerBtn" aria-label="Add note"></button>`;
  container.appendChild(bar);
  const input = bar.querySelector('.composerInput');
  const btn = bar.querySelector('.composerBtn');
  let recorder = null, chunks = [], stream = null;

  function paint() {
    btn.classList.toggle('recording', !!recorder);
    btn.textContent = recorder ? '■' : (input.value.trim() ? '➤' : '●');
  }
  input.addEventListener('input', paint);

  async function sendText() {
    const text = input.value.trim();
    if (!text) return;
    addActivity(record, { type: 'text', text });
    input.value = '';
    await save();
    paint();
    await onSaved();
  }
  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start();
      paint();
    } catch { alert('Microphone permission is required.'); }
  }
  async function stopRecording() {
    const activeRecorder = recorder;
    if (!activeRecorder) return;
    const blob = await new Promise((resolve) => {
      activeRecorder.onstop = () => resolve(new Blob(chunks, { type: activeRecorder.mimeType || 'audio/webm' }));
      activeRecorder.stop();
    });
    stream?.getTracks().forEach((t) => t.stop());
    recorder = null;
    addActivity(record, { type: 'audio', audio: blob });
    await save();
    paint();
    await onSaved();
  }
  btn.onclick = () => {
    if (recorder) stopRecording();
    else if (input.value.trim()) sendText();
    else startRecording();
  };
  paint();
}

/* ---------- After-call popup ---------- */

const CALL_PENDING_KEY = 'CallFollowup';
const ANSWERED_GUESS_THRESHOLD_SEC = 15;
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
const MIN_GAP_MS = 600;
const SHOW_DELAY_MS = 500;

let activeCallContext = null;
let pendingCall = null;
let popupOpen = false;
let followup = { getReminderInfo: () => null, clearReminder: () => {}, reopen: () => {} };

try {
  const raw = lsGet(CALL_PENDING_KEY);
  if (raw) pendingCall = JSON.parse(raw);
} catch { /* ignore */ }

/* Called once at boot with hooks into person.js's Shadchan call-reminder state. */
export function initCallFollowup(hooks) {
  followup = { ...followup, ...hooks };
}

/* Called by person.js whenever a detail page is opened, so the passive Call watcher below
   knows which record a "Call" tap belongs to. */
export function setActiveCallContext(kind, id, record) {
  activeCallContext = record ? { kind, id, record } : null;
}

function extractPhoneNear(el) {
  const scope = el.closest('.contactRow, .contactCardRow, #sheet') || document.body;
  const m = String(scope.textContent || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  return m ? m[0].trim() : '';
}

/* Passive only: never intercepts the real tel: link, just watches for a tap on a button
   whose exact text is "Call", then watches for the app regaining focus afterward. */
document.addEventListener('click', (e) => {
  const el = e.target?.closest?.('button,a');
  if (!el || el.disabled) return;
  if (String(el.textContent || '').trim() !== 'Call') return;
  if (!activeCallContext) return;
  const rec = { kind: activeCallContext.kind, id: activeCallContext.id, name: activeCallContext.record.name || '', phone: extractPhoneNear(el), ts: Date.now() };
  pendingCall = rec;
  lsSet(CALL_PENDING_KEY, JSON.stringify(rec));
}, true);

function clearPending() {
  pendingCall = null;
  lsRemove(CALL_PENDING_KEY);
}

function formatDuration(sec) {
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + 'm' + (s ? ' ' + s + 's' : '');
}

export function lastCallNote(record) {
  if (!record.activities?.length) return null;
  let best = null;
  for (const a of record.activities) if (a.type === 'call-note' && (!best || (a.id || 0) > (best.id || 0))) best = a;
  return best;
}

/* The "Last call status" banner, computed live from the latest call-note — never a
   separately stored field, so it always matches History. */
export function callBannerHtml(record) {
  const a = lastCallNote(record);
  if (!a) return '';
  const bits = [];
  if (a.answered != null) bits.push(a.answered ? 'Answered' : 'Not answered');
  if (a.durationApproxSec) bits.push('~' + formatDuration(a.durationApproxSec) + ' away');
  return `<div class="callBanner"><div class="callBannerTop"><span>Last call status${a.phone ? ' • ' + esc(a.phone) : ''}</span><span>${esc(a.ts || '')}</span></div>${bits.length ? `<div class="callBannerMeta">${esc(bits.join(' • '))}</div>` : ''}${a.text ? `<div class="profileText">${esc(a.text)}</div>` : ''}${a.audio ? `<audio controls src="${objectUrl(a.audio)}"></audio>` : ''}</div>`;
}

function closePopup(capture) {
  document.getElementById('callFollowup')?.remove();
  if (capture) { try { capture.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } }
  popupOpen = false;
}

function showFollowup(rec) {
  if (popupOpen) return;
  const record = activeCallContext?.kind === rec.kind && String(activeCallContext.id) === String(rec.id) ? activeCallContext.record : null;
  if (!record) return;
  popupOpen = true;

  const durationSec = Math.max(0, Math.round((rec.durationMs || 0) / 1000));
  let answered = durationSec >= ANSWERED_GUESS_THRESHOLD_SEC;
  let audioBlob = null;
  const capture = { recorder: null, stream: null, chunks: [] };

  const reminderInfo = rec.kind === 'shadchanim' ? followup.getReminderInfo(rec.id) : null;

  const shade = document.createElement('div');
  shade.id = 'callFollowup';
  shade.className = 'pickerShade';
  shade.innerHTML = `<div class="pickerSheet">
    <div class="pickerTitle">Call ended — add a status update?</div>
    <div class="small" style="margin-bottom:12px">${esc(rec.name || 'This contact')}${rec.phone ? ' • ' + esc(rec.phone) : ''}</div>
    ${reminderInfo ? `<div class="callReminderBar"><span>Follow-up: Call ${esc(reminderInfo.label || reminderInfo.date)}</span><button type="button" id="cfCancelReminder">Cancel follow-up</button></div>` : ''}
    <textarea id="cfNote" placeholder="What happened on the call? (optional)"></textarea>
    <button type="button" class="secondary full" id="cfAudio">Record audio note</button>
    <div style="font-weight:850;font-size:12px;margin-top:12px">Was the call answered?</div>
    <div class="small" style="margin:2px 0 6px">${durationSec ? `PeerMatch's best guess from being away ~${esc(formatDuration(durationSec))} — tap to correct.` : 'Cannot be detected — tap to set it.'}</div>
    <div class="actions" id="cfAnswered"><button type="button" id="cfYes">Yes</button><button type="button" id="cfNo">No</button></div>
    <div class="small" id="cfStatus" style="min-height:14px;margin-top:6px"></div>
    <div class="row" style="margin-top:10px"><button type="button" class="primary full" id="cfSave">Save status update</button></div><div class="gap"></div>
    <button type="button" class="secondary full" id="cfSkip">Skip</button></div>`;
  document.body.appendChild(shade);

  const status = shade.querySelector('#cfStatus');
  const yesBtn = shade.querySelector('#cfYes'), noBtn = shade.querySelector('#cfNo');
  const paintAnswered = () => { yesBtn.className = answered ? 'primary' : 'secondary'; noBtn.className = answered ? 'secondary' : 'primary'; };
  paintAnswered();
  yesBtn.onclick = () => { answered = true; paintAnswered(); };
  noBtn.onclick = () => { answered = false; paintAnswered(); };

  shade.querySelector('#cfCancelReminder')?.addEventListener('click', () => {
    followup.clearReminder(rec.id);
    shade.querySelector('.callReminderBar')?.remove();
    status.textContent = 'Follow-up reminder canceled.';
  });

  const audioBtn = shade.querySelector('#cfAudio');
  audioBtn.onclick = async () => {
    if (capture.recorder) {
      audioBtn.disabled = true;
      try {
        audioBlob = await new Promise((resolve, reject) => {
          capture.recorder.onstop = () => resolve(new Blob(capture.chunks, { type: capture.recorder.mimeType || 'audio/webm' }));
          capture.recorder.onerror = reject;
          capture.recorder.stop();
        });
        status.textContent = 'Audio note recorded.';
        audioBtn.textContent = 'Re-record audio note';
      } catch { status.textContent = 'Recording could not be saved.'; audioBtn.textContent = 'Record audio note'; }
      capture.stream?.getTracks().forEach((t) => t.stop());
      capture.recorder = null; audioBtn.disabled = false;
      return;
    }
    try {
      capture.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      capture.chunks = [];
      capture.recorder = new MediaRecorder(capture.stream);
      capture.recorder.ondataavailable = (e) => { if (e.data.size) capture.chunks.push(e.data); };
      capture.recorder.start();
      audioBtn.textContent = 'Stop recording';
      status.textContent = 'Recording…';
    } catch { status.textContent = 'Microphone could not start.'; }
  };

  shade.querySelector('#cfSkip').onclick = () => closePopup(capture);
  shade.onclick = (e) => { if (e.target === shade) closePopup(capture); };
  shade.querySelector('#cfSave').onclick = async () => {
    if (capture.recorder) {
      try { audioBlob = await new Promise((resolve) => { capture.recorder.onstop = () => resolve(new Blob(capture.chunks, { type: capture.recorder.mimeType || 'audio/webm' })); capture.recorder.stop(); }); } catch { /* ignore */ }
      capture.stream?.getTracks().forEach((t) => t.stop());
    }
    const text = shade.querySelector('#cfNote').value.trim();
    const entry = { type: 'call-note', text, phone: rec.phone || '', answered, ...(audioBlob ? { audio: audioBlob } : {}), ...(durationSec ? { durationApproxSec: durationSec } : {}) };
    addActivity(record, entry);
    try { await save(); } catch { alert('Could not save this status update.'); return; }
    closePopup(null);
    followup.reopen();
  };
}

function consumeIfDue(rec) {
  const age = Date.now() - rec.ts;
  if (age < MIN_GAP_MS || age > MAX_AGE_MS) return;
  rec.durationMs = age;
  setTimeout(() => showFollowup(rec), SHOW_DELAY_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !pendingCall) return;
  const rec = pendingCall;
  clearPending();
  consumeIfDue(rec);
});
setTimeout(() => {
  if (!pendingCall) return;
  const rec = pendingCall;
  clearPending();
  consumeIfDue(rec);
}, 700);
