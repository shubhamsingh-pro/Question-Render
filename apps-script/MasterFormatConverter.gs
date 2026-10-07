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
 * Menu "Master Format" → "Expanded → Compact" / "Compact → Expanded".
 */

// Sheet that receives the Group / Concept / Topic / Chapter rows in COMPACT form.
var META_SHEET = 'Descriptive';
var HEADER_ROW = 2;        // row holding the column names
var FIRST_DATA_ROW = 3;    // first data row
var LIST_SEP = '|';        // separator used in *_labels / *_topics cells

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Master Format')
    .addItem('Expanded → Compact', 'convertToCompact')
    .addItem('Compact → Expanded', 'convertToExpanded')
    .addToUi();
}

/* ------------------------------------------------------------------ */
/* Menu entry points                                                   */
/* ------------------------------------------------------------------ */

function convertToCompact() {
  runConversion_(toCompact_, 'Expanded → Compact');
}

function convertToExpanded() {
  runConversion_(toExpanded_, 'Compact → Expanded');
}

function runConversion_(convertFn, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sheets = ss.getSheets();

  // Read every sheet's data block (rows from FIRST_DATA_ROW down).
  var input = {};
  var order = [];
  sheets.forEach(function (sh) {
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
    ui.alert('Sheet "' + META_SHEET + '" with a question_label column was not found.');
    return;
  }

  var output = convertFn(input, order);

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

  ss.toast(label + ' done.', 'Master Format', 5);
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
        var cells = slice_(row, L[k]);
        if (isBlank_(cells)) return;
        var key = JSON.stringify(cells);
        if (seen[k][key]) return;
        seen[k][key] = true;
        blocks[k].push(cells);
      });
    });
  });

  var metaWidth = input[META_SHEET].header.length;
  ['group', 'concept', 'topic', 'chapter'].forEach(function (k) {
    blocks[k].forEach(function (cells) {
      var r = emptyRow_(metaWidth);
      put_(r, metaLayout[k], cells);
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
        var cells = slice_(row, L[k]);
        if (!isBlank_(cells)) meta[k].push(cells);
      });
    });
  });

  var mL = layout_(input[META_SHEET].header);
  var col = function (k, name) { return mL.idx(name) - mL[k][0]; };
  var gLabels = col('group', 'group_question_labels');
  var cTitle = col('concept', 'concept_title');
  var cLabels = col('concept', 'concept_question_labels');
  var tTitle = col('topic', 'topic_title');
  var tConcepts = col('topic', 'topic_concept_labels');
  var chPre = col('chapter', 'pre_topics');
  var chPost = col('chapter', 'post_topics');

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

  var fill = function (row, L, qLabel, group) {
    var concept = findConcept(qLabel);
    var topic = findTopic(concept);
    var chapter = findChapter(topic);
    if (group) put_(row, L.group, group);
    if (concept) put_(row, L.concept, concept);
    if (topic) put_(row, L.topic, topic);
    if (chapter) put_(row, L.chapter, chapter);
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
      fill(r, L, qLabel, gi !== -1 ? meta.group[gi] : null);
      out[name].push(r);
    });
  });

  // 3. Groups no question row picked up stay as group-only rows (with parents).
  var width = input[META_SHEET].header.length;
  meta.group.forEach(function (g, i) {
    if (used[i]) return;
    var r = emptyRow_(width);
    var firstQ = splitList_(g[gLabels])[0] || '';
    fill(r, mL, firstQ, g);
    out[META_SHEET].push(r);
  });
  return out;
}
