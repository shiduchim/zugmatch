/* Make Match: suggested match card, recipient select, message template, language
   checkboxes, include-photos checkbox, Contact/SMS/WhatsApp/Email, matchId history. */

import { state, save } from './db.js';
import { esc } from './util.js';
import { writeMatchActivities } from './history.js';
import { openSheet, closeSheet, getSelected } from './app.js';
import { openWhatsApp, smsHref, mailtoHref } from './send.js';
import { renderGuys, renderGirls, renderShadchanim } from './lists.js';

function cleanName(x, fallback) { return String(x?.name || '').replace(/\*/g, '').trim() || fallback; }
function contactName(x) { return String(x?.contact1Name || x?.sourceName || x?.source || '').trim(); }
function contactPhone(x) { return String(x?.contact1Phone || x?.sourcePhone || '').trim(); }

function contactOptions(guy, girl, shadchan) {
  const out = [];
  if (shadchan) out.push({ label: 'Shadchan', name: cleanName(shadchan, 'Shadchan'), greeting: cleanName(shadchan, 'Shadchan'), phone: String(shadchan.phone || '').trim(), email: String(shadchan.email || '').trim(), side: 'Shadchan' });
  const add = (side, x) => { const phone = contactPhone(x); if (!phone) return; const name = contactName(x); out.push({ label: side + ' contact person', name: name || side + ' contact person', greeting: name || side + ' contact person', phone, email: '', side }); };
  add('Girl', girl);
  add('Guy', guy);
  return out;
}
function recipientDisplay(r) { return r.name && r.name !== r.label ? r.label + ' — ' + r.name : r.label; }

function profileBlock(x, label) {
  const lines = [];
  const name = cleanName(x, label + ' profile');
  lines.push(label.toUpperCase() + ' — ' + name + (x?.age ? ' (age ' + x.age + ')' : ''));
  const text = String(x?.text || '').trim();
  if (text) lines.push(text);
  const cn = contactName(x), cp = contactPhone(x);
  if (cn || cp) lines.push('', '', 'CONTACT', (cn || 'Contact person') + (cp ? ' • ' + cp : ''));
  return lines.join('\n');
}
function defaultMessage(guy, girl, recipient, langFilter) {
  const gName = cleanName(guy, 'Guy profile'), lName = cleanName(girl, 'Girl profile');
  const hello = recipient?.greeting ? 'Hi ' + recipient.greeting + ',' : 'Hi,';
  const filteredGuy = { ...guy, text: langFilter(guy.text || '') };
  const filteredGirl = { ...girl, text: langFilter(girl.text || '') };
  return ['Shidduch suggestion', 'Guy: ' + gName, 'Girl: ' + lName, '', hello, '', '--------------------', profileBlock(filteredGuy, 'Guy'), '--------------------', profileBlock(filteredGirl, 'Girl'), '--------------------'].join('\n');
}

function fullPhoto(x) { return x?.profileMediaFull || x?.profileMedia || x?.profileImage || x?.photo || null; }
function extFor(type) { return { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[String(type || '').toLowerCase()] || '.jpg'; }
function safePart(s) { return String(s || 'profile').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 45) || 'profile'; }
function toPhotoFile(blob, name) {
  if (!(blob instanceof Blob)) return null;
  if (blob instanceof File && blob.name) return blob;
  try { return new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: Date.now() }); } catch { return null; }
}
function photoFiles(guy, girl) {
  const files = [];
  const add = (side, x) => { const photo = fullPhoto(x); if (!(photo instanceof Blob)) return; const f = toPhotoFile(photo, side + '_' + safePart(cleanName(x, side)) + '_photo' + extFor(photo.type)); if (f) files.push(f); };
  add('Guy', guy); add('Girl', girl);
  return files;
}
function canShareFiles(files) {
  if (typeof navigator.share !== 'function') return false;
  if (!navigator.canShare) return true;
  try { return navigator.canShare({ files }); } catch { return false; }
}

async function afterMatchSaved() {
  await save();
  renderGuys(); renderGirls(); renderShadchanim();
}

async function contactRecipient(guy, girl, shadchan, recipient) {
  if (!recipient?.phone) return alert('The selected contact does not have a phone number.');
  writeMatchActivities({ guy, girl, shadchan, label: recipientDisplay(recipient), text: '', isContact: true, extra: { recipient: recipient.name, recipientPhone: recipient.phone, recipientSide: recipient.side } });
  await afterMatchSaved();
  closeSheet();
  location.href = 'tel:' + recipient.phone;
}
async function directSend(channel, guy, girl, shadchan, recipient, message) {
  if (!recipient) return alert('Choose who this match should be sent to.');
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Email';
  if (channel === 'sms' && !recipient.phone) return alert('The selected contact needs a phone number for SMS.');
  if (channel === 'whatsapp' && !recipient.phone) return alert('The selected contact needs a phone number for WhatsApp.');
  if (channel === 'email' && !recipient.email) return alert('Email is only available when the selected Shadchan has an email address.');
  writeMatchActivities({ guy, girl, shadchan, label: channelLabel, text: message, isContact: false, extra: { recipient: recipient.name, recipientPhone: recipient.phone || '', recipientSide: recipient.side } });
  await afterMatchSaved();
  closeSheet();
  if (channel === 'whatsapp') openWhatsApp(recipient.phone, message);
  else if (channel === 'sms') location.href = smsHref(recipient.phone, message);
  else location.href = mailtoHref(recipient.email, 'Shidduch suggestion: ' + cleanName(guy, 'Guy') + ' & ' + cleanName(girl, 'Girl'), message);
}
async function shareWithPhotos(channel, guy, girl, shadchan, recipient, message) {
  const files = photoFiles(guy, girl);
  if (!files.length || !canShareFiles(files)) return directSend(channel, guy, girl, shadchan, recipient, message);
  const title = 'Shidduch suggestion: ' + cleanName(guy, 'Guy') + ' & ' + cleanName(girl, 'Girl');
  try { await navigator.share({ title, text: message, files }); }
  catch (e) { if (e?.name === 'AbortError') return; return directSend(channel, guy, girl, shadchan, recipient, message); }
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : 'Email';
  writeMatchActivities({ guy, girl, shadchan, label: channelLabel, text: message, isContact: false, extra: { recipient: recipient.name, recipientPhone: recipient.phone || '', recipientSide: recipient.side } });
  await afterMatchSaved();
  closeSheet();
}

