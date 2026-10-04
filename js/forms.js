/* Add/Edit Guy, Girl and Shadchan: Paste profile + autofill, contacts, looking for,
   attachment box, tags and religious fields, referred-by picker, validation. */

import { state, save, clearPendingShare } from './db.js';
import { esc, nextId, normalizePhone, phoneKey, deriveAge, extractNameAge, extractContact } from './util.js';
import { openSheet, closeSheet, setReopen, refreshBanner } from './app.js';
import { mountAttachmentBox } from './attach.js';
import { renderGuys, renderGirls, renderShadchanim } from './lists.js';
import { openGuyGirl, openShadchan } from './person.js';

/* ---------- Image processing (photo tile) ---------- */

async function bitmapToBlob(bitmap, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  if ('OffscreenCanvas' in window) {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.drawImage(bitmap, 0, 0, w, h);
    return c.convertToBlob({ type: 'image/webp', quality });
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { alpha: false });
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encode failed'))), 'image/webp', quality));
}
async function processImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose an image file.');
  if (!('createImageBitmap' in window)) return { full: file, thumb: file };
  const probe = await createImageBitmap(file, { resizeWidth: 320, resizeQuality: 'medium', imageOrientation: 'from-image' });
  const thumb = await bitmapToBlob(probe, 320, 0.72);
  probe.close?.();
  let full = file;
  if (file.size > 2.5 * 1024 * 1024) {
    const bitmap = await createImageBitmap(file, { resizeWidth: 1600, resizeQuality: 'medium', imageOrientation: 'from-image' });
    full = await bitmapToBlob(bitmap, 1600, 0.8);
    bitmap.close?.();
  }
  return { full, thumb };
}

function mountPhotoTile(container, existing) {
  const tile = document.createElement('div');
  tile.className = 'pickTile';
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.className = 'hidden';
  container.append(tile, input);
  const state2 = { full: existing?.full || null, thumb: existing?.thumb || existing?.full || null, preview: '' };
  function draw() {
    if (state2.preview) { URL.revokeObjectURL(state2.preview); state2.preview = ''; }
    if (state2.thumb) {
      state2.preview = URL.createObjectURL(state2.thumb);
      tile.innerHTML = `<img src="${state2.preview}" alt="Photo"><button type="button" class="removeMedia">Remove</button>`;
      tile.querySelector('.removeMedia').onclick = (e) => { e.stopPropagation(); state2.full = null; state2.thumb = null; draw(); };
    } else tile.textContent = 'Photo';
  }
  tile.onclick = (e) => { if (!e.target.closest('.removeMedia')) input.click(); };
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    tile.textContent = 'Loading…';
    try { const m = await processImage(f); state2.full = m.full; state2.thumb = m.thumb; draw(); }
    catch { tile.textContent = 'Photo'; alert('Could not use that image. Try another photo or screenshot.'); }
  };
  draw();
  return state2;
}

/* ---------- Audio profile recorder ---------- */

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function mountAudioProfile(container, profileTextarea, existing) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'audioProfileBtn';
  btn.textContent = existing?.audio ? 'Replace audio' : 'Audio profile';
  container.appendChild(btn);
  const result = { audio: existing?.audio || null, text: existing?.text || '' };
  let recorder = null, chunks = [], stream = null, speech = null;

  btn.onclick = async () => {
    if (recorder) {
      btn.textContent = 'Finishing…';
      const blob = await new Promise((resolve) => { recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })); recorder.stop(); });
      stream?.getTracks().forEach((t) => t.stop());
      try { speech?.stop(); } catch { /* ignore */ }
      recorder = null;
      result.audio = blob;
      btn.textContent = 'Audio saved';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start();
      if (SpeechRec) {
        speech = new SpeechRec();
        speech.lang = navigator.language || 'en-US';
        speech.continuous = true; speech.interimResults = true;
        speech.onresult = (e) => {
          let text = '';
          for (let i = 0; i < e.results.length; i++) text += (e.results[i]?.[0]?.transcript || '') + ' ';
          result.text = text.trim();
          if (profileTextarea && !profileTextarea.value.trim()) { profileTextarea.value = result.text; profileTextarea.dispatchEvent(new Event('input', { bubbles: true })); }
        };
        try { speech.start(); } catch { /* ignore */ }
      }
      btn.classList.add('recording');
      btn.textContent = 'Stop audio';
    } catch { alert('Microphone permission is required.'); }
  };
  return result;
}

