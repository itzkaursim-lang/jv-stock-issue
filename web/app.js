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
function save(noSync) {
  const t = JSON.stringify(S);
  try { if (N) N.storeSet(t); else localStorage.setItem('jvStockIssue', t); } catch (e) {}
  if (!noSync && S.sync.url && S.sync.auto) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(true), 4000); }
}
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
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 3200); }
function meTag() { return { name: S.me.name || '', emp: S.me.emp || '' }; }

/* ================= allocation =================
   Tier 1 = today's requests, Tier 2 = everything older (only leftover stock).
   In each tier: first complete as many whole requests as possible, then
   remaining lines (today: smaller first; older: oldest first). No partial lines. */
function plan() {
  const res = {}, avail = {};
  for (const c in S.stock) avail[c] = S.stock[c].qty;
  const waiting = S.lines.filter(l => l.status === 'waiting');
  const t = today();
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
  const out = [], dup = [], warn = new Set(), badQty = [];
  let ex = 0, data = 0;
  for (let i = hm.h + 1; i < rows.length; i++) {
    const r = rows[i];
    const req = String(r[ci.req]).trim(), code = String(r[ci.code]).trim().toUpperCase(), qty = parseFloat(String(r[ci.qty]).replace(/[^\d.]/g, ''));
    if (!req && !code) continue;
    data++;
    if (/^EX[-\/]/i.test(req)) { ex++; continue; }
    if (!req || !code) { warn.add('Row ' + (i + 1) + ': missing Request No or Item code'); continue; }
    if (!(qty > 0)) { badQty.push(i + 1); continue; }
    const key = req.toUpperCase() + '|' + code;
    if (have.has(key)) { dup.push(req + ' ' + code); continue; }
    have.add(key);
    const store = String(r[ci.store]).trim().toUpperCase();
    if (!store) { warn.add('Row ' + (i + 1) + ': store is empty'); continue; }
    const date = (ci.date >= 0 && toISO(r[ci.date])) || today();
    const rcv = ci.rcv >= 0 ? String(r[ci.rcv]).replace(/\D/g, '') : '';
    if (rcv && rcv.length !== 6) warn.add('Row ' + (i + 1) + ': receiver must be 6 digits, ignored');
    if (Object.keys(S.stock).length && !S.stock[code]) warn.add(code + ' is not in the current stock sheet');
    const slip = ci.slip >= 0 ? String(r[ci.slip]).trim().toUpperCase() : '';
    if (slip && !SLIP_RE.test(slip)) warn.add('Row ' + (i + 1) + ': Slip No ' + slip + ' is not valid (2–10 chars with a digit), ignored');
    out.push({ req, store, date, code, qty, rcv: rcv.length === 6 ? rcv : '', slip: slip && SLIP_RE.test(slip) ? slip : '', src: kind, earlier: ci.earlier >= 0 ? String(r[ci.earlier]).trim() : '' });
  }
  if (badQty.length) warn.add('Rows with a bad Qty were skipped: ' + badQty.slice(0, 8).join(', ') + (badQty.length > 8 ? '…' : ''));
  const info = 'Read sheet "' + sheetName + '", headers on row ' + (hm.h + 1) + ', ' + data + ' filled rows' + (ex ? ', ' + ex + ' example rows (EX-…) skipped' : '') + '.';
  return { rows: out, dup, warn: [...warn], info };
}
function parseStock(wb) {
  const rows = rowsOf(wb.Sheets[wb.SheetNames[0]]);
  const hm = headerMap(rows, [/item code|^code$/, /closing|stock|qty|quantity/]);
  if (!hm) return { error: 'This is not the CUIMS Item Stock Statement (no "Item Code" and "Closing" columns).' };
  const f = re => hm.hd.findIndex(c => re.test(c));
  const ci = { code: f(/item code|^code$/), name: f(/name/), uom: f(/uom|unit/), qty: f(/closing/) >= 0 ? f(/closing/) : f(/stock|qty|quantity/) };
  const st = {};
  for (let i = hm.h + 1; i < rows.length; i++) {
    const r = rows[i]; const code = String(r[ci.code]).trim().toUpperCase(); const q = parseFloat(r[ci.qty]);
    if (!code.includes('-') || isNaN(q)) continue;
    st[code] = { name: ci.name >= 0 ? String(r[ci.name]).trim() : code, uom: ci.uom >= 0 ? String(r[ci.uom]).trim().toUpperCase().replace(/^KGS$/, 'KG').replace(/^LT$/, 'LTR') : '', qty: q };
  }
  return { stock: st, count: Object.keys(st).length };
}

/* ================= UI state ================= */
let ui = { setPage: null, openStore: {}, sort: { home: 'priority', pend: 'store', reg: 'time' }, tab: 'home', view: null, req: null, store: null, sheet: null, reg: { type: 'issue', date: today(), items: false }, search: { q: '', type: 'all', from: '', to: '', store: '', open: null }, upload: null, form: null };

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  pend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  reg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
const TABS = [['home', 'Home'], ['pend', 'Pending'], ['reg', 'Registers'], ['find', 'Search'], ['set', 'Settings']];

