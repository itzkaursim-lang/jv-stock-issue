/* JV Stock Issue – app logic */
'use strict';
const N = window.JVS || null;
const WEB_VERSION = '3.0';
const SLIP_RE = /^(?=.*\d).{2,10}$/;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ================= storage ================= */
function blank() {
  return { v: 2, me: { name: '', emp: '', desig: '', storeName: 'Ration Store' }, mgr: { on: false, name: '', desig: '' },
    stores: {}, areas: [], stock: {}, stockAt: null, lines: [], entries: [], returns: [], hold: {}, nextId: 1,
    sync: { url: '', at: null, auto: true }, queue: false, lastLoginAt: null, lastUpdateCheck: 0, updateInfo: null };
}
function load() {
  try {
    const t = N ? N.storeGet() : localStorage.getItem('jvStockIssue');
    if (t) return Object.assign(blank(), JSON.parse(t));
  } catch (e) {}
  return blank();
}
let S = load();
let syncTimer = null;
function writeLocal() { DATAVER++; const t = JSON.stringify(S); try { if (N) N.storeSet(t); else localStorage.setItem('jvStockIssue', t); } catch (e) {} }
function save(noSync) {
  if (!noSync && ui.pendUndo) undoFire();
  S.sync.dirty = true; S.sync.changedAt = new Date().toISOString();
  writeLocal();
  if (!S.sync.firstDirty) S.sync.firstDirty = Date.now();
  paintSync();
}
let syncBusy = false, syncErr = '';
function syncLabel() {
  if (S.testMode) return ['offline', 'Test mode · backup paused'];
  if (!S.sync.url) return ['off', 'Cloud not set'];
  if (syncBusy) return ['busy', 'Syncing…'];
  if (!navigator.onLine) return ['offline', 'Offline · saved on phone'];
  if (S.sync.dirty || !S.sync.at) { const left = Math.max(0, Math.ceil(((S.sync.firstDirty || Date.now()) + (S.sync.delay != null ? S.sync.delay : 5) * 60000 - Date.now()) / 60000)); return [syncErr ? 'error' : 'pending', syncErr ? 'Will retry · saved on phone' : 'Saved on phone · upload in ' + (left ? left + ' min' : 'a moment')]; }
  return ['ok', 'Synced ' + (S.sync.at ? ago(S.sync.at) : '')];
}
function ago(ts) { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : fmtDT(ts); }
function paintSync() { const el = document.getElementById('syncline'); if (!el) return; const [k, t] = syncLabel(); el.className = 'sync s-' + k; el.lastChild.textContent = t; }
window.addEventListener('online', () => { paintSync(); if (S.sync.dirty) syncNow(true); });
window.addEventListener('offline', paintSync);
function syncDue() { return S.sync.url && S.sync.auto && S.sync.dirty && navigator.onLine && !syncBusy && Date.now() - (S.sync.firstDirty || 0) >= (S.sync.delay != null ? S.sync.delay : 5) * 60000; }
setInterval(() => { paintSync(); if (syncDue()) syncNow(true); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.hidden && S.sync.url && S.sync.auto && S.sync.dirty && navigator.onLine) syncNow(true); });
const nid = () => S.nextId++;

/* ================= utils ================= */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = x => { const v = Math.round(Number(x) * 1000) / 1000; return isFinite(v) ? String(v) : ''; };
const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => isoOf(new Date());
const timeNow = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const P = iso => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; };
const fmtLong = iso => { const p = P(iso); return MON[p.m - 1] + ' ' + pad(p.d) + ', ' + p.y; };
const fmtShort = iso => { const p = P(iso); return p.d + ' ' + MON[p.m - 1]; };
const fmtDT = ts => { const d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); };
const days = iso => Math.round((new Date(today() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 864e5);
const remarkFor = iso => iso === today() ? '' : 'Requisition Requested on ' + fmtLong(iso);
const itemName = c => (S.stock[c] && S.stock[c].name) || (findItemAnywhere(c) || {}).name || 'Unknown item';
const itemUom = c => (S.stock[c] && S.stock[c].uom) || (findItemAnywhere(c) || {}).uom || '';
function findItemAnywhere(c) {
  for (const e of S.entries) for (const i of e.items) if (i.code === c && i.name) return i;
  for (const r of S.returns) for (const i of r.items) if (i.code === c && i.name) return i;
  return null;
}
function groupBy(a, f) { const m = {}; a.forEach(x => (m[f(x)] = m[f(x)] || []).push(x)); return m; }
function toast(m, force) { if (!force && (ui.undoAt && Date.now() - ui.undoAt < 1500)) return; return toast0(m); }
function toast0(m) { const t = document.getElementById('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 3200); }
function meTag() { return { name: S.me.name || '', emp: S.me.emp || '' }; }

/* ================= allocation =================
   Tier 1 = today's requests, Tier 2 = everything older (only leftover stock).
   In each tier: first complete as many whole requests as possible, then
   remaining lines (today: smaller first; older: oldest first). No partial lines. */
function plan() {
  const res = {}, avail = {};
  for (const c in S.stock) avail[c] = S.stock[c].qty;
  const t = today();
  const waiting = S.lines.filter(l => l.status === 'waiting' && !(l.date > t));
  S.lines.forEach(l => { if (l.status === 'waiting' && l.date > t) res[l.id] = 'later'; });
  [waiting.filter(l => l.date === t), waiting.filter(l => l.date !== t)].forEach((tier, ti) => {
    const byReq = groupBy(tier, l => l.req);
    const reqs = Object.values(byReq).sort((a, b) => ti === 0 ? (a.length - b.length || a[0].id - b[0].id) : (a[0].date.localeCompare(b[0].date) || a.length - b.length));
    tier.forEach(l => { if (S.hold[l.id]) res[l.id] = 'hold'; else if (!(l.code in avail)) res[l.id] = 'missing'; });
    for (const ls of reqs) {
      if (ls.some(l => res[l.id])) continue;
      const need = {}; ls.forEach(l => need[l.code] = (need[l.code] || 0) + l.qty);
      if (Object.keys(need).every(c => avail[c] + 1e-9 >= need[c])) ls.forEach(l => { res[l.id] = 'issue'; avail[l.code] -= l.qty; });
    }
    tier.filter(l => !res[l.id]).sort((a, b) => ti === 0 ? (a.qty - b.qty || a.id - b.id) : (a.date.localeCompare(b.date) || a.qty - b.qty || a.id - b.id))
      .forEach(l => { if (avail[l.code] + 1e-9 >= l.qty) { res[l.id] = 'issue'; avail[l.code] -= l.qty; } else res[l.id] = 'short'; });
  });
  return res;
}
const STATUS = { issue: ['Can issue', 'c-ok'], short: ['Not enough stock', 'c-pt'], missing: ['Not in stock sheet', 'c-gy'], hold: ['On hold', 'c-pt'], issued: ['Issued', 'c-in'] };
const chip = k => '<span class="chip ' + STATUS[k][1] + '">' + STATUS[k][0] + '</span>';
const ICONS = { x: '<path d="M6 6l12 12M18 6L6 18"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', right: '<path d="M9 6l6 6-6 6"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>' };
const ico = (n, sz) => '<svg viewBox="0 0 24 24" width="' + (sz || 20) + '" height="' + (sz || 20) + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';
const meta = arr => '<div class="meta">' + arr.filter(Boolean).map(x => '<span>' + x + '</span>').join('<i></i>') + '</div>';
function unavail(lines, PL) {
  const c = { issue: 0, short: 0, missing: 0, hold: 0, later: 0 };
  lines.forEach(l => { const k = PL[l.id]; if (c[k] != null) c[k]++; });
  const out = [];
  if (c.issue) out.push('<span class="sc ok">' + c.issue + ' ready</span>');
  if (c.short) out.push('<span class="sc no">' + c.short + ' short</span>');
  if (c.missing) out.push('<span class="sc no">' + c.missing + ' not in stock</span>');
  if (c.hold) out.push('<span class="sc gd">' + c.hold + ' on hold</span>');
  if (c.later && !c.issue && !c.short && !c.missing) return '';
  return out.length ? '<div class="scrow">' + out.join('') + '</div>' : '';
}
const serFmt = v => { const s = String(v || ''); if (!s || s === '–') return '<span class="ser">–</span>'; return '<span class="ser">' + esc(s.slice(0, -2)) + '<b>' + esc(s.slice(-2)) + '</b></span>'; };
const pill = (txt, cls) => '<span class="chip ' + (cls || 'c-gy') + '">' + esc(txt) + '</span>';
function linePills(l, k) {
  const s = S.stock[l.code], u = itemUom(l.code), out = [];
  if (k === 'issued') { l.issued.forEach(x => out.push(pill('Slip ' + x.slip + (x.serial ? ' · #' + x.serial : ''), 'c-in'))); return out.join(' '); }
  if (k === 'issue') { out.push(pill('Can issue', 'c-ok')); if (s) out.push(pill(num(s.qty) + ' ' + u + ' in stock', 'c-gy')); }
  else if (k === 'short') { out.push(pill('Short', 'c-pt')); if (s) out.push(pill('Have ' + num(s.qty) + ' ' + u, 'c-gy')); }
  else if (k === 'missing') out.push(pill('Not in stock sheet', 'c-no'));
  else if (k === 'hold') out.push(pill('On hold', 'c-pt'));
  const d = days(l.date); if (d > 0) out.push(pill(d + (d === 1 ? ' day' : ' days') + ' old', d > 2 ? 'c-no' : 'c-pt'));
  if (l.date !== today() && k === 'issue') out.push(pill('Remark added', 'c-gy'));
  return out.join(' ');
}

function requests() {
  const by = groupBy(S.lines.filter(l => l.status !== 'dropped'), l => l.req);
  return Object.entries(by).map(([req, ls]) => ({ req, store: ls[0].store, date: ls[0].date, src: ls[0].src, lines: ls }));
}
function reqState(r, PL) {
  const w = r.lines.filter(l => l.status === 'waiting'), iss = r.lines.filter(l => l.status === 'issued');
  const can = w.filter(l => PL[l.id] === 'issue');
  let st = 'wait';
  if (!w.length) st = 'done'; else if (can.length === w.length) st = 'full'; else if (can.length) st = 'part';
  return { w, iss, can, st };
}
function isPending(l) {
  if (l.status !== 'waiting') return false;
  if (l.date > today()) return false;
  if (l.date !== today() || l.src === 'old') return true;
  return S.lines.some(x => x.req === l.req && x.status === 'issued');
}
function allSlips() { const s = new Set(); S.entries.forEach(e => s.add(String(e.slip).toUpperCase())); return s; }
function nextSlip() {
  const e = S.entries.filter(x => x.slip).slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0];
  const used = allSlips();
  let base = e ? e.slip : 'JV/1';
  let m = base.match(/^(.*?)(\d+)$/);
  if (!m) return '';
  let n = parseInt(m[2], 10);
  for (let i = 0; i < 500; i++) { n++; const s = m[1] + String(n).padStart(m[2].length, '0'); if (!used.has(s.toUpperCase()) && SLIP_RE.test(s)) return s; }
  return '';
}
function plannedSlip(ids) {
  const used = allSlips();
  const ls = S.lines.filter(l => ids.includes(l.id) && l.slip);
  for (const l of ls) if (!used.has(l.slip.toUpperCase())) return l.slip;
  return '';
}
function slipProblem(s) {
  if (!s) return 'Enter a Slip No.';
  if (!SLIP_RE.test(s)) return 'Slip No must be 2–10 characters with at least one digit.';
  const hit = S.entries.find(e => String(e.slip).toUpperCase() === s.toUpperCase());
  if (hit) return s + ' was already used on ' + fmtDT(hit.at) + ' for ' + hit.store + '.';
  return '';
}

/* ================= file parsing ================= */
function readWorkbook(file) {
  return new Promise((ok, bad) => {
    const fr = new FileReader();
    fr.onload = () => { try { ok(XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: false, raw: true })); } catch (e) { bad(e); } };
    fr.onerror = bad; fr.readAsArrayBuffer(file);
  });
}
function rowsOf(ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }); }
function toISO(v) {
  if (typeof v === 'number' && v > 20000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  if (v instanceof Date) return isoOf(v);
  const s = String(v).trim(); if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad(+m[2]) + '-' + pad(+m[1]); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const d = new Date(s); return isNaN(d) ? null : isoOf(d);
}
function findSheet(wb, re) { const n = wb.SheetNames.find(x => re.test(x)); return n ? wb.Sheets[n] : null; }
function headerMap(rows, must) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hd = rows[i].map(c => String(c).trim().toLowerCase());
    if (must.every(re => hd.some(c => re.test(c)))) return { h: i, hd };
  }
  return null;
}
function parseRequests(wb, kind) {
  const isNew = kind !== 'old';
  const prefer = isNew ? /new.?request/i : /old.?pending/i;
  const avoid = isNew ? /read.?me|old.?pending/i : /read.?me|new.?request/i;
  const names = [...wb.SheetNames.filter(n => prefer.test(n)), ...wb.SheetNames.filter(n => !prefer.test(n) && !avoid.test(n))];
  let last = null;
  for (const n of names) {
    const r = parseReqSheet(wb.Sheets[n], kind, n);
    if (r.rows && r.rows.length) return r;
    if (!last || (r.info && !last.info)) last = r;
  }
  return last || { error: 'No sheet found in this file.' };
}
function parseReqSheet(ws, kind, sheetName) {
  const rows = rowsOf(ws);
  const hm = headerMap(rows, [/request|slip|req/, /store|mess|project|area/, /code/, /qty|quant/]);
  if (!hm) return { error: 'Sheet "' + sheetName + '": columns not found. Row 1 must have: Request No, Store, Request date, Item code, Qty.' };
  const col = re => hm.hd.findIndex(c => re.test(c));
  const reqI = col(/request/) >= 0 ? col(/request/) : col(/slip|req/);
  const slipI = hm.hd.findIndex((c, k) => k !== reqI && /slip/.test(c) && !/earlier/.test(c));
  const ci = { req: reqI, slip: slipI, store: col(/store|mess|project|area/), date: col(/date/), code: col(/item code|^code|code/), qty: col(/qty|quant/), rcv: col(/receiver/), earlier: col(/earlier/) };
  const have = new Set(S.lines.map(l => l.req.toUpperCase() + '|' + l.code));
  const out = [], dup = [], warn = new Set(), badQty = [], skipped = [], notes = [];
  let ex = 0, data = 0;
  const skip = (i, r, why, inApp) => skipped.push({ inApp, row: i + 1, req: String(r[ci.req] == null ? '' : r[ci.req]).trim(), store: String(r[ci.store] == null ? '' : r[ci.store]).trim(), code: String(r[ci.code] == null ? '' : r[ci.code]).trim().toUpperCase(), qty: String(r[ci.qty] == null ? '' : r[ci.qty]).trim(), why });
  for (let i = hm.h + 1; i < rows.length; i++) {
    const r = rows[i];
    const req = String(r[ci.req]).trim(), code = String(r[ci.code]).trim().toUpperCase(), qty = parseFloat(String(r[ci.qty]).replace(/[^\d.]/g, ''));
    if (!req && !code) continue;
    data++;
    if (/^EX[-\/]/i.test(req)) { ex++; skip(i, r, 'Example row (EX-…) from the template'); continue; }
    if (!req || !code) { skip(i, r, !req ? 'Request No is empty' : 'Item code is empty'); continue; }
    if (!(qty > 0)) { skip(i, r, String(r[ci.qty]).trim() === '' ? 'Qty is empty' : 'Qty is not a number above 0'); continue; }
    const key = req.toUpperCase() + '|' + code;
    if (have.has(key)) {
      const ex0 = S.lines.find(l => l.req.toUpperCase() + '|' + l.code === key);
      let inApp = null;
      if (ex0) { const fileStore = String(r[ci.store]).trim().toUpperCase(); const e = S.entries.find(e2 => e2.items.some(it => it.lineId === ex0.id));
        inApp = { req: ex0.req, store: ex0.store, date: ex0.date, qty: ex0.qty, status: ex0.status, slip: e ? e.slip : (ex0.issued[0] || {}).slip || '', serial: e ? e.serial : (ex0.issued[0] || {}).serial || '', made: ex0.fromFile ? 'file' : '', other: fileStore && fileStore !== ex0.store }; }
      skip(i, r, ex0 ? (inApp.other ? 'Request No already used in the app for a different store' : 'Already in the app (same Request No + item)') : 'Same Request No + item appears twice in this file', inApp); dup.push(req + ' ' + code); continue; }
    have.add(key);
    const store = String(r[ci.store]).trim().toUpperCase();
    if (!store) { skip(i, r, 'Store is empty'); continue; }
    const date = (ci.date >= 0 && toISO(r[ci.date])) || today();
    const rcv = ci.rcv >= 0 ? String(r[ci.rcv]).replace(/\D/g, '') : '';
    const nb = [];
    if (rcv && rcv.length !== 6) nb.push('Receiver "' + r[ci.rcv] + '" is not 6 digits, so the store default is used');
    if (Object.keys(S.stock).length && !S.stock[code]) nb.push('Item code is not in the current stock sheet');
    const slip = ci.slip >= 0 ? String(r[ci.slip]).trim().toUpperCase() : '';
    if (slip && !SLIP_RE.test(slip)) nb.push('Slip No ' + slip + ' is not valid, so it is left empty');
    if (ci.date >= 0 && String(r[ci.date]).trim() && !toISO(r[ci.date])) nb.push('Date "' + r[ci.date] + '" not understood, so today is used');
    nb.forEach(w => notes.push({ row: i + 1, req, store, code, qty: String(qty), why: w }));
    out.push({ req, store, date, code, qty, rcv: rcv.length === 6 ? rcv : '', slip: slip && SLIP_RE.test(slip) ? slip : '', src: kind, earlier: ci.earlier >= 0 ? String(r[ci.earlier]).trim() : '' });
  }
  const info = 'Read sheet "' + sheetName + '", headers on row ' + (hm.h + 1) + ', ' + data + ' filled rows' + (ex ? ', ' + ex + ' example rows (EX-…) skipped' : '') + '.';
  return { rows: out, dup, warn: [...warn], info, skipped, notes };
}
function parseStock(wb) {
  const rows = rowsOf(wb.Sheets[wb.SheetNames[0]]);
  const hm = headerMap(rows, [/item code|^code$/, /closing|stock|qty|quantity/]);
  if (!hm) return { error: 'This is not the CUIMS Item Stock Statement (no "Item Code" and "Closing" columns).' };
  const f = re => hm.hd.findIndex(c => re.test(c));
  const ci = { code: f(/item code|^code$/), name: f(/name/), uom: f(/uom|unit/), qty: f(/closing/) >= 0 ? f(/closing/) : f(/stock|qty|quantity/) };
  const st = {}, skippedS = [];
  for (let i = hm.h + 1; i < rows.length; i++) {
    const r = rows[i]; const code = String(r[ci.code]).trim().toUpperCase(); const q = parseFloat(r[ci.qty]);
    if (!code.includes('-') || isNaN(q)) { if (code && code !== 'ITEM CODE' && !/total/i.test(code)) skippedS.push({ row: i + 1, code, qty: String(r[ci.qty] == null ? '' : r[ci.qty]), why: !code.includes('-') ? 'Not an item code' : 'Closing stock is not a number' }); continue; }
    st[code] = { name: ci.name >= 0 ? String(r[ci.name]).trim() : code, uom: ci.uom >= 0 ? String(r[ci.uom]).trim().toUpperCase().replace(/^KGS$/, 'KG').replace(/^LT$/, 'LTR') : '', qty: q };
  }
  return { stock: st, count: Object.keys(st).length, skipped: skippedS, notes: [] };
}

/* ================= UI state ================= */
let ui = { picker: null, doneOpen: {}, lastReq: null, locked: true, setPage: null, openStore: {}, sort: { home: 'priority', pend: 'custom', reg: 'time' }, tab: 'home', view: null, req: null, store: null, sheet: null, reg: { type: 'issue', date: today(), items: false }, search: { q: '', type: 'all', from: '', to: '', store: '', open: null }, upload: null, form: null };

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  pend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  reg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
const TABS = [['home', 'Home'], ['pend', 'Pending'], ['find', 'Search'], ['reg', 'Registers'], ['set', 'Settings']];

function slipRow(e, req) {
  const man = e.kind === 'manual';
  return '<button class="slipline tap ' + (man ? 'man' : 'app') + '" data-a="editEntry" data-v="' + e.id + '"><span class="stag">' + (man ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>Manual' : '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>App') + '</span><span class="sl">' + esc(e.slip) + '</span>' + serFmt(e.serial) +
    '<span class="st">' + esc(fmtShort(entryDate(e))) + ' · ' + esc(entryTime(e)) + ' · ' + entryCount(e, req) + ' art.' + ((e.by || {}).name ? ' · ' + esc(e.by.name.split(' ')[0]) : '') + '</span></button>';
}
function rqCard(o) {
  const key = 'rq:' + o.where + ':' + o.req, open = !!(ui.rqOpen || {})[key];
  let h = '<div class="card rcard' + (o.cont ? ' contcard' : '') + (ui.lastReq === o.req ? ' sel' : '') + '"><div class="scard"><' + (o.tap === false ? 'div' : 'button data-a="openReq" data-v="' + esc(o.req) + '"') + ' class="main"><div class="row"><span class="reqno" data-req="' + esc(o.req) + '">' + esc(o.req) + '</span>' + (o.status ? pill(o.status[0], o.status[1]) : '') + '</div>' +
    '<b class="ttl">' + esc(o.store) + '</b>' + meta(o.meta || []) + (o.chips || '') + '</' + (o.tap === false ? 'div' : 'button') + '>' +
    (o.x ? '<div class="side"><button class="xbtn" data-a="' + o.x + '" data-v="' + esc(o.req) + '" aria-label="Remove">' + ico('x', 18) + '</button></div>' : '') + '</div>';
  if (o.slips) h += '<div class="slips">' + (o.slips.length ? o.slips.map(e => slipRow(e, o.req)).join('') : '<div class="slipline none">No slip entered yet</div>') + '</div>';
  if (o.btns) h += '<div class="rqbtns">' + o.btns + '</div>';
  if (o.left && o.left.length) {
    h += '<button class="leftbtn" data-a="rqTog" data-v="' + esc(key) + '"><span>' + (open ? 'Hide' : 'Show') + ' ' + o.left.length + ' pending article' + (o.left.length > 1 ? 's' : '') + '</span>' + ico(open ? 'up' : 'down', 18) + '</button>';
    if (open) h += '<div class="leftbox">' + o.left.map(l => '<div class="leftrow"><span><b>' + esc(itemName(l.code)) + '</b><span class="mono">' + esc(l.code) + '</span></span><b class="qty">' + num(l.qty) + ' ' + esc(itemUom(l.code)) + '</b></div>').join('') + '</div>';
  }
  if (o.cta) h += '<div class="cta">' + o.cta + '</div>';
  return h + '</div>';
}
function entryHasReq(e, req) { return e.items.some(i => i.req === req) || (!!e.reqs && String(e.reqs).split(/\s*,\s*/).includes(req)); }
function entryCount(e, req) { if (!e.items.length) return Number(e.count) || 0; if (!req) return e.items.length; const n = e.items.filter(i => i.req === req).length; return n || (e.items.some(i => i.req) ? 0 : e.items.length); }
function reqSlips(req, onlyDate) { return S.entries.filter(e => entryHasReq(e, req) && (!onlyDate || entryDate(e) === onlyDate)).sort((a, b) => (a.at || '').localeCompare(b.at || '')); }
function reqCard(r, cont) {
  const PL = plan(), later = r.date > today();
  const tag = later ? ['Scheduled · ' + fmtShort(r.date), 'c-in'] : r.st === 'full' ? ['Ready', 'c-ok'] : r.st === 'part' ? [r.can.length + ' of ' + r.w.length + ' ready', 'c-gd'] : r.st === 'done' ? ['Done', 'c-in'] : ['Waiting', 'c-no'];
  const slip = (r.w.find(l => l.slip) || {}).slip, rcv = (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '';
  const sl = reqSlips(r.req);
  return rqCard({ where: 'home', req: r.req, store: r.store, status: tag, cont, x: 'dropReq',
    meta: [fmtShort(r.date), slip ? 'next slip ' + esc(slip) : '<em>No slip</em>', rcv ? 'GA' + esc(rcv) : '<em>No receiver</em>', r.lines.length + ' articles'], chips: unavail(r.w, PL),
    slips: sl.length ? sl : null, cta: later ? '<div class="note" style="text-align:center">Fills from ' + fmtLong(r.date) + '. No stock is kept for it before then.</div>' : (r.can && r.can.length ? '<button class="btn main full" data-a="fillReq" data-v="' + esc(r.req) + '">Fill on CUIMS · ' + r.can.length + ' available</button>' : '') });
}
function appBar() {
  const lk = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="' + (ui.locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-1.8') + '"/></svg>';
  const d = new Date();
  return '<div class="appbar">' +
    '<button class="avbtn" data-a="goProfile" aria-label="Profile">' + avatar(false) + '</button>' +
    '<div class="t"><b>' + (S.me.name ? 'Hello, ' + esc(S.me.name.split(' ')[0]) : 'JV Stock Issue') + '</b><span>Today ' + d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'short' }) + '.</span><button id="syncline" class="sync" data-a="syncTap"><span class="sd"></span><span></span></button></div>' +
    '<button class="cbtn' + (ui.locked ? '' : ' open') + '" data-a="lockTap" aria-label="' + (ui.locked ? 'Unlock editing' : 'Lock editing') + '">' + lk + '</button>' +
    '<button class="cbtn" data-a="drawer" aria-label="Open menu"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg></button></div>';
}
function stockAge() { return S.stockAt ? 'Stock from ' + fmtDT(S.stockAt) : 'No stock uploaded yet'; }
function stockCard() {
  const box = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>';
  if (!S.stockAt) return '<div class="stockcard warn"><button class="scmain" data-a="stockOpen"><span class="sci">' + box + '</span><span class="sct"><b>No stock yet</b><span>Fetch live stock from CUIMS to plan issues</span></span></button><button class="scgo" data-a="openMgr">Get stock</button></div>';
  const mins = Math.round((Date.now() - new Date(S.stockAt)) / 60000), old = mins > 360;
  const check = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const clock = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const when = new Date(S.stockAt), tm = when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }), sameDay = isoOf(when) === today();
  return '<div class="stockcard ' + (old ? 'warn' : 'fresh') + '"><button class="scmain" data-a="stockOpen"><span class="sci">' + (old ? clock : check) + '</span><span class="sct"><b>' + (old ? 'Stock needs an update' : 'Stock is up to date') + '</b>' +
    '<span class="l1">Updated ' + esc(ago(S.stockAt)) + (mins >= 1 ? ' · ' + (sameDay ? tm : fmtShort(isoOf(when)) + ', ' + tm) : '') + '</span>' +
    '<span class="l2">' + Object.keys(S.stock).length.toLocaleString('en-IN') + ' items · ' + (S.stockSrc === 'auto' ? 'from CUIMS' : 'from a file') + '</span></span></button><button class="scgo" data-a="openMgr">' + (old ? 'Update' : 'Refresh') + '</button></div>';
}

