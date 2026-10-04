/* Backup screen, ZIP backup (format PeerMatchBackup v2), email TXT (Base64), restore
   (ZIP or TXT), and the read-only "Copy my data from PeerMatch" button. Backups must move
   both ways, from PeerMatch to zugmatch and back — this reads and writes PeerMatch's exact
   ZIP/TXT format. */

import { openRawDb, load, state, save, lsGet, lsSet } from './db.js';
import { copyFromPeerMatch } from './db.js';
import { repairShareHistoryOnce } from './history.js';
import { esc } from './util.js';
import { openSheet, closeSheet } from './app.js';
import { renderAll } from './lists.js';

const BACKUP_FORMAT = 'PeerMatchBackup';
const BACKUP_VERSION = 2;
const LAST_BACKUP_KEY = 'LastBackupAt';
const TXT_HEADER = 'PEERMATCH-BACKUP-TEXT-V1\n';
const te = new TextEncoder();
const td = new TextDecoder();

/* ---------- Base64: encode in multiples of 3, decode in multiples of 4 ---------- */

function bytesToB64(bytes) {
  let out = '';
  const size = 0x6000; // divisible by 3
  for (let i = 0; i < bytes.length; i += size) {
    const part = bytes.subarray(i, Math.min(i + size, bytes.length));
    let s = '';
    for (let j = 0; j < part.length; j++) s += String.fromCharCode(part[j]);
    out += btoa(s);
  }
  return out;
}
function b64ToBytes(s) {
  const chunks = [];
  const size = 0x100000; // divisible by 4
  let total = 0;
  for (let i = 0; i < s.length; i += size) {
    const bin = atob(s.slice(i, i + size));
    const a = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) a[j] = bin.charCodeAt(j);
    chunks.push(a);
    total += a.length;
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of chunks) { out.set(a, p); p += a.length; }
  return out;
}

/* ---------- Minimal ZIP (store, uncompressed) with CRC32 ---------- */

function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
function dv16(v, o) { return v.getUint16(o, true); }
function dv32(v, o) { return v.getUint32(o, true); }

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(date) {
  const d = date || new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const day = (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date: day };
}
function localHeader(nameBytes, bytes, crc, when) {
  const dt = dosDateTime(when);
  return new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dt.time), ...u16(dt.date), ...u32(crc), ...u32(bytes.length), ...u32(bytes.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes]);
}
function centralHeader(nameBytes, bytes, crc, offset, when) {
  const dt = dosDateTime(when);
  return new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dt.time), ...u16(dt.date), ...u32(crc), ...u32(bytes.length), ...u32(bytes.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes]);
}
function makeZip(entries) {
  const localParts = [], centralParts = [];
  let offset = 0;
  const when = new Date();
  for (const e of entries) {
    const nameBytes = te.encode(e.name);
    const bytes = e.bytes instanceof Uint8Array ? e.bytes : new Uint8Array(e.bytes || 0);
    const crc = crc32(bytes);
    const local = localHeader(nameBytes, bytes, crc, when);
    localParts.push(local, bytes);
    centralParts.push(centralHeader(nameBytes, bytes, crc, offset, when));
    offset += local.length + bytes.length;
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const p of centralParts) centralSize += p.length;
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(centralSize), ...u32(centralOffset), ...u16(0)]);
  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}
function parseZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer), view = new DataView(arrayBuffer);
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) if (dv32(view, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This does not look like a valid PeerMatch ZIP backup.');
  const count = dv16(view, eocd + 10), centralOffset = dv32(view, eocd + 16);
  let pos = centralOffset;
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > bytes.length || dv32(view, pos) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
    const method = dv16(view, pos + 10), expectedCrc = dv32(view, pos + 16), size = dv32(view, pos + 20);
    const nameLen = dv16(view, pos + 28), extraLen = dv16(view, pos + 30), commentLen = dv16(view, pos + 32), localOffset = dv32(view, pos + 42);
    const name = td.decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    if (method !== 0) throw new Error('This backup uses an unsupported ZIP compression method.');
    if (localOffset + 30 > bytes.length || dv32(view, localOffset) !== 0x04034b50) throw new Error('The ZIP contains a damaged file entry.');
    const localNameLen = dv16(view, localOffset + 26), localExtraLen = dv16(view, localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen, end = start + size;
    if (end > bytes.length) throw new Error('A file inside the ZIP is incomplete.');
    const fileBytes = bytes.slice(start, end);
    if (crc32(fileBytes) !== expectedCrc) throw new Error('A file inside the ZIP failed its integrity check.');
    files.set(name, fileBytes);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------- Encoding IndexedDB stores to/from the manifest ---------- */

function readStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly'), store = tx.objectStore(storeName);
    const kr = store.getAllKeys(), vr = store.getAll();
    tx.oncomplete = () => resolve({ keys: kr.result || [], values: vr.result || [] });
    tx.onerror = () => reject(tx.error || new Error('Could not read ' + storeName));
  });
}
function extFor(blob, name) {
  const m = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
  if (m) return '.' + m[1].toLowerCase();
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'application/pdf': '.pdf', 'text/plain': '.txt' };
  return map[String(blob?.type || '').toLowerCase()] || '';
}
function cleanFileName(s) { return String(s || '').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80); }

