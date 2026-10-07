/**
 * Master sheet format converter (Google Apps Script).
 *
 * Two layouts of the same workbook (sheets: Objective, Subjective, Descriptive;
 * row 1 = section titles, row 2 = column headers, data from row 3):
 *
 *  EXPANDED  ("...Post-Master (1)")
 *    Every question row also carries its Chapter / Topic / Concept / Group
 *    columns filled in.
 *
 *  COMPACT   ("...Post-Master")
 *    - Every sheet keeps only the Question columns on its question rows.
 *    - The Descriptive sheet then lists, below its questions, each unique
 *      Group row, then each unique Concept row, then each unique Topic row,
 *      then the Chapter row (collected from all sheets, duplicates removed).
 *
 * Three ways to run it:
 *  1. Bound to a Google Sheet (Extensions → Apps Script):
 *       menu "Master Format" → "Expanded → Compact" / "Compact → Expanded".
 *  2. Standalone project (script.google.com) for .xlsx files in Drive:
 *       set FILE_URL below, then run fileToCompact or fileToExpanded.
 *  3. Standalone project deployed as a Web app: paste a Drive link in the page.
 *
 *  In modes 2 and 3 the file itself is converted in place (same file, same
 *  link, no new file): an .xlsx stays .xlsx, a Google Sheet stays a Google
 *  Sheet. Undo with File → Version history (Google Sheet) or
 *  Manage versions (.xlsx in Drive), or simply convert the other way.
 */

// Sheet that receives the Group / Concept / Topic / Chapter rows in COMPACT form.
var META_SHEET = 'Descriptive';
var HEADER_ROW = 2;        // row holding the column names
var FIRST_DATA_ROW = 3;    // first data row
var LIST_SEP = '|';        // separator used in *_labels / *_topics cells

// Mode 2: link (or ID) of the Drive file to convert.
var FILE_URL = 'PASTE_DRIVE_FILE_LINK_HERE';

var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/* ------------------------------------------------------------------ */
/* Mode 1: menu inside a Google Sheet                                  */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Master Format')
    .addItem('Expanded → Compact', 'convertToCompact')
    .addItem('Compact → Expanded', 'convertToExpanded')
    .addSeparator()
    .addItem('Fix image tags only (<img> → [img])', 'fixImageTagsActive')
    .addToUi();
}

function convertToCompact() {
  convertActive_('compact');
}

function convertToExpanded() {
  convertActive_('expanded');
}

function fixImageTagsActive() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var n = fixImageTags_(ss);
  ss.toast(n + ' cell(s) fixed.', 'Master Format', 5);
}

function convertActive_(direction) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    convertSpreadsheet_(ss, direction);
    ss.toast(directionLabel_(direction) + ' done.', 'Master Format', 5);
  } catch (e) {
    SpreadsheetApp.getUi().alert(e.message);
  }
}

/* ------------------------------------------------------------------ */
/* Mode 2: run from the script editor on a Drive file (.xlsx or Sheet) */
/* ------------------------------------------------------------------ */

function fileToCompact() {
  Logger.log('Converted: ' + convertDriveFile(FILE_URL, 'compact'));
}

function fileToExpanded() {
  Logger.log('Converted: ' + convertDriveFile(FILE_URL, 'expanded'));
}

/* ------------------------------------------------------------------ */
/* Mode 3: web app                                                     */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;max-width:560px;margin:24px auto">' +
    '<h3>Master format converter</h3>' +
    '<p>Drive link of the .xlsx or Google Sheet:</p>' +
    '<input id="u" style="width:100%;padding:6px">' +
    '<p><button onclick="go(\'compact\')">Expanded → Compact</button> ' +
    '<button onclick="go(\'expanded\')">Compact → Expanded</button></p>' +
    '<p id="s"></p></div>' +
    '<script>function go(d){var s=document.getElementById("s");s.textContent="Working…";' +
    'google.script.run.withSuccessHandler(function(u){s.innerHTML=' +
    '"Done: <a target=_blank href=\\""+u+"\\">open file</a>";})' +
    '.withFailureHandler(function(e){s.textContent="Error: "+e.message;})' +
    '.convertDriveFile(document.getElementById("u").value,d);}</script>'
  ).setTitle('Master format converter');
}

