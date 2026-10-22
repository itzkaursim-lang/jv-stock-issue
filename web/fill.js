/* JV Stock Issue – CUIMS fill engine. Injected by the app on every CUIMS page load. */
(function () {
 var __go = function () {
  if (window.JVFill && window.JVFill.loaded) return;
  var B = window.JVS;
  if (!B) return;
  var J = { loaded: true };
  window.JVFill = J;

  var ISSUE_URL = 'https://staff.cuchd.in/frmStoreIssueReceiveLC.aspx';
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var jq = window.jQuery;
  var running = false;
  var ui = { confirmCancel: false };

  function job() { try { return JSON.parse(B.jobGet() || 'null'); } catch (e) { return null; } }
  function save(j) { B.jobSet(JSON.stringify(j)); }
  function ev(type, extra) {
    var j = job() || {};
    var o = { type: type, jobId: j.id || null, slip: j.slip || null, at: new Date().toISOString() };
    for (var k in (extra || {})) o[k] = extra[k];
    B.siteEvent(JSON.stringify(o));
  }
  function active(j) { return j && ['done', 'cancelled'].indexOf(j.phase) < 0; }
  function log(j, msg, bad) { j.log = j.log || []; j.log.push([msg, !!bad]); if (j.log.length > 60) j.log = j.log.slice(-60); save(j); paint(); }
  function fire(el, t) { el.dispatchEvent(new Event(t, { bubbles: true })); }
  function live(id) { var e = $(id); return e && !e.disabled ? e : null; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function usDate(d) { return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

  async function idle(min) {
    await sleep(min || 400);
    var p = window.Sys && Sys.WebForms && Sys.WebForms.PageRequestManager && Sys.WebForms.PageRequestManager.getInstance();
    for (var i = 0; i < 150; i++) { if (!p || !p.get_isInAsyncPostBack()) break; await sleep(200); }
    await sleep(400);
  }

  function Pause(msg) { this.msg = msg; }
  function pauseWith(msg) { var j = job(); if (!j) return; j.paused = true; j.pauseMsg = msg; save(j); log(j, msg, true); ev('paused', { msg: msg }); throw new Pause(msg); }
  function guard(j, k) { j.tries = j.tries || {}; j.tries[k] = (j.tries[k] || 0) + 1; save(j); if (j.tries[k] > 5) pauseWith('CUIMS did not respond at step "' + k + '" after 5 tries. Check the page, then tap Resume.'); }

  /* ---------- page kinds ---------- */
  var isIssue = !!$('ContentPlaceHolder1_ddldoctype');
  var isLogin = !isIssue && (!!document.querySelector('input[type="password"]') || /login|signin|default\.aspx|^\/?$/i.test(location.pathname) && !!document.querySelector('input[type="text"],input:not([type])'));

  /* ---------- control bar ---------- */
  var bar = document.createElement('div');
  bar.id = 'jvbar';
  bar.style.cssText = 'position:absolute;left:-9999px;top:0;transition:none;will-change:transform;z-index:2147483647;background:#F7F6FB;color:#141414;border-radius:24px;padding:0;font:16px/1.45 Outfit,system-ui,sans-serif;box-shadow:0 12px 40px rgba(15,23,42,.35),0 0 0 1px rgba(201,162,75,.45);max-height:62vh;overflow:auto;transform-origin:0 0;box-sizing:border-box';
  document.body.appendChild(bar);
  var AUTO = null; try { AUTO = (B.autoCfg && B.autoCfg()) ? JSON.parse(B.autoCfg()) : null; } catch (e) { AUTO = null; }
  var mini = false, portal = false, immersive = false; try { mini = localStorage.getItem('jvBarMini') === '1'; portal = localStorage.getItem('jvPortal') === '1'; } catch (e) {}
  function place() {
    var vv = window.visualViewport;
    var sc = vv ? vv.scale : 1, vw = vv ? vv.width : window.innerWidth, vh = vv ? vv.height : window.innerHeight;
    var pl = vv ? vv.pageLeft : window.scrollX, pt = vv ? vv.pageTop : window.scrollY;
    var inv = 1 / sc, gap = 8;
    var full = !mini && (portal || !!AUTO); if (full) gap = 0;
    var w = mini ? 0 : Math.round(vw * sc - gap * 2);
    var W = mini ? 'auto' : w + 'px', T = 'scale(' + inv + ')';
    if (bar.style.width !== W) bar.style.width = W;
    if (bar.style.transform !== T) bar.style.transform = T;
    var MH = full ? Math.round(vh * sc) + 'px' : '74vh'; if (bar.style.maxHeight !== MH) bar.style.maxHeight = MH; var HH = full ? Math.round(vh * sc) + 'px' : ''; if (bar.style.height !== HH) bar.style.height = HH;
    var h = bar.offsetHeight, bw = bar.offsetWidth;
    var L = Math.round((mini ? pl + vw - (bw + gap) * inv : pl + gap * inv) * 10) / 10 + 'px', Tp = Math.round((pt + vh - (h + gap) * inv) * 10) / 10 + 'px';
    if (bar.style.left !== L) bar.style.left = L;
    if (bar.style.top !== Tp) bar.style.top = Tp;
    try { sessionStorage.setItem('jvBarGeo', JSON.stringify({ w: bar.style.width, l: bar.style.left, t: bar.style.top, tr: bar.style.transform, html: bar.innerHTML.length < 60000 ? bar.innerHTML : '' })); } catch (e) {}
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  window.addEventListener('scroll', place); window.addEventListener('resize', place);
  setInterval(place, 800);
  var hadGeo = false;
  try { var g0 = JSON.parse(sessionStorage.getItem('jvBarGeo') || 'null'); if (g0) { hadGeo = true; bar.style.width = g0.w; bar.style.left = g0.l; bar.style.top = g0.t; bar.style.transform = g0.tr; if (g0.html) bar.innerHTML = g0.html; } } catch (e) {}
  var BTN = 'height:52px;padding:0 20px;border-radius:999px;font:700 15px \'Outfit\',system-ui,sans-serif;cursor:pointer;white-space:nowrap;';
  var WHO = (B.who && B.who()) || 'emp';
  function btn(id, label, kind) {
    var st = kind === 'main' ? 'background:#141414;color:#fff;border:0;box-shadow:0 8px 16px rgba(20,20,20,.2);' : kind === 'gold' ? 'background:#ECE6FF;color:#4B3BA8;border:0;' : kind === 'warn' ? 'background:#FFD9E3;color:#8E1B3A;border:0;' : kind === 'link' ? 'background:none;color:#C0264A;border:0;padding:0 10px;' : kind === 'ghost' ? 'background:#fff;color:#141414;border:0;min-height:38px;padding:0 12px;font-size:13.5px;' : 'background:#fff;color:#141414;border:1.5px solid #E4E1EC;';
    return '<button type="button" data-jv="' + id + '" style="' + BTN + st + 'display:inline-flex;align-items:center;gap:8px">' + label + '</button>';
  }
  function curItem(j) {
    if (!j || !j.items) return null;
    for (var i = 0; i < j.items.length; i++) { var it = j.items[i]; if (!it.skip && !inGrid(it.code)) return it; }
    return null;
  }
  var lastHtml = '';
  function uncoverSoon() { try { if (B.uncover) requestAnimationFrame(function () { requestAnimationFrame(function () { B.uncover(); }); }); } catch (e) {} }
  function paint() { var before = bar.innerHTML; paintInner(); var now = bar.innerHTML; if (now !== lastHtml) { lastHtml = now; place(); } else if (before !== now) place();
    if (!J.entered) { J.entered = true; if (!hadGeo) { try { var fc = bar.firstElementChild; if (fc && fc.animate) fc.animate([{ opacity: 0, transform: 'translateY(22px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch (e) {} } }
    if (!J.uncovered) { J.uncovered = true; try { B.setCover && B.setCover((portal || !!AUTO) && !mini); } catch (e) {} uncoverSoon(); } }
  var LOGO = 'data:image/png;base64,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';
  var ME = (function () { try { var d = JSON.parse(B.storeGet() || '{}'); return d.me || {}; } catch (e) { return {}; } })();
  var IC = {
    pause: '<path d="M7 5v14M17 5v14"/>', play: '<path d="M7 4l13 8-13 8z"/>', down: '<path d="M6 9l6 6 6-6"/>', up: '<path d="M6 15l6-6 6 6"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', no: '<path d="M6 6l12 12M18 6L6 18"/>', back: '<path d="M15 5l-7 7 7 7"/>', alert: '<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>'
  };
  function ic(n, sz, col) { return '<svg viewBox="0 0 24 24" width="' + (sz || 18) + '" height="' + (sz || 18) + '" fill="none" stroke="' + (col || 'currentColor') + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-3px">' + IC[n] + '</svg>'; }
  var F = "'Outfit',system-ui,sans-serif";
  (function loadFont() { try { if (document.getElementById('jvfont')) return; var l = document.createElement('link'); l.id = 'jvfont'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap'; (document.head || document.documentElement).appendChild(l); } catch (e) {} })();
  var C = { ink: '#141414', mute: '#6E6B7B', faint: '#8A87A0', lav: '#B9A7FF', lavInk: '#4B3BA8', over: '#6B5BD6', soft: '#F7F6FB', line: '#ECEAF3', ok: '#12A36B', okBg: '#E2F7EC', okInk: '#0B5E3D', warnBg: '#FFF1D9', warnInk: '#7A4B00', noBg: '#FFE4EA', noInk: '#C0264A' };
  function reqOf(j) { var r = {}; (j.items || []).forEach(function (x) { if (x.req) r[x.req] = 1; }); return Object.keys(r).join(', ') || '–'; }
  function cnt(j) { var t = (j.items || []).filter(function (x) { return !x.skip; }); return { total: t.length, done: t.filter(function (x) { return inGrid(x.code); }).length }; }
  function ring(done, total, col) {
    var r = 24, c = 2 * Math.PI * r, f = total ? done / total : 0;
    return '<div style="position:relative;width:60px;height:60px;flex-shrink:0"><svg width="60" height="60" style="transform:rotate(-90deg)"><circle cx="30" cy="30" r="' + r + '" stroke="#fff" stroke-width="7" fill="none"/><circle cx="30" cy="30" r="' + r + '" stroke="' + (f ? col : 'transparent') + '" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" style="transition:stroke-dasharray .4s"/></svg><b style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 15px ' + F + ';color:' + C.ink + '">' + (total ? done + '/' + total : '–') + '</b></div>';
  }
  function hero(over, title, j, ringCol) {
    var k = j ? cnt(j) : null;
    var collapse = '<button type="button" data-jv="hide" aria-label="Hide panel" style="width:40px;height:40px;border-radius:50%;border:0;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(20,20,20,.08);flex-shrink:0">' + ic('down', 20, C.ink) + '</button>';
    var h = '<div style="padding:18px 18px 16px;background:radial-gradient(120% 140% at 0% 0%,#D9CEFF 0%,#EDE8FF 45%,#fff 100%)">' +
      '<div style="display:flex;align-items:center;gap:12px"><img src="' + LOGO + '" alt="JV Stock Issue" style="width:46px;height:46px;border-radius:15px;box-shadow:0 8px 18px rgba(60,40,140,.28);flex-shrink:0">' +
      '<div style="flex:1;min-width:0"><div style="font:800 11.5px ' + F + ';letter-spacing:.09em;color:' + C.over + ';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(over) + '</div><div style="font:800 19px ' + F + ';letter-spacing:-.01em;color:' + C.ink + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(title) + '</div></div>' + collapse + '</div>';
    if (j) h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center">' + idTile('Request', reqOf(j), C.lavInk) + idTile('Slip', j.slip, C.ink) + ring(k.done, k.total, ringCol || C.ink) + '</div>';
    return h + '</div>';
  }
  function idTile(l, v, col) { return '<div style="flex:1;min-width:0;background:#fff;border-radius:18px;padding:9px 12px;box-shadow:0 2px 8px rgba(60,40,140,.06)"><span style="display:block;font:700 10.5px ' + F + ';color:' + C.faint + ';letter-spacing:.06em;text-transform:uppercase">' + l + '</span><b style="display:block;font:800 19px ' + F + ';color:' + col + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(v) + '</b></div>'; }
  function statusCard(kind, title, sub) {
    var bg = kind === 'ok' ? C.okBg : kind === 'warn' ? C.warnBg : kind === 'no' ? C.noBg : '#F2EEFF';
    var dotBg = kind === 'ok' ? C.ok : kind === 'warn' ? '#FFB648' : kind === 'no' ? C.noInk : C.ink;
    var icn = kind === 'ok' ? ic('ok', 18, '#fff') : kind === 'warn' ? ic('pause', 18, C.ink) : kind === 'no' ? ic('alert', 18, '#fff') : ic('play', 16, '#fff');
    return '<div style="display:flex;align-items:center;gap:12px;border-radius:20px;padding:12px 14px;background:' + bg + '"><div style="width:38px;height:38px;border-radius:50%;background:' + dotBg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0">' + icn + '</div><div style="min-width:0"><b style="display:block;font:800 16px ' + F + ';color:' + C.ink + '">' + esc(title) + '</b>' + (sub ? '<span style="display:block;font:500 13px ' + F + ';color:#4E5A55">' + esc(sub) + '</span>' : '') + '</div></div>';
  }
  function cell(label, val, sub, ok) {
    var t = ok === undefined ? '' : '<i style="position:absolute;right:10px;top:10px;width:20px;height:20px;border-radius:50%;background:' + (ok ? '#D6F5E5' : C.noBg) + ';display:flex;align-items:center;justify-content:center">' + ic(ok ? 'ok' : 'no', 12, ok ? C.okInk : C.noInk) + '</i>';
    return '<div style="position:relative;background:' + C.soft + ';border-radius:18px;padding:11px 12px;min-width:0' + (ok === false ? ';box-shadow:inset 0 0 0 1.5px ' + C.noInk : '') + '"><span style="display:block;font:700 10.5px ' + F + ';color:' + C.faint + ';letter-spacing:.05em;text-transform:uppercase">' + label + '</span><b style="display:block;font:700 15.5px ' + F + ';color:' + C.ink + ';margin-top:2px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:16px">' + val + '</b>' + (sub ? '<small style="display:block;font:500 12.5px ' + F + ';color:' + C.mute + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(sub) + '</small>' : '') + t + '</div>';
  }
  function secHead(l, r) { return '<div style="display:flex;justify-content:space-between;font:800 11.5px ' + F + ';letter-spacing:.09em;color:' + C.faint + ';text-transform:uppercase"><span>' + l + '</span><span>' + (r || '') + '</span></div>'; }
  function itemRows(j, list) {
    var cur = curItem(j);
    return '<div style="background:' + C.soft + ';border-radius:20px;padding:2px 12px">' + list.map(function (o, k) {
      var x = o.x, r = gridRow(x.code);
      var st = x.skip ? ['Skipped', C.mute, '#EEECF3'] : r ? ['Added', C.okInk, '#D6F5E5'] : (cur && cur.code === x.code && j.phase === 'fill') ? ['Now', '#fff', C.ink] : ['Next', C.mute, '#EEECF3'];
      return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;' + (k < list.length - 1 ? 'border-bottom:1px solid ' + C.line : '') + '"><span style="width:26px;height:26px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font:800 12px ' + F + ';color:' + C.mute + ';flex-shrink:0">' + (o.i + 1) + '</span><span style="flex:1;min-width:0"><b style="display:block;font:700 15px ' + F + ';color:' + C.ink + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:capitalize">' + esc(String(x.name || x.code).toLowerCase()) + '</b><span style="font:500 12px ' + F + ';color:' + C.faint + '">' + esc(x.code) + (r && !isNaN(r.bal) ? ' · balance ' + Number(r.bal).toLocaleString('en-IN') : '') + '</span></span><b style="font:800 16px ' + F + ';color:' + C.ink + ';white-space:nowrap">' + esc(x.qty) + (x.uom ? '<small style="font-size:11px;color:' + C.faint + ';margin-left:2px">' + esc(x.uom) + '</small>' : '') + '</b><span style="font:800 11.5px ' + F + ';border-radius:99px;padding:4px 10px;background:' + st[2] + ';color:' + st[1] + '">' + st[0] + '</span></div>';
    }).join('') + '</div>';
  }
  function chip(id, label, on) { return '<button type="button" data-jv="' + id + '" style="display:inline-flex;align-items:center;gap:7px;height:38px;border-radius:99px;padding:0 14px 0 11px;border:0;cursor:pointer;font:700 13px ' + F + ';background:' + (on ? C.ink : '#F2F1F6') + ';color:' + (on ? '#fff' : '#4A4758') + '"><i style="width:8px;height:8px;border-radius:50%;background:' + (on ? '#7CF0B5' : '#C9C5D6') + '"></i>' + label + '</button>'; }
  function chips(j) { return '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (j.adv ? '<span style="display:inline-flex;align-items:center;height:38px;border-radius:99px;padding:0 14px;font:700 13px ' + F + ';background:#FFE7C2;color:#7A4B00">Advance issue · manual SUBMIT only</span>' : chip('tQueue', 'Queue', !!j.queue) + chip('tAuto', 'Auto submit', !!j.autoSubmit)) + chip('tPortal', 'Big panel', portal) + chip('tFull', 'Full screen', immersive) + '</div>'; }
  function credit() { var who = ME.builder || ME.name || 'JV'; return '<div style="display:flex;align-items:center;justify-content:space-between;font:600 11.5px ' + F + ';color:#9A97A8">' + '<span>JV Stock Issue · Built by ' + esc(who) + '</span>' + (ME.photo ? '<img src="' + ME.photo + '" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.2)">' : '') + '</div>'; }
  function row2(a, b) { return '<div style="display:flex;gap:10px;align-items:center">' + a + (b || '') + '</div>'; }
  function wrap(inner) { return '<div style="padding:16px 18px 18px;display:flex;flex-direction:column;gap:14px">' + inner + '</div>'; }
  var autoTimer = null;
  function verify(j) {
    var items = (j.items || []).filter(function (x) { return !x.skip; });
    var sb = $('ContentPlaceHolder1_txtRequisitonSlipno') || document.querySelector('input[id*="RequisitonSlipno"]');
    var rc = $('txtIssueTo'), pa = $('ContentPlaceHolder1_ddlProject'), it = $('ddlIssueType');
    var paText = pa && pa.selectedIndex >= 0 ? pa.options[pa.selectedIndex].text.trim() : '';
    var rows = items.filter(function (x) { return gridRow(x.code); }).length;
    var dates = {}; items.forEach(function (x) { if (x.reqDate) dates[x.reqDate] = 1; });
    var dl = Object.keys(dates).map(function (d) { var p = d.split('-'); return p.length === 3 ? (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0] : d; }).join(', ');
    return { store: paText.toUpperCase() === String(j.store).toUpperCase(), paText: paText, slip: !!sb && sb.value.trim() === j.slip, rcv: !!rc && rc.value.indexOf(j.rcv) >= 0, type: !!it && it.value === 'Offline', rows: rows, total: items.length, dates: dl };
  }
  var lastNote = '';
  function notifyProgress(j) {
    if (WHO !== 'emp' || !(B.progress2 || B.progress)) return;
    try {
      if (!j || !j.phase) return;
      if (j.phase === 'cancelled') { if (lastNote) { B.progressClear && B.progressClear(); lastNote = ''; } if (B.keepAwake) B.keepAwake(false); return; }
      var k = cnt(j), on = active(j), req = reqOf(j), cur = curItem(j);
      var d = { req: req, slip: j.slip, title: j.store, done: k.done, total: k.total, tag: j.queue ? 'queue on' : '' };
      d.metaL = k.done + ' of ' + k.total + ' added'; d.metaR = (j.queue ? 'Queue on' : 'Queue off') + ' · Auto submit ' + (j.autoSubmit ? 'on' : 'off');
      if (j.phase === 'done') { d.kind = 'saved'; d.over = 'Saved · ' + req; d.bigOver = 'SAVED'; d.title = 'Slip ' + j.slip; d.sub = j.queue && j.next ? 'Next in queue: ' + j.next : j.store; d.serial = String(j.serial || ''); d.now = 'Saved on CUIMS'; d.nowSub = j.store + ' · ' + k.total + ' articles'; d.b1 = 'Open|open'; on = false; }
      else if (j.paused) { d.kind = 'paused'; d.over = req + ' · Slip ' + j.slip; d.bigOver = 'PAUSED'; d.sub = 'Paused · ' + (j.pauseMsg === 'by you' ? 'by you' : (j.pauseMsg || '')); d.now = 'Paused'; d.nowSub = j.pauseMsg === 'by you' ? 'Tap Resume to continue' : (j.pauseMsg || ''); d.b1 = 'Resume|resume'; d.b2 = 'Open|open'; d.b3 = 'Cancel|cancel'; }
      else if (j.phase === 'await') { var v = verify(j), ok = v.store && v.slip && v.rcv && v.type && v.rows === v.total; d.kind = 'ready'; d.allOk = ok; d.over = req + ' · Slip ' + j.slip; d.bigOver = 'READY TO SUBMIT'; d.sub = ok ? 'Ready · waiting for SUBMIT' : 'Check the form before SUBMIT'; d.now = ok ? 'All checks match' : 'Something does not match'; d.nowSub = 'GA' + j.rcv + (j.rname ? ' ' + j.rname : '') + ' · ' + k.total + ' articles'; d.b1 = 'Open CUIMS|open'; d.b3 = 'Cancel|cancel'; }
      else if (j.phase === 'capture') { d.kind = 'capture'; d.over = req + ' · Slip ' + j.slip; d.bigOver = 'FINDING SERIAL'; d.sub = 'Finding the Serial No'; d.now = 'Finding the Serial No'; d.nowSub = 'Show Transactions · ' + j.slip; d.b2 = 'Open|open'; }
      else { d.kind = 'fill'; d.over = req + ' · Slip ' + j.slip; d.bigOver = j.phase === 'dup' ? 'CHECKING' : 'ISSUE ENTRY'; d.sub = cur ? 'Adding ' + cur.name + ' · ' + k.done + ' of ' + k.total : 'Filling the form'; d.now = cur ? 'Adding ' + String(cur.name || cur.code) : (j.phase === 'dup' ? 'Checking ' + j.slip : 'Filling the form'); d.nowSub = cur ? cur.code + ' · ' + cur.qty + (cur.uom ? ' ' + cur.uom : '') : 'Store, receiver, department'; d.b1 = 'Pause|pause'; d.b2 = 'Open|open'; d.b3 = 'Cancel|cancel'; }
      var key = JSON.stringify(d) + on;
      if (key !== lastNote) { lastNote = key; if (B.progress2) B.progress2(JSON.stringify(d), on); else B.progress(d.title, d.sub, d.done, d.total, on); }
      if (B.keepAwake) B.keepAwake(on);
    } catch (e) {}
  }
  function paintInner() { notifyProgress(job()); paintInner2(); }
  // ---------- automatic live stock (manager login) ----------
  var AS = (function () { try { var x = JSON.parse(localStorage.getItem('jvAS') || 'null'); return x && AUTO && x.run === AUTO.run ? x : { run: AUTO ? AUTO.run : 0, step: 'start' }; } catch (e) { return { run: 0, step: 'start' }; } })();
  function asSave() { try { localStorage.setItem('jvAS', JSON.stringify(AS)); } catch (e) {} }
  var ASTEPS = [['login', 'Log in (manager ID)'], ['store', 'Store'], ['fy', 'Financial year'], ['show', 'Show report'], ['loaded', 'Report fully loaded'], ['export', 'Export to Excel'], ['download', 'Bring the file to the app']];
  function stepIdx(k) { for (var i = 0; i < ASTEPS.length; i++) if (ASTEPS[i][0] === k) return i; return -1; }
  function autoPanel() {
    var cur = AS.err ? stepIdx(AS.step) : stepIdx(AS.step);
    var rows = ASTEPS.map(function (st, i) {
      var state = AS.err && i === cur ? 'err' : i < cur ? 'ok' : i === cur ? 'now' : 'next';
      var dot = state === 'ok' ? '<span style="width:28px;height:28px;border-radius:50%;background:' + C.ok + ';display:flex;align-items:center;justify-content:center">' + ic('ok', 14, '#fff') + '</span>' : state === 'now' ? '<span style="width:28px;height:28px;border-radius:50%;background:' + C.ink + ';display:flex;align-items:center;justify-content:center"><i style="width:10px;height:10px;border-radius:50%;background:' + C.lav + ';animation:jvp 1s ease-in-out infinite"></i></span>' : state === 'err' ? '<span style="width:28px;height:28px;border-radius:50%;background:' + C.noInk + ';display:flex;align-items:center;justify-content:center">' + ic('no', 14, '#fff') + '</span>' : '<span style="width:28px;height:28px;border-radius:50%;background:#EEECF3"></span>';
      var val = st[0] === 'store' ? AUTO.store : st[0] === 'fy' ? AUTO.fy : st[0] === 'loaded' && AS.rows ? AS.rows + ' rows' : '';
      return '<div style="display:flex;align-items:center;gap:12px;padding:9px 0;' + (i < ASTEPS.length - 1 ? 'border-bottom:1px solid ' + C.line : '') + '">' + dot + '<b style="flex:1;font:' + (state === 'now' ? 800 : 600) + ' 15px ' + F + ';color:' + (state === 'next' ? C.faint : C.ink) + '">' + st[1] + '</b><span style="font:600 13px ' + F + ';color:' + C.mute + '">' + esc(val) + '</span></div>';
    }).join('');
    var msg = AS.err ? statusCard('no', 'Stopped', AS.err) : statusCard('run', AS.note || 'Working…', 'Live stock update · ' + AUTO.store + ' · ' + AUTO.fy);
    return hero('Live stock · auto update', 'Manager CUIMS', null) + wrap(msg + '<div style="background:' + C.soft + ';border-radius:20px;padding:4px 14px">' + rows + '</div>' +
      row2(AS.err ? btn('asRetry', 'Try again', 'main') : '', btn('asStop', AS.err ? 'Close' : 'Stop', AS.err ? '' : 'link')) + '<style>@keyframes jvp{50%{transform:scale(.5);opacity:.5}}</style>' + credit());
  }
  function vis(x) { return x && x.offsetParent !== null; }
  function setSel(sel, re) { for (var i = 0; i < sel.options.length; i++) if (re.test(sel.options[i].text.trim())) { if (sel.selectedIndex !== i) { sel.selectedIndex = i; fire(sel, 'change'); return 'changed'; } return 'ok'; } return 'missing'; }
  function reportReady() {
    var aw = [].slice.call(document.querySelectorAll('[id$="AsyncWait"],[id*="AsyncWait_Wait"]')).some(function (x) { return x.offsetParent !== null && getComputedStyle(x).display !== 'none' && getComputedStyle(x).visibility !== 'hidden'; });
    if (aw) return 0;
    var tds = [].slice.call(document.querySelectorAll('td,div')).filter(function (x) { return x.children.length === 0 && /^UOM$/i.test((x.textContent || '').trim()); });
    if (!tds.length) return 0;
    var rows = [].slice.call(document.querySelectorAll('td')).filter(function (x) { return x.children.length <= 1 && /^[A-Z]{1,5}-\d+$/.test((x.textContent || '').trim()); }).length;
    return rows;
  }
  function doExport() {
    try { if (window.Sys && Sys.Application && Sys.Application.getComponents) { var cs = Sys.Application.getComponents(); for (var i = 0; i < cs.length; i++) if (typeof cs[i].exportReport === 'function') { try { cs[i].exportReport('EXCELOPENXML'); } catch (e) { cs[i].exportReport('EXCEL'); } return true; } } } catch (e) {}
    var fl = [].slice.call(document.querySelectorAll('a,input,img,div,span,button')).filter(function (x) { return vis(x) && /export/i.test((x.title || '') + ' ' + (x.alt || '') + ' ' + (x.id || '')); })[0];
    if (fl) fl.click();
    var ex = [].slice.call(document.querySelectorAll('a,div,span,li')).filter(function (x) { return x.children.length === 0 && /^excel$/i.test((x.textContent || '').trim()); })[0];
    if (ex) { ex.click(); return true; }
    return false;
  }
  function asStep() {
    if (!AUTO) return;
    if (AS.err || AS.step === 'download') { paint(); return; }
    var now = Date.now();
    if (isLogin) { AS.step = 'login'; AS.note = 'Logging in with your saved manager ID'; asSave(); paint(); return; }
    if (AS.step === 'start' || AS.step === 'login') { AS.step = 'store'; AS.t0 = now; }
    if (AS.t0 && now - AS.t0 > 240000) { AS.err = 'This took longer than 4 minutes. Check the page, then Try again.'; asSave(); paint(); return; }
    var sels = [].slice.call(document.querySelectorAll('select')).filter(vis);
    var storeSel = sels.filter(function (x) { return [].some.call(x.options, function (o) { return /store/i.test(o.text) || new RegExp(AUTO.store, 'i').test(o.text); }); })[0];
    if (AS.step === 'store') {
      if (!storeSel) { AS.note = 'Waiting for the Store box'; asSave(); paint(); return; }
      var r = setSel(storeSel, new RegExp('^' + AUTO.store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'));
      if (r === 'missing') { AS.err = '"' + AUTO.store + '" is not in the Store list.'; asSave(); paint(); return; }
      AS.note = 'Store: ' + AUTO.store; if (r === 'ok') { AS.step = 'fy'; AS.fyAt = now; } asSave(); paint(); return;
    }
    if (AS.step === 'fy') {
      var fyEl = [].slice.call(document.querySelectorAll('select,input[type="text"],input:not([type])')).filter(function (x) { return vis(x) && x !== storeSel && /fin|year|fy|session/i.test((x.id || '') + (x.name || '')); })[0];
      if (!fyEl) { if (now - (AS.fyAt || now) > 6000) { AS.step = 'show'; } AS.note = 'Looking for the Financial Year box'; asSave(); paint(); return; }
      if (fyEl.tagName === 'SELECT') { var r2 = setSel(fyEl, new RegExp(AUTO.fy.replace('-', '\\s*-\\s*'))); if (r2 === 'missing') { AS.err = 'Financial year ' + AUTO.fy + ' is not in the list.'; asSave(); paint(); return; } if (r2 === 'changed') { asSave(); return; } }
      else if (fyEl.value.trim() !== AUTO.fy) { try { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fyEl, AUTO.fy); } catch (e) { fyEl.value = AUTO.fy; } fire(fyEl, 'input'); fire(fyEl, 'change'); }
      AS.step = 'show'; AS.note = 'Financial year ' + AUTO.fy; asSave(); paint(); return;
    }
    if (AS.step === 'show') {
      var sb = [].slice.call(document.querySelectorAll('input[type="submit"],input[type="button"],button,a')).filter(function (x) { return vis(x) && /^\s*show\s*$/i.test(x.value || x.textContent || ''); })[0];
      if (!sb) { AS.note = 'Waiting for the SHOW button'; asSave(); paint(); return; }
      AS.step = 'loaded'; AS.showAt = now; AS.note = 'Loading the stock report'; asSave(); paint(); sb.click(); return;
    }
    if (AS.step === 'loaded') {
      var rows = reportReady();
      if (!rows) { AS.readyAt = 0; AS.note = 'Loading the stock report'; if (now - AS.showAt > 120000) AS.err = 'The report did not load in 2 minutes.'; asSave(); paint(); return; }
      if (!AS.readyAt) { AS.readyAt = now; AS.rows = rows; AS.note = 'Report shown. Letting it finish loading'; asSave(); paint(); return; }
      if (now - AS.readyAt < 5000) { AS.rows = rows; asSave(); paint(); return; }
      AS.step = 'export'; AS.expAt = 0; asSave();
    }
    if (AS.step === 'export') {
      if (AS.expAt && now - AS.expAt < 25000) { AS.note = 'Exporting to Excel'; paint(); return; }
      if ((AS.expTries || 0) >= 2) { AS.err = 'Excel export did not start. Tap the floppy → Excel yourself, or Try again.'; asSave(); paint(); return; }
      AS.expTries = (AS.expTries || 0) + 1; AS.expAt = now; AS.note = 'Exporting to Excel'; asSave(); paint();
      if (!doExport()) { AS.expAt = now - 20000; asSave(); }
      return;
    }
  }
  if (WHO === 'mgr') {
    var nativeOpen = window.open;
    window.open = function (u) { try { if (AUTO && u && /Format=|OpType=Export|Export/i.test(String(u))) { var a = document.createElement('a'); a.href = u; B.fetchStockUrl && B.fetchStockUrl(a.href); return null; } } catch (e) {} return nativeOpen.apply(window, arguments); };
  }
  J.autoMsg = function (k, m) { if (!AUTO) return; if (k === 'download') { AS.step = 'download'; AS.note = 'Bringing the Excel file to the app'; } else if (k === 'fail') { AS.err = 'Download failed: ' + (m || ''); } asSave(); paint(); };
  function paintInner2() {
    var j = job();
    if (mini) {
      var k0 = j && j.items ? cnt(j) : { done: 0, total: 0 };
      var t1 = WHO === 'mgr' ? 'Manager CUIMS' : !active(j) ? 'JV Stock Issue' : reqOf(j) + ' · ' + k0.done + '/' + k0.total;
      var t2 = WHO === 'mgr' ? 'Live stock' : !active(j) ? (isLogin ? 'Log in' : 'Ready') : (j.paused ? 'Paused' : j.phase === 'await' ? 'Ready to submit' : j.phase === 'capture' ? 'Finding Serial' : 'Filling') + ' · ' + j.store;
      bar.innerHTML = '<button type="button" data-jv="expand" aria-label="Show panel" style="display:flex;align-items:center;gap:10px;height:58px;border-radius:99px;background:' + C.ink + ';color:#fff;border:0;padding:0 16px 0 7px;cursor:pointer;box-shadow:0 14px 30px rgba(20,20,20,.3);text-align:left"><img src="' + LOGO + '" alt="" style="width:44px;height:44px;border-radius:50%"><span><b style="display:block;font:800 15px ' + F + '">' + esc(t1) + '</b><span style="display:block;font:500 12px ' + F + ';color:#B9B6C6;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t2) + '</span></span>' + ic('up', 18, '#fff') + '</button>';
      bar.style.borderRadius = '999px'; bar.style.boxShadow = 'none'; bar.style.background = 'transparent'; return;
    }
    bar.style.borderRadius = '30px'; bar.style.boxShadow = '0 24px 60px rgba(30,20,70,.28),0 0 0 1px rgba(20,20,20,.04)'; bar.style.background = '#fff';
    var h = '';
    if (WHO === 'mgr' && AUTO) { bar.innerHTML = autoPanel(); return; }
    if (WHO === 'mgr') { bar.innerHTML = hero('Manager CUIMS', 'Live stock report', null) + wrap(statusCard('run', 'Separate manager login', 'Download the Item Stock Statement, then upload it in the app.') + row2(btn('app', 'Back to app', 'main')) + credit()); return; }
    if (!active(j)) {
      var body0 = j && j.phase === 'done' ? statusCard('ok', 'Saved ' + j.slip, 'Serial ' + (j.serial || '') + ' · ' + j.store) : statusCard('run', isLogin ? 'Please log in' : 'No entry running', isLogin ? 'The app fills your saved login and opens your page.' : 'Start one from the app.');
      bar.innerHTML = hero('JV Stock Issue', isLogin ? 'Log in to CUIMS' : 'Ready', null) + wrap(body0 + row2(btn('app', 'Back to app', 'main')) + credit()); return;
    }
    var k = cnt(j), cur = curItem(j);
    if (ui.confirmCancel) {
      bar.innerHTML = hero('Cancel entry?', j.store, j, C.ink) + wrap(statusCard('no', 'Cancel ' + j.slip + '?', 'Nothing has been submitted yet.') + '<div style="display:flex;flex-direction:column;gap:8px">' + btn('cancelReset', 'Cancel and clear the form', 'warn') + btn('cancelKeep', 'Cancel, keep the form', '') + btn('noCancel', 'Keep going', 'main') + '</div>'); return;
    }
    if (j.phase === 'await' && !ui.serialBox && formReset(j)) { j = Object.assign({}, j, { phase: 'capture' }); }
    var items = (j.items || []).map(function (x, i) { return { x: x, i: i }; });
    if (j.phase === 'await' && !ui.serialBox) {
      var v = verify(j), allOk = v.store && v.slip && v.rcv && v.type && v.rows === v.total;
      var nChecks = [v.store, v.slip, v.rcv, v.type, v.rows === v.total].filter(Boolean).length;
      h += hero((j.test ? 'Test mode · ' : '') + (j.adv ? 'Advance issue' : 'Issue entry'), j.store, j, allOk ? C.ok : C.noInk);
      var inner = statusCard(allOk ? 'ok' : 'no', allOk ? 'Ready to submit' : 'Check before SUBMIT', allOk ? 'All ' + nChecks + ' checks match the CUIMS form' : nChecks + ' of 5 checks match. See the red tiles.');
      inner += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + cell('Receiver', 'GA' + esc(j.rcv), j.rname || '', v.rcv) + cell('Requested on', esc(v.dates || '–'), '') + cell('Issue type', 'Offline', 'Department', v.type) + cell('Project area', esc(v.paText || j.store), v.store ? 'matches store' : 'expected ' + j.store, v.store) + '</div>';
      inner += secHead('Articles', v.rows + ' of ' + v.total + ' added') + itemRows(j, portal ? items : items.slice(0, 4));
      if (!portal && items.length > 4) inner += '<div style="font:600 12.5px ' + F + ';color:' + C.faint + ';text-align:center">+ ' + (items.length - 4) + ' more · turn on Big panel to see all</div>';
      if (allOk && j.autoSubmit && !j.adv && !ui.autoStop) {
        var secs = ui.autoAt ? Math.max(0, Math.ceil((ui.autoAt - Date.now()) / 1000)) : 4;
        inner += row2('<div style="flex:1;height:52px;border-radius:99px;background:' + C.ink + ';color:#fff;display:flex;align-items:center;justify-content:center;font:700 15.5px ' + F + '">Submitting in ' + secs + ' s</div>', btn('autoStop', 'Stop', 'warn'));
        if (!ui.autoAt) { ui.autoAt = Date.now() + 4000; clearInterval(autoTimer); autoTimer = setInterval(function () {
          var jj = job(); if (!jj || jj.phase !== 'await' || ui.autoStop || !jj.autoSubmit) { clearInterval(autoTimer); ui.autoAt = 0; paint(); return; }
          if (Date.now() >= ui.autoAt) { clearInterval(autoTimer); ui.autoAt = 0; var sb = $('ContentPlaceHolder1_btnsubmit') || document.querySelector('input[id$="btnsubmit"]'); if (sb) { toCapture(jj, 'Auto submit: SUBMIT tapped'); sb.click(); setTimeout(kick, 1500); } return; }
          paint(); }, 500); }
      } else {
        inner += row2('<div style="flex:1;height:52px;border-radius:99px;background:' + (allOk ? C.ink : '#E4E1EC') + ';color:' + (allOk ? '#fff' : C.mute) + ';display:flex;align-items:center;justify-content:center;font:700 15px ' + F + ';white-space:nowrap">' + (allOk ? 'Waiting for SUBMIT' : 'Fix, then SUBMIT') + '</div>', btn('serialAsk', 'Serial', 'gold') + btn('cancel', 'Cancel', 'link'));
      }
      inner += chips(j) + credit();
      bar.innerHTML = h + wrap(inner); return;
    }
    // working states
    var over = j.paused ? 'Paused' : j.phase === 'dup' ? 'Checking' : j.phase === 'capture' ? 'Finding Serial' : j.phase === 'dupfound' ? 'Already on CUIMS' : 'Filling';
    if (j.queue) over += ' · queue on';
    if (j.adv) over = 'Advance · ' + over;
    if (j.test) over = 'Test mode · ' + over;
    h += hero(over, j.store, j, j.paused ? '#FFB648' : C.ink);
    var inner2 = '';
    if (isLogin) inner2 += statusCard('warn', 'Logged out', 'Logging in again; the entry restarts by itself.');
    else if (j.paused) inner2 += statusCard('warn', 'Paused', j.pauseMsg === 'by you' ? 'Tap Resume to continue.' : (j.pauseMsg || ''));
    else if (j.phase === 'dupfound') inner2 += statusCard('no', j.slip + ' already exists', 'Serial ' + (j.dupSerial || '?') + ' on Show Transactions.');
    else if (j.phase === 'capture') inner2 += statusCard('run', 'Finding the Serial No', 'Show Transactions · ' + j.slip);
    else {
      inner2 += '<div style="background:' + C.ink + ';color:#fff;border-radius:20px;padding:14px;display:flex;align-items:center;gap:12px"><div style="width:42px;height:42px;border-radius:14px;background:' + C.lav + ';display:flex;align-items:center;justify-content:center;flex-shrink:0">' + ic(j.phase === 'dup' ? 'alert' : 'play', 20, C.ink) + '</div><div style="min-width:0"><b style="display:block;font:700 16px ' + F + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(cur && j.phase === 'fill' && (j.log || []).some(function (x) { return /Project Area/.test(x[0]); }) ? 'Adding ' + String(cur.name || cur.code).toLowerCase().replace(/\b\w/g, function (m) { return m.toUpperCase(); }) : j.phase === 'dup' ? 'Checking ' + j.slip : 'Setting up the form') + '</b><span style="font:500 12.5px ' + F + ';color:#C9C5D6">' + esc(cur ? cur.code + ' · ' + cur.qty + (cur.uom ? ' ' + cur.uom : '') : 'Store, receiver, department') + '</span></div></div>';
    }
    var segs = ''; for (var q = 0; q < k.total; q++) segs += '<i style="flex:1;height:6px;border-radius:99px;background:' + (q < k.done ? C.ink : q === k.done ? C.lav : '#E4E1EC') + '"></i>';
    if (k.total) inner2 += '<div style="display:flex;gap:5px">' + segs + '</div>';
    var ci = cur ? items.findIndex(function (o) { return o.x === cur || o.x.code === cur.code; }) : items.length;
    var show = portal ? items : items.slice(Math.max(0, ci - 1), Math.max(0, ci - 1) + 3);
    if (show.length) inner2 += itemRows(j, show);
    if (j.phase === 'dupfound') inner2 += row2(btn('dupDone', 'Mark as done', 'main'), btn('dupIgnore', 'Fill anyway', ''));
    else if (j.phase === 'await' && ui.serialBox) inner2 += row2('<input id="jvserial" inputmode="numeric" placeholder="Serial No" style="flex:1;min-width:0;height:52px;border:1.5px solid #E4E1EC;border-radius:99px;padding:0 18px;font:600 16px ' + F + '">', btn('serialSave', 'Save', 'main') + btn('serialNo', 'Back', 'link'));
    else if (!isLogin) {
      var pb = j.paused ? btn('resume', ic('play', 16, '#fff') + ' Resume', 'main') : btn('pause', ic('pause', 16, '#fff') + ' Pause', 'main');
      pb = pb.replace('display:inline-flex', 'flex:1;justify-content:center;display:inline-flex');
      inner2 += row2(pb, (j.paused && j.phase === 'fill' && cur && j.pauseMsg && j.pauseMsg !== 'by you' ? btn('skip', 'Skip', '') : '') + btn('cancel', 'Cancel', 'link'));
    }
    if (portal) { var L = (j.log || []).slice(-8).reverse(); if (L.length) inner2 += secHead('Activity', '') + '<div style="display:flex;flex-direction:column;gap:6px">' + L.map(function (x) { return '<div style="display:flex;gap:8px;align-items:flex-start;font:500 13px ' + F + ';color:#3A3746">' + ic(x[1] ? 'no' : 'ok', 14, x[1] ? C.noInk : C.ok) + '<span>' + esc(x[0]) + '</span></div>'; }).join('') + '</div>'; }
    if (!isLogin && j.phase !== 'dupfound') inner2 += chips(j);
    bar.innerHTML = h + wrap(inner2);
  }

  bar.addEventListener('click', function (e) {
    var t = e.target.closest('[data-jv]'); if (!t) return;
    var a = t.getAttribute('data-jv'); var j = job();
    if (a === 'app') { B.showApp(); return; }
    if (a === 'tQueue' || a === 'tAuto') { var k = a === 'tQueue' ? 'queue' : 'autoSubmit'; var jt = job(); if (jt && jt.adv) return; if (jt) { jt[k] = !jt[k]; save(jt); ev('setPref', { key: k, val: jt[k] }); if (k === 'autoSubmit') { ui.autoStop = false; ui.autoAt = 0; } } paint(); return; }
    if (a === 'asStop') { try { B.autoStop && B.autoStop(); } catch (er) {} AUTO = null; try { localStorage.removeItem('jvAS'); } catch (er) {} B.showApp(); return; }
    if (a === 'asRetry') { AS = { run: AUTO.run, step: 'start' }; asSave(); location.href = (B.targetUrl && B.targetUrl()) || location.href; return; }
    if (a === 'tPortal') { portal = !portal; try { localStorage.setItem('jvPortal', portal ? '1' : '0'); } catch (er) {} try { B.setCover && B.setCover(portal && !mini); } catch (er) {} paint(); return; }
    if (a === 'tFull') { immersive = !immersive; try { B.setFullscreen && B.setFullscreen(immersive); } catch (er) {} paint(); return; }
    if (a === 'autoStop') { ui.autoStop = true; ui.autoAt = 0; clearInterval(autoTimer); paint(); return; }
    if (a === 'hide') { mini = true; try { localStorage.setItem('jvBarMini', '1'); } catch (er) {} try { B.setCover && B.setCover(false); } catch (er) {} paint(); return; }
    if (a === 'expand') { mini = false; try { localStorage.setItem('jvBarMini', '0'); } catch (er) {} try { B.setCover && B.setCover(portal); } catch (er) {} paint(); return; }
    if (!j) return;
    if (a === 'pause') { j.paused = true; j.pauseMsg = 'by you'; save(j); ev('paused', { msg: 'by you' }); paint(); }
    else if (a === 'resume') { j.paused = false; j.pauseMsg = ''; j.tries = {}; save(j); B.clearAlert(); ev('resumed'); paint(); run(); }
    else if (a === 'skip') {
      var it = curItem(j); if (!it) return;
      j.items.forEach(function (x) { if (x.lineId === it.lineId) x.skip = true; }); save(j);
      try { if (typeof window.closeBatchPopup === 'function') closeBatchPopup(); } catch (er) {}
      log(j, 'Skipped ' + it.code + ' (stays pending)'); ev('skip', { lineId: it.lineId, code: it.code }); run();
    }
    else if (a === 'cancel') { ui.confirmCancel = true; if (!j.paused && j.phase !== 'await') { j.paused = true; j.pauseMsg = 'cancelling'; j.cancelPaused = true; save(j); } paint(); }
    else if (a === 'noCancel') { ui.confirmCancel = false; if (j.cancelPaused) { j.paused = false; j.pauseMsg = ''; j.cancelPaused = false; save(j); } paint(); run(); }
    else if (a === 'cancelReset' || a === 'cancelKeep') {
      ui.confirmCancel = false; j.phase = 'cancelled'; j.paused = false; save(j); ev('cancelled');
      paint();
      if (a === 'cancelReset' && $('ContentPlaceHolder1_btnreset')) $('ContentPlaceHolder1_btnreset').click();
    }
    else if (a === 'dupDone') { j.phase = 'done'; j.serial = j.dupSerial; save(j); ev('submitted', { serial: j.dupSerial, rname: j.rname || '', items: j.items, note: 'already on CUIMS' }); paint(); }
    else if (a === 'serialAsk') { ui.serialBox = true; paint(); var si = $('jvserial'); if (si) si.focus(); }
    else if (a === 'serialNo') { ui.serialBox = false; paint(); }
    else if (a === 'serialSave') {
      var v = (($('jvserial') || {}).value || '').replace(/\D/g, '');
      if (!v) return;
      ui.serialBox = false; j.phase = 'done'; j.serial = v; save(j); log(j, 'Serial ' + v + ' entered by you');
      ev('submitted', { serial: v, rname: j.rname || '', items: j.items, note: 'serial entered by hand' }); paint();
    }
    else if (a === 'dupIgnore') { j.phase = 'fill'; save(j); if ($('DivInsert')) $('DivInsert').click(); paint(); run(); }
  });

  /* ---------- helpers on the CUIMS page ---------- */
  function inGrid(code) {
    var spans = document.querySelectorAll('[id^="ContentPlaceHolder1_grdselecteditems_lblFinalCode_"]');
    for (var i = 0; i < spans.length; i++) if (spans[i].textContent.trim().toUpperCase() === String(code).toUpperCase()) return spans[i];
    return null;
  }
  function batchOpen() {
    var bp = $('divBatch'), q0 = $('ContentPlaceHolder1_gvBatch_txtQuantity_0');
    if (!bp || !q0) return false;
    if (bp.offsetWidth > 60) return true;
    var w = bp.style.width; return !!(w && w !== '0px' && w !== '0');
  }
  function gridRow(code) {
    var s = inGrid(code); if (!s) return null;
    var i = s.id.split('_').pop();
    var g = function (n) { var e = $('ContentPlaceHolder1_grdselecteditems_' + n + '_' + i); return e ? e.textContent.trim() : ''; };
    return { code: code, qty: parseFloat(g('lblQuantity')), stock: parseFloat(g('lblStock')), bal: parseFloat(g('lblBalance')), remark: g('lblItemRemarks'), name: g('lblDescription') };
  }
  function findSlip(slip) {
    var sec = $('divSearchSection'); if (!sec) return null;
    var re = new RegExp('Slip No\\s*:\\s*' + reEsc(slip) + '(?![\\w/-])', 'i');
    var rows = sec.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      if (!re.test(rows[i].textContent)) continue;
      var tds = rows[i].querySelectorAll('td');
      for (var k = 0; k < tds.length; k++) { var t = tds[k].textContent.trim(); if (/^\d{3,9}$/.test(t)) return { serial: t, text: rows[i].textContent.replace(/\s+/g, ' ').trim() }; }
      return { serial: '', text: rows[i].textContent.replace(/\s+/g, ' ').trim() };
    }
    return null;
  }
  async function searchSlip(j) {
    if ($('DivUpdate')) $('DivUpdate').click();
    var s = $('ContentPlaceHolder1_txtSlipOrRequisitionNoS'), bt = $('btnSearch');
    if (!s || !bt) pauseWith('Show Transactions search not found');
    var from = new Date(); from.setDate(from.getDate() - 45);
    if ($('ContentPlaceHolder1_txtFromDateS')) $('ContentPlaceHolder1_txtFromDateS').value = usDate(from);
    if ($('ContentPlaceHolder1_txtToDateS')) $('ContentPlaceHolder1_txtToDateS').value = usDate(new Date());
    s.value = j.slip;
    bt.click();
    await idle(600);
  }

  /* ---------- main steps ---------- */
  async function stepDup(j) {
    if (!j.dupSearched) { j.dupSearched = true; save(j); log(j, 'Checking ' + j.slip + ' on Show Transactions'); await searchSlip(j); return; }
    var hit = findSlip(j.slip);
    if (hit) { j.phase = 'dupfound'; j.dupSerial = hit.serial; save(j); log(j, j.slip + ' already on CUIMS, Serial ' + hit.serial, true); ev('duplicate', { serial: hit.serial }); return 'stop'; }
    j.phase = 'fill'; save(j); log(j, j.slip + ' is new, filling the form');
    if ($('DivInsert')) $('DivInsert').click();
  }

  async function act(j, k, label, fn) { guard(j, k); await fn(); await idle(); }

  async function stepFill(j) {
    var dt = live('ContentPlaceHolder1_ddldoctype'); if (!dt) pauseWith('Transaction Type box not ready');
    if (dt.value !== 'Issue') { await act(j, 'type', 'Transaction Type', function () { dt.value = 'Issue'; fire(dt, 'change'); }); log(job(), 'Transaction Type = Issue'); return; }
    var dep = $('ContentPlaceHolder1_rblIssue_1'); if (!dep) pauseWith('Department option not found');
    if (!dep.checked) { await act(j, 'dept', 'Issue To', function () { dep.click(); }); log(job(), 'Issue To = Department'); return; }
    var it = live('ddlIssueType'); if (!it) pauseWith('Issue Type box is disabled');
    if (it.value !== 'Offline') { await act(j, 'itype', 'Issue Type', function () { it.value = 'Offline'; fire(it, 'change'); }); log(job(), 'Issue Type = Offline'); return; }
    var sb = $('ContentPlaceHolder1_txtRequisitonSlipno') || document.querySelector('input[id*="RequisitonSlipno"]');
    if (!sb) { j.tries.slipbox = (j.tries.slipbox || 0) + 1; save(j); if (j.tries.slipbox > 20) pauseWith('Slip No box not found on CUIMS'); await sleep(700); return; }
    if (sb.value.trim() !== j.slip) { await act(j, 'slip', 'Slip No', function () { sb.value = j.slip; fire(sb, 'change'); }); log(job(), 'Slip No = ' + j.slip); return; }

    var rc = $('txtIssueTo'); if (!rc) pauseWith('Received By box not found');
    if (rc.value.indexOf(j.rcv) < 0) { await pickReceiver(j, rc); return; }

    var dp = live('ContentPlaceHolder1_ddldepartment'); if (!dp) pauseWith('Department box is disabled');
    if (dp.value !== '1366') { await act(j, 'dep', 'Department', function () { dp.value = '1366'; fire(dp, 'change'); }); log(job(), 'Department = HOSTEL MESS (GA)'); return; }
    var mt = live('ContentPlaceHolder1_ddlMaintenance');
    if (mt && mt.value !== 'N') { await act(j, 'mnt', 'Maintenance', function () { mt.value = 'N'; fire(mt, 'change'); }); log(job(), 'Maintenance = No'); return; }
    var pa = $('ContentPlaceHolder1_ddlProject');
    var op = pa && Array.prototype.find.call(pa.options, function (o) { return o.text.trim().toUpperCase() === String(j.store).trim().toUpperCase(); });
    if (!op) pauseWith('Project Area "' + j.store + '" is not in the CUIMS list');
    if (pa.value !== op.value) { await act(j, 'pa', 'Project Area', function () { pa.value = op.value; fire(pa, 'change'); }); log(job(), 'Project Area = ' + op.text.trim()); return; }

    var next = curItem(j);
    if (!next) return finishCheck(j);
    j = job(); j.ist = j.ist || {};
    var st = j.ist[next.code] || {};
    var age = Date.now() - (st.at || 0);
    function mark(stage) { var jj = job(); jj.ist = jj.ist || {}; jj.ist[next.code] = { s: stage, at: Date.now(), n: ((jj.ist[next.code] || {}).n || 0) + (stage === st.s ? 1 : 0) }; save(jj); }
    function tooMany() { var jj = job(); var x = (jj.ist || {})[next.code] || {}; if ((x.n || 0) >= 3) pauseWith(next.code + ': CUIMS did not accept this item after 3 tries. Check the page, then tap Resume or Skip.'); }

    // batch popup is open: fill first box once, then wait for the row
    if (batchOpen()) {
      if (st.s === 'batch' && age < 20000) { await sleep(600); return 'wait'; }
      tooMany();
      var fc = $('ContentPlaceHolder1_gvBatch_lblFinalCode_0');
      if (fc && fc.textContent.trim().toUpperCase() !== next.code.toUpperCase()) pauseWith('Batch popup shows ' + fc.textContent.trim() + ' instead of ' + next.code);
      var q0 = $('ContentPlaceHolder1_gvBatch_txtQuantity_0');
      q0.value = String(next.qty); fire(q0, 'change');
      if (typeof window.CalculateQty === 'function') { try { CalculateQty(); } catch (e) {} }
      mark('batch');
      $('ContentPlaceHolder1_btnAddToGrid').click();
      await idle(500);
      for (var w = 0; w < 40 && !gridRow(next.code); w++) await sleep(250);
      var r = gridRow(next.code);
      if (r) {
        if (r.bal < 0) pauseWith(next.code + ': balance below zero on CUIMS (stock ' + r.stock + '). Skip it or check stock.');
        log(job(), next.code + ' ' + (r.name || '') + ' × ' + next.qty + ' added' + (next.remark ? ', remark added' : ''));
        ev('progress', { code: next.code, stock: r.stock });
      }
      return;
    }
    // ADD was tapped: wait for the popup or the row
    if (st.s === 'add' && age < 15000) { await sleep(500); return 'wait'; }
    // batch Add was tapped and popup closed: give the row time to appear
    if (st.s === 'batch' && age < 20000) { await sleep(500); return 'wait'; }

    var cb = $('txtFinalCode'), nm = $('txtItem');
    if (!cb) pauseWith('Code box not found');
    var named = nm && nm.value.trim();
    if (cb.value.trim().toUpperCase() !== next.code.toUpperCase() || !named) {
      if (st.s === 'code' && age < 9000) { await sleep(500); return 'wait'; }
      tooMany();
      mark('code');
      cb.value = next.code; fire(cb, 'change');
      await idle(400);
      for (var t = 0; t < 30; t++) { if (batchOpen() || (($('txtItem') || {}).value || '').trim()) break; await sleep(250); }
      if (!batchOpen() && !(($('txtItem') || {}).value || '').trim() && (job().ist[next.code] || {}).n >= 2) pauseWith(next.code + ': CUIMS did not find this item code. Skip it or check the code.');
      return;
    }
    tooMany();
    $('txtquantity').value = String(next.qty);
    var rm = $('ContentPlaceHolder1_txtitemremarks'); if (rm) rm.value = next.remark || '';
    mark('add');
    $('ContentPlaceHolder1_btnadd').click();
    await idle(400);
    for (var u = 0; u < 40; u++) { if (batchOpen() || gridRow(next.code)) break; await sleep(250); }
  }

  async function pickReceiver(j, rc) {
    guard(j, 'rcv');
    var code = 'GA' + j.rcv, re = new RegExp('\\bGA' + j.rcv + '\\b', 'i');
    var key = function (el, type, ch) { var kc = ch ? ch.charCodeAt(0) : 0; el.dispatchEvent(new KeyboardEvent(type, { key: ch, keyCode: kc, which: kc, bubbles: true })); if (jq) { try { jq(el).trigger(jq.Event(type, { keyCode: kc, which: kc })); } catch (e) {} } };
    rc.focus(); rc.value = ''; fire(rc, 'input');
    for (var i = 0; i < j.rcv.length; i++) { var ch = j.rcv[i]; rc.value += ch; key(rc, 'keydown', ch); key(rc, 'keypress', ch); fire(rc, 'input'); key(rc, 'keyup', ch); await sleep(120); }
    if (jq) { try { jq(rc).autocomplete('search', rc.value); } catch (e) {} }
    var cands = function () {
      var out = [];
      document.querySelectorAll('li,a,div,span,td').forEach(function (el) {
        if (el === rc || el.offsetParent === null || bar.contains(el)) return;
        var t = (el.textContent || '').trim(); if (t.length > 160 || !re.test(t)) return;
        if (Array.prototype.some.call(el.children, function (c) { return re.test(c.textContent || '') && c.offsetParent !== null; })) return;
        out.push(el);
      });
      return out;
    };
    var list = [], t0 = Date.now();
    while (Date.now() - t0 < 8000) { list = cands(); if (list.length) break; await sleep(250); }
    if (!list.length) pauseWith('No receiver ' + code + ' in the CUIMS list. Pick it yourself in Received By, then tap Resume.');
    var best = list.find(function (el) { return /\(GA\)/i.test(el.textContent); }) || list[0];
    var label = best.textContent.trim();
    j = job(); j.rname = label.replace(re, '').replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, '').replace(/^[\s\-–:|,]+|[\s\-–:|,]+$/g, '').trim(); save(j);
    log(j, 'Receiver: ' + label);
    var tgt = best.closest('li') || best;
    [tgt, best].forEach(function (t) { ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach(function (e) { t.dispatchEvent(new MouseEvent(e, { bubbles: true, cancelable: true, view: window })); }); });
    if (jq) { try { jq(best).trigger('mouseenter').trigger('mousedown').trigger('click'); jq(tgt).trigger('mouseenter').trigger('click'); } catch (e) {} }
    await sleep(600);
    if (!re.test(rc.value) && jq) {
      var items = tgt.parentElement ? Array.prototype.slice.call(tgt.parentElement.children) : [];
      var idx = Math.max(0, items.indexOf(tgt));
      for (var k = 0; k <= idx; k++) { try { jq(rc).trigger(jq.Event('keydown', { keyCode: 40, which: 40 })); } catch (e) {} await sleep(120); }
      try { jq(rc).trigger(jq.Event('keydown', { keyCode: 13, which: 13 })); } catch (e) {}
      await sleep(600);
    }
    if (!re.test(rc.value)) rc.value = label;
    fire(rc, 'change');
    await idle();
  }

  function finishCheck(j) {
    var bad = [], rows = [];
    j.items.filter(function (x) { return !x.skip; }).forEach(function (x) {
      var r = gridRow(x.code);
      if (!r) bad.push(x.code + ' missing');
      else { rows.push(r); if (Math.abs(r.qty - parseFloat(x.qty)) > 0.0005) bad.push(x.code + ' qty ' + r.qty + ' (plan ' + x.qty + ')'); if (r.bal < 0) bad.push(x.code + ' balance ' + r.bal); }
    });
    if (bad.length) pauseWith('Preview check failed: ' + bad.join('; '));
    j = job(); j.phase = 'await'; j.rows = rows; save(j);
    log(j, 'Preview check passed, ' + rows.length + ' rows match');
    ev('filled', { rows: rows });
    hookSubmit();
    return 'stop';
  }

  function hookSubmit() {
    var s = $('ContentPlaceHolder1_btnsubmit');
    if (s && !s.__jv) { s.__jv = true; s.addEventListener('click', function () { var j = job(); if (j && j.phase === 'await') { j.phase = 'capture'; j.capSearched = false; j.capTries = 0; j.submitAt = Date.now(); save(j); paint(); setTimeout(kick, 1500); } }, true); }
    var r = $('ContentPlaceHolder1_btnreset');
    if (r && !r.__jv) { r.__jv = true; r.addEventListener('click', function () { var j = job(); if (active(j) && ['fill', 'await'].indexOf(j.phase) >= 0) { j.phase = 'fill'; j.paused = true; j.pauseMsg = 'form was reset. Tap Resume to fill again.'; j.tries = {}; save(j); } }, true); }
  }

  function pageSerial() {
    var m = (($('ContentPlaceHolder1_lblmsg') || {}).textContent || '');
    var x = m.match(/(?:serial|issue)\D{0,20}(\d{4,8})/i);
    return x ? x[1] : '';
  }
  async function stepCapture(j) {
    var ps = pageSerial(); if (ps && !j.alertSerial) { j.alertSerial = ps; save(j); }
    if (!j.capSearched) { j.capSearched = true; j.capAt = Date.now(); save(j); log(j, 'Looking for ' + j.slip + ' in Show Transactions'); await searchSlip(j); return; }
    var hit = findSlip(j.slip);
    if (hit && hit.serial) {
      j.phase = 'done'; j.serial = hit.serial; save(j); log(j, 'Submitted. Serial ' + hit.serial);
      ev('submitted', { serial: hit.serial, rname: j.rname || '', items: j.items });
      return 'stop';
    }
    if (Date.now() - (j.capAt || 0) < 10000) { await sleep(700); return 'wait'; }
    j.capTries = (j.capTries || 0) + 1;
    if (j.capTries < 4) { j.capSearched = false; save(j); await sleep(2000); return; }
    if (j.alertSerial) { j.phase = 'done'; j.serial = j.alertSerial; save(j); log(j, 'Serial ' + j.alertSerial + ' taken from the CUIMS message'); ev('submitted', { serial: j.alertSerial, rname: j.rname || '', items: j.items, note: 'serial from CUIMS message' }); return 'stop'; }
    j.phase = 'await'; j.paused = false; save(j);
    ui.serialBox = true;
    log(j, j.slip + ' not found yet in Show Transactions. If you submitted, type the Serial No below.', true);
    ev('notfound');
    hookSubmit();
    return 'stop';
  }

  function formReset(j) {
    var sb = $('ContentPlaceHolder1_txtRequisitonSlipno') || document.querySelector('input[id*="RequisitonSlipno"]');
    var anyRow = (j.items || []).some(function (x) { return !x.skip && gridRow(x.code); });
    return isIssue && !anyRow && (!sb || sb.value.trim() !== j.slip);
  }
  function toCapture(j, why) { j.phase = 'capture'; j.capSearched = false; j.capTries = 0; j.submitAt = j.submitAt || Date.now(); ui.serialBox = false; save(j); log(j, why); paint(); }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('#ContentPlaceHolder1_btnsubmit,input[id$="btnsubmit"]') : null;
    if (!t) return; var j = job(); if (j && j.phase === 'await') { toCapture(j, 'SUBMIT tapped, finding the Serial No'); setTimeout(kick, 1500); }
  }, true);
  (function () {
    var nat = window.alert;
    window.alert = function (m) {
      var j = job();
      if (j && (j.phase === 'capture' || j.phase === 'await')) { try { B.clearAlert && B.clearAlert(); } catch (e) {} window.__jvLastAlert = String(m || ''); if (window.JVFill && window.JVFill.onAlertMsg) window.JVFill.onAlertMsg(String(m || '')); return; }
      return nat.apply(window, arguments);
    };
  })();
  function kick() {
    var j0 = job();
    if (!running && active(j0) && !j0.paused && j0.phase === 'await' && !ui.serialBox && formReset(j0)) toCapture(j0, 'Form cleared after SUBMIT, finding the Serial No'); var j = job(); if (!running && active(j) && !j.paused && isIssue && ['dup', 'fill', 'capture'].indexOf(j.phase) >= 0) run(); }
  setInterval(kick, 3000);
  async function run() {
    var ja = job();
    if (active(ja) && ja.phase === 'await' && !ja.paused && !ui.serialBox && formReset(ja)) toCapture(ja, 'Form cleared after SUBMIT, finding the Serial No');
    if (running) return; running = true;
    try {
      for (var k = 0; k < 700; k++) {
        var j = job();
        if (!active(j) || j.paused || isLogin) break;
        if (!isIssue) break;
        if (j.phase === 'await' || j.phase === 'dupfound') { hookSubmit(); break; }
        var r;
        if (j.phase === 'dup') r = await stepDup(j);
        else if (j.phase === 'fill') r = await stepFill(j);
        else if (j.phase === 'capture') r = await stepCapture(j);
        else break;
        if (r !== 'wait') paint();
        if (r === 'stop') break;
      }
    } catch (e) {
      if (!(e instanceof Pause)) { try { var jj = job(); jj.paused = true; jj.pauseMsg = 'unexpected error: ' + e.message; save(jj); ev('paused', { msg: jj.pauseMsg }); } catch (x) {} }
    }
    running = false; paint();
  }

  J.cmd = function (c) {
    var j = job(); if (!j) return;
    if (c === 'pause' && active(j)) { j.paused = true; j.pauseMsg = 'by you'; save(j); paint(); }
    else if (c === 'resume' && active(j)) { j.paused = false; j.pauseMsg = ''; j.tries = {}; save(j); paint(); run(); }
    else if (c === 'cancel' && active(j)) { ui.confirmCancel = false; j.phase = 'cancelled'; j.paused = false; save(j); ev('cancelled'); paint(); }
  };
  J.onAlertMsg = function (msg) { J.onAlertClosed(msg); };
  J.onAlertClosed = function (given) {
    var msg = given != null ? given : (B.lastAlert() || ''); var j = job();
    if (!active(j)) return;
    var m = msg.match(/\b(\d{4,8})\b/);
    if (j.phase === 'capture' || j.phase === 'await') { if (m) { j.alertSerial = m[1]; save(j); } log(j, 'CUIMS: ' + msg); setTimeout(kick, 800); return; }
    if (j.phase === 'fill' && !j.paused) { j.paused = true; j.pauseMsg = 'CUIMS message: ' + msg; save(j); log(j, 'CUIMS: ' + msg, true); ev('paused', { msg: j.pauseMsg }); paint(); }
  };

  /* ---------- start ---------- */
  (function autoLogin() {
    if (isIssue || !B.getCred) return;
    var c = {}; try { c = JSON.parse(B.getCred() || '{}'); } catch (e) {}
    if (!c.u || !c.p) return;
    var tries = 0;
    var setV = function (el, v) { try { var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); el.focus(); d.set.call(el, v); } catch (e) { el.value = v; } ['input', 'change', 'keyup', 'blur'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); }); };
    var vis = function (x) { return x && x.offsetParent !== null && !x.disabled; };
    var clickable = function (root, re) { return [].slice.call(root.querySelectorAll('input[type="submit"],input[type="button"],button,a')).filter(function (x) { return vis(x) && re.test((x.value || '') + ' ' + x.textContent + ' ' + x.id + ' ' + (x.name || '')); })[0]; };
    (function attempt() {
      tries++;
      var pw = [].slice.call(document.querySelectorAll('input[type="password"]')).filter(vis)[0];
      var texts = [].slice.call(document.querySelectorAll('input')).filter(function (x) { return vis(x) && /^(text|email|tel|number|)$/i.test(x.type || 'text') && !/captcha|search/i.test(x.id + x.name + (x.placeholder || '')); });
      if (!pw) {
        // two-step login: User ID first, then NEXT
        var u1 = texts.filter(function (x) { return /user|emp|login|id|uid/i.test(x.id + x.name + (x.placeholder || '')); })[0] || (texts.length === 1 ? texts[0] : null);
        var nx = u1 && clickable(document, /next|continue|proceed/i);
        var stepKey = 'jvLoginStep1:' + location.pathname;
        if (u1 && nx && !sessionStorage.getItem(stepKey)) {
          setV(u1, c.u);
          try { sessionStorage.setItem(stepKey, String(Date.now())); } catch (e) {}
          setTimeout(function () { nx.click(); }, 500);
          setTimeout(attempt, 1500); return;
        }
        if (tries < 60) setTimeout(attempt, 250);
        return;
      }
      var before = texts.filter(function (x) { return x.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING; });
      var user = before.pop() || null;
      if (user && !user.value) setV(user, c.u);
      setV(pw, c.p);
      var cap = [].slice.call(document.querySelectorAll('input')).filter(function (x) { return vis(x) && x !== user && x !== pw && /^(text|number|tel|)$/i.test(x.type || 'text') && !x.value; });
      var n = 0; try { var k = JSON.parse(sessionStorage.getItem('jvLoginTry') || '{"n":0,"t":0}'); n = Date.now() - k.t < 120000 ? k.n : 0; } catch (e) {}
      if (c.auto && !cap.length && n < 2) {
        var root = pw.form || document;
        var btn = root.querySelector('input[type="submit"],button[type="submit"]') || clickable(root, /log\s*in|sign\s*in|submit|ogin/i);
        if (btn) { try { sessionStorage.setItem('jvLoginTry', JSON.stringify({ n: n + 1, t: Date.now() })); } catch (e) {} setTimeout(function () { btn.click(); }, 600); }
      }
    })();
  })();
  var target = '';
  try { target = B.targetUrl ? B.targetUrl() : ISSUE_URL; } catch (e) { target = ISSUE_URL; }
  var onTarget = target && location.href.split('?')[0].toLowerCase() === target.split('?')[0].toLowerCase();
  try {
    if (isLogin) { localStorage.setItem('jvSawLogin_' + WHO, '1'); if (WHO === 'emp') ev('loggedout'); }
    else if (localStorage.getItem('jvSawLogin_' + WHO) === '1') {
      localStorage.removeItem('jvSawLogin_' + WHO);
      if (WHO === 'emp') ev('login');
      try { B.markLogin && B.markLogin(); } catch (e) {}
      if (!onTarget && /cuchd\.in/.test(location.host)) { setTimeout(function () { location.href = target; }, 300); }
    }
  } catch (e) {}
  if (WHO === 'mgr') { if (AUTO) { mini = false; try { B.setCover && B.setCover(true); } catch (e) {} setInterval(asStep, 900); asStep(); } paint(); return; }
  if (isIssue) {
    var pa = $('ContentPlaceHolder1_ddlProject');
    if (pa) { var areas = Array.prototype.map.call(pa.options, function (o) { return o.text.trim(); }).filter(function (t) { return t && t !== 'Select'; }); ev('areas', { areas: areas }); }
  }
  paint();
  var j0 = job();
  if (active(j0) && !isLogin && !isIssue && /cuchd\.in/.test(location.host)) {
    setTimeout(function () { location.href = target || ISSUE_URL; }, 900);
  } else if (isIssue) {
    if (active(j0) && j0.phase === 'await') hookSubmit();
    run();
  }
};
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __go); else __go();
})();
