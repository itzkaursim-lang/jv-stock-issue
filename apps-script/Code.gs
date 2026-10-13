/**
 * JV Stock Issue – Google Sheet backup (standalone Apps Script)
 *
 * Setup:
 * 1. Go to script.google.com > New project. Name it "JV Stock Issue Backup".
 * 2. Delete the sample code, paste this whole file, save.
 * 3. Optional: to use your own existing sheet, paste its ID in SHEET_ID below.
 *    Leave it empty and the script creates "JV Stock Issue Data" on first backup.
 * 4. Deploy > New deployment > type "Web app".
 *    Execute as: Me.  Who has access: Anyone.
 * 5. Authorize, copy the Web app URL (ends with /exec), paste it in the app:
 *    Settings > Google Sheet backup.
 */
var SHEET_ID = '';           // optional: your own Google Sheet ID
var SHEET_NAME = 'JV Stock Issue Data';
var BACKUP_FILE = 'JV Stock Issue backup.json';

var TAB_ORDER = ['Requests', 'Request lines', 'Entries', 'Entry items', 'Pending', 'Returns', 'Stock', 'Stores'];

function getBook_() {
  var props = PropertiesService.getScriptProperties();
  var id = SHEET_ID || props.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create(SHEET_NAME);
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

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

function saveBackup_(json) {
  var it = DriveApp.getFilesByName(BACKUP_FILE);
  if (it.hasNext()) { it.next().setContent(json); }
  else { DriveApp.createFile(BACKUP_FILE, json, 'application/json'); }
}

function readBackup_() {
  var it = DriveApp.getFilesByName(BACKUP_FILE);
  return it.hasNext() ? it.next().getBlob().getDataAsString() : '';
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    if (body.action !== 'sync') return out_({ ok: false, error: 'unknown action' });
    var ss = getBook_();
    TAB_ORDER.forEach(function (name) { if (body.tabs && body.tabs[name]) writeTab_(ss, name, body.tabs[name]); });
    var info = ss.getSheetByName('Info') || ss.insertSheet('Info');
    info.clearContents();
    info.getRange(1, 1, 3, 2).setValues([['Last backup', body.at || new Date().toISOString()], ['By', (body.by && body.by.name ? body.by.name + ' (' + (body.by.emp || '') + ')' : '')], ['Sheet', ss.getUrl()]]);
    if (body.backup) saveBackup_(body.backup);
    var def = ss.getSheetByName('Sheet1'); if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
    return out_({ ok: true, sheet: ss.getUrl() });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'restore') {
    var b = readBackup_();
    return out_(b ? { ok: true, backup: b } : { ok: false, error: 'No backup yet' });
  }
  return out_({ ok: true, app: 'JV Stock Issue backup', sheet: getBook_().getUrl() });
}