/**
 * Converts a Drive file (.xlsx or Google Sheet) in place: the same file is
 * overwritten, no new file is created. Returns the file's URL.
 */
function convertDriveFile(urlOrId, direction) {
  var id = fileIdFromUrl_(urlOrId);
  var file = DriveApp.getFileById(id);
  var mime = file.getMimeType();

  if (mime === GSHEET_MIME) {
    convertSpreadsheet_(SpreadsheetApp.openById(id), direction);
    return file.getUrl();
  }
  if (mime !== XLSX_MIME) {
    throw new Error('Not an .xlsx or Google Sheet: ' + file.getName());
  }

  // .xlsx: Apps Script cannot edit it directly, so work on a temporary
  // Google Sheet copy, then write the result back into the same .xlsx file.
  var tmpId = driveApi_('post', id + '/copy?supportsAllDrives=true', {
    name: 'tmp-master-convert-' + id,
    mimeType: GSHEET_MIME
  }).id;
  try {
    convertSpreadsheet_(SpreadsheetApp.openById(tmpId), direction);
    SpreadsheetApp.flush();
    var xlsx = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + tmpId +
        '/export?mimeType=' + encodeURIComponent(XLSX_MIME),
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }
    ).getBlob();
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files/' + id +
        '?uploadType=media&supportsAllDrives=true',
      {
        method: 'patch',
        contentType: XLSX_MIME,
        payload: xlsx.getBytes(),
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      }
    );
    if (res.getResponseCode() >= 300) {
      throw new Error('Could not overwrite the .xlsx: ' + res.getContentText());
    }
  } finally {
    DriveApp.getFileById(tmpId).setTrashed(true);
  }
  return file.getUrl();
}