function reqCard(r) {
  const tag = r.st === 'full' ? pill('All ' + r.w.length + ' can issue', 'c-ok') : r.st === 'part' ? pill(r.can.length + ' of ' + r.w.length + ' can issue', 'c-pt') : r.st === 'done' ? pill('Done', 'c-in') : pill('Nothing in stock', 'c-no');
  const slip = (r.w.find(l => l.slip) || {}).slip, rcv = (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '';
  return '<div class="card scard"><button class="main" data-a="openReq" data-v="' + esc(r.req) + '"><div class="row"><b style="font-size:17px">' + esc(r.store) + '</b>' + tag + '</div>' +
    '<div class="wrap" style="gap:6px">' + pill('Req ' + r.req, 'c-gy') + pill(fmtShort(r.date), r.date === today() ? 'c-gy' : 'c-pt') + (slip ? pill('Slip ' + slip, 'c-in') : pill('No slip', 'c-no')) + (rcv ? pill('GA' + rcv, 'c-gy') : pill('No receiver', 'c-no')) + pill(r.lines.length + ' articles', 'c-gy') + (r.iss.length ? pill(r.iss.length + ' issued', 'c-in') : '') + '</div></button>' +
    '<div class="side"><button class="xbtn" data-a="dropReq" data-v="' + esc(r.req) + '" aria-label="Remove ' + esc(r.store) + ' from the list">✕</button></div></div>';
}
function appBar() {
  return '<div class="appbar"><img class="logo" src="icon.png" alt="JV Stock Issue logo"><div class="t"><b>JV Stock Issue</b><span>Built by <i>' + esc(S.me.builder || S.me.name || 'JV') + '</i>' + (S.me.storeName ? ' · ' + esc(S.me.storeName) : '') + '</span></div><button data-a="goProfile" aria-label="Profile" style="border:0;background:none;padding:0">' + avatar(false) + '</button></div>';
}
function stockAge() { return S.stockAt ? 'Stock from ' + fmtDT(S.stockAt) : 'No stock uploaded yet'; }

/* ---------------- Home ---------------- */
function vHome() {
  const PL = plan();
  const t = today();
  const R = requests();
  const todays = R.filter(r => r.date === t && r.src !== 'old').map(r => Object.assign(r, reqState(r, PL))).filter(r => r.st !== 'done');
  const order = { full: 0, part: 1, wait: 2 };
  const so = ui.sort.home;
  todays.sort((a, b) => so === 'store' ? a.store.localeCompare(b.store) : so === 'req' ? a.req.localeCompare(b.req, undefined, { numeric: true }) : so === 'size' ? b.lines.length - a.lines.length : (order[a.st] - order[b.st] || b.can.length - a.can.length));
  const pend = S.lines.filter(isPending);
  const pendCan = pend.filter(l => PL[l.id] === 'issue').length;
  const issuedToday = S.entries.filter(e => (e.at || '').slice(0, 10) === t).length;
  let h = '<header class="top"><div><h1>' + (S.me.name ? 'Hello, ' + esc(S.me.name.split(' ')[0]) : 'Today') + '</h1><div class="sub">' + fmtLong(t) + ' · ' + esc(stockAge()) + '</div></div>' +
    '<button class="iconbtn" data-a="openSite" aria-label="Open CUIMS">' + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button></header><main>';
  if (S.updateInfo && S.updateInfo.newer) h += '<button class="banner t-in tap" data-a="goUpdate" style="border:0"><b>Update ' + esc(S.updateInfo.tag) + ' available.</b> Tap to install.</button>';
  if (!S.me.name) h += '<button class="banner t-pt tap" data-a="tab" data-v="set" style="border:0"><b>Add your name and emp code</b> in Settings, so entries and PDFs show who made them.</button>';
  if (!S.lines.length && !S.stockAt) {
    return h + '<div class="card pad col"><h2>Start here</h2><div class="note">Upload the CUIMS stock report and your requests sheet. Download the template first if you need the format.</div>' +
      '<button class="btn main" data-a="upload">Upload a file</button><button class="btn" data-a="template">Download data template</button></div></main>';
  }
  h += '<div class="grid2"><button class="btn main" data-a="upload">Upload</button><button class="btn" data-a="openSite">Open CUIMS</button></div>';
  h += '<button class="btn full" data-a="bulkEdit">Edit all requests: Slip No, Request No, date, receiver</button>';
  const c = { full: todays.filter(r => r.st === 'full').length, part: todays.filter(r => r.st === 'part').length, wait: todays.filter(r => r.st === 'wait').length };
  h += '<div class="card pad col"><div class="row"><h3>Today\'s requests</h3><span class="note">' + todays.length + ' open · ' + issuedToday + ' entries done</span></div>' +
    '<div class="grid3"><div class="tile t-ok"><b>' + c.full + '</b><span>Fully possible</span></div><div class="tile t-pt"><b>' + c.part + '</b><span>Partly possible</span></div><div class="tile t-no"><b>' + c.wait + '</b><span>Waiting</span></div></div></div>';
  if (todays.length) {
    h += '<div class="row" style="margin-top:4px"><span class="sect">' + (so === 'priority' ? 'Do these now, in this order' : 'Today\'s requests') + '</span>' + sortSel('home', [['priority', 'Priority'], ['store', 'Store A–Z'], ['req', 'Request No'], ['size', 'Most articles']]) + '</div>';
    todays.forEach(r => {
      h += reqCard(r);
    });
  } else if (S.lines.length) h += '<div class="card pad note">No open requests for today. Upload today\'s requests, or check Pending.</div>';
  h += '<button class="card pad tap row" data-a="tab" data-v="pend"><span><b>Older pending</b><div class="note">' + pend.length + ' articles waiting · ' + pendCan + ' in stock now</div></span><span class="chip ' + (pendCan ? 'c-ok' : 'c-gy') + '">Open</span></button>';
  const te = S.entries.filter(e => (e.at || '').slice(0, 10) === t).slice().reverse().slice(0, 5);
  if (te.length) {
    h += '<div class="sect">Done today</div><div class="card">';
    te.forEach(e => h += '<div class="line"><div class="row"><b>' + esc(e.store) + '</b><span class="mono note">Slip ' + esc(e.slip) + '</span></div><div class="note">Serial ' + esc(e.serial || '–') + ' · ' + e.items.length + ' items · ' + fmtDT(e.at) + '</div></div>');
    h += '</div>';
  }
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
  h += '<div class="wrap">' + pill(st.can.length + ' can issue', 'c-ok') + pill((st.w.length - st.can.length) + ' waiting', st.w.length - st.can.length ? 'c-pt' : 'c-gy') + pill(st.iss.length + ' issued', 'c-in') + pill(r.lines.length + ' articles', 'c-gy') + ((st.w.find(l => l.slip) || {}).slip ? pill('Next slip ' + st.w.find(l => l.slip).slip, 'c-in') : pill('No slip set', 'c-no')) + '</div>';
  h += '<div class="card">';
  const ordr = { issue: 0, short: 1, hold: 2, missing: 3 };
  const lines = r.lines.slice().sort((a, b) => (a.status === 'issued') - (b.status === 'issued') || (ordr[PL[a.id]] || 0) - (ordr[PL[b.id]] || 0));
  lines.forEach(l => {
    const k = l.status === 'issued' ? 'issued' : PL[l.id];
    h += '<div class="line"><div class="row" style="align-items:flex-start"><span><b>' + esc(itemName(l.code)) + '</b><div class="note mono">' + esc(l.code) + '</div></span><b class="mono" style="white-space:nowrap">' + num(l.qty) + ' ' + esc(itemUom(l.code)) + '</b></div>' +
      '<div class="wrap" style="gap:6px">' + linePills(l, k) + '</div>' +
      (l.status === 'waiting' && k !== 'missing' ? '<label class="chk" style="min-height:36px;font-size:14px;color:var(--mute)"><input type="checkbox" data-a="hold" data-v="' + l.id + '"' + (S.hold[l.id] ? ' checked' : '') + '> Hold this article</label>' : '') + '</div>';
  });
  h += '</div>';
  h += '<button class="btn main full" data-a="fillReq" data-v="' + esc(r.req) + '"' + (st.can.length ? '' : ' disabled') + '>Fill on CUIMS · ' + st.can.length + ' articles</button>';
  h += '<div class="note" style="text-align:center">Articles not issued stay pending with this request\'s date.</div>';
  h += '<button class="btn ghost full" data-a="markDone" data-v="' + esc(r.req) + '"' + (st.w.length ? '' : ' disabled') + '>Already submitted on CUIMS? Mark as issued</button>';
  h += '<div class="grid2"><button class="btn ghost sm" data-a="editReq" data-v="' + esc(r.req) + '">Edit request</button><button class="btn ghost sm" data-a="dropReq" data-v="' + esc(r.req) + '">Remove waiting articles</button></div>';
  return h + '</main>';
}

/* ---------------- Pending ---------------- */
function vPend() {
  const PL = plan();
  const pend = S.lines.filter(isPending);
  const can = pend.filter(l => PL[l.id] === 'issue');
  const oldest = pend.reduce((m, l) => Math.max(m, days(l.date)), 0);
  let h = '<header class="top"><div><h1>Pending</h1><div class="sub">Older and partly issued requests. Gets stock only after today\'s requests.</div></div></header><main>';
  h += '<div class="grid3"><div class="tile t-pt"><b>' + pend.length + '</b><span>Articles pending</span></div><div class="tile t-ok"><b>' + can.length + '</b><span>In stock now</span></div><div class="tile t-no"><b>' + oldest + ' d</b><span>Oldest</span></div></div>';
  h += '<button class="btn full" data-a="bulkEdit">Edit all requests: Slip No, Request No, date, receiver</button>';
  h += '<div class="grid2"><button class="btn sm" data-a="expPendPdf"' + (pend.length ? '' : ' disabled') + '>Pending PDF</button><button class="btn sm" data-a="expPendXlsx"' + (pend.length ? '' : ' disabled') + '>Pending Excel</button></div>';
  if (!pend.length) return h + '<div class="card pad note">Nothing pending.</div></main>';
  const g = groupBy(pend, l => l.store);
  h += '<div class="row"><span class="sect">By store</span>' + sortSel('pend', [['store', 'Store A–Z'], ['most', 'Most pending'], ['oldest', 'Oldest first'], ['ready', 'Most in stock']]) + '</div>';
  const ps = ui.sort.pend;
  Object.keys(g).sort((a, b) => ps === 'most' ? g[b].length - g[a].length : ps === 'oldest' ? oldestOf(g[a]).localeCompare(oldestOf(g[b])) : ps === 'ready' ? g[b].filter(l => PL[l.id] === 'issue').length - g[a].filter(l => PL[l.id] === 'issue').length : a.localeCompare(b)).forEach(store => {
    const L = g[store].sort((a, b) => a.date.localeCompare(b.date));
    const c = L.filter(l => PL[l.id] === 'issue');
    const reqs = [...new Set(L.map(l => l.req))];
    const old = days(oldestOf(L));
    const open = !!ui.openStore[store];
    h += '<div class="card" style="overflow:hidden"><div class="scard"><button class="main" data-a="togStore" data-v="' + esc(store) + '"><div class="row"><b style="font-size:17px">' + esc(store) + '</b><span class="chev" style="transform:rotate(' + (open ? 90 : 0) + 'deg)">›</span></div>' +
      '<div class="wrap" style="gap:6px">' + pill(L.length + ' pending', 'c-pt') + pill(c.length + ' in stock now', c.length ? 'c-ok' : 'c-gy') + pill(reqs.length + (reqs.length === 1 ? ' request' : ' requests'), 'c-gy') + pill(old ? 'Oldest ' + old + ' d' : 'Today', old > 2 ? 'c-no' : 'c-gd') + '</div></button>' +
      '<div class="side"><button class="xbtn" data-a="dropStore" data-v="' + esc(store) + '" aria-label="Remove ' + esc(store) + ' pending">✕</button></div></div>';
    if (open) {
      const byR = groupBy(L, l => l.req);
      Object.keys(byR).forEach(rq => {
        const f = byR[rq][0];
        h += '<div class="pad" style="padding-top:10px;padding-bottom:6px;background:var(--soft);border-top:1px solid var(--line)"><div class="wrap" style="gap:6px">' + pill('Req ' + rq, 'c-gy') + pill(fmtShort(f.date), 'c-pt') + ((byR[rq].find(l => l.slip) || {}).slip ? pill('Slip ' + byR[rq].find(l => l.slip).slip, 'c-in') : '') + '</div></div>';
        byR[rq].forEach(l => {
          h += '<div class="line"><div class="row" style="align-items:flex-start"><span><b>' + esc(itemName(l.code)) + '</b><div class="note mono">' + esc(l.code) + '</div></span><b class="mono" style="white-space:nowrap">' + num(l.qty) + ' ' + esc(itemUom(l.code)) + '</b></div><div class="wrap" style="gap:6px">' + linePills(l, PL[l.id]) + '</div></div>';
        });
      });
      h += '<div class="pad">' + (c.length ? '<button class="btn main full" data-a="fillStore" data-v="' + esc(store) + '">Clear ' + c.length + ' in-stock article' + (c.length > 1 ? 's' : '') + ' on CUIMS</button>' : '<div class="note">Nothing in stock yet. Upload fresh stock to recheck.</div>') + '</div>';
    }
    h += '</div>';
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
    (S.stock[l.code] ? '<div class="wrap" style="gap:6px">' + pill(num(S.stock[l.code].qty) + ' in stock', 'c-gy') + (remarkFor(l.date) ? pill('Remark added', 'c-gy') : '') + '</div>' : '') + '</div>').join('') + '</div>';
  h += '<div class="card pad col"><b>Add an article to this entry</b><div class="grid2"><input type="text" data-stadd="code" value="' + esc(s.addCode || '') + '" placeholder="Item code e.g. GR-198" autocapitalize="characters" class="mono"><input type="number" inputmode="decimal" data-stadd="qty" value="' + esc(s.addQty || '') + '" placeholder="Qty"></div><button class="btn" data-a="stAdd">+ Add article</button></div>';
  h += '<label class="chk"><input type="checkbox" data-a="queueToggle"' + (S.queue ? ' checked' : '') + '> Queue mode: after I submit, fill the next request automatically</label>';
  h += '<button class="btn main full" data-a="startFill"' + (sp || rp ? ' disabled' : '') + '>Start filling on CUIMS</button>';
  h += '<div class="note" style="text-align:center">The app never taps SUBMIT. You check and submit yourself.</div>';
  return h;
}
function startJob(store, slip, rcv, lineIds) {
  const ls = S.lines.filter(l => lineIds.includes(l.id) && l.status === 'waiting');
  const job = { id: 'J' + Date.now(), slip, rcv, store, phase: 'dup', paused: false, log: [], tries: {},
    items: ls.map(l => ({ lineId: l.id, req: l.req, code: l.code, name: itemName(l.code), uom: itemUom(l.code), qty: l.qty, remark: remarkFor(l.date), skip: false })) };
  if (!N) { toast('Open this inside the JV Stock Issue app to fill CUIMS.'); return; }
  N.startJob(JSON.stringify(job));
}
function nextQueueJob() {
  const PL = plan(); const t = today();
  const R = requests().filter(r => r.date === t && r.src !== 'old').map(r => Object.assign(r, reqState(r, PL))).filter(r => r.can.length);
  const order = { full: 0, part: 1 };
  R.sort((a, b) => (order[a.st] || 2) - (order[b.st] || 2) || b.can.length - a.can.length);
  for (const r of R) {
    const rcv = (r.lines.find(l => l.rcv) || {}).rcv || (S.stores[r.store] || {}).rcv || '';
    if (/^\d{6}$/.test(rcv)) return { store: r.store, rcv, ids: r.can.map(l => l.id), req: r.req };
  }
  return null;
}

/* ---------------- Upload sheet ---------------- */
function shUpload() {
  const u = ui.upload;
  let h = '<div class="row"><h2>Upload</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  if (!u || !u.result) {
    h += '<button class="card pad tap col" style="gap:4px" data-a="pick" data-v="new"><b>Fresh requests</b><span class="note">"New Requests" tab of the template. One row per article.</span></button>';
    h += '<button class="card pad tap col" style="gap:4px" data-a="pick" data-v="old"><b>My earlier pending</b><span class="note">"Old Pending" tab. Load once, before you start using the app.</span></button>';
    h += '<button class="card pad tap col" style="gap:4px" data-a="pick" data-v="stock"><b>CUIMS stock report</b><span class="note">Item Stock Statement exactly as downloaded. Replaces stock fully.</span></button>';
    h += '<button class="btn ghost" data-a="template">Download data template</button>';
    if (u && u.error) h += '<div class="err">' + esc(u.error) + '</div>';
    return h;
  }
  const r = u.result;
  if (u.kind === 'stock') {
    h += '<div class="card pad col"><b>' + r.count + ' items found</b><div class="note">This replaces the current stock (' + Object.keys(S.stock).length + ' items). Everything is re-planned.</div></div>';
  } else {
    const stores = [...new Set(r.rows.map(x => x.store))];
    const reqs = [...new Set(r.rows.map(x => x.req))];
    h += '<div class="card pad col"><b>' + r.rows.length + ' articles · ' + reqs.length + ' requests · ' + stores.length + ' stores</b><div class="note">' + esc(stores.join(', ')) + '</div>' +
      (r.dup.length ? '<div class="note">Skipped ' + r.dup.length + ' already loaded (same Request No + code).</div>' : '') + (r.info ? '<div class="note">' + esc(r.info) + '</div>' : '') + '</div>';
    const unknownStores = S.areas.length ? stores.filter(s => !S.areas.some(a => a.toUpperCase() === s)) : [];
    if (unknownStores.length) r.warn.unshift('Not in the CUIMS Project Area list: ' + unknownStores.join(', '));
    if (r.warn.length) h += '<div class="card pad col" style="gap:4px">' + r.warn.slice(0, 12).map(w => '<div class="err" style="font-weight:500">' + esc(w) + '</div>').join('') + (r.warn.length > 12 ? '<div class="note">…and ' + (r.warn.length - 12) + ' more</div>' : '') + '</div>';
  }
  h += '<div class="grid2"><button class="btn" data-a="uploadCancel">Back</button><button class="btn main" data-a="uploadOk"' + ((r.rows && !r.rows.length) ? ' disabled' : '') + '>Import</button></div>';
  return h;
}

/* ---------------- Registers ---------------- */
function entryDate(e) { return e.date || (e.at || '').slice(0, 10); }
function entryTime(e) { return e.time || (e.at ? pad(new Date(e.at).getHours()) + ':' + pad(new Date(e.at).getMinutes()) : ''); }
function rname(code) { return (S.rnames || {})[code] || ''; }
function vReg() {
  const r = ui.reg;
  let h = '<header class="top"><div><h1>Registers</h1><div class="sub">Daily issue and return registers, editable, with PDF.</div></div></header><main>';
  h += '<div class="seg"><button data-a="regType" data-v="issue" class="' + (r.type === 'issue' ? 'on' : '') + '">Issue</button><button data-a="regType" data-v="return" class="' + (r.type === 'return' ? 'on' : '') + '">Return</button></div>';
  h += '<label class="f">Date<input type="date" data-in="regDate" value="' + esc(r.date) + '"></label>';
  if (r.type === 'issue') {
    const rs = ui.sort.reg;
    const list = S.entries.filter(e => entryDate(e) === r.date).sort((a, b) => rs === 'store' ? a.store.localeCompare(b.store) : rs === 'slip' ? String(a.slip).localeCompare(String(b.slip), undefined, { numeric: true }) : entryTime(a).localeCompare(entryTime(b)));
    h += '<div class="row"><span class="sect">' + list.length + ' entries</span>' + sortSel('reg', [['time', 'Time'], ['store', 'Store A–Z'], ['slip', 'Slip No']]) + '</div>';
    h += '<div class="grid2"><button class="btn main" data-a="pdfIssue"' + (list.length ? '' : ' disabled') + '>Make PDF</button><button class="btn" data-a="newManual">+ Manual entry</button></div>';
    h += '<label class="chk"><input type="checkbox" data-a="regItems"' + (r.items ? ' checked' : '') + '> Include item lines in the PDF</label>';
    if (!list.length) h += '<div class="card pad note">No issue entries on ' + fmtLong(r.date) + '.</div>';
    list.forEach(e => {
      h += '<button class="card pad tap col" style="gap:4px" data-a="editEntry" data-v="' + e.id + '"><div class="row"><b>' + esc(e.store) + '</b><span class="chip ' + (e.kind === 'manual' ? 'c-pt' : 'c-in') + '">' + (e.kind === 'manual' ? 'Manual' : 'App') + '</span></div>' +
        '<div class="note mono">Slip ' + esc(e.slip) + ' · Serial ' + esc(e.serial || '–') + ' · ' + esc(entryTime(e)) + '</div>' +
        '<div class="note">To GA' + esc(e.rcv) + (e.rname ? ' ' + esc(e.rname) : '') + ' · ' + e.items.length + (e.items.length === 1 ? ' item' : ' items') + ' · by ' + esc((e.by || {}).name || '–') + ' (' + esc((e.by || {}).emp || '–') + ')</div></button>';
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
function searchRecords() {
  const out = [];
  S.entries.forEach(e => out.push({ type: 'Issue', id: 'e' + e.id, date: entryDate(e), time: entryTime(e), store: e.store, who: 'GA' + e.rcv + (e.rname ? ' ' + e.rname : ''), no: e.slip, serial: e.serial || '', reqs: e.reqs || [...new Set(e.items.map(i => i.req).filter(Boolean))].join(', '), by: e.by || {}, remarks: e.remarks || '', items: e.items, kind: e.kind }));
  S.returns.forEach(r => out.push({ type: 'Return', id: 'r' + r.id, date: r.date, time: r.time, store: r.store, who: 'GA' + r.by + (r.byName ? ' ' + r.byName : ''), no: r.no, serial: r.serial || '', reqs: 'Against ' + r.against, by: r.enteredBy || {}, remarks: r.remarks || '', items: r.items }));
  const s = ui.search;
  const terms = s.q.toLowerCase().split(/\s+/).filter(Boolean);
  return out.filter(x => {
    if (s.type !== 'all' && x.type.toLowerCase() !== s.type) return false;
    if (s.from && x.date < s.from) return false;
    if (s.to && x.date > s.to) return false;
    if (s.store && x.store !== s.store) return false;
    if (!terms.length) return true;
    const hay = [x.type, x.date, fmtLong(x.date || today()), x.store, x.who, x.no, x.serial, x.reqs, x.by.name, x.by.emp, x.remarks, ...x.items.map(i => i.code + ' ' + (i.name || '') + ' ' + (i.remark || ''))].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  }).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}
function vFind() {
  const s = ui.search;
  const res = searchRecords();
  const stores = [...new Set([...S.entries.map(e => e.store), ...S.returns.map(r => r.store)])].sort();
  let h = '<header class="top"><div><h1>Search</h1><div class="sub">Issues and returns: any date, store, item, slip, serial or person.</div></div></header><main>';
  h += '<input type="text" data-in="q" value="' + esc(s.q) + '" placeholder="Search: atta, JV/912, 20401, LC MESS, GA600043…" autocomplete="off" style="font-size:16px">';
  h += '<div class="seg">' + [['all', 'All'], ['issue', 'Issue'], ['return', 'Return']].map(([k, l]) => '<button data-a="sType" data-v="' + k + '" class="' + (s.type === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  h += '<div class="grid2"><label class="f">From<input type="date" data-in="sFrom" value="' + esc(s.from) + '"></label><label class="f">To<input type="date" data-in="sTo" value="' + esc(s.to) + '"></label></div>';
  h += '<select data-in="sStore"><option value="">All stores</option>' + stores.map(x => '<option' + (x === s.store ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>';
  h += '<div class="row"><span class="note">' + res.length + ' records</span><button class="btn sm" data-a="expSearch"' + (res.length ? '' : ' disabled') + '>Export results</button></div>';
  res.slice(0, 150).forEach(x => {
    const open = s.open === x.id;
    h += '<button class="card pad tap col" style="gap:4px" data-a="sOpen" data-v="' + x.id + '"><div class="row"><b>' + esc(x.store) + '</b><span class="chip ' + (x.type === 'Issue' ? 'c-in' : 'c-pt') + '">' + x.type + '</span></div>' +
      '<div class="note mono">' + esc(x.no) + ' · Serial ' + esc(x.serial || '–') + ' · ' + (x.date ? fmtShort(x.date) : '') + ' ' + esc(x.time || '') + '</div>' +
      '<div class="note">' + esc(x.who) + ' · ' + x.items.length + ' items · by ' + esc(x.by.name || '–') + '</div>' +
      (open ? '<div class="tblwrap" style="margin-top:6px"><table><tr><th>Code</th><th>Item</th><th>Qty</th><th>Remark</th></tr>' + x.items.map(i => '<tr><td>' + esc(i.code) + '</td><td>' + esc(i.name || itemName(i.code)) + '</td><td>' + num(i.qty) + ' ' + esc(i.uom || '') + '</td><td>' + esc(i.remark || '–') + '</td></tr>').join('') + '</table></div>' + (x.reqs ? '<div class="note">' + esc(x.reqs) + '</div>' : '') : '') + '</button>';
  });
  if (res.length > 150) h += '<div class="note">Showing 150. Narrow the search or export all.</div>';
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
    h += '<button class="card pad tap" data-a="setPage" data-v="profile" style="display:flex;align-items:center;gap:14px">' + avatar(true) + '<span style="flex:1"><b style="font-size:19px">' + esc(S.me.name || 'Add your name') + '</b><div class="note">' + esc([S.me.desig, S.me.emp].filter(Boolean).join(' · ') || 'Tap to set up your profile') + '</div></span><span class="chev">›</span></button>';
    const groups = [['Account', ['profile', 'pdf']], ['Work', ['stores', 'fill']], ['Data', ['cloud', 'data']], ['App', ['security', 'app']]];
    groups.forEach(([g, keys]) => {
      h += '<div class="sect">' + g + '</div><div class="card" style="overflow:hidden">';
      keys.forEach(k => { const p = SETPAGES.find(x => x[0] === k);
        h += '<button class="srow" data-a="setPage" data-v="' + k + '"><span class="ic" style="background:' + p[3] + ';color:' + p[4] + '">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p[5] + '</svg></span><span class="tx"><b>' + p[1] + '</b><span>' + p[2] + '</span></span><span class="chev">›</span></button>'; });
      h += '</div>';
    });
    h += '<div class="note" style="text-align:center;padding:8px 0 4px">JV Stock Issue ' + esc(INFO.version || '') + ' · Built by ' + esc(S.me.builder || S.me.name || 'JV') + '</div>';
    return h + '</main>';
  }
  const P0 = SETPAGES.find(x => x[0] === pg);
  h += '<header class="top"><div><button class="btn sm ghost" data-a="setBack">‹ Settings</button><h1 style="margin-top:10px">' + P0[1] + '</h1></div></header><main>';
  if (pg === 'profile') {
    h += '<div class="card pad col" style="align-items:center;text-align:center">' + avatar(true) + '<div class="grid2" style="width:100%"><button class="btn sm" data-a="photo">Change photo</button><button class="btn sm ghost" data-a="photoDel"' + (S.me.photo ? '' : ' disabled') + '>Remove photo</button></div></div>';
    h += '<div class="card pad col"><h3>My details</h3><div class="note">Entries made through the app get these. Also printed on PDFs.</div>' +
      '<label class="f">Name<input type="text" data-set="me.name" value="' + esc(S.me.name) + '"></label>' +
      '<div class="grid2"><label class="f">Emp code<input type="text" data-set="me.emp" value="' + esc(S.me.emp) + '" autocapitalize="characters"></label><label class="f">Designation<input type="text" data-set="me.desig" value="' + esc(S.me.desig) + '"></label></div>' +
      '<label class="f">"Built by" name in the top bar<input type="text" data-set="me.builder" value="' + esc(S.me.builder || '') + '" placeholder="' + esc(S.me.name || 'Your name') + '"></label></div>';
  }
  if (pg === 'pdf') {
    h += '<div class="card pad col"><label class="f">Store name (PDF title)<input type="text" data-set="me.storeName" value="' + esc(S.me.storeName) + '"></label></div>';
  h += '<div class="card pad col"><h3>Manager signature on PDFs</h3><label class="chk"><input type="checkbox" data-a="mgrToggle"' + (S.mgr.on ? ' checked' : '') + '> Add manager signature line</label>' +
    (S.mgr.on ? '<div class="grid2"><label class="f">Manager name<input type="text" data-set="mgr.name" value="' + esc(S.mgr.name) + '"></label><label class="f">Designation<input type="text" data-set="mgr.desig" value="' + esc(S.mgr.desig) + '"></label></div>' : '') + '</div>';
  }
  if (pg === 'stores') {
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
  h += '<div class="card pad col"><h3>Filling</h3><label class="chk"><input type="checkbox" data-a="queueToggle"' + (S.queue ? ' checked' : '') + '> Queue mode: after each submit, fill the next request automatically</label></div>';
  }
  if (pg === 'cloud') {
  h += '<div class="card pad col"><h3>Cloud backup (Google Drive + Sheet)</h3><label class="f">Apps Script web app URL<input type="text" data-set="sync.url" value="' + esc(S.sync.url) + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
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
  return h + '</main>';
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
function pdfDoc(landscape) {
  if (!window.jspdf) { toast('PDF tools not loaded yet. Check internet and try again.'); return null; }
  return new window.jspdf.jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
}
const INK = [28, 25, 23];
function pdfHead(doc, title, sub) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(title, 14, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110); doc.text(sub, 14, 21);
}
function pdfSign(doc) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 40) + 22;
  if (y > H - 30) { doc.addPage(); y = 30; }
  doc.setFontSize(9); doc.setTextColor(...INK);
  const me = (S.me.name || '__________') + (S.me.emp ? ' (' + S.me.emp + ')' : '') + (S.me.desig ? ', ' + S.me.desig : '');
  doc.line(14, y, 90, y); doc.text('Prepared & checked by', 14, y + 5); doc.text(me, 14, y + 10);
  if (S.mgr.on) { doc.line(W - 90, y, W - 14, y); doc.text('Manager', W - 90, y + 5); doc.text((S.mgr.name || '') + (S.mgr.desig ? ', ' + S.mgr.desig : ''), W - 90, y + 10); }
}
function pdfFoot(doc, label) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(120); doc.text('JV Stock Issue · ' + label + ' · generated ' + fmtDT(new Date().toISOString()), 14, H - 7); doc.text('Page ' + i + ' of ' + n, W - 14, H - 7, { align: 'right' }); }
}
function pdfSave(doc, name) { saveBlobB64(doc.output('datauristring').split(',')[1], name, 'application/pdf'); }
const TH = { fillColor: INK, textColor: 255, fontStyle: 'bold' };
function pdfIssue() {
  const d = ui.reg.date, list = S.entries.filter(e => entryDate(e) === d).sort((a, b) => entryTime(a).localeCompare(entryTime(b)));
  const doc = pdfDoc(true); if (!doc) return;
  const items = list.reduce((s, e) => s + e.items.length, 0);
  pdfHead(doc, 'Daily Issue Register, ' + (S.me.storeName || 'Store'), 'Date: ' + fmtLong(d) + '   |   Entries: ' + list.length + '   |   Items: ' + items + '   |   Issue · Department · Offline · HOSTEL MESS (GA) · Maintenance No');
  doc.autoTable({ startY: 26, headStyles: TH, styles: { fontSize: 8, cellPadding: 1.8 }, alternateRowStyles: { fillColor: [250, 250, 249] },
    head: [['#', 'Slip No', 'Request No', 'Store', 'Issued to', 'Date & time', 'Serial No', 'Items', 'Remarks', 'Entered by']],
    body: list.map((e, i) => [i + 1, e.slip, e.reqs || [...new Set(e.items.map(x => x.req).filter(Boolean))].join(', '), e.store, 'GA' + e.rcv + (e.rname ? '\n' + e.rname : ''), fmtShort(entryDate(e)) + ' ' + entryTime(e), e.serial || '________', e.items.length, e.remarks || (e.kind === 'manual' ? 'Manual' : '–'), ((e.by || {}).name || '') + ((e.by || {}).emp ? '\n' + e.by.emp : '')]) });
  if (ui.reg.items) list.forEach(e => {
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 6, headStyles: { fillColor: [68, 64, 60] }, styles: { fontSize: 8, cellPadding: 1.5 }, margin: { left: 14, right: 14 },
      head: [[{ content: 'Slip ' + e.slip + '  ·  ' + e.store + '  ·  GA' + e.rcv + '  ·  Serial ' + (e.serial || '____'), colSpan: 6 }], ['S.No', 'Item code', 'Item', 'UOM', 'Qty', 'Item remarks']],
      body: e.items.map((x, i) => [i + 1, x.code, x.name || itemName(x.code), x.uom || itemUom(x.code), num(x.qty), x.remark || '–']) });
  });
  pdfSign(doc); pdfFoot(doc, 'Issue Register'); pdfSave(doc, 'Issue-Register-' + d + '.pdf');
}
function pdfReturn() {
  const d = ui.reg.date, list = S.returns.filter(x => x.date === d).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const doc = pdfDoc(false); if (!doc) return;
  const items = list.reduce((s, r) => s + r.items.length, 0);
  pdfHead(doc, 'Daily Return Register, ' + (S.me.storeName || 'Store'), 'Date: ' + fmtLong(d) + '   |   Returns: ' + list.length + '   |   Items: ' + items);
  doc.setFontSize(8); doc.setTextColor(110); doc.text('Same for every return: Return · Department · HOSTEL MESS (GA) · Maintenance No · Issue Mode Normal · Against Issue No 1111 (back-date declaration).', 14, 26, { maxWidth: 182 });
  doc.autoTable({ startY: 31, headStyles: TH, styles: { fontSize: 8, cellPadding: 1.8 }, alternateRowStyles: { fillColor: [250, 250, 249] },
    head: [['#', 'Return No', 'Store', 'Returned by', 'Date & time', 'Against', 'Serial No', 'Items', 'Remarks', 'Entered by']],
    body: list.map((r, i) => [i + 1, r.no, r.store, 'GA' + r.by + (r.byName ? '\n' + r.byName : ''), fmtShort(r.date) + ' ' + (r.time || ''), r.against, r.serial || '________', r.items.length, r.remarks || '–', ((r.enteredBy || {}).name || '') + ((r.enteredBy || {}).emp ? '\n' + r.enteredBy.emp : '')]) });
  list.forEach(r => {
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 6, headStyles: { fillColor: [68, 64, 60] }, styles: { fontSize: 8, cellPadding: 1.5 },
      head: [[{ content: r.no + '  ·  ' + r.store + '  ·  Returned by GA' + r.by + '  ·  Against ' + r.against + '  ·  Serial ' + (r.serial || '____'), colSpan: 6 }], ['S.No', 'Item code', 'Item', 'UOM', 'Qty', 'Item remarks']],
      body: r.items.map((x, i) => [i + 1, x.code, x.name || itemName(x.code), x.uom || itemUom(x.code), num(x.qty), x.remark || '–']) });
  });
  pdfSign(doc); pdfFoot(doc, 'Return Register'); pdfSave(doc, 'Return-Register-' + d + '.pdf');
}
function pdfPending() {
  const rows = rowsPending(); const doc = pdfDoc(true); if (!doc) return;
  pdfHead(doc, 'Pending report, ' + (S.me.storeName || 'Store'), fmtLong(today()) + '   |   ' + rows.length + ' articles pending');
  doc.autoTable({ startY: 26, headStyles: TH, styles: { fontSize: 8, cellPadding: 1.8 }, alternateRowStyles: { fillColor: [250, 250, 249] },
    head: [['Store', 'Request No', 'Item code', 'Item', 'Qty', 'UOM', 'Requested on', 'Days', 'Earlier slips']],
    body: rows.map(r => [r.Store, r['Request No'], r['Item code'], r.Item, r.Qty, r.UOM, r['Requested on'], r['Days pending'], r['Earlier slips']]) });
  pdfSign(doc); pdfFoot(doc, 'Pending'); pdfSave(doc, 'Pending-' + today() + '.pdf');
}

/* ---------------- Google Sheet sync ---------------- */
async function syncNow(quiet, kind, note) {
  if (!S.sync.url) return;
  const payload = { action: 'sync', kind: kind || 'auto', note: note || '', counts: { requests: requests().length, articles: S.lines.length, entries: S.entries.length, returns: S.returns.length }, at: new Date().toISOString(), by: meTag(),
    tabs: { 'Requests': rowsRequests(), 'Request lines': rowsAllLines(), 'Entries': rowsEntries(), 'Entry items': rowsItems(), 'Pending': rowsPending(), 'Returns': rowsReturns(), 'Stock': rowsStock(),
      'Stores': Object.entries(S.stores).map(([s, v]) => ({ Store: s, Receiver: v.rcv ? 'GA' + v.rcv : '', Name: v.rname || '' })) },
    backup: JSON.stringify(S) };
  try {
    const r = await fetch(S.sync.url, { method: 'POST', body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'failed');
    S.sync.at = new Date().toISOString(); save(true);
    if (!quiet) { toast('Backed up to Google Drive and Sheet.'); render(); if (ui.sheet && ui.sheet.kind === 'backups') loadBackups(); }
  } catch (e) { if (!quiet) toast('Backup failed: ' + e.message); }
}
async function apiGet(q) { const r = await fetch(S.sync.url + (S.sync.url.includes('?') ? '&' : '?') + q); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'failed'); return j; }
async function apiPost(o) { const r = await fetch(S.sync.url, { method: 'POST', body: JSON.stringify(o) }); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'failed'); return j; }
async function loadBackups() {
  ui.sheet = Object.assign(ui.sheet || {}, { kind: 'backups', loading: true, err: '' }); renderSheet();
  try { const j = await apiGet('action=list'); ui.sheet.items = j.items; ui.sheet.folder = j.folder; ui.sheet.sheetUrl = j.sheet; }
  catch (e) { ui.sheet.err = 'Could not load backups: ' + e.message + '. If you just updated Code.gs, deploy it as a New version.'; }
  ui.sheet.loading = false; renderSheet();
}
function shBackups() {
  const s = ui.sheet;
  let h = '<div class="row"><h2>Cloud backups</h2><button class="btn sm ghost" data-a="closeSheet">Close</button></div>';
  h += '<div class="note">Every change is backed up automatically (a new copy every 30 minutes, newest 60 kept). Tap Keep on any copy to protect it forever.</div>';
  h += '<div class="card pad col"><b>Save a backup now</b><input type="text" data-bk="note" value="' + esc(s.note || '') + '" placeholder="Note, e.g. Before month-end cleanup"><button class="btn main" data-a="bkSave">Save backup (kept)</button></div>';
  if (s.loading) return h + '<div class="card pad note">Loading backups…</div>';
  if (s.err) return h + '<div class="err">' + esc(s.err) + '</div>';
  const items = s.items || [];
  h += '<div class="row"><span class="sect">' + items.length + ' backups</span>' + (s.folder ? '<button class="btn sm ghost" data-a="openUrl" data-v="' + esc(s.folder) + '">Open Drive folder</button>' : '') + '</div>';
  items.forEach(b => {
    const c = b.counts || {};
    h += '<div class="card pad col" style="gap:8px"><div class="row"><b>' + fmtDT(b.updated) + '</b>' + pill(b.keep ? 'Kept' : b.kind === 'manual' ? 'Manual' : 'Auto', b.keep ? 'c-ok' : 'c-gy') + '</div>' +
      '<div class="wrap" style="gap:6px">' + (c.requests != null ? pill(c.requests + ' requests', 'c-gy') + pill(c.entries + ' entries', 'c-in') + pill(c.returns + ' returns', 'c-gy') : '') + pill(Math.round(b.size / 1024) + ' KB', 'c-gy') + (b.by ? pill(b.by, 'c-gy') : '') + '</div>' +
      (s.editing === b.id ? '<input type="text" data-bk="rename" value="' + esc(s.rename || '') + '" placeholder="Note"><div class="grid2"><button class="btn sm" data-a="bkNoteSave" data-v="' + b.id + '">Save note</button><button class="btn sm ghost" data-a="bkNoteCancel">Cancel</button></div>' : (b.note ? '<div class="note">' + esc(b.note) + '</div>' : '')) +
      '<div class="grid3"><button class="btn sm main" data-a="bkRestore" data-v="' + b.id + '">Restore</button><button class="btn sm" data-a="bkKeep" data-v="' + b.id + '" data-k="' + (b.keep ? '0' : '1') + '">' + (b.keep ? 'Unkeep' : 'Keep') + '</button><button class="btn sm warn" data-a="bkDel" data-v="' + b.id + '">Delete</button></div>' +
      (s.editing === b.id ? '' : '<button class="btn sm ghost" data-a="bkNote" data-v="' + b.id + '">Add / edit note</button>') + '</div>';
  });
  return h;
}
async function restoreNow() {
  if (!confirm('Replace all data on this phone with the last Google Sheet backup?')) return;
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
  app.innerHTML = appBar() + (ui.view === 'req' ? vReq() : ({ home: vHome, pend: vPend, reg: vReg, find: vFind, set: vSet })[ui.tab]());
  document.querySelector('#tabs .in').innerHTML = TABS.map(([k, l]) => '<button data-a="tab" data-v="' + k + '" class="' + (ui.tab === k && !ui.view ? 'on' : '') + '">' + ICON[k] + l + '</button>').join('');
  window.scrollTo(0, y);
}
function renderSheet() {
  const el = document.getElementById('sheet');
  if (!ui.sheet) { el.innerHTML = ''; return; }
  const k = ui.sheet.kind;
  const body = k === 'backups' ? shBackups() : k === 'start' ? shStart() : k === 'upload' ? shUpload() : k === 'entry' ? shEntry() : k === 'return' ? shReturn() : k === 'editReq' ? shEditReq() : k === 'bulk' ? shBulk() : k === 'mark' ? shMark() : '';
  const sc = el.querySelector('.sheet') ? el.querySelector('.sheet').scrollTop : 0;
  el.innerHTML = '<div class="sheetbg" data-a="bgClose"><div class="sheet" role="dialog" aria-modal="true">' + body + '</div></div>';
  el.querySelector('.sheet').scrollTop = sc;
}
function sortSel(k, opts) { return '<select data-sort="' + k + '" style="width:auto;min-height:38px;font-size:14px;padding:0 8px">' + opts.map(([v, l]) => '<option value="' + v + '"' + (ui.sort[k] === v ? ' selected' : '') + '>Sort: ' + l + '</option>').join('') + '</select>'; }
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
  h += '<div class="sect">Waiting articles</div>' + itemRowsHtml(f.items, true) + '<button class="btn ghost" data-a="addItem">+ Add article</button>';
  h += '<button class="btn main full" data-a="saveReq">Save request</button>';
  return h;
}

/* ---------------- actions ---------------- */
const later = fn => setTimeout(fn, 0);
function focusKey(el) { if (!el) return null; for (const a of ['data-in', 'data-f', 'data-it', 'data-set', 'data-store-rcv', 'data-store-name']) if (el.hasAttribute && el.hasAttribute(a)) return [a, el.getAttribute(a), el.selectionStart]; return null; }
function refocus(k) { if (!k) return; const el = document.querySelector('[' + k[0] + '="' + CSS.escape(k[1]) + '"]'); if (el) { el.focus(); try { if (k[2] != null) el.setSelectionRange(k[2], k[2]); } catch (e) {} } }
function blankItem() { return { code: '', name: '', uom: '', qty: '', remark: '' }; }
function fillItemMeta(it) { it.code = String(it.code || '').trim().toUpperCase(); if (S.stock[it.code]) { it.name = S.stock[it.code].name; it.uom = S.stock[it.code].uom; } else { const f = findItemAnywhere(it.code); if (f) { it.name = f.name; it.uom = f.uom; } } }
function cleanItems(items) { return items.map(i => { fillItemMeta(i); return { code: i.code, name: i.name || '', uom: i.uom || '', qty: parseFloat(i.qty), remark: (i.remark || '').trim(), req: i.req || '', lineId: i.lineId }; }).filter(i => i.code && i.qty > 0); }

document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, v = t.dataset.v;
  if (a === 'bgClose') { if (ev.target === t) { ui.sheet = null; renderSheet(); } return; }
  if (t.type === 'checkbox' && !['hold', 'queueToggle', 'regItems', 'mgrToggle', 'syncAuto', 'lockToggle', 'markPick', 'stOn'].includes(a)) return;
  switch (a) {
    case 'tab': ui.tab = v; ui.view = null; if (v === 'set') ui.setPage = null; render(); window.scrollTo(0, 0); break;
    case 'openSite': if (N) N.openSite(); else toast('Open this inside the app.'); break;
    case 'goUpdate': ui.tab = 'set'; ui.view = null; render(); setTimeout(() => { const u = document.getElementById('upd'); if (u) u.scrollIntoView(); }, 50); break;
    case 'upload': ui.upload = null; ui.sheet = { kind: 'upload' }; renderSheet(); break;
    case 'template': template(); break;
    case 'openReq': ui.view = 'req'; ui.req = v; render(); window.scrollTo(0, 0); break;
    case 'back': ui.view = null; render(); break;
    case 'hold': if (t.checked) S.hold[v] = 1; else delete S.hold[v]; save(); render(); break;
    case 'fillReq': { const PL = plan(); const r = requests().find(x => x.req === v); const ids = r.lines.filter(l => l.status === 'waiting' && PL[l.id] === 'issue').map(l => l.id); openStart(r.store, ids, r.store + ', request ' + r.req); break; }
    case 'fillStore': { const PL = plan(); const ids = S.lines.filter(l => isPending(l) && l.store === v && PL[l.id] === 'issue').map(l => l.id); openStart(v, ids, v + ', pending clearance'); break; }
    case 'editReq': { const r = requests().find(x => x.req === v); const w = r.lines.filter(l => l.status === 'waiting');
      ui.form = { req: v, store: r.store, date: r.date, rcv: (r.lines.find(l => l.rcv) || {}).rcv || '', slip: (w.find(l => l.slip) || {}).slip || '', items: w.map(l => ({ lineId: l.id, code: l.code, qty: l.qty, name: itemName(l.code), uom: itemUom(l.code) })) };
      ui.sheet = { kind: 'editReq' }; renderSheet(); break; }
    case 'dropReq': if (confirm('Remove request ' + v + ' (' + ((requests().find(x => x.req === v) || {}).store || '') + ') from the list? Waiting articles are removed; issued ones stay in the records.')) { S.lines.forEach(l => { if (l.req === v && l.status === 'waiting') l.status = 'dropped'; }); save(); ui.view = null; render(); } break;
    case 'saveReq': { const f = ui.form; if (f.rcv && !/^\d{6}$/.test(f.rcv)) { toast('Receiver must be 6 digits or blank.'); break; }
      const items = cleanItems(f.items); const keep = new Set(items.filter(i => i.lineId).map(i => i.lineId));
      const sl = (f.slip || '').trim().toUpperCase(); if (sl && !SLIP_RE.test(sl)) { toast('Slip No must be 2–10 characters with a digit.'); break; }
      S.lines.forEach(l => { if (l.req !== f.req) return; l.store = f.store.trim().toUpperCase(); l.date = f.date || l.date; l.rcv = f.rcv || ''; if (l.status === 'waiting') l.slip = sl; if (l.status === 'waiting' && !keep.has(l.id)) l.status = 'dropped'; });
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
      S.entries.push({ id: nid(), slip, serial: (f.serial || '').trim(), store: f.store, rcv: f.rcv, rname: rname(f.rcv), at, date: f.date, time: timeNow(), by: meTag(), kind: 'auto', remarks: 'marked by hand',
        items: ls.map(l => ({ lineId: l.id, req: l.req, code: l.code, name: itemName(l.code), uom: itemUom(l.code), qty: l.qty, remark: remarkFor(l.date) })) });
      ls.forEach(l => { const x = S.lines.find(y => y.id === l.id); x.status = 'issued'; x.issued.push({ slip, serial: (f.serial || '').trim(), at }); if (S.stock[l.code]) S.stock[l.code].qty = Math.round((S.stock[l.code].qty - l.qty) * 1000) / 1000; });
      save(); ui.sheet = null; renderSheet(); render(); toast('Recorded ' + slip + ' as issued.'); break; }
    case 'expPendPdf': pdfPending(); break;
    case 'setPage': ui.setPage = v; render(); window.scrollTo(0, 0); break;
    case 'setBack': ui.setPage = null; render(); window.scrollTo(0, 0); break;
    case 'goProfile': ui.tab = 'set'; ui.view = null; ui.setPage = 'profile'; render(); window.scrollTo(0, 0); break;
    case 'togStore': ui.openStore[v] = !ui.openStore[v]; render(); break;
    case 'dropStore': { const n = S.lines.filter(l => isPending(l) && l.store === v).length;
      if (confirm('Remove all ' + n + ' pending articles of ' + v + '? Issued records stay. (You can restore from a cloud backup if needed.)')) { S.lines.forEach(l => { if (isPending(l) && l.store === v) l.status = 'dropped'; }); save(); render(); toast(v + ' removed from Pending.'); } break; }
    case 'photo': document.getElementById('photoIn').click(); break;
    case 'photoDel': delete S.me.photo; save(); render(); break;
    case 'expPendXlsx': saveWb([['Pending', rowsPending()]], 'Pending-' + today() + '.xlsx'); break;
    case 'closeSheet': ui.sheet = null; renderSheet(); break;
    case 'queueToggle': S.queue = t.checked; save(true); break;
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
    case 'pick': ui.upload = { kind: v }; document.getElementById('fileIn').click(); break;
    case 'uploadCancel': ui.upload = null; renderSheet(); break;
    case 'uploadOk': doImport(); break;
    case 'regType': ui.reg.type = v; render(); break;
    case 'regItems': ui.reg.items = t.checked; break;
    case 'pdfIssue': pdfIssue(); break;
    case 'pdfReturn': pdfReturn(); break;
    case 'newManual': ui.form = { _new: true, kind: 'manual', slip: '', serial: '', store: '', rcv: '', rname: '', date: ui.reg.date, time: timeNow(), reqs: '', remarks: '', byName: S.me.name, byEmp: S.me.emp, items: [blankItem()] }; ui.sheet = { kind: 'entry' }; renderSheet(); break;
    case 'editEntry': { const e = S.entries.find(x => String(x.id) === v); ui.form = Object.assign(JSON.parse(JSON.stringify(e)), { date: entryDate(e), time: entryTime(e), reqs: e.reqs || [...new Set(e.items.map(i => i.req).filter(Boolean))].join(', '), byName: (e.by || {}).name || '', byEmp: (e.by || {}).emp || '' }); ui.sheet = { kind: 'entry' }; renderSheet(); break; }
    case 'saveEntry': { const f = ui.form; const items = cleanItems(f.items);
      if (!f.slip.trim() || !f.store.trim() || !/^\d{6}$/.test(f.rcv)) { toast('Slip No, store and a 6-digit receiver are needed.'); break; }
      const clash = S.entries.find(e => e.id !== f.id && String(e.slip).toUpperCase() === f.slip.trim().toUpperCase());
      if (clash && !confirm('Slip ' + f.slip + ' is already used for ' + clash.store + '. Save anyway?')) break;
      if (!items.length) { toast('Add at least one item with code and qty.'); break; }
      const rec = { id: f.id || nid(), slip: f.slip.trim().toUpperCase(), serial: (f.serial || '').trim(), store: f.store.trim().toUpperCase(), rcv: f.rcv, rname: (f.rname || '').trim(), at: f.at || new Date(f.date + 'T' + (f.time || '00:00')).toISOString(), date: f.date, time: f.time, reqs: (f.reqs || '').trim(), remarks: (f.remarks || '').trim(), by: { name: f.byName.trim(), emp: f.byEmp.trim() }, kind: f.kind || 'manual', items };
      if (rec.rname) { S.rnames = S.rnames || {}; S.rnames[rec.rcv] = rec.rname; }
      const i = S.entries.findIndex(e => e.id === rec.id); if (i >= 0) S.entries[i] = rec; else S.entries.push(rec);
      save(); ui.sheet = null; renderSheet(); render(); toast('Entry saved.'); break; }
    case 'delEntry': if (confirm('Delete this register entry? Stock and pending are not changed.')) { S.entries = S.entries.filter(e => e.id !== ui.form.id); save(); ui.sheet = null; renderSheet(); render(); } break;
    case 'newReturn': ui.form = { _new: true, no: nextReturnNo(), against: '1111', store: '', by: '', byName: '', date: ui.reg.date, time: timeNow(), serial: '', remarks: '', ebName: S.me.name, ebEmp: S.me.emp, items: [blankItem()] }; ui.sheet = { kind: 'return' }; renderSheet(); break;
    case 'editReturn': { const r = S.returns.find(x => String(x.id) === v); ui.form = Object.assign(JSON.parse(JSON.stringify(r)), { ebName: (r.enteredBy || {}).name || '', ebEmp: (r.enteredBy || {}).emp || '' }); ui.sheet = { kind: 'return' }; renderSheet(); break; }
    case 'saveReturn': { const f = ui.form; const items = cleanItems(f.items);
      if (!f.store.trim() || !/^\d{6}$/.test(f.by)) { toast('Store and a 6-digit "Returned by" are needed.'); break; }
      if (!items.length) { toast('Add at least one item with code and qty.'); break; }
      const rec = { id: f.id || nid(), no: f.no.trim(), against: (f.against || '1111').trim(), store: f.store.trim().toUpperCase(), by: f.by, byName: (f.byName || '').trim(), date: f.date, time: f.time, serial: (f.serial || '').trim(), remarks: (f.remarks || '').trim(), enteredBy: { name: f.ebName.trim(), emp: f.ebEmp.trim() }, items };
      if (rec.byName) { S.rnames = S.rnames || {}; S.rnames[rec.by] = rec.byName; }
      const i = S.returns.findIndex(x => x.id === rec.id); if (i >= 0) S.returns[i] = rec; else S.returns.push(rec);
      save(); ui.sheet = null; renderSheet(); render(); toast('Return saved.'); break; }
    case 'delReturn': if (confirm('Delete this return?')) { S.returns = S.returns.filter(x => x.id !== ui.form.id); save(); ui.sheet = null; renderSheet(); render(); } break;
    case 'rmItem': ui.form.items.splice(+v, 1); if (!ui.form.items.length) ui.form.items.push(blankItem()); renderSheet(); break;
    case 'addItem': ui.form.items.push(blankItem()); renderSheet(); break;
    case 'sType': ui.search.type = v; render(); break;
    case 'sOpen': ui.search.open = ui.search.open === v ? null : v; render(); break;
    case 'expSearch': { const res = searchRecords(); const rows = []; res.forEach(x => x.items.forEach(i => rows.push({ Type: x.type, Date: x.date ? fmtLong(x.date) : '', Time: x.time || '', 'Slip / Return No': x.no, 'Serial No': x.serial, Store: x.store, 'Issued to / Returned by': x.who, 'Request / Against': x.reqs, 'Item code': i.code, Item: i.name || itemName(i.code), Qty: Number(i.qty), UOM: i.uom || '', 'Item remark': i.remark || '', 'Entered by': x.by.name || '', 'Emp code': x.by.emp || '' })));
      saveWb([['Search results', rows]], 'Search-' + today() + '.xlsx'); break; }
    case 'mgrToggle': S.mgr.on = t.checked; save(); render(); break;
    case 'rmStore': if (confirm('Remove ' + v + ' from your store list? Records stay.')) { delete S.stores[v]; save(); render(); } break;
    case 'addStore': { const el = document.getElementById('newStore'); const nm = (el.value || '').trim().toUpperCase(); if (!nm) break; if (!S.stores[nm]) S.stores[nm] = { rcv: '', rname: '' }; save(); render(); break; }
    case 'syncAuto': S.sync.auto = t.checked; save(true); break;
    case 'syncNow': syncNow(false); break;
    case 'restore': restoreNow(); break;
    case 'backups': ui.sheet = { kind: 'backups' }; loadBackups(); break;
    case 'openUrl': if (N) N.openUrl(v); else window.open(v); break;
    case 'bkSave': { const note = ui.sheet.note || ''; await syncNow(false, 'manual', note); ui.sheet.note = ''; loadBackups(); break; }
    case 'bkRestore': { if (!confirm('Replace ALL data on this phone with this backup? (Tip: save a backup of the current data first.)')) break;
      try { const j = await apiGet('action=get&id=' + encodeURIComponent(v)); const url = S.sync.url; S = Object.assign(blank(), JSON.parse(j.backup)); S.sync.url = url; save(true); ui.sheet = null; renderSheet(); render(); toast('Backup restored.'); } catch (e) { toast('Restore failed: ' + e.message); } break; }
    case 'bkKeep': try { await apiPost({ action: 'meta', id: v, keep: t.dataset.k === '1' }); loadBackups(); } catch (e) { toast('Failed: ' + e.message); } break;
    case 'bkDel': if (confirm('Delete this backup copy from Drive?')) { try { await apiPost({ action: 'delete', id: v }); loadBackups(); } catch (e) { toast('Failed: ' + e.message); } } break;
    case 'bkNote': { const b = (ui.sheet.items || []).find(x => x.id === v); ui.sheet.editing = v; ui.sheet.rename = b ? b.note : ''; renderSheet(); break; }
    case 'bkNoteCancel': ui.sheet.editing = null; renderSheet(); break;
    case 'bkNoteSave': try { await apiPost({ action: 'meta', id: v, note: ui.sheet.rename || '' }); ui.sheet.editing = null; loadBackups(); } catch (e) { toast('Failed: ' + e.message); } break;
    case 'expRequests': saveWb([['Requests register', rowsRequests()]], 'Requests-register-' + today() + '.xlsx'); break;
    case 'expEntries': saveWb([['Entries log', rowsEntries()]], 'Entries-log-' + today() + '.xlsx'); break;
    case 'expItems': saveWb([['Entry items', rowsItems()]], 'Entry-items-' + today() + '.xlsx'); break;
    case 'expStock': saveWb([['Stock now', rowsStock()]], 'Stock-now-' + today() + '.xlsx'); break;
    case 'expReturns': saveWb([['Returns', rowsReturns()]], 'Returns-' + today() + '.xlsx'); break;
    case 'expAll': saveWb([['Requests register', rowsRequests()], ['Request lines', rowsAllLines()], ['Entries log', rowsEntries()], ['Entry items', rowsItems()], ['Pending', rowsPending()], ['Returns', rowsReturns()], ['Stock now', rowsStock()]], 'JV-Stock-Issue-backup-' + today() + '.xlsx'); break;
    case 'lockToggle': if (N) { N.setLock(t.checked); INFO.lock = t.checked; toast(t.checked ? 'Lock on. Fingerprint or PIN needed when opening.' : 'Lock off.'); } break;
    case 'checkUpdate': checkUpdate(true); break;
    case 'installUpdate': if (S.updateInfo && S.updateInfo.url && N) N.installUpdate(S.updateInfo.url); break;
    case 'mode': if (N && INFO.mode !== v) { if (confirm(v === 'bundled' ? 'Use the built-in screens from the installed APK? (rollback)' : 'Use the latest screens from GitHub?')) N.setMode(v); } break;
    case 'wipe': if (confirm('Delete ALL requests, entries, returns, stock and settings on this phone?') && confirm('Really delete everything? Back up first if unsure.')) { const url = S.sync.url; S = blank(); S.sync.url = url; save(true); render(); toast('All data cleared.'); } break;
  }
});

