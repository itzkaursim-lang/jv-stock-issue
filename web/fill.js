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
  bar.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;background:#fff;color:#1C1917;border:2px solid #1C1917;border-radius:16px;padding:12px 14px;font:16px/1.45 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);max-height:60vh;overflow:auto;transform-origin:0 0;box-sizing:border-box';
  document.body.appendChild(bar);
  var mini = false; try { mini = localStorage.getItem('jvBarMini') === '1'; } catch (e) {}
  function place() {
    var vv = window.visualViewport;
    var sc = vv ? vv.scale : 1, vw = vv ? vv.width : window.innerWidth, vh = vv ? vv.height : window.innerHeight;
    var pl = vv ? vv.pageLeft : window.scrollX, pt = vv ? vv.pageTop : window.scrollY;
    var inv = 1 / sc, gap = 8;
    var w = mini ? 0 : Math.round(vw * sc - gap * 2);
    bar.style.width = mini ? 'auto' : w + 'px';
    bar.style.transform = 'scale(' + inv + ')';
    var h = bar.offsetHeight, bw = bar.offsetWidth;
    bar.style.left = (mini ? pl + vw - (bw + gap) * inv : pl + gap * inv) + 'px';
    bar.style.top = (pt + vh - (h + gap) * inv) + 'px';
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
  window.addEventListener('scroll', place); window.addEventListener('resize', place);
  setInterval(place, 800);
  var BTN = 'min-height:46px;padding:0 14px;border-radius:12px;font:600 15px system-ui,sans-serif;cursor:pointer;';
  function btn(id, label, kind) {
    var st = kind === 'main' ? 'background:#1C1917;color:#fff;border:0;' : kind === 'warn' ? 'background:#fff;color:#B91C1C;border:1.5px solid #B91C1C;' : 'background:#fff;color:#1C1917;border:1.5px solid #A8A29E;';
    return '<button type="button" data-jv="' + id + '" style="' + BTN + st + '">' + label + '</button>';
  }
  function curItem(j) {
    if (!j || !j.items) return null;
    for (var i = 0; i < j.items.length; i++) { var it = j.items[i]; if (!it.skip && !inGrid(it.code)) return it; }
    return null;
  }
  function paint() { paintInner(); place(); }
  function paintInner() {
    var j = job();
    var h = '';
    if (mini) {
      var tt = j && j.items ? j.items.filter(function (x) { return !x.skip; }).length : 0;
      var dd = j && j.items ? j.items.filter(function (x) { return !x.skip && inGrid(x.code); }).length : 0;
      var st = !active(j) ? 'JV' : j.paused ? 'JV ⏸ ' + dd + '/' + tt : 'JV ▶ ' + dd + '/' + tt;
      bar.innerHTML = '<button type="button" data-jv="expand" style="' + BTN + 'background:' + (active(j) && j.paused ? '#B45309' : '#1C1917') + ';color:#fff;border:0">' + st + ' ▲</button>';
      bar.style.padding = '4px'; return;
    }
    bar.style.padding = '12px 14px';
    if (!active(j)) {
      var last = j && j.phase === 'done' ? '<div style="color:#15803D;font-weight:700">Saved: ' + esc(j.slip) + ', Serial ' + esc(j.serial || '') + '</div>' : '';
      h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><b>JV Stock Issue</b> ' + btn('hide', '▼ Hide', '') + '<div style="font-size:12px;color:#57534E">' + (last ? '' : 'No entry running. Start one from the app.') + '</div>' + last + '</div>' + btn('app', 'Back to app', 'main') + '</div>';
      bar.innerHTML = h; return;
    }
    var total = (j.items || []).filter(function (x) { return !x.skip; }).length;
    var done = (j.items || []).filter(function (x) { return !x.skip && inGrid(x.code); }).length;
    var status = '';
    if (isLogin) status = 'Logged out. Log in; the entry restarts by itself.';
    else if (j.paused) status = 'Paused: ' + (j.pauseMsg || '');
    else if (j.phase === 'dup') status = 'Checking Show Transactions for ' + j.slip + '…';
    else if (j.phase === 'dupfound') status = j.slip + ' already exists on CUIMS (Serial ' + (j.dupSerial || '?') + ').';
    else if (j.phase === 'fill') status = 'Filling… ' + done + ' of ' + total + ' items added';
    else if (j.phase === 'await') status = 'All ' + total + ' items added and checked. Review Selected Items, then tap SUBMIT.';
    else if (j.phase === 'capture') status = 'Finding the Serial No for ' + j.slip + '…';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>' + esc(j.store) + ', Slip ' + esc(j.slip) + '</b><span style="display:flex;gap:6px;align-items:center"><span style="font-size:13px;color:#57534E">' + done + '/' + total + '</span>' + btn('hide', '▼ Hide', '') + '</span></div>';
    h += '<div style="height:6px;border-radius:3px;background:#E7E5E4;margin:6px 0;overflow:hidden"><div style="height:6px;width:' + (total ? Math.round(done / total * 100) : 0) + '%;background:#16A34A"></div></div>';
    h += '<div style="font-weight:600;color:' + (j.paused ? '#B45309' : '#1C1917') + '">' + esc(status) + '</div>';
    var L = (j.log || []).slice(-4);
    if (L.length) h += '<div style="font-size:12px;color:#57534E;margin-top:4px">' + L.map(function (x) { return (x[1] ? '✗ ' : '✓ ') + esc(x[0]); }).join('<br>') + '</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    if (ui.confirmCancel) {
      h += '<span style="width:100%;font-size:13px">Cancel this entry?</span>' + btn('cancelReset', 'Cancel + clear form', 'warn') + btn('cancelKeep', 'Cancel, leave form', 'warn') + btn('noCancel', 'Keep going', '');
    } else if (j.phase === 'dupfound') {
      h += btn('dupDone', 'Mark as done', 'main') + btn('dupIgnore', 'Fill anyway', '') + btn('app', 'Back to app', '');
    } else if (j.phase === 'await' && ui.serialBox) {
      h += '<input id="jvserial" inputmode="numeric" placeholder="Serial No from CUIMS" style="flex:1;min-width:150px;min-height:46px;border:1.5px solid #A8A29E;border-radius:12px;padding:0 10px;font:16px system-ui">' + btn('serialSave', 'Save', 'main') + btn('serialNo', 'Back', '');
    } else if (j.phase === 'await') {
      h += btn('app', 'Back to app', '') + btn('serialAsk', 'Submitted? Enter Serial', '') + btn('cancel', 'Cancel', 'warn');
    } else if (!isLogin) {
      h += (j.paused ? btn('resume', 'Resume', 'main') : btn('pause', 'Pause', 'main'));
      if (j.phase === 'fill' && curItem(j)) h += btn('skip', 'Skip ' + esc(curItem(j).code), '');
      h += btn('cancel', 'Cancel', 'warn') + btn('app', 'Back to app', '');
    } else {
      h += btn('app', 'Back to app', '');
    }
    h += '</div>';
    bar.innerHTML = h;
  }
  bar.addEventListener('click', function (e) {
    var t = e.target.closest('[data-jv]'); if (!t) return;
    var a = t.getAttribute('data-jv'); var j = job();
    if (a === 'app') { B.showApp(); return; }
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
    else if (a === 'cancel') { ui.confirmCancel = true; if (!j.paused) { j.paused = true; j.pauseMsg = 'cancelling'; save(j); } paint(); }
    else if (a === 'noCancel') { ui.confirmCancel = false; j.paused = false; j.pauseMsg = ''; save(j); paint(); run(); }
    else if (a === 'cancelReset' || a === 'cancelKeep') {
      ui.confirmCancel = false; j.phase = 'cancelled'; save(j); ev('cancelled');
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

    var q0 = $('ContentPlaceHolder1_gvBatch_txtQuantity_0');
    if (batchOpen()) {
      var fc = $('ContentPlaceHolder1_gvBatch_lblFinalCode_0');
      if (fc && fc.textContent.trim().toUpperCase() !== next.code.toUpperCase()) pauseWith('Batch popup shows ' + fc.textContent.trim() + ' instead of ' + next.code);
      await act(j, 'batch' + next.code, 'batch', function () {
        q0.value = String(next.qty); fire(q0, 'change');
        if (typeof window.CalculateQty === 'function') { try { CalculateQty(); } catch (e) {} }
        $('ContentPlaceHolder1_btnAddToGrid').click();
      });
      var r = gridRow(next.code);
      if (!r) { for (var w = 0; w < 15 && !r; w++) { await sleep(200); r = gridRow(next.code); } }
      if (r) {
        if (r.bal < 0) pauseWith(next.code + ': balance below zero on the site (stock ' + r.stock + '). Skip it or check stock.');
        log(job(), next.code + ' ' + (r.name || '') + ' × ' + next.qty + ' added' + (next.remark ? ', remark added' : ''));
        ev('progress', { code: next.code, stock: r.stock });
      }
      return;
    }
    var cb = $('txtFinalCode'), nm = $('txtItem');
    if (!cb) pauseWith('Code box not found');
    if (cb.value.trim().toUpperCase() !== next.code.toUpperCase() || !nm || !nm.value.trim()) {
      await act(j, 'code' + next.code, 'Code', function () { cb.value = next.code; fire(cb, 'change'); });
      var ok = false;
      for (var t = 0; t < 20; t++) { if (batchOpen() || (($('txtItem') || {}).value || '').trim()) { ok = true; break; } await sleep(200); }
      if (!ok && job().tries['code' + next.code] >= 3) pauseWith(next.code + ': CUIMS did not find this item code. Skip it or check the code.');
      return;
    }
    await act(j, 'add' + next.code, 'ADD', function () {
      $('txtquantity').value = String(next.qty);
      var rm = $('ContentPlaceHolder1_txtitemremarks'); if (rm) rm.value = next.remark || '';
      $('ContentPlaceHolder1_btnadd').click();
    });
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
    if (s && !s.__jv) { s.__jv = true; s.addEventListener('click', function () { var j = job(); if (j && j.phase === 'await') { j.phase = 'capture'; j.capSearched = false; j.capTries = 0; j.submitAt = Date.now(); save(j); } }, true); }
    var r = $('ContentPlaceHolder1_btnreset');
    if (r && !r.__jv) { r.__jv = true; r.addEventListener('click', function () { var j = job(); if (active(j) && ['fill', 'await'].indexOf(j.phase) >= 0) { j.phase = 'fill'; j.paused = true; j.pauseMsg = 'form was reset. Tap Resume to fill again.'; j.tries = {}; save(j); } }, true); }
  }

  async function stepCapture(j) {
    if (!j.capSearched) { j.capSearched = true; save(j); log(j, 'Looking for ' + j.slip + ' in Show Transactions'); await searchSlip(j); return; }
    var hit = findSlip(j.slip);
    if (hit && hit.serial) {
      j.phase = 'done'; j.serial = hit.serial; save(j); log(j, 'Submitted. Serial ' + hit.serial);
      ev('submitted', { serial: hit.serial, rname: j.rname || '', items: j.items });
      return 'stop';
    }
    j.capTries = (j.capTries || 0) + 1;
    if (j.capTries < 3) { j.capSearched = false; save(j); await sleep(1500); return; }
    if (j.alertSerial) { j.phase = 'done'; j.serial = j.alertSerial; save(j); log(j, 'Serial ' + j.alertSerial + ' taken from the CUIMS message'); ev('submitted', { serial: j.alertSerial, rname: j.rname || '', items: j.items, note: 'serial from popup' }); return 'stop'; }
    j.phase = 'await'; j.paused = false; save(j);
    log(j, j.slip + ' not found in Show Transactions. If the submit failed, fix it and tap SUBMIT again.', true);
    ev('notfound');
    if ($('DivInsert')) $('DivInsert').click();
    hookSubmit();
    return 'stop';
  }

  async function run() {
    if (running) return; running = true;
    try {
      for (var k = 0; k < 120; k++) {
        var j = job();
        if (!active(j) || j.paused || isLogin) break;
        if (!isIssue) break;
        if (j.phase === 'await' || j.phase === 'dupfound') { hookSubmit(); break; }
        var r;
        if (j.phase === 'dup') r = await stepDup(j);
        else if (j.phase === 'fill') r = await stepFill(j);
        else if (j.phase === 'capture') r = await stepCapture(j);
        else break;
        paint();
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
    if (j.phase === 'capture' || j.phase === 'await') { if (m) { j.alertSerial = m[1]; save(j); } log(j, 'CUIMS: ' + msg); return; }
    if (j.phase === 'fill' && !j.paused) { j.paused = true; j.pauseMsg = 'CUIMS message: ' + msg; save(j); log(j, 'CUIMS: ' + msg, true); ev('paused', { msg: j.pauseMsg }); paint(); }
  };

  /* ---------- start ---------- */
  try {
    if (isLogin) { localStorage.setItem('jvSawLogin', '1'); ev('loggedout'); }
    else if (localStorage.getItem('jvSawLogin') === '1') { localStorage.removeItem('jvSawLogin'); ev('login'); }
  } catch (e) {}
  if (isIssue) {
    var pa = $('ContentPlaceHolder1_ddlProject');
    if (pa) { var areas = Array.prototype.map.call(pa.options, function (o) { return o.text.trim(); }).filter(function (t) { return t && t !== 'Select'; }); ev('areas', { areas: areas }); }
  }
  paint();
  var j0 = job();
  if (active(j0) && !isLogin && !isIssue && /cuchd\.in/.test(location.host)) {
    setTimeout(function () { location.href = ISSUE_URL; }, 900);
  } else if (isIssue) {
    if (active(j0) && j0.phase === 'await') hookSubmit();
    run();
  }
})();
