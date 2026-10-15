/* JV Stock Issue – CUIMS fill engine. Injected by the app on every CUIMS page load. */
(function () {
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
  var isLogin = !isIssue && !!document.querySelector('input[type="password"]');

  /* ---------- control bar ---------- */
  var bar = document.createElement('div');
  bar.id = 'jvbar';
  bar.style.cssText = 'position:absolute;left:-9999px;top:0;transition:none;will-change:transform;z-index:2147483647;background:#FBFAF6;color:#14161A;border-radius:22px;padding:0;font:16px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(15,23,42,.35),0 0 0 1px rgba(201,162,75,.45);max-height:62vh;overflow:auto;transform-origin:0 0;box-sizing:border-box';
  document.body.appendChild(bar);
  var mini = false; try { mini = localStorage.getItem('jvBarMini') === '1'; } catch (e) {}
  function place() {
    var vv = window.visualViewport;
    var sc = vv ? vv.scale : 1, vw = vv ? vv.width : window.innerWidth, vh = vv ? vv.height : window.innerHeight;
    var pl = vv ? vv.pageLeft : window.scrollX, pt = vv ? vv.pageTop : window.scrollY;
    var inv = 1 / sc, gap = 8;
    var w = mini ? 0 : Math.round(vw * sc - gap * 2);
    var W = mini ? 'auto' : w + 'px', T = 'scale(' + inv + ')';
    if (bar.style.width !== W) bar.style.width = W;
    if (bar.style.transform !== T) bar.style.transform = T;
    var h = bar.offsetHeight, bw = bar.offsetWidth;
    var L = Math.round((mini ? pl + vw - (bw + gap) * inv : pl + gap * inv) * 10) / 10 + 'px', Tp = Math.round((pt + vh - (h + gap) * inv) * 10) / 10 + 'px';
    if (bar.style.left !== L) bar.style.left = L;
    if (bar.style.top !== Tp) bar.style.top = Tp;
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  window.addEventListener('scroll', place); window.addEventListener('resize', place);
  setInterval(place, 800);
  var BTN = 'min-height:46px;padding:0 16px;border-radius:999px;font:600 15px system-ui,sans-serif;cursor:pointer;';
  var WHO = (B.who && B.who()) || 'emp';
  function btn(id, label, kind) {
    var st = kind === 'main' ? 'background:linear-gradient(160deg,#1B2540,#0B1220);color:#F1E2B4;border:1px solid rgba(212,175,55,.45);box-shadow:0 4px 12px rgba(7,12,26,.3);' : kind === 'gold' ? 'background:linear-gradient(160deg,#E6C873,#C49A3A);color:#1A1203;border:0;box-shadow:0 4px 12px rgba(196,154,58,.35);' : kind === 'warn' ? 'background:#fff;color:#9B1C2E;border:1.5px solid #EBC3CA;' : kind === 'link' ? 'background:none;color:#8E1B2A;border:0;padding:0 8px;' : kind === 'ghost' ? 'background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.25);min-height:38px;padding:0 12px;font-size:13.5px;' : 'background:#fff;color:#0D1528;border:1.5px solid #E2D9C3;';
    return '<button type="button" data-jv="' + id + '" style="' + BTN + st + 'display:inline-flex;align-items:center;gap:8px">' + label + '</button>';
  }
  function curItem(j) {
    if (!j || !j.items) return null;
    for (var i = 0; i < j.items.length; i++) { var it = j.items[i]; if (!it.skip && !inGrid(it.code)) return it; }
    return null;
  }
  var lastHtml = '';
  function paint() { var before = bar.innerHTML; paintInner(); var now = bar.innerHTML; if (now !== lastHtml) { lastHtml = now; place(); } else if (before !== now) place(); }
  var LOGO = 'data:image/png;base64,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';
  var ME = (function () { try { var d = JSON.parse(B.storeGet() || '{}'); return d.me || {}; } catch (e) { return {}; } })();
  var IC = {
    pause: '<path d="M7 5v14M17 5v14"/>', play: '<path d="M7 4l13 8-13 8z"/>', down: '<path d="M6 9l6 6 6-6"/>', up: '<path d="M6 15l6-6 6 6"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', no: '<path d="M6 6l12 12M18 6L6 18"/>', back: '<path d="M15 5l-7 7 7 7"/>', alert: '<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>'
  };
  function ic(n, sz, col) { return '<svg viewBox="0 0 24 24" width="' + (sz || 18) + '" height="' + (sz || 18) + '" fill="none" stroke="' + (col || 'currentColor') + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-3px">' + IC[n] + '</svg>'; }
  function head(title, sub) {
    var who = ME.builder || ME.name || '';
    var photo = ME.photo ? '<img src="' + ME.photo + '" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid #D4AF37;box-shadow:0 0 0 3px rgba(212,175,55,.18);flex-shrink:0">' : '';
    return '<div style="background:linear-gradient(160deg,#1B2540 0%,#0D1528 55%,#070C1A 100%);color:#fff;padding:12px 12px 12px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(212,175,55,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)">' +
      '<img src="' + LOGO + '" alt="JV Stock Issue" style="width:42px;height:42px;border-radius:12px;flex-shrink:0">' +
      '<span style="flex:1;min-width:0"><span style="display:block;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:#E3C878;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(title) + '</span><b style="display:block;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + sub + '</b>' + (who ? '<span style="display:block;font-size:11.5px;color:#AEB4BE">Built by ' + esc(who) + '</span>' : '') + '</span>' +
      photo + '<button type="button" data-jv="hide" aria-label="Hide panel" style="width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0">' + ic('down', 20) + '</button></div>';
  }
  function sw(id, label, on) {
    return '<button type="button" data-jv="' + id + '" style="display:inline-flex;align-items:center;gap:8px;border:0;background:none;padding:4px 0;font:600 13.5px system-ui;color:#3A3E45;cursor:pointer"><span style="width:38px;height:22px;border-radius:99px;background:' + (on ? 'linear-gradient(160deg,#E6C873,#C49A3A)' : '#D9D5CC') + ';position:relative;flex-shrink:0;transition:background .2s"><span style="position:absolute;top:2px;left:' + (on ? 18 : 2) + 'px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .2s"></span></span>' + label + '</button>';
  }
  function toggles(j) { return '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid #EFEDE8">' + sw('tQueue', 'Queue mode', !!j.queue) + sw('tAuto', 'Auto submit', !!j.autoSubmit) + '</div>'; }
  var autoTimer = null;
  function row(label, value, ok) {
    var mark = ok === undefined ? '' : ok ? ic('ok', 18, '#0E7A4F') : ic('no', 18, '#B42335');
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #EFEDE8"><span style="width:118px;color:#6B6F76;font-size:13.5px;flex-shrink:0">' + label + '</span><b style="flex:1;font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis">' + value + '</b>' + mark + '</div>';
  }
  function verify(j) {
    var items = (j.items || []).filter(function (x) { return !x.skip; });
    var sb = $('ContentPlaceHolder1_txtRequisitonSlipno') || document.querySelector('input[id*="RequisitonSlipno"]');
    var rc = $('txtIssueTo'), pa = $('ContentPlaceHolder1_ddlProject'), it = $('ddlIssueType');
    var paText = pa && pa.selectedIndex >= 0 ? pa.options[pa.selectedIndex].text.trim() : '';
    var rows = items.filter(function (x) { return gridRow(x.code); }).length;
    var dates = {}; items.forEach(function (x) { if (x.reqDate) dates[x.reqDate] = 1; });
    var reqs = {}; items.forEach(function (x) { if (x.req) reqs[x.req] = 1; });
    return [
      ['Store', esc(j.store), paText.toUpperCase() === String(j.store).toUpperCase()],
      ['Request', esc(Object.keys(reqs).join(', ') || '–')],
      ['Requested on', esc(Object.keys(dates).map(function (d) { var p = d.split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : d; }).join(', ') || '–')],
      ['Slip No', esc(j.slip), !!sb && sb.value.trim() === j.slip],
      ['Receiver', 'GA' + esc(j.rcv) + (j.rname ? ' <span style="font-weight:500;color:#3A3E45">' + esc(j.rname) + '</span>' : ''), !!rc && rc.value.indexOf(j.rcv) >= 0],
      ['Issue type', 'Offline', !!it && it.value === 'Offline'],
      ['Articles', rows + ' of ' + items.length + ' added', rows === items.length]
    ];
  }
  function paintInner() {
    var j = job();
    var h = '';
    if (mini) {
      var tt = j && j.items ? j.items.filter(function (x) { return !x.skip; }).length : 0;
      var dd = j && j.items ? j.items.filter(function (x) { return !x.skip && inGrid(x.code); }).length : 0;
      var lab = WHO === 'mgr' ? 'Manager' : !active(j) ? 'Ready' : dd + ' / ' + tt;
      bar.innerHTML = '<button type="button" data-jv="expand" aria-label="Show panel" style="min-height:48px;padding:0 14px 0 6px;border-radius:999px;background:linear-gradient(160deg,#1B2540,#0B1220);color:#F1E2B4;border:1.5px solid #D4AF37;display:flex;align-items:center;gap:10px;font:700 15px system-ui;cursor:pointer"><img src="' + LOGO + '" alt="" style="width:34px;height:34px;border-radius:10px">' + (active(j) && j.paused ? ic('pause', 16, '#E8C97A') : '') + esc(lab) + ic('up', 18) + '</button>';
      bar.style.borderRadius = '999px'; bar.style.boxShadow = '0 8px 24px rgba(15,23,42,.35)'; return;
    }
    bar.style.borderRadius = '22px'; bar.style.boxShadow = '0 18px 50px rgba(7,12,26,.45),0 0 0 1px rgba(212,175,55,.55)';
    var body = 'padding:14px 16px 16px';
    if (WHO === 'mgr') {
      bar.innerHTML = head('Manager CUIMS', 'Live stock report') + '<div style="' + body + '"><div style="font-size:14px;color:#6B6F76">Separate login for the manager ID. Download the Item Stock Statement, then upload it in the app.</div><div style="display:flex;gap:8px;margin-top:12px">' + btn('app', ic('back', 16) + ' Back to app', 'main') + '</div></div>';
      return;
    }
    if (!active(j)) {
      var last = j && j.phase === 'done' ? '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:#E3F4EC;color:#0B5E3D;font-weight:700">' + ic('ok', 20, '#0E7A4F') + 'Saved ' + esc(j.slip) + ' · Serial ' + esc(j.serial || '') + '</div>' : '';
      bar.innerHTML = head('JV Stock Issue', isLogin ? 'Please log in' : 'Ready') + '<div style="' + body + '">' + (last || '<div style="font-size:14.5px;color:#6B6F76">' + (isLogin ? 'Log in once. Your working page opens by itself.' : 'No entry running. Start one from the app.') + '</div>') + '<div style="display:flex;gap:8px;margin-top:12px">' + btn('app', ic('back', 16) + ' Back to app', 'main') + '</div></div>';
      return;
    }
    var total = (j.items || []).filter(function (x) { return !x.skip; }).length;
    var done = (j.items || []).filter(function (x) { return !x.skip && inGrid(x.code); }).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    h += head(j.store, 'Slip ' + esc(j.slip) + '<span style="color:#E8C97A;font-weight:600"> · ' + done + ' of ' + total + '</span>');
    h += '<div style="' + body + '">';
    if (ui.confirmCancel) {
      h += '<div style="padding:12px 14px;border-radius:14px;background:#FBF3F4;border:1px solid #F1D3D8;color:#7E1A28;font-weight:700;font-size:15.5px">Cancel entry ' + esc(j.slip) + '?</div>' +
        '<div style="font-size:13.5px;color:#6B6F76;margin-top:8px">Nothing has been submitted. You can clear the CUIMS form or keep it as it is.</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px">' + btn('cancelReset', 'Cancel and clear form', 'warn') + btn('cancelKeep', 'Cancel, keep form', '') + btn('noCancel', 'Keep going', 'main') + '</div></div>';
      bar.innerHTML = h; return;
    }
    if (j.phase === 'await' && !ui.serialBox && formReset(j)) { j = Object.assign({}, j, { phase: 'capture' }); }
    if (j.phase === 'await' && !ui.serialBox) {
      var V = verify(j), allOk = V.every(function (r) { return r[2] !== false; });
      h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:' + (allOk ? '#E3F4EC' : '#FBE6E9') + ';color:' + (allOk ? '#0B5E3D' : '#8E1B2A') + ';font-weight:700;font-size:15.5px">' + ic(allOk ? 'ok' : 'alert', 20) + (allOk ? 'Rechecked. Everything matches. Tap SUBMIT.' : 'Something does not match. Check before SUBMIT.') + '</div>';
      h += '<div style="margin-top:6px">' + V.map(function (r) { return row(r[0], r[1], r[2]); }).join('') + '</div>';
      if (allOk && j.autoSubmit && !ui.autoStop) {
        var secs = ui.autoAt ? Math.max(0, Math.ceil((ui.autoAt - Date.now()) / 1000)) : 4;
        h += '<div style="display:flex;gap:10px;margin-top:14px;align-items:center"><div style="flex:1;font-weight:700;color:#0D1528">Submitting in ' + secs + ' s</div>' + btn('autoStop', 'Stop', 'warn') + '</div>';
        if (!ui.autoAt) { ui.autoAt = Date.now() + 4000; clearInterval(autoTimer); autoTimer = setInterval(function () {
          var jj = job(); if (!jj || jj.phase !== 'await' || ui.autoStop || !jj.autoSubmit) { clearInterval(autoTimer); ui.autoAt = 0; paint(); return; }
          if (Date.now() >= ui.autoAt) { clearInterval(autoTimer); ui.autoAt = 0; var sb = $('ContentPlaceHolder1_btnsubmit') || document.querySelector('input[id$="btnsubmit"]'); if (sb) { toCapture(jj, 'Auto submit: SUBMIT tapped'); sb.click(); setTimeout(kick, 1500); } return; }
          paint(); }, 500); }
      } else {
        h += '<div style="display:flex;gap:10px;margin-top:14px;align-items:center">' + btn('serialAsk', 'Enter Serial', 'gold') + btn('cancel', 'Cancel', 'link') + '</div>';
      }
      h += toggles(j) + '</div>'; bar.innerHTML = h; return;
    }
    var status = '', tone = '#14161A', bg = '#F6F5F2', icon = '';
    if (isLogin) { status = 'Logged out. Log in; the entry restarts by itself.'; tone = '#8A5A00'; bg = '#FCF1DA'; icon = 'alert'; }
    else if (j.paused) { status = j.pauseMsg === 'by you' ? 'Paused' : (j.pauseMsg || 'Paused'); tone = '#8A5A00'; bg = '#FCF1DA'; icon = 'pause'; }
    else if (j.phase === 'dup') status = 'Checking Show Transactions for ' + j.slip;
    else if (j.phase === 'dupfound') { status = j.slip + ' already exists on CUIMS (Serial ' + (j.dupSerial || '?') + ').'; tone = '#8E1B2A'; bg = '#FBE6E9'; icon = 'alert'; }
    else if (j.phase === 'fill') status = 'Filling the form';
    else if (j.phase === 'capture') status = 'Finding the Serial No for ' + j.slip;
    h += '<div style="height:6px;border-radius:99px;background:#EFEDE8;overflow:hidden"><div style="height:6px;width:' + pct + '%;background:linear-gradient(90deg,#C49A3A,#E6C873,#F3E2AE);border-radius:99px"></div></div>';
    h += '<div style="margin-top:12px;display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:12px;background:' + bg + ';color:' + tone + ';font-weight:650;font-size:15px">' + (icon ? ic(icon, 20) : '') + '<span>' + esc(status) + '</span></div>';
    var L = (j.log || []).slice(-2);
    if (L.length && !j.paused) h += '<div style="font-size:13px;color:#6B6F76;margin-top:10px;line-height:1.6">' + L.map(function (x) { return ic(x[1] ? 'no' : 'ok', 14, x[1] ? '#B42335' : '#0E7A4F') + ' ' + esc(x[0]); }).join('<br>') + '</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center">';
    if (ui.confirmCancel) {
      h += '<span style="width:100%;font-size:14.5px;font-weight:650">Cancel this entry?</span>' + btn('cancelReset', 'Cancel and clear form', 'warn') + btn('cancelKeep', 'Cancel, keep form', '') + btn('noCancel', 'Keep going', 'main');
    } else if (j.phase === 'dupfound') {
      h += btn('dupDone', 'Mark as done', 'main') + btn('dupIgnore', 'Fill anyway', '');
    } else if (j.phase === 'await' && ui.serialBox) {
      h += '<input id="jvserial" inputmode="numeric" placeholder="Serial No from CUIMS" style="flex:1;min-width:150px;min-height:48px;border:1.5px solid #D9D5CC;border-radius:999px;padding:0 16px;font:16px system-ui">' + btn('serialSave', 'Save', 'gold') + btn('serialNo', 'Back', 'link');
    } else if (!isLogin) {
      h += (j.paused ? btn('resume', ic('play', 16) + ' Resume', 'main') : btn('pause', ic('pause', 16) + ' Pause', 'main'));
      if (j.paused && j.phase === 'fill' && curItem(j) && j.pauseMsg && j.pauseMsg !== 'by you') h += btn('skip', 'Skip ' + esc(curItem(j).code), '');
      h += btn('cancel', 'Cancel', 'link');
    }
    h += '</div>' + (!ui.confirmCancel && !isLogin && j.phase !== 'dupfound' ? toggles(j) : '') + '</div>';
    bar.innerHTML = h;
  }
  bar.addEventListener('click', function (e) {
    var t = e.target.closest('[data-jv]'); if (!t) return;
    var a = t.getAttribute('data-jv'); var j = job();
    if (a === 'app') { B.showApp(); return; }
    if (a === 'tQueue' || a === 'tAuto') { var k = a === 'tQueue' ? 'queue' : 'autoSubmit'; var jt = job(); if (jt) { jt[k] = !jt[k]; save(jt); ev('setPref', { key: k, val: jt[k] }); if (k === 'autoSubmit') { ui.autoStop = false; ui.autoAt = 0; } } paint(); return; }
    if (a === 'autoStop') { ui.autoStop = true; ui.autoAt = 0; clearInterval(autoTimer); paint(); return; }
    if (a === 'hide') { mini = true; try { localStorage.setItem('jvBarMini', '1'); } catch (er) {} paint(); return; }
    if (a === 'expand') { mini = false; try { localStorage.setItem('jvBarMini', '0'); } catch (er) {} paint(); return; }
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
    if (!sb) pauseWith('Slip No box not found');
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

  J.onAlertClosed = function () {
    var msg = B.lastAlert() || ''; var j = job();
    if (!active(j)) return;
    var m = msg.match(/\b(\d{4,8})\b/);
    if (j.phase === 'capture' || j.phase === 'await') { if (m) { j.alertSerial = m[1]; save(j); } log(j, 'CUIMS: ' + msg); setTimeout(kick, 800); return; }
    if (j.phase === 'fill' && !j.paused) { j.paused = true; j.pauseMsg = 'CUIMS message: ' + msg; save(j); log(j, 'CUIMS: ' + msg, true); ev('paused', { msg: j.pauseMsg }); paint(); }
  };

  /* ---------- start ---------- */
  var target = '';
  try { target = B.targetUrl ? B.targetUrl() : ISSUE_URL; } catch (e) { target = ISSUE_URL; }
  var onTarget = target && location.href.split('?')[0].toLowerCase() === target.split('?')[0].toLowerCase();
  try {
    if (isLogin) { localStorage.setItem('jvSawLogin_' + WHO, '1'); if (WHO === 'emp') ev('loggedout'); }
    else if (localStorage.getItem('jvSawLogin_' + WHO) === '1') {
      localStorage.removeItem('jvSawLogin_' + WHO);
      if (WHO === 'emp') ev('login');
      if (!onTarget && /cuchd\.in/.test(location.host)) { setTimeout(function () { location.href = target; }, 300); }
    }
  } catch (e) {}
  if (WHO === 'mgr') { paint(); return; }
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
})();
