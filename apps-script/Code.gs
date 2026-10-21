/**
 * JV Stock Issue – Google Sheet + Drive backup (standalone Apps Script) v3 (with paper photos)
 *
 * Setup / update:
 * 1. script.google.com > your project (or New project) > replace ALL code with this file > Save.
 * 2. Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy.
 *    (First time: Deploy > New deployment > Web app > Execute as: Me > Access: Anyone.)
 * 3. The /exec URL stays the same after "New version". Paste it in the app: Settings > Cloud backup.
 */
var SHEET_ID = '';                        // optional: your own Google Sheet ID
var SHEET_NAME = 'JV Stock Issue Data';
var FOLDER_NAME = 'JV Stock Issue backups';
var AUTO_EVERY_MIN = 30;                  // new auto backup at most every 30 minutes
var KEEP_AUTO = 60;                       // keep the newest 60 auto backups (kept ones are never deleted)
var TAB_ORDER = ['Requests', 'Request lines', 'Entries', 'Entry items', 'Pending', 'Returns', 'Stock', 'Stores'];

function props_() { return PropertiesService.getScriptProperties(); }
function getBook_() {
  var id = SHEET_ID || props_().getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create(SHEET_NAME);
  props_().setProperty('SHEET_ID', ss.getId());
  return ss;
}
function folder_() {
  var id = props_().getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  var f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props_().setProperty('FOLDER_ID', f.getId());
  return f;
}
function photoFolder_(date) {
  var root = folder_(), it = root.getFoldersByName('Paper photos');
  var pf = it.hasNext() ? it.next() : root.createFolder('Paper photos');
  var m = String(date || '').slice(0, 7) || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM');
  var it2 = pf.getFoldersByName(m);
  return it2.hasNext() ? it2.next() : pf.createFolder(m);
}
function meta_(f) {
  var d = {}; try { d = JSON.parse(f.getDescription() || '{}'); } catch (e) {}
  return { id: f.getId(), name: f.getName(), at: f.getDateCreated().toISOString(), updated: f.getLastUpdated().toISOString(), size: f.getSize(),
           kind: d.kind || 'auto', keep: !!d.keep, note: d.note || '', by: d.by || '', counts: d.counts || null };
}
function setMeta_(f, m) { f.setDescription(JSON.stringify(m)); }
function listFiles_() {
  var out = [], it = folder_().getFiles();
  while (it.hasNext()) { var f = it.next(); if (/\.json$/.test(f.getName())) out.push(f); }
  out.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  return out;
}
function stamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'); }

function writeTab_(ss, name, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  if (!rows || !rows.length) { sh.getRange(1, 1).setValue('No data'); return; }
  var head = Object.keys(rows[0]);
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (head.indexOf(k) < 0) head.push(k); }); });
  var data = [head].concat(rows.map(function (r) { return head.map(function (k) { return r[k] == null ? '' : r[k]; }); }));
  sh.getRange(1, 1, data.length, head.length).setValues(data);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#1C1917').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
}

function saveSnapshot_(json, kind, note, by, counts) {
  var files = listFiles_();
  var lastAuto = null;
  for (var i = 0; i < files.length; i++) { var m = meta_(files[i]); if (m.kind === 'auto') { lastAuto = files[i]; break; } }
  var meta = { kind: kind, keep: kind === 'manual', note: note || '', by: by || '', counts: counts || null };
  if (kind === 'auto' && lastAuto && (new Date() - lastAuto.getDateCreated()) < AUTO_EVERY_MIN * 60000 && !meta_(lastAuto).keep) {
    lastAuto.setContent(json); setMeta_(lastAuto, meta); return lastAuto;
  }
  var f = folder_().createFile((kind === 'manual' ? 'Manual ' : 'Auto ') + stamp_() + '.json', json, 'application/json');
  setMeta_(f, meta);
  if (kind === 'auto') {
    var autos = listFiles_().filter(function (x) { var m = meta_(x); return m.kind === 'auto' && !m.keep; });
    for (var k = KEEP_AUTO; k < autos.length; k++) autos[k].setTrashed(true);
  }
  return f;
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse(e.postData.contents);
    var by = body.by && body.by.name ? body.by.name + ' (' + (body.by.emp || '') + ')' : '';
    if (body.action === 'sync') {
      var ss = getBook_();
      TAB_ORDER.forEach(function (name) { if (body.tabs && body.tabs[name]) writeTab_(ss, name, body.tabs[name]); });
      var info = ss.getSheetByName('Info') || ss.insertSheet('Info');
      info.clearContents();
      info.getRange(1, 1, 3, 2).setValues([['Last backup', body.at || new Date().toISOString()], ['By', by], ['Backups folder', folder_().getUrl()]]);
      var def = ss.getSheetByName('Sheet1'); if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
      var f = body.backup ? saveSnapshot_(body.backup, body.kind === 'manual' ? 'manual' : 'auto', body.note, by, body.counts) : null;
      return out_({ ok: true, sheet: ss.getUrl(), id: f ? f.getId() : '' });
    }
    if (body.action === 'photo') {
      var safe = function (x) { return String(x || '').replace(/[^A-Za-z0-9 _.-]/g, '-').slice(0, 40); };
      var name = safe(body.date) + '_' + safe(body.req) + '_' + safe(body.store) + '_' + safe(body.id) + '.jpg';
      var fo = photoFolder_(body.date), ex = fo.getFilesByName(name);
      if (ex.hasNext()) return out_({ ok: true, fileId: ex.next().getId() });
      var blob = Utilities.newBlob(Utilities.base64Decode(body.b64), 'image/jpeg', name);
      var pfile = fo.createFile(blob);
      pfile.setDescription(JSON.stringify({ req: body.req, store: body.store, date: body.date, id: body.id, at: body.at, by: body.by }));
      return out_({ ok: true, fileId: pfile.getId() });
    }
    if (body.action === 'photoDel') { try { DriveApp.getFileById(body.fileId).setTrashed(true); } catch (e) {} return out_({ ok: true }); }
    if (body.action === 'delete') { DriveApp.getFileById(body.id).setTrashed(true); return out_({ ok: true }); }
    if (body.action === 'meta') {
      var file = DriveApp.getFileById(body.id), m = meta_(file);
      var nm = { kind: m.kind, keep: body.keep != null ? !!body.keep : m.keep, note: body.note != null ? String(body.note) : m.note, by: m.by, counts: m.counts };
      setMeta_(file, nm); return out_({ ok: true });
    }
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally { try { lock.releaseLock(); } catch (x) {} }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'list') return out_({ ok: true, items: listFiles_().map(meta_), sheet: getBook_().getUrl(), folder: folder_().getUrl() });
    if (p.action === 'get') return out_({ ok: true, backup: DriveApp.getFileById(p.id).getBlob().getDataAsString() });
    if (p.action === 'photo') return out_({ ok: true, b64: Utilities.base64Encode(DriveApp.getFileById(p.fileId).getBlob().getBytes()) });
    if (p.action === 'restore') {
      var files = listFiles_();
      if (!files.length) return out_({ ok: false, error: 'No backup yet' });
      return out_({ ok: true, backup: files[0].getBlob().getDataAsString() });
    }
    return out_({ ok: true, app: 'JV Stock Issue backup v2', sheet: getBook_().getUrl() });
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}