/* ---------- Autofill from pasted/typed profile text ---------- */

function fillIfEmpty(el, value) {
  if (el && !String(el.value || '').trim() && value) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
}

function findShadByPhone(phone) {
  const k = phoneKey(phone);
  return k ? state.shadchanim.find((s) => phoneKey(s.phone) === k) || null : null;
}

function bindPhoneNormalize(el) {
  const norm = () => { const n = normalizePhone(el.value); if (n && n !== el.value) el.value = n; };
  el.addEventListener('blur', norm);
  el.addEventListener('paste', () => setTimeout(norm, 0));
}
function bindPhoneShadHint(phoneEl, nameEl) {
  const update = () => {
    const s = findShadByPhone(phoneEl.value);
    let hint = phoneEl.parentElement.querySelector('.matchHint');
    if (s) {
      if (!hint) { hint = document.createElement('span'); hint.className = 'matchHint'; phoneEl.parentElement.appendChild(hint); }
      hint.textContent = 'Matches Shadchan: ' + (s.name || 'Unnamed shadchan');
      if (nameEl && !nameEl.value.trim()) { nameEl.value = s.name || ''; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
    } else if (hint) hint.remove();
  };
  phoneEl.addEventListener('input', update);
  phoneEl.addEventListener('blur', update);
}

/* ---------- Add / Edit Guy or Girl ---------- */

export function openAddForm(kind, shared) {
  renderForm(kind, null, shared || null);
}
export function openEditGuyGirl(kind, id) {
  const x = (state[kind] || []).find((z) => String(z.id) === String(id));
  if (!x) return;
  renderForm(kind, x, null);
}

function renderForm(kind, existing, shared) {
  const label = kind === 'guys' ? 'Guy' : 'Girl';
  const isEdit = !!existing;
  const text = existing?.text || shared?.text || '';

  setReopen(() => (isEdit ? openEditGuyGirl(kind, existing.id) : openAddForm(kind, shared)));

  openSheet(`<div class="formHead"><h2>${isEdit ? 'Edit' : 'Add'} ${esc(label)}</h2><div id="formTools" class="formTools"></div></div>
    <div class="pmGrid" style="display:grid;grid-template-columns:1fr 105px;gap:9px">
      <label>Name<input id="fName" value="${esc(existing?.name || '')}" placeholder="Name (optional)"></label>
      <label>Age<input id="fAge" type="number" min="18" max="99" value="${esc(existing?.age || '')}"></label>
    </div>
    <label>Profile<div class="pasteProfileRow"><button type="button" class="pasteProfileBtn" id="pasteProfile">Paste profile</button></div><textarea id="fText" placeholder="Paste, type, or record the profile">${esc(text)}</textarea></label>
    <div id="lookingForBlock" class="pmGrid" style="display:grid;grid-template-columns:1fr 105px;gap:9px">
      <label>Looking for<textarea id="fLookingFor" style="min-height:72px">${esc(existing?.lookingFor || '')}</textarea></label>
      <label>To what age<input id="fLookingAge" type="number" min="18" max="99" value="${esc(existing?.lookingForMaxAge || '')}"></label>
    </div>
    <label>Religious details<input id="fReligiousDetails" value="${esc(existing?.religiousDetails || '')}" placeholder="e.g. Chabad, Breslev, Yeshivish, tzniut"></label>
    <div class="card"><div class="sectionTitle" style="margin-top:0">Contacts</div>
      <label>Profile phone<input id="fProfilePhone" type="tel" value="${esc(existing?.profilePhone || '')}"></label>
      <div class="pmGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
        <label>Contact 1 name<input id="fC1Name" value="${esc(existing?.contact1Name || existing?.sourceName || existing?.source || '')}"></label>
        <label>Contact 1 phone<input id="fC1Phone" type="tel" value="${esc(existing?.contact1Phone || existing?.sourcePhone || '')}"></label>
      </div>
      <div class="pmGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
        <label>Contact 2 name<input id="fC2Name" value="${esc(existing?.contact2Name || '')}"></label>
        <label>Contact 2 phone<input id="fC2Phone" type="tel" value="${esc(existing?.contact2Phone || existing?.sourcePhone2 || '')}"></label>
      </div>
    </div>
    <div id="attachHolder"></div>
    <label>Tags<input id="fTags" value="${esc(existing?.tags || '')}" placeholder="e.g. Chabad, Israel, 35+"></label>
    <label>Religious level<input id="fReligiousLevel" value="${esc(existing?.religiousLevel || '')}"></label>
    <div class="formFixed"><button type="button" class="primary" id="formSave">${isEdit ? 'Save Changes' : 'Save ' + esc(label)}</button><button type="button" class="secondary" id="formCancel">Cancel</button></div>`);

  const sheet = document.getElementById('sheet');
  sheet.classList.add('hasFixedBar');
  const tools = document.getElementById('formTools');
  const photo = mountPhotoTile(tools, { full: existing ? (existing.profileMediaFull || existing.profileImage) : (shared?.photo || null), thumb: existing ? existing.profileMediaThumb : (shared?.photo || null) });
  const audio = mountAudioProfile(tools, document.getElementById('fText'), existing ? { audio: existing.profileAudio, text: existing.profileAudioText } : null);
  const attach = mountAttachmentBox(document.getElementById('attachHolder'), existing, (parsedText) => {
    const ta = document.getElementById('fText');
    if (!ta.value.trim()) { ta.value = parsedText; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    applyAutofillFrom(parsedText);
  });

  const c1Name = document.getElementById('fC1Name'), c1Phone = document.getElementById('fC1Phone');
  const c2Name = document.getElementById('fC2Name'), c2Phone = document.getElementById('fC2Phone');
  bindPhoneNormalize(document.getElementById('fProfilePhone'));
  [c1Phone, c2Phone].forEach(bindPhoneNormalize);
  bindPhoneShadHint(c1Phone, c1Name);
  bindPhoneShadHint(c2Phone, c2Name);

  function applyAutofillFrom(text) {
    const na = extractNameAge(text);
    const ct = extractContact(text);
    fillIfEmpty(document.getElementById('fName'), na.name);
    fillIfEmpty(document.getElementById('fAge'), na.age);
    fillIfEmpty(c1Name, ct.name);
    fillIfEmpty(c1Phone, ct.phone);
  }
  const textarea = document.getElementById('fText');
  textarea.addEventListener('input', () => applyAutofillFrom(textarea.value));
  if (textarea.value.trim()) applyAutofillFrom(textarea.value);

  document.getElementById('pasteProfile').onclick = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('unavailable');
      const t = await navigator.clipboard.readText();
      if (!t.trim()) return alert('The clipboard does not contain profile text.');
      textarea.value = t;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      alert('Could not read the clipboard directly. Tap inside Profile and paste there instead.');
    }
  };

  document.getElementById('formCancel').onclick = () => (isEdit ? openGuyGirl(kind, existing.id) : closeSheet());
  document.getElementById('formSave').onclick = async () => {
    const name0 = document.getElementById('fName').value.trim();
    const age = document.getElementById('fAge').value.trim();
    const text0 = textarea.value.trim();
    if (age && (Number(age) < 18 || Number(age) > 99)) return alert('Check the age.');
    const lookingAge = document.getElementById('fLookingAge').value.trim();
    if (lookingAge && (Number(lookingAge) < 18 || Number(lookingAge) > 99)) return alert('Check the To what age value.');
    if (!text0 && !photo.full && !audio.audio && !attach) return alert('Add profile text, audio, a photo/screenshot, or a PDF attachment before saving.');
    const hasAttachment = document.querySelector('#attachHolder .attachFileName')?.textContent !== 'No PDF or screenshot attached';
    if (!text0 && !photo.full && !audio.audio && !hasAttachment) return alert('Add profile text, audio, a photo/screenshot, or a PDF attachment before saving.');

    const name = name0 || (text0 ? (text0.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || label + ' profile').slice(0, 70) : label + ' profile');
    const c1PhoneVal = c1Phone.value.trim();
    const rec = existing || { id: nextId(), activities: [] };
    Object.assign(rec, {
      name, age: age || deriveAge(text0), text: text0,
      profileImage: photo.full, photo: photo.thumb, profileMediaFull: photo.full, profileMediaThumb: photo.thumb,
      profileAudio: audio.audio || rec.profileAudio, profileAudioText: audio.text || rec.profileAudioText,
      lookingFor: document.getElementById('fLookingFor').value.trim(),
      lookingForMaxAge: lookingAge,
      profilePhone: document.getElementById('fProfilePhone').value.trim(),
      contact1Name: c1Name.value.trim(), contact1Phone: c1PhoneVal,
      contact2Name: c2Name.value.trim(), contact2Phone: c2Phone.value.trim(),
      sourceName: c1Name.value.trim(), source: c1Name.value.trim(), sourcePhone: c1PhoneVal, sourcePhone2: c2Phone.value.trim(),
      tags: document.getElementById('fTags').value.trim(),
      religiousLevel: document.getElementById('fReligiousLevel').value.trim(),
      religiousDetails: document.getElementById('fReligiousDetails').value.trim()
    });
    const matchedShad = findShadByPhone(c1PhoneVal);
    if (matchedShad) { rec.sourceShadchanId = matchedShad.id; rec.sourceShadchanName = matchedShad.name || ''; }
    attach.apply(rec);
    if (!existing) state[kind].unshift(rec);
    await save();
    if (shared) { await clearPendingShare(); await refreshBanner(); }
    renderGuys(); renderGirls();
    openGuyGirl(kind, rec.id);
  };
  void sheet;
}