async function buildBackup() {
  const db = await openRawDb();
  const media = new Map();
  const seen = new WeakMap();
  let seq = 0;
  async function encode(v) {
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (v instanceof Blob) {
      if (seen.has(v)) return seen.get(v);
      const original = typeof File !== 'undefined' && v instanceof File ? v.name : '';
      const type = String(v.type || 'application/octet-stream');
      const folder = type.startsWith('image/') ? 'photos' : type.startsWith('audio/') ? 'audio' : 'attachments';
      const base = cleanFileName(original.replace(/\.[^.]+$/, '')) || String(seq + 1).padStart(6, '0');
      seq++;
      const zipPath = folder + '/' + String(seq).padStart(6, '0') + '_' + base + extFor(v, original);
      const ref = { __peerMatchFile: 1, path: zipPath, type, name: original, lastModified: typeof File !== 'undefined' && v instanceof File ? v.lastModified : 0 };
      seen.set(v, ref);
      media.set(zipPath, new Uint8Array(await v.arrayBuffer()));
      return ref;
    }
    if (v instanceof Date) return { __peerMatchDate: 1, value: v.toISOString() };
    if (Array.isArray(v)) { const a = []; for (const item of v) a.push(await encode(item)); return a; }
    if (typeof v === 'object') { const out = {}; for (const [k, val] of Object.entries(v)) out[k] = await encode(val); return out; }
    return null;
  }

  const stores = {};
  for (const name of Array.from(db.objectStoreNames)) {
    const raw = await readStore(db, name);
    const entries = [];
    for (let i = 0; i < raw.keys.length; i++) entries.push({ key: await encode(raw.keys[i]), value: await encode(raw.values[i]) });
    stores[name] = entries;
  }
  const counts = {
    shadchanim: state.shadchanim.length, guys: state.guys.length, girls: state.girls.length,
    notes: [...state.shadchanim, ...state.guys, ...state.girls].reduce((n, x) => n + (x.activities || []).length, 0)
  };
  const manifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), appVersion: '1', database: 'ZugMatchDB', databaseVersion: 2, counts, stores };
  const files = [
    { name: 'data.json', bytes: te.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'photos/.keep', bytes: new Uint8Array(0) },
    { name: 'audio/.keep', bytes: new Uint8Array(0) },
    { name: 'attachments/.keep', bytes: new Uint8Array(0) }
  ];
  for (const [name, bytes] of media) files.push({ name, bytes });
  return { zip: makeZip(files), manifest };
}

async function decode(v, files) {
  if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) { const a = []; for (const x of v) a.push(await decode(x, files)); return a; }
  if (typeof v === 'object' && v.__peerMatchFile) {
    const bytes = files.get(v.path);
    if (!bytes) throw new Error('The backup is missing ' + v.path + '.');
    const opts = { type: v.type || 'application/octet-stream' };
    if (v.name && typeof File !== 'undefined') { try { return new File([bytes], v.name, { ...opts, lastModified: v.lastModified || Date.now() }); } catch { /* fall through */ } }
    return new Blob([bytes], opts);
  }
  if (typeof v === 'object' && v.__peerMatchDate) return new Date(v.value);
  if (typeof v === 'object') { const out = {}; for (const [k, val] of Object.entries(v)) out[k] = await decode(val, files); return out; }
  return v;
}