document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.in === 'slip' || el.dataset.in === 'rcv') { const k = focusKey(el); ui.sheet[el.dataset.in] = el.dataset.in === 'slip' ? el.value.trim().toUpperCase() : el.value.replace(/\D/g, ''); renderSheet(); refocus(k); return; }
  if (el.dataset.in === 'q') { const k = focusKey(el); ui.search.q = el.value; render(); refocus(k); return; }
  if (el.dataset.bk) { ui.sheet[el.dataset.bk] = el.value; return; }
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
  if (el.id === 'photoIn') {
    const f = el.files[0]; el.value = ''; if (!f) return;
    const img = new Image(); const fr = new FileReader();
    fr.onload = () => { img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 220; const k = Math.min(img.width, img.height); const g = c.getContext('2d');
      g.drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, 220, 220); S.me.photo = c.toDataURL('image/jpeg', 0.85); save(); render(); toast('Photo updated.'); }; img.src = fr.result; };
    fr.readAsDataURL(f); return;
  }
  if (el.id === 'fileIn') {
    const f = el.files[0]; el.value = ''; if (!f || !ui.upload) return;
    if (!window.XLSX) { ui.upload.error = 'Excel tools not loaded yet. Check internet and try again.'; renderSheet(); return; }
    try {
      const wb = await readWorkbook(f);
      const r = ui.upload.kind === 'stock' ? parseStock(wb) : parseRequests(wb, ui.upload.kind);
      if (r.error) ui.upload.error = r.error; else ui.upload.result = r;
    } catch (e) { ui.upload.error = 'Could not read this file. Use .xlsx or .csv.'; }
    renderSheet(); return;
  }
  if (el.dataset.sort) { ui.sort[el.dataset.sort] = el.value; render(); return; }
  if (el.dataset.in === 'regDate') { ui.reg.date = el.value || today(); render(); return; }
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
  if (u.kind === 'stock') { S.stock = r.stock; S.stockAt = new Date().toISOString(); save(); toast('Stock replaced: ' + r.count + ' items. Everything re-planned.'); }
  else {
    r.rows.forEach(x => {
      S.lines.push({ id: nid(), req: x.req, store: x.store, date: x.date, code: x.code, qty: x.qty, rcv: x.rcv, slip: x.slip || '', src: x.src, earlier: x.earlier || '', status: 'waiting', issued: [] });
      if (!S.stores[x.store]) S.stores[x.store] = { rcv: '', rname: '' };
    });
    save(); toast(r.rows.length + ' articles imported.');
  }
  ui.upload = null; ui.sheet = null; renderSheet(); render();
}

/* ---------------- start ---------------- */
render();
if (Date.now() - (S.lastUpdateCheck || 0) > 12 * 3600e3) setTimeout(() => checkUpdate(false), 3000);
