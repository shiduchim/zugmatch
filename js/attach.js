/* Attachments (open, download, viewer), PDF.js/OCR parsing, Translate. External libraries
   are loaded only when needed and kept exactly as PeerMatch loads them, so an attachment
   still saves when they're blocked (e.g. under NetSpark). */

import { esc, scriptsIn } from './util.js';

const PDF_JS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESS_JS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const loaded = new Map();
function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = () => reject(new Error('Could not load the local parsing engine. Check your internet connection and try again.'));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}
async function pdfLib() {
  const lib = await loadScript(PDF_JS, 'pdfjsLib');
  if (!lib) throw new Error('PDF parser did not load.');
  lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  return lib;
}
async function tess() {
  const t = await loadScript(TESS_JS, 'Tesseract');
  if (!t) throw new Error('OCR engine did not load.');
  return t;
}

async function ocrSource(source, onStatus) {
  const T = await tess();
  const langs = ['eng+heb+rus', 'eng+heb', 'eng'];
  let lastErr = null;
  for (const lang of langs) {
    try {
      const r = await T.recognize(source, lang, { logger: (m) => { if (m?.status) onStatus?.(m.status + (typeof m.progress === 'number' ? ' ' + Math.round(m.progress * 100) + '%' : '')); } });
      return String(r?.data?.text || '').trim();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('OCR failed.');
}
async function ocrImage(file, onStatus) {
  const u = URL.createObjectURL(file);
  try { return await ocrSource(u, onStatus); } finally { URL.revokeObjectURL(u); }
}
async function pdfText(file, onStatus) {
  const lib = await pdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  onStatus?.('Reading PDF text…');
  const pdf = await lib.getDocument({ data: bytes }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    onStatus?.(`Reading PDF page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    text += tc.items.map((x) => String(x.str || '') + (x.hasEOL ? '\n' : ' ')).join('').trim() + '\n\n';
  }
  text = text.trim();
  if (text.replace(/\s/g, '').length >= 35) return text;
  let ocr = '';
  const max = Math.min(pdf.numPages, 4);
  for (let i = 1; i <= max; i++) {
    onStatus?.(`PDF has little selectable text. OCR page ${i} of ${max}…`);
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.7 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ocr += (await ocrSource(canvas, onStatus)) + '\n\n';
    canvas.width = canvas.height = 1;
  }
  return ocr.trim();
}

function isPdfFile(file) {
  return /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');
}
function isImageFile(file) {
  return String(file.type || '').startsWith('image/') || /\.(?:jpe?g|png|webp|gif|heic)$/i.test(file.name || '');
}

/* Reads text from a PDF or image file. Never throws — a failed parse just resolves to ''
   so the caller can still keep the attachment. */
export async function parseFile(file, onStatus) {
  try {
    if (isPdfFile(file)) return await pdfText(file, onStatus);
    if (isImageFile(file)) return await ocrImage(file, onStatus);
    return '';
  } catch (e) {
    console.warn('zugmatch attachment parse failed', e);
    return '';
  }
}

/* ---------- Add/Edit form attachment box: Attach only / Attach + parse text / Remove ---------- */

export function mountAttachmentBox(container, existing, onParsedText) {
  const box = document.createElement('div');
  box.className = 'card attachBox';
  box.innerHTML = `<div class="sectionTitle" style="margin-top:0">PDF / screenshot</div>
    <div class="small">Attach a profile PDF or a screenshot. zugmatch tries to read English, Hebrew or Russian locally on this device and fills only empty fields.</div>
    <div class="actions" style="margin-top:8px;grid-template-columns:1fr 1fr auto"><button type="button" class="secondary" id="attachOnly">Attach only</button><button type="button" class="secondary" id="attachParse">Attach + parse text</button><button type="button" class="secondary" id="attachRemove">Remove</button></div>
    <input type="file" id="attachInput" class="hidden" accept="application/pdf,image/*,.pdf">
    <div class="small attachFileName" id="attachFileName" style="margin-top:7px"></div>
    <div class="small" id="attachStatus" style="margin-top:3px"></div>`;
  container.appendChild(box);

  const current = { file: null, name: '', mime: '', existingBlob: existing?.profileAttachment || null, existingName: existing?.profileAttachmentName || '', remove: false };
  const nameEl = box.querySelector('#attachFileName');
  const statusEl = box.querySelector('#attachStatus');
  const input = box.querySelector('#attachInput');

  function updateUi() {
    nameEl.textContent = current.file ? (current.name || 'Attached file') : (current.existingName || 'No PDF or screenshot attached');
    box.querySelector('#attachRemove').style.display = current.file || current.existingBlob ? '' : 'none';
  }
  updateUi();

  box.querySelector('#attachRemove').onclick = () => {
    current.file = null; current.name = ''; current.mime = ''; current.existingBlob = null; current.existingName = '';
    current.remove = true;
    statusEl.textContent = 'Attachment will be removed when you save.';
    updateUi();
  };
  box.querySelector('#attachOnly').onclick = () => { input.dataset.mode = 'attach-only'; input.click(); };
  box.querySelector('#attachParse').onclick = () => { input.dataset.mode = 'parse'; input.click(); };
  input.onchange = async () => {
    const f = input.files?.[0];
    const mode = input.dataset.mode || 'parse';
    input.value = '';
    if (!f) return;
    current.file = f; current.name = f.name || 'attachment'; current.mime = f.type || ''; current.remove = false;
    updateUi();
    if (mode === 'attach-only') { statusEl.textContent = 'Attached without parsing text.'; return; }
    statusEl.textContent = 'Reading…';
    const text = await parseFile(f, (s) => { statusEl.textContent = s; });
    if (text) { onParsedText?.(text); statusEl.textContent = 'Text found. Empty fields were filled — review before saving.'; }
    else statusEl.textContent = 'No readable text was found. The attachment will still be kept.';
  };

  return {
    apply(record) {
      if (current.remove) { record.profileAttachment = null; record.profileAttachmentName = ''; record.profileAttachmentType = ''; }
      else if (current.file) { record.profileAttachment = current.file; record.profileAttachmentName = current.name || current.file.name; record.profileAttachmentType = current.mime || current.file.type || 'application/octet-stream'; }
    }
  };
}

/* ---------- Detail view: attachment box (Open PDF / Open attachment) ---------- */

function attachmentType(x) {
  const n = String(x?.profileAttachmentName || '').toLowerCase();
  const t = String(x?.profileAttachmentType || x?.profileAttachment?.type || '').toLowerCase();
  if (t.includes('pdf') || n.endsWith('.pdf')) return 'application/pdf';
  if (t.startsWith('image/')) return t;
  if (/\.png$/i.test(n)) return 'image/png';
  if (/\.jpe?g$/i.test(n)) return 'image/jpeg';
  if (/\.webp$/i.test(n)) return 'image/webp';
  if (/\.gif$/i.test(n)) return 'image/gif';
  return t || 'application/octet-stream';
}
function attachmentBlob(x) {
  const b = x?.profileAttachment;
  if (!(b instanceof Blob)) return null;
  const t = attachmentType(x);
  try { return String(b.type || '').toLowerCase() === t ? b : new Blob([b], { type: t }); } catch { return b; }
}

export function renderAttachmentDetail(record) {
  if (!record?.profileAttachment) return '';
  const label = attachmentType(record) === 'application/pdf' ? 'Open PDF' : 'Open attachment';
  return `<div class="card attachBox"><div class="small">Profile attachment</div><div>${esc(record.profileAttachmentName || 'Attached profile')}</div><button type="button" class="secondary full" id="openAttachment">${esc(label)}</button></div>`;
}
export function wireAttachmentDetail(container, record) {
  container.querySelector('#openAttachment')?.addEventListener('click', () => openAttachment(record));
}

let viewerUrl = null;
function closeViewer() {
  document.getElementById('attachmentViewer')?.remove();
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
}
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
async function shareOrDownload(blob, name) {
  let file = null;
  try { file = new File([blob], name, { type: blob.type }); } catch { /* ignore */ }
  if (file && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  downloadBlob(blob, name);
}

function openAttachment(record) {
  const blob = attachmentBlob(record);
  if (!blob) return alert('This attachment is no longer available.');
  closeViewer();
  const type = attachmentType(record);
  const name = record.profileAttachmentName || 'profile-attachment';
  if (!type.startsWith('image/')) {
    /* PDFs (and anything else): download directly and reliably rather than trying to
       render or auto-share — the reliable path on Android/PWA. */
    downloadBlob(blob, name);
    alert('Downloaded — open it from your Downloads to view it.');
    return;
  }
  const d = document.createElement('div');
  d.id = 'attachmentViewer';
  d.className = 'fullViewer';
  d.innerHTML = `<div class="fullViewerBar"><div class="fullViewerTitle">${esc(name)}</div><button type="button" class="secondary" id="viewerShare">Share / save</button><button type="button" class="primary" id="viewerClose">Close</button></div><div class="fullViewerBody" id="viewerBody"></div>`;
  document.body.appendChild(d);
  d.querySelector('#viewerClose').onclick = closeViewer;
  d.querySelector('#viewerShare').onclick = () => shareOrDownload(blob, name);
  viewerUrl = URL.createObjectURL(blob);
  d.querySelector('#viewerBody').innerHTML = `<img src="${viewerUrl}" alt="${esc(name)}">`;
}

/* ---------- Translate: English / Hebrew / Russian, Chrome on-device then Google fallback ---------- */

function detectLanguage(text) {
  const s = scriptsIn(text);
  const counts = { he: (String(text).match(/[֐-׿]/g) || []).length, ru: (String(text).match(/[Ѐ-ӿ]/g) || []).length, en: (String(text).match(/[A-Za-z]/g) || []).length };
  if (counts.he >= counts.ru && counts.he >= counts.en && counts.he > 0) return 'he';
  if (counts.ru >= counts.he && counts.ru >= counts.en && counts.ru > 0) return 'ru';
  void s;
  return 'en';
}
function chunks(text, max) {
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.55) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.55) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) out.push(rest);
  return out;
}
async function chromeTranslate(text, source, target, onStatus) {
  if (!('Translator' in self) || typeof Translator.create !== 'function') return null;
  if (source === target) return text;
  try {
    if (typeof Translator.availability === 'function') {
      const a = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
      if (a === 'unavailable') return null;
    }
    const tr = await Translator.create({ sourceLanguage: source, targetLanguage: target });
    const out = [];
    const parts = chunks(text, 1400);
    for (let i = 0; i < parts.length; i++) { onStatus(parts.length > 1 ? `Translating ${i + 1} of ${parts.length}…` : 'Translating…'); out.push(await tr.translate(parts[i])); }
    try { tr.destroy?.(); } catch { /* ignore */ }
    return out.join('\n\n');
  } catch (e) { console.warn('zugmatch on-device translation failed', e); return null; }
}
async function webTranslate(text, source, target, onStatus) {
  const out = [];
  const parts = chunks(text, 1200);
  for (let i = 0; i < parts.length; i++) {
    onStatus(parts.length > 1 ? `Translating ${i + 1} of ${parts.length}…` : 'Translating…');
    const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + encodeURIComponent(source) + '&tl=' + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(parts[i]);
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw new Error('Translation service ' + r.status);
    const j = await r.json();
    out.push((j?.[0] || []).map((a) => a?.[0] || '').join(''));
  }
  return out.join('\n\n');
}

export function mountTranslate(container, rawText) {
  if (!rawText?.trim()) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lightblue';
  btn.textContent = 'Translate';
  container.appendChild(btn);
  btn.onclick = () => {
    let bar = container.querySelector('.translateBar');
    if (bar) { bar.classList.toggle('hidden'); return; }
    bar = document.createElement('div');
    bar.className = 'translateBar';
    bar.innerHTML = '<button type="button" data-lang="en">English</button><button type="button" data-lang="he">Hebrew</button><button type="button" data-lang="ru">Russian</button>';
    const status = document.createElement('div');
    status.className = 'small translateStatus';
    const out = document.createElement('div');
    out.className = 'card translateOutput hidden';
    container.append(bar, status, out);
    bar.onclick = async (e) => {
      const b = e.target.closest('button[data-lang]');
      if (!b) return;
      const target = b.dataset.lang;
      const source = detectLanguage(rawText);
      if (source === target) { out.textContent = rawText; out.classList.remove('hidden'); status.textContent = 'Already ' + ({ en: 'English', he: 'Hebrew', ru: 'Russian' }[target]) + '.'; return; }
      status.textContent = 'Translating…';
      try {
        let t = await chromeTranslate(rawText, source, target, (s) => { status.textContent = s; });
        if (t == null) t = await webTranslate(rawText, source, target, (s) => { status.textContent = s; });
        out.textContent = t; out.classList.remove('hidden'); status.textContent = '';
      } catch (e2) { console.warn('zugmatch translation failed', e2); status.textContent = 'Translation is temporarily unavailable. Please try again.'; }
    };
  };
}