/* ---------- Add / Edit Shadchan ---------- */

function referredByOptionsHtml(excludeId) {
  return [...state.shadchanim].filter((s) => String(s.id) !== String(excludeId)).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map((s) => `<option value="${s.id}">${esc(s.name)}${s.phone ? ' • ' + esc(s.phone) : ''}</option>`).join('');
}
function norm(s) { return String(s || '').trim().toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function resolveReferrer(text, excludeId) {
  const t = String(text || '').trim();
  if (!t) return null;
  const candidates = state.shadchanim.filter((s) => String(s.id) !== String(excludeId));
  if (phoneKey(t).length >= 7) { const m = candidates.filter((s) => phoneKey(s.phone) === phoneKey(t)); if (m.length === 1) return m[0]; }
  const n = norm(t);
  if (n) { const m = candidates.filter((s) => norm(s.name) === n); if (m.length === 1) return m[0]; }
  return null;
}

export function openAddShadchan() { renderShadchanForm(null); }
export function openEditShadchan(id) {
  const x = state.shadchanim.find((z) => String(z.id) === String(id));
  if (!x) return;
  renderShadchanForm(x);
}

function renderShadchanForm(existing) {
  const isEdit = !!existing;
  setReopen(() => (isEdit ? openEditShadchan(existing.id) : openAddShadchan()));

  openSheet(`<h2>${isEdit ? 'Edit' : 'Add'} Shadchan</h2>
    <label>Name<input id="sName" value="${esc(existing?.name || '')}"></label>
    <label>Phone / SMS<input id="sPhone" type="tel" value="${esc(existing?.phone || '')}"></label>
    <label>Email<input id="sEmail" type="email" value="${esc(existing?.email || '')}"></label>
    <label>Profile / notes<textarea id="sProfileText" placeholder="Paste shadchan information here, or attach a PDF/screenshot below">${esc(existing?.profileText || '')}</textarea></label>
    <div id="attachHolder"></div>
    <label>Tags<input id="sTags" value="${esc(existing?.tags || '')}" placeholder="Chabad, 35+, Israel"></label>
    <label>Religious level<input id="sReligiousLevel" value="${esc(existing?.religiousLevel || '')}"></label>
    <label>Religious details<input id="sReligiousDetails" value="${esc(existing?.religiousDetails || '')}"></label>
    <label>Referred by<input id="sReferredBy" value="${esc(existing?.referredBy || '')}" placeholder="Type a name or phone number, or choose below"></label>
    <label>Choose an existing Shadchan (optional)<select id="sReferredSelect"><option value="">Choose existing Shadchan…</option>${referredByOptionsHtml(existing?.id)}</select></label>
    <div class="small" id="referredStatus"></div>
    <div class="formFixed"><button type="button" class="primary" id="formSave">${isEdit ? 'Save' : 'Save Shadchan'}</button><button type="button" class="secondary" id="formCancel">Cancel</button></div>`);

  document.getElementById('sheet').classList.add('hasFixedBar');
  const attach = mountAttachmentBox(document.getElementById('attachHolder'), existing, (parsedText) => {
    const ta = document.getElementById('sProfileText');
    if (!ta.value.trim()) ta.value = parsedText;
  });

  const nameEl = document.getElementById('sName'), phoneEl = document.getElementById('sPhone');
  bindPhoneNormalize(phoneEl);

  const referredInput = document.getElementById('sReferredBy');
  const referredSelect = document.getElementById('sReferredSelect');
  const referredStatus = document.getElementById('referredStatus');
  let referredSelectedId = existing?.referredById ?? null;
  function paintReferredStatus() {
    const match = referredSelectedId != null ? state.shadchanim.find((s) => String(s.id) === String(referredSelectedId)) : resolveReferrer(referredInput.value, existing?.id);
    if (match) { referredStatus.textContent = 'Linked to ' + (match.name || 'this Shadchan'); referredSelect.value = String(match.id); }
    else referredStatus.textContent = referredInput.value.trim() ? 'New/manual referrer' : '';
  }
  if (existing) { const cur = referredSelectedId != null ? state.shadchanim.find((s) => String(s.id) === String(referredSelectedId)) : resolveReferrer(existing.referredBy, existing.id); if (cur) referredSelectedId = cur.id; }
  paintReferredStatus();
  referredInput.addEventListener('input', () => { referredSelectedId = null; paintReferredStatus(); });
  referredSelect.addEventListener('change', () => {
    const s = state.shadchanim.find((z) => String(z.id) === String(referredSelect.value));
    if (s) { referredSelectedId = s.id; referredInput.value = s.name || s.phone || ''; }
    else referredSelectedId = null;
    paintReferredStatus();
  });

  document.getElementById('formCancel').onclick = () => (isEdit ? openShadchan(existing.id) : closeSheet());
  document.getElementById('formSave').onclick = async () => {
    const name = nameEl.value.trim();
    if (!name) return alert('Enter a name.');
    const rec = existing || { id: nextId(), activities: [] };
    Object.assign(rec, {
      name, phone: phoneEl.value.trim(), email: document.getElementById('sEmail').value.trim(),
      tags: document.getElementById('sTags').value.trim(),
      referredBy: referredInput.value.trim(),
      religiousLevel: document.getElementById('sReligiousLevel').value.trim(),
      religiousDetails: document.getElementById('sReligiousDetails').value.trim(),
      profileText: document.getElementById('sProfileText').value.trim()
    });
    const resolved = referredSelectedId != null ? state.shadchanim.find((s) => String(s.id) === String(referredSelectedId)) : resolveReferrer(rec.referredBy, rec.id);
    if (resolved && String(resolved.id) !== String(rec.id)) rec.referredById = resolved.id;
    else delete rec.referredById;
    attach.apply(rec);
    if (!existing) state.shadchanim.unshift(rec);
    await save();
    renderShadchanim();
    openShadchan(rec.id);
  };
}
