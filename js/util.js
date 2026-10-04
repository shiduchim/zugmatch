/* Shared helpers: escaping, timestamps, ids, phones, text rendering.
   No DOM, no storage — pure functions used by every other module. */

export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function stamp(date) {
  return (date instanceof Date ? date : new Date()).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

let lastId = 0;
export function nextId() {
  let id = Date.now();
  if (id <= lastId) id = lastId + 1;
  lastId = id;
  return id;
}

export function newLinkId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'zm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ---------- Phones (see docs/REBUILD_INVENTORY.md §8) ---------- */

const IL_LANDLINE = ['02', '03', '04', '08', '09'];
const IL_MOBILE = ['050', '051', '052', '053', '054', '055', '058'];
const IL_VOIP = ['072', '073', '074', '076', '077', '078'];

export function digitsOnly(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/* Israeli local digits (0XXXXXXXX), or '' if this isn't an Israeli number at all. */
function israeliLocalDigits(v) {
  let d = digitsOnly(v);
  if (!d) return '';
  let fromIntl = false;
  if (d.startsWith('00972')) { d = d.slice(5); fromIntl = true; }
  else if (d.startsWith('972') && d.length > 3) { d = d.slice(3); fromIntl = true; }
  if (fromIntl) {
    if (d.startsWith('0')) d = d.slice(1);
    return '0' + d;
  }
  if (d.startsWith('0') && (IL_LANDLINE.includes(d.slice(0, 2)) || IL_MOBILE.includes(d.slice(0, 3)) || IL_VOIP.includes(d.slice(0, 3)))) {
    return d;
  }
  return '';
}

function formatLocalDigits(d) {
  if (IL_LANDLINE.includes(d.slice(0, 2)) && d.length === 9) return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
  if ((IL_MOBILE.includes(d.slice(0, 3)) || IL_VOIP.includes(d.slice(0, 3))) && d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  return d;
}

/* Israeli numbers normalized to local 05X-XXX-XXXX / 0X-XXX-XXXX form. Other
   international numbers (+1 and so on) are kept exactly as typed. */
export function normalizePhone(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const local = israeliLocalDigits(raw);
  return local ? formatLocalDigits(local) : raw;
}

export function phoneType(v) {
  const local = israeliLocalDigits(v);
  if (!local) return 'unknown';
  if (IL_LANDLINE.includes(local.slice(0, 2))) return 'landline';
  if (IL_MOBILE.includes(local.slice(0, 3))) return 'mobile';
  if (IL_VOIP.includes(local.slice(0, 3))) return 'voip';
  return 'unknown';
}

export function isLandline(v) {
  return phoneType(v) === 'landline';
}

/* Matching key: digits without the country code or the trunk 0. */
export function phoneKey(v) {
  const local = israeliLocalDigits(v);
  if (local) return local.replace(/^0/, '');
  let d = digitsOnly(v);
  if (d.startsWith('00')) d = d.slice(2);
  return d;
}

/* WhatsApp always wants the international form. */
export function whatsAppDigits(v) {
  const local = israeliLocalDigits(v);
  if (local) return '972' + local.slice(1);
  let d = digitsOnly(v);
  if (d.startsWith('00')) d = d.slice(2);
  return d;
}

/* ---------- Age from pasted profile text (EN/HE/RU) ---------- */

export function deriveAge(text) {
  const s = String(text ?? '');
  const m =
    s.match(/\bage\s*(?:is|:|-)?\s*(\d{2})\b/i) ||
    s.match(/\b(\d{2})\s*(?:years?\s*old|yo)\b/i) ||
    s.match(/גיל\s*[:\-]?\s*(\d{2})\b/) ||
    s.match(/\bвозраст\s*[:\-]?\s*(\d{2})\b/i) ||
    s.match(/\b(\d{2})\s*(?:лет|года|год)\b/i);
  if (!m) return '';
  const n = Number(m[1]);
  return n >= 18 && n <= 99 ? String(n) : '';
}

/* ---------- Name / age / contact extraction from pasted or imported profile text ---------- */

function cleanEdge(s) {
  return String(s ?? '').replace(/^[\s*•\-–—:]+|[\s*•\-–—:]+$/g, '').trim();
}

/* Shared by forms.js (paste/attachment autofill) and import-whatsapp.js (profile detection):
   looks for a labeled "Name:"/"שם:"/"Имя:" line, else falls back to the first plausible line. */
export function extractNameAge(text, fileNameFallback) {
  const lines = String(text ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 16);
  let name = '';
  const age = deriveAge(text);
  const nameRe = [/^(?:name|full name)\s*[:\-–]\s*(.+)$/i, /^(?:שם|שם מלא)\s*[:\-–]\s*(.+)$/, /^(?:имя|фио|ф\.?\s*и\.?\s*о\.?)\s*[:\-–]\s*(.+)$/i];
  for (const line of lines) { for (const re of nameRe) { const m = line.match(re); if (m) { name = cleanEdge(m[1]); break; } } if (name) break; }
  if (!name && lines.length) {
    let first = cleanEdge(lines[0].replace(/[*_~]/g, ''));
    const bad = /^(?:shidduch|profile|resume|bio|פרופיל|כרטיס|שידוך|анкета|резюме)\b/i;
    if (first.length <= 70 && !bad.test(first) && !/@/.test(first) && !/(?:\+?\d[\d\s().-]{7,}\d)/.test(first) && first.split(/\s+/).length <= 7) {
      name = first.replace(/\s*[,|]\s*(?:age\s*)?\d{2}\b.*$/i, '').replace(/\s+(?:בן|בת)\s+\d{2}\b.*$/, '').replace(/\s+\d{2}\s*(?:лет|года)\b.*$/i, '').trim();
    }
  }
  if (!name && fileNameFallback) {
    let s = String(fileNameFallback).split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (!/^(?:IMG|WA|DOC|PDF)[ -]?\d/i.test(s) && !/^\d{8,}/.test(s) && s.length >= 2 && s.length <= 70) name = s;
  }
  return { name: name.slice(0, 80), age };
}

/* Contact name/phone/email near the bottom of pasted or imported profile text. */
export function extractContact(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(-16);
  const joined = lines.join('\n');
  const phone = (joined.match(/(?:\+?\d[\d\s().-]{7,}\d)/) || [])[0] || '';
  const email = (joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || '';
  const labels = [/(?:contact(?:\s+person)?|for (?:more )?info(?:rmation)?|contact info)\s*[:\-–]?\s*(.*)/i, /(?:לפרטים|איש קשר|ליצירת קשר)\s*[:\-–]?\s*(.*)/, /(?:контакт(?:ное лицо)?|для связи|по вопросам)\s*[:\-–]?\s*(.*)/i];
  let name = '';
  for (let i = lines.length - 1; i >= 0 && !name; i--) for (const re of labels) { const m = lines[i].match(re); if (m) { name = String(m[1] || '').replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '').replace(/[•|,;]+$/g, '').trim(); break; } }
  return { name: name.length <= 70 ? name : '', phone: phone.trim(), email: email.trim() };
}

/* ---------- WhatsApp *bold* text ---------- */

/* Plain text for list cards and names: strip the raw asterisks, never render them. */
export function stripBold(text) {
  return String(text ?? '').replace(/\*+/g, '');
}

/* Escaped HTML for profile text / history bodies: WhatsApp *bold* becomes <strong>. */
export function renderBoldHtml(text) {
  let h = esc(text);
  h = h.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/gm, '$1<strong>$2</strong>');
  return h;
}

/* ---------- Language line filter (EN/HE/RU), used when sharing ---------- */

function lineScripts(s) {
  s = String(s ?? '');
  return { en: /[A-Za-z]/.test(s), he: /[֐-׿]/.test(s), ru: /[Ѐ-ӿ]/.test(s) };
}

export function scriptsIn(text) {
  return lineScripts(String(text ?? ''));
}

/* Keeps lines that are in an included language, or that have no letters at all
   (blank lines, numbers, punctuation) so paragraph structure survives. */
export function filterLanguageLines(text, included) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => {
      const s = lineScripts(line);
      if (!s.en && !s.he && !s.ru) return true;
      return (s.en && included.en) || (s.he && included.he) || (s.ru && included.ru);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- Misc ---------- */

export function safeFileName(name, fallback) {
  const s = String(name ?? '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  return s || fallback || 'file';
}

/* YYYY-MM-DD for `offsetDays` from today, local time (matches PeerMatch's callReminderDate). */
export function todayKey(offsetDays) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + (offsetDays || 0));
  return dateOnly(d);
}

/* Overdue / Today / Tomorrow / DD/MM/YYYY for a callReminderDate. */
export function dueLabel(v) {
  if (!v) return '';
  const t = todayKey(0), tm = todayKey(1);
  if (v < t) return 'Overdue';
  if (v === t) return 'Today';
  if (v === tm) return 'Tomorrow';
  const p = v.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : v;
}

export function dateOnly(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear(), m = String(x.getMonth() + 1).padStart(2, '0'), day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function objectUrl(blob) {
  return blob ? URL.createObjectURL(blob) : '';
}