function driveApi_(method, path, body) {
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + path, {
    method: method,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Drive API error: ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

function fileIdFromUrl_(urlOrId) {
  var s = String(urlOrId).trim();
  var m = s.match(/\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  throw new Error('Could not read a Drive file ID from: ' + s);
}

/* ------------------------------------------------------------------ */
/* Core: read sheets, convert, write back                              */
/* ------------------------------------------------------------------ */

function directionLabel_(direction) {
  return direction === 'compact' ? 'Expanded → Compact' : 'Compact → Expanded';
}

function convertSpreadsheet_(ss, direction) {
  var convertFn = direction === 'compact' ? toCompact_ : toExpanded_;

  // Read every sheet's data block (rows from FIRST_DATA_ROW down).
  var input = {};
  var order = [];
  ss.getSheets().forEach(function (sh) {
    var lastCol = sh.getLastColumn();
    if (lastCol === 0 || sh.getLastRow() < HEADER_ROW) return;
    var header = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
    if (header.indexOf('question_label') === -1) return; // not a master sheet
    var lastRow = sh.getLastRow();
    var rows = lastRow >= FIRST_DATA_ROW
      ? sh.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, lastCol).getValues()
      : [];
    input[sh.getName()] = { header: header, rows: rows };
    order.push(sh.getName());
  });

  if (!input[META_SHEET]) {
    throw new Error('Sheet "' + META_SHEET + '" with a question_label column was not found.');
  }

  var output = convertFn(input, order);
  order.forEach(function (name) {
    output[name] = output[name].map(function (r) { return r.map(imgToBracket_); });
  });

  order.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var width = input[name].header.length;
    var oldRows = input[name].rows.length;
    var newRows = output[name];
    if (oldRows > 0) {
      sh.getRange(FIRST_DATA_ROW, 1, oldRows, width).clearContent();
    }
    if (newRows.length > 0) {
      sh.getRange(FIRST_DATA_ROW, 1, newRows.length, width).setValues(newRows);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Image tags                                                          */
/* ------------------------------------------------------------------ */

/**
 * The renderer reads images as [img src="…" alt="…"]. Turns HTML-style
 * <img src="…" alt="…" /> back into that form; other values are unchanged.
 */
function imgToBracket_(value) {
  if (typeof value !== 'string' || value.indexOf('<img') === -1) return value;
  return value.replace(/<img\s+([^>]*?)\s*\/?>/gi, '[img $1]');
}

/** Converts image tags in every master sheet's data rows. Returns cells changed. */
function fixImageTags_(ss) {
  var changed = 0;
  ss.getSheets().forEach(function (sh) {
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < FIRST_DATA_ROW || lastCol === 0) return;
    var range = sh.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, lastCol);
    var values = range.getValues();
    var dirty = false;
    values = values.map(function (r) {
      return r.map(function (v) {
        var nv = imgToBracket_(v);
        if (nv !== v) { changed++; dirty = true; }
        return nv;
      });
    });
    if (dirty) range.setValues(values);
  });
  return changed;
}

/* ------------------------------------------------------------------ */
/* Column layout                                                       */
/* ------------------------------------------------------------------ */

/** Returns [start, end) column indexes of each block from the header row. */
function layout_(header) {
  var find = function (names) {
    for (var i = 0; i < header.length; i++) {
      if (names.indexOf(String(header[i]).trim()) !== -1) return i;
    }
    throw new Error('Column not found: ' + names.join(' / '));
  };
  var topic = find(['topic_title']);
  var concept = find(['concept_title']);
  var group = find(['group_name', 'group_display_name']);
  var question = find(['question_label']);
  return {
    chapter: [0, topic],
    topic: [topic, concept],
    concept: [concept, group],
    group: [group, question],
    question: [question, header.length],
    idx: function (name) { return header.indexOf(name); }
  };
}

function slice_(row, range) { return row.slice(range[0], range[1]); }

function isBlank_(cells) {
  return cells.every(function (v) { return v === '' || v === null; });
}

function emptyRow_(width) {
  var r = new Array(width);
  for (var i = 0; i < width; i++) r[i] = '';
  return r;
}

function put_(row, range, cells) {
  for (var i = 0; i < cells.length; i++) row[range[0] + i] = cells[i];
}

/**
 * Reads one block (chapter / topic / concept / group) of a row as
 * { column_name: value }, so it can be written to a sheet whose columns are
 * in a different order (e.g. Descriptive vs Objective group columns).
 */
function getBlock_(row, header, range) {
  var obj = {};
  for (var i = range[0]; i < range[1]; i++) {
    var name = String(header[i]).trim();
    if (name !== '' && !(name in obj)) obj[name] = row[i];
  }
  return obj;
}

/** Writes a block into a row, matching columns by name. */
function putBlock_(row, header, range, obj) {
  for (var i = range[0]; i < range[1]; i++) {
    var name = String(header[i]).trim();
    if (name in obj) row[i] = obj[name];
  }
}

function isBlankBlock_(obj) {
  return Object.keys(obj).every(function (k) { return obj[k] === '' || obj[k] === null; });
}

function blockKey_(obj) {
  return JSON.stringify(Object.keys(obj).sort().map(function (k) { return [k, obj[k]]; }));
}

function splitList_(value) {
  return String(value).split(LIST_SEP).map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

/* ------------------------------------------------------------------ */
/* EXPANDED → COMPACT                                                  */
/* ------------------------------------------------------------------ */

function toCompact_(input, order) {
  var out = {};
  var blocks = { group: [], concept: [], topic: [], chapter: [] };
  var seen = { group: {}, concept: {}, topic: {}, chapter: {} };
  var metaLayout = layout_(input[META_SHEET].header);

  // Descriptive first, then the other sheets in tab order.
  var scan = [META_SHEET].concat(order.filter(function (n) { return n !== META_SHEET; }));

  scan.forEach(function (name) {
    var sheet = input[name];
    var L = layout_(sheet.header);
    var width = sheet.header.length;
    out[name] = [];

    sheet.rows.forEach(function (row) {
      var q = slice_(row, L.question);
      if (!isBlank_(q)) {
        var qRow = emptyRow_(width);
        put_(qRow, L.question, q);
        out[name].push(qRow);
      }
      ['group', 'concept', 'topic', 'chapter'].forEach(function (k) {
        var block = getBlock_(row, sheet.header, L[k]);
        if (isBlankBlock_(block)) return;
        var key = blockKey_(block);
        if (seen[k][key]) return;
        seen[k][key] = true;
        blocks[k].push(block);
      });
    });
  });

  var metaHeader = input[META_SHEET].header;
  ['group', 'concept', 'topic', 'chapter'].forEach(function (k) {
    blocks[k].forEach(function (block) {
      var r = emptyRow_(metaHeader.length);
      putBlock_(r, metaHeader, metaLayout[k], block);
      out[META_SHEET].push(r);
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* COMPACT → EXPANDED                                                  */
/* ------------------------------------------------------------------ */

function toExpanded_(input, order) {
  // 1. Collect Group / Concept / Topic / Chapter rows from every sheet.
  var meta = { group: [], concept: [], topic: [], chapter: [] };
  order.forEach(function (name) {
    var sheet = input[name];
    var L = layout_(sheet.header);
    sheet.rows.forEach(function (row) {
      if (!isBlank_(slice_(row, L.question))) return;
      ['group', 'concept', 'topic', 'chapter'].forEach(function (k) {
        var block = getBlock_(row, sheet.header, L[k]);
        if (!isBlankBlock_(block)) meta[k].push(block);
      });
    });
  });

  var mL = layout_(input[META_SHEET].header);
  var gLabels = 'group_question_labels';
  var cTitle = 'concept_title';
  var cLabels = 'concept_question_labels';
  var tTitle = 'topic_title';
  var tConcepts = 'topic_concept_labels';
  var chPre = 'pre_topics';
  var chPost = 'post_topics';

  var used = {};
  var findGroup = function (qLabel) {
    for (var i = 0; i < meta.group.length; i++) {
      if (splitList_(meta.group[i][gLabels]).indexOf(qLabel) !== -1) return i;
    }
    return -1;
  };
  var findConcept = function (qLabel) {
    for (var i = 0; i < meta.concept.length; i++) {
      if (splitList_(meta.concept[i][cLabels]).indexOf(qLabel) !== -1) return meta.concept[i];
    }
    return null;
  };
  var findTopic = function (concept) {
    if (!concept) return null;
    var title = String(concept[cTitle]).trim();
    for (var i = 0; i < meta.topic.length; i++) {
      if (splitList_(meta.topic[i][tConcepts]).indexOf(title) !== -1) return meta.topic[i];
    }
    return null;
  };
  var findChapter = function (topic) {
    if (meta.chapter.length === 1) return meta.chapter[0];
    if (!topic) return null;
    var title = String(topic[tTitle]).trim();
    for (var i = 0; i < meta.chapter.length; i++) {
      var list = splitList_(meta.chapter[i][chPre]).concat(splitList_(meta.chapter[i][chPost]));
      if (list.indexOf(title) !== -1) return meta.chapter[i];
    }
    return null;
  };

  var fill = function (row, header, L, qLabel, group) {
    var concept = findConcept(qLabel);
    var topic = findTopic(concept);
    var chapter = findChapter(topic);
    if (group) putBlock_(row, header, L.group, group);
    if (concept) putBlock_(row, header, L.concept, concept);
    if (topic) putBlock_(row, header, L.topic, topic);
    if (chapter) putBlock_(row, header, L.chapter, chapter);
  };

  // 2. Rebuild each sheet's question rows with their parent columns.
  var out = {};
  order.forEach(function (name) {
    var sheet = input[name];
    var L = layout_(sheet.header);
    var qLabelCol = L.idx('question_label');
    out[name] = [];
    sheet.rows.forEach(function (row) {
      if (isBlank_(slice_(row, L.question))) return;
      var r = row.slice();
      var qLabel = String(row[qLabelCol]).trim();
      var gi = findGroup(qLabel);
      if (gi !== -1) used[gi] = true;
      fill(r, sheet.header, L, qLabel, gi !== -1 ? meta.group[gi] : null);
      out[name].push(r);
    });
  });

  // 3. Groups no question row picked up stay as group-only rows (with parents).
  var metaHeader = input[META_SHEET].header;
  meta.group.forEach(function (g, i) {
    if (used[i]) return;
    var r = emptyRow_(metaHeader.length);
    var firstQ = splitList_(g[gLabels])[0] || '';
    fill(r, metaHeader, mL, firstQ, g);
    out[META_SHEET].push(r);
  });
  return out;
}