function dateName(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function backupFilename() { return 'PeerMatch_Backup_' + dateName(new Date()) + '.zip'; }
function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function restoreManifest(manifest, files) {
  const db = await openRawDb();
  const existing = Array.from(db.objectStoreNames);
  const backupStores = Object.keys(manifest.stores || {});
  const missing = backupStores.filter((n) => !existing.includes(n));
  if (missing.length) throw new Error('This backup needs store(s) this app version does not have: ' + missing.join(', '));
  const decoded = {};
  for (const name of backupStores) {
    decoded[name] = [];
    for (const entry of manifest.stores[name] || []) decoded[name].push({ key: await decode(entry.key, files), value: await decode(entry.value, files) });
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(existing, 'readwrite');
    for (const name of existing) tx.objectStore(name).clear();
    for (const name of backupStores) { const s = tx.objectStore(name); for (const e of decoded[name]) s.put(e.value, e.key); }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Restore failed'));
  });
  await load();
  repairShareHistoryOnce(state);
  await save();
}

async function inspectBackup(file) {
  let zipBytes;
  if (/\.txt$/i.test(file.name || '')) {
    const text = await file.text();
    if (!text.startsWith(TXT_HEADER)) throw new Error('This does not look like a PeerMatch emailed backup.');
    zipBytes = b64ToBytes(text.slice(TXT_HEADER.length).replace(/\s+/g, ''));
  } else {
    zipBytes = new Uint8Array(await file.arrayBuffer());
  }
  const files = parseZip(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength));
  const raw = files.get('data.json');
  if (!raw) throw new Error('data.json is missing from this backup.');
  let manifest;
  try { manifest = JSON.parse(td.decode(raw)); } catch { throw new Error('data.json is not valid.'); }
  if (manifest?.format !== BACKUP_FORMAT) throw new Error('This is not a PeerMatch/zugmatch backup.');
  if (Number(manifest.version) !== BACKUP_VERSION) throw new Error('This backup version is not supported.');
  if (!manifest.stores || typeof manifest.stores !== 'object') throw new Error('The backup database information is missing.');
  return { manifest, files };
}

function showRestorePreview(manifest, files) {
  const c = manifest.counts || {};
  openSheet(`<h2>Restore Backup</h2>
    <div class="card"><b>Backup from ${esc(formatDate(manifest.createdAt))}</b><br><br>
    ${Number(c.shadchanim || 0)} shadchanim<br>${Number(c.guys || 0)} guys<br>${Number(c.girls || 0)} girls<br>${Number(c.notes || 0)} notes</div>
    <div class="small" style="color:#8a3c2c;margin:10px 0">Restoring will replace the current data on this device with the contents of this backup.</div>
    <button type="button" class="primary full" id="restoreConfirm">Restore</button><div class="gap"></div>
    <button type="button" class="secondary full" id="restoreCancel">Cancel</button>`);
  document.getElementById('restoreConfirm').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Restoring…';
    try {
      await restoreManifest(manifest, files);
      alert('Backup restored successfully. The app will reload now.');
      location.reload();
    } catch (err) {
      console.warn('zugmatch restore failed', err);
      btn.disabled = false; btn.textContent = 'Restore';
      alert('Restore was not completed. Your existing data was left unchanged.\n\n' + (err.message || err));
    }
  };
  document.getElementById('restoreCancel').onclick = () => closeSheet();
}

/* ---------- Backup screen ---------- */

