/* WhatsApp chat ZIP import: _chat.txt, .vcf contact cards, attachments, review sheet,
   shadchan/profile detection with dedup, wa-in/wa-out import with importKey. */

import { state, save, getPendingShare, clearPendingShare } from './db.js';
import { esc, stamp, phoneKey, extractNameAge, extractContact } from './util.js';
import { addActivity } from './history.js';
import { openSheet, closeSheet } from './app.js';
import { renderShadchanim, renderGuys, renderGirls } from './lists.js';

const td = new TextDecoder('utf-8');
const te = new TextEncoder();

const baseName = (n) => String(n || '').split('/').pop() || '';
const ext = (n) => (baseName(n).toLowerCase().match(/(\.[a-z0-9]{1,8})$/) || [])[1] || '';
const isImageFile = (n) => /\.(?:jpe?g|png|webp|gif|heic)$/i.test(n);
const isProfileFile = (n) => /\.(?:jpe?g|png|webp|gif|heic|pdf|docx?|rtf|txt)$/i.test(n);
function norm(s) { return String(s || '').toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function sameName(a, b) { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); }
function hash(s) { let h = 0x811c9dc5 >>> 0; for (const c of String(s || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function mimeFor(n) {
  return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.pdf': 'application/pdf', '.txt': 'text/plain', '.vcf': 'text/vcard', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.rtf': 'application/rtf' }[ext(n)] || 'application/octet-stream';
}

/* ---------- ZIP reader (store or deflate) ---------- */

const u16 = (v, o) => v.getUint16(o, true), u32 = (v, o) => v.getUint32(o, true);
async function inflateRaw(bytes) {
  if (!('DecompressionStream' in window)) throw new Error('Update your browser before importing compressed ZIP files.');
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
async function openZip(file) {
  const ab = await file.arrayBuffer(), b = new Uint8Array(ab), v = new DataView(ab);
  let e = -1;
  const min = Math.max(0, b.length - 65557);
  for (let i = b.length - 22; i >= min; i--) if (u32(v, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This is not a valid ZIP file.');
  const count = u16(v, e + 10), central = u32(v, e + 16);
  let p = central;
  const out = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || u32(v, p) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
    const method = u16(v, p + 10), cs = u32(v, p + 20), nl = u16(v, p + 28), xl = u16(v, p + 30), cl = u16(v, p + 32), lo = u32(v, p + 42);
    const name = td.decode(b.slice(p + 46, p + 46 + nl));
    const ln = u16(v, lo + 26), lx = u16(v, lo + 28), start = lo + 30 + ln + lx, end = start + cs, compressed = b.slice(start, end);
    let cache = null;
    out.push({
      name, method,
      async bytes() { if (cache) return cache; if (method === 0) cache = compressed; else if (method === 8) cache = await inflateRaw(compressed); else throw new Error('Unsupported ZIP compression method ' + method + '.'); return cache; },
      async text() { return td.decode(await this.bytes()); },
      async blob() { return new Blob([await this.bytes()], { type: mimeFor(name) }); }
    });
    p += 46 + nl + xl + cl;
  }
  return out.filter((x) => !x.name.endsWith('/'));
}

/* ---------- vCard (.vcf) ---------- */

function quotedPrintableDecode(v) {
  if (!/=([0-9A-F]{2}|[\r\n])/i.test(v)) return v;
  try {
    const s = v.replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
      else bytes.push(...te.encode(s[i]));
    }
    return td.decode(new Uint8Array(bytes));
  } catch { return v; }
}
function parseVCF(text) {
  const cards = String(text || '').replace(/\r?\n[ \t]/g, '').match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [];
  return cards.map((c, i) => {
    const lines = c.split(/\r?\n/);
    const get = (k) => { const l = lines.find((x) => new RegExp('^' + k + '(?:;[^:]*)?:', 'i').test(x)); return l ? quotedPrintableDecode(l.slice(l.indexOf(':') + 1)).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').trim() : ''; };
    let name = get('FN');
    if (!name) name = get('N').split(';').filter(Boolean).reverse().join(' ').trim();
    const tel = (lines.find((x) => /^TEL(?:;[^:]*)?:/i.test(x)) || '').replace(/^.*?:/, '').trim();
    const email = (lines.find((x) => /^EMAIL(?:;[^:]*)?:/i.test(x)) || '').replace(/^.*?:/, '').trim();
    return { name: name || 'Contact ' + (i + 1), phone: tel, email };
  });
}

/* ---------- Chat text (_chat.txt) ---------- */

function parseChat(text) {
  const out = [];
  let cur = null;
  for (const line0 of String(text || '').replace(/‎|‪|‬/g, '').split(/\r?\n/)) {
    const line = line0.trimEnd();
    const m = line.match(/^\[?(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]?\s*[-–]?\s*([^:]+):\s?(.*)$/i);
    if (m) { cur = { date: m[1], time: m[2], sender: m[3].trim(), text: m[4] || '', index: out.length }; out.push(cur); }
    else if (cur) cur.text += (cur.text ? '\n' : '') + line;
  }
  return out;
}
function pureAttachment(t) { return /^<?attached:.*>?$/i.test(String(t || '').trim()) || /\(file attached\)$/i.test(String(t || '').trim()) || /^<media omitted>$/i.test(String(t || '').trim()); }

/* ---------- Profile scoring ---------- */

const TERM_RES = [
  /\b(?:name|full name|age|height|occupation|education|hashkafa|background|looking for|contact|phone)\b/ig,
  /(?:שם מלא|שם|גיל|גובה|מגורים|עיסוק|עבודה|השכלה|לימודים|רקע|השקפה|מחפש|מחפשת|לפרטים|איש קשר|טלפון)/g,
  /(?:имя|фио|возраст|рост|город|работа|профессия|образование|семья|религиоз|контакт|телефон)/ig
];
function scoreProfile(text) {
  const s = String(text || ''), lines = s.split(/\r?\n/).filter((x) => x.trim());
  let n = 0;
  if (s.length > 180) n += 2; else if (s.length > 90) n++;
  if (lines.length >= 6) n += 2; else if (lines.length >= 3) n++;
  for (const re of TERM_RES) { const m = s.match(re); n += Math.min(4, (m || []).length); }
  if (/\b\d{2}\s*(?:years?\s*old|yo)\b/i.test(s) || /(?:בן|בת)\s*\d{2}/.test(s) || /\b\d{2}\s*(?:лет|года)\b/i.test(s)) n += 2;
  if (/(?:\+?\d[\d\s().-]{7,}\d)/.test(s)) n++;
  return n;
}
function gender(text) {
  const s = String(text || '');
  if (/(?:\bwoman\b|\bfemale\b|\bgirl\b|(?:^|\s)בת\s+\d{2}|מחפשת|בחורה|девушка|женщина|невеста)/i.test(s)) return 'girls';
  if (/(?:\bman\b|\bmale\b|\bguy\b|(?:^|\s)בן\s+\d{2}|מחפש|בחור|мужчина|парень|жених)/i.test(s)) return 'guys';
  return '';
}

function existingShad(name, phone) {
  const p = phoneKey(phone), n = norm(name);
  return state.shadchanim.find((x) => (p && phoneKey(x.phone) === p) || (n && norm(x.name) === n)) || null;
}
function existingProfile(kind, name, age, text) {
  const n = norm(name), h = hash(text);
  return state[kind].find((x) => (n && norm(x.name) === n && String(x.age || '') === String(age || '')) || (text && hash(x.text || '') === h)) || null;
}

/* ---------- Scan a ZIP for shadchanim + possible profiles ---------- */

function guessChatName(zipName, messages) {
  for (const x of state.shadchanim) {
    const s = messages.find((m) => sameName(m.sender, x.name) || (phoneKey(m.sender) && phoneKey(m.sender) === phoneKey(x.phone)));
    if (s) return x.name;
  }
  const n = String(zipName || '').replace(/\.zip$/i, '').replace(/^WhatsApp(?: Chat)?(?: with)?\s*/i, '').replace(/^Chat(?: with)?\s*/i, '').trim();
  return n && n.length < 90 && !/^WhatsApp$/i.test(n) ? n : (messages[0]?.sender || '');
}

async function scanZip(file) {
  const entries = await openZip(file);
  const lookup = new Map(entries.map((e) => [baseName(e.name).toLowerCase(), e]));
  const txts = entries.filter((e) => ext(e.name) === '.txt');
  const chatEntry = txts.find((e) => /(^|\/)_?chat\.txt$/i.test(e.name)) || txts.find((e) => /whatsapp/i.test(e.name)) || txts[0] || null;
  const chatText = chatEntry ? await chatEntry.text() : '';
  const messages = parseChat(chatText);
  const sourceGuess = guessChatName(file.name, messages);
  const contacts = [];
  for (const e of entries.filter((x) => ext(x.name) === '.vcf')) for (const c of parseVCF(await e.text())) contacts.push({ ...c, file: e.name });

  const profiles = [];
  const used = new Set();
  function refEntry(text) {
    const low = String(text || '').toLowerCase();
    for (const [name, e] of lookup) if (name && low.includes(name)) return e;
    return null;
  }
  for (const e of entries.filter((x) => x !== chatEntry && ext(x.name) !== '.vcf' && isProfileFile(x.name))) {
    let mi = -1;
    for (let i = 0; i < messages.length; i++) if (refEntry(messages[i].text) === e) { mi = i; break; }
    let context = '';
    if (mi >= 0) {
      const arr = [];
      for (let j = Math.max(0, mi - 2); j <= Math.min(messages.length - 1, mi + 2); j++) if (j !== mi && messages[j].sender === messages[mi].sender && scoreProfile(messages[j].text) >= 2) { arr.push(messages[j].text); used.add(j); }
      context = arr.join('\n\n').trim();
      used.add(mi);
    }
    if (ext(e.name) === '.txt') { try { const t = await e.text(); if (scoreProfile(t) > scoreProfile(context)) context = t; } catch { /* ignore */ } }
    const na = extractNameAge(context, e.name), ct = extractContact(context);
    const sc = scoreProfile(context) + (/(profile|shidduch|resume|bio|פרופיל|כרטיס|שידוך|анкета|резюме)/i.test(e.name) ? 4 : 0);
    profiles.push({ entry: e, fileName: baseName(e.name), text: context, name: na.name, age: na.age, kind: gender(context), contactName: ct.name, contactPhone: ct.phone, contactEmail: ct.email, checked: sc >= 4 || /\.(?:pdf|docx?|rtf)$/i.test(e.name), score: sc });
  }
  for (let i = 0; i < messages.length; i++) {
    if (used.has(i) || pureAttachment(messages[i].text)) continue;
    const sc = scoreProfile(messages[i].text);
    if (sc < 5) continue;
    const na = extractNameAge(messages[i].text, ''), ct = extractContact(messages[i].text);
    profiles.push({ entry: null, fileName: '', text: messages[i].text, name: na.name, age: na.age, kind: gender(messages[i].text), contactName: ct.name, contactPhone: ct.phone, contactEmail: ct.email, checked: true, score: sc });
  }
  const seen = new Set();
  const dedup = profiles.filter((p) => { const k = norm(p.name) + '|' + p.age + '|' + hash(p.text || p.fileName); if (seen.has(k)) return false; seen.add(k); return true; });
  return { file, entries, chatEntry, chatText, messages, sourceGuess, contacts, profiles: dedup };
}

/* ---------- Review sheet ---------- */

async function previewImage(p) {
  if (!p.entry || !isImageFile(p.entry.name)) return '';
  try { const b = await p.entry.blob(); const u = URL.createObjectURL(b); p.preview = u; return `<img class="waImportThumb" src="${u}" alt="Possible profile">`; } catch { return ''; }
}
function sourceSelectHtml(scan) {
  const arr = state.shadchanim;
  const match = arr.find((x) => sameName(x.name, scan.sourceGuess) || (phoneKey(x.phone) && phoneKey(x.phone) === phoneKey(scan.sourceGuess)));
  return { match, html: '<option value="">No existing match</option>' + arr.map((x) => `<option value="${x.id}" ${match && String(match.id) === String(x.id) ? 'selected' : ''}>${esc(x.name || 'Unnamed shadchan')}</option>`).join('') };
}

function cleanup(scan) {
  for (const p of scan?.profiles || []) if (p.preview) try { URL.revokeObjectURL(p.preview); } catch { /* ignore */ }
}

async function showScan(scan) {
  const src = sourceSelectHtml(scan);
  const previews = [];
  for (const p of scan.profiles) previews.push(await previewImage(p));

  const contactsHtml = scan.contacts.length ? scan.contacts.map((c, i) => {
    const already = existingShad(c.name, c.phone);
    return `<div class="waImportItem" data-contact="${i}">
      <label class="waImportCheck"><input class="waUseContact" type="checkbox" ${already ? '' : 'checked'}>Shadchan ${already ? '<span class="pill">already in PeerMatch</span>' : ''}</label>
      <div class="pmGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:7px"><label>Name<input class="waCName" value="${esc(c.name)}"></label><label>Phone<input class="waCPhone" value="${esc(c.phone)}"></label></div>
      <label>Email<input class="waCEmail" value="${esc(c.email)}"></label>
      </div>`;
  }).join('') : '<div class="small">No contact cards (.vcf) were found.</div>';

  const profilesHtml = scan.profiles.length ? scan.profiles.map((p, i) => {
    const duplicate = p.kind && existingProfile(p.kind, p.name, p.age, p.text);
    return `<div class="waImportItem" data-profile="${i}">
      <label class="waImportCheck"><input class="waUseProfile" type="checkbox" ${p.checked && !duplicate ? 'checked' : ''}>Possible profile ${duplicate ? '<span class="pill">already in PeerMatch</span>' : ''}</label>
      ${previews[i] || ''}
      <div class="pmGrid" style="display:grid;grid-template-columns:1fr 105px;gap:7px"><label>Name<input class="waPName" value="${esc(p.name)}" placeholder="Name"></label><label>Age<input class="waPAge" value="${esc(p.age)}" inputmode="numeric" placeholder="Age"></label></div>
      <label>Guy / Girl<select class="waPKind"><option value="" ${!p.kind ? 'selected' : ''}>Choose…</option><option value="guys" ${p.kind === 'guys' ? 'selected' : ''}>Guy</option><option value="girls" ${p.kind === 'girls' ? 'selected' : ''}>Girl</option></select></label>
      <div class="small">${esc(p.fileName ? 'Attachment: ' + p.fileName : 'Profile text found in chat')} • confidence ${p.score}</div>
      <div class="pmGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:7px"><label>Contact person<input class="waPContactName" value="${esc(p.contactName)}" placeholder="Usually near bottom"></label><label>Contact phone<input class="waPContactPhone" value="${esc(p.contactPhone)}"></label></div>
      <label>Contact email<input class="waPContactEmail" value="${esc(p.contactEmail)}"></label>
      ${p.text ? `<div class="waImportText">${esc(p.text)}</div>` : ''}
      </div>`;
  }).join('') : '<div class="small">No likely profiles were found automatically.</div>';

  openSheet(`<h2>Import WhatsApp ZIP</h2>
    <div class="card"><div class="sectionTitle" style="margin-top:0">Chat source</div>
      <div class="small">This person will be saved as "Referred by" for the shadchanim found in the export.</div>
      <label>Existing shadchan<select id="waSource">${src.html}</select></label>
      <label>Referred by / chat name<input id="waSourceName" value="${esc(src.match?.name || scan.sourceGuess)}" placeholder="Who sent these contacts?"></label>
      <label class="waImportCheck"><input id="waAddSource" type="checkbox" ${src.match ? '' : 'checked'}>Add this chat person as a shadchan if not already in PeerMatch</label>
      <label class="waImportCheck"><input id="waHistory" type="checkbox" ${scan.messages.length ? 'checked' : ''}>Import this conversation into History (${scan.messages.length} messages)</label>
    </div>
    <div class="card"><div class="sectionTitle" style="margin-top:0">Shadchanim found — ${scan.contacts.length}</div>${contactsHtml}</div>
    <div class="card"><div class="sectionTitle" style="margin-top:0">Possible profiles — ${scan.profiles.length}</div><div class="small">PeerMatch looks for Name / שם / Имя and Age / גיל / Возраст. It also checks the bottom of profile text for contact details. Review before saving.</div>${profilesHtml}</div>
    <div id="waImportStatus" class="small"></div>
    <div class="row" style="position:sticky;bottom:0;background:rgba(246,245,242,.97);padding:10px 0"><button type="button" class="primary" id="waImportNow" style="flex:1.4">Import selected</button><button type="button" class="secondary" id="waImportCancel" style="flex:.8">Cancel</button></div>`);

  const sel = document.getElementById('waSource'), nameEl = document.getElementById('waSourceName'), addEl = document.getElementById('waAddSource');
  sel.onchange = () => { const x = state.shadchanim.find((z) => String(z.id) === sel.value); if (x) { nameEl.value = x.name || ''; addEl.checked = false; } };
  document.getElementById('waImportCancel').onclick = () => { cleanup(scan); closeSheet(); };
  document.getElementById('waImportNow').onclick = () => importScan(scan);
}

function rowsFromSheet(scan) {
  const contacts = [...document.querySelectorAll('[data-contact]')].map((r) => ({ use: r.querySelector('.waUseContact').checked, name: r.querySelector('.waCName').value.trim(), phone: r.querySelector('.waCPhone').value.trim(), email: r.querySelector('.waCEmail').value.trim() }));
  const profiles = [...document.querySelectorAll('[data-profile]')].map((r) => {
    const p = scan.profiles[Number(r.dataset.profile)];
    return { original: p, use: r.querySelector('.waUseProfile').checked, name: r.querySelector('.waPName').value.trim(), age: r.querySelector('.waPAge').value.trim(), kind: r.querySelector('.waPKind').value, contactName: r.querySelector('.waPContactName').value.trim(), contactPhone: r.querySelector('.waPContactPhone').value.trim(), contactEmail: r.querySelector('.waPContactEmail').value.trim() };
  });
  return { contacts, profiles };
}
function bestSender(messages, sourceName) {
  const senders = [...new Set(messages.map((m) => m.sender).filter(Boolean))];
  return senders.find((s) => sameName(s, sourceName) || (phoneKey(s) && phoneKey(s) === phoneKey(sourceName))) || senders[0] || '';
}
function resolveSource(scan) {
  const id = document.getElementById('waSource').value;
  const name = document.getElementById('waSourceName').value.trim() || scan.sourceGuess || 'WhatsApp shadchan';
  let x = state.shadchanim.find((z) => String(z.id) === id) || existingShad(name, name);
  if (!x && document.getElementById('waAddSource').checked) {
    const p = /^\+?[\d\s().-]{8,}$/.test(name) ? name : '';
    x = { id: Date.now() + Math.floor(Math.random() * 1000), name: p ? 'WhatsApp shadchan' : name, phone: p, email: '', tags: '', referredBy: '', referredById: null, activities: [] };
    state.shadchanim.unshift(x);
  }
  return { x, name: x?.name || name };
}
function importHistory(source, scan, sourceName) {
  if (!source) return 0;
  const old = new Set((source.activities || []).map((a) => a.importKey).filter(Boolean));
  const their = bestSender(scan.messages, sourceName);
  let n = 0;
  for (const m of scan.messages) {
    const text = String(m.text || '').trim();
    if (!text || pureAttachment(text)) continue;
    const key = 'wa61:' + hash([m.date, m.time, m.sender, text].join('|'));
    if (old.has(key)) continue;
    addActivity(source, { type: sameName(m.sender, their) ? 'wa-in' : 'wa-out', text, ts: (m.date + ' ' + m.time).trim(), importKey: key, importedFrom: 'WhatsApp ZIP', whatsappSender: m.sender });
    old.add(key);
    n++;
  }
  return n;
}

async function importScan(scan) {
  const btn = document.getElementById('waImportNow'), st = document.getElementById('waImportStatus');
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    const r = rowsFromSheet(scan);
    for (const p of r.profiles) if (p.use) {
      if (!p.kind) throw new Error('Choose Guy or Girl for each selected profile.');
      if (p.age && (Number(p.age) < 18 || Number(p.age) > 99)) throw new Error('Check the age for ' + (p.name || 'a selected profile') + '.');
    }
    const src = resolveSource(scan), source = src.x, sourceName = src.name;
    let added = 0, updated = 0, profileCount = 0;
    for (const c of r.contacts) {
      if (!c.use || (!c.name && !c.phone)) continue;
      const x = existingShad(c.name, c.phone);
      if (x) {
        if (!x.phone && c.phone) x.phone = c.phone;
        if (!x.email && c.email) x.email = c.email;
        if (!x.referredBy && sourceName) { x.referredBy = sourceName; x.referredById = source?.id || null; }
        updated++;
      } else {
        state.shadchanim.unshift({ id: Date.now() + Math.floor(Math.random() * 1e6), name: c.name || c.phone || 'Imported shadchan', phone: c.phone, email: c.email, tags: '', referredBy: sourceName || '', referredById: source?.id || null, activities: [] });
        added++;
      }
    }
    for (const p of r.profiles) {
      if (!p.use || existingProfile(p.kind, p.name, p.age, p.original.text)) continue;
      let image = null, attachment = null, attachmentName = '', attachmentType = '';
      if (p.original.entry) {
        const b = await p.original.entry.blob();
        if (isImageFile(p.original.entry.name)) image = b;
        else { attachment = b; attachmentName = p.original.fileName; attachmentType = b.type; }
      }
      const contactName = p.contactName || sourceName || '', contactPhone = p.contactPhone || source?.phone || '', contactEmail = p.contactEmail || source?.email || '';
      const rec = {
        id: Date.now() + Math.floor(Math.random() * 1e6), name: p.name || ((p.kind === 'guys' ? 'Guy' : 'Girl') + ' profile'), age: p.age || '', text: p.original.text || '',
        profileImage: image, photo: image, profileMediaFull: image, profileMediaThumb: image,
        profileAttachment: attachment, profileAttachmentName: attachmentName, profileAttachmentType: attachmentType,
        contact1Name: contactName, contact1Phone: contactPhone,
        source: contactName, sourceName: contactName, sourcePhone: contactPhone, sourceEmail: contactEmail,
        importedFromShadchan: sourceName || '', importedFromShadchanId: source?.id || null,
        activities: []
      };
      addActivity(rec, { type: 'action', action: 'Imported from WhatsApp', text: 'Imported from WhatsApp chat' + (sourceName ? ' with ' + sourceName : '') });
      state[p.kind].unshift(rec);
      profileCount++;
    }
    const hist = document.getElementById('waHistory')?.checked ? importHistory(source, scan, sourceName) : 0;
    await save();
    renderShadchanim(); renderGuys(); renderGirls();
    cleanup(scan);
    alert(`Import complete.\n\n${added} shadchanim added\n${updated} existing shadchanim updated\n${profileCount} profiles added\n${hist} WhatsApp messages added to History`);
    closeSheet();
  } catch (e) {
    console.warn('zugmatch WhatsApp import', e);
    st.textContent = e?.message || 'Import failed.';
    alert(e?.message || 'Import failed.');
    btn.disabled = false; btn.textContent = 'Import selected';
  }
}

/* ---------- Entry points ---------- */

export async function chooseZip(file) {
  if (!file) return;
  if (!/\.zip$/i.test(file.name) && !/zip/i.test(file.type || '')) return alert('Choose a WhatsApp Export chat ZIP file.');
  openSheet('<h2>Import WhatsApp ZIP</h2><div class="card">Opening the ZIP and looking for conversation messages, contact cards and profiles…</div>');
  try { await showScan(await scanZip(file)); }
  catch (e) { console.warn(e); alert(e?.message || 'Could not open this ZIP.'); closeSheet(); }
}

/* Checked once at boot: a ZIP shared into the app via the share target. */
export async function checkSharedZip() {
  const pending = await getPendingShare();
  if (!pending?.files?.length) return;
  const f = pending.files.find((z) => /\.zip$/i.test(z.name || '') || /zip/i.test(z.type || ''));
  if (!f) return;
  await clearPendingShare();
  await chooseZip(f);
}