/* ---------------- Home ---------------- */
function dayRange(d) {
  const E = S.entries.filter(e => entryDate(e) === (d || today())).slice().sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  if (!E.length) return null;
  const reqs = [...new Set(E.flatMap(e => e.items.map(i => i.req)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const sers = E.map(e => e.serial).filter(Boolean);
  return { slip: [E[0].slip, E[E.length - 1].slip], ser: sers.length ? [sers[0], sers[sers.length - 1]] : null, req: [reqs[0], reqs[reqs.length - 1]], n: E.length };
}
function vHome() {
  const PL = plan();
  const t = ui.homeDate || today(), isToday = t === today();
  const R = requests();
  const dayReqs = R.filter(r => r.date === t).map(r => Object.assign(r, reqState(r, PL)));
  const todays = dayReqs.filter(r => r.st !== 'done' && (r.src !== 'old' || !isToday));
  sortBy(todays, getSort('home'), r => ({ req: r.req, store: r.store, date: r.date, ready: r.can.length, size: r.lines.length }));
  const dayWait = dayReqs.flatMap(r => r.lines.filter(l => l.status === 'waiting'));
  const readyNow = dayWait.filter(l => PL[l.id] === 'issue').length;
  const dayEntries = S.entries.filter(e => entryDate(e) === t);
  const pend = S.lines.filter(isPending);
  const pendCan = pend.filter(l => PL[l.id] === 'issue').length;
  const issuedToday = dayEntries.length;
  const rg = dayRange(t);
  const dl = fmtShort(t);
  let h = '<main style="padding-top:6px">';
  h += '<section class="hero"><img class="hlogo" src="icon.png" alt="">' +
    '<div class="hcopy"><div class="hkick">' + (isToday ? 'Today' : dl) + '</div><div class="htitle">Daily<br>issue work</div>' +
    '<div class="hsub">' + (dayReqs.length ? todays.length + ' of ' + dayReqs.length + ' requests still open' : 'No requests on ' + dl) + '</div></div>' +
    '<div class="hstat"><div><b>' + todays.length + '</b><span>open requests</span></div><div><b>' + readyNow + '</b><span>ready to issue</span></div><div><b>' + dayWait.length + '</b><span>articles left</span></div><div><b>' + issuedToday + '</b><span>slips done</span></div></div>' +
    (rg ? '<div class="hrange"><div><span>Slips</span><b>' + esc(rg.slip[0]) + (rg.n > 1 ? '<i>to</i>' + esc(rg.slip[1]) : '') + '</b></div><div><span>Serials</span><b>' + (rg.ser ? esc(rg.ser[0]) + (rg.ser[1] !== rg.ser[0] ? '<i>to</i>' + esc(rg.ser[1]) : '') : '–') + '</b></div><div><span>Requests</span><b>' + esc(rg.req[0] || '–') + (rg.req[1] && rg.req[1] !== rg.req[0] ? '<i>to</i>' + esc(rg.req[1]) : '') + '</b></div></div>' : '<div class="hrange empty">No slips entered on ' + dl + ' yet.</div>') +
    '<div class="hcredit">JV Stock Issue · Built by ' + esc(S.me.builder || S.me.name || 'JV') + '</div></section>';
  const base = new Date(t + 'T12:00');
  h += '<div class="dstrip">';
  for (let k = -3; k <= 3; k++) { const dd = new Date(base); dd.setDate(base.getDate() + k); const iso = isoOf(dd); const has = R.some(r => r.date === iso && r.lines.some(l => l.status === 'waiting'));
    h += '<button class="dday' + (iso === t ? ' on' : '') + (iso === today() ? ' today' : '') + '" data-a="homeDate" data-v="' + iso + '"><i' + (has ? ' class="dot"' : '') + '></i><span>' + dd.toLocaleString('en-GB', { weekday: 'short' }) + '</span><b>' + dd.getDate() + '</b></button>'; }
  h += '</div>';
  h += stockCard();
  if (!isToday) h += '<button class="banner tap" data-a="homeDate" data-v="' + today() + '" style="border:0;background:var(--lavBg);color:var(--lavInk)"><b>Showing ' + fmtLong(t) + '.</b> Tap to go back to today.</button>';
  if (S.updateInfo && S.updateInfo.newer) h += '<button class="banner t-in tap" data-a="goUpdate" style="border:0"><b>Update ' + esc(S.updateInfo.tag) + ' available.</b> Tap to install.</button>';
  if (!S.me.name) h += '<button class="banner t-pt tap" data-a="goProfile" style="border:0"><b>Add your name and emp code</b> so entries and PDFs show who made them.</button>';
  if (!S.lines.length && !S.stockAt) {
    return h + '<div class="card pad col"><h2>Start here</h2><div class="note">Upload the CUIMS stock report and your requests sheet.</div><button class="btn main" data-a="upload">Upload a file</button><button class="btn" data-a="template">Download data template</button></div></main>';
  }
  const qi = (a, label, d) => '<button class="qc" data-a="' + a + '" aria-label="' + label + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg></button>';
  const oldest = pend.reduce((m, l) => Math.max(m, days(l.date)), 0);
  h += '<div class="shead"><div><h2>Your work</h2></div></div><div class="plan">' +
    '<button class="pt orange" data-a="tab" data-v="pend"><span class="ptag">' + (oldest > 2 ? 'Urgent' : 'All days') + '</span><b>Pending</b><span class="pbig">' + pend.length + '</span><span>articles waiting</span><span>' + pendCan + ' can be issued now</span>' + (oldest ? '<span>oldest ' + oldest + (oldest === 1 ? ' day' : ' days') + '</span>' : '') + '<span class="pfoot">Open Pending</span></button>' +
    '<button class="pt blue" data-a="doneOpenDay" data-v="' + t + '"><span class="ptag">' + (isToday ? 'Today' : dl) + '</span><b>Done</b><span class="pbig">' + issuedToday + '</span><span>slips entered</span></button>' +
    '<div class="pt pink">' + qi('upload', 'Upload', '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>') + qi('newReq', 'Add request', '<path d="M12 5v14M5 12h14"/>') + qi('batchReq', 'Batch add', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>') + '</div></div>';
  h += '<div class="grid2"><button class="btn main" data-a="openSite">Issue CUIMS</button><button class="btn lav" data-a="openMgr">' + (autoStockCfg().on ? 'Update live stock' : 'Live stock') + '</button></div>';
  const ex = expiryRows().filter(r => r.left <= expDays());
  if (ex.length) { const e0 = ex.filter(r => r.left < 0).length; h += '<button class="alertcard" data-a="expOpen"><span class="ai">' + ico('alert', 22) + '</span><span style="flex:1;min-width:0"><b>Expiry Tracker</b><span>' + ex.length + ' batches within ' + expDays() + ' days' + (e0 ? ' · ' + e0 + ' expired' : '') + '</span></span>' + ico('right', 18) + '</button>'; }
  h += tasksCard();
  h += '<div class="shead"><div><h2>' + (t === today() ? 'Today\'s requests' : 'Requests of ' + fmtShort(t)) + '</h2><span>' + todays.length + ' open</span></div>' + sortPick('home') + '</div>';
  if (todays.length) {
    const fresh = todays.filter(r => !r.iss.length), cont = todays.filter(r => r.iss.length);
    if (fresh.length) { h += '<div class="sgroup"><span class="sdot new"></span><b>New on CUIMS</b><span>' + fresh.length + ' never entered yet</span></div>'; fresh.forEach(r => { h += reqCard(r); }); }
    if (cont.length) { h += '<div class="sgroup"><span class="sdot cont"></span><b>Continue</b><span>' + cont.length + ' entered once, articles left</span></div>'; cont.forEach(r => { h += reqCard(r, true); }); }
  } else h += '<div class="card pad note">No open requests for today. Upload today\'s requests, add one, or check Pending.</div>';
  h += '<button class="card pad tap row" data-a="tab" data-v="pend"><span><b class="ttl" style="font-size:16.5px">Older pending</b>' + meta([pend.length + ' articles waiting', pendCan + ' in stock now']) + '</span>' + ico('right', 18) + '</button>';
  const te = dayEntries.slice().reverse().slice(0, 5);
  if (te.length) {
    h += '<div class="shead"><div><h2>Done ' + (isToday ? 'today' : 'on ' + dl) + '</h2><span>Latest ' + te.length + '</span></div><button class="btn sm ghost" data-a="doneOpen">Done list</button></div><div class="card" style="overflow:hidden">';
    te.forEach(e => { const rq = [...new Set(e.items.map(i => i.req).filter(Boolean))].join(', ');
      h += '<div class="line' + (rq.split(', ').includes(ui.lastReq) ? ' selrow' : '') + '"><div class="row"><span class="reqno" data-req="' + esc(rq.split(', ')[0]) + '">' + esc(rq || '–') + '</span>' + serFmt(e.serial) + '</div>' + meta([esc(e.store), 'Slip ' + esc(e.slip), e.items.length + ' items', esc(entryTime(e))]) + '</div>'; });
    h += '</div>';
  }
  h += '<button class="btn" data-a="bulkEdit">Edit all requests</button>';
  return h + '</main>';
}

/* ---------------- Request detail ---------------- */
function vReq() {
  const PL = plan();
  const r = requests().find(x => x.req === ui.req);
  if (!r) { ui.view = null; return vHome(); }
  const st = reqState(r, PL);
  const rcv = (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '';
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:8px">' + esc(r.store) + '</h1><div class="sub">Request ' + esc(r.req) + ' · ' + fmtLong(r.date) + ' · Receiver ' + (rcv ? 'GA' + esc(rcv) : 'not set') + '</div></div></header><main>';
  h += meta([st.can.length + ' ready', (st.w.length - st.can.length) + ' waiting', st.iss.length + ' issued', (st.w.find(l => l.slip) || {}).slip ? 'next slip ' + esc(st.w.find(l => l.slip).slip) : '<em>no slip set</em>']);
  h += '<div class="card">';
  const ordr = { issue: 0, short: 1, hold: 2, missing: 3 };
  const lines = r.lines.slice().sort((a, b) => (a.status === 'issued') - (b.status === 'issued') || (ordr[PL[a.id]] || 0) - (ordr[PL[b.id]] || 0));
  lines.forEach(l => {
    const k = l.status === 'issued' ? 'issued' : PL[l.id];
    const st = S.stock[l.code], u = itemUom(l.code);
    const status = k === 'issued' ? pill('Issued', 'c-in') : k === 'later' ? pill('Scheduled', 'c-in') : k === 'issue' ? pill('Ready', 'c-ok') : k === 'short' ? pill('Short', 'c-no') : k === 'missing' ? pill('Not in stock', 'c-no') : pill('On hold', 'c-gd');
    const info = k === 'issued' ? l.issued.map(x => 'Slip ' + esc(x.slip) + (x.serial ? ' · Serial ' + esc(x.serial) : '')) : [esc(l.code), st ? 'stock ' + num(st.qty) + ' ' + esc(u) : '', k === 'short' && st ? '<em>' + (st.qty >= l.qty ? 'kept for higher priority' : 'short by ' + num(l.qty - st.qty)) + '</em>' : '', remarkFor(l.date) && k === 'issue' ? 'remark added' : ''];
    h += '<div class="line"><div class="row"><b>' + esc(itemName(l.code)) + '</b><span class="qty">' + num(l.qty) + ' ' + esc(u) + '</span></div><div class="row" style="align-items:center">' + meta(info) + status + '</div>' +
      (l.status === 'waiting' && k !== 'missing' ? '<label class="chk" style="min-height:34px;font-size:14px;color:var(--mute)"><input type="checkbox" data-a="hold" data-v="' + l.id + '"' + (S.hold[l.id] ? ' checked' : '') + '> Hold this article</label>' : '') + '</div>';
  });
  h += '</div>';
  h += '<button class="btn main full" data-a="fillReq" data-v="' + esc(r.req) + '"' + (st.can.length ? '' : ' disabled') + '>Fill on CUIMS · ' + st.can.length + ' articles</button>';
  h += '<div class="note" style="text-align:center">Articles not issued stay pending with this request\'s date.</div>';
  h += '<button class="btn full" data-a="corrOpen" data-v="' + esc(r.req) + '">Correct quantities after issue</button>';
  h += '<button class="btn ghost full" data-a="markDone" data-v="' + esc(r.req) + '"' + (st.w.length ? '' : ' disabled') + '>Already submitted on CUIMS? Mark as issued</button>';
  h += '<div class="grid2"><button class="btn ghost sm" data-a="editReq" data-v="' + esc(r.req) + '">Edit request</button><button class="btn ghost sm" data-a="dropReq" data-v="' + esc(r.req) + '">Remove waiting articles</button></div>';
  return h + '</main>';
}

/* ---------------- Pending ---------------- */
function fltGet(k) {
  ui.flt = ui.flt || {};
  if (!ui.flt[k]) ui.flt[k] = k === 'done' || k === 'reg' ? { rd: '', id: today() } : { rd: '', id: '' };
  return ui.flt[k];
}
function fltBar(k, must) {
  const f = fltGet(k);
  const cell = (key, label) => '<label class="f fdate"><span>' + label + '</span><span class="fin"><input type="date" data-flt="' + k + '|' + key + '" value="' + esc(f[key] || '') + '">' + (f[key] ? '<button class="fx" data-a="fltClear" data-v="' + k + '|' + key + '" aria-label="Clear ' + label + '">' + ico('x', 14) + '</button>' : '') + '</span></label>';
  return '<div class="fbar">' + cell('rd', 'Request date') + cell('id', 'Issue date') + '</div>' + (!f.rd && !f.id ? '<div class="note">' + (must ? 'Pick at least one date.' : 'Showing all dates.') + '</div>' : '');
}
function regGroups() {
  const f = fltGet('reg'), ents = regEntries();
  const ids = new Set(ents.flatMap(e => e.items.map(i => i.req)).filter(Boolean));
  if (f.rd && !f.id) requests().filter(r => r.date === f.rd).forEach(r => ids.add(r.req));
  const MR = S.manReqs || {};
  Object.values(MR).forEach(m => { if ((!f.rd || m.date === f.rd) && (!f.id || S.entries.some(e => entryHasReq(e, m.req) && entryDate(e) === f.id))) ids.add(m.req); });
  const R = requests().filter(r => ids.has(r.req) && !MR[r.req]);
  const GM = Object.values(MR).filter(m => ids.has(m.req)).map(m => { const sl = reqSlips(m.req); const done = sl.reduce((n, e) => n + entryCount(e, m.req), 0);
    return { req: m.req, store: m.store, date: m.date, man: m, left: [], issued: done, closed: 0, total: m.total || done, slips: sl.filter(e => !f.id || entryDate(e) === f.id), manStatus: m.status }; });
  const G = R.map(r => { const L = r.lines; return { req: r.req, store: r.store, date: r.date, left: L.filter(l => l.status === 'waiting'), issued: L.filter(l => l.status === 'issued').length, closed: L.filter(l => l.status === 'dropped').length, total: L.filter(l => l.status !== 'dropped').length, slips: S.entries.filter(e => e.items.some(i => i.req === r.req) && (!f.id || entryDate(e) === f.id)).sort((a, b) => (a.at || '').localeCompare(b.at || '')) }; });
  return sortBy(G.concat(GM), getSort('reg'), g => ({ req: g.req, store: g.store, date: g.date, ready: g.left.length, size: g.total }));
}
function regEntries() { const f = fltGet('reg'); return S.entries.filter(e => (!f.id || entryDate(e) === f.id) && (!f.rd || e.items.some(i => reqDateOfRaw(i.req) === f.rd))); }
function issuedOn(req, d) { return S.entries.some(e => entryDate(e) === d && e.items.some(i => i.req === req)); }
function reqMatch(r, f) { return (!f.rd || r.date === f.rd) && (!f.id || issuedOn(r.req, f.id)); }
function vPend() {
  const PL = plan(), f = fltGet('pend');
  const R = requests().map(r => Object.assign(r, { pl: r.lines.filter(isPending) })).filter(r => r.pl.length && reqMatch(r, f));
  const all = R.flatMap(r => r.pl), can = all.filter(l => PL[l.id] === 'issue');
  const oldest = all.reduce((m, l) => Math.max(m, days(l.date)), 0);
  let h = '<header class="top"><div><h1>Pending</h1><div class="sub">Each request on its own card. Tap one to see every article and why it waits.</div></div></header><main>';
  h += '<div class="grid3"><div class="tile t-pt"><b>' + all.length + '</b><span>Articles pending</span></div><div class="tile t-ok"><b>' + can.length + '</b><span>Ready now</span></div><div class="tile t-no"><b>' + oldest + ' d</b><span>Oldest</span></div></div>';
  h += stockCard();
  h += fltBar('pend', false);
  const fut = S.lines.filter(l => l.status === 'waiting' && l.date > today());
  if (fut.length) { const fd = [...new Set(fut.map(l => l.date))].sort(); h += '<button class="banner tap" data-a="homeDate" data-v="' + fd[0] + '" style="border:0;background:var(--infoBg);color:var(--infoInk)"><b>' + fut.length + ' articles scheduled</b> for ' + fd.map(fmtShort).join(', ') + '. They are not pending yet and keep no stock until their day. Tap to view.</button>'; }
  h += '<button class="btn main full" data-a="artsOpen">Manage pending articles</button>';
  h += '<div class="grid2"><button class="btn sm" data-a="expPendPdf"' + (all.length ? '' : ' disabled') + '>Pending PDF</button><button class="btn sm" data-a="bulkEdit">Edit all requests</button></div>';
  if (!R.length) return h + '<div class="card pad note">Nothing pending' + (f.rd || f.id ? ' for these dates' : '') + '.</div></main>';
  sortBy(R, getSort('pend'), r => ({ req: r.req, store: r.store, date: r.date, ready: r.pl.filter(l => PL[l.id] === 'issue').length, size: r.pl.length }));
  h += '<div class="shead"><div><h2>' + R.length + ' requests</h2><span>' + all.length + ' articles</span></div>' + sortPick('pend') + '</div>';
  const fresh = R.filter(r => !r.lines.some(l => l.status === 'issued')), cont = R.filter(r => r.lines.some(l => l.status === 'issued'));
  [['new', 'Never entered on CUIMS', fresh], ['cont', 'Entered before, articles left', cont]].forEach(([cls, title, list]) => {
    if (!list.length) return;
    h += '<div class="sgroup"><span class="sdot ' + cls + '"></span><b>' + title + '</b><span>' + list.length + '</span></div>';
    list.forEach(r => {
      const ready = r.pl.filter(l => PL[l.id] === 'issue'), d0 = days(r.date), sl = reqSlips(r.req);
      h += rqCard({ where: 'pend', req: r.req, store: r.store, cont: cls === 'cont', x: 'dropReq', status: ready.length === r.pl.length ? ['All ready', 'c-ok'] : ready.length ? [ready.length + ' of ' + r.pl.length + ' ready', 'c-gd'] : ['Waiting', 'c-no'],
        meta: [fmtShort(r.date), d0 ? d0 + (d0 === 1 ? ' day' : ' days') + ' old' : 'today', r.pl.length + ' pending'], chips: unavail(r.pl, PL), slips: sl.length ? sl : null,
        cta: ready.length ? '<button class="btn main full" data-a="fillReqPend" data-v="' + esc(r.req) + '">Fill on CUIMS · ' + ready.length + ' available</button>' : '' });
    });
  });
  return h + '</main>';
}

/* ---------------- Start fill sheet ---------------- */
function openStart(store, lineIds, title) {
  const ls = S.lines.filter(l => lineIds.includes(l.id));
  const rcv = (ls.find(l => l.rcv) || {}).rcv || (S.stores[store] || {}).rcv || '';
  ui.sheet = { kind: 'start', store, lineIds, title, slip: plannedSlip(lineIds) || nextSlip(), rcv, off: {}, qty: {}, req: (ls[0] || {}).req };
  renderSheet();
}
function shStart() {
  const s = ui.sheet;
  const ls = S.lines.filter(l => s.lineIds.includes(l.id));
  const sp = slipProblem(s.slip), rp = /^\d{6}$/.test(s.rcv) ? '' : 'Receiver must be exactly 6 digits.';
  const areaOk = !S.areas.length || S.areas.some(a => a.toUpperCase() === s.store.toUpperCase());
  const old = S.lastLoginAt && (Date.now() - new Date(S.lastLoginAt)) > 2 * 3600e3;
  let h = '<div class="row"><h2>' + esc(s.title) + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<label class="f">Slip No for this entry<input type="text" data-in="slip" value="' + esc(s.slip) + '" class="mono' + (sp ? ' bad' : '') + '" autocomplete="off" autocapitalize="characters" placeholder="e.g. JV/915"></label>' + (sp ? '<div class="err">' + esc(sp) + '</div>' : '<div class="okt">Slip No is free to use.</div>');
  h += '<label class="f">Receiver (6 digits, this entry only)<input type="text" inputmode="numeric" maxlength="6" data-in="rcv" value="' + esc(s.rcv) + '" class="mono' + (rp ? ' bad' : '') + '"></label>' + (rp ? '<div class="err">' + rp + '</div>' : '<div class="note">CUIMS will pick GA' + esc(s.rcv) + ' … (GA) from the list.</div>');
  if (!areaOk) h += '<div class="err">"' + esc(s.store) + '" is not in the CUIMS Project Area list. Fix the store name in Settings or the request.</div>';
  if (old) h += '<div class="banner t-pt">Your CUIMS login is over 2 hours old. It may log out soon; the app will pause and restart the entry if it does.</div>';
  h += '<div class="row"><span class="sect">Articles for this entry</span><span class="note">' + s.lineIds.filter(id => !s.off[id]).length + ' selected</span></div>';
  h += '<div class="card">' + ls.map(l => '<div class="line"><div class="row" style="align-items:center"><label class="chk" style="min-height:0;gap:10px;flex:1"><input type="checkbox" data-a="stOn" data-v="' + l.id + '"' + (s.off[l.id] ? '' : ' checked') + '><span><b>' + esc(itemName(l.code)) + '</b><div class="note mono">' + esc(l.code) + ' · Req ' + esc(l.req) + '</div></span></label>' +
    '<input type="number" inputmode="decimal" data-stq="' + l.id + '" value="' + esc(s.qty[l.id] != null ? s.qty[l.id] : l.qty) + '" style="width:96px;text-align:right"><span class="note" style="width:38px">' + esc(itemUom(l.code)) + '</span></div>' +
    meta([S.stock[l.code] ? num(S.stock[l.code].qty) + ' in stock' : '', remarkFor(l.date) ? 'remark added' : '']) + '</div>').join('') + '</div>';
  h += '<div class="card pad col"><b>Add an article to this entry</b><div class="grid2"><input type="text" data-stadd="code" value="' + esc(s.addCode || '') + '" placeholder="Item code e.g. GR-198" autocapitalize="characters" class="mono"><input type="number" inputmode="decimal" data-stadd="qty" value="' + esc(s.addQty || '') + '" placeholder="Qty"></div><button class="btn" data-a="stAdd">+ Add article</button></div>';
  h += '<label class="chk"><input type="checkbox" data-a="queueToggle"' + (S.queue ? ' checked' : '') + '> Queue mode: after I submit, fill the next request automatically</label>';
  if (S.queue) h += queueBox();
  h += '<button class="btn main full" data-a="startFill"' + (sp || rp ? ' disabled' : '') + '>Start filling on CUIMS</button>';
  h += '<div class="note" style="text-align:center">' + (S.autoSubmit ? 'Auto submit is on: SUBMIT is tapped after a 100% recheck, with a 4-second Stop window.' : 'The app never taps SUBMIT. You check and submit yourself.') + '</div>';
  return h;
}
function startJob(store, slip, rcv, lineIds) {
  const ls = S.lines.filter(l => lineIds.includes(l.id) && l.status === 'waiting');
  const nq = S.queue ? nextQueueJob(lineIds) : null;
  const job = { id: 'J' + Date.now(), test: !!S.testMode, slip, rcv, store, queue: !!S.queue, next: nq ? nq.req + ' · ' + nq.store : '', autoSubmit: !!S.autoSubmit && !S.testMode, phase: 'dup', paused: false, log: [], tries: {},
    items: ls.map(l => ({ lineId: l.id, req: l.req, reqDate: l.date, code: l.code, name: itemName(l.code), uom: itemUom(l.code), qty: l.qty, remark: l.remark || remarkFor(l.date), skip: false })) };
  if (!N) { toast('Open this inside the JV Stock Issue app to fill CUIMS.'); return; }
  N.startJob(JSON.stringify(job));
}
function queueList(skipIds) {
  const PL = plan(), t = today(), skip = new Set(skipIds || []);
  const R = requests().map(r => Object.assign(r, reqState(r, PL))).map(r => {
    const can = r.lines.filter(l => l.status === 'waiting' && PL[l.id] === 'issue' && !skip.has(l.id) && (r.date === t && l.src !== 'old' ? true : S.queuePend && isPending(l)));
    return Object.assign(r, { qcan: can });
  }).filter(r => r.qcan.length);
  sortBy(R, S.queueSort || 'reqdate', r => ({ req: r.req, store: r.store, date: r.date, ready: r.qcan.length, size: r.lines.length }));
  return R.filter(r => /^\d{6}$/.test((r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || ''));
}
function nextQueueJob(skipIds) {
  const r = queueList(skipIds)[0]; if (!r) return null;
  const rcv = (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '';
  return { store: r.store, rcv, ids: r.qcan.map(l => l.id), req: r.req };
}
function queueBox() {
  const L = queueList(ui.sheet && ui.sheet.kind === 'start' ? ui.sheet.lineIds : []);
  return '<div class="card pad col" style="gap:10px"><div class="row"><b>Queue order</b>' + pickBtn('queueSort', { title: 'Queue order', opts: SORT_OPTS, val: S.queueSort || 'reqdate', set: v => { S.queueSort = v; save(true); render(); renderSheet(); } }) + '</div>' +
    '<label class="chk" style="min-height:36px"><input type="checkbox" data-a="queuePend"' + (S.queuePend ? ' checked' : '') + '> Also take pending requests (after today\'s)</label>' +
    (L.length ? '<div class="qnext"><span>Next up</span>' + L.slice(0, 6).map((r, i) => '<div class="qrow"><b>' + (i + 1) + '</b><span class="reqno">' + esc(r.req) + '</span><span class="qst">' + esc(r.store) + '</span><span class="note">' + r.qcan.length + '</span></div>').join('') + (L.length > 6 ? '<div class="note">+ ' + (L.length - 6) + ' more</div>' : '') + '</div>' : '<div class="note">Nothing else ready to queue.</div>') + '</div>';
}

/* ---------------- Upload sheet ---------------- */
function reparseUpload() { const u = ui.upload; if (!u || !u.wb) { renderSheet(); return; } u.result = u.kind === 'stock' ? parseStock(u.wb) : parseRequests(u.wb, u.kind); renderSheet(); }
function importReport(r, kind) {
  const sk = r.skipped || [], nt = r.notes || [];
  if (!sk.length && !nt.length) return '<div class="okbox">' + ico('right', 16).replace('M9 6l6 6-6 6', 'M5 12.5l4.5 4.5L19 7.5') + '<span>Nothing will be skipped. Every row is clean.</span></div>';
  const group = list => { const g = {}; list.forEach(x => (g[x.why] = g[x.why] || []).push(x)); return Object.entries(g).sort((a, b) => b[1].length - a[1].length); };
  const where = a => '<div class="inapp">' + '<b>In app: ' + esc(a.store) + '</b><span>' + [fmtShort(a.date), 'qty ' + num(a.qty), a.status === 'issued' ? 'issued' + (a.slip ? ' in ' + a.slip : '') + (a.serial ? ' #' + a.serial : '') : a.status === 'dropped' ? 'removed' : 'waiting', a.made === 'file' ? 'from an earlier file' : ''].filter(Boolean).map(esc).join(' · ') + '</span><span class="inbtns"><button class="btn sm ghost" data-a="impOpenReq" data-v="' + esc(a.req) + '">Open</button><button class="btn sm ghost" data-a="impRenum" data-v="' + esc(a.req) + '">Renumber app\'s request</button>' + (a.status !== 'issued' ? '<button class="btn sm ghost danger-t" data-a="impDrop" data-v="' + esc(a.req) + '">Remove app\'s request</button>' : '') + '</span></div>';
  const table = (list, stock) => '<div class="tblwrap"><table><tr><th>Row</th>' + (stock ? '' : '<th>Request</th><th>Store</th>') + '<th>Item</th><th>Qty</th></tr>' + list.map(x => '<tr><td>' + x.row + '</td>' + (stock ? '' : '<td><b>' + esc(x.req || '–') + '</b></td><td>' + esc(x.store || '–') + '</td>') + '<td class="mono">' + esc(x.code || '–') + (S.stock[x.code] ? '<div class="note">' + esc(S.stock[x.code].name) + '</div>' : '') + '</td><td>' + esc(x.qty || '–') + '</td></tr>' + (x.inApp ? '<tr class="inrow"><td></td><td colspan="4">' + where(x.inApp) + '</td></tr>' : '')).join('') + '</table></div>';
  let h = '';
  if (sk.length) {
    h += '<div class="card" style="overflow:hidden"><div class="pad row"><b class="ttl" style="font-size:17px">Will be skipped</b>' + pill(sk.length + ' row' + (sk.length > 1 ? 's' : ''), 'c-no') + '</div>';
    group(sk).forEach(([why, list], k) => { h += '<details class="ireason"' + (k === 0 ? ' open' : '') + '><summary><span class="dot no"></span><span style="flex:1">' + esc(why) + '</span><b>' + list.length + '</b>' + ico('down', 16) + '</summary>' + table(list, kind === 'stock') + '</details>'; });
    h += '</div>';
  }
  if (nt.length) {
    h += '<div class="card" style="overflow:hidden"><div class="pad row"><b class="ttl" style="font-size:17px">Imported with a note</b>' + pill(nt.length, 'c-gd') + '</div>';
    group(nt).forEach(([why, list]) => { h += '<details class="ireason"><summary><span class="dot gd"></span><span style="flex:1">' + esc(why) + '</span><b>' + list.length + '</b>' + ico('down', 16) + '</summary>' + table(list, false) + '</details>'; });
    h += '</div>';
  }
  return h;
}
function shUpload() {
  const u = ui.upload;
  let h = '<div class="row"><h2>Upload</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  if (!u || !u.result) {
    h += '<button class="card pad tap col" style="gap:4px" data-a="upPick" data-v="new"><b>Fresh requests</b><span class="note">"New Requests" tab of the template. One row per article.</span></button>';
    h += '<button class="card pad tap col" style="gap:4px" data-a="upPick" data-v="old"><b>My earlier pending</b><span class="note">"Old Pending" tab. Load once, before you start using the app.</span></button>';
    h += '<button class="card pad tap col" style="gap:4px" data-a="upPick" data-v="stock"><b>CUIMS stock report</b><span class="note">Item Stock Statement exactly as downloaded. Replaces stock fully.</span></button>';
    h += '<button class="btn ghost" data-a="template">Download data template</button>';
    if (u && u.error) h += '<div class="err">' + esc(u.error) + '</div>';
    return h;
  }
  const r = u.result;
  if (u.kind === 'stock') {
    h += '<div class="card pad col"><b>' + r.count + ' items will be imported</b><div class="note">This replaces the current stock (updated ' + (S.stockAt ? esc(ago(S.stockAt)) : 'never') + ', ' + Object.keys(S.stock).length + ' items). Everything is re-planned.</div></div>';
  } else {
    const stores = [...new Set(r.rows.map(x => x.store))];
    const reqs = [...new Set(r.rows.map(x => x.req))];
    h += '<div class="card pad col"><b>' + r.rows.length + ' articles will be imported · ' + reqs.length + ' requests · ' + stores.length + ' stores</b><div class="note">' + esc(stores.join(', ')) + '</div>' +
      (r.info ? '<div class="note">' + esc(r.info) + '</div>' : '') + '</div>';
    const unknownStores = S.areas.length ? stores.filter(s => !S.areas.some(a => a.toUpperCase() === s)) : [];
    if (unknownStores.length) r.warn.unshift('Not in the CUIMS Project Area list: ' + unknownStores.join(', '));
    if (r.warn.length) h += '<div class="card pad col" style="gap:4px">' + r.warn.map(w => '<div class="err" style="font-weight:500">' + esc(w) + '</div>').join('') + '</div>';
  }
  if (r.rows && r.rows.length) { const fut = r.rows.filter(x => x.date > today()); if (fut.length) { const fd = [...new Set(fut.map(x => x.date))].sort(); h += '<div class="banner" style="border:0;background:var(--infoBg);color:var(--infoInk)"><b>' + fut.length + ' articles are for ' + fd.map(fmtLong).join(', ') + '.</b> They are saved now as <b>Scheduled</b>: not pending, no stock kept, no Fill button. On that day they become that day\'s requests with top priority.</div>'; } }
  if (u.auto) h = '<div class="okbox" style="background:#ECE6FF;color:#4B3BA8"><span><b>Live stock downloaded from CUIMS</b> · ' + esc((S.autoStock || {}).store || '') + ' · ' + esc(((S.autoStock || {}).fy) || curFY()) + '</span></div>' + h;
  h += importReport(r, u.kind);
  const nImp = u.kind === 'stock' ? r.count : r.rows.length, nSk = (r.skipped || []).length;
  h += '<div class="grid2"><button class="btn" data-a="uploadCancel">Back</button><button class="btn main" data-a="uploadOk"' + (!nImp ? ' disabled' : '') + '>Import ' + nImp + (nSk ? ', skip ' + nSk : '') + '</button></div>';
  return h;
}

/* ---------------- Registers ---------------- */
function entryDate(e) { return e.date || (e.at || '').slice(0, 10); }
function entryTime(e) { return e.time || (e.at ? pad(new Date(e.at).getHours()) + ':' + pad(new Date(e.at).getMinutes()) : ''); }
function rname(code) { return (S.rnames || {})[code] || ''; }
function vReg() {
  const r = ui.reg;
  let h = '<header class="top"><div><h1>Registers</h1><div class="sub">Daily issue and return registers, editable, with PDF.</div></div></header><main>';
  h += '<button class="btn full" data-a="consOpen">Store-wise consumption</button>';
  h += '<div class="seg"><button data-a="regType" data-v="issue" class="' + (r.type === 'issue' ? 'on' : '') + '">Issue</button><button data-a="regType" data-v="return" class="' + (r.type === 'return' ? 'on' : '') + '">Return</button></div>';
  if (r.type === 'issue') h += fltBar('reg', true); else h += '<label class="f">Return date<input type="date" data-in="regDate" value="' + esc(r.date) + '"></label>';
  if (r.type === 'issue') {
    const G = regGroups();
    const isPend = g => g.man ? g.manStatus !== 'done' : g.left.length > 0;
    const pendN = G.filter(isPend).length;
    h += '<div class="seg">' + [['all', 'All ' + G.length], ['pending', 'Pending ' + pendN], ['done', 'Completed ' + (G.length - pendN)]].map(([k, l]) => '<button data-a="regSt" data-v="' + k + '" class="' + ((r.st || 'all') === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
    const list = G.filter(g => (r.st || 'all') === 'all' || (r.st === 'pending' ? isPend(g) : !isPend(g)));
    h += '<div class="shead"><div><h2>' + list.length + ' requests</h2><span>' + list.reduce((n, g) => n + g.slips.length, 0) + ' slips</span></div>' + sortPick('reg') + '</div>';
    h += '<div class="grid2"><button class="btn main" data-a="pdfIssue"' + (list.length ? '' : ' disabled') + '>Make PDF</button><button class="btn" data-a="newManual">+ Manual entry</button></div>';
    if (!list.length) h += '<div class="card pad note">Nothing for these dates.</div>';
    list.forEach(g => {
      if (g.man) { h += rqCard({ where: 'reg', req: g.req, store: g.store, tap: false, status: g.manStatus === 'done' ? ['Completed', 'c-ok'] : ['Pending · ' + g.issued + ' of ' + (g.total || '?') + ' issued', 'c-gd'],
        meta: ['requested ' + (g.date ? fmtShort(g.date) : '–'), 'GA' + esc(g.man.rcv || '–') + (g.man.rname ? ' ' + esc(g.man.rname) : ''), '<span class="stag man" style="position:static">Manual record</span>'], slips: g.slips,
        btns: '<button class="btn sm" data-a="manReqEdit" data-v="' + esc(g.req) + '">Edit slips & status</button><button class="btn sm ghost" data-a="manReqToggle" data-v="' + esc(g.req) + '">' + (g.manStatus === 'done' ? 'Mark pending' : 'Mark completed') + '</button>' }); return; }
      h += rqCard({ where: 'reg', req: g.req, store: g.store, status: g.left.length ? ['Pending · ' + g.left.length + ' of ' + g.total + ' left', 'c-gd'] : g.total ? ['Completed', 'c-ok'] : ['No articles', 'c-gy'],
        meta: ['requested ' + (g.date ? fmtShort(g.date) : '–'), g.issued + ' of ' + g.total + ' issued', g.closed ? g.closed + ' closed' : ''], slips: g.slips, left: g.left,
        btns: '<button class="btn sm" data-a="mslips" data-v="' + esc(g.req) + '">+ Add slips & serials</button><button class="btn sm ghost" data-a="reqStatus" data-v="' + esc(g.req) + '">Pending / completed</button>' });
    });
  } else {
    const list = S.returns.filter(x => x.date === r.date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    h += '<div class="grid2"><button class="btn main" data-a="pdfReturn"' + (list.length ? '' : ' disabled') + '>Make PDF</button><button class="btn" data-a="newReturn">+ New return</button></div>';
    h += '<div class="note">Same for every return on CUIMS: Return, Department, HOSTEL MESS (GA), Maintenance No, Issue Mode Normal, Against Issue No 1111.</div>';
    if (!list.length) h += '<div class="card pad note">No returns on ' + fmtLong(r.date) + '.</div>';
    list.forEach(x => {
      h += '<button class="card pad tap col" style="gap:4px" data-a="editReturn" data-v="' + x.id + '"><div class="row"><b>' + esc(x.store) + '</b><span class="mono note">' + esc(x.no) + '</span></div>' +
        '<div class="note mono">Against ' + esc(x.against) + ' · Serial ' + esc(x.serial || '–') + ' · ' + esc(x.time || '') + '</div>' +
        '<div class="note">By GA' + esc(x.by) + (x.byName ? ' ' + esc(x.byName) : '') + ' · ' + x.items.length + (x.items.length === 1 ? ' item' : ' items') + ' · entered by ' + esc((x.enteredBy || {}).name || '–') + '</div></button>';
    });
  }
  return h + '</main>';
}
function itemRowsHtml(items, noRemark) {
  return items.map((it, i) => '<div class="card pad col" style="gap:6px"><div class="row"><b>Item ' + (i + 1) + (it.name ? ': ' + esc(it.name) : '') + '</b><button class="btn sm warn" data-a="rmItem" data-v="' + i + '">Remove</button></div>' +
    '<div class="grid2"><label class="f">Item code<input type="text" data-it="' + i + '|code" value="' + esc(it.code) + '" autocapitalize="characters" class="mono"></label><label class="f">Qty' + (it.uom ? ' (' + esc(it.uom) + ')' : '') + '<input type="number" inputmode="decimal" data-it="' + i + '|qty" value="' + esc(it.qty) + '"></label></div>' +
    (noRemark ? '' : '<label class="f">Item remarks<input type="text" data-it="' + i + '|remark" value="' + esc(it.remark || '') + '" maxlength="100"></label>') + '</div>').join('');
}
function shEntry() {
  const f = ui.form;
  let h = '<div class="row"><h2>' + (f.kind === 'manual' ? (f._new ? 'New manual entry' : 'Manual entry') : 'Issue entry') + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  if (f.kind !== 'manual') h += '<div class="note">Editing changes the register record only, not stock or pending.</div>';
  h += '<div class="grid2"><label class="f">Slip No<input type="text" data-f="slip" value="' + esc(f.slip) + '" class="mono"></label><label class="f">Serial No<input type="text" data-f="serial" value="' + esc(f.serial || '') + '" class="mono" inputmode="numeric"></label></div>';
  h += '<label class="f">Store (Project Area)<input type="text" data-f="store" list="areaList" value="' + esc(f.store) + '" autocapitalize="characters"></label>' + areaDatalist();
  h += '<div class="grid2"><label class="f">Issued to (6 digits)<input type="text" data-f="rcv" value="' + esc(f.rcv) + '" class="mono" inputmode="numeric" maxlength="6"></label><label class="f">Receiver name<input type="text" data-f="rname" value="' + esc(f.rname || '') + '"></label></div>';
  h += '<div class="grid2"><label class="f">Date<input type="date" data-f="date" value="' + esc(f.date) + '"></label><label class="f">Time<input type="time" data-f="time" value="' + esc(f.time) + '"></label></div>';
  h += '<label class="f">Request No(s)<input type="text" data-f="reqs" value="' + esc(f.reqs || '') + '"></label>';
  h += '<label class="f">Remarks<input type="text" data-f="remarks" value="' + esc(f.remarks || '') + '"></label>';
  h += '<div class="grid2"><label class="f">Entered by (name)<input type="text" data-f="byName" value="' + esc(f.byName) + '"></label><label class="f">Emp code<input type="text" data-f="byEmp" value="' + esc(f.byEmp) + '"></label></div>';
  h += '<div class="sect">Items</div>' + itemRowsHtml(f.items) + '<button class="btn ghost" data-a="addItem">+ Add item</button>';
  h += '<div class="grid2">' + (f._new ? '<span></span>' : '<button class="btn warn" data-a="delEntry">Delete</button>') + '<button class="btn main" data-a="saveEntry">Save</button></div>';
  return h;
}
function shReturn() {
  const f = ui.form;
  let h = '<div class="row"><h2>' + (f._new ? 'New return' : 'Return ' + esc(f.no)) + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="grid2"><label class="f">Return No (yours)<input type="text" data-f="no" value="' + esc(f.no) + '" class="mono"></label><label class="f">Against Issue No<input type="text" data-f="against" value="' + esc(f.against) + '" class="mono" inputmode="numeric"></label></div>';
  h += '<label class="f">Store (Project Area)<input type="text" data-f="store" list="areaList" value="' + esc(f.store) + '" autocapitalize="characters"></label>' + areaDatalist();
  h += '<div class="grid2"><label class="f">Returned by (6 digits)<input type="text" data-f="by" value="' + esc(f.by) + '" class="mono" inputmode="numeric" maxlength="6"></label><label class="f">Name<input type="text" data-f="byName" value="' + esc(f.byName || '') + '"></label></div>';
  h += '<div class="grid2"><label class="f">Date<input type="date" data-f="date" value="' + esc(f.date) + '"></label><label class="f">Time<input type="time" data-f="time" value="' + esc(f.time) + '"></label></div>';
  h += '<label class="f">Serial No (after you submit on CUIMS)<input type="text" data-f="serial" value="' + esc(f.serial || '') + '" class="mono" inputmode="numeric"></label>';
  h += '<label class="f">Overall remarks<input type="text" data-f="remarks" value="' + esc(f.remarks || '') + '"></label>';
  h += '<div class="grid2"><label class="f">Entered by (name)<input type="text" data-f="ebName" value="' + esc(f.ebName) + '"></label><label class="f">Emp code<input type="text" data-f="ebEmp" value="' + esc(f.ebEmp) + '"></label></div>';
  h += '<div class="sect">Items</div>' + itemRowsHtml(f.items) + '<button class="btn ghost" data-a="addItem">+ Add item</button>';
  h += '<div class="grid2">' + (f._new ? '<span></span>' : '<button class="btn warn" data-a="delReturn">Delete</button>') + '<button class="btn main" data-a="saveReturn">Save</button></div>';
  return h;
}
function areaDatalist() {
  const opts = [...new Set([...Object.keys(S.stores), ...S.areas])];
  return '<datalist id="areaList">' + opts.map(a => '<option value="' + esc(a) + '">').join('') + '</datalist>';
}
function nextReturnNo() {
  let max = 0; S.returns.forEach(r => { const m = String(r.no).match(/(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  return 'R-' + String(max + 1).padStart(3, '0');
}

/* ---------------- Search ---------------- */
let DATAVER = 1, SIDX = null;
function searchIndex() {
  if (SIDX && SIDX.ver === DATAVER) return SIDX.recs;
  const rd = {}; S.lines.forEach(l => { if (!(l.req in rd)) rd[l.req] = l.date; });
  const out = [];
  S.entries.forEach(e => out.push({ type: 'Issue', id: 'e' + e.id, date: entryDate(e), time: entryTime(e), store: e.store, who: 'GA' + e.rcv + (e.rname ? ' ' + e.rname : ''), no: e.slip, serial: e.serial || '', reqs: e.reqs || [...new Set(e.items.map(i => i.req).filter(Boolean))].join(', '), by: e.by || {}, remarks: e.remarks || '', items: e.items, kind: e.kind }));
  S.returns.forEach(r => out.push({ type: 'Return', id: 'r' + r.id, date: r.date, time: r.time, store: r.store, who: 'GA' + r.by + (r.byName ? ' ' + r.byName : ''), no: r.no, serial: r.serial || '', reqs: 'Against ' + r.against, by: r.enteredBy || {}, remarks: r.remarks || '', items: r.items }));
  const R0 = {}; S.lines.forEach(l => { if (l.status === 'dropped') return; (R0[l.req] = R0[l.req] || []).push(l); });
  Object.values(S.manReqs || {}).forEach(m => out.push({ type: 'Request', id: 'm' + m.req, date: m.date, time: '', store: m.store, who: (m.status === 'done' ? 'completed' : 'pending') + ' · manual record', no: m.req, serial: '', reqs: m.req, by: m.by || {}, remarks: 'manual', items: [] }));
  Object.entries(R0).forEach(([req, L]) => { const w = L.filter(l => l.status === 'waiting').length;
    out.push({ type: 'Request', id: 'q' + req, date: L[0].date, time: '', store: L[0].store, who: w ? w + ' waiting · ' + (L.length - w) + ' issued' : 'all ' + L.length + ' issued', no: req, serial: '', reqs: req, by: {}, remarks: L.some(l => l.fromFile) ? '' : 'added in app', items: L.map(l => ({ code: l.code, name: itemName(l.code), qty: l.qty, uom: itemUom(l.code), req, remark: l.status })) }); });
  out.forEach(x => { x.rdates = new Set(x.items.map(i => rd[i.req]).filter(Boolean)); x.hay = [x.type, x.date, x.date ? fmtLong(x.date) : '', x.store, x.who, x.no, x.serial, x.reqs, x.by.name, x.by.emp, x.remarks, ...x.items.map(i => i.code + ' ' + (i.name || itemName(i.code)) + ' ' + (i.remark || ''))].join(' ').toLowerCase(); x.sk = (x.date || '') + (x.time || ''); });
  out.sort((a, b) => b.sk.localeCompare(a.sk));
  SIDX = { ver: DATAVER, recs: out }; return out;
}
function searchRecords() {
  const s = ui.search, terms = s.q.toLowerCase().split(/\s+/).filter(Boolean);
  return searchIndex().filter(x => (!s.rd || (x.type === 'Issue' && x.rdates.has(s.rd)) || (x.type === 'Request' && x.date === s.rd)) && (s.type === 'all' || x.type.toLowerCase() === s.type) && (!s.from || x.date >= s.from) && (!s.to || x.date <= s.to) && (!s.store || x.store === s.store) && terms.every(t => x.hay.includes(t)));
}
function searchRecordsOld() {
  const out = [];
  S.entries.forEach(e => out.push({ type: 'Issue', id: 'e' + e.id, date: entryDate(e), time: entryTime(e), store: e.store, who: 'GA' + e.rcv + (e.rname ? ' ' + e.rname : ''), no: e.slip, serial: e.serial || '', reqs: e.reqs || [...new Set(e.items.map(i => i.req).filter(Boolean))].join(', '), by: e.by || {}, remarks: e.remarks || '', items: e.items, kind: e.kind }));
  S.returns.forEach(r => out.push({ type: 'Return', id: 'r' + r.id, date: r.date, time: r.time, store: r.store, who: 'GA' + r.by + (r.byName ? ' ' + r.byName : ''), no: r.no, serial: r.serial || '', reqs: 'Against ' + r.against, by: r.enteredBy || {}, remarks: r.remarks || '', items: r.items }));
  const s = ui.search;
  const terms = s.q.toLowerCase().split(/\s+/).filter(Boolean);
  return out.filter(x => {
    if (s.rd && x.type === 'Issue' && !x.items.some(i => reqDateOfRaw(i.req) === s.rd)) return false;
    if (s.rd && x.type === 'Return') return false;
    if (s.type !== 'all' && x.type.toLowerCase() !== s.type) return false;
    if (s.from && x.date < s.from) return false;
    if (s.to && x.date > s.to) return false;
    if (s.store && x.store !== s.store) return false;
    if (!terms.length) return true;
    const hay = [x.type, x.date, fmtLong(x.date || today()), x.store, x.who, x.no, x.serial, x.reqs, x.by.name, x.by.emp, x.remarks, ...x.items.map(i => i.code + ' ' + (i.name || '') + ' ' + (i.remark || ''))].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  }).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}
function sResults(res) {
  const s = ui.search; let h = '';
  h += '<div class="shead"><div><h2>' + res.length.toLocaleString('en-IN') + ' results</h2><span>' + (s.q ? 'for "' + esc(s.q) + '"' : 'latest first') + '</span></div><button class="btn sm ghost" data-a="expSearch"' + (res.length ? '' : ' disabled') + '>Export</button></div>';
  if (!res.length) return h + '<div class="card pad note">Nothing found. Try a Request No, slip, serial, store or item.</div>';
  res.slice(0, 120).forEach(x => {
    if (x.type === 'Request') {
      const L = S.lines.filter(l => l.req === x.no && l.status !== 'dropped'), w = L.filter(l => l.status === 'waiting'), sl = reqSlips(x.no), m = (S.manReqs || {})[x.no];
      h += rqCard({ where: 'find', req: x.no, store: x.store, tap: !m, status: m ? (m.status === 'done' ? ['Completed', 'c-ok'] : ['Pending', 'c-gd']) : w.length ? [w.length + ' of ' + L.length + ' pending', 'c-gd'] : ['Completed', 'c-ok'],
        meta: ['requested ' + (x.date ? fmtShort(x.date) : '–'), m ? 'manual record' : L.length + ' articles'], slips: sl.length ? sl : null, left: w,
        btns: m ? '<button class="btn sm" data-a="manReqEdit" data-v="' + esc(x.no) + '">Edit</button><button class="btn sm ghost" data-a="renumReq" data-v="' + esc(x.no) + '">Renumber</button>' : '<button class="btn sm" data-a="openReq" data-v="' + esc(x.no) + '">Open request</button><button class="btn sm ghost" data-a="renumReq" data-v="' + esc(x.no) + '">Renumber</button>' });
      return;
    }
    const isRet = x.type === 'Return', e = isRet ? null : S.entries.find(z => 'e' + z.id === x.id), open = s.open === x.id;
    const man = e && e.kind === 'manual';
    h += '<div class="card rcard"><button class="main srch" data-a="sOpen" data-v="' + x.id + '"><div class="row"><span class="stag ' + (isRet ? 'ret' : man ? 'man' : 'appt') + '" style="position:static">' + (isRet ? 'Return' : man ? 'Manual slip' : 'App slip') + '</span>' + serFmt(x.serial) + '</div>' +
      '<b class="ttl">' + esc(x.store) + '</b>' + meta([esc(x.no), (x.date ? fmtShort(x.date) : '') + ' ' + esc(x.time || ''), esc(x.who), (e ? entryCount(e) : x.items.length) + ' articles']) +
      (x.reqs && !isRet ? '<div class="scrow">' + String(x.reqs).split(/\s*,\s*/).filter(Boolean).map(r => '<span class="reqno sm" data-req="' + esc(r) + '">' + esc(r) + '</span>').join('') + '</div>' : '') + '</button>' +
      (open && x.items.length ? '<div class="leftbox" style="background:var(--soft)">' + x.items.map(i => '<div class="leftrow"><span><b>' + esc(i.name || itemName(i.code)) + '</b><span class="mono">' + esc(i.code) + (i.remark ? ' · ' + esc(i.remark) : '') + '</span></span><b class="qty">' + num(i.qty) + ' ' + esc(i.uom || '') + '</b></div>').join('') + '</div>' : '') +
      (open && e ? '<div class="rqbtns"><button class="btn sm" data-a="editEntry" data-v="' + e.id + '">Edit slip</button>' + (x.reqs ? '<button class="btn sm ghost" data-a="openReq" data-v="' + esc(String(x.reqs).split(/\s*,\s*/)[0]) + '">Open request</button>' : '') + '</div>' : '') + '</div>';
  });
  if (res.length > 120) h += '<div class="note" style="text-align:center">Showing 120 of ' + res.length + '. Narrow the search or export all.</div>';
  return h;
}
function vFind() {
  const s = ui.search;
  const res = searchRecords();
  const stores = [...new Set([...S.entries.map(e => e.store), ...S.returns.map(r => r.store), ...S.lines.map(l => l.store)])].sort();
  let h = '<header class="top"><div><h1>Search</h1><div class="sub">Requests, slips and returns. Type a Request No, slip, serial, store, item or person.</div></div></header><main>';
  h += '<div class="sbox big">' + '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" data-in="q" value="' + esc(s.q) + '" placeholder="Item, slip, serial, store, request…" autocomplete="off" enterkeyhint="search"></div>';
  h += '<div class="seg">' + [['all', 'All'], ['request', 'Requests'], ['issue', 'Issues'], ['return', 'Returns']].map(([k, l]) => '<button data-a="sType" data-v="' + k + '" class="' + (s.type === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  h += '<label class="f fdate"><span>Request date</span><span class="fin"><input type="date" data-in="sRd" value="' + esc(s.rd || '') + '">' + (s.rd ? '<button class="fx" data-a="sRdClear" aria-label="Clear request date">' + ico('x', 14) + '</button>' : '') + '</span></label>';
  h += '<div class="note" style="margin-top:-6px">Issue date range:</div>';
  h += '<div class="grid2"><label class="f">From<input type="date" data-in="sFrom" value="' + esc(s.from) + '"></label><label class="f">To<input type="date" data-in="sTo" value="' + esc(s.to) + '"></label></div>';
  h += pickBtn('sStore', { title: 'Store', search: true, full: true, opts: [['', 'All stores']].concat(stores.map(x => [x, x])), val: s.store || '', set: v => { ui.search.store = v; render(); } }, 'Store');
  h += '<button class="stockcard lite" data-a="stockOpen"><span class="sci">' + ico('right', 18).replace('M9 6l6 6-6 6', 'M4 7h16M4 12h16M4 17h10') + '</span><span class="sct"><b>Search live stock</b><span>Any item: closing qty, needed and free</span></span>' + ico('right', 18) + '</button>';
  h += '<div id="sres">' + sResults(res) + '</div>';
  return h + '</main>';
}

/* ---------------- Settings ---------------- */
let INFO = {};
try { INFO = N ? JSON.parse(N.info()) : { version: 'browser', mode: 'online' }; } catch (e) {}
const SETPAGES = [
  ['profile', 'Profile', 'Photo, name, emp code, designation', '#E5EDFD', '#1D4ED8', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'],
  ['pdf', 'PDF and signatures', 'Store name, manager signature', '#F7EFD9', '#8A6A1F', '<path d="M6 3h9l3 3v15H6z"/><path d="M9 13h6M9 17h4"/>'],
  ['stores', 'Stores and receivers', 'Project Areas, 6-digit codes', '#E3F4EC', '#0B5E3D', '<path d="M3 10l9-6 9 6v10H3z"/><path d="M9 20v-6h6v6"/>'],
  ['fill', 'Filling and automation', 'Queue mode', '#FCF1DA', '#8A5A00', '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'],
  ['cuims', 'CUIMS logins and pages', 'Issue ID, manager ID, desktop zoom', '#E3F4EC', '#0B5E3D', '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'],
  ['cloud', 'Cloud backup', 'Google Drive + Sheet, restore', '#E5EDFD', '#1E3A8A', '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>'],
  ['data', 'Downloads and data', 'Excel exports, template, clear data', '#EFEDE8', '#3A3E45', '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'],
  ['security', 'Security', 'Fingerprint / PIN lock', '#FBE6E9', '#8E1B2A', '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'],
  ['app', 'App and updates', 'Version, updates, rollback', '#F7EFD9', '#8A6A1F', '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>']
];
function initials(n) { return String(n || 'JV').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase(); }
function avatar(big) { return S.me.photo ? '<img class="avatar' + (big ? ' big' : '') + '" src="' + S.me.photo + '" alt="Profile photo">' : '<span class="avatar' + (big ? ' big' : '') + '">' + esc(initials(S.me.name)) + '</span>'; }
function vSet() {
  const pg = ui.setPage;
  let h = '';
  if (!pg) {
    h += '<header class="top"><div><h1>Settings</h1></div></header><main>';
    h += '<button class="card pad tap" data-a="setPage" data-v="profile" style="display:flex;align-items:center;gap:14px">' + avatar(true) + '<span style="flex:1"><b style="font-size:19px">' + esc(S.me.name || 'Add your name') + '</b><div class="note">' + esc([S.me.desig, S.me.emp].filter(Boolean).join(' · ') || 'Tap to set up your profile') + '</div></span><span class="chev">' + ico('right', 18) + '</span></button>';
    const groups = [['Account', ['profile', 'pdf']], ['Work', ['stores', 'fill', 'cuims']], ['Data', ['cloud', 'data']], ['App', ['security', 'app']]];
    groups.forEach(([g, keys]) => {
      h += '<div class="sect">' + g + '</div><div class="card" style="overflow:hidden">';
      keys.forEach(k => { const p = SETPAGES.find(x => x[0] === k);
        h += '<button class="srow" data-a="setPage" data-v="' + k + '"><span class="ic" style="background:' + p[3] + ';color:' + p[4] + '">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p[5] + '</svg></span><span class="tx"><b>' + p[1] + '</b><span>' + p[2] + '</span></span><span class="chev">' + ico('right', 18) + '</span></button>'; });
      h += '</div>';
    });
    h += '<div class="note" style="text-align:center;padding:8px 0 4px">JV Stock Issue ' + esc(INFO.version || '') + ' · Built by ' + esc(S.me.builder || S.me.name || 'JV') + '</div>';
    return h + '</main>';
  }
  const P0 = SETPAGES.find(x => x[0] === pg);
  h += '<header class="top"><div><button class="btn sm ghost" data-a="setBack">‹ Settings</button><h1 style="margin-top:10px">' + P0[1] + '</h1></div></header><main>';
  if (ui.locked) h += '<button class="banner tap" data-a="lockTap" style="border:0;background:var(--goldBg);color:var(--goldInk)"><span style="display:inline-flex;gap:8px;align-items:center">' + ico('lock', 18) + '<span><b>View only.</b> Tap to unlock with fingerprint to make changes.</span></span></button>';
  h += '<fieldset ' + (ui.locked ? 'disabled ' : '') + 'style="border:0;padding:0;margin:0;min-width:0;display:flex;flex-direction:column;gap:16px">';
  if (pg === 'profile') {
    h += '<div class="card pad col" style="align-items:center;text-align:center">' + avatar(true) + '<div class="grid2" style="width:100%"><button class="btn sm" data-a="photo">Change photo</button><button class="btn sm ghost" data-a="photoDel"' + (S.me.photo ? '' : ' disabled') + '>Remove photo</button></div></div>';
    h += '<div class="card pad col"><h3>My details</h3><div class="note">Entries made through the app get these. Also printed on PDFs.</div>' +
      '<label class="f">Name<input type="text" data-set="me.name" value="' + esc(S.me.name) + '"></label>' +
      '<div class="grid2"><label class="f">Emp code<input type="text" data-set="me.emp" value="' + esc(S.me.emp) + '" autocapitalize="characters"></label><label class="f">Designation<input type="text" data-set="me.desig" value="' + esc(S.me.desig) + '"></label></div>' +
      '<label class="f">"Built by" name in the top bar<input type="text" data-set="me.builder" value="' + esc(S.me.builder || '') + '" placeholder="' + esc(S.me.name || 'Your name') + '"></label></div>';
  }
  if (pg === 'data') {
    h += '<div class="card pad col"><h3>Test mode</h3><div class="note">Try new features or practise entries without touching your real requests, slips or stock. Your real data is put aside and comes back exactly as it was. Cloud backup pauses while testing.</div><button class="btn ' + (S.testMode ? 'main' : '') + '" data-a="testToggle" type="button">' + (S.testMode ? 'Leave Test mode' : 'Turn on Test mode') + '</button>' + (S.testMode ? '<button class="btn ghost" data-a="testClear" type="button">Delete all test data</button>' : '') + '</div>';
    h += '<div class="card pad col"><h3>Data check</h3><div class="note">Finds Request No clashes, repeated items, mixed dates, incomplete rows and repeated Slip Nos, with fix buttons.</div><button class="btn" data-a="dcOpen" type="button">Run data check</button></div>';
  }
  if (pg === 'cuims') {
    h += '<div class="card pad col"><h3>Two CUIMS logins</h3><div class="note">Issue CUIMS uses your emp ID to fill entries. Manager CUIMS has its own separate login for the live stock report.' + (INFO.mgrSeparate === false ? ' <b>Your phone\'s WebView is too old for separate logins; both share one login until Android System WebView is updated.</b>' : '') + '</div>' +
      '<label class="f">Issue page (opens after login)<input type="text" data-url="emp" value="' + esc(ui.urlEmp != null ? ui.urlEmp : INFO.urlEmp || 'https://staff.cuchd.in/frmStoreIssueReceiveLC.aspx') + '"></label>' +
      '<label class="f">Manager page: live stock report<input type="text" data-url="mgr" value="' + esc(ui.urlMgr != null ? ui.urlMgr : INFO.urlMgr || 'https://staff.cuchd.in/frmItemStatementLC.aspx') + '"></label>' +
      '<button class="btn main" data-a="saveUrls">Save pages</button><div class="note">After every login, the app goes straight to these pages. No extra clicks.</div></div>';
    let ci = {}; try { ci = N && N.credInfo ? JSON.parse(N.credInfo()) : {}; } catch (e) {}
    const cred = (w, title) => { const c = ci[w] || {}; const f = (ui.cred || {})[w] || {};
      return '<div class="card pad col"><h3>' + title + ' login</h3><div class="grid2"><label class="f">User ID<input type="text" data-cr="' + w + '|u" value="' + esc(f.u != null ? f.u : c.u || '') + '" autocomplete="off" autocapitalize="none"></label><label class="f">Password<input type="password" data-cr="' + w + '|p" value="' + esc(f.p || '') + '" placeholder="' + (c.has ? 'saved (type to change)' : '') + '" autocomplete="new-password"></label></div>' +
        '<label class="chk"><input type="checkbox" data-a="credAuto" data-v="' + w + '"' + ((f.auto != null ? f.auto : c.auto !== false) ? ' checked' : '') + '> Log in by itself (fills and taps Login)</label><div class="grid2"><button class="btn main" data-a="credSave" data-v="' + w + '">Save</button><button class="btn" data-a="credDel" data-v="' + w + '"' + (c.has || c.u ? '' : ' disabled') + '>Remove</button></div></div>'; };
    h += cred('emp', 'Issue CUIMS (your emp ID)') + cred('mgr', 'Manager CUIMS');
    h += '<div class="note">Saved only on this phone (private app storage). Never included in cloud backups or exports. If CUIMS shows a captcha, the app fills ID and password and leaves the Login tap to you.</div>';
    { const c = autoStockCfg();
      h += '<div class="card pad col"><h3>Live stock auto update</h3><label class="chk"><input type="checkbox" data-a="autoStockTog"' + (c.on ? ' checked' : '') + '> When I tap Live stock, fetch the stock report by itself</label>' +
        '<div class="note">Opens Manager CUIMS full screen, picks the store and financial year, taps SHOW, waits for the full report, exports Excel and brings it to the upload screen for you to confirm.</div>' +
        '<div class="grid2"><label class="f">Store<input type="text" data-asc="store" value="' + esc(c.store) + '"></label><label class="f">Financial year<input type="text" data-asc="fy" value="' + esc(c.fy) + '" placeholder="' + curFY() + ' (auto)"></label></div></div>'; }
    h += '<div class="card pad col"><h3>Open</h3><div class="grid2"><button class="btn" data-a="openSite" type="button">Issue CUIMS</button><button class="btn" data-a="openMgr" type="button">Manager CUIMS</button></div></div>';
    h += '<div class="card pad col"><h3>Desktop view and zoom</h3><div class="note">CUIMS always opens in desktop view. Your zoom level is remembered after reloads. Pinch to set it once.</div><button class="btn" data-a="resetZoom">Reset zoom to default</button></div>';
  }
  if (pg === 'pdf') {
    h += '<div class="card pad col"><label class="f">Store name (PDF title)<input type="text" data-set="me.storeName" value="' + esc(S.me.storeName) + '"></label></div>';
  h += '<div class="card pad col"><h3>Manager signature on PDFs</h3><label class="chk"><input type="checkbox" data-a="mgrToggle"' + (S.mgr.on ? ' checked' : '') + '> Add manager signature line</label>' +
    (S.mgr.on ? '<div class="grid2"><label class="f">Manager name<input type="text" data-set="mgr.name" value="' + esc(S.mgr.name) + '"></label><label class="f">Emp code<input type="text" data-set="mgr.emp" value="' + esc(S.mgr.emp || '') + '" autocapitalize="characters"></label></div><label class="f">Designation<input type="text" data-set="mgr.desig" value="' + esc(S.mgr.desig) + '"></label>' : '') + '</div>';
  }
  if (pg === 'stores') {
    const allSt = [...new Set([...(S.storeOrder || []), ...Object.keys(S.stores), ...S.lines.map(l => l.store)])].sort(byStore);
    h += '<div class="card"><div class="pad col" style="gap:4px"><h3>My store order</h3><div class="note">Used everywhere when sort is "My order". Move stores up or down.</div></div>' +
      allSt.map((st, i) => '<div class="line row" style="flex-direction:row"><b style="flex:1">' + (i + 1) + '. ' + esc(st) + '</b><button class="xbtn" data-a="moveStore" data-v="' + esc(st) + '" data-d="-1"' + (i ? '' : ' disabled') + ' aria-label="Move up">' + ico('up', 18) + '</button><button class="xbtn" data-a="moveStore" data-v="' + esc(st) + '" data-d="1"' + (i < allSt.length - 1 ? '' : ' disabled') + ' aria-label="Move down">' + ico('down', 18) + '</button></div>').join('') + '</div>';
  const stores = Object.keys(S.stores).sort();
  h += '<div class="card"><div class="pad col" style="gap:4px"><h3>Stores and receivers</h3><div class="note">Store = exact CUIMS Project Area. Receiver = 6 digits; change anytime. ' + (S.areas.length ? S.areas.length + ' Project Areas known from CUIMS.' : 'Open CUIMS once to load the Project Area list.') + '</div></div>';
  stores.forEach(s => {
    const v = S.stores[s].rcv || ''; const bad = v && !/^\d{6}$/.test(v);
    const known = !S.areas.length || S.areas.some(a => a.toUpperCase() === s);
    h += '<div class="line"><div class="row"><b>' + esc(s) + '</b><button class="btn sm ghost" data-a="rmStore" data-v="' + esc(s) + '">Remove</button></div>' + (known ? '' : '<div class="err">Not in the CUIMS Project Area list</div>') +
      '<div class="grid2"><input type="text" inputmode="numeric" maxlength="6" data-store-rcv="' + esc(s) + '" value="' + esc(v) + '" placeholder="6-digit receiver" class="mono' + (bad ? ' bad' : '') + '"><input type="text" data-store-name="' + esc(s) + '" value="' + esc(S.stores[s].rname || rname(v)) + '" placeholder="Receiver name"></div></div>';
  });
  h += '<div class="pad col"><input type="text" id="newStore" list="areaList" placeholder="Add store: type or pick Project Area" autocapitalize="characters">' + areaDatalist() + '<button class="btn" data-a="addStore">+ Add store</button></div></div>';
  }
  if (pg === 'fill') {
  h += '<div class="card pad col"><h3>Auto submit</h3><label class="chk"><input type="checkbox" data-a="autoSubToggle"' + (S.autoSubmit ? ' checked' : '') + '> Tap SUBMIT automatically when the recheck matches 100%</label><div class="note">A 4-second countdown with a Stop button appears first. You can also switch this in the CUIMS bar.</div></div>';
  h += '<div class="card pad col"><h3>Filling</h3><label class="chk"><input type="checkbox" data-a="queueToggle"' + (S.queue ? ' checked' : '') + '> Queue mode: after each submit, fill the next request automatically</label></div>';
    h += queueBox();
  }
  if (pg === 'cloud') {
  h += '<div class="card pad col"><h3>Cloud backup (Google Drive + Sheet)</h3><label class="f">Apps Script web app URL<input type="text" data-set="sync.url" value="' + esc(S.sync.url) + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
    '<label class="f">Upload changes after</label>' + pickBtn('syncDelay', { title: 'Upload changes after', full: true, opts: [['0', 'Right away'], ['1', '1 minute'], ['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour']], val: String(S.sync.delay != null ? S.sync.delay : 5), set: v => { S.sync.delay = parseFloat(v); writeLocal(); render(); } }) + '<div class="note">Everything is saved on the phone instantly. Cloud upload waits this long after a change (and always happens when you leave the app).</div>' +
    '<label class="chk"><input type="checkbox" data-a="syncAuto"' + (S.sync.auto ? ' checked' : '') + '> Back up automatically after changes</label>' +
    '<div class="note">' + (S.sync.at ? 'Last backup ' + fmtDT(S.sync.at) : 'Not backed up yet') + '</div>' +
    '<div class="grid2"><button class="btn" data-a="syncNow"' + (S.sync.url ? '' : ' disabled') + '>Back up now</button><button class="btn main" data-a="backups"' + (S.sync.url ? '' : ' disabled') + '>Manage backups</button></div></div>';
  }
  if (pg === 'data') {
  h += '<div class="card pad col"><h3>Downloads</h3><div class="grid2">' +
    [['expRequests', 'Requests register'], ['expEntries', 'Entries log'], ['expItems', 'Entry items'], ['expPendXlsx', 'Pending (Excel)'], ['expPendPdf', 'Pending (PDF)'], ['expStock', 'Stock now'], ['expReturns', 'Returns'], ['expAll', 'Full backup']].map(([a, l]) => '<button class="btn sm" data-a="' + a + '">' + l + '</button>').join('') +
    '</div><button class="btn sm ghost" data-a="template">Download data template</button></div>';
  h += '<div class="card pad col"><h3>Data</h3><div class="note">' + S.lines.length + ' request articles · ' + S.entries.length + ' issue entries · ' + S.returns.length + ' returns · ' + Object.keys(S.stock).length + ' stock items</div><button class="btn warn" data-a="wipe">Clear all data on this phone</button></div>';
  }
  if (pg === 'security') {
  h += '<div class="card pad col"><h3>Security</h3><label class="chk"><input type="checkbox" data-a="lockToggle"' + (INFO.lock ? ' checked' : '') + '> Fingerprint / PIN lock when opening</label></div>';
  }
  if (pg === 'app') {
  const ui2 = S.updateInfo;
  h += '<div class="card pad col" id="upd"><h3>App updates</h3><div class="note">Installed ' + esc(INFO.version || '–') + '. ' + (ui2 ? (ui2.newer ? 'New version ' + esc(ui2.tag) + ' is available.' : 'You have the latest version (checked ' + fmtDT(ui2.at) + ').') : '') + '</div>' +
    '<div class="grid2"><button class="btn" data-a="checkUpdate">Check now</button><button class="btn main" data-a="installUpdate"' + (ui2 && ui2.newer ? '' : ' disabled') + '>Install update</button></div>' +
    '<div class="note">Screens update by themselves from GitHub. If a new screen version misbehaves, switch to the built-in version.</div>' +
    '<div class="seg"><button data-a="mode" data-v="online" class="' + (INFO.mode !== 'bundled' ? 'on' : '') + '">Latest online</button><button data-a="mode" data-v="bundled" class="' + (INFO.mode === 'bundled' ? 'on' : '') + '">Built-in (rollback)</button></div></div>';
  }
  return h + '</fieldset></main>';
}

/* ---------------- exports ---------------- */
function saveBlobB64(b64, name, mime) {
  if (N) { const r = N.saveFile(b64, name, mime); if (r !== 'ok') toast('Could not save: ' + r); return; }
  const a = document.createElement('a'); a.href = 'data:' + mime + ';base64,' + b64; a.download = name; a.click();
}
const XMIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function saveWb(sheets, name) {
  if (!window.XLSX) { toast('Excel tools not loaded yet. Check internet and try again.'); return; }
  const wb = XLSX.utils.book_new();
  sheets.forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No data' }]), n));
  saveBlobB64(XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }), name, XMIME);
}
function rowsRequests() {
  return requests().map(r => {
    const iss = r.lines.filter(l => l.status === 'issued'), w = r.lines.filter(l => l.status === 'waiting');
    const slips = [...new Set(iss.flatMap(l => l.issued.map(x => x.slip)))];
    return { 'Request No': r.req, Store: r.store, 'Request date': fmtLong(r.date), Source: r.src === 'old' ? 'Earlier pending' : 'New', Articles: r.lines.length, Issued: iss.length, Pending: w.length,
      Status: !w.length ? 'Complete' : iss.length ? 'Partial ' + iss.length + ' of ' + r.lines.length : 'Pending', 'Slips used': slips.join(', ') };
  });
}
function rowsEntries(list) {
  return (list || S.entries).map(e => ({ Date: fmtLong(entryDate(e)), Time: entryTime(e), 'Slip No': e.slip, 'Serial No': e.serial || '', Store: e.store, 'Issued to': 'GA' + e.rcv, 'Receiver name': e.rname || '',
    'Request Nos': e.reqs || [...new Set(e.items.map(i => i.req).filter(Boolean))].join(', '), Items: e.items.length, Remarks: e.remarks || '', 'Entered by': (e.by || {}).name || '', 'Emp code': (e.by || {}).emp || '', Type: e.kind === 'manual' ? 'Manual' : 'App' }));
}
function rowsItems() {
  const out = [];
  S.entries.forEach(e => e.items.forEach(i => out.push({ Date: fmtLong(entryDate(e)), 'Slip No': e.slip, 'Serial No': e.serial || '', Store: e.store, 'Request No': i.req || '', 'Item code': i.code, Item: i.name || itemName(i.code), Qty: Number(i.qty), UOM: i.uom || itemUom(i.code), Remark: i.remark || '' })));
  return out;
}
function rowsPending() {
  return S.lines.filter(isPending).sort((a, b) => a.store.localeCompare(b.store) || a.date.localeCompare(b.date))
    .map(l => ({ Store: l.store, 'Request No': l.req, 'Item code': l.code, Item: itemName(l.code), Qty: l.qty, UOM: itemUom(l.code), 'Requested on': fmtLong(l.date), 'Days pending': days(l.date), 'Earlier slips': [l.earlier, ...l.issued.map(x => x.slip)].filter(Boolean).join(', ') }));
}
function rowsStock() { return Object.entries(S.stock).map(([c, s]) => ({ 'Item code': c, Item: s.name, UOM: s.uom, 'Stock now': s.qty })); }
function rowsReturns() {
  const out = [];
  S.returns.forEach(r => r.items.forEach(i => out.push({ Date: fmtLong(r.date), Time: r.time, 'Return No': r.no, 'Against Issue No': r.against, 'Serial No': r.serial || '', Store: r.store, 'Returned by': 'GA' + r.by, Name: r.byName || '', 'Item code': i.code, Item: i.name || itemName(i.code), Qty: Number(i.qty), UOM: i.uom || itemUom(i.code), 'Item remark': i.remark || '', Remarks: r.remarks || '', 'Entered by': (r.enteredBy || {}).name || '', 'Emp code': (r.enteredBy || {}).emp || '' })));
  return out;
}
function rowsAllLines() { return S.lines.map(l => ({ 'Request No': l.req, Store: l.store, 'Request date': fmtLong(l.date), 'Item code': l.code, Item: itemName(l.code), Qty: l.qty, Status: l.status, Source: l.src, Receiver: l.rcv || '', 'Issued in': l.issued.map(x => x.slip + (x.serial ? ' #' + x.serial : '')).join(', '), 'Earlier slips': l.earlier || '' })); }
function template() {
  saveWb([['New Requests', [{ 'Request No': 'EX-1201', Store: 'LC MESS', 'Request date': '12-10-2026', 'Item code': 'KM-187', Qty: 50, 'Receiver (optional)': '', 'Slip No (optional)': 'JV/920' }]],
    ['Old Pending', [{ 'Request No': 'EX-1150', Store: 'LC MESS', 'Request date': '09-10-2026', 'Item code': 'GR-887', 'Qty pending': 5, 'Earlier Slip Nos (optional)': 'JV/880' }]]], 'JV-Stock-Issue-template.xlsx');
}

/* ---------------- PDFs ---------------- */
let LOGO = null;
(function loadLogo() { try { const im = new Image(); im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(im, 0, 0, 128, 128); LOGO = c.toDataURL('image/png'); } catch (e) {} }; im.src = 'icon.png'; } catch (e) {} })();
function pdfDoc(landscape) {
  if (!window.jspdf) { toast('PDF tools not loaded yet. Check internet and try again.'); return null; }
  return new window.jspdf.jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
}
const NAVY = [15, 23, 42], GOLD = [201, 162, 75], INK = [20, 22, 26];
function pdfHead(doc, title, sub, chips) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 26, 'F');
  doc.setFillColor(...GOLD); doc.rect(0, 26, W, 1.2, 'F');
  let x = 12;
  if (LOGO) { try { doc.addImage(LOGO, 'PNG', 12, 5, 16, 16); x = 32; } catch (e) {} }
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(title, x, 12.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(201, 206, 214); doc.text(sub, x, 19);
  doc.setTextColor(...GOLD); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('JV STOCK ISSUE', W - 12, 12.5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setTextColor(201, 206, 214); doc.text('Built by ' + (S.me.builder || S.me.name || 'JV'), W - 12, 19, { align: 'right' });
  let cx = 12; const cy = 32;
  doc.setFontSize(8.5);
  (chips || []).forEach(([k, v]) => {
    const t = k + '  ' + v; const w = doc.getTextWidth(t) + 8;
    doc.setFillColor(247, 239, 217); doc.roundedRect(cx, cy, w, 7, 3.5, 3.5, 'F');
    doc.setTextColor(138, 106, 31); doc.setFont('helvetica', 'bold'); doc.text(k, cx + 4, cy + 4.8);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); doc.text(String(v), cx + 4 + doc.getTextWidth(k + '  '), cy + 4.8);
    cx += w + 3;
  });
  return cy + 12;
}
function pdfSign(doc, showMe, showMgr) {
  if (showMe === undefined) showMe = true; if (showMgr === undefined) showMgr = S.mgr.on;
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 40) + 14;
  if (y > H - 40) { doc.addPage(); y = 24; }
  const box = (x, label, name, sub) => {
    doc.setDrawColor(232, 229, 223); doc.setFillColor(250, 249, 246); doc.roundedRect(x, y, 80, 28, 3, 3, 'FD');
    doc.setFontSize(8); doc.setTextColor(138, 106, 31); doc.setFont('helvetica', 'bold'); doc.text(label.toUpperCase(), x + 5, y + 6);
    doc.setDrawColor(180); doc.line(x + 5, y + 17, x + 75, y + 17);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(name || ' ', x + 5, y + 22.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(107, 111, 118); doc.text(sub || ' ', x + 5, y + 26.2);
  };
  if (showMe) box(12, 'Prepared & checked by', S.me.name || '', [S.me.emp, S.me.desig].filter(Boolean).join(' · '));
  if (showMgr) box(showMe ? W - 92 : 12, 'Manager', S.mgr.name || '', [S.mgr.emp, S.mgr.desig].filter(Boolean).join(' · '));
}
function pdfFoot(doc, label) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor(...GOLD); doc.setLineWidth(0.4); doc.line(12, H - 11, W - 12, H - 11);
    doc.setFontSize(7.5); doc.setTextColor(107, 111, 118);
    doc.text('JV Stock Issue · ' + label + ' · ' + (S.me.storeName || '') + ' · generated ' + fmtDT(new Date().toISOString()), 12, H - 6.5);
    doc.text('Page ' + i + ' of ' + n, W - 12, H - 6.5, { align: 'right' });
  }
}
function pdfSave(doc, name) { saveBlobB64(doc.output('datauristring').split(',')[1], name, 'application/pdf'); }
const TSTYLE = { headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8.5, cellPadding: 2.4 }, styles: { fontSize: 8.5, cellPadding: 2.2, lineColor: [232, 229, 223], lineWidth: 0.2, textColor: INK, valign: 'middle' }, alternateRowStyles: { fillColor: [250, 249, 246] }, margin: { left: 12, right: 12 } };
function issueGroups(list) {
  const G = new Map();
  list.forEach(e => {
    const reqs = [...new Set(e.items.map(i => i.req).filter(Boolean))];
    const keys = reqs.length ? reqs : (e.reqs ? e.reqs.split(/\s*,\s*/).filter(Boolean) : ['—' + e.slip]);
    keys.forEach(k => {
      if (!G.has(k)) G.set(k, { req: k.startsWith('—') ? '' : k, store: e.store, to: new Set(), slips: [], items: [], remarks: new Set(), by: new Set(), date: entryDate(e) });
      const g = G.get(k);
      g.to.add('GA' + e.rcv + (e.rname ? ' ' + e.rname : ''));
      g.slips.push({ slip: e.slip, serial: e.serial || '', time: entryTime(e) });
      e.items.filter(i => !reqs.length || i.req === k).forEach(i => g.items.push(Object.assign({ slip: e.slip }, i)));
      g.count = (g.count || 0) + (e.items.length ? e.items.filter(i => !reqs.length || i.req === k).length : (Number(e.count) || 0));
      if (e.remarks) g.remarks.add(e.remarks); if (e.kind === 'manual') g.remarks.add('Manual');
      if ((e.by || {}).name) g.by.add(e.by.name + (e.by.emp ? ' (' + e.by.emp + ')' : ''));
    });
  });
  return [...G.values()].sort((a, b) => byStore(a.store, b.store) || a.req.localeCompare(b.req, undefined, { numeric: true }));
}
function pdfIssue() {
  const d = ui.reg.date, list = S.entries.filter(e => entryDate(e) === d);
  const doc = pdfDoc(true); if (!doc) return;
  const G = issueGroups(list);
  const items = list.reduce((s, e) => s + e.items.length, 0);
  const y0 = pdfHead(doc, 'Daily Issue Register', (S.me.storeName || 'Store') + ' · Issue · Department · Offline · HOSTEL MESS (GA)', [['Date', fmtLong(d)], ['Requests', G.length], ['Slips', list.length], ['Items', items]]);
  doc.autoTable(Object.assign({}, TSTYLE, { startY: y0,
    head: [['#', 'Request No', 'Store', 'Issued to', 'Slip No', 'Serial No', 'Time', 'Items', 'Remarks', 'Entered by']],
    body: G.map((g, i) => [i + 1, g.req || '–', g.store, [...g.to].join('\n'), g.slips.map(x => x.slip).join('\n'), g.slips.map(x => x.serial || '______').join('\n'), g.slips.map(x => x.time).join('\n'), g.items.length, [...g.remarks].join(', ') || '–', [...g.by].join('\n')]),
    columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' }, 4: { textColor: [30, 58, 138], fontStyle: 'bold' }, 5: { textColor: [11, 94, 61], fontStyle: 'bold' }, 7: { halign: 'center' } } }));
  if (ui.reg.items) G.forEach(g => {
    doc.autoTable(Object.assign({}, TSTYLE, { startY: doc.lastAutoTable.finalY + 6, headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      head: [[{ content: 'Request ' + (g.req || '–') + '   ·   ' + g.store + '   ·   ' + [...g.to].join(', ') + '   ·   Slips ' + g.slips.map(x => x.slip + (x.serial ? ' #' + x.serial : '')).join(', '), colSpan: 7 }], ['S.No', 'Slip No', 'Item code', 'Item', 'UOM', 'Qty', 'Item remarks']],
      body: g.items.map((x, i) => [i + 1, x.slip, x.code, x.name || itemName(x.code), x.uom || itemUom(x.code), num(x.qty), x.remark || '–']) }));
  });
  pdfSign(doc); pdfFoot(doc, 'Issue Register'); pdfSave(doc, 'Issue-Register-' + d + '.pdf');
}
function pdfReturn() {
  const d = ui.reg.date, list = S.returns.filter(x => x.date === d).sort((a, b) => byStore(a.store, b.store) || (a.time || '').localeCompare(b.time || ''));
  const doc = pdfDoc(false); if (!doc) return;
  const items = list.reduce((s, r) => s + r.items.length, 0);
  const y0 = pdfHead(doc, 'Daily Return Register', (S.me.storeName || 'Store') + ' · Return · Department · Against Issue No 1111', [['Date', fmtLong(d)], ['Returns', list.length], ['Items', items]]);
  doc.autoTable(Object.assign({}, TSTYLE, { startY: y0,
    head: [['#', 'Return No', 'Store', 'Returned by', 'Date & time', 'Against', 'Serial No', 'Items', 'Entered by']],
    body: list.map((r, i) => [i + 1, r.no, r.store, 'GA' + r.by + (r.byName ? '\n' + r.byName : ''), fmtShort(r.date) + ' ' + (r.time || ''), r.against, r.serial || '______', r.items.length, ((r.enteredBy || {}).name || '') + ((r.enteredBy || {}).emp ? '\n' + r.enteredBy.emp : '')]),
    columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' }, 6: { textColor: [11, 94, 61], fontStyle: 'bold' }, 7: { halign: 'center' } } }));
  list.forEach(r => {
    doc.autoTable(Object.assign({}, TSTYLE, { startY: doc.lastAutoTable.finalY + 6, headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      head: [[{ content: r.no + '   ·   ' + r.store + '   ·   Returned by GA' + r.by + '   ·   Serial ' + (r.serial || '____') + (r.remarks ? '   ·   ' + r.remarks : ''), colSpan: 6 }], ['S.No', 'Item code', 'Item', 'UOM', 'Qty', 'Item remarks']],
      body: r.items.map((x, i) => [i + 1, x.code, x.name || itemName(x.code), x.uom || itemUom(x.code), num(x.qty), x.remark || '–']) }));
  });
  pdfSign(doc); pdfFoot(doc, 'Return Register'); pdfSave(doc, 'Return-Register-' + d + '.pdf');
}
function pdfPending() {
  const rows = rowsPending(); const doc = pdfDoc(true); if (!doc) return;
  const stores = new Set(rows.map(r => r.Store)).size;
  const y0 = pdfHead(doc, 'Pending Report', (S.me.storeName || 'Store') + ' · articles waiting for stock', [['Date', fmtLong(today())], ['Stores', stores], ['Articles', rows.length]]);
  doc.autoTable(Object.assign({}, TSTYLE, { startY: y0,
    head: [['Store', 'Request No', 'Item code', 'Item', 'Qty', 'UOM', 'Requested on', 'Days', 'Earlier slips']],
    body: rows.sort((a, b) => byStore(a.Store, b.Store)).map(r => [r.Store, r['Request No'], r['Item code'], r.Item, r.Qty, r.UOM, r['Requested on'], r['Days pending'], r['Earlier slips']]),
    columnStyles: { 0: { fontStyle: 'bold' }, 7: { halign: 'center', textColor: [142, 27, 42], fontStyle: 'bold' } } }));
  pdfSign(doc); pdfFoot(doc, 'Pending'); pdfSave(doc, 'Pending-' + today() + '.pdf');
}

/* ---------------- tasks ---------------- */
const BUILTIN_TASKS = [
  ['count', 'Daily Count Cycle', 'Count 20 random articles'],
  ['stock', 'Upload fresh stock', 'CUIMS stock report'],
  ['requests', "Upload today's requests", 'Requests sheet'],
  ['backup', 'Cloud backup', 'Back up to Google Drive']
];
function taskList() { return BUILTIN_TASKS.concat((S.customTasks || []).map(t => [t.id, t.title, 'Your task'])); }
function autoDone(id, d) {
  if (id === 'count') return (S.counts || []).some(c => c.date === d && c.status === 'done');
  if (id === 'stock') return !!(S.stockAt && isoOf(new Date(S.stockAt)) === d);
  if (id === 'requests') return S.lines.some(l => l.date === d);
  if (id === 'backup') return !!(S.sync.at && isoOf(new Date(S.sync.at)) === d);
  return false;
}
function taskStatus(id, d) {
  const m = ((S.taskLog || {})[d] || {})[id];
  if (m && m.status === 'done') return 'done';
  if (m && m.status === 'skip') return 'skip';
  if (autoDone(id, d)) return 'done';
  return d < today() ? 'notdone' : 'pending';
}
const TSTAT = { done: ['Done', 'c-ok'], pending: ['Pending', 'c-gd'], notdone: ['Not done', 'c-no'], skip: ['Skipped', 'c-gy'] };
function tasksCard() {
  const d = today(), L = taskList();
  const done = L.filter(t => taskStatus(t[0], d) === 'done').length;
  const open = !!(S.uiPrefs || {}).tasksOpen;
  let h = '<div class="card taskcard" style="overflow:hidden"><div class="row" style="padding:14px 12px 10px 18px"><button class="tmain thead" data-a="tasksTog" aria-expanded="' + open + '"><b class="ttl">Today\'s tasks</b><span>' + done + ' of ' + L.length + ' done' + (done === L.length ? ' · all clear' : '') + '</span></button><button class="btn sm ghost" data-a="taskLog">Log</button><button class="xbtn" data-a="tasksTog" aria-label="' + (open ? 'Collapse' : 'Expand') + ' tasks">' + ico(open ? 'up' : 'down', 18) + '</button></div>';
  h += '<div class="bar" style="margin:0 18px ' + (open ? '6px' : '16px') + '"><div style="width:' + Math.round(done / L.length * 100) + '%;background:linear-gradient(90deg,#10B981,#34D399)"></div></div>';
  if (!open) return h + '</div>';
  L.forEach(([id, title, sub]) => {
    const st = taskStatus(id, d);
    h += '<div class="line" style="flex-direction:row;align-items:center;gap:12px"><button class="tcheck' + (st === 'done' ? ' on' : '') + '" data-a="taskTog" data-v="' + esc(id) + '" aria-label="Mark ' + esc(title) + ' done">' + (st === 'done' ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '') + '</button>' +
      '<button class="tmain" data-a="taskOpen" data-v="' + esc(id) + '"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></button>' + pill(TSTAT[st][0], TSTAT[st][1]) + '</div>';
  });
  return h + '</div>';
}
function vTaskLog() {
  const L = taskList();
  const daysSet = new Set(Object.keys(S.taskLog || {})); (S.counts || []).forEach(c => daysSet.add(c.date)); daysSet.add(today());
  const ds = [...daysSet].sort().reverse().slice(0, 60);
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Task log</h1><div class="sub">Every day, every task: done, pending or not done.</div></div></header><main>';
  h += '<div class="card pad col"><b>Add your own daily task</b><div class="grid2"><input type="text" data-tk="new" value="' + esc(ui.newTask || '') + '" placeholder="e.g. Check expiry dates"><button class="btn" data-a="taskAdd">Add task</button></div>' +
    ((S.customTasks || []).length ? (S.customTasks.map(t => '<div class="row" style="padding:4px 0"><span>' + esc(t.title) + '</span><button class="xbtn" data-a="taskDel" data-v="' + esc(t.id) + '" aria-label="Delete task">' + ico('x', 16) + '</button></div>').join('')) : '') + '</div>';
  ds.forEach(d => {
    const done = L.filter(t => taskStatus(t[0], d) === 'done').length;
    h += '<div class="card" style="overflow:hidden"><div class="pad row" style="padding-bottom:6px"><b>' + fmtLong(d) + (d === today() ? ' · Today' : '') + '</b>' + pill(done + ' of ' + L.length, done === L.length ? 'c-ok' : d < today() ? 'c-no' : 'c-gd') + '</div>' +
      L.map(([id, title]) => { const st = taskStatus(id, d), m = ((S.taskLog || {})[d] || {})[id];
        return '<div class="line" style="flex-direction:row;align-items:center;justify-content:space-between;padding:10px 18px"><span>' + esc(title) + (m && m.at ? '<div class="meta"><span>' + fmtDT(m.at) + (m.by ? ' · ' + esc(m.by) : '') + '</span></div>' : '') + '</span>' + pill(TSTAT[st][0], TSTAT[st][1]) + '</div>'; }).join('') + '</div>';
  });
  return h + '</main>';
}

/* ---------------- Daily Count Cycle ---------------- */
function seededPick(arr, n, seed) {
  let x = 0; for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const COUNT_EXCL = { prefixes: ['VEG-'], words: ['CYLINDER', 'LPG', 'GAS', 'MILK', 'CURD', 'DAHI', 'PANEER', 'BUTTER', 'CHEESE', 'CREAM', 'GHEE', 'YOGURT', 'YOGHURT', 'KHOYA', 'LASSI', 'CHAACH', 'CHHACH'] };
function countExcl() { S.countExcl = S.countExcl || JSON.parse(JSON.stringify(COUNT_EXCL)); return S.countExcl; }
function excluded(code) {
  const ex = countExcl(), c = String(code).toUpperCase(), n = String((S.stock[code] || {}).name || '').toUpperCase();
  return ex.prefixes.some(p => p && c.startsWith(p.toUpperCase())) || ex.words.some(w => w && new RegExp('\\b' + w.toUpperCase().replace(/[^A-Z0-9 ]/g, '') + '\\b').test(n));
}
function todayCount(create) {
  S.counts = S.counts || [];
  let c = S.counts.find(x => x.date === today() && x.status !== 'void');
  if (c && c.status === 'open' && c.items.every(i => i.physical === '' || i.physical == null) && c.items.some(i => excluded(i.code))) { S.counts = S.counts.filter(x => x !== c); c = null; create = true; }
  if (!c && create) {
    const recent = new Set(S.counts.filter(x => days(x.date) < 7).flatMap(x => x.items.map(i => i.code)));
    let pool = Object.keys(S.stock).filter(k => S.stock[k].qty > 0 && !recent.has(k) && !excluded(k));
    if (pool.length < 20) pool = Object.keys(S.stock).filter(k => S.stock[k].qty > 0 && !excluded(k));
    if (!pool.length) { toast('Upload a stock report first.'); return null; }
    const pick = seededPick(pool.sort(), 20, today() + '|' + (S.counts.length));
    c = { id: nid(), date: today(), status: 'open', startedAt: new Date().toISOString(), by: meTag(), stockAt: S.stockAt,
      items: pick.map(k => ({ code: k, name: S.stock[k].name, uom: S.stock[k].uom, system: S.stock[k].qty, physical: '' })) };
    S.counts.push(c); save();
  }
  return c;
}
function diffOf(i) { if (i.physical === '' || i.physical == null || isNaN(parseFloat(i.physical))) return null; return Math.round((parseFloat(i.physical) - i.system) * 1000) / 1000; }
function countSummary(c) { let m = 0, ex = 0, sh = 0, left = 0; c.items.forEach(i => { const d = diffOf(i); if (d === null) left++; else if (d === 0) m++; else if (d > 0) ex++; else sh++; }); return { m, ex, sh, left }; }
function vCount() {
  const c = (S.counts || []).find(x => String(x.id) === String(ui.countId)) || todayCount(false);
  if (!c) { ui.view = null; return vHome(); }
  const sm = countSummary(c), open = c.status === 'open';
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Daily Count Cycle</h1><div class="sub">' + fmtLong(c.date) + ' · ' + c.items.length + ' random articles · system stock from ' + (c.stockAt ? fmtDT(c.stockAt) : '–') + '</div></div></header><main>';
  h += '<div class="grid3"><div class="tile t-ok"><b>' + sm.m + '</b><span>Match</span></div><div class="tile t-in"><b>' + sm.ex + '</b><span>Excess</span></div><div class="tile t-no"><b>' + sm.sh + '</b><span>Short</span></div></div>';
  h += meta([sm.left ? sm.left + ' still to count' : 'All counted', c.status === 'done' ? 'Finished ' + fmtDT(c.doneAt) : 'In progress']);
  h += '<div class="card" style="overflow:hidden">';
  c.items.forEach((i, idx) => {
    const d = diffOf(i);
    const tag = d === null ? '' : d === 0 ? pill('Match', 'c-ok') : d > 0 ? pill('Excess +' + num(d), 'c-in') : pill('Short ' + num(d), 'c-no');
    const V = i.variants || [];
    h += '<div class="line"><div class="row"><b>' + (idx + 1) + '. ' + esc(i.name) + '</b>' + tag + '</div><div class="row" style="align-items:center">' + meta([esc(i.code), 'System ' + num(i.system) + ' ' + esc(i.uom)]) +
      (open && !V.length ? '<input type="number" inputmode="decimal" data-cnt="' + idx + '" value="' + esc(i.physical) + '" placeholder="Physical" style="width:120px;text-align:right">' : '<b class="qty">' + (i.physical === '' ? '–' : num(i.physical)) + ' ' + esc(i.uom) + '</b>') + '</div>' +
      (V.length ? '<div class="vbox">' + V.map((v, k) => { const dl = v.exp ? days(v.exp) * -1 : null;
        return '<div class="vrow"><div class="vhead"><b>Batch ' + (k + 1) + '</b>' + (v.exp ? pill(dl < 0 ? 'Expired' : dl + ' days left', dl < 0 ? 'c-no' : dl <= 15 ? 'c-no' : dl <= expDays() ? 'c-gd' : 'c-ok') : '') + '<button class="xbtn" data-a="varDel" data-v="' + idx + '|' + k + '" aria-label="Remove batch">' + ico('x', 16) + '</button></div>' +
          '<div class="grid3"><label class="f">Qty<input type="number" inputmode="decimal" data-var="' + idx + '|' + k + '|qty" value="' + esc(v.qty) + '"></label><label class="f">MFD<input type="date" data-var="' + idx + '|' + k + '|mfd" value="' + esc(v.mfd || '') + '"></label><label class="f">Expiry<input type="date" data-var="' + idx + '|' + k + '|exp" value="' + esc(v.exp || '') + '"></label></div></div>'; }).join('') + '<div class="note">Physical count = total of all batches.</div></div>' : '') +
      '<button class="btn sm ghost" data-a="varAdd" data-v="' + idx + '" style="align-self:flex-start">+ Add batch (MFD / expiry)</button></div>';
  });
  h += '</div>';
  if (open) h += '<button class="btn main full" data-a="countDone"' + (sm.left ? ' disabled' : '') + '>' + (sm.left ? 'Count all ' + sm.left + ' remaining to finish' : 'Finish count') + '</button>';
  h += '<div class="grid2"><button class="btn" data-a="countExport" data-v="' + c.id + '">Download</button><button class="btn" data-a="countLog">Count history</button></div>';
  const ex = countExcl(), none = c.items.every(i => i.physical === '' || i.physical == null);
  h += '<div class="card pad col"><h3>Not counted in this cycle</h3><div class="note">Items whose code starts with these, or whose name contains these words, are never picked.</div>' +
    '<label class="f">Code starts with (comma separated)<input type="text" data-cx="prefixes" value="' + esc(ex.prefixes.join(', ')) + '"></label>' +
    '<label class="f">Name contains (comma separated)<input type="text" data-cx="words" value="' + esc(ex.words.join(', ')) + '"></label>' +
    (open && none ? '<button class="btn" data-a="countRepick">Pick a new list with these rules</button>' : '') + '</div>';
  return h + '</main>';
}
function expDays() { return S.expiryDays || 45; }
function curCount() { return (S.counts || []).find(x => String(x.id) === String(ui.countId)); }
function syncPhysical(it) { if (it.variants && it.variants.length) { const t = it.variants.reduce((n, v) => n + (parseFloat(v.qty) || 0), 0); it.physical = String(Math.round(t * 1000) / 1000); } }
function expiryRows() {
  const latest = {};
  (S.counts || []).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(c => c.items.forEach(i => { if (i.variants && i.variants.length) latest[i.code] = { c, i }; }));
  const out = [];
  Object.values(latest).forEach(({ c, i }) => i.variants.forEach((v, k) => { if (!v.exp || v.cleared) return; const left = -days(v.exp);
    out.push({ code: i.code, name: i.name, uom: i.uom, qty: v.qty, mfd: v.mfd, exp: v.exp, left, countDate: c.date, cid: c.id, idx: c.items.indexOf(i), k }); }));
  return out.sort((a, b) => a.left - b.left);
}
function vExpiry() {
  const all = expiryRows(), lim = expDays();
  const due = all.filter(r => r.left <= lim);
  const expd = due.filter(r => r.left < 0), soon = due.filter(r => r.left >= 0 && r.left <= 15), later = due.filter(r => r.left > 15);
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Expiry Tracker</h1><div class="sub">Batches from your Daily Count Cycle expiring within ' + lim + ' days.</div></div></header><main>';
  h += '<div class="grid3"><div class="tile t-no"><b>' + expd.length + '</b><span>Expired</span></div><div class="tile t-pt"><b>' + soon.length + '</b><span>Within 15 days</span></div><div class="tile t-in"><b>' + later.length + '</b><span>16 to ' + lim + ' days</span></div></div>';
  h += '<div class="grid2"><label class="f">Alert window (days)<input type="number" inputmode="numeric" data-expdays="1" value="' + lim + '"></label><button class="btn" data-a="expExport" style="align-self:end">Download</button></div>';
  const sec = (title, list, cls) => { if (!list.length) return ''; let x = '<div class="sect">' + title + '</div><div class="card" style="overflow:hidden">';
    list.forEach(r => { x += '<div class="line"><div class="row"><b>' + esc(r.name) + '</b>' + pill(r.left < 0 ? 'Expired ' + (-r.left) + ' d ago' : r.left === 0 ? 'Expires today' : r.left + ' days left', cls) + '</div>' +
      '<div class="row" style="align-items:center">' + meta([esc(r.code), num(r.qty) + ' ' + esc(r.uom), r.mfd ? 'MFD ' + fmtShort(r.mfd) : '', 'EXP ' + fmtLong(r.exp)]) + '<button class="btn sm ghost" data-a="expClear" data-v="' + r.cid + '|' + r.idx + '|' + r.k + '">Cleared</button></div>' +
      '<div class="meta"><span>Counted ' + fmtShort(r.countDate) + '</span></div></div>'; });
    return x + '</div>'; };
  if (!due.length) h += '<div class="card pad note">Nothing expiring within ' + lim + ' days. Add batches with expiry dates in the Daily Count Cycle.</div>';
  h += sec('Expired', expd, 'c-no') + sec('Within 15 days', soon, 'c-no') + sec('16 to ' + lim + ' days', later, 'c-gd');
  return h + '</main>';
}
function doneRows() {
  return doneData().map(({ r, slips, left }) => ({ 'Request No': r.req, Store: r.store, 'Requested on': fmtLong(r.date), Slips: slips.map(e => e.slip), Serials: slips.map(e => e.serial || '–'), Status: left.length ? 'Partly done' : 'Fully done', 'Pending articles': left.map(l => itemName(l.code) + ' (' + l.code + ') ' + num(l.qty) + ' ' + itemUom(l.code)) }));
}
function doneData() {
  const f = fltGet('done');
  let R = requests().filter(r => r.lines.some(l => l.status === 'issued') && reqMatch(r, f));
  R = sortBy(R, getSort('done'), r => ({ req: r.req, store: r.store, date: r.date, ready: r.lines.filter(l => l.status === 'waiting').length, size: r.lines.length }));
  return R.map(r => { const slips = S.entries.filter(e => e.items.some(i => i.req === r.req) && (!f.id || entryDate(e) === f.id)); return { r, slips, left: r.lines.filter(l => l.status === 'waiting'), issued: r.lines.filter(l => l.status === 'issued').length, total: r.lines.filter(l => l.status !== 'dropped').length }; });
}
function vDone() {
  const D = doneData();
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Done list</h1><div class="sub">Requests entered on CUIMS, with Slip and Serial. Use it to mark your paper.</div></div></header><main>';
  h += fltBar('done', true) + '<div class="row" style="justify-content:flex-end">' + sortPick('done') + '</div>';
  const full = D.filter(x => !x.left.length).length;
  h += '<div class="grid3"><div class="tile t-in"><b>' + D.length + '</b><span>Requests</span></div><div class="tile t-ok"><b>' + full + '</b><span>Fully done</span></div><div class="tile t-pt"><b>' + (D.length - full) + '</b><span>Partly done</span></div></div>';
  if (!D.length) h += '<div class="card pad note">Nothing done for these dates.</div>';
  D.forEach(({ r, slips, left, issued, total }) => {
    h += rqCard({ where: 'done', req: r.req, store: r.store, status: left.length ? [left.length + ' left', 'c-gd'] : ['Completed', 'c-ok'], meta: ['requested ' + fmtShort(r.date), issued + ' of ' + total + ' issued'], slips, left });
  });
  if (D.length) h += '<button class="btn" data-a="doneExport">Download done list</button>';
  return h + '</main>';
}
function vCountLog() {
  const L = (S.counts || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Count history</h1><div class="sub">Every Daily Count Cycle with its differences.</div></div></header><main>';
  if (!L.length) h += '<div class="card pad note">No counts yet. Start today\'s count from Tasks.</div>';
  L.forEach(c => { const sm = countSummary(c);
    h += '<button class="card pad tap col" style="gap:6px" data-a="countOpen" data-v="' + c.id + '"><div class="row"><b class="ttl">' + fmtLong(c.date) + '</b>' + (c.status === 'done' ? pill('Done', 'c-ok') : c.date < today() ? pill('Not finished', 'c-no') : pill('In progress', 'c-gd')) + '</div>' +
      meta([sm.m + ' match', sm.ex + ' excess', sm.sh + ' short', sm.left ? sm.left + ' not counted' : '', c.by && c.by.name ? esc(c.by.name) : '']) + '</button>'; });
  if (L.length) h += '<button class="btn" data-a="countExportAll">Download all counts</button>';
  return h + '</main>';
}
function countRows(list) {
  const rows = []; list.forEach(c => c.items.forEach(i => { const d = diffOf(i); rows.push({ Date: fmtLong(c.date), Code: i.code, Item: i.name, UOM: i.uom, System: i.system, Physical: i.physical === '' ? '' : Number(i.physical), Difference: d === null ? '' : d, Result: d === null ? 'Not counted' : d === 0 ? 'Match' : d > 0 ? 'Excess' : 'Short', Batches: (i.variants || []).map(v => num(v.qty) + (v.mfd ? ' MFD ' + fmtShort(v.mfd) : '') + (v.exp ? ' EXP ' + fmtShort(v.exp) : '')), Status: c.status === 'done' ? 'Done' : 'Open', 'Counted by': (c.by || {}).name || '' }); }));
  return rows;
}

/* ---------------- side drawer ---------------- */
function renderDrawer() {
  let el = document.getElementById('drawer'); if (!el) { el = document.createElement('div'); el.id = 'drawer'; document.body.appendChild(el); }
  if (!ui.drawer) { el.innerHTML = ''; return; }
  const item = (a, label, sub, d, v) => '<button class="ditem" data-a="' + a + '"' + (v ? ' data-v="' + v + '"' : '') + '><span class="dic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg></span><span><b>' + label + '</b><span>' + sub + '</span></span></button>';
  el.innerHTML = '<div class="dbg" data-a="drawerClose"></div><aside class="dpanel" role="dialog" aria-label="Menu"><div class="dhead"><img src="icon.png" alt=""><div><b>JV Stock Issue</b><span>Built by ' + esc(S.me.builder || S.me.name || 'JV') + '</span></div></div>' +
    '<div class="dsect">Tools</div>' +
    item('dCount', 'Daily Count Cycle', '20 random articles, physical vs system', '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>') +
    item('expOpen', 'Expiry Tracker', 'Batches expiring within ' + expDays() + ' days', '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>') +
    item('doneOpen', 'Done list', 'Slips, serials and articles still left', '<path d="M4 12l5 5L20 6"/>') +
    item('newReq', 'Add store request', 'Type a request directly in the app', '<path d="M12 5v14M5 12h14"/>') +
    item('batchReq', 'Batch add requests', 'Many stores at once, or paste from Excel', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>') +
    item('stockOpen', 'Live stock search', 'Find any item, see needed and free qty', '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>') +
    item('consOpen', 'Store-wise consumption', 'What each store took, by week or month', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>') +
    item('artsOpen', 'Pending articles', 'Edit qty, hold or remove, one or many', '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/>') +
    item('dcOpen', 'Data check', 'Find clashes and errors, fix on the spot', '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M9 12l2 2 4-4"/>') +
    item('testToggle', S.testMode ? 'Leave Test mode' : 'Test mode', S.testMode ? 'Back to your real data' : 'Try things without touching real data', '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>') +
    item('countLog', 'Count history', 'All past counts and differences', '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>') +
    item('taskLog', 'Task log', 'Daily tasks: done, pending, not done', '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>') +
    '<div class="dsect">Work</div>' +
    item('dUpload', 'Upload', 'Requests, earlier pending, stock', '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>') +
    item('dBulk', 'Edit all requests', 'Slip No, Request No, date, receiver', '<path d="M4 20h4L19 9l-4-4L4 16z"/>') +
    item('dSite', 'Issue CUIMS', 'Your emp ID', '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>') +
    item('dMgr', 'Live stock', 'Manager CUIMS', '<path d="M3 12h4l3 7 4-14 3 7h4"/>') +
    '<div class="dsect">Data</div>' +
    item('dBackup', 'Cloud backups', 'Restore, keep, delete', '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>') +
    item('dData', 'Downloads', 'Excel and PDF reports', '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>') +
    '</aside>';
}

/* ---------------- export preview + settings ---------------- */
const REPORTS = {
  issue: { name: 'Daily Issue Register', pdf: true, landscape: true, dated: 'reg', details: true, sorts: true },
  ret: { name: 'Daily Return Register', pdf: true, landscape: false, dated: 'reg', details: true, sorts: true },
  pending: { name: 'Pending Report', pdf: true, landscape: true, sorts: true },
  requests: { name: 'Requests Register' }, entries: { name: 'Entries Log' }, items: { name: 'Entry Items' },
  stock: { name: 'Stock Now' }, returns: { name: 'Returns (all)' }, search: { name: 'Search Results' }, counts: { name: 'Daily Count Cycle', pdf: true, landscape: true }, expiry: { name: 'Expiry Tracker', pdf: true, landscape: false }, done: { name: 'Done List', pdf: true, landscape: false }, cons: { name: 'Store-wise Consumption', pdf: true, landscape: false }
};
function rptPref(type) {
  S.rp = S.rp || {};
  const R = REPORTS[type];
  const d = { title: R.name, sub: S.me.storeName || '', orient: R.landscape ? 'l' : 'p', font: 'n', details: !!R.details && type === 'ret', sign: true, mgr: S.mgr.on, sort: 'reqdate', cols: {} };
  const p = S.rp[type] = S.rp[type] || {};
  for (const k in d) if (!(k in p)) p[k] = d[k];
  return p;
}
function sortStores(arr, key, how) { return arr.sort((a, b) => how === 'az' ? String(a[key]).localeCompare(String(b[key])) : byStore(a[key], b[key])); }
function reportDef(type) {
  const p = rptPref(type), d = ui.reg.date;
  if (type === 'issue') {
    const list = regEntries(), F = fltGet('reg');
    let G = sortBy(issueGroups(list), ['custom', 'az', 'time'].includes(p.sort) ? 'reqdate' : p.sort, g => ({ req: g.req, store: g.store, date: reqDateOfRaw(g.req), size: g.items.length }));
    return { cols: [['no', '#'], ['req', 'Request No'], ['rdate', 'Requisition Requested Date'], ['store', 'Store'], ['to', 'Issued to'], ['slips', 'Slip No'], ['serials', 'Serial No'], ['times', 'Time'], ['items', 'Items'], ['remarks', 'Remarks'], ['by', 'Entered by']],
      rows: G.map((g, i) => ({ no: i + 1, req: g.req || '–', rdate: reqDateOf(g.req), store: g.store, to: [...g.to], slips: g.slips.map(x => x.slip), serials: g.slips.map(x => x.serial || '______'), times: g.slips.map(x => x.time), items: g.count || g.items.length, remarks: [...g.remarks].join(', ') || '–', by: [...g.by] })),
      chips: [].concat(F.id ? [['Issue date', fmtLong(F.id)]] : []).concat(F.rd ? [['Request date', fmtLong(F.rd)]] : []).concat([['Requests', G.length], ['Items', list.reduce((n, e) => n + e.items.length, 0)]]),
      detail: G.map(g => ({ head: 'Request ' + (g.req || '–') + '   ·   ' + g.store + '   ·   ' + [...g.to].join(', ') + '   ·   Slips ' + g.slips.map(x => x.slip + (x.serial ? ' #' + x.serial : '')).join(', '),
        cols: ['S.No', 'Slip No', 'Item code', 'Item', 'UOM', 'Qty', 'Item remarks'], rows: g.items.map((x, i) => [i + 1, x.slip, x.code, x.name || itemName(x.code), x.uom || itemUom(x.code), num(x.qty), x.remark || '–']) })),
      file: 'Issue-Register-' + d, sub2: 'Issue · Department · Offline · HOSTEL MESS (GA)' };
  }
  if (type === 'ret') {
    let list = S.returns.filter(x => x.date === d);
    list = sortBy(list, ['custom', 'az', 'time'].includes(p.sort) ? 'reqdate' : p.sort, r => ({ req: r.no, store: r.store, date: r.date + ' ' + (r.time || ''), size: r.items.length }));
    return { cols: [['no', '#'], ['rno', 'Return No'], ['store', 'Store'], ['by', 'Returned by'], ['dt', 'Date & time'], ['against', 'Against'], ['serial', 'Serial No'], ['items', 'Items'], ['remarks', 'Remarks'], ['ent', 'Entered by']],
      rows: list.map((r, i) => ({ no: i + 1, rno: r.no, store: r.store, by: ['GA' + r.by].concat(r.byName ? [r.byName] : []), dt: fmtShort(r.date) + ' ' + (r.time || ''), against: r.against, serial: r.serial || '______', items: r.items.length, remarks: r.remarks || '–', ent: [(r.enteredBy || {}).name || ''].concat((r.enteredBy || {}).emp ? [r.enteredBy.emp] : []) })),
      chips: [['Date', fmtLong(d)], ['Returns', list.length], ['Items', list.reduce((n, r) => n + r.items.length, 0)]],
      detail: list.map(r => ({ head: r.no + '   ·   ' + r.store + '   ·   Returned by GA' + r.by + '   ·   Serial ' + (r.serial || '____'), cols: ['S.No', 'Item code', 'Item', 'UOM', 'Qty', 'Item remarks'], rows: r.items.map((x, i) => [i + 1, x.code, x.name || itemName(x.code), x.uom || itemUom(x.code), num(x.qty), x.remark || '–']) })),
      file: 'Return-Register-' + d, sub2: 'Return · Department · Against Issue No 1111' };
  }
  const objRows = type === 'pending' ? sortBy(rowsPending(), ['custom', 'az', 'time'].includes(p.sort) ? 'reqdate' : p.sort, r => ({ req: r['Request No'], store: r.Store, date: r['_date'] || '' })) : type === 'requests' ? rowsRequests() : type === 'entries' ? rowsEntries() : type === 'items' ? rowsItems() : type === 'stock' ? rowsStock() : type === 'returns' ? rowsReturns() : type === 'search' ? searchRows() : type === 'cons' ? consRows() : type === 'done' ? doneRows() : type === 'expiry' ? expiryRows().filter(r => r.left <= expDays()).map(r => ({ Item: r.name, Code: r.code, Qty: r.qty, UOM: r.uom, MFD: r.mfd ? fmtLong(r.mfd) : '', Expiry: fmtLong(r.exp), 'Days left': r.left, Status: r.left < 0 ? 'Expired' : r.left <= 15 ? 'Within 15 days' : 'Within ' + expDays() + ' days', 'Counted on': fmtLong(r.countDate) })) : type === 'counts' ? countRows((S.counts || []).filter(c => !ui.countExportId || String(c.id) === String(ui.countExportId))) : [];
  const keys = objRows.length ? Object.keys(objRows[0]) : [];
  const chips = type === 'pending' ? [['Date', fmtLong(today())], ['Stores', new Set(objRows.map(r => r.Store)).size], ['Articles', objRows.length]] : [['Date', fmtLong(today())], ['Rows', objRows.length]];
  return { cols: keys.map(k => [k, k]), rows: objRows, chips, file: REPORTS[type].name.replace(/[^A-Za-z]+/g, '-') + '-' + today(), sub2: '' };
}
function reqDateOfRaw(req) { const l = S.lines.find(x => x.req === req); return l ? l.date : ''; }
function reqDateOf(req) {
  if (!req) return '–';
  const ds = [...new Set(S.lines.filter(l => l.req === req).map(l => l.date))].sort();
  return ds.length ? ds.map(fmtLong) : '–';
}
function searchRows() { const rows = []; searchRecords().forEach(x => x.items.forEach(i => rows.push({ Type: x.type, Date: x.date ? fmtLong(x.date) : '', Time: x.time || '', 'Slip / Return No': x.no, 'Serial No': x.serial, Store: x.store, 'Issued to / Returned by': x.who, 'Request / Against': x.reqs, 'Item code': i.code, Item: i.name || itemName(i.code), Qty: Number(i.qty), UOM: i.uom || '', 'Item remark': i.remark || '', 'Entered by': x.by.name || '', 'Emp code': x.by.emp || '' }))); return rows; }
function colOn(p, k) { return p.cols[k] !== false; }
function orderedCols(p, D) { const o = p.order || []; return D.cols.slice().sort((a, b) => { const i = o.indexOf(a[0]), j = o.indexOf(b[0]); return (i < 0 ? 999 + D.cols.indexOf(a) : i) - (j < 0 ? 999 + D.cols.indexOf(b) : j); }); }
function cellText(v, sep) { return Array.isArray(v) ? v.join(sep) : v == null ? '' : String(v); }
function openExport(type) { rptPref(type); ui.sheet = { kind: 'export', type }; renderSheet(); }
function shExport() {
  const type = ui.sheet.type, R = REPORTS[type], p = rptPref(type), D = reportDef(type);
  const all = orderedCols(p, D), cols = all.filter(c => colOn(p, c[0]));
  let h = '<div class="row"><h2>' + esc(R.name) + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="note">Your choices are saved for next time.</div>';
  h += '<div class="card pad col"><h3>Basics</h3><label class="f">Title<input type="text" data-rp="title" value="' + esc(p.title) + '"></label><label class="f">Subtitle (store name)<input type="text" data-rp="sub" value="' + esc(p.sub) + '"></label>' +
    (R.dated ? '<label class="f">Date<input type="date" data-in="regDate" value="' + esc(ui.reg.date) + '"></label>' : '') +
    (R.sorts ? '<label class="f">Order</label>' + pickBtn('rpSort', { title: 'Order', full: true, opts: SORT_OPTS, val: p.sort, set: v => { p.sort = v; save(true); renderSheet(); } }) : '') + '</div>';
  if (R.pdf) {
    h += '<div class="card pad col"><h3>Page</h3><div class="seg">' + [['p', 'A4 Portrait'], ['l', 'A4 Landscape']].map(([v, l]) => '<button data-a="rpSet" data-k="orient" data-v="' + v + '" class="' + (p.orient === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<div class="seg">' + [['s', 'Small text'], ['n', 'Normal'], ['b', 'Large text']].map(([v, l]) => '<button data-a="rpSet" data-k="font" data-v="' + v + '" class="' + (p.font === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      (R.details ? '<label class="chk"><input type="checkbox" data-a="rpTog" data-k="details"' + (p.details ? ' checked' : '') + '> Print item details under each ' + (type === 'issue' ? 'request' : 'return') + '</label>' : '') +
      '<label class="chk"><input type="checkbox" data-a="rpTog" data-k="sign"' + (p.sign ? ' checked' : '') + '> Signature box (Prepared & checked by)</label>' +
      '<label class="chk"><input type="checkbox" data-a="rpTog" data-k="mgr"' + (p.mgr ? ' checked' : '') + '> Manager signature box</label></div>';
  }
  h += '<div class="card" style="overflow:hidden"><div class="pad row"><h3>Columns and order</h3><span class="note">' + cols.length + ' of ' + D.cols.length + ' printed</span></div>' +
    all.map(([k, l], i) => '<div class="line" style="flex-direction:row;align-items:center;gap:8px;padding:8px 14px"><label class="chk" style="min-height:40px;font-size:14.5px;flex:1"><input type="checkbox" data-a="rpCol" data-k="' + esc(k) + '"' + (colOn(p, k) ? ' checked' : '') + '> ' + esc(l) + '</label>' +
      '<button class="xbtn" data-a="rpMove" data-k="' + esc(k) + '" data-d="-1"' + (i ? '' : ' disabled') + ' aria-label="Move up">' + ico('up', 18) + '</button><button class="xbtn" data-a="rpMove" data-k="' + esc(k) + '" data-d="1"' + (i < all.length - 1 ? '' : ' disabled') + ' aria-label="Move down">' + ico('down', 18) + '</button></div>').join('') + '</div>';
  // preview
  const pr = D.rows.slice(0, 8);
  h += '<div class="sect">Preview</div><div class="card" style="overflow:hidden"><div style="background:linear-gradient(160deg,#1B2540,#0B1220);color:#fff;padding:12px 14px;border-bottom:2px solid var(--gold)"><b style="font-size:16px">' + esc(p.title) + '</b><div style="font-size:12px;color:#C9CED6">' + esc([p.sub, D.sub2].filter(Boolean).join(' · ')) + '</div></div>' +
    '<div class="wrap" style="gap:6px;padding:10px 12px">' + D.chips.map(c => pill(c[0] + ' ' + c[1], 'c-gd')).join('') + '</div>' +
    '<div class="tblwrap" style="padding:0 0 6px"><table style="font-size:' + (p.font === 's' ? 12 : p.font === 'b' ? 15 : 13.5) + 'px"><tr>' + cols.map(c => '<th>' + esc(c[1]) + '</th>').join('') + '</tr>' +
    (pr.length ? pr.map(r => '<tr>' + cols.map(c => '<td style="white-space:pre-line">' + esc(cellText(r[c[0]], '\n')) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '" class="note">No data for this selection.</td></tr>') + '</table></div>' +
    (D.rows.length > pr.length ? '<div class="note" style="padding:0 12px 10px">…and ' + (D.rows.length - pr.length) + ' more rows</div>' : '') +
    (R.pdf && p.details && D.detail && D.detail.length ? '<div class="note" style="padding:0 12px 10px">+ item details for ' + D.detail.length + ' ' + (type === 'issue' ? 'requests' : 'returns') + '</div>' : '') +
    (R.pdf && (p.sign || p.mgr) ? '<div class="note" style="padding:0 12px 12px">+ ' + [p.sign ? 'your signature box' : '', p.mgr ? 'manager signature box' : ''].filter(Boolean).join(' and ') + '</div>' : '') + '</div>';
  h += '<div class="grid2">' + (R.pdf ? '<button class="btn main" data-a="rpPdf"' + (D.rows.length && cols.length ? '' : ' disabled') + '>Download PDF</button>' : '') + '<button class="btn' + (R.pdf ? '' : ' main') + '" data-a="rpXlsx"' + (D.rows.length && cols.length ? '' : ' disabled') + '>Download Excel</button></div>';
  return h;
}
function rpPdf(type) { loader(true, 'Making your PDF'); setTimeout(() => { try { rpPdf2(type); } finally { loader(false); } }, 60); }
function rpPdf2(type) {
  const p = rptPref(type), D = reportDef(type), R = REPORTS[type];
  const doc = pdfDoc(p.orient === 'l'); if (!doc) return;
  const fs = p.font === 's' ? 7.5 : p.font === 'b' ? 10 : 8.5;
  const cols = orderedCols(p, D).filter(c => colOn(p, c[0]));
  const y0 = pdfHead(doc, p.title, [p.sub, D.sub2].filter(Boolean).join(' · '), D.chips);
  const st = Object.assign({}, TSTYLE, { styles: Object.assign({}, TSTYLE.styles, { fontSize: fs }), headStyles: Object.assign({}, TSTYLE.headStyles, { fontSize: fs }) });
  doc.autoTable(Object.assign({}, st, { startY: y0, tableWidth: 'auto', pageBreak: 'auto', rowPageBreak: 'avoid', head: [cols.map(c => c[1])], body: D.rows.map(r => cols.map(c => cellText(r[c[0]], '\n'))),
    didParseCell: d => { if (d.section === 'body') { const k = cols[d.column.index][0]; if (/req|store|Store|Request/.test(k)) d.cell.styles.fontStyle = 'bold'; if (/slips|Slip/.test(k)) d.cell.styles.textColor = [30, 58, 138]; if (/serial|Serial/.test(k)) d.cell.styles.textColor = [11, 94, 61]; } } }));
  if (p.details && D.detail) D.detail.forEach(b => {
    doc.autoTable(Object.assign({}, st, { startY: doc.lastAutoTable.finalY + 6, headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: fs }, head: [[{ content: b.head, colSpan: b.cols.length }], b.cols], body: b.rows }));
  });
  if (p.sign || p.mgr) pdfSign(doc, p.sign, p.mgr);
  pdfFoot(doc, R.name); pdfSave(doc, D.file + '.pdf');
}
function rpXlsx(type) { loader(true, 'Making your Excel file'); setTimeout(() => { try { rpXlsx2(type); } finally { loader(false); } }, 60); }
function rpXlsx2(type) {
  const p = rptPref(type), D = reportDef(type), R = REPORTS[type];
  const cols = orderedCols(p, D).filter(c => colOn(p, c[0]));
  const rows = D.rows.map(r => { const o = {}; cols.forEach(c => o[c[1]] = cellText(r[c[0]], ', ')); return o; });
  const sheets = [[R.name.slice(0, 30), rows]];
  if (p.details && D.detail && D.detail.length) { const dr = []; D.detail.forEach(b => b.rows.forEach(x => { const o = { Group: b.head }; b.cols.forEach((c, i) => o[c] = x[i]); dr.push(o); })); sheets.push(['Item details', dr]); }
  saveWb(sheets, D.file + '.xlsx');
}

/* ---------------- Google Sheet sync ---------------- */
async function syncNow(quiet, kind, note) {
  if (!S.sync.url) return;
  if (S.testMode) { if (!quiet) toast('Test mode: cloud backup is paused.'); return; }
  const payload = { action: 'sync', kind: kind || 'auto', note: note || '', counts: { requests: requests().length, articles: S.lines.length, entries: S.entries.length, returns: S.returns.length }, at: new Date().toISOString(), by: meTag(),
    tabs: { 'Requests': rowsRequests(), 'Request lines': rowsAllLines(), 'Entries': rowsEntries(), 'Entry items': rowsItems(), 'Pending': rowsPending(), 'Returns': rowsReturns(), 'Stock': rowsStock(),
      'Stores': Object.entries(S.stores).map(([s, v]) => ({ Store: s, Receiver: v.rcv ? 'GA' + v.rcv : '', Name: v.rname || '' })) },
    backup: JSON.stringify(S) };
  if (syncBusy) return; syncBusy = true; paintSync();
  const startedAt = S.sync.changedAt;
  try {
    if (!navigator.onLine) throw new Error('offline');
    const r = await fetch(S.sync.url, { method: 'POST', body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'failed');
    S.sync.at = new Date().toISOString(); if (S.sync.changedAt === startedAt) { S.sync.dirty = false; S.sync.firstDirty = 0; } syncErr = ''; syncBusy = false; writeLocal(); paintSync();
    if (!quiet) { toast('Backed up to Google Drive and Sheet.'); render(); if (ui.sheet && ui.sheet.kind === 'backups') loadBackups(); }
  } catch (e) { syncBusy = false; syncErr = e.message; paintSync(); if (!quiet) toast(e.message === 'offline' ? 'Offline. Saved on phone; it uploads by itself when internet is back.' : 'Backup failed: ' + e.message + '. It will retry by itself.'); }
}
async function apiGet(q) { const r = await fetch(S.sync.url + (S.sync.url.includes('?') ? '&' : '?') + q); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'failed'); return j; }
async function apiPost(o) { const r = await fetch(S.sync.url, { method: 'POST', body: JSON.stringify(o) }); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'failed'); return j; }
async function loadBackups() {
  ui.sheet = Object.assign(ui.sheet || {}, { kind: 'backups', loading: true, err: '' }); renderSheet();
  try { const j = await apiGet('action=list'); ui.sheet.items = j.items; ui.sheet.folder = j.folder; ui.sheet.sheetUrl = j.sheet; }
  catch (e) { ui.sheet.err = 'Could not load backups: ' + e.message + '. If you just updated Code.gs, deploy it as a New version.'; }
  ui.sheet.loading = false; renderSheet();
}
function nextReqNo() {
  const d = new Date(), pre = pad(d.getDate()) + pad(d.getMonth() + 1) + '-';
  let mx = 0; S.lines.forEach(l => { if (String(l.req).startsWith(pre)) { const n = parseInt(String(l.req).slice(pre.length), 10); if (n > mx) mx = n; } });
  return pre + String(mx + 1).padStart(2, '0');
}
function nrHits() {
  const f = ui.form; const hits = itemHits(f.q, new Set(f.items.map(x => x.code)), 8);
  return String(f.q || '').trim() ? (hits.length ? hits.map(([c, v], k) => '<button class="hit' + (k === 0 ? ' first' : '') + '" data-a="nrPick" data-v="' + esc(c) + '"><span><b>' + esc(v.name) + '</b><span class="mono">' + esc(c) + '</span></span><span class="note">' + num(v.qty) + ' ' + esc(v.uom) + '</span></button>').join('') : '<div class="note">No item matches "' + esc(f.q) + '".</div>') : '';
}
function shNewReq() {
  const f = ui.form, stores = [...new Set([...(S.storeOrder || []), ...Object.keys(S.stores), ...S.lines.map(l => l.store)])].sort(byStore);
  const reqClash = S.lines.some(l => l.req === f.req);
  let h = '<div class="row"><h2>Add store request</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<label class="f">Store</label>' + pickBtn('nrStore', { title: 'Choose store', search: true, full: true, placeholder: 'Choose store', opts: stores.map(st => [st, st, (S.stores[st] || {}).rcv ? 'Receiver GA' + S.stores[st].rcv : '']), val: f.store, set: v => { ui.form.store = v; const d = (S.stores[v] || {}).rcv; if (d) ui.form.rcv = d; renderSheet(); } });
  h += '<div class="grid2"><label class="f">Request No<input type="text" data-nr="req" value="' + esc(f.req) + '" class="mono' + (reqClash ? ' bad' : '') + '"></label><label class="f">Request date<input type="date" data-nr="date" value="' + esc(f.date) + '"></label></div>' + (reqClash ? '<div class="err">Request No ' + esc(f.req) + ' already exists.</div>' : '');
  h += '<div class="grid2"><label class="f">Receiver (6 digits)<input type="text" inputmode="numeric" maxlength="6" data-nr="rcv" value="' + esc(f.rcv) + '" class="mono"></label><label class="f">Slip No (optional)<input type="text" data-nr="slip" value="' + esc(f.slip) + '" class="mono" autocapitalize="characters"></label></div>';
  h += '<label class="f">Custom remark (optional)<input type="text" data-nr="remark" value="' + esc(f.remark || '') + '" placeholder="Replaces Requisition Requested on …"></label>';
  h += '<div class="sect">Articles (' + f.items.length + ')</div>';
  if (f.items.length) h += '<div class="card" style="overflow:hidden">' + f.items.map((it, i) => '<div class="line" style="flex-direction:row;align-items:center;gap:10px"><span style="flex:1;min-width:0"><b>' + esc(it.name) + '</b><div class="meta"><span class="mono">' + esc(it.code) + '</span>' + (S.stock[it.code] ? '<i></i><span>stock ' + num(S.stock[it.code].qty) + '</span>' : '') + '</div></span><input type="number" inputmode="decimal" data-nrq="' + i + '" value="' + esc(it.qty) + '" placeholder="Qty" style="width:92px;text-align:right"><span class="note" style="width:34px">' + esc(it.uom) + '</span><button class="xbtn" data-a="nrDel" data-v="' + i + '" aria-label="Remove">' + ico('x', 16) + '</button></div>').join('') + '</div>';
  h += '<div class="card pad col" style="gap:8px"><label class="f">Find item by name or code<input type="search" data-nr="q" value="' + esc(f.q || '') + '" placeholder="Type e.g. atta, sugar, GR-198" autocomplete="off" enterkeyhint="done"></label>';
  h += '<div id="nrhits">' + nrHits() + '</div>';
  h += '</div>';
  const ok = f.store && f.req && !reqClash && f.items.length && f.items.every(x => parseFloat(x.qty) > 0) && (!f.rcv || /^\d{6}$/.test(f.rcv)) && (!f.slip || !slipProblem(f.slip));
  if (f.slip && slipProblem(f.slip)) h += '<div class="err">' + esc(slipProblem(f.slip)) + '</div>';
  h += '<button class="btn main full" data-a="nrSave"' + (ok ? '' : ' disabled') + '>Save request · ' + f.items.length + ' articles</button>';
  return h;
}
function allStores() { return [...new Set([...(S.storeOrder || []), ...Object.keys(S.stores), ...S.lines.map(l => l.store), ...(S.areas || [])].filter(Boolean))].sort(byStore); }
function nextReqNoFrom(used) {
  const d = new Date(), pre = pad(d.getDate()) + pad(d.getMonth() + 1) + '-';
  let mx = 0; S.lines.concat(used.map(r => ({ req: r }))).forEach(l => { if (String(l.req).startsWith(pre)) { const n = parseInt(String(l.req).slice(pre.length), 10); if (n > mx) mx = n; } });
  return pre + String(mx + 1).padStart(2, '0');
}
function batchAddGroup(store) {
  const f = ui.form; const req = nextReqNoFrom(f.groups.map(g => g.req));
  let slip = ''; if (f.slipStart) { const m = String(f.slipStart).toUpperCase().match(/^(.*?)(\d+)$/); if (m) { const used = allSlips(); f.groups.forEach(g => used.add(g.slip)); let n = parseInt(m[2], 10); do { slip = m[1] + String(n).padStart(m[2].length, '0'); n++; } while (used.has(slip)); } }
  f.groups.push({ store, req, rcv: (S.stores[store] || {}).rcv || '', slip, remark: '', items: [] }); f.act = f.groups.length - 1;
}
function itemHits(q, have, n) {
  q = String(q || '').trim().toUpperCase(); if (q.length < 1) return [];
  const words = q.split(/\s+/);
  return Object.entries(S.stock).filter(([c, v]) => !have.has(c) && words.every(w => c.includes(w) || String(v.name).toUpperCase().includes(w)))
    .sort((a, b) => (a[0] === q ? -2 : 0) - (b[0] === q ? -2 : 0) || (String(a[1].name).toUpperCase().startsWith(q) ? 0 : 1) - (String(b[1].name).toUpperCase().startsWith(q) ? 0 : 1) || String(a[1].name).localeCompare(String(b[1].name))).slice(0, n || 6);
}
function batchHits(gi) {
  const f = ui.form, g = f.groups[gi];
  const hits = itemHits(f.q, new Set(g.items.map(x => x.code)), 6);
  return String(f.q || '').trim() ? (hits.length ? hits.map(([c, v], k) => '<button class="hit' + (k === 0 ? ' first' : '') + '" data-a="btPick" data-v="' + esc(c) + '"><span><b>' + esc(v.name) + '</b><span class="mono">' + esc(c) + '</span></span><span class="note">' + num(v.qty) + ' ' + esc(v.uom) + '</span></button>').join('') : '<div class="note">No match in the stock sheet.</div>') : '';
}
function shBatch() {
  const f = ui.form, stores = allStores();
  let h = '<div class="row"><h2>Batch add requests</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="grid2"><label class="f">Request date<input type="date" data-bt="date" value="' + esc(f.date) + '"></label><label class="f">First Slip No<input type="text" data-bt="slipStart" value="' + esc(f.slipStart || '') + '" class="mono" placeholder="optional, e.g. JV/1042" autocapitalize="characters"></label></div>';
  f.groups.forEach((g, gi) => {
    const act = f.act === gi;
    if (!act) { h += '<button class="card bmini" data-a="btAct" data-v="' + gi + '"><span class="reqno">' + esc(g.req) + '</span><b>' + esc(g.store) + '</b><span class="note">' + g.items.length + ' articles' + (g.items.some(x => !(parseFloat(x.qty) > 0)) ? ' · qty missing' : '') + '</span>' + ico('down', 18) + '</button>'; return; }
    h += '<div class="card bgroup act" style="overflow:hidden"><div class="pad col" style="gap:10px"><div class="row"><span class="reqno">' + esc(g.req) + '</span><button class="xbtn" data-a="btDel" data-v="' + gi + '" aria-label="Remove store">' + ico('x', 16) + '</button></div><b class="ttl">' + esc(g.store) + '</b>' +
      '<div class="grid3"><label class="f">Request No<input type="text" data-bg="' + gi + '|req" value="' + esc(g.req) + '" class="mono"></label><label class="f">Receiver<input type="text" inputmode="numeric" maxlength="6" data-bg="' + gi + '|rcv" value="' + esc(g.rcv) + '" class="mono"></label><label class="f">Slip No<input type="text" data-bg="' + gi + '|slip" value="' + esc(g.slip) + '" class="mono" autocapitalize="characters"></label></div>' +
      '<label class="f">Custom remark (optional)<input type="text" data-bg="' + gi + '|remark" value="' + esc(g.remark) + '"></label></div>' +
      g.items.map((it, ii) => '<div class="line" style="flex-direction:row;align-items:center;gap:10px"><span style="flex:1;min-width:0"><b>' + esc(it.name) + '</b><div class="meta"><span class="mono">' + esc(it.code) + '</span>' + (S.stock[it.code] ? '<i></i><span>stock ' + num(S.stock[it.code].qty) + '</span>' : '') + '</div></span><input type="number" inputmode="decimal" enterkeyhint="next" data-bq="' + gi + '|' + ii + '" value="' + esc(it.qty) + '" placeholder="Qty" style="width:88px;text-align:right"><button class="xbtn" data-a="btItemDel" data-v="' + gi + '|' + ii + '" aria-label="Remove">' + ico('x', 16) + '</button></div>').join('') +
      '<div class="pad col" style="gap:8px;background:var(--soft)"><div class="sbox"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" data-bt="q" value="' + esc(f.q || '') + '" placeholder="Add item: type name or code" autocomplete="off" enterkeyhint="done"></div><div id="bthits">' + batchHits(gi) + '</div></div></div>';
  });
  h += pickBtn('btStore', { title: 'Add a store', search: true, full: true, placeholder: '+ Add a store', opts: stores.map(st => [st, st, (S.stores[st] || {}).rcv ? 'Receiver GA' + S.stores[st].rcv : '']), val: '', set: v => { batchAddGroup(v); ui.form.q = ''; renderSheet(); const i = document.querySelector('[data-bt="q"]'); if (i) i.focus(); } });
  h += '<details class="card pad"><summary><b>Paste rows from Excel</b></summary><div class="note" style="margin:8px 0">One row per article: <b>Store, Item code, Qty</b> (tab or comma). Optional 4th column: Request No.</div><textarea data-bt="paste" rows="5">' + esc(f.paste || '') + '</textarea><button class="btn" data-a="btPaste" style="margin-top:8px">Add pasted rows</button></details>';
  const rows = f.groups.flatMap(g => g.items.map(it => ({ g, it })));
  if (rows.length) h += '<div class="sect">Preview · ' + rows.length + ' articles · ' + f.groups.length + ' requests</div><div class="card tblwrap"><table><tr><th>Request</th><th>Store</th><th>Item</th><th>Qty</th><th>Receiver</th><th>Slip</th></tr>' +
    rows.map(({ g, it }) => '<tr><td><b>' + esc(g.req) + '</b></td><td>' + esc(g.store) + '</td><td>' + esc(it.name) + ' <span class="note mono">' + esc(it.code) + '</span></td><td' + (parseFloat(it.qty) > 0 ? '' : ' style="color:var(--noInk);font-weight:700"') + '>' + esc(it.qty || 'missing') + '</td><td>' + esc(g.rcv || '–') + '</td><td>' + esc(g.slip || '–') + '</td></tr>').join('') + '</table></div>';
  const bad = f.groups.find(g => !g.req || S.lines.some(l => l.req === g.req) || f.groups.filter(x => x.req === g.req).length > 1);
  if (bad) h += '<div class="err">Request No ' + esc(bad.req) + ' is empty or already used.</div>';
  const ok = rows.length && !bad && rows.every(({ it }) => parseFloat(it.qty) > 0);
  h += '<button class="btn main full" data-a="btSave"' + (ok ? '' : ' disabled') + '>Save all · ' + rows.length + ' articles</button>';
  return h;
}
function shReqStatus() {
  const f = ui.form, L = S.lines.filter(l => l.req === f.req), store = (L[0] || {}).store || '';
  const left = L.filter(l => l.status === 'waiting').length;
  let h = '<div class="row"><h2>Request ' + esc(f.req) + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="note">' + esc(store) + ' · ' + (left ? left + ' pending' : 'completed') + '. Close articles you will not issue, or make closed ones pending again.</div>';
  h += '<div class="card" style="overflow:hidden">' + L.map(l => {
    const st = l.status === 'issued' ? pill('Issued ' + (l.issued[0] ? l.issued[0].slip : ''), 'c-in') : l.status === 'waiting' ? pill('Pending', 'c-gd') : pill('Closed', 'c-gy');
    const btn = l.status === 'waiting' ? '<button class="btn sm ghost danger-t" data-a="rsClose" data-v="' + l.id + '">Close</button>' : l.status === 'dropped' ? '<button class="btn sm" data-a="rsOpen" data-v="' + l.id + '">Make pending</button>' : '';
    return '<div class="line" style="flex-direction:row;align-items:center;gap:10px"><span style="flex:1;min-width:0"><b>' + esc(itemName(l.code)) + '</b><div class="meta"><span class="mono">' + esc(l.code) + '</span><i></i><span>' + num(l.qty) + ' ' + esc(itemUom(l.code)) + '</span></div></span>' + st + btn + '</div>';
  }).join('') + '</div>';
  h += '<div class="card pad col" style="gap:8px"><b>Add a pending article</b><div class="grid2"><input type="text" data-cadd="code" value="' + esc(f.addCode || '') + '" placeholder="Item code" class="mono" autocapitalize="characters"><input type="number" inputmode="decimal" data-cadd="qty" value="' + esc(f.addQty || '') + '" placeholder="Qty"></div><button class="btn" data-a="rsAdd">+ Add as pending</button></div>';
  h += '<div class="grid2"><button class="btn danger-t" data-a="rsAll"' + (left ? '' : ' disabled') + '>Mark completed</button><button class="btn" data-a="corrOpen" data-v="' + esc(f.req) + '">Correct quantities</button></div>';
  return h;
}
function shMslips() {
  const f = ui.form, r = requests().find(x => x.req === f.req);
  if (!r) return '<div class="row"><h2>Request ' + esc(f.req) + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div><div class="card pad note">This request is not in the app.</div>';
  const W = r.lines.filter(l => l.status === 'waiting'), sl = reqSlips(r.req);
  let h = '<div class="row"><h2>Slips for ' + esc(r.req) + '</h2><button class="btn sm ghost" data-a="closeSheet">Done</button></div>';
  h += '<div class="note">' + esc(r.store) + ' · ' + W.length + ' pending of ' + r.lines.filter(l => l.status !== 'dropped').length + '. Add as many slips as were made on CUIMS, one after another.</div>';
  h += '<div class="slips card" style="padding:10px">' + (sl.length ? sl.map(e => slipRow(e, r.req)).join('') : '<div class="slipline none">No slip entered yet</div>') + '</div>';
  if (!W.length) return h + '<div class="okbox"><span>All articles of this request are issued or closed.</span></div>';
  h += '<div class="card pad col" style="gap:10px"><div class="row"><b class="ttl" style="font-size:17px">Add slip ' + (sl.length + 1) + '</b><span class="stag man" style="position:static">Manual</span></div>' +
    '<div class="grid2"><label class="f">Slip No<input type="text" data-f="slip" value="' + esc(f.slip) + '" class="mono" autocapitalize="characters"></label><label class="f">Serial No<input type="text" data-f="serial" value="' + esc(f.serial) + '" class="mono" inputmode="numeric"></label></div>' +
    '<div class="grid2"><label class="f">Date<input type="date" data-f="date" value="' + esc(f.date) + '"></label><label class="f">Time<input type="time" data-f="time" value="' + esc(f.time) + '"></label></div>' +
    '<label class="f">Receiver (6 digits)<input type="text" data-f="rcv" value="' + esc(f.rcv) + '" class="mono" inputmode="numeric" maxlength="6"></label>' +
    '<div class="grid2"><label class="f">Entered by<input type="text" data-f="byName" value="' + esc(f.byName) + '"></label><label class="f">Emp code<input type="text" data-f="byEmp" value="' + esc(f.byEmp) + '" autocapitalize="characters"></label></div>' +
    '<div class="row"><b>Articles in this slip</b><button class="btn sm ghost" data-a="msAll">' + (W.every(l => f.pick[l.id]) ? 'Untick all' : 'Tick all') + '</button></div>' +
    W.map(l => '<label class="chk" style="min-height:44px;gap:12px"><input type="checkbox" data-a="markPick" data-v="' + l.id + '"' + (f.pick[l.id] ? ' checked' : '') + '><span style="flex:1"><b>' + esc(itemName(l.code)) + '</b><span class="note mono" style="display:block">' + esc(l.code) + '</span></span><b class="qty">' + num(l.qty) + ' ' + esc(itemUom(l.code)) + '</b></label>').join('') +
    '<button class="btn main full" data-a="msSave">Save slip ' + (sl.length + 1) + ' · ' + W.filter(l => f.pick[l.id]).length + ' articles</button></div>';
  return h;
}
function shManReq() {
  const f = ui.form;
  let h = '<div class="row"><h2>' + (f._new ? 'Manual request' : 'Request ' + esc(f.req)) + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="note">For requests done outside the app. No item details needed: just the slips, serials and article counts.</div>';
  h += '<div class="card pad col"><div class="grid2"><label class="f">Request No<input type="text" data-mr="req" value="' + esc(f.req) + '" class="mono"' + (f._new ? '' : ' disabled') + '></label><label class="f">Request date<input type="date" data-mr="date" value="' + esc(f.date) + '"></label></div>' +
    '<label class="f">Store</label>' + pickBtn('mrStore', { title: 'Store', search: true, full: true, placeholder: 'Choose store', opts: allStores().map(x => [x, x]), val: f.store, set: v => { ui.form.store = v; const d = S.stores[v] || {}; if (!ui.form.rcv && d.rcv) { ui.form.rcv = d.rcv; ui.form.rname = d.rname || ''; } renderSheet(); } }) +
    '<div class="grid2"><label class="f">Issued to (6 digits)<input type="text" data-mr="rcv" value="' + esc(f.rcv) + '" class="mono" inputmode="numeric" maxlength="6"></label><label class="f">Receiver name<input type="text" data-mr="rname" value="' + esc(f.rname) + '"></label></div>' +

    '<label class="f">Total articles in the request<input type="number" inputmode="numeric" data-mr="total" value="' + esc(f.total) + '" placeholder="e.g. 14"></label></div>';
  h += '<div class="sect">Slips (' + f.slips.length + ')</div>';
  f.slips.forEach((x, i) => {
    h += '<div class="card pad col" style="gap:10px;box-shadow:inset 4px 0 0 #FFB648"><div class="row"><b>Slip ' + (i + 1) + '</b><button class="xbtn" data-a="mrDel" data-v="' + i + '" aria-label="Remove slip">' + ico('x', 16) + '</button></div>' +
      '<div class="grid2"><label class="f">Slip No<input type="text" data-ms="' + i + '|slip" value="' + esc(x.slip) + '" class="mono" autocapitalize="characters"></label><label class="f">Serial No<input type="text" data-ms="' + i + '|serial" value="' + esc(x.serial) + '" class="mono" inputmode="numeric"></label></div>' +
      '<div class="grid2"><label class="f">Date<input type="date" data-ms="' + i + '|date" value="' + esc(x.date) + '"></label><label class="f">Time<input type="time" data-ms="' + i + '|time" value="' + esc(x.time) + '"></label></div>' +
      '<label class="f">Articles in this slip<input type="number" inputmode="numeric" data-ms="' + i + '|count" value="' + esc(x.count) + '" placeholder="e.g. 9"></label>' +
      '<div class="grid2"><label class="f">Entered by<input type="text" data-ms="' + i + '|byName" value="' + esc(x.byName != null ? x.byName : f.byName) + '"></label><label class="f">Emp code<input type="text" data-ms="' + i + '|byEmp" value="' + esc(x.byEmp != null ? x.byEmp : f.byEmp) + '" autocapitalize="characters"></label></div></div>';
  });
  h += '<button class="btn full" data-a="mrAdd">+ Add another slip</button>';
  const doneN = f.slips.reduce((n, x) => n + (parseInt(x.count, 10) || 0), 0), tot = parseInt(f.total, 10) || 0;
  h += '<div class="card pad col"><div class="row"><b>Status</b><span class="note">' + doneN + (tot ? ' of ' + tot : '') + ' articles in slips</span></div><div class="seg"><button data-a="mrSt" data-v="pending" class="' + (f.status !== 'done' ? 'on' : '') + '">Pending</button><button data-a="mrSt" data-v="done" class="' + (f.status === 'done' ? 'on' : '') + '">Completed</button></div></div>';
  h += '<button class="btn main full" data-a="mrSave">Save request</button>';
  if (!f._new) h += '<button class="btn ghost danger-t full" data-a="mrRemove">Delete this manual request</button>';
  h += '<button class="btn ghost full" data-a="newManualFreeOld">Enter full item details instead</button>';
  return h;
}
function shCrop() {
  const c = ui.sheet, V = 280, base = Math.max(V / c.img.width, V / c.img.height) * c.zoom;
  const dw = c.img.width * base, dh = c.img.height * base;
  return '<div class="row"><h2>Crop photo</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>' +
    '<div class="note">Drag to move. Use the slider to zoom.</div>' +
    '<div id="cropBox" style="position:relative;width:280px;height:280px;margin:0 auto;overflow:hidden;border-radius:20px;background:#0F172A;touch-action:none">' +
    '<img src="' + c.src + '" draggable="false" style="position:absolute;left:' + ((V - dw) / 2 + c.x) + 'px;top:' + ((V - dh) / 2 + c.y) + 'px;width:' + dw + 'px;height:' + dh + 'px;max-width:none;user-select:none;pointer-events:none">' +
    '<div style="position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 400px rgba(15,23,42,.55);border:2px solid #C9A24B;pointer-events:none"></div></div>' +
    '<label class="f">Zoom<input type="range" min="1" max="4" step="0.01" value="' + c.zoom + '" data-crop="zoom" style="min-height:40px"></label>' +
    '<button class="btn main full" data-a="cropSave">Save photo</button>';
}
let cropDrag = null;
document.addEventListener('pointerdown', e => { const b = e.target.closest && e.target.closest('#cropBox'); if (!b || !ui.sheet || ui.sheet.kind !== 'crop') return; cropDrag = { x: e.clientX, y: e.clientY, ox: ui.sheet.x, oy: ui.sheet.y }; b.setPointerCapture && b.setPointerCapture(e.pointerId); });
document.addEventListener('pointermove', e => { if (!cropDrag) return; ui.sheet.x = cropDrag.ox + e.clientX - cropDrag.x; ui.sheet.y = cropDrag.oy + e.clientY - cropDrag.y; const im = document.querySelector('#cropBox img'); if (im) { const V = 280, c = ui.sheet, base = Math.max(V / c.img.width, V / c.img.height) * c.zoom; im.style.left = ((V - c.img.width * base) / 2 + c.x) + 'px'; im.style.top = ((V - c.img.height * base) / 2 + c.y) + 'px'; } });
document.addEventListener('pointerup', () => { cropDrag = null; });
function shBackups() {
  const s = ui.sheet;
  let h = '<div class="row"><h2>Cloud backups</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="note">Every change is backed up automatically (a new copy every 30 minutes, newest 60 kept). Tap Keep on any copy to protect it forever.</div>';
  h += '<div class="card pad col"><b>Save a backup now</b><input type="text" data-bk="note" value="' + esc(s.note || '') + '" placeholder="Note, e.g. Before month-end cleanup"><button class="btn main" data-a="bkSave">Save backup (kept)</button></div>';
  if (s.loading) return h + skel(4);
  if (s.err) return h + '<div class="err">' + esc(s.err) + '</div>';
  const items = s.items || [];
  h += '<div class="row"><span class="sect">' + items.length + ' backups</span>' + (s.folder ? '<button class="btn sm ghost" data-a="openUrl" data-v="' + esc(s.folder) + '">Open Drive folder</button>' : '') + '</div>';
  items.forEach(b => {
    const c = b.counts || {};
    h += '<div class="card pad col" style="gap:8px"><div class="row"><b>' + fmtDT(b.updated) + '</b>' + pill(b.keep ? 'Kept' : b.kind === 'manual' ? 'Manual' : 'Auto', b.keep ? 'c-ok' : 'c-gy') + '</div>' +
      meta([c.requests != null ? c.requests + ' requests' : '', c.entries != null ? c.entries + ' entries' : '', c.returns != null ? c.returns + ' returns' : '', Math.round(b.size / 1024) + ' KB', b.by ? esc(b.by) : '']) +
      (s.editing === b.id ? '<input type="text" data-bk="rename" value="' + esc(s.rename || '') + '" placeholder="Note"><div class="grid2"><button class="btn sm" data-a="bkNoteSave" data-v="' + b.id + '">Save note</button><button class="btn sm ghost" data-a="bkNoteCancel">Cancel</button></div>' : (b.note ? '<div class="note">' + esc(b.note) + '</div>' : '')) +
      '<div class="grid3"><button class="btn sm main" data-a="bkRestore" data-v="' + b.id + '">Restore</button><button class="btn sm" data-a="bkKeep" data-v="' + b.id + '" data-k="' + (b.keep ? '0' : '1') + '">' + (b.keep ? 'Unkeep' : 'Keep') + '</button><button class="btn sm warn" data-a="bkDel" data-v="' + b.id + '">Delete</button></div>' +
      (s.editing === b.id ? '' : '<button class="btn sm ghost" data-a="bkNote" data-v="' + b.id + '">Add / edit note</button>') + '</div>';
  });
  return h;
}
async function restoreNow() {
  if (!await uiConfirm('Replace all data on this phone with the last Google Sheet backup?')) return;
  try {
    const r = await fetch(S.sync.url + (S.sync.url.includes('?') ? '&' : '?') + 'action=restore');
    const j = await r.json();
    if (!j.ok || !j.backup) throw new Error(j.error || 'no backup found');
    const url = S.sync.url;
    S = Object.assign(blank(), JSON.parse(j.backup)); S.sync.url = url; save(true); render(); toast('Restored from Google Sheet.');
  } catch (e) { toast('Restore failed: ' + e.message); }
}

/* ---------------- updates ---------------- */
async function checkUpdate(manual) {
  if (!INFO.repo) { if (manual) toast('Updates work inside the installed app.'); return; }
  try {
    const r = await fetch('https://api.github.com/repos/' + INFO.repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const j = await r.json();
    const m = String(j.tag_name || '').match(/(\d+)$/);
    const apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
    const newer = !!(m && apk && +m[1] > +(INFO.code || 0));
    S.updateInfo = { tag: j.tag_name, url: apk ? apk.browser_download_url : '', newer, at: new Date().toISOString() };
    S.lastUpdateCheck = Date.now(); save(true);
    if (manual) toast(newer ? 'Update ' + j.tag_name + ' available.' : 'You have the latest version.');
    render();
  } catch (e) { if (manual) toast('Could not check: ' + e.message); }
}

/* ---------------- events from CUIMS ---------------- */
window.onSiteEvent = function (raw) {
  let e; try { e = JSON.parse(raw); } catch (x) { return; }
  if (e.type === 'setPref' && ['queue', 'autoSubmit'].includes(e.key)) { S[e.key] = !!e.val; save(true); render(); return; }
  if (e.type === 'areas' && Array.isArray(e.areas) && e.areas.length) {
    if (e.areas.join('|') !== S.areas.join('|')) { S.areas = e.areas; save(true); }
  } else if (e.type === 'login') { S.lastLoginAt = e.at; save(true); }
  else if (e.type === 'loggedout') { toast('CUIMS logged out. Log in again; the entry restarts by itself.'); }
  else if (e.type === 'progress' && e.code && isFinite(e.stock)) {
    if (S.stock[e.code] && Math.abs(S.stock[e.code].qty - e.stock) > 1e-6) { S.stock[e.code].qty = e.stock; save(true); }
  } else if (e.type === 'submitted') { recordSubmit(e); }
  else if (e.type === 'cancelled') { toast('Entry cancelled. Nothing was submitted.'); if (N) N.showApp(); }
};
function recordSubmit(e) {
  let job = null; try { job = JSON.parse(N.jobGet() || 'null'); } catch (x) {}
  if (!job || job.slip !== e.slip) return;
  if (S.entries.some(x => String(x.slip).toUpperCase() === String(job.slip).toUpperCase())) return;
  const items = job.items.filter(i => !i.skip);
  const at = new Date().toISOString();
  const entry = { id: nid(), slip: job.slip, serial: e.serial || '', store: job.store, rcv: job.rcv, rname: e.rname || rname(job.rcv), at, date: today(), time: timeNow(),
    by: meTag(), kind: 'auto', remarks: e.note || '', items: items.map(i => ({ lineId: i.lineId, req: i.req, code: i.code, name: i.name, uom: i.uom, qty: i.qty, remark: i.remark })) };
  S.entries.push(entry);
  items.forEach(i => {
    const l = S.lines.find(x => x.id === i.lineId);
    if (l) { l.status = 'issued'; l.issued.push({ slip: job.slip, serial: e.serial || '', at }); delete S.hold[l.id]; }
    if (S.stock[i.code]) S.stock[i.code].qty = Math.round((S.stock[i.code].qty - i.qty) * 1000) / 1000;
  });
  if (e.rname) { S.rnames = S.rnames || {}; S.rnames[job.rcv] = e.rname; if (S.stores[job.store] && !S.stores[job.store].rname) S.stores[job.store].rname = e.rname; }
  save();
  toast('Saved ' + job.slip + ', Serial ' + (e.serial || '–') + '.');
  render();
  if (S.queue) {
    const nx = nextQueueJob(); const slip = nx ? (plannedSlip(nx.ids) || nextSlip()) : '';
    if (nx && slip) { setTimeout(() => { toast('Queue: ' + nx.store + ', request ' + nx.req + ', Slip ' + slip); startJob(nx.store, slip, nx.rcv, nx.ids); }, 2500); return; }
    toast('Queue finished: nothing else can be issued today.');
  }
  setTimeout(() => { if (N) N.showApp(); }, 2500);
}
window.jvOnReturnFromSite = () => render();
window.jvBack = () => {
  if (ui.picker) { ui.picker = null; renderPicker(); return true; }
  if (ui.drawer) { ui.drawer = false; renderDrawer(); return true; }
  if (ui.sheet) { ui.sheet = null; renderSheet(); return true; }
  if (ui.view) { ui.view = null; render(); return true; }
  if (ui.tab === 'set' && ui.setPage) { ui.setPage = null; render(); return true; }
  if (ui.tab !== 'home') { ui.tab = 'home'; render(); return true; }
  return false;
};

/* ---------------- render ---------------- */
function render() {
  const app = document.getElementById('app');
  const y = window.scrollY;
  app.innerHTML = appBar() + (S.testMode ? '<div class="testbar"><span><b>TEST MODE</b> · your real data is safe and hidden. Cloud backup is paused. Entries submitted on CUIMS are still real.</span><button class="btn sm" data-a="testToggle">Exit</button></div>' : '') + (ui.view === 'stock' ? vStock() : ui.view === 'cons' ? vCons() : ui.view === 'arts' ? vArts() : ui.view === 'check' ? vCheck() : ui.view === 'done' ? vDone() : ui.view === 'expiry' ? vExpiry() : ui.view === 'count' ? vCount() : ui.view === 'countLog' ? vCountLog() : ui.view === 'taskLog' ? vTaskLog() : ui.view === 'req' ? vReq() : ({ home: vHome, pend: vPend, reg: vReg, find: vFind, set: vSet })[ui.tab]());
  document.querySelector('#tabs .in').innerHTML = TABS.map(([k, l]) => '<button data-a="tab" data-v="' + k + '" class="' + (ui.tab === k && !ui.view ? 'on' : '') + '" aria-label="' + l + '"><span class="nic">' + ICON[k] + '</span><span class="nl">' + l + '</span></button>').join('');
  renderDrawer();
  paintSync();
  enhanceDates(document.getElementById('app'));
  window.scrollTo(0, y);
}
function renderSheet() {
  const el = document.getElementById('sheet');
  if (!ui.sheet) { el.innerHTML = ''; return; }
  const k = ui.sheet.kind;
  const body = k === 'manReq' ? shManReq() : k === 'mslips' ? shMslips() : k === 'reqStatus' ? shReqStatus() : k === 'corr' ? shCorr() : k === 'batch' ? shBatch() : k === 'newReq' ? shNewReq() : k === 'export' ? shExport() : k === 'crop' ? shCrop() : k === 'backups' ? shBackups() : k === 'start' ? shStart() : k === 'upload' ? shUpload() : k === 'entry' ? shEntry() : k === 'return' ? shReturn() : k === 'editReq' ? shEditReq() : k === 'bulk' ? shBulk() : k === 'mark' ? shMark() : '';
  const sc = el.querySelector('.sheet') ? el.querySelector('.sheet').scrollTop : 0;
  el.innerHTML = '<div class="sheetbg" data-a="bgClose"><div class="sheet" role="dialog" aria-modal="true">' + body + '</div></div>';
  el.querySelector('.sheet').scrollTop = sc;
  enhanceDates(document.getElementById('sheet'));
}
const SORT_OPTS = [['reqdate', 'Day, then Request No'], ['req_asc', 'Request No, low to high'], ['req_desc', 'Request No, high to low'], ['name_asc', 'Store name A to Z'], ['name_desc', 'Store name Z to A'],
  ['date_asc', 'Date, oldest first'], ['date_desc', 'Date, newest first'], ['custom', 'My store order'], ['stock', 'Stock priority (most ready first)'], ['size', 'Most articles first']];
function getSort(k) { S.uiPrefs = S.uiPrefs || {}; S.uiPrefs.sort = S.uiPrefs.sort || {}; return S.uiPrefs.sort[k] || 'reqdate'; }
function setSort(k, v) { getSort(k); S.uiPrefs.sort[k] = v; writeLocal(); }
function cmpSort(how, a, b) {
  const rq = (x, y) => String(x.req || '').localeCompare(String(y.req || ''), undefined, { numeric: true });
  const da = String(a.date || ''), db = String(b.date || '');
  switch (how) {
    case 'req_asc': return rq(a, b); case 'req_desc': return rq(b, a);
    case 'name_asc': return String(a.store).localeCompare(String(b.store)) || rq(a, b); case 'name_desc': return String(b.store).localeCompare(String(a.store)) || rq(a, b);
    case 'date_asc': return da.localeCompare(db) || rq(a, b); case 'date_desc': return db.localeCompare(da) || rq(a, b);
    case 'custom': return byStore(a.store, b.store) || rq(a, b); case 'stock': return (b.ready || 0) - (a.ready || 0) || rq(a, b); case 'size': return (b.size || 0) - (a.size || 0) || rq(a, b);
    default: return db.localeCompare(da) || rq(a, b);
  }
}
function sortBy(list, how, acc) { return list.sort((x, y) => cmpSort(how, acc(x), acc(y))); }
const PICKS = {};
function pickBtn(id, cfg, label) { PICKS[id] = cfg; const cur = (cfg.opts.find(o => o[0] === cfg.val) || [])[1]; return '<button type="button" class="pickbtn' + (cfg.full ? ' full' : '') + '" data-a="pick" data-v="' + id + '"><span>' + esc(label ? label + (cur ? ': ' + cur : '') : cur || cfg.placeholder || 'Choose') + '</span>' + ico('down', 16) + '</button>'; }
function sortPick(k) { return pickBtn('sort_' + k, { title: 'Sort by', opts: SORT_OPTS, val: getSort(k), set: v => { setSort(k, v); render(); } }, 'Sort'); }
const BUSY = { uploadOk: 'Importing and re-planning', syncNow: 'Backing up to the cloud', restore: 'Restoring your data', bkRestore: 'Restoring the backup', bkSave: 'Saving a backup', dcOpen: 'Checking your data', consOpen: 'Adding up consumption',
  stockOpen: 'Opening live stock', artsOpen: 'Loading pending articles', doneOpen: 'Preparing the done list', openMgr: 'Opening Manager CUIMS', dMgr: 'Opening Manager CUIMS', openSite: 'Opening Issue CUIMS', dSite: 'Opening Issue CUIMS', startFill: 'Opening Issue CUIMS',
  testToggle: 'Switching data', btSave: 'Saving requests', bulkSave: 'Saving all requests', mrSave: 'Saving request', msSave: 'Saving slip', corrSave: 'Saving correction', dCount: 'Picking today\'s articles', template: 'Making the template', expAll: 'Preparing the full backup' };
function loader(on, msg) {
  let el = document.getElementById('loader'); if (!el) { el = document.createElement('div'); el.id = 'loader'; document.body.appendChild(el); }
  if (!on) { el.className = ''; el.innerHTML = ''; return; }
  el.className = 'show';
  el.innerHTML = '<div class="ldbox"><div class="ldorb"><span class="o1"></span><span class="o2"></span><span class="o3"></span><i class="sp s1"></i><i class="sp s2"></i><i class="sp s3"></i><img src="icon.png" alt=""></div><b>' + esc(msg || 'Working') + '</b><div class="lddots"><i></i><i></i><i></i></div><div class="ldbar"><i></i></div><small>JV Stock Issue</small></div>';
}
const skel = n => Array.from({ length: n || 3 }, () => '<div class="card pad skel"><i style="width:34%"></i><i style="width:72%"></i><i style="width:55%"></i></div>').join('');
function uiPrompt(msg, value, okLabel) {
  return new Promise(res => {
    let el = document.getElementById('dlg'); if (!el) { el = document.createElement('div'); el.id = 'dlg'; document.body.appendChild(el); }
    el.innerHTML = '<div class="pkbg"></div><div class="dlgbox" role="dialog" aria-modal="true"><div class="dlgmsg">' + esc(msg) + '</div><input type="text" id="dlgin" value="' + esc(value || '') + '" class="mono" autocapitalize="characters"><div class="grid2"><button class="btn" data-dlg="0">Cancel</button><button class="btn main" data-dlg="1">' + esc(okLabel || 'OK') + '</button></div></div>';
    const inp = el.querySelector('#dlgin'); setTimeout(() => { inp.focus(); inp.select(); }, 50);
    el.querySelectorAll('[data-dlg]').forEach(b => b.onclick = e => { e.stopPropagation(); const v = inp.value.trim(); el.innerHTML = ''; res(b.dataset.dlg === '1' ? v : null); });
  });
}
const TEST_KEYS = ['lines', 'entries', 'returns', 'stock', 'stockAt', 'counts', 'taskLog', 'corrections', 'hold'];
const deep = o => JSON.parse(JSON.stringify(o == null ? null : o));
function setTestMode(on) {
  if (on === !!S.testMode) return;
  if (on) {
    S._real = {}; TEST_KEYS.forEach(k => S._real[k] = S[k]);
    const t = S._test || {};
    S.lines = t.lines || []; S.entries = t.entries || []; S.returns = t.returns || []; S.counts = t.counts || []; S.taskLog = t.taskLog || {}; S.corrections = t.corrections || []; S.hold = t.hold || {};
    S.stock = t.stock || deep(S._real.stock) || {}; S.stockAt = t.stockAt || S._real.stockAt;
    S.testMode = true;
  } else {
    S._test = {}; TEST_KEYS.forEach(k => S._test[k] = S[k]);
    TEST_KEYS.forEach(k => S[k] = S._real[k]); delete S._real; S.testMode = false;
  }
  ui.view = null; ui.lastReq = null; save(); render();
}
function renumberReqStore(from, store, to) {
  to = String(to || '').trim(); if (!to) return false;
  if (S.lines.some(l => l.req === to)) { toast('Request No ' + to + ' already exists.'); return false; }
  const ids = new Set(S.lines.filter(l => l.req === from && l.store === store).map(l => l.id));
  S.lines.forEach(l => { if (ids.has(l.id)) l.req = to; });
  S.entries.forEach(e => e.items.forEach(i => { if (ids.has(i.lineId)) i.req = to; }));
  return true;
}
function dataIssues() {
  const out = [], by = {};
  S.lines.filter(l => l.status !== 'dropped').forEach(l => (by[l.req] = by[l.req] || []).push(l));
  Object.entries(by).forEach(([req, L]) => {
    const stores = [...new Set(L.map(l => l.store))];
    if (stores.length > 1) out.push({ kind: 'multi', req, stores: stores.map(st => ({ st, n: L.filter(l => l.store === st).length, issued: L.some(l => l.store === st && l.status === 'issued') })) });
    const seen = {}; L.filter(l => l.status === 'waiting').forEach(l => { const k = l.store + '|' + l.code; (seen[k] = seen[k] || []).push(l); });
    Object.values(seen).filter(x => x.length > 1).forEach(x => out.push({ kind: 'dupline', req, store: x[0].store, code: x[0].code, lines: x.map(l => l.id), qtys: x.map(l => l.qty) }));
    const ds = [...new Set(L.map(l => l.date))]; if (ds.length > 1) out.push({ kind: 'dates', req, dates: ds.sort() });
  });
  const bad = S.lines.filter(l => l.status !== 'dropped' && (!l.store || !l.code || !(l.qty > 0) || !l.req));
  if (bad.length) out.push({ kind: 'bad', ids: bad.map(l => l.id), n: bad.length });
  const slips = {}; S.entries.forEach(e => (slips[String(e.slip).toUpperCase()] = slips[String(e.slip).toUpperCase()] || []).push(e));
  Object.entries(slips).filter(([k, v]) => v.length > 1).forEach(([k, v]) => out.push({ kind: 'slip', slip: k, n: v.length, stores: v.map(e => e.store) }));
  const miss = S.lines.filter(l => l.status === 'waiting' && Object.keys(S.stock).length && !S.stock[l.code]);
  if (miss.length) out.push({ kind: 'nostock', n: miss.length, codes: [...new Set(miss.map(l => l.code))] });
  return out;
}
function audit(action, l, extra) { S.audit = S.audit || []; S.audit.push(Object.assign({ at: new Date().toISOString(), by: S.me.name || '', action, req: l.req, store: l.store, code: l.code, qty: l.qty }, extra || {})); if (S.audit.length > 3000) S.audit = S.audit.slice(-3000); }
function artsList() {
  const A = ui.arts, PL = plan(), q = String(A.q || '').trim().toUpperCase();
  let L = S.lines.filter(l => l.status === 'waiting').map(l => ({ l, k: S.hold[l.id] ? 'hold' : PL[l.id] }));
  if (A.store) L = L.filter(x => x.l.store === A.store);
  if (A.st !== 'all') L = L.filter(x => A.st === 'ready' ? x.k === 'issue' : A.st === 'wait' ? (x.k === 'short' || x.k === 'missing') : x.k === A.st);
  if (q) L = L.filter(x => (x.l.code + ' ' + itemName(x.l.code) + ' ' + x.l.store + ' ' + x.l.req).toUpperCase().includes(q));
  return sortBy(L, getSort('arts'), x => ({ req: x.l.req, store: x.l.store, date: x.l.date, ready: x.k === 'issue' ? 1 : 0, size: x.l.qty }));
}
function artsResults() {
  const A = ui.arts, L = artsList(), selN = Object.keys(A.sel).length;
  const allSel = L.length && L.every(x => A.sel[x.l.id]);
  let h = '<div class="row" style="align-items:center"><label class="chk" style="min-height:40px"><input type="checkbox" data-a="artsAll"' + (allSel ? ' checked' : '') + '> Select all ' + L.length + '</label><span class="note">' + L.reduce((n, x) => n + 1, 0) + ' articles</span></div>';
  if (!L.length) return h + '<div class="card pad note">No pending articles match.</div>';
  h += '<div class="card" style="overflow:hidden">' + L.slice(0, 300).map(({ l, k }) => {
    const st = k === 'later' ? pill('Scheduled', 'c-in') : k === 'issue' ? pill('Ready', 'c-ok') : k === 'short' ? pill('Short', 'c-no') : k === 'missing' ? pill('Not in stock', 'c-no') : pill('On hold', 'c-gd');
    const d0 = days(l.date);
    return '<div class="art' + (A.sel[l.id] ? ' on' : '') + '"><input type="checkbox" data-a="artsSel" data-v="' + l.id + '"' + (A.sel[l.id] ? ' checked' : '') + ' aria-label="Select">' +
      '<div class="ab"><div class="row"><b class="an">' + esc(itemName(l.code)) + '</b>' + st + '</div>' +
      '<div class="meta"><span class="mono">' + esc(l.code) + '</span><i></i><span>' + esc(l.store) + '</span><i></i><span class="reqno sm" data-req="' + esc(l.req) + '">' + esc(l.req) + '</span><i></i><span>' + fmtShort(l.date) + (d0 ? ' · ' + d0 + ' d' : '') + '</span></div>' +
      '<div class="aa"><button class="aq" data-a="artQty" data-v="' + l.id + '" aria-label="Edit quantity">' + num(l.qty) + ' <small>' + esc(itemUom(l.code)) + '</small><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>' +
      '<button class="btn sm ghost" data-a="artHold" data-v="' + l.id + '">' + (S.hold[l.id] ? 'Release' : 'Keep on hold') + '</button><button class="btn sm ghost danger-t" data-a="artDel" data-v="' + l.id + '">Remove</button></div></div></div>';
  }).join('') + '</div>' + (L.length > 300 ? '<div class="note">Showing 300. Narrow with search or filters.</div>' : '');
  return h;
}
function vArts() {
  ui.arts = ui.arts || { q: '', store: '', st: 'all', sel: {} };
  const A = ui.arts, stores = [...new Set(S.lines.filter(l => l.status === 'waiting').map(l => l.store))].sort(byStore);
  const selN = Object.keys(A.sel).length;
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Pending articles</h1><div class="sub">Every article still waiting, with its store and quantity. Edit, hold or remove one by one, or select many.</div></div></header><main>';
  h += '<div class="sbox"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" data-arts="q" value="' + esc(A.q) + '" placeholder="Item, code, store or Request No" autocomplete="off"></div>';
  h += '<div class="seg">' + [['all', 'All'], ['ready', 'Ready'], ['wait', 'Short'], ['hold', 'On hold']].map(([k, l]) => '<button data-a="artsSt" data-v="' + k + '" class="' + (A.st === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  h += '<div class="grid2">' + pickBtn('artsStore', { title: 'Store', search: true, full: true, opts: [['', 'All stores']].concat(stores.map(x => [x, x])), val: A.store, set: v => { A.store = v; render(); } }) + sortPick('arts') + '</div>';
  h += '<div id="artsres">' + artsResults() + '</div>';
  h += '</main>';
  if (selN) h += '<div class="selbar"><b>' + selN + ' selected</b><button class="btn sm" data-a="artsBHold">Hold</button><button class="btn sm" data-a="artsBRel">Release</button><button class="btn sm danger" data-a="artsBDel">Remove</button><button class="xbtn" data-a="artsBClear" aria-label="Clear selection">' + ico('x', 16) + '</button></div>';
  return h;
}
function stockDemand() { const d = {}, t = today(); S.lines.forEach(l => { if (l.status === 'waiting' && !(l.date > t)) d[l.code] = (d[l.code] || 0) + l.qty; }); return d; }
function stockRows() {
  const K = ui.stk, q = String(K.q || '').trim().toUpperCase(), words = q.split(/\s+/).filter(Boolean), D = stockDemand();
  let L = Object.entries(S.stock).map(([c, v]) => ({ c, v, need: D[c] || 0 }));
  if (words.length) L = L.filter(x => words.every(w => x.c.includes(w) || String(x.v.name).toUpperCase().includes(w)));
  if (K.f === 'in') L = L.filter(x => x.v.qty > 0); else if (K.f === 'zero') L = L.filter(x => !(x.v.qty > 0)); else if (K.f === 'short') L = L.filter(x => x.need > x.v.qty); else if (K.f === 'need') L = L.filter(x => x.need > 0);
  L.sort((a, b) => (words.length ? (String(a.v.name).toUpperCase().startsWith(q) ? 0 : 1) - (String(b.v.name).toUpperCase().startsWith(q) ? 0 : 1) : 0) || (b.need - a.need) || String(a.v.name).localeCompare(String(b.v.name)));
  return L;
}
function stockResults() {
  const L = stockRows(), K = ui.stk;
  let h = '<div class="note" style="padding:0 4px">' + L.length.toLocaleString('en-IN') + ' items' + (L.length > 120 ? ' · showing 120, type to narrow' : '') + '</div>';
  if (!L.length) return h + '<div class="card pad note">No item matches.</div>';
  h += '<div class="card" style="overflow:hidden">' + L.slice(0, 120).map(x => {
    const free = Math.round((x.v.qty - x.need) * 1000) / 1000, open = K.open === x.c;
    let row = '<button class="stkrow" data-a="stkOpen" data-v="' + esc(x.c) + '"><span class="sn"><b>' + esc(x.v.name) + '</b><span class="mono">' + esc(x.c) + '</span></span><span class="sq"><b>' + num(x.v.qty) + '</b><small>' + esc(x.v.uom) + '</small></span></button>';
    row += '<div class="scrow" style="padding:0 18px 12px">' + (x.need ? '<span class="sc gd">needed ' + num(x.need) + '</span><span class="sc ' + (free < 0 ? 'no' : 'ok') + '">' + (free < 0 ? 'short ' + num(-free) : 'free ' + num(free)) + '</span>' : (x.v.qty > 0 ? '<span class="sc ok">in stock</span>' : '<span class="sc no">zero</span>')) + '</div>';
    if (open) {
      const W = S.lines.filter(l => l.code === x.c && l.status === 'waiting').sort((a, b) => a.date.localeCompare(b.date));
      const I = []; S.entries.slice().reverse().some(e => { e.items.forEach(i => { if (i.code === x.c && I.length < 6) I.push({ e, i }); }); return I.length >= 6; });
      row += '<div class="leftbox"><div class="lefthead">Waiting for it · ' + W.length + '</div>' + (W.length ? W.map(l => '<div class="leftrow"><span><b><span class="reqno sm" data-req="' + esc(l.req) + '">' + esc(l.req) + '</span> ' + esc(l.store) + '</b><span>' + fmtShort(l.date) + (l.date > today() ? ' · scheduled' : '') + '</span></span><b class="qty">' + num(l.qty) + '</b></div>').join('') : '<div class="note">No open request needs it.</div>') +
        '<div class="lefthead" style="margin-top:10px">Recent issues</div>' + (I.length ? I.map(o => '<div class="leftrow"><span><b>' + esc(o.e.store) + '</b><span>' + esc(o.e.slip) + ' · #' + esc(o.e.serial || '–') + ' · ' + fmtShort(entryDate(o.e)) + '</span></span><b class="qty">' + num(o.i.qty) + '</b></div>').join('') : '<div class="note">Not issued yet.</div>') + '</div>';
    }
    return '<div class="stkitem' + (open ? ' on' : '') + '">' + row + '</div>';
  }).join('') + '</div>';
  return h;
}
function vStock() {
  ui.stk = ui.stk || { q: '', f: 'all', open: null };
  const K = ui.stk;
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Live stock</h1><div class="sub">Search any item. See what open requests need and what is free.</div></div></header><main>';
  h += stockCard();
  h += '<div class="sbox"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" data-stk="q" value="' + esc(K.q) + '" placeholder="Item name or code" autocomplete="off"></div>';
  h += '<div class="seg">' + [['all', 'All'], ['in', 'In stock'], ['zero', 'Zero'], ['need', 'Needed'], ['short', 'Short']].map(([k, l]) => '<button data-a="stkF" data-v="' + k + '" class="' + (K.f === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  h += '<div id="stkres">' + stockResults() + '</div>';
  return h + '</main>';
}
function consRange() {
  const C = ui.cons, d = new Date(); d.setHours(12);
  if (C.p === 'week') { const a = new Date(d); a.setDate(d.getDate() - 6); return [isoOf(a), today()]; }
  if (C.p === 'month') return [isoOf(new Date(d.getFullYear(), d.getMonth(), 1, 12)), today()];
  if (C.p === 'last') return [isoOf(new Date(d.getFullYear(), d.getMonth() - 1, 1, 12)), isoOf(new Date(d.getFullYear(), d.getMonth(), 0, 12))];
  return [C.from || today(), C.to || today()];
}
function consData() {
  const [a, b] = consRange(), E = S.entries.filter(e => { const d = entryDate(e); return d >= a && d <= b; });
  const st = {}, it = {};
  E.forEach(e => { const so = st[e.store] = st[e.store] || { store: e.store, slips: new Set(), items: {}, n: 0 };
    so.slips.add(e.slip);
    e.items.forEach(i => { const q = Number(i.qty) || 0; so.n++; const x = so.items[i.code] = so.items[i.code] || { code: i.code, qty: 0, n: 0 }; x.qty += q; x.n++;
      const y = it[i.code] = it[i.code] || { code: i.code, qty: 0, stores: {} }; y.qty += q; y.stores[e.store] = (y.stores[e.store] || 0) + q; }); });
  return { a, b, E, stores: Object.values(st).sort((x, y) => y.n - x.n || byStore(x.store, y.store)), items: Object.values(it).sort((x, y) => Object.keys(y.stores).length - Object.keys(x.stores).length || y.qty - x.qty) };
}
function consRows() { const D = consData(), rows = []; D.stores.forEach(so => Object.values(so.items).sort((a, b) => b.qty - a.qty).forEach(x => rows.push({ Store: so.store, 'Item code': x.code, Item: itemName(x.code), UOM: itemUom(x.code), Qty: Math.round(x.qty * 1000) / 1000, Times: x.n }))); return rows; }
function bar(v, max, col) { return '<span class="cbar"><i style="width:' + Math.max(3, Math.round(v / (max || 1) * 100)) + '%;background:' + (col || '#141414') + '"></i></span>'; }
function donut(parts, size) {
  const tot = parts.reduce((n, p) => n + p.v, 0) || 1, R = size / 2 - 14, C = 2 * Math.PI * R; let off = 0;
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" style="transform:rotate(-90deg)"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + R + '" fill="none" stroke="#EEECF3" stroke-width="22"/>' +
    parts.map(p => { const L = p.v / tot * C, g = '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + R + '" fill="none" stroke="' + p.c + '" stroke-width="22" stroke-dasharray="' + Math.max(0, L - 2).toFixed(1) + ' ' + C.toFixed(1) + '" stroke-dashoffset="' + (-off).toFixed(1) + '"/>'; off += L; return g; }).join('') + '</svg>';
}
function vCons() {
  ui.cons = ui.cons || { p: 'week', mode: 'store', open: {} };
  const C = ui.cons, D = consData();
  const COL = ['#8C7BE0', '#FFB648', '#5B9BFF', '#F27BD8', '#2BB673', '#FF7A59', '#9AA0A6'];
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Consumption</h1><div class="sub">What each store took, from your issue slips.</div></div></header><main>';
  h += '<div class="seg">' + [['week', '7 days'], ['month', 'This month'], ['last', 'Last month'], ['custom', 'Custom']].map(([k, l]) => '<button data-a="consP" data-v="' + k + '" class="' + (C.p === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  if (C.p === 'custom') h += '<div class="grid2"><label class="f">From<input type="date" data-cons="from" value="' + esc(C.from || today()) + '"></label><label class="f">To<input type="date" data-cons="to" value="' + esc(C.to || today()) + '"></label></div>';
  h += '<div class="note" style="text-align:center">' + fmtLong(D.a) + ' to ' + fmtLong(D.b) + '</div>';
  if (!D.E.length) return h + '<div class="card pad note">No issue slips in this period.</div></main>';
  const totalArt = D.stores.reduce((n, so) => n + so.n, 0);
  // share by store: donut + legend
  const top = D.stores.slice(0, 6).map((so, k) => ({ name: so.store, v: so.n, c: COL[k] }));
  const rest = D.stores.slice(6).reduce((n, so) => n + so.n, 0); if (rest) top.push({ name: 'Others (' + (D.stores.length - 6) + ')', v: rest, c: COL[6] });
  h += '<div class="card pad col" style="gap:14px"><div class="row"><b class="ttl">Share by store</b><span class="note">' + totalArt + ' articles · ' + D.E.length + ' slips</span></div>' +
    '<div class="donutwrap"><div class="donut">' + donut(top, 180) + '<div class="dc"><b>' + D.stores.length + '</b><span>stores</span></div></div>' +
    '<div class="legend">' + top.map(p => '<div><i style="background:' + p.c + '"></i><span>' + esc(p.name) + '</span><b>' + Math.round(p.v / totalArt * 100) + '%</b></div>').join('') + '</div></div></div>';
  // top items
  const ti = D.items.slice().sort((a, b) => Object.keys(b.stores).length - Object.keys(a.stores).length || b.qty - a.qty).slice(0, 8), mx = Math.max(...ti.map(x => Object.keys(x.stores).length));
  h += '<div class="card pad col" style="gap:4px"><div class="row" style="margin-bottom:6px"><b class="ttl">Most issued items</b><span class="note">by number of stores</span></div>' +
    ti.map((x, k) => '<div class="consrow"><span><b>' + esc(itemName(x.code)) + '</b><span>' + Object.keys(x.stores).length + ' stores</span></span>' + bar(Object.keys(x.stores).length, mx, COL[k % 6]) + '<b class="qty">' + num(Math.round(x.qty * 1000) / 1000) + ' <small>' + esc(itemUom(x.code)) + '</small></b></div>').join('') + '</div>';
  // details
  h += '<div class="shead"><div><h2>Details</h2><span>Tap a ' + (C.mode === 'store' ? 'store' : 'item') + ' to open it</span></div></div>';
  h += '<div class="seg"><button data-a="consM" data-v="store" class="' + (C.mode === 'store' ? 'on' : '') + '">Stores</button><button data-a="consM" data-v="item" class="' + (C.mode === 'item' ? 'on' : '') + '">Items</button></div>';
  h += '<div class="card" style="overflow:hidden">';
  if (C.mode === 'store') {
    const maxN = Math.max(...D.stores.map(x => x.n));
    D.stores.forEach((so, k) => { const its = Object.values(so.items).sort((a, b) => b.qty - a.qty), open = !!C.open['s' + so.store];
      h += '<button class="consh" data-a="consO" data-v="s' + esc(so.store) + '"><i class="cdot" style="background:' + COL[Math.min(k, 6)] + '"></i><span class="cn"><b>' + esc(so.store) + '</b><span>' + so.slips.size + ' slips · ' + its.length + ' items</span></span>' + bar(so.n, maxN, COL[Math.min(k, 6)]) + '<b class="cv">' + so.n + '</b>' + ico(open ? 'up' : 'down', 16) + '</button>';
      if (open) h += '<div class="leftbox" style="background:var(--soft)">' + its.map(x => '<div class="leftrow"><span><b>' + esc(itemName(x.code)) + '</b><span class="mono">' + esc(x.code) + ' · issued ' + x.n + 'x</span></span><b class="qty">' + num(Math.round(x.qty * 1000) / 1000) + ' ' + esc(itemUom(x.code)) + '</b></div>').join('') + '</div>'; });
  } else {
    D.items.slice(0, 120).forEach(x => { const sts = Object.entries(x.stores).sort((a, b) => b[1] - a[1]), open = !!C.open['i' + x.code];
      h += '<button class="consh" data-a="consO" data-v="i' + esc(x.code) + '"><span class="cn"><b>' + esc(itemName(x.code)) + '</b><span>' + esc(x.code) + ' · ' + sts.length + ' stores</span></span><b class="cv">' + num(Math.round(x.qty * 1000) / 1000) + ' <small>' + esc(itemUom(x.code)) + '</small></b>' + ico(open ? 'up' : 'down', 16) + '</button>';
      if (open) h += '<div class="leftbox" style="background:var(--soft)">' + sts.map(([st, q], k) => '<div class="consrow"><span><b>' + esc(st) + '</b></span>' + bar(q, sts[0][1], COL[k % 6]) + '<b class="qty">' + num(Math.round(q * 1000) / 1000) + '</b></div>').join('') + '</div>'; });
  }
  h += '</div><button class="btn" data-a="consExport">Download full report</button>';
  return h + '</main>';
}
function vCheck() {
  const I = dataIssues();
  let h = '<header class="top"><div><button class="btn sm ghost" data-a="back">‹ Back</button><h1 style="margin-top:10px">Data check</h1><div class="sub">Finds clashes and errors in your data, with a button to fix each one.</div></div></header><main>';
  if (!I.length) return h + '<div class="okbox">' + ico('right', 16).replace('M9 6l6 6-6 6', 'M5 12.5l4.5 4.5L19 7.5') + '<span>All clear. No clashes or errors found in ' + S.lines.length + ' articles and ' + S.entries.length + ' slips.</span></div></main>';
  h += '<div class="banner" style="background:#FFE4EA;color:#8E1B3A;border:0"><b>' + I.length + ' things to check.</b> Nothing changes until you tap a button.</div>';
  I.forEach(x => {
    if (x.kind === 'multi') h += '<div class="card pad col" style="gap:10px"><div class="row"><span class="reqno" data-req="' + esc(x.req) + '">' + esc(x.req) + '</span>' + pill('Used by ' + x.stores.length + ' stores', 'c-no') + '</div><div class="note">One Request No should belong to one store. Give the wrong one a new number.</div>' +
      x.stores.map(o => '<div class="row" style="align-items:center"><span><b>' + esc(o.st) + '</b><div class="meta"><span>' + o.n + ' articles</span>' + (o.issued ? '<i></i><span>has issued slips</span>' : '') + '</div></span><button class="btn sm" data-a="dcRenum" data-v="' + esc(x.req) + '" data-s="' + esc(o.st) + '">Renumber</button></div>').join('') + '</div>';
    if (x.kind === 'dupline') h += '<div class="card pad col" style="gap:10px"><div class="row"><span class="reqno" data-req="' + esc(x.req) + '">' + esc(x.req) + '</span>' + pill('Item twice', 'c-gd') + '</div><div><b>' + esc(itemName(x.code)) + '</b> <span class="mono note">' + esc(x.code) + '</span><div class="meta"><span>' + esc(x.store) + '</span><i></i><span>qty ' + x.qtys.map(num).join(' + ') + '</span></div></div><div class="grid2"><button class="btn sm" data-a="dcMerge" data-v="' + x.lines.join(',') + '">Merge into one (' + num(x.qtys.reduce((a, b) => a + b, 0)) + ')</button><button class="btn sm ghost" data-a="dcKeepFirst" data-v="' + x.lines.join(',') + '">Keep first only</button></div></div>';
    if (x.kind === 'dates') h += '<div class="card pad col" style="gap:10px"><div class="row"><span class="reqno" data-req="' + esc(x.req) + '">' + esc(x.req) + '</span>' + pill('Mixed dates', 'c-gd') + '</div><div class="note">Articles of this request have different dates: ' + x.dates.map(fmtShort).join(', ') + '.</div><div class="grid2"><button class="btn sm" data-a="dcDate" data-v="' + esc(x.req) + '" data-d="' + x.dates[0] + '">Use ' + fmtShort(x.dates[0]) + '</button><button class="btn sm ghost" data-a="dcDate" data-v="' + esc(x.req) + '" data-d="' + x.dates[x.dates.length - 1] + '">Use ' + fmtShort(x.dates[x.dates.length - 1]) + '</button></div></div>';
    if (x.kind === 'bad') h += '<div class="card pad col" style="gap:10px"><div class="row"><b>Incomplete articles</b>' + pill(x.n, 'c-no') + '</div><div class="note">Missing Request No, store, item code or qty.</div><button class="btn sm" data-a="dcBad" data-v="' + x.ids.join(',') + '">Remove ' + x.n + ' incomplete article' + (x.n > 1 ? 's' : '') + '</button></div>';
    if (x.kind === 'slip') h += '<div class="card pad col" style="gap:6px"><div class="row"><b>Slip ' + esc(x.slip) + ' used ' + x.n + ' times</b>' + pill('Check', 'c-no') + '</div><div class="note">' + esc(x.stores.join(', ')) + '. Edit the wrong one in Registers.</div><button class="btn sm ghost" data-a="dcSlip" data-v="' + esc(x.slip) + '">Show in Search</button></div>';
    if (x.kind === 'nostock') h += '<div class="card pad col" style="gap:6px"><div class="row"><b>Items not in the stock sheet</b>' + pill(x.n, 'c-gd') + '</div><div class="note mono">' + esc(x.codes.slice(0, 20).join(', ')) + (x.codes.length > 20 ? '…' : '') + '</div><div class="note">Upload a fresh stock report, or correct the item code in the request.</div></div>';
  });
  return h + '</main>';
}
function renumberReq(from, to) {
  to = String(to || '').trim(); if (!to || to === from) return false;
  if (S.lines.some(l => l.req === to)) { toast('Request No ' + to + ' already exists.'); return false; }
  S.lines.forEach(l => { if (l.req === from) l.req = to; });
  S.entries.forEach(e => e.items.forEach(i => { if (i.req === from) i.req = to; }));
  if (ui.lastReq === from) ui.lastReq = to;
  return true;
}
const UNDO_KEYS = ['lines', 'entries', 'returns', 'hold', 'corrections', 'audit'];
const UNDOABLE = { artQty: 'Quantity changed', artHold: 'Hold changed', artDel: 'Article removed', artsBHold: 'Articles put on hold', artsBRel: 'Articles released', artsBDel: 'Articles removed', dropReq: 'Request removed', dropStore: 'Store pending removed',
  renumReq: 'Request renumbered', dcRenum: 'Request renumbered', impRenum: 'Request renumbered', impDrop: "App's request removed", corrSave: 'Correction saved', markSave: 'Slip added', dcMerge: 'Items merged', dcKeepFirst: 'Duplicate removed', dcDate: 'Date changed', dcBad: 'Incomplete removed',
  bulkSave: 'Requests edited', delEntry: 'Entry deleted', delReturn: 'Return deleted', rsClose: 'Article closed', rsOpen: 'Article made pending', rsAll: 'Request completed', rsAdd: 'Article added', saveReq: 'Request edited', saveEntry: 'Entry saved', uploadOk: 'Import done', btSave: 'Batch saved', nrSave: 'Request added', hold: 'Hold changed' };
const UNDO_STOCK = new Set(['markSave', 'delEntry', 'saveEntry', 'uploadOk']);
let undoTimer = null;
function undoArm(a) { const snap = {}; UNDO_KEYS.concat(UNDO_STOCK.has(a) ? ['stock', 'stockAt', 'stockSrc'] : []).forEach(k => snap[k] = JSON.stringify(S[k] == null ? null : S[k])); ui.pendUndo = { a, label: UNDOABLE[a], snap, at: Date.now() }; }
function undoFire() { const u = ui.pendUndo; ui.pendUndo = null; if (!u || Date.now() - u.at > 120000) return; ui.undo = u; showUndo(); }
function showUndo() {
  let el = document.getElementById('undobar'); if (!el) { el = document.createElement('div'); el.id = 'undobar'; document.body.appendChild(el); }
  const u = ui.undo; if (!u) { el.innerHTML = ''; return; }
  let n = 5; const paint = () => { el.innerHTML = '<div class="undob"><span>' + esc(u.label) + '</span><button data-a="undoDo">Undo · ' + n + '</button></div>'; };
  ui.undoAt = Date.now(); paint(); clearInterval(undoTimer); undoTimer = setInterval(() => { n--; if (n <= 0 || ui.undo !== u) { clearInterval(undoTimer); if (ui.undo === u) { ui.undo = null; el.innerHTML = ''; } return; } paint(); }, 1000);
}
function uiConfirm(msg, okLabel, danger) {
  return new Promise(res => {
    let el = document.getElementById('dlg'); if (!el) { el = document.createElement('div'); el.id = 'dlg'; document.body.appendChild(el); }
    el.innerHTML = '<div class="pkbg"></div><div class="dlgbox" role="dialog" aria-modal="true"><div class="dlgic' + (danger ? ' no' : '') + '">' + ico('alert', 26) + '</div><div class="dlgmsg">' + esc(msg) + '</div><div class="grid2"><button class="btn" data-dlg="0">Cancel</button><button class="btn main' + (danger ? ' danger' : '') + '" data-dlg="1">' + esc(okLabel || 'OK') + '</button></div></div>';
    el.querySelectorAll('[data-dlg]').forEach(b => b.onclick = e => { e.stopPropagation(); el.innerHTML = ''; res(b.dataset.dlg === '1'); });
  });
}
function curFY() { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 3 ? y + '-' + (y + 1) : (y - 1) + '-' + y; }
function autoStockCfg() { S.autoStock = Object.assign({ on: true, store: 'Ration Store', fy: '' }, S.autoStock || {}); return S.autoStock; }
function openLiveStock() {
  const c = autoStockCfg();
  if (c.on && N && N.openMgrAuto) { N.openMgrAuto(JSON.stringify({ run: Date.now(), store: c.store || 'Ration Store', fy: c.fy || curFY() })); return; }
  if (N && N.openMgr) N.openMgr(); else toast('Update the app (Settings > App and updates) to use Manager CUIMS.');
}
window.jvStockFile = (b64, name) => { loader(true, 'Reading the stock file'); setTimeout(() => { try { jvStockFile2(b64, name); } finally { loader(false); } }, 60); };
function jvStockFile2(b64, name) {
  try {
    if (!window.XLSX) { toast('Excel tools not loaded yet. Check internet and try again.'); return; }
    const wb = XLSX.read(b64, { type: 'base64', cellDates: false });
    ui.view = null; ui.tab = 'home';
    ui.upload = { kind: 'stock', wb, auto: true, name: name || 'Live stock' };
    ui.upload.result = parseStock(wb);
    if (ui.upload.result.error) ui.upload.error = ui.upload.result.error;
    ui.sheet = { kind: 'upload' }; render(); renderSheet();
    
  } catch (e) { toast('Could not read the downloaded stock file: ' + e.message); }
}
function enhanceDates(root) {
  (root || document).querySelectorAll('input[type="date"]').forEach(inp => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'datebtn'; b.dataset.dp = '1';
    const paint = () => { b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>' + (inp.value ? fmtLong(inp.value) : 'Choose date') + '</span>'; b.classList.toggle('empty', !inp.value); };
    inp.type = 'hidden'; inp.parentNode.insertBefore(b, inp); paint();
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); openCal(inp, paint); };
  });
}
function openCal(inp, paint) {
  let el = document.getElementById('cal'); if (!el) { el = document.createElement('div'); el.id = 'cal'; document.body.appendChild(el); }
  const sel = inp.value || '', base = sel ? new Date(sel + 'T12:00') : new Date();
  let y = base.getFullYear(), m = base.getMonth();
  const draw = () => {
    const first = new Date(y, m, 1, 12), start = (first.getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
    let cells = ''; for (let i = 0; i < start; i++) cells += '<span></span>';
    for (let d = 1; d <= dim; d++) { const iso = y + '-' + pad(m + 1) + '-' + pad(d); cells += '<button class="cd' + (iso === sel ? ' on' : '') + (iso === today() ? ' td' : '') + '" data-cd="' + iso + '">' + d + '</button>'; }
    el.innerHTML = '<div class="pkbg" data-cx="1"></div><div class="calbox" role="dialog" aria-label="Choose date"><div class="calhead"><button class="xbtn" data-cm="-1" aria-label="Previous month">' + ico('up', 18).replace('M6 15l6-6 6 6', 'M15 6l-6 6 6 6') + '</button><b>' + new Date(y, m, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' }) + '</b><button class="xbtn" data-cm="1" aria-label="Next month">' + ico('right', 18) + '</button></div>' +
      '<div class="calgrid wk">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(w => '<span>' + w + '</span>').join('') + '</div><div class="calgrid">' + cells + '</div>' +
      '<div class="grid3"><button class="btn" data-cq="clear">Clear</button><button class="btn" data-cq="today">Today</button><button class="btn main" data-cx="1">Close</button></div></div>';
  };
  const done = v => { inp.value = v; paint(); el.innerHTML = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
  el.onclick = e => { const t = e.target.closest('[data-cd],[data-cm],[data-cq],[data-cx]'); if (!t) return; e.stopPropagation();
    if (t.dataset.cd) done(t.dataset.cd); else if (t.dataset.cm) { m += +t.dataset.cm; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } draw(); }
    else if (t.dataset.cq === 'today') done(today()); else if (t.dataset.cq === 'clear') done(''); else el.innerHTML = ''; };
  draw();
}
function renderPicker() {
  let el = document.getElementById('picker'); if (!el) { el = document.createElement('div'); el.id = 'picker'; document.body.appendChild(el); }
  const p = ui.picker; if (!p) { el.innerHTML = ''; return; }
  const cfg = PICKS[p.id]; if (!cfg) { el.innerHTML = ''; return; }
  const search = cfg.search || cfg.opts.length > 8;
  el.innerHTML = '<div class="pkbg" data-a="pickClose"></div><div class="pkpanel" role="dialog" aria-label="' + esc(cfg.title) + '"><div class="pkhead"><b>' + esc(cfg.title) + '</b><button class="xbtn" data-a="pickClose" aria-label="Close">' + ico('x', 18) + '</button></div>' +
    (search ? '<div style="padding:0 16px 8px"><input type="text" data-pkq="1" value="' + esc(p.q || '') + '" placeholder="Search" autocomplete="off"></div>' : '') +
    '<div class="pklist">' + pickList() + '</div></div>';
}
function pickList() {
  const p = ui.picker, cfg = PICKS[p.id]; const q = String(p.q || '').toUpperCase();
  const list = cfg.opts.filter(o => !q || String(o[1]).toUpperCase().includes(q) || String(o[0]).toUpperCase().includes(q));
  return (list.length ? list.map(o => '<button class="pkitem' + (o[0] === cfg.val ? ' on' : '') + '" data-a="pickSet" data-v="' + esc(o[0]) + '"><span>' + esc(o[1]) + (o[2] ? '<small>' + esc(o[2]) + '</small>' : '') + '</span>' + (o[0] === cfg.val ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '') + '</button>').join('') : '<div class="note" style="padding:14px 18px">No match.</div>');
}
function sortSel(k, opts) { return '<select data-sort="' + k + '" style="width:auto;min-height:38px;font-size:14px;padding:0 8px">' + opts.map(([v, l]) => '<option value="' + v + '"' + (ui.sort[k] === v ? ' selected' : '') + '>Sort: ' + l + '</option>').join('') + '</select>'; }
function storeRank(st) { const o = S.storeOrder || []; const i = o.indexOf(st); return i < 0 ? 9999 : i; }
function byStore(a, b) { return storeRank(a) - storeRank(b) || a.localeCompare(b); }
function oldestOf(L) { return L.reduce((m, l) => l.date < m ? l.date : m, '9999'); }
function bulkList() {
  const PL = plan();
  return requests().map(r => Object.assign(r, reqState(r, PL))).filter(r => r.w.length).sort((a, b) => a.date.localeCompare(b.date) || a.req.localeCompare(b.req, undefined, { numeric: true }));
}
function shBulk() {
  const f = ui.form;
  let h = '<div class="row"><h2>Edit all requests</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="note">Set Slip No, date and receiver for every open request at once. Slip No is used for the next entry of that request.</div>';
  h += '<div class="card pad col"><b>Same date for all</b><div class="grid2"><input type="date" data-bulkdate="1" value="' + esc(f.allDate || today()) + '"><button class="btn" data-a="bulkDate">Apply to all</button></div></div>';
  h += '<div class="card pad col"><b>Auto-number Slip Nos</b><div class="grid2"><input type="text" data-bulkstart="1" value="' + esc(f.start) + '" class="mono" placeholder="First slip, e.g. JV/920" autocapitalize="characters"><button class="btn" data-a="bulkAuto">Fill in order</button></div><div class="note">Fills empty Slip boxes below, top to bottom, counting up.</div></div>';
  f.rows.forEach((r, i) => {
    h += '<div class="card pad col" style="gap:8px"><div class="row"><b>' + esc(r.store) + '</b><span class="note">Request ' + esc(r.req) + ' · ' + r.n + ' open</span></div>' +
      '<div class="grid2"><label class="f">Slip No<input type="text" data-br="' + i + '|slip" value="' + esc(r.slip) + '" class="mono" autocapitalize="characters"></label><label class="f">Request No<input type="text" data-br="' + i + '|newReq" value="' + esc(r.newReq) + '" class="mono"></label></div>' +
      '<div class="grid2"><label class="f">Request date<input type="date" data-br="' + i + '|date" value="' + esc(r.date) + '"></label><label class="f">Receiver (6 digits)<input type="text" data-br="' + i + '|rcv" value="' + esc(r.rcv) + '" class="mono" inputmode="numeric" maxlength="6"></label></div></div>';
  });
  h += '<button class="btn main full" data-a="bulkSave">Save all</button>';
  return h;
}
function shMark() {
  const f = ui.form;
  let h = '<div class="row"><h2>Mark as issued</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="note">Use this when the entry is already submitted on CUIMS but the app did not record it. Stock and pending update like a normal entry.</div>';
  h += '<div class="grid2"><label class="f">Slip No<input type="text" data-f="slip" value="' + esc(f.slip) + '" class="mono" autocapitalize="characters"></label><label class="f">Serial No<input type="text" data-f="serial" value="' + esc(f.serial) + '" class="mono" inputmode="numeric"></label></div>';
  h += '<div class="grid2"><label class="f">Receiver (6 digits)<input type="text" data-f="rcv" value="' + esc(f.rcv) + '" class="mono" inputmode="numeric" maxlength="6"></label><label class="f">Date<input type="date" data-f="date" value="' + esc(f.date) + '"></label></div>';
  h += '<div class="sect">Articles in this entry</div><div class="card">' + f.lines.map(l => '<label class="line chk" style="flex-direction:row;gap:10px"><input type="checkbox" data-a="markPick" data-v="' + l.id + '"' + (f.pick[l.id] ? ' checked' : '') + '><span><b>' + esc(itemName(l.code)) + '</b><br><span class="note mono">' + esc(l.code) + ' · ' + num(l.qty) + ' ' + esc(itemUom(l.code)) + '</span></span></label>').join('') + '</div>';
  h += '<button class="btn main full" data-a="markSave">Save as issued</button>';
  return h;
}
function shEditReq() {
  const f = ui.form;
  let h = '<div class="row"><h2>Edit request ' + esc(f.req) + '</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div><div class="note">Only waiting articles can be changed. Issued ones stay as recorded.</div>';
  h += '<label class="f">Store<input type="text" data-f="store" list="areaList" value="' + esc(f.store) + '" autocapitalize="characters"></label>' + areaDatalist();
  h += '<div class="grid2"><label class="f">Request date<input type="date" data-f="date" value="' + esc(f.date) + '"></label><label class="f">Receiver for this request<input type="text" data-f="rcv" value="' + esc(f.rcv) + '" class="mono" inputmode="numeric" maxlength="6"></label></div>';
  h += '<label class="f">Slip No for the next entry<input type="text" data-f="slip" value="' + esc(f.slip || '') + '" class="mono" autocapitalize="characters" placeholder="optional"></label>';
  h += '<label class="f">Custom remark (optional)<input type="text" data-f="remark" value="' + esc(f.remark || '') + '" placeholder="Replaces Requisition Requested on …"></label>';
  h += '<div class="sect">Waiting articles</div>' + itemRowsHtml(f.items, true) + '<button class="btn ghost" data-a="addItem">+ Add article</button>';
  h += '<button class="btn main full" data-a="saveReq">Save request</button>';
  return h;
}

/* ---------------- lock ---------------- */
const GUARDED = new Set(['mrSave', 'mrRemove', 'manReqToggle', 'msSave', 'artQty', 'artHold', 'artDel', 'artsBHold', 'artsBRel', 'artsBDel', 'testToggle', 'testClear', 'dcRenum', 'dcMerge', 'dcKeepFirst', 'dcDate', 'dcBad', 'renumReq', 'impRenum', 'impDrop', 'credSave', 'credDel', 'corrOpen', 'corrSave', 'bulkEdit', 'bulkSave', 'dropReq', 'dropStore', 'editReq', 'saveReq', 'markDone', 'markSave', 'newManual', 'saveEntry', 'delEntry', 'newReturn', 'saveReturn', 'delReturn',
  'rmStore', 'addStore', 'wipe', 'restore', 'bkRestore', 'bkDel', 'bkKeep', 'bkSave', 'bkNoteSave', 'photo', 'photoDel', 'mode', 'lockToggle', 'syncAuto', 'mgrToggle', 'moveStore', 'saveUrls', 'resetZoom', 'hold', 'cropSave']);
let pendingAuth = null;
function askUnlock(after) {
  pendingAuth = after || null;
  if (N && N.authenticate) N.authenticate(); else uiConfirm('Unlock editing?').then(ok => window.jvAuth(ok));
}
window.jvAuth = ok => { if (ok) { ui.locked = false; render(); renderSheet(); const f = pendingAuth; pendingAuth = null; if (f) f(); } else toast('Still locked.'); };
window.jvRelock = () => { if (!ui.locked) { ui.locked = true; render(); renderSheet(); } };

/* ---------------- actions ---------------- */
const later = fn => setTimeout(fn, 0);
function focusKey(el) { if (!el) return null; for (const a of ['data-in', 'data-f', 'data-it', 'data-set', 'data-store-rcv', 'data-store-name', 'data-nr', 'data-bt']) if (el.hasAttribute && el.hasAttribute(a)) return [a, el.getAttribute(a), el.selectionStart]; return null; }
function refocus(k) { if (!k) return; const el = document.querySelector('[' + k[0] + '="' + CSS.escape(k[1]) + '"]'); if (el) { el.focus(); try { if (k[2] != null) el.setSelectionRange(k[2], k[2]); } catch (e) {} } }
function blankItem() { return { code: '', name: '', uom: '', qty: '', remark: '' }; }
function fillItemMeta(it) { it.code = String(it.code || '').trim().toUpperCase(); if (S.stock[it.code]) { it.name = S.stock[it.code].name; it.uom = S.stock[it.code].uom; } else { const f = findItemAnywhere(it.code); if (f) { it.name = f.name; it.uom = f.uom; } } }
function cleanItems(items) { return items.map(i => { fillItemMeta(i); return { code: i.code, name: i.name || '', uom: i.uom || '', qty: parseFloat(i.qty), remark: (i.remark || '').trim(), req: i.req || '', lineId: i.lineId }; }).filter(i => i.code && i.qty > 0); }

document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const el = ev.target;
  if (el.dataset && el.dataset.bt === 'q') { ev.preventDefault(); const f = document.querySelector('#bthits .hit'); if (f) f.click(); }
  else if (el.dataset && el.dataset.bq) { ev.preventDefault(); const [gi, ii] = el.dataset.bq.split('|'); ui.form.groups[+gi].items[+ii].qty = el.value; renderSheet(); const i = document.querySelector('[data-bt="q"]'); if (i) { i.focus(); i.scrollIntoView({ block: 'center' }); } }
  else if (el.dataset && el.dataset.nr === 'q') { ev.preventDefault(); const f = document.querySelector('[data-a=nrPick]'); if (f) f.click(); }
});
document.addEventListener('click', ev => {
  const q = ev.target.closest && ev.target.closest('[data-req]');
  if (q && q.dataset.req && q.dataset.req !== '–') { ui.lastReq = q.dataset.req; document.querySelectorAll('.rcard.sel,.selrow').forEach(x => x.classList.remove('sel', 'selrow')); document.querySelectorAll('[data-req="' + CSS.escape(ui.lastReq) + '"]').forEach(x => { const c = x.closest('.rcard,.card,.line'); if (c) c.classList.add(c.classList.contains('line') ? 'selrow' : 'sel'); }); }
}, true);
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, v = t.dataset.v;
  if (a === 'undoDo') { const u = ui.undo; if (!u) return; Object.entries(u.snap).forEach(([k, j]) => { S[k] = JSON.parse(j); }); ui.undo = null; clearInterval(undoTimer); showUndo(); ui.pendUndo = null; save(true); render(); renderSheet(); toast('Undone: ' + u.label + '.'); return; }
  if (UNDOABLE[a] && !(ui.locked && GUARDED.has(a))) undoArm(a); else if (!/^(pick|pickSet|pickClose|tab|back)$/.test(a)) ui.pendUndo = null;
  if (a === 'lockTap') { if (ui.locked) askUnlock(); else { ui.locked = true; render(); renderSheet(); } return; }
  if (ui.locked && GUARDED.has(a)) { ev.preventDefault(); if (t.type === 'checkbox') t.checked = !t.checked; const sel = '[data-a="' + a + '"]' + (v != null ? '[data-v="' + CSS.escape(v) + '"]' : ''); askUnlock(() => { const el = document.querySelector(sel); if (el) el.click(); }); return; }
  if (a === 'bgClose') { if (ev.target === t) { ui.sheet = null; renderSheet(); } return; }
  if (t.type === 'checkbox' && !['hold', 'queueToggle', 'regItems', 'mgrToggle', 'syncAuto', 'lockToggle', 'markPick', 'stOn', 'rpTog', 'rpCol', 'autoSubToggle', 'queuePend', 'credAuto', 'artsSel', 'artsAll', 'autoStockTog'].includes(a)) return;
  const _busy = BUSY[a];
  if (_busy && !(ui.locked && GUARDED.has(a))) { loader(true, _busy); await new Promise(r => setTimeout(r, 40)); }
  try {
  switch (a) {
    case 'tab': ui.tab = v; ui.view = null; if (v === 'set') ui.setPage = null; render(); window.scrollTo(0, 0); break;
    case 'openSite': if (N) N.openSite(); else toast('Open this inside the app.'); break;
    case 'goUpdate': ui.tab = 'set'; ui.view = null; render(); setTimeout(() => { const u = document.getElementById('upd'); if (u) u.scrollIntoView(); }, 50); break;
    case 'upload': ui.upload = null; ui.sheet = { kind: 'upload' }; renderSheet(); break;
    case 'template': template(); break;
    case 'openReq': ui.lastReq = v; ui.view = 'req'; ui.req = v; render(); window.scrollTo(0, 0); break;
    case 'back': ui.view = null; render(); break;
    case 'hold': if (t.checked) S.hold[v] = 1; else delete S.hold[v]; save(); render(); break;
    case 'fillReq': { ui.lastReq = v; const PL = plan(); const r = requests().find(x => x.req === v); const ids = r.lines.filter(l => l.status === 'waiting' && PL[l.id] === 'issue').map(l => l.id); openStart(r.store, ids, r.store + ', request ' + r.req); break; }
    case 'fillReqPend': { ui.lastReq = v; const PL = plan(); const r = requests().find(x => x.req === v); const ids = r.lines.filter(l => isPending(l) && PL[l.id] === 'issue').map(l => l.id); if (!ids.length) break; openStart(r.store, ids, r.store + ' · ' + r.req); break; }
    case 'fltClear': { const [k, key] = v.split('|'); const f = fltGet(k); f[key] = ''; if ((k === 'done' || k === 'reg') && !f.rd && !f.id) { f.id = today(); toast('At least one date is needed. Issue date set to today.'); } if (k === 'reg') ui.reg.date = f.id || ui.reg.date; render(); break; }
    case 'fillStore': { const PL = plan(); const ids = S.lines.filter(l => isPending(l) && l.store === v && PL[l.id] === 'issue').map(l => l.id); openStart(v, ids, v + ', pending clearance'); break; }
    case 'editReq': { const r = requests().find(x => x.req === v); const w = r.lines.filter(l => l.status === 'waiting');
      ui.form = { req: v, store: r.store, date: r.date, rcv: (r.lines.find(l => l.rcv) || {}).rcv || '', slip: (w.find(l => l.slip) || {}).slip || '', remark: (w.find(l => l.remark) || {}).remark || '', items: w.map(l => ({ lineId: l.id, code: l.code, qty: l.qty, name: itemName(l.code), uom: itemUom(l.code) })) };
      ui.sheet = { kind: 'editReq' }; renderSheet(); break; }
    case 'dropReq': if (await uiConfirm('Remove request ' + v + ' (' + ((requests().find(x => x.req === v) || {}).store || '') + ') from the list? Waiting articles are removed; issued ones stay in the records.')) { S.lines.forEach(l => { if (l.req === v && l.status === 'waiting') l.status = 'dropped'; }); save(); ui.view = null; render(); } break;
    case 'saveReq': { const f = ui.form; if (f.rcv && !/^\d{6}$/.test(f.rcv)) { toast('Receiver must be 6 digits or blank.'); break; }
      const items = cleanItems(f.items); const keep = new Set(items.filter(i => i.lineId).map(i => i.lineId));
      const sl = (f.slip || '').trim().toUpperCase(); if (sl && !SLIP_RE.test(sl)) { toast('Slip No must be 2–10 characters with a digit.'); break; }
      S.lines.forEach(l => { if (l.req !== f.req) return; l.store = f.store.trim().toUpperCase(); l.date = f.date || l.date; l.rcv = f.rcv || ''; if (l.status === 'waiting') { l.slip = sl; l.remark = (f.remark || '').trim(); } if (l.status === 'waiting' && !keep.has(l.id)) l.status = 'dropped'; });
      items.forEach(i => { if (i.lineId) { const l = S.lines.find(x => x.id === i.lineId); l.code = i.code; l.qty = i.qty; } else S.lines.push({ id: nid(), req: f.req, store: f.store.trim().toUpperCase(), date: f.date, code: i.code, qty: i.qty, rcv: f.rcv || '', slip: sl, src: 'new', earlier: '', status: 'waiting', issued: [] }); });
      save(); ui.sheet = null; renderSheet(); render(); toast('Request saved.'); break; }
    case 'bulkEdit': ui.form = { start: nextSlip(), allDate: today(), rows: bulkList().map(r => ({ req: r.req, newReq: r.req, store: r.store, n: r.w.length, slip: (r.w.find(l => l.slip) || {}).slip || '', date: r.date, rcv: (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '' })) }; ui.sheet = { kind: 'bulk' }; renderSheet(); break;
    case 'bulkAuto': { const f = ui.form; const m = String(f.start || '').trim().toUpperCase().match(/^(.*?)(\d+)$/); if (!m) { toast('Type the first Slip No, ending in a number, e.g. JV/920'); break; }
      const used = allSlips(); f.rows.forEach(r => used.has((r.slip || '').toUpperCase()) || r.slip ? used.add(r.slip.toUpperCase()) : 0);
      let n = parseInt(m[2], 10);
      f.rows.forEach(r => { if (r.slip) return; let sl; do { sl = m[1] + String(n).padStart(m[2].length, '0'); n++; } while (used.has(sl.toUpperCase())); used.add(sl.toUpperCase()); r.slip = sl; });
      renderSheet(); break; }
    case 'bulkDate': ui.form.rows.forEach(r => r.date = ui.form.allDate || today()); renderSheet(); break;
    case 'bulkSave': { const f = ui.form; const bad = f.rows.find(r => (r.slip && !SLIP_RE.test(r.slip)) || (r.rcv && !/^\d{6}$/.test(r.rcv)) || !String(r.newReq || '').trim());
      const reqClash = f.rows.find(r => r.newReq.trim() !== r.req && S.lines.some(l => l.req === r.newReq.trim()));
      if (reqClash) { toast('Request No ' + reqClash.newReq + ' already exists. Use another.'); break; }
      if (bad) { toast('Check ' + bad.store + ': Slip 2–10 chars with a digit, receiver 6 digits.'); break; }
      const seen = {}; const used = allSlips(); const clash = f.rows.find(r => r.slip && (seen[r.slip] || used.has(r.slip)) ? true : (seen[r.slip] = 1, false));
      if (clash) { toast('Slip ' + clash.slip + ' is used twice or already used. Change it.'); break; }
      f.rows.forEach(r => S.lines.forEach(l => { if (l.req !== r.req) return; if (r.date) l.date = r.date; l.rcv = r.rcv || ''; if (l.status === 'waiting') l.slip = r.slip || ''; l.req = r.newReq.trim(); }));
      S.entries.forEach(e => e.items.forEach(i => { const r = f.rows.find(x => x.req === i.req); if (r) i.req = r.newReq.trim(); }));
      save(); ui.sheet = null; renderSheet(); render(); toast('All requests updated.'); break; }
    case 'markDone': { const PL = plan(); const r = requests().find(x => x.req === v); const w = r.lines.filter(l => l.status === 'waiting'); const pick = {}; w.forEach(l => { if (PL[l.id] === 'issue') pick[l.id] = 1; });
      ui.form = { req: v, store: r.store, slip: plannedSlip(w.map(l => l.id)) || '', serial: '', rcv: (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '', date: today(), lines: w, pick };
      ui.sheet = { kind: 'mark' }; renderSheet(); break; }
    case 'markPick': if (t.checked) ui.form.pick[v] = 1; else delete ui.form.pick[v]; break;
    case 'markSave': { const f = ui.form; const slip = (f.slip || '').trim().toUpperCase(); const sp = slipProblem(slip);
      if (sp) { toast(sp); break; } if (!/^\d{6}$/.test(f.rcv)) { toast('Receiver must be 6 digits.'); break; }
      const ls = f.lines.filter(l => f.pick[l.id]); if (!ls.length) { toast('Tick at least one article.'); break; }
      const at = new Date(f.date + 'T' + timeNow()).toISOString();
      S.entries.push({ id: nid(), slip, serial: (f.serial || '').trim(), store: f.store, rcv: f.rcv, rname: rname(f.rcv), at, date: f.date, time: timeNow(), by: meTag(), kind: 'manual', remarks: 'marked by hand',
        items: ls.map(l => ({ lineId: l.id, req: l.req, code: l.code, name: itemName(l.code), uom: itemUom(l.code), qty: l.qty, remark: remarkFor(l.date) })) });
      ls.forEach(l => { const x = S.lines.find(y => y.id === l.id); x.status = 'issued'; x.issued.push({ slip, serial: (f.serial || '').trim(), at }); if (S.stock[l.code]) S.stock[l.code].qty = Math.round((S.stock[l.code].qty - l.qty) * 1000) / 1000; });
      save(); ui.sheet = null; renderSheet(); render(); toast('Recorded ' + slip + ' as issued.'); break; }
    case 'expPendPdf': openExport('pending'); break;
    case 'setPage': ui.setPage = v; render(); window.scrollTo(0, 0); break;
    case 'setBack': ui.setPage = null; render(); window.scrollTo(0, 0); break;
    case 'goProfile': ui.tab = 'set'; ui.view = null; ui.setPage = 'profile'; render(); window.scrollTo(0, 0); break;
    case 'togStore': ui.openStore[v] = !ui.openStore[v]; render(); break;
    case 'dropStore': { const n = S.lines.filter(l => isPending(l) && l.store === v).length;
      if (await uiConfirm('Remove all ' + n + ' pending articles of ' + v + '? Issued records stay. (You can restore from a cloud backup if needed.)')) { S.lines.forEach(l => { if (isPending(l) && l.store === v) l.status = 'dropped'; }); save(); render(); toast(v + ' removed from Pending.'); } break; }
    case 'photo': document.getElementById('photoIn').click(); break;
    case 'openMgr': openLiveStock(); break;
    case 'openMgrManual': if (N && N.openMgr) N.openMgr(); break;
    case 'autoStockTog': S.autoStock = autoStockCfg(); S.autoStock.on = !S.autoStock.on; save(true); render(); toast('Auto update ' + (S.autoStock.on ? 'on' : 'off') + '.'); break;
    case 'saveUrls': { const e = ui.urlEmp != null ? ui.urlEmp : INFO.urlEmp, m = ui.urlMgr != null ? ui.urlMgr : INFO.urlMgr;
      if (N && N.setUrls) { N.setUrls(e || '', m || ''); INFO.urlEmp = e; INFO.urlMgr = m; toast('Pages saved.'); } else toast('Update the app to use this.'); break; }
    case 'resetZoom': if (N && N.resetZoom) { N.resetZoom(); toast('Zoom reset. Reopen CUIMS.'); } break;
    case 'moveStore': { const allSt = [...new Set([...(S.storeOrder || []), ...Object.keys(S.stores), ...S.lines.map(l => l.store)])].sort(byStore); const i = allSt.indexOf(v), j = i + (+t.dataset.d);
      if (j < 0 || j >= allSt.length) break; [allSt[i], allSt[j]] = [allSt[j], allSt[i]]; S.storeOrder = allSt; save(); render(); break; }
    case 'cropSave': { const c = ui.sheet; const out = document.createElement('canvas'); out.width = out.height = 320; const g = out.getContext('2d');
      const img = c.img; const V = 280; const base = Math.max(V / img.width, V / img.height) * c.zoom;
      const dw = img.width * base, dh = img.height * base; const dx = (V - dw) / 2 + c.x, dy = (V - dh) / 2 + c.y; const k = 320 / V;
      const png = /^data:image\/(png|webp)/.test(c.src); if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 320); } g.drawImage(img, dx * k, dy * k, dw * k, dh * k);
      S.me.photo = png ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.88); S.me.photoCut = png; save(); ui.sheet = null; renderSheet(); render(); toast('Photo updated.'); break; }
    case 'photoDel': delete S.me.photo; save(); render(); break;
    case 'expPendXlsx': openExport('pending'); break;
    case 'closeSheet': ui.sheet = null; renderSheet(); break;
    case 'pick': ui.picker = { id: v, q: '' }; renderPicker(); { const i = document.querySelector('[data-pkq]'); if (i && PICKS[v] && PICKS[v].search) i.focus(); } break;
    case 'pickClose': ui.picker = null; renderPicker(); break;
    case 'pickSet': { const cfg = PICKS[ui.picker.id]; ui.picker = null; renderPicker(); if (cfg) cfg.set(v); break; }
    case 'newReq': ui.drawer = false; renderDrawer(); ui.form = { store: '', req: nextReqNo(), date: today(), rcv: '', slip: '', q: '', items: [] }; ui.sheet = { kind: 'newReq' }; renderSheet(); break;
    case 'nrPick': { const st = S.stock[v]; ui.form.items.push({ code: v, name: st.name, uom: st.uom, qty: '' }); ui.form.q = ''; renderSheet(); const el = document.querySelector('[data-nrq="' + (ui.form.items.length - 1) + '"]'); if (el) el.focus(); break; }
    case 'nrDel': ui.form.items.splice(+v, 1); renderSheet(); break;
    case 'nrSave': { const f = ui.form; const st = f.store.trim().toUpperCase();
      f.items.forEach(it => S.lines.push({ id: nid(), req: f.req.trim(), store: st, date: f.date || today(), code: it.code, qty: parseFloat(it.qty), rcv: f.rcv || '', slip: (f.slip || '').trim().toUpperCase(), remark: (f.remark || '').trim(), src: 'new', earlier: '', status: 'waiting', issued: [] }));
      if (!S.stores[st]) S.stores[st] = { rcv: f.rcv || '', rname: '' };
      save(); ui.sheet = null; renderSheet(); render(); toast('Request ' + f.req + ' saved for ' + st + '.'); break; }
    case 'doneOpenDay': { const f = fltGet('done'); f.id = v; f.rd = ''; ui.view = 'done'; render(); window.scrollTo(0, 0); break; }
    case 'doneOpen': ui.drawer = false; ui.view = 'done'; render(); window.scrollTo(0, 0); break;
    case 'doneExport': openExport('done'); break;
    case 'doneMode': ui.doneMode = v; render(); break;
    case 'batchReq': ui.drawer = false; renderDrawer(); ui.form = { date: today(), slipStart: '', groups: [], act: 0, q: '', paste: '' }; ui.sheet = { kind: 'batch' }; renderSheet(); break;
    case 'btAct': ui.form.act = +v; ui.form.q = ''; renderSheet(); break;
    case 'btDel': ui.form.groups.splice(+v, 1); ui.form.act = Math.max(0, ui.form.groups.length - 1); renderSheet(); break;
    case 'btItemDel': { const [a1, b1] = v.split('|').map(Number); ui.form.groups[a1].items.splice(b1, 1); renderSheet(); break; }
    case 'btPick': { const g = ui.form.groups[ui.form.act]; const st = S.stock[v]; g.items.push({ code: v, name: st.name, uom: st.uom, qty: '' }); ui.form.q = ''; renderSheet(); const el = document.querySelector('[data-bq="' + ui.form.act + '|' + (g.items.length - 1) + '"]'); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } break; }
    case 'btPaste': { const f = ui.form; let n = 0, skip = 0;
      String(f.paste || '').split(/\r?\n/).forEach(line => { const c = line.split(/	|,/).map(x => x.trim()); if (c.length < 3 || !c[0] || !c[1]) return; const q = parseFloat(c[2]); if (!(q > 0)) { skip++; return; }
        const store = c[0].toUpperCase(), code = c[1].toUpperCase(); let g = f.groups.find(x => x.store === store && (!c[3] || x.req === c[3]));
        if (!g) { batchAddGroup(store); g = f.groups[f.groups.length - 1]; if (c[3]) g.req = c[3]; }
        g.items.push({ code, name: itemName(code), uom: itemUom(code), qty: String(q) }); n++; });
      f.paste = ''; renderSheet(); toast(n + ' rows added' + (skip ? ', ' + skip + ' skipped (no qty)' : '') + '.'); break; }
    case 'btSave': { const f = ui.form; let n = 0;
      f.groups.forEach(g => { const st = g.store.toUpperCase(); g.items.forEach(it => { S.lines.push({ id: nid(), req: g.req.trim(), store: st, date: f.date || today(), code: it.code, qty: parseFloat(it.qty), rcv: g.rcv || '', slip: (g.slip || '').toUpperCase(), remark: (g.remark || '').trim(), src: 'new', earlier: '', status: 'waiting', issued: [] }); n++; });
        if (!S.stores[st]) S.stores[st] = { rcv: g.rcv || '', rname: '' }; });
      save(); ui.sheet = null; renderSheet(); render(); toast(n + ' articles saved in ' + f.groups.length + ' requests.'); break; }
    case 'doneTog': ui.doneOpen[v] = !ui.doneOpen[v]; render(); break;
    case 'noop': break;
    case 'consOpen': ui.drawer = false; ui.view = 'cons'; render(); window.scrollTo(0, 0); break;
    case 'consP': ui.cons.p = v; render(); break;
    case 'consM': ui.cons.mode = v; render(); break;
    case 'consO': ui.cons.open[v] = !ui.cons.open[v]; render(); break;
    case 'consExport': openExport('cons'); break;
    case 'stockOpen': ui.drawer = false; ui.view = 'stock'; render(); window.scrollTo(0, 0); break;
    case 'stkF': ui.stk.f = v; ui.stk.open = null; render(); break;
    case 'stkOpen': ui.stk.open = ui.stk.open === v ? null : v; { const b = document.getElementById('stkres'); if (b) b.innerHTML = stockResults(); } break;
    case 'regSt': ui.reg.st = v; render(); break;
    case 'rqTog': ui.rqOpen = ui.rqOpen || {}; ui.rqOpen[v] = !ui.rqOpen[v]; render(); break;
    case 'regTog': ui.regOpen = ui.regOpen || {}; ui.regOpen[v] = !ui.regOpen[v]; render(); break;
    case 'reqStatus': ui.form = { req: v }; ui.sheet = { kind: 'reqStatus' }; renderSheet(); break;
    case 'mslips': { const r = requests().find(x => x.req === v); if (!r) break; const W = r.lines.filter(l => l.status === 'waiting'); const pick = {}; W.forEach(l => pick[l.id] = 1);
      ui.form = { req: v, store: r.store, slip: plannedSlip(W.map(l => l.id)) || nextSlip(), serial: '', rcv: (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '', date: today(), time: timeNow(), pick, byName: S.me.name || '', byEmp: S.me.emp || '' };
      ui.sheet = { kind: 'mslips' }; renderSheet(); break; }
    case 'msAll': { const r = requests().find(x => x.req === ui.form.req); const W = r.lines.filter(l => l.status === 'waiting'); const all = W.every(l => ui.form.pick[l.id]); ui.form.pick = {}; if (!all) W.forEach(l => ui.form.pick[l.id] = 1); renderSheet(); break; }
    case 'msSave': { const f = ui.form; const slip = String(f.slip || '').trim().toUpperCase(); const sp = slipProblem(slip); if (sp) { toast(sp); break; }
      if (!/^\d{6}$/.test(f.rcv)) { toast('Receiver must be 6 digits.'); break; }
      const ls = S.lines.filter(l => l.req === f.req && l.status === 'waiting' && f.pick[l.id]); if (!ls.length) { toast('Tick at least one article.'); break; }
      if (!(await uiConfirm('Save ' + slip + (f.serial ? ' (Serial ' + f.serial + ')' : '') + ' for ' + ls.length + ' article' + (ls.length > 1 ? 's' : '') + ' of ' + f.req + '?', 'Save slip'))) break;
      undoArm('markSave');
      const at = new Date((f.date || today()) + 'T' + (f.time || timeNow())).toISOString();
      S.entries.push({ id: nid(), slip, serial: String(f.serial || '').trim(), store: f.store, rcv: f.rcv, rname: rname(f.rcv), at, date: f.date || today(), time: f.time || timeNow(), by: { name: f.byName || '', emp: f.byEmp || '' }, kind: 'manual', remarks: '',
        items: ls.map(l => ({ lineId: l.id, req: l.req, code: l.code, name: itemName(l.code), uom: itemUom(l.code), qty: l.qty, remark: l.remark || remarkFor(l.date) })) });
      ls.forEach(l => { l.status = 'issued'; l.issued.push({ slip, serial: String(f.serial || '').trim(), at }); if (S.stock[l.code]) S.stock[l.code].qty = Math.round((S.stock[l.code].qty - l.qty) * 1000) / 1000; });
      save(); toast(slip + ' saved. Add the next slip if there is one.');
      const W2 = S.lines.filter(l => l.req === f.req && l.status === 'waiting'); f.pick = {}; W2.forEach(l => f.pick[l.id] = 1); f.slip = nextSlip(); f.serial = ''; renderSheet(); render(); break; }
    case 'rsClose': { const l = S.lines.find(x => String(x.id) === v); if (!l) break; if (!(await uiConfirm('Close ' + itemName(l.code) + ' ' + num(l.qty) + ' ' + itemUom(l.code) + '? It stops being pending.', 'Close', true))) break; audit('close', l); l.status = 'dropped'; save(); renderSheet(); render(); break; }
    case 'rsOpen': { const l = S.lines.find(x => String(x.id) === v); if (!l) break; if (!(await uiConfirm('Make ' + itemName(l.code) + ' ' + num(l.qty) + ' ' + itemUom(l.code) + ' pending again?', 'Make pending'))) break; audit('reopen', l); l.status = 'waiting'; save(); renderSheet(); render(); break; }
    case 'rsAll': { const req = ui.form.req; const W = S.lines.filter(l => l.req === req && l.status === 'waiting'); if (!W.length) break; if (!(await uiConfirm('Mark request ' + req + ' as completed? ' + W.length + ' pending article' + (W.length > 1 ? 's are' : ' is') + ' closed (not issued).', 'Mark completed', true))) break; W.forEach(l => { audit('close', l); l.status = 'dropped'; }); save(); renderSheet(); render(); toast(req + ' marked completed.'); break; }
    case 'rsAdd': { const f = ui.form; const c = String(f.addCode || '').trim().toUpperCase(), q = parseFloat(f.addQty); if (!c || !(q > 0)) { toast('Enter item code and qty.'); break; } const base = S.lines.find(l => l.req === f.req); if (!base) break;
      if (!(await uiConfirm('Add ' + itemName(c) + ' ' + num(q) + ' as pending to ' + f.req + '?', 'Add'))) break;
      const nl = { id: nid(), req: f.req, store: base.store, date: base.date, code: c, qty: q, rcv: base.rcv || '', slip: '', remark: base.remark || '', src: base.src, earlier: '', status: 'waiting', issued: [] }; S.lines.push(nl); audit('add', nl); f.addCode = ''; f.addQty = ''; save(); renderSheet(); render(); break; }
    case 'testToggle': { ui.drawer = false; renderDrawer(); const on = !S.testMode; if (!(await uiConfirm(on ? 'Turn on Test mode? Your real requests, slips and stock are put aside and a separate test copy starts. Nothing you do in test mode touches real data.' : 'Leave Test mode? Your real data comes back exactly as it was. Test data is kept for next time.', on ? 'Start testing' : 'Leave test mode'))) break; setTestMode(on); break; }
    case 'testClear': if (await uiConfirm('Delete all test data?', 'Delete', true)) { S.lines = []; S.entries = []; S.returns = []; S.counts = []; S.taskLog = {}; S.corrections = []; S.hold = {}; S.stock = deep((S._real || {}).stock) || S.stock; save(); render(); } break;
    case 'dcOpen': ui.drawer = false; ui.view = 'check'; render(); window.scrollTo(0, 0); break;
    case 'dcRenum': { const st = t.dataset.s; const to = await uiPrompt('New Request No for ' + st + ' (now ' + v + ')', v + '-' + st.replace(/[^A-Z0-9]/gi, '').slice(0, 4), 'Renumber'); if (to && renumberReqStore(v, st, to)) { save(); render(); toast(st + ' is now ' + to + '.'); } break; }
    case 'dcMerge': { const ids = v.split(',').map(Number); const L = S.lines.filter(l => ids.includes(l.id)); L[0].qty = L.reduce((a, l) => a + l.qty, 0); L.slice(1).forEach(l => l.status = 'dropped'); save(); render(); break; }
    case 'dcKeepFirst': { const ids = v.split(',').map(Number); S.lines.filter(l => ids.slice(1).includes(l.id)).forEach(l => l.status = 'dropped'); save(); render(); break; }
    case 'dcDate': S.lines.forEach(l => { if (l.req === v) l.date = t.dataset.d; }); save(); render(); break;
    case 'dcBad': { const ids = v.split(',').map(Number); S.lines.forEach(l => { if (ids.includes(l.id)) l.status = 'dropped'; }); save(); render(); break; }
    case 'dcSlip': ui.view = null; ui.tab = 'find'; ui.search.q = v; ui.search.type = 'all'; render(); break;
    case 'artsOpen': ui.drawer = false; ui.view = 'arts'; render(); window.scrollTo(0, 0); break;
    case 'artsSt': ui.arts.st = v; render(); break;
    case 'artsSel': if (t.checked) ui.arts.sel[v] = 1; else delete ui.arts.sel[v]; render(); break;
    case 'artsAll': { const L = artsList(); if (t.checked) L.forEach(x => ui.arts.sel[x.l.id] = 1); else L.forEach(x => delete ui.arts.sel[x.l.id]); render(); break; }
    case 'artsBClear': ui.arts.sel = {}; render(); break;
    case 'artQty': { const l = S.lines.find(x => String(x.id) === v); if (!l) break; const nv = await uiPrompt('New quantity for ' + itemName(l.code) + ' (' + l.store + ', ' + l.req + '). Now ' + num(l.qty) + ' ' + itemUom(l.code) + '.', String(l.qty), 'Save');
      if (nv == null) break; const q = parseFloat(nv); if (!(q > 0)) { toast('Enter a quantity above 0.'); break; }
      if (!(await uiConfirm('Change ' + itemName(l.code) + ' from ' + num(l.qty) + ' to ' + num(q) + ' ' + itemUom(l.code) + '?', 'Change'))) break;
      audit('qty', l, { from: l.qty, to: q }); l.qty = q; save(); render(); toast('Quantity updated.'); break; }
    case 'artHold': { const l = S.lines.find(x => String(x.id) === v); if (!l) break; const on = !S.hold[l.id];
      if (!(await uiConfirm((on ? 'Keep ' : 'Release ') + itemName(l.code) + ' (' + l.store + ') ' + (on ? 'on hold? It stays pending but is not filled until you release it.' : 'from hold?'), on ? 'Keep on hold' : 'Release'))) break;
      if (on) S.hold[l.id] = true; else delete S.hold[l.id]; audit(on ? 'hold' : 'release', l); save(); render(); break; }
    case 'artDel': { const l = S.lines.find(x => String(x.id) === v); if (!l) break;
      if (!(await uiConfirm('Remove ' + itemName(l.code) + ' ' + num(l.qty) + ' ' + itemUom(l.code) + ' (' + l.store + ', ' + l.req + ') from pending?', 'Remove', true))) break;
      audit('remove', l); l.status = 'dropped'; delete ui.arts.sel[l.id]; save(); render(); toast('Removed.'); break; }
    case 'artsBHold': case 'artsBRel': case 'artsBDel': { const ids = Object.keys(ui.arts.sel); const L = S.lines.filter(l => ids.includes(String(l.id)) && l.status === 'waiting'); if (!L.length) break;
      const stores = [...new Set(L.map(l => l.store))];
      const what = a === 'artsBDel' ? 'Remove' : a === 'artsBHold' ? 'Keep on hold' : 'Release';
      if (!(await uiConfirm(what + ' ' + L.length + ' article' + (L.length > 1 ? 's' : '') + ' from ' + stores.length + ' store' + (stores.length > 1 ? 's' : '') + ' (' + stores.slice(0, 4).join(', ') + (stores.length > 4 ? '…' : '') + ')?', what, a === 'artsBDel'))) break;
      L.forEach(l => { if (a === 'artsBDel') { audit('remove', l); l.status = 'dropped'; } else if (a === 'artsBHold') { S.hold[l.id] = true; audit('hold', l); } else { delete S.hold[l.id]; audit('release', l); } });
      ui.arts.sel = {}; save(); render(); toast(what + ': ' + L.length + ' done.'); break; }
    case 'renumReq': { const to = await uiPrompt('New Request No for ' + v, v, 'Renumber'); if (to && renumberReq(v, to)) { save(); render(); toast('Renumbered to ' + to + '.'); } break; }
    case 'impRenum': { const to = await uiPrompt('Give the app\'s request ' + v + ' a new Request No. Your file\'s ' + v + ' will then import normally.', v + '-T', 'Renumber'); if (to && renumberReq(v, to)) { save(); reparseUpload(); toast(v + ' in the app is now ' + to + '.'); } break; }
    case 'impDrop': { if (!(await uiConfirm('Remove the waiting articles of the app\'s request ' + v + '? Issued records stay. Your file\'s ' + v + ' will then import.', 'Remove', true))) break; S.lines.forEach(l => { if (l.req === v && l.status === 'waiting') l.status = 'dropped'; }); S.lines = S.lines.filter(l => !(l.req === v && l.status === 'dropped' && !l.issued.length)); save(); reparseUpload(); break; }
    case 'impOpenReq': ui.sheet = null; renderSheet(); ui.lastReq = v; ui.view = 'req'; ui.req = v; render(); window.scrollTo(0, 0); break;
    case 'credAuto': ui.cred = ui.cred || {}; ui.cred[v] = ui.cred[v] || {}; ui.cred[v].auto = t.checked; break;
    case 'credSave': { if (!N || !N.setCred) { toast('Update the app to use this.'); break; } let ci = {}; try { ci = JSON.parse(N.credInfo()); } catch (e) {} const c = ci[v] || {}, f = (ui.cred || {})[v] || {};
      const u = (f.u != null ? f.u : c.u || '').trim(); if (!u) { toast('Enter the User ID.'); break; }
      if (!f.p && !c.has) { toast('Enter the password.'); break; }
      N.setCred(v, u, f.p ? f.p : '__keep__', f.auto != null ? f.auto : c.auto !== false); ui.cred[v] = {}; render(); toast('Login saved on this phone.'); break; }
    case 'credDel': if (N && N.setCred && await uiConfirm('Remove the saved login?', 'Delete', true)) { N.setCred(v, '', '', false); ui.cred = ui.cred || {}; ui.cred[v] = {}; render(); toast('Login removed.'); } break;
    case 'homeDate': ui.homeDate = v === today() ? null : v; ui.tab = 'home'; ui.view = null; render(); window.scrollTo(0, 0); break;
    case 'corrOpen': ui.form = { req: v, rows: corrRows(v).map(o => Object.assign(o, { final: String(Math.round((o.issued + o.waiting) * 1000) / 1000) })), addCode: '', addQty: '' }; ui.sheet = { kind: 'corr' }; renderSheet(); break;
    case 'corrAdd': { const f = ui.form; const c = String(f.addCode || '').trim().toUpperCase(), q = parseFloat(f.addQty); if (!c || !(q > 0)) { toast('Enter item code and qty.'); break; } const ex = f.rows.find(o => o.code === c); if (ex) ex.final = String(q); else f.rows.push({ code: c, issued: 0, waiting: 0, slips: [], final: String(q) }); f.addCode = ''; f.addQty = ''; renderSheet(); break; }
    case 'corrSave': { const f = ui.form; const base = S.lines.find(l => l.req === f.req); if (!base) break; let changed = 0, over = [];
      S.corrections = S.corrections || [];
      f.rows.forEach(o => { const F = parseFloat(o.final); if (isNaN(F) || F === o.issued + o.waiting) return;
        const W = S.lines.filter(l => l.req === f.req && l.code === o.code && l.status === 'waiting'); const rem = Math.round((F - o.issued) * 1000) / 1000;
        if (rem > 0) { if (W.length) { W[0].qty = rem; W.slice(1).forEach(l => l.status = 'dropped'); } else S.lines.push({ id: nid(), req: f.req, store: base.store, date: base.date, code: o.code, qty: rem, rcv: base.rcv || '', slip: '', remark: base.remark || '', src: base.src, earlier: o.slips.join(', '), status: 'waiting', issued: [], corr: true }); }
        else { W.forEach(l => l.status = 'dropped'); if (rem < 0) over.push(itemName(o.code) + ' ' + num(-rem)); }
        S.corrections.push({ req: f.req, code: o.code, from: o.issued + o.waiting, to: F, issued: o.issued, at: new Date().toISOString(), by: S.me.name || '' }); changed++; });
      save(); ui.sheet = null; renderSheet(); render(); toast(changed ? 'Correction saved for ' + changed + ' article' + (changed > 1 ? 's' : '') + '.' + (over.length ? ' Over-issued: ' + over.join(', ') + '.' : '') : 'No changes.'); break; }
    case 'sRdClear': ui.search.rd = ''; render(); break;
    case 'drawer': ui.drawer = true; renderDrawer(); break;
    case 'drawerClose': ui.drawer = false; renderDrawer(); break;
    case 'dCount': ui.drawer = false; if (todayCount(true)) { ui.countId = todayCount(false).id; ui.view = 'count'; } render(); window.scrollTo(0, 0); break;
    case 'countLog': ui.drawer = false; ui.view = 'countLog'; render(); window.scrollTo(0, 0); break;
    case 'countOpen': ui.countId = v; ui.view = 'count'; render(); window.scrollTo(0, 0); break;
    case 'taskLog': ui.drawer = false; ui.view = 'taskLog'; render(); window.scrollTo(0, 0); break;
    case 'dUpload': ui.drawer = false; renderDrawer(); ui.upload = null; ui.sheet = { kind: 'upload' }; renderSheet(); break;
    case 'dBulk': ui.drawer = false; renderDrawer(); document.querySelector('[data-a=bulkEdit]') ? document.querySelector('[data-a=bulkEdit]').click() : (ui.tab = 'home', render()); break;
    case 'dSite': ui.drawer = false; renderDrawer(); if (N) N.openSite(); break;
    case 'dMgr': ui.drawer = false; renderDrawer(); openLiveStock(); break;
    case 'dBackup': ui.drawer = false; renderDrawer(); if (S.sync.url) { ui.sheet = { kind: 'backups' }; loadBackups(); } else { ui.tab = 'set'; ui.setPage = 'cloud'; ui.view = null; render(); } break;
    case 'dData': ui.drawer = false; ui.tab = 'set'; ui.setPage = 'data'; ui.view = null; render(); window.scrollTo(0, 0); break;
    case 'taskOpen': if (v === 'count') { if (todayCount(true)) { ui.countId = todayCount(false).id; ui.view = 'count'; render(); window.scrollTo(0, 0); } } else if (v === 'stock' || v === 'requests') { ui.upload = null; ui.sheet = { kind: 'upload' }; renderSheet(); } else if (v === 'backup') { if (S.sync.url) syncNow(false); else { ui.tab = 'set'; ui.setPage = 'cloud'; render(); } } break;
    case 'taskTog': { const d = today(); S.taskLog = S.taskLog || {}; S.taskLog[d] = S.taskLog[d] || {}; const cur = taskStatus(v, d);
      S.taskLog[d][v] = cur === 'done' ? { status: 'pending', at: new Date().toISOString(), by: S.me.name || '' } : { status: 'done', at: new Date().toISOString(), by: S.me.name || '' }; save(); render(); break; }
    case 'taskAdd': { const tt = String(ui.newTask || '').trim(); if (!tt) break; S.customTasks = S.customTasks || []; S.customTasks.push({ id: 'c' + nid(), title: tt }); ui.newTask = ''; save(); render(); break; }
    case 'taskDel': if (await uiConfirm('Delete this task? Its history stays.', 'Delete', true)) { S.customTasks = (S.customTasks || []).filter(x => x.id !== v); save(); render(); } break;
    case 'countDone': { const c = (S.counts || []).find(x => String(x.id) === String(ui.countId)); if (!c) break; c.status = 'done'; c.doneAt = new Date().toISOString(); S.taskLog = S.taskLog || {}; S.taskLog[c.date] = S.taskLog[c.date] || {}; S.taskLog[c.date].count = { status: 'done', at: c.doneAt, by: S.me.name || '' }; save(); render(); toast('Count finished and logged.'); break; }
    case 'countExport': ui.countExportId = v; openExport('counts'); break;
    case 'countExportAll': ui.countExportId = null; openExport('counts'); break;
    case 'varAdd': { const c = curCount(); if (!c) break; const it = c.items[+v]; it.variants = it.variants || []; if (!it.variants.length && it.physical !== '' && it.physical != null) it.variants.push({ qty: it.physical, mfd: '', exp: '' }); else it.variants.push({ qty: '', mfd: '', exp: '' }); syncPhysical(it); save(); render(); break; }
    case 'varDel': { const c = curCount(); if (!c) break; const [a1, k] = v.split('|').map(Number); const it = c.items[a1]; it.variants.splice(k, 1); syncPhysical(it); if (!it.variants.length) it.physical = ''; save(); render(); break; }
    case 'expOpen': ui.drawer = false; ui.view = 'expiry'; render(); window.scrollTo(0, 0); break;
    case 'expExport': openExport('expiry'); break;
    case 'expClear': { const [cid, idx, k] = v.split('|'); const c = (S.counts || []).find(x => String(x.id) === cid); if (c && await uiConfirm('Mark this batch as cleared (used, issued or removed)? It leaves the tracker.')) { c.items[+idx].variants[+k].cleared = true; save(); render(); } break; }
    case 'countRepick': { const c = (S.counts || []).find(x => String(x.id) === String(ui.countId)); if (c && c.items.every(i => i.physical === '' || i.physical == null)) { S.counts = S.counts.filter(x => x !== c); const n = todayCount(true); if (n) ui.countId = n.id; save(); render(); toast('New list picked.'); } break; }
    case 'tasksTog': S.uiPrefs = S.uiPrefs || {}; S.uiPrefs.tasksOpen = !S.uiPrefs.tasksOpen; writeLocal(); render(); break;
    case 'syncTap': if (S.sync.url) syncNow(false); else { ui.tab = 'set'; ui.setPage = 'cloud'; ui.view = null; render(); } break;
    case 'rpSet': rptPref(ui.sheet.type)[t.dataset.k] = v; save(true); renderSheet(); break;
    case 'rpTog': rptPref(ui.sheet.type)[t.dataset.k] = t.checked; save(true); renderSheet(); break;
    case 'rpCol': rptPref(ui.sheet.type).cols[t.dataset.k] = t.checked; save(true); renderSheet(); break;
    case 'rpMove': { const p = rptPref(ui.sheet.type), D = reportDef(ui.sheet.type); const keys = orderedCols(p, D).map(c => c[0]); const i = keys.indexOf(t.dataset.k), j = i + (+t.dataset.d);
      if (j >= 0 && j < keys.length) { [keys[i], keys[j]] = [keys[j], keys[i]]; p.order = keys; save(true); renderSheet(); } break; }
    case 'rpPdf': rpPdf(ui.sheet.type); break;
    case 'rpXlsx': rpXlsx(ui.sheet.type); break;
    case 'queueToggle': S.queue = t.checked; save(true); if (ui.sheet && ui.sheet.kind === 'start') renderSheet(); else render(); break;
    case 'queuePend': S.queuePend = t.checked; save(true); if (ui.sheet && ui.sheet.kind === 'start') renderSheet(); else render(); break;
    case 'autoSubToggle': S.autoSubmit = t.checked; save(true); break;
    case 'startFill': { const s = ui.sheet; if (slipProblem(s.slip) || !/^\d{6}$/.test(s.rcv)) break;
      if (!S.stores[s.store]) S.stores[s.store] = { rcv: s.rcv, rname: '' }; else if (!S.stores[s.store].rcv) S.stores[s.store].rcv = s.rcv;
      const ids = s.lineIds.filter(id => !s.off[id]);
      if (!ids.length) { toast('Select at least one article.'); break; }
      for (const id of ids) { if (s.qty[id] == null) continue; const q = parseFloat(s.qty[id]); const l = S.lines.find(x => x.id === id); if (!(q > 0)) { toast('Qty must be above 0 for ' + l.code); return; } l.qty = q; }
      save(true); ui.sheet = null; renderSheet(); startJob(s.store, s.slip, s.rcv, ids); break; }
    case 'stOn': if (t.checked) delete ui.sheet.off[v]; else ui.sheet.off[v] = 1; renderSheet(); break;
    case 'stAdd': { const s = ui.sheet; const code = String(s.addCode || '').trim().toUpperCase(), q = parseFloat(s.addQty);
      if (!code || !(q > 0)) { toast('Enter item code and qty.'); break; }
      const base = S.lines.find(l => l.id === s.lineIds[0]);
      const nl = { id: nid(), req: base ? base.req : s.req || 'MANUAL', store: s.store, date: base ? base.date : today(), code, qty: q, rcv: base ? base.rcv : '', slip: base ? base.slip : '', src: 'new', earlier: '', status: 'waiting', issued: [] };
      S.lines.push(nl); s.lineIds.push(nl.id); s.addCode = ''; s.addQty = ''; save(true); renderSheet(); if (!S.stock[code]) toast(code + ' is not in the stock sheet; CUIMS will check it.'); break; }
    case 'upPick': ui.upload = { kind: v }; document.getElementById('fileIn').click(); break;
    case 'uploadCancel': ui.upload = null; renderSheet(); break;
    case 'uploadOk': doImport(); break;
    case 'regType': ui.reg.type = v; render(); break;
    case 'regItems': ui.reg.items = t.checked; break;
    case 'pdfIssue': openExport('issue'); break;
    case 'pdfReturn': openExport('ret'); break;
    case 'newManual': {
      const R = requests().filter(r => r.lines.some(l => l.status === 'waiting'));
      PICKS.manReq = { title: 'Manual slip for which request?', search: true, opts: [['__free', 'Request not in the app (free entry)', 'type everything by hand']].concat(sortBy(R, 'reqdate', r => ({ req: r.req, store: r.store, date: r.date })).map(r => [r.req, r.req + ' · ' + r.store, fmtShort(r.date) + ' · ' + r.lines.filter(l => l.status === 'waiting').length + ' pending'])), val: '',
        set: x => { if (x === '__free') { const b = document.createElement('button'); b.dataset.a = 'newManualFree'; document.body.appendChild(b); b.click(); b.remove(); } else { const b = document.createElement('button'); b.dataset.a = 'mslips'; b.dataset.v = x; document.body.appendChild(b); b.click(); b.remove(); } } };
      ui.picker = { id: 'manReq', q: '' }; renderPicker(); break; }
    case 'newManualFree': ui.form = { _new: true, req: nextReqNo(), date: today(), store: '', rcv: '', rname: '', byName: S.me.name || '', byEmp: S.me.emp || '', total: '', status: 'pending', slips: [{ slip: nextSlip(), serial: '', date: today(), time: timeNow(), count: '' }] }; ui.sheet = { kind: 'manReq' }; renderSheet(); break;
    case 'manReqEdit': { const m = (S.manReqs || {})[v]; if (!m) break; const sl = reqSlips(v).map(e => ({ id: e.id, slip: e.slip, serial: e.serial || '', date: entryDate(e), time: entryTime(e), count: String(entryCount(e, v)), byName: (e.by || {}).name || '', byEmp: (e.by || {}).emp || '' }));
      ui.form = Object.assign({ _new: false }, JSON.parse(JSON.stringify(m)), { slips: sl.length ? sl : [{ slip: nextSlip(), serial: '', date: today(), time: timeNow(), count: '' }], total: m.total ? String(m.total) : '' }); ui.sheet = { kind: 'manReq' }; renderSheet(); break; }
    case 'manReqToggle': { const m = (S.manReqs || {})[v]; if (!m) break; const to = m.status === 'done' ? 'pending' : 'done'; if (!(await uiConfirm('Mark request ' + v + ' as ' + (to === 'done' ? 'completed' : 'pending') + '?', to === 'done' ? 'Mark completed' : 'Mark pending'))) break; m.status = to; save(); render(); break; }
    case 'mrAdd': { const f = ui.form; const last = f.slips[f.slips.length - 1]; let nx = ''; const mm = last && String(last.slip).match(/^(.*?)(\d+)$/); if (mm) nx = mm[1] + String(parseInt(mm[2], 10) + 1).padStart(mm[2].length, '0'); f.slips.push({ slip: nx || nextSlip(), serial: '', date: last ? last.date : today(), time: timeNow(), count: '', byName: last && last.byName != null ? last.byName : f.byName, byEmp: last && last.byEmp != null ? last.byEmp : f.byEmp }); renderSheet(); break; }
    case 'mrDel': ui.form.slips.splice(+v, 1); renderSheet(); break;
    case 'mrSt': ui.form.status = v; renderSheet(); break;
    case 'mrRemove': { const f = ui.form; if (!(await uiConfirm('Delete manual request ' + f.req + ' and its ' + f.slips.length + ' slip(s)?', 'Delete', true))) break; undoArm('delEntry'); S.entries = S.entries.filter(e => !(e.kind === 'manual' && !e.items.length && entryHasReq(e, f.req))); delete S.manReqs[f.req]; save(); ui.sheet = null; renderSheet(); render(); break; }
    case 'mrSave': { const f = ui.form; const req = String(f.req || '').trim();
      if (!req) { toast('Enter the Request No.'); break; } if (!f.store) { toast('Choose the store.'); break; } if (f.rcv && !/^\d{6}$/.test(f.rcv)) { toast('Issued to must be 6 digits.'); break; }
      if (f._new && (S.lines.some(l => l.req === req) || (S.manReqs || {})[req])) { toast('Request No ' + req + ' already exists.'); break; }
      const keep = new Set(f.slips.filter(x => x.id).map(x => String(x.id)));
      const used = allSlips(); const mine = new Set(S.entries.filter(e => keep.has(String(e.id))).map(e => String(e.slip).toUpperCase()));
      const seen = {}; let bad = '';
      f.slips.forEach((x, i) => { const sl = String(x.slip || '').trim().toUpperCase(); if (!sl) bad = bad || 'Slip ' + (i + 1) + ' needs a Slip No.'; else if (!SLIP_RE.test(sl)) bad = bad || 'Slip ' + sl + ' is not valid.'; else if (seen[sl] || (used.has(sl) && !mine.has(sl))) bad = bad || 'Slip ' + sl + ' is already used.'; seen[sl] = 1; });
      if (bad) { toast(bad); break; }
      if (!(await uiConfirm('Save request ' + req + ' with ' + f.slips.length + ' slip' + (f.slips.length > 1 ? 's' : '') + ' as ' + (f.status === 'done' ? 'Completed' : 'Pending') + '?', 'Save'))) break;
      undoArm('saveEntry');
      S.manReqs = S.manReqs || {};
      S.manReqs[req] = { req, store: f.store, date: f.date || today(), rcv: f.rcv || '', rname: f.rname || '', total: parseInt(f.total, 10) || 0, status: f.status === 'done' ? 'done' : 'pending', by: { name: f.byName || '', emp: f.byEmp || '' } };
      S.entries = S.entries.filter(e => !(e.kind === 'manual' && !e.items.length && entryHasReq(e, req)));
      f.slips.forEach(x => { const d = x.date || today(), tm = x.time || timeNow();
        S.entries.push({ id: x.id || nid(), slip: String(x.slip).trim().toUpperCase(), serial: String(x.serial || '').trim(), store: f.store, rcv: f.rcv || '', rname: f.rname || '', at: new Date(d + 'T' + tm).toISOString(), date: d, time: tm, by: { name: (x.byName != null ? x.byName : f.byName) || '', emp: (x.byEmp != null ? x.byEmp : f.byEmp) || '' }, kind: 'manual', reqs: req, count: parseInt(x.count, 10) || 0, remarks: '', items: [] }); });
      save(); ui.sheet = null; renderSheet(); render(); toast('Request ' + req + ' saved.'); break; }
    case 'newManualFreeOld': ui.form = { _new: true, kind: 'manual', slip: '', serial: '', store: '', rcv: '', rname: '', date: ui.reg.date, time: timeNow(), reqs: '', remarks: '', byName: S.me.name, byEmp: S.me.emp, items: [blankItem()] }; ui.sheet = { kind: 'entry' }; renderSheet(); break;
    case 'editEntry': { const e = S.entries.find(x => String(x.id) === v); ui.form = Object.assign(JSON.parse(JSON.stringify(e)), { date: entryDate(e), time: entryTime(e), reqs: e.reqs || [...new Set(e.items.map(i => i.req).filter(Boolean))].join(', '), byName: (e.by || {}).name || '', byEmp: (e.by || {}).emp || '' }); ui.sheet = { kind: 'entry' }; renderSheet(); break; }
    case 'saveEntry': { const f = ui.form; const items = cleanItems(f.items);
      if (!f.slip.trim() || !f.store.trim() || !/^\d{6}$/.test(f.rcv)) { toast('Slip No, store and a 6-digit receiver are needed.'); break; }
      const clash = S.entries.find(e => e.id !== f.id && String(e.slip).toUpperCase() === f.slip.trim().toUpperCase());
      if (clash && !await uiConfirm('Slip ' + f.slip + ' is already used for ' + clash.store + '. Save anyway?')) break;
      if (!items.length) { toast('Add at least one item with code and qty.'); break; }
      const rec = { id: f.id || nid(), slip: f.slip.trim().toUpperCase(), serial: (f.serial || '').trim(), store: f.store.trim().toUpperCase(), rcv: f.rcv, rname: (f.rname || '').trim(), at: f.at || new Date(f.date + 'T' + (f.time || '00:00')).toISOString(), date: f.date, time: f.time, reqs: (f.reqs || '').trim(), remarks: (f.remarks || '').trim(), by: { name: f.byName.trim(), emp: f.byEmp.trim() }, kind: f.kind || 'manual', items };
      if (rec.rname) { S.rnames = S.rnames || {}; S.rnames[rec.rcv] = rec.rname; }
      const i = S.entries.findIndex(e => e.id === rec.id); if (i >= 0) S.entries[i] = rec; else S.entries.push(rec);
      save(); ui.sheet = null; renderSheet(); render(); toast('Entry saved.'); break; }
    case 'delEntry': if (await uiConfirm('Delete this register entry? Stock and pending are not changed.', 'Delete', true)) { S.entries = S.entries.filter(e => e.id !== ui.form.id); save(); ui.sheet = null; renderSheet(); render(); } break;
    case 'newReturn': ui.form = { _new: true, no: nextReturnNo(), against: '1111', store: '', by: '', byName: '', date: ui.reg.date, time: timeNow(), serial: '', remarks: '', ebName: S.me.name, ebEmp: S.me.emp, items: [blankItem()] }; ui.sheet = { kind: 'return' }; renderSheet(); break;
    case 'editReturn': { const r = S.returns.find(x => String(x.id) === v); ui.form = Object.assign(JSON.parse(JSON.stringify(r)), { ebName: (r.enteredBy || {}).name || '', ebEmp: (r.enteredBy || {}).emp || '' }); ui.sheet = { kind: 'return' }; renderSheet(); break; }
    case 'saveReturn': { const f = ui.form; const items = cleanItems(f.items);
      if (!f.store.trim() || !/^\d{6}$/.test(f.by)) { toast('Store and a 6-digit "Returned by" are needed.'); break; }
      if (!items.length) { toast('Add at least one item with code and qty.'); break; }
      const rec = { id: f.id || nid(), no: f.no.trim(), against: (f.against || '1111').trim(), store: f.store.trim().toUpperCase(), by: f.by, byName: (f.byName || '').trim(), date: f.date, time: f.time, serial: (f.serial || '').trim(), remarks: (f.remarks || '').trim(), enteredBy: { name: f.ebName.trim(), emp: f.ebEmp.trim() }, items };
      if (rec.byName) { S.rnames = S.rnames || {}; S.rnames[rec.by] = rec.byName; }
      const i = S.returns.findIndex(x => x.id === rec.id); if (i >= 0) S.returns[i] = rec; else S.returns.push(rec);
      save(); ui.sheet = null; renderSheet(); render(); toast('Return saved.'); break; }
    case 'delReturn': if (await uiConfirm('Delete this return?', 'Delete', true)) { S.returns = S.returns.filter(x => x.id !== ui.form.id); save(); ui.sheet = null; renderSheet(); render(); } break;
    case 'rmItem': ui.form.items.splice(+v, 1); if (!ui.form.items.length) ui.form.items.push(blankItem()); renderSheet(); break;
    case 'addItem': ui.form.items.push(blankItem()); renderSheet(); break;
    case 'sType': ui.search.type = v; render(); break;
    case 'sOpen': ui.search.open = ui.search.open === v ? null : v; render(); break;
    case 'expSearch': openExport('search'); break;
    case 'expSearchOld': { const res = searchRecords(); const rows = []; res.forEach(x => x.items.forEach(i => rows.push({ Type: x.type, Date: x.date ? fmtLong(x.date) : '', Time: x.time || '', 'Slip / Return No': x.no, 'Serial No': x.serial, Store: x.store, 'Issued to / Returned by': x.who, 'Request / Against': x.reqs, 'Item code': i.code, Item: i.name || itemName(i.code), Qty: Number(i.qty), UOM: i.uom || '', 'Item remark': i.remark || '', 'Entered by': x.by.name || '', 'Emp code': x.by.emp || '' })));
      saveWb([['Search results', rows]], 'Search-' + today() + '.xlsx'); break; }
    case 'mgrToggle': S.mgr.on = t.checked; save(); render(); break;
    case 'rmStore': if (await uiConfirm('Remove ' + v + ' from your store list? Records stay.')) { delete S.stores[v]; save(); render(); } break;
    case 'addStore': { const el = document.getElementById('newStore'); const nm = (el.value || '').trim().toUpperCase(); if (!nm) break; if (!S.stores[nm]) S.stores[nm] = { rcv: '', rname: '' }; save(); render(); break; }
    case 'syncAuto': S.sync.auto = t.checked; save(true); break;
    case 'syncNow': syncNow(false); break;
    case 'restore': restoreNow(); break;
    case 'backups': ui.sheet = { kind: 'backups' }; loadBackups(); break;
    case 'openUrl': if (N) N.openUrl(v); else window.open(v); break;
    case 'bkSave': { const note = ui.sheet.note || ''; await syncNow(false, 'manual', note); ui.sheet.note = ''; loadBackups(); break; }
    case 'bkRestore': { if (!await uiConfirm('Replace ALL data on this phone with this backup? (Tip: save a backup of the current data first.)')) break;
      try { const j = await apiGet('action=get&id=' + encodeURIComponent(v)); const url = S.sync.url; S = Object.assign(blank(), JSON.parse(j.backup)); S.sync.url = url; save(true); ui.sheet = null; renderSheet(); render(); toast('Backup restored.'); } catch (e) { toast('Restore failed: ' + e.message); } break; }
    case 'bkKeep': try { await apiPost({ action: 'meta', id: v, keep: t.dataset.k === '1' }); loadBackups(); } catch (e) { toast('Failed: ' + e.message); } break;
    case 'bkDel': if (await uiConfirm('Delete this backup copy from Drive?', 'Delete', true)) { try { await apiPost({ action: 'delete', id: v }); loadBackups(); } catch (e) { toast('Failed: ' + e.message); } } break;
    case 'bkNote': { const b = (ui.sheet.items || []).find(x => x.id === v); ui.sheet.editing = v; ui.sheet.rename = b ? b.note : ''; renderSheet(); break; }
    case 'bkNoteCancel': ui.sheet.editing = null; renderSheet(); break;
    case 'bkNoteSave': try { await apiPost({ action: 'meta', id: v, note: ui.sheet.rename || '' }); ui.sheet.editing = null; loadBackups(); } catch (e) { toast('Failed: ' + e.message); } break;
    case 'expRequests': openExport('requests'); break;
    case 'expEntries': openExport('entries'); break;
    case 'expItems': openExport('items'); break;
    case 'expStock': openExport('stock'); break;
    case 'expReturns': openExport('returns'); break;
    case 'expAll': saveWb([['Requests register', rowsRequests()], ['Request lines', rowsAllLines()], ['Entries log', rowsEntries()], ['Entry items', rowsItems()], ['Pending', rowsPending()], ['Returns', rowsReturns()], ['Stock now', rowsStock()]], 'JV-Stock-Issue-backup-' + today() + '.xlsx'); break;
    case 'lockToggle': if (N) { N.setLock(t.checked); INFO.lock = t.checked; toast(t.checked ? 'Lock on. Fingerprint or PIN needed when opening.' : 'Lock off.'); } break;
    case 'checkUpdate': checkUpdate(true); break;
    case 'installUpdate': if (S.updateInfo && S.updateInfo.url && N) N.installUpdate(S.updateInfo.url); break;
    case 'mode': if (N && INFO.mode !== v) { if (await uiConfirm(v === 'bundled' ? 'Use the built-in screens from the installed APK? (rollback)' : 'Use the latest screens from GitHub?')) N.setMode(v); } break;
    case 'wipe': if (await uiConfirm('Delete ALL requests, entries, returns, stock and settings on this phone?') && await uiConfirm('Really delete everything? Back up first if unsure.')) { const url = S.sync.url; S = blank(); S.sync.url = url; save(true); render(); toast('All data cleared.'); } break;
  }
  } finally { if (_busy) setTimeout(() => loader(false), /CUIMS/.test(_busy) ? 1400 : 0); }
});

document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.in === 'slip' || el.dataset.in === 'rcv') { const k = focusKey(el); ui.sheet[el.dataset.in] = el.dataset.in === 'slip' ? el.value.trim().toUpperCase() : el.value.replace(/\D/g, ''); renderSheet(); refocus(k); return; }
  if (el.dataset.in === 'q') { ui.search.q = el.value; clearTimeout(ui.sT); ui.sT = setTimeout(() => { const box = document.getElementById('sres'); if (box) box.innerHTML = sResults(searchRecords()); }, 120); return; }
  if (el.dataset.pkq) { ui.picker.q = el.value; const box = document.querySelector('#picker .pklist'); if (box) box.innerHTML = pickList(); return; }
  if (el.dataset.bk) { ui.sheet[el.dataset.bk] = el.value; return; }
  if (el.dataset.cr) { const [w, k] = el.dataset.cr.split('|'); ui.cred = ui.cred || {}; ui.cred[w] = ui.cred[w] || {}; ui.cred[w][k] = el.value; return; }
  if (el.dataset.corr != null) { ui.form.rows[+el.dataset.corr].final = el.value; return; }
  if (el.dataset.cadd) { ui.form[el.dataset.cadd === 'code' ? 'addCode' : 'addQty'] = el.value; return; }
  if (el.dataset.cons) { ui.cons[el.dataset.cons] = el.value; render(); return; }
  if (el.dataset.stk) { ui.stk.q = el.value; clearTimeout(ui.kT); ui.kT = setTimeout(() => { const b = document.getElementById('stkres'); if (b) b.innerHTML = stockResults(); }, 120); return; }
  if (el.dataset.arts) { ui.arts.q = el.value; clearTimeout(ui.aT); ui.aT = setTimeout(() => { const b = document.getElementById('artsres'); if (b) b.innerHTML = artsResults(); }, 120); return; }
  if (el.dataset.asc) { autoStockCfg()[el.dataset.asc] = el.value.trim(); save(true); return; }
  if (el.dataset.mr) { const k = el.dataset.mr; ui.form[k] = k === 'rcv' ? el.value.replace(/\D/g, '') : el.value; return; }
  if (el.dataset.ms) { const [i, k] = el.dataset.ms.split('|'); ui.form.slips[+i][k] = k === 'slip' ? el.value.toUpperCase() : el.value; return; }
  if (el.dataset.tk) { ui.newTask = el.value; return; }
  if (el.dataset.nr) { const k = el.dataset.nr; ui.form[k] = k === 'rcv' ? el.value.replace(/\D/g, '') : el.value;
    if (k === 'store') { const d = (S.stores[el.value] || {}).rcv; if (d && !ui.form.rcv) ui.form.rcv = d; }
    if (k === 'q') { const box = document.getElementById('nrhits'); if (box) box.innerHTML = nrHits(); return; }
    if (k === 'req' || k === 'slip') { const fk = focusKey(el); renderSheet(); refocus(fk); } return; }
  if (el.dataset.bt) { const k = el.dataset.bt; ui.form[k] = el.value; if (k === 'q') { const box = document.getElementById('bthits'); if (box) box.innerHTML = batchHits(ui.form.act); } return; }
  if (el.dataset.bg) { const [gi, k] = el.dataset.bg.split('|'); ui.form.groups[+gi][k] = k === 'rcv' ? el.value.replace(/\D/g, '') : k === 'slip' ? el.value.toUpperCase() : el.value; return; }
  if (el.dataset.bq) { const [gi, ii] = el.dataset.bq.split('|').map(Number); ui.form.groups[gi].items[ii].qty = el.value; return; }
  if (el.dataset.nrq != null) { ui.form.items[+el.dataset.nrq].qty = el.value; const b = document.querySelector('[data-a=nrSave]'); if (b) { const f = ui.form; b.disabled = !(f.store && f.req && f.items.length && f.items.every(x => parseFloat(x.qty) > 0)); } return; }
  if (el.dataset.var) { const c = curCount(); if (c) { const [a1, k, f] = el.dataset.var.split('|'); const it = c.items[+a1]; it.variants[+k][f] = el.value; syncPhysical(it); save(true); } return; }
  if (el.dataset.expdays) { const n = parseInt(el.value, 10); if (n > 0) { S.expiryDays = n; save(true); } return; }
  if (el.dataset.cx) { countExcl()[el.dataset.cx] = el.value.split(',').map(x => x.trim()).filter(Boolean); save(true); return; }
  if (el.dataset.cnt != null) { const c = (S.counts || []).find(x => String(x.id) === String(ui.countId)); if (c) { c.items[+el.dataset.cnt].physical = el.value; save(true); } return; }
  if (el.dataset.rp) { rptPref(ui.sheet.type)[el.dataset.rp] = el.value; save(true); if (el.tagName === 'SELECT') renderSheet(); return; }
  if (el.dataset.crop) { ui.sheet.zoom = parseFloat(el.value); const im = document.querySelector('#cropBox img'); if (im) { const V = 280, c = ui.sheet, base = Math.max(V / c.img.width, V / c.img.height) * c.zoom, dw = c.img.width * base, dh = c.img.height * base; im.style.width = dw + 'px'; im.style.height = dh + 'px'; im.style.left = ((V - dw) / 2 + c.x) + 'px'; im.style.top = ((V - dh) / 2 + c.y) + 'px'; } return; }
  if (el.dataset.url) { ui[el.dataset.url === 'emp' ? 'urlEmp' : 'urlMgr'] = el.value.trim(); return; }
  if (el.dataset.stq) { ui.sheet.qty[el.dataset.stq] = el.value; return; }
  if (el.dataset.stadd) { ui.sheet[el.dataset.stadd === 'code' ? 'addCode' : 'addQty'] = el.value; return; }
  if (el.dataset.f) { ui.form[el.dataset.f] = el.value; return; }
  if (el.dataset.br) { const [i, f] = el.dataset.br.split('|'); ui.form.rows[+i][f] = f === 'slip' ? el.value.trim().toUpperCase() : f === 'rcv' ? el.value.replace(/\D/g, '') : el.value; return; }
  if (el.dataset.bulkstart) { ui.form.start = el.value; return; }
  if (el.dataset.bulkdate) { ui.form.allDate = el.value; return; }
  if (el.dataset.it) { const [i, f] = el.dataset.it.split('|'); ui.form.items[+i][f] = el.value; return; }
});
document.addEventListener('change', async ev => {
  const el = ev.target;
  if (ui.locked && (el.dataset.set || el.dataset.storeRcv || el.dataset.storeName)) { render(); askUnlock(); return; }
  if (el.id === 'photoIn') {
    const f = el.files[0]; el.value = ''; if (!f) return;
    const img = new Image(); const fr = new FileReader();
    fr.onload = () => { img.onload = () => { ui.sheet = { kind: 'crop', img, src: fr.result, zoom: 1, x: 0, y: 0 }; renderSheet(); }; img.src = fr.result; };
    fr.readAsDataURL(f); return;
  }
  if (el.id === 'fileIn') {
    loader(true, 'Reading your file');
    const f = el.files[0]; el.value = ''; if (!f || !ui.upload) { loader(false); return; }
    if (!window.XLSX) { loader(false); ui.upload.error = 'Excel tools not loaded yet. Check internet and try again.'; renderSheet(); return; }
    try {
      const wb = await readWorkbook(f); ui.upload.wb = wb;
      const r = ui.upload.kind === 'stock' ? parseStock(wb) : parseRequests(wb, ui.upload.kind);
      if (r.error) ui.upload.error = r.error; else ui.upload.result = r;
    } catch (e) { ui.upload.error = 'Could not read this file. Use .xlsx or .csv.'; }
    loader(false); renderSheet(); return;
  }
  if (el.dataset.sort) { ui.sort[el.dataset.sort] = el.value; render(); return; }
  if (el.dataset.rp) { later(() => renderSheet()); return; }
  if (el.dataset.ms && el.dataset.ms.endsWith('|count')) { later(() => { const k = focusKey(document.activeElement); renderSheet(); refocus(k); }); return; }
  if (el.dataset.bq || el.dataset.bg || el.dataset.corr != null) { later(() => { const k = focusKey(document.activeElement); renderSheet(); refocus(k); }); return; }
  if (el.dataset.cnt != null || el.dataset.var || el.dataset.expdays) { later(() => render()); return; }
  if (el.dataset.flt) { const [k, key] = el.dataset.flt.split('|'); const f = fltGet(k); f[key] = el.value; if ((k === 'done' || k === 'reg') && !f.rd && !f.id) f.id = today(); if (k === 'reg' && key === 'id' && el.value) ui.reg.date = el.value; render(); return; }
  if (el.dataset.in === 'sRd') { ui.search.rd = el.value; render(); return; }
  if (el.dataset.in === 'doneDate') { ui.doneDate = el.value || today(); render(); return; }
  if (el.dataset.in === 'regDate') { ui.reg.date = el.value || today(); render(); if (ui.sheet && ui.sheet.kind === 'export') renderSheet(); return; }
  if (el.dataset.in === 'sFrom') { ui.search.from = el.value; render(); return; }
  if (el.dataset.in === 'sTo') { ui.search.to = el.value; render(); return; }
  if (el.dataset.in === 'sStore') { ui.search.store = el.value; render(); return; }
  if (el.dataset.set) { const [o, k] = el.dataset.set.split('.'); S[o][k] = el.value.trim(); save(true); return; }
  if (el.dataset.storeRcv) { const s = el.dataset.storeRcv; S.stores[s].rcv = el.value.replace(/\D/g, ''); save(); later(() => { const k = focusKey(document.activeElement); render(); refocus(k); }); return; }
  if (el.dataset.storeName) { const s = el.dataset.storeName; S.stores[s].rname = el.value.trim(); S.rnames = S.rnames || {}; if (S.stores[s].rcv) S.rnames[S.stores[s].rcv] = el.value.trim(); save(); return; }
  if (el.dataset.it && el.dataset.it.endsWith('|code')) { const i = +el.dataset.it.split('|')[0]; fillItemMeta(ui.form.items[i]); later(() => { const k = focusKey(document.activeElement); renderSheet(); refocus(k); }); return; }
  if (el.dataset.f === 'rcv' || el.dataset.f === 'by') { const nm = rname(el.value.replace(/\D/g, '')); const key = el.dataset.f === 'rcv' ? 'rname' : 'byName'; if (nm && !ui.form[key]) { ui.form[key] = nm; later(() => { const k = focusKey(document.activeElement); renderSheet(); refocus(k); }); } }
});

function doImport() {
  const u = ui.upload, r = u.result;
  if (u.kind === 'stock') { S.stock = r.stock; S.stockAt = new Date().toISOString(); S.stockSrc = u.auto ? 'auto' : 'file'; S.stockLog = (S.stockLog || []).concat([{ at: S.stockAt, src: S.stockSrc, n: r.count, by: S.me.name || '' }]).slice(-60); save(); toast('Stock replaced: ' + r.count + ' items. Everything re-planned.'); }
  else {
    r.rows.forEach(x => {
      S.lines.push({ fromFile: true, id: nid(), req: x.req, store: x.store, date: x.date, code: x.code, qty: x.qty, rcv: x.rcv, slip: x.slip || '', src: x.src, earlier: x.earlier || '', status: 'waiting', issued: [] });
      if (!S.stores[x.store]) S.stores[x.store] = { rcv: '', rname: '' };
    });
    save(); toast(r.rows.length + ' articles imported.');
  }
  ui.upload = null; ui.sheet = null; renderSheet(); render();
}

/* ---------------- start ---------------- */
render();
setTimeout(() => { const b = document.getElementById('boot'); if (b) { b.style.transition = 'opacity .35s'; b.style.opacity = '0'; setTimeout(() => b.remove(), 400); } }, 650);
if (S.sync.url && S.sync.auto && (S.sync.dirty || !S.sync.at)) setTimeout(() => syncNow(true), 5000);
if (Date.now() - (S.lastUpdateCheck || 0) > 12 * 3600e3) setTimeout(() => checkUpdate(false), 3000);