export function openBackupSheet() {
  const last = lsGet(LAST_BACKUP_KEY) || '';
  openSheet(`<h2>Backup</h2><div class="card">
    <button type="button" class="primary full" id="backupSave">Save backup to phone / computer</button><div class="gap"></div>
    <button type="button" class="secondary full" id="backupEmail">Email backup</button><div class="gap"></div>
    <button type="button" class="secondary full" id="backupRestore">Restore Backup</button>
    <input type="file" id="restoreFile" accept=".zip,.txt,application/zip,text/plain" class="hidden">
    <div class="small" style="margin-top:10px"><b>Last backup date</b><br><span id="lastBackupDate">${esc(formatDate(last))}</span></div>
    <div class="small" id="backupProgress" style="margin-top:6px;min-height:16px"></div>
    </div>
    <div class="card"><button type="button" class="secondary full" id="copyFromPeerMatch">Copy my data from PeerMatch</button>
    <div class="small" style="margin-top:6px">Reads PeerMatch's data on this device, read-only, and copies it here.</div></div>
    <button type="button" class="secondary full" id="backupClose">Close</button>`);

  const saveBtn = document.getElementById('backupSave');
  const emailBtn = document.getElementById('backupEmail');
  const restoreBtn = document.getElementById('backupRestore');
  const fileInput = document.getElementById('restoreFile');
  const progress = document.getElementById('backupProgress');

  saveBtn.onclick = async () => {
    const oldText = saveBtn.textContent;
    saveBtn.disabled = true; restoreBtn.disabled = true; saveBtn.textContent = 'Preparing…';
    progress.textContent = 'Collecting profiles, photos, audio and attachments…';
    try {
      const result = await buildBackup();
      const u = URL.createObjectURL(result.zip);
      const a = document.createElement('a');
      a.href = u; a.download = backupFilename(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
      lsSet(LAST_BACKUP_KEY, result.manifest.createdAt);
      document.getElementById('lastBackupDate').textContent = formatDate(result.manifest.createdAt);
      progress.textContent = 'Backup created: ' + backupFilename();
      saveBtn.textContent = 'Backup saved';
      setTimeout(() => { saveBtn.textContent = oldText; saveBtn.disabled = false; restoreBtn.disabled = false; }, 1600);
    } catch (e) {
      console.warn('zugmatch ZIP backup failed', e);
      saveBtn.textContent = oldText; saveBtn.disabled = false; restoreBtn.disabled = false; progress.textContent = '';
      alert('Could not create the backup. Your existing data was not changed.\n\n' + (e.message || e));
    }
  };

  emailBtn.onclick = async () => {
    const oldText = emailBtn.textContent;
    emailBtn.disabled = true; progress.textContent = 'Preparing email backup…';
    try {
      const result = await buildBackup();
      const bytes = new Uint8Array(await result.zip.arrayBuffer());
      const base = backupFilename().replace(/\.zip$/i, '');
      const file = new File([TXT_HEADER, bytesToB64(bytes)], base + '.txt', { type: 'text/plain', lastModified: Date.now() });
      const canShare = typeof navigator.share === 'function' && (!navigator.canShare || (() => { try { return navigator.canShare({ files: [file] }); } catch { return false; } })());
      if (!canShare) { alert('This browser cannot attach the backup automatically. Use "Save backup to phone / computer" instead.'); return; }
      await navigator.share({ files: [file] });
      lsSet(LAST_BACKUP_KEY, result.manifest.createdAt);
      document.getElementById('lastBackupDate').textContent = formatDate(result.manifest.createdAt);
      progress.textContent = 'Backup attached to the app you chose.';
    } catch (e) {
      if (e?.name !== 'AbortError') { console.warn('zugmatch email backup failed', e); alert('Could not attach the email backup. Try again.'); }
    } finally {
      emailBtn.disabled = false; emailBtn.textContent = oldText;
    }
  };

  restoreBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    restoreBtn.disabled = true; saveBtn.disabled = true; progress.textContent = 'Checking backup…';
    try {
      const r = await inspectBackup(f);
      restoreBtn.disabled = false; saveBtn.disabled = false; progress.textContent = '';
      showRestorePreview(r.manifest, r.files);
    } catch (e) {
      restoreBtn.disabled = false; saveBtn.disabled = false; progress.textContent = '';
      alert('Could not read this backup.\n\n' + (e.message || e));
    }
  };

  document.getElementById('copyFromPeerMatch').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; const oldText = btn.textContent; btn.textContent = 'Copying…';
    const result = await copyFromPeerMatch();
    btn.disabled = false; btn.textContent = oldText;
    if (!result.ok) {
      const messages = { 'not-found': 'PeerMatch data was not found on this device.', 'cannot-verify': 'This browser cannot check for PeerMatch data.', empty: 'PeerMatch has no data yet.', 'open-failed': 'Could not open PeerMatch data.' };
      alert(messages[result.reason] || 'Could not copy PeerMatch data.');
      return;
    }
    alert(`Copied ${result.counts.shadchanim} shadchanim, ${result.counts.guys} guys and ${result.counts.girls} girls from PeerMatch.`);
    closeSheet();
    renderAll();
  };

  document.getElementById('backupClose').onclick = () => closeSheet();
}