function scriptsIn3(text) {
  return { en: /[A-Za-z]/.test(text), he: /[֐-׿]/.test(text), ru: /[Ѐ-ӿ]/.test(text) };
}
function filterLangLines(text, flags) {
  return String(text || '').split(/\r?\n/).filter((line) => { const s = scriptsIn3(line); if (!s.en && !s.he && !s.ru) return true; return (s.en && flags.en) || (s.he && flags.he) || (s.ru && flags.ru); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function openMakeMatch() {
  const guys = getSelected('guys'), girls = getSelected('girls'), shads = getSelected('shadchanim');
  if (guys.length !== 1) return alert(guys.length ? 'Select exactly one Guy.' : 'Select one Guy using the checkbox in the Guys list.');
  if (girls.length !== 1) return alert(girls.length ? 'Select exactly one Girl.' : 'Select one Girl using the checkbox in the Girls list.');
  if (shads.length > 1) return alert('Select no more than one Shadchan.');
  const guy = guys[0], girl = girls[0], shadchan = shads[0] || null;
  const contacts = contactOptions(guy, girl, shadchan);
  if (!contacts.length) return alert('Add a phone number for a Guy/Girl contact person, or select a Shadchan with contact information.');
  const photos = photoFiles(guy, girl);
  const presence = scriptsIn3((guy.text || '') + '\n' + (girl.text || ''));

  openSheet(`<h2>Make match</h2>
    <div class="card"><div class="sectionTitle" style="margin-top:0">Suggested match</div>
      <div class="matchPair"><div class="matchPerson"><span>Guy</span><strong>${esc(cleanName(guy, 'Guy profile'))}</strong></div><div class="matchPerson"><span>Girl</span><strong>${esc(cleanName(girl, 'Girl profile'))}</strong></div></div>
      <div class="matchShad"><span>Shadchan</span><strong>${shadchan ? esc(cleanName(shadchan, 'Shadchan')) : 'Not selected'}</strong></div>
    </div>
    <label>Send to<select id="matchRecipient">${contacts.map((r, i) => `<option value="${i}">${esc(recipientDisplay(r) + (r.phone ? ' • ' + r.phone : ''))}</option>`).join('')}</select></label>
    <label>Message<textarea id="matchMessage" style="min-height:230px"></textarea></label>
    ${(presence.en || presence.he || presence.ru) ? `<div class="langChecks"><div class="groupTitle">Include in this match message</div>${presence.en ? '<label><input data-mm="en" type="checkbox" checked> English</label>' : ''}${presence.he ? '<label><input data-mm="he" type="checkbox" checked> Hebrew</label>' : ''}${presence.ru ? '<label><input data-mm="ru" type="checkbox" checked> Russian</label>' : ''}</div>` : ''}
    ${photos.length ? '<label class="inlineCheck"><input id="matchIncludePhotos" type="checkbox"> Include profile photos with WhatsApp / Email</label>' : ''}
    <div class="actions" style="grid-template-columns:repeat(4,1fr)"><button type="button" class="lightblue" id="matchContact">Contact</button><button type="button" class="lightblue" id="matchSms">SMS</button><button type="button" class="lightblue" id="matchWa">WhatsApp</button><button type="button" class="lightblue" id="matchEmail">Email</button></div>
    <div class="small" style="margin:6px 1px 8px">Contact calls the person selected above. SMS, WhatsApp and Email send the message to that same selection.</div>
    <button type="button" class="secondary full" id="matchCancel">Cancel</button>`);

  const select = document.getElementById('matchRecipient');
  const message = document.getElementById('matchMessage');
  const current = () => contacts[Math.max(0, Number(select.value || 0))] || contacts[0];
  const langFlags = () => ({ en: presence.en ? !!document.querySelector('[data-mm="en"]')?.checked : true, he: presence.he ? !!document.querySelector('[data-mm="he"]')?.checked : true, ru: presence.ru ? !!document.querySelector('[data-mm="ru"]')?.checked : true });
  const rebuild = () => { message.value = defaultMessage(guy, girl, current(), (t) => filterLangLines(t, langFlags())); };
  select.onchange = rebuild;
  document.querySelectorAll('[data-mm]').forEach((cb) => cb.addEventListener('change', rebuild));
  rebuild();

  document.getElementById('matchContact').onclick = () => contactRecipient(guy, girl, shadchan, current());
  const send = (channel) => {
    const text = message.value.trim();
    if (!text) return alert('Enter a message.');
    const include = !!document.getElementById('matchIncludePhotos')?.checked;
    if (include && (channel === 'whatsapp' || channel === 'email')) shareWithPhotos(channel, guy, girl, shadchan, current(), text);
    else directSend(channel, guy, girl, shadchan, current(), text);
  };
  document.getElementById('matchSms').onclick = () => send('sms');
  document.getElementById('matchWa').onclick = () => send('whatsapp');
  document.getElementById('matchEmail').onclick = () => send('email');
  document.getElementById('matchCancel').onclick = () => closeSheet();
}
