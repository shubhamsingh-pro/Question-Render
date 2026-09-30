/* Question Bank Viewer — parses Chapter/Topic/Concept/Group/Question bulk-import sheets
   and renders every question with KaTeX + images, linked to its hierarchy. */
(() => {
'use strict';

/* ---------------- small helpers ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const str = v => (v == null ? '' : String(v)).trim();
const splitList = s => str(s).split('|').map(x => x.trim()).filter(Boolean);
const natural = (a, b) => String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: 'base'});
const num = v => { const n = parseFloat(str(v)); return isNaN(n) ? null : n; };
const fmtNum = v => { const n = num(v); return n == null ? str(v) : String(+n.toFixed(2)); };
const yes = v => /^(yes|y|true|1)$/i.test(str(v));

/** "Some Title (CODE_123)" -> "CODE_123" ; "(CODE) BG01" -> "(CODE) BG01" handled separately */
function codeOf(title) {
  const t = str(title);
  const m = t.match(/\(([^()]+)\)\s*$/);
  return (m ? m[1] : t).trim().toUpperCase();
}
/** Normalise question labels: "X_C01 Q01" and "X_C01_Q01" -> "X_C01_Q01" */
function qkey(label) {
  return str(label).replace(/[\s_\-]+(Q\d+)\s*$/i, '_$1').replace(/\s+/g, '').toUpperCase();
}
/** chapter codes are often shared ("(07_Science_ICSE)"), so chapters are keyed by full title */
function chapterKey(title) { return str(title).replace(/\s+/g, ' ').toUpperCase(); }
/** "Topic: 01: THE NEPHRON … (CODE)" -> "thenephron…" for name-based fallback matching */
function nameKey(title) { return str(title).replace(/\([^()]*\)\s*$/, '').replace(/^\s*topic\s*:?\s*\d+\s*:?/i, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function groupKey(name) { return str(name).replace(/\s+/g, ' ').toUpperCase(); }
/** "(07ICMA_..._T01_C01) BG02" -> "07ICMA_..._T01_C01" */
function conceptFromGroup(name) { const m = str(name).match(/^\(([^()]+)\)/); return m ? m[1].trim().toUpperCase() : ''; }
function conceptFromLabel(label) { const m = qkey(label).match(/^(.*_C\d+)_Q\d+$/); return m ? m[1] : ''; }
function topicFromConcept(code) { const m = str(code).match(/^(.*_T\d+)_C\d+$/i); return m ? m[1].toUpperCase() : ''; }

/* ---------------- rich text (KaTeX / images / blanks) ---------------- */
let katexIssues = [];
let currentCtx = null; // {label} for issue reporting

function tex(src, display = false) {
  const t = str(src).replace(/ /g, ' ');
  if (!t) return '';
  try {
    return katex.renderToString(t, {throwOnError: true, displayMode: display, strict: 'ignore', trust: false, output: 'html'});
  } catch (e) {
    katexIssues.push({label: currentCtx?.label || '', tex: t, msg: e.message});
    return `<span class="kerr" title="${esc(e.message)}">${esc(t)}</span>`;
  }
}

/** Raw LaTeX with \text{…} runs: render text runs as wrapping prose, the rest as inline math. */
function mixedLatex(src) {
  const s = str(src);
  let out = '', i = 0, mathBuf = '';
  const flush = () => { if (mathBuf.trim()) out += tex(mathBuf); mathBuf = ''; };
  while (i < s.length) {
    const m = s.slice(i).match(/^\\(?:text|textbf|mathrm)\s*\{/);
    if (m) {
      let depth = 1, j = i + m[0].length;
      while (j < s.length && depth) { if (s[j] === '{' && s[j-1] !== '\\') depth++; else if (s[j] === '}' && s[j-1] !== '\\') depth--; j++; }
      const inner = s.slice(i + m[0].length, j - 1);
      flush();
      out += esc(inner.replace(/\\([{}%$&#_])/g, '$1').replace(/\\,|~/g, ' '));
      i = j;
    } else { mathBuf += s[i++]; }
  }
  flush();
  return out;
}

function driveId(url) {
  const m = str(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=|thumbnail\?(?:[^#]*&)?id=)([\w-]{10,})/)
         || str(url).match(/docs\.google\.com\/uc\?(?:[^#]*&)?id=([\w-]{10,})/);
  return m ? m[1] : null;
}
function imgHTML(attrStr) {
  const attrs = {};
  attrStr.replace(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g, (_, k, a, b, c) => { attrs[k.toLowerCase()] = a ?? b ?? c ?? ''; });
  const src = attrs.src || '';
  const alt = attrs.alt || '';
  if (!src) return '';
  const id = driveId(src);
  const candidates = id
    ? [`https://lh3.googleusercontent.com/d/${id}=w1600`, `https://drive.google.com/thumbnail?id=${id}&sz=w1600`]
    : [src];
  const w = attrs.width ? ` style="max-width:${esc(attrs.width)}${/^\d+$/.test(attrs.width) ? 'px' : ''}"` : '';
  return `<figure class="fig"><img src="${esc(candidates[0])}" data-fallbacks="${esc(candidates.slice(1).join(' '))}" data-orig="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer"${w}>` +
         (alt ? `<figcaption>${esc(alt)}</figcaption>` : '') + `</figure>`;
}

const TOKEN_SRC = /\[katex\]([\s\S]*?)(?:\[\/katex\]|$)|\[img\s+([^\]]*)\]|\$\$([^$\n]{1,40})\$\$|\\\((.+?)\\\)|<br\s*\/?>|\r?\n/gi;
const SAFE_TAGS = /&lt;(\/?)(b|i|u|strong|em|sub|sup|p|ul|ol|li|table|tr|td|th|thead|tbody)&gt;/gi;

/** ctx.blanks: {placeholder -> answer} for $$a$$ style blanks */
function rich(src, ctx = {}) {
  const s = src == null ? '' : String(src);
  if (!s.trim()) return '';
  let out = '', last = 0, m;
  const TOKEN = new RegExp(TOKEN_SRC.source, 'gi'); // fresh per call (rich() recurses for blanks)
  while ((m = TOKEN.exec(s))) {
    if (m[0] === '' ) { TOKEN.lastIndex++; continue; }
    out += esc(s.slice(last, m.index)).replace(SAFE_TAGS, '<$1$2>');
    if (m[1] !== undefined && /^\[katex\]/i.test(m[0])) out += tex(m[1]);
    else if (m[2] !== undefined) out += imgHTML(m[2]);
    else if (m[3] !== undefined) {
      const ph = m[3].trim();
      const ans = ctx.blanks && ctx.blanks[ph.toUpperCase()];
      out += `<span class="blank${ans ? ' has-ans' : ''}"><span class="ph-q">${esc(ph)}</span>` +
             (ans ? `<span class="ph-a ans-only">${rich(ans)}</span>` : '') + `</span>`;
    }
    else if (m[4] !== undefined) out += tex(m[4]);
    else out += '<br>';
    last = TOKEN.lastIndex;
  }
  out += esc(s.slice(last)).replace(SAFE_TAGS, '<$1$2>');
  return out;
}
/** Answer content: "Equation" typed cells often hold bare LaTeX without [Katex] tags */
function answerHTML(content, type) {
  const s = str(content);
  if (!s) return '';
  if (/^equation$/i.test(str(type)) && !/\[katex\]|\[img/i.test(s)) return mixedLatex(s);
  if (!/\[katex\]/i.test(s) && /\\(text|frac|times|circ|sqrt|left|right|cdot|div)\b/.test(s)) return mixedLatex(s);
  return rich(s);
}

/* ---------------- workbook parsing ---------------- */
const KNOWN = ['question_label', 'chapter_title', 'topic_title', 'concept_title', 'group_name'];

function sheetKind(name, headers) {
  const n = name.toLowerCase();
  if (n.includes('objective') || n.includes('mcq')) return 'Objective';
  if (n.includes('descriptive')) return 'Descriptive';
  if (n.includes('subjective') || n.includes('fill')) return 'Subjective';
  if (headers.includes('correct_answer_1')) return 'Objective';
  if (headers.includes('display_answer') || headers.includes('sub_question_1')) return 'Descriptive';
  if (headers.includes('placeholder_1') || headers.includes('answer_1')) return 'Subjective';
  return name;
}

function parseSheets(wb, fileName) {
  const out = [];
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], {header: 1, raw: false, defval: '', blankrows: false});
    let hIdx = -1;
    for (let i = 0; i < Math.min(8, aoa.length); i++) {
      const cells = aoa[i].map(c => str(c).toLowerCase());
      if (KNOWN.some(k => cells.includes(k))) { hIdx = i; break; }
    }
    if (hIdx < 0) continue;
    const headers = aoa[hIdx].map(c => str(c).toLowerCase());
    const rows = [];
    for (let r = hIdx + 1; r < aoa.length; r++) {
      const row = {}; let any = false;
      headers.forEach((h, i) => {
        if (!h) return;
        const v = aoa[r][i];
        if (v !== '' && v != null && !(h in row && row[h] !== '')) { row[h] = v; any = true; }
      });
      if (any) { row.__row = r + 1; rows.push(row); }
    }
    out.push({name, file: fileName, kind: sheetKind(name, headers), headers, rows});
  }
  return out;
}

/* ---------------- model: link questions to hierarchy ---------------- */
function buildModel(sheets) {
  const chapters = new Map(), topics = new Map(), concepts = new Map(), groups = new Map();
  const questions = [], issues = [];
  const seq = {c: 0};
  const merge = (map, key, row, extra) => {
    const cur = map.get(key);
    if (!cur) { map.set(key, Object.assign({key, order: seq.c++, row}, extra)); return; }
    for (const [k, v] of Object.entries(row)) if (str(v) && !str(cur.row[k])) cur.row[k] = v;
  };

  for (const sh of sheets) for (const row of sh.rows) {
    const ctx = {sheet: sh.name, kind: sh.kind, rowNo: row.__row};
    if (str(row.chapter_title)) merge(chapters, chapterKey(row.chapter_title), pick(row, /^(chapter_|is_update_chapter|pre_topics|post_topics)/), {title: str(row.chapter_title)});
    if (str(row.topic_title)) merge(topics, codeOf(row.topic_title), pick(row, /^(topic_|is_update_topic|pre_post_learning|related_topics)/), {title: str(row.topic_title)});
    if (str(row.concept_title)) merge(concepts, codeOf(row.concept_title), pick(row, /^(concept_|is_update_concept|keywords|digicards|related_concepts|basic_groups|intermediate_groups|advanced_groups)/), {title: str(row.concept_title)});
    if (str(row.group_name) && !/^\([^()]+\)\s*\S+/.test(str(row.group_name)))
      issues.push({type: 'Malformed group row', text: `${sh.name} row ${row.__row}: group_name is "${str(row.group_name).slice(0, 80)}" — expected "(CONCEPT_CODE) BG01". The group columns in this row look shifted.`});
    else if (str(row.group_name)) merge(groups, groupKey(row.group_name), pick(row, /^(group_|is_update_group|related_digicards)/), {title: str(row.group_name)});
    if (str(row.question_label)) {
      questions.push({
        label: str(row.question_label), key: qkey(row.question_label), kind: sh.kind, sheet: sh.name, rowNo: row.__row, row,
        rowChapter: str(row.chapter_title) ? chapterKey(row.chapter_title) : '',
        rowTopic: str(row.topic_title) ? codeOf(row.topic_title) : '',
        rowConcept: str(row.concept_title) ? codeOf(row.concept_title) : '',
        rowGroup: str(row.group_name) ? groupKey(row.group_name) : '',
        ...ctx,
      });
    }
  }

  // link maps
  const qToGroup = new Map(), qToConcept = new Map(), conceptToTopic = new Map(), topicToChapter = new Map(), groupToConcept = new Map();
  const knownQ = new Set(questions.map(q => q.key));
  for (const g of groups.values()) {
    for (const l of splitList(g.row.group_question_labels)) {
      const k = qkey(l);
      if (qToGroup.has(k) && qToGroup.get(k) !== g.key) issues.push({type: 'Question in two groups', text: `${l} is listed in ${qToGroup.get(k)} and ${g.title}`});
      if (!qToGroup.has(k)) qToGroup.set(k, g.key);
      if (!knownQ.has(k)) issues.push({type: 'Missing question', text: `Group ${g.title} lists ${l}, but no question row has that label`});
    }
    g.type = str(g.row.group_type);
  }
  for (const c of concepts.values()) {
    for (const l of splitList(c.row.concept_question_labels)) { qToConcept.set(qkey(l), c.key); if (!knownQ.has(qkey(l))) issues.push({type: 'Missing question', text: `Concept ${c.title} lists ${l}, but no question row has that label`}); }
    for (const col of ['basic_groups', 'intermediate_groups', 'advanced_groups'])
      for (const gname of splitList(c.row[col])) {
        groupToConcept.set(groupKey(gname), c.key);
        if (!groups.has(groupKey(gname))) issues.push({type: 'Missing group', text: `Concept ${c.title} lists group ${gname}, but no group row defines it`});
      }
  }
  for (const t of topics.values())
    for (const cl of splitList(t.row.topic_concept_labels)) conceptToTopic.set(codeOf(cl), t.key);
  const topicNameToChapter = new Map();
  for (const ch of chapters.values())
    for (const col of ['post_topics', 'pre_topics']) for (const tl of splitList(ch.row[col])) {
      if (!topicToChapter.has(codeOf(tl))) topicToChapter.set(codeOf(tl), ch.key);
      if (!topicNameToChapter.has(nameKey(tl))) topicNameToChapter.set(nameKey(tl), ch.key);
    }
  // topics whose code is not listed by any chapter: match on topic name, and flag the code mismatch
  for (const t of topics.values()) {
    if (topicToChapter.has(t.key)) continue;
    const ch = topicNameToChapter.get(nameKey(t.title));
    if (ch) {
      topicToChapter.set(t.key, ch);
      issues.push({type: 'Topic code mismatch', text: `Topic "${t.title}" is linked to chapter "${chapters.get(ch).title}" by name only — the chapter's topic list uses a different code`});
    } else if (chapters.size) issues.push({type: 'No chapter', text: `Topic "${t.title}" is not listed in any chapter's pre_topics / post_topics`});
  }

  const onlyChapter = chapters.size === 1 ? [...chapters.keys()][0] : '';
  const resolveTopic = cKey => conceptToTopic.get(cKey) || (topics.has(topicFromConcept(cKey)) ? topicFromConcept(cKey) : '');
  const resolveChapter = tKey => topicToChapter.get(tKey) || onlyChapter;

  const seen = new Map();
  for (const q of questions) {
    if (seen.has(q.key)) issues.push({type: 'Duplicate label', text: `${q.label} appears in ${seen.get(q.key)} and ${q.sheet} row ${q.rowNo}`});
    else seen.set(q.key, `${q.sheet} row ${q.rowNo}`);
    q.group = qToGroup.get(q.key) || q.rowGroup || '';
    q.concept = qToConcept.get(q.key) || q.rowConcept || groupToConcept.get(q.group) || conceptFromGroup(q.group) || conceptFromLabel(q.label) || '';
    q.topic = resolveTopic(q.concept) || q.rowTopic || '';
    q.chapter = resolveChapter(q.topic) || q.rowChapter || '';
    if (!q.group) issues.push({type: 'No group', text: `${q.label} (${q.sheet} row ${q.rowNo}) is not listed in any group`});
    if (!concepts.has(q.concept)) issues.push({type: 'No concept', text: `${q.label}: concept ${q.concept || '(unknown)'} is not defined in any concept row`});
    if (q.concept && !topics.has(q.topic)) issues.push({type: 'No topic', text: `${q.label}: could not find the topic for concept ${q.concept}`});
    checkMarks(q, issues);
  }
  for (const g of groups.values()) {
    const c = groupToConcept.get(g.key) || conceptFromGroup(g.title);
    g.concept = c;
  }

  // ordering: chapter -> topic (as listed in chapter) -> concept (as listed in topic) -> label
  const topicOrder = new Map(), conceptOrder = new Map();
  let i = 0;
  for (const ch of [...chapters.values()].sort((a, b) => a.order - b.order))
    for (const tl of [...splitList(ch.row.pre_topics), ...splitList(ch.row.post_topics)]) if (!topicOrder.has(codeOf(tl))) topicOrder.set(codeOf(tl), i++);
  for (const t of [...topics.values()].sort((a, b) => natural(a.key, b.key))) if (!topicOrder.has(t.key)) topicOrder.set(t.key, i++);
  i = 0;
  for (const t of [...topics.values()].sort((a, b) => (topicOrder.get(a.key) ?? 1e9) - (topicOrder.get(b.key) ?? 1e9)))
    for (const cl of splitList(t.row.topic_concept_labels)) if (!conceptOrder.has(codeOf(cl))) conceptOrder.set(codeOf(cl), i++);
  for (const c of [...concepts.values()].sort((a, b) => natural(a.key, b.key))) if (!conceptOrder.has(c.key)) conceptOrder.set(c.key, i++);
  const chOrder = k => chapters.get(k)?.order ?? 1e9;
  questions.sort((a, b) =>
    chOrder(a.chapter) - chOrder(b.chapter) ||
    (topicOrder.get(a.topic) ?? 1e9) - (topicOrder.get(b.topic) ?? 1e9) ||
    (conceptOrder.get(a.concept) ?? 1e9) - (conceptOrder.get(b.concept) ?? 1e9) ||
    natural(a.label, b.label));

  return {chapters, topics, concepts, groups, questions, issues, topicOrder, conceptOrder};
}
function pick(row, re) { const o = {}; for (const [k, v] of Object.entries(row)) if (re.test(k)) o[k] = v; return o; }

function checkMarks(q, issues) {
  const r = q.row, marks = num(r.marks);
  if (marks == null) return;
  if (q.kind === 'Objective') {
    const opts = options(r);
    if (opts.length && !opts.some(o => o.correct)) issues.push({type: 'No correct option', text: `${q.label}: no option is marked correct_answer = Yes`});
    return;
  }
  let sum = 0, any = false;
  const wKey = q.kind === 'Subjective' ? 'weightage_' : 'answer_weightage_';
  for (let n = 1; n <= 40; n++) { const w = num(r[wKey + n]); if (w != null) { sum += w; any = true; } }
  if (any && Math.abs(sum - marks) > 1e-6) issues.push({type: 'Marks mismatch', text: `${q.label}: marks = ${fmtNum(marks)} but answer weightages add up to ${fmtNum(sum)}`});
}

/* ---------------- question parts ---------------- */
function options(r) {
  const out = [];
  for (let n = 1; n <= 10; n++) {
    const c = r['answer_content_' + n];
    if (!str(c)) continue;
    out.push({n, type: str(r['answer_type_' + n]), content: c, correct: yes(r['correct_answer_' + n]), w: str(r['answer_weightage_' + n])});
  }
  return out;
}
function criteria(r, typeKey, wKey, cKey, max = 40) {
  const out = [];
  for (let n = 1; n <= max; n++) {
    const c = r[cKey + n];
    if (!str(c)) continue;
    out.push({n, type: str(r[typeKey + n]), w: str(r[wKey + n]), content: c});
  }
  return out;
}

/* ---------------- state + rendering ---------------- */
const state = {model: null, sheets: [], files: [], sel: null, q: '', fType: '', fCat: '', fDiff: '', fGroupType: '', limit: 60};

function label(map, key, field) {
  const e = map.get(key);
  if (!e) return key || '—';
  return str(e.row[field]) || e.title;
}

function renderTree() {
  const M = state.model;
  const count = pred => M.questions.filter(pred).length;
  const node = (lvl, key, name, n, inner, cls) =>
    `<details ${lvl !== 'gp' ? '' : ''}${state.sel && state.sel.lvl === lvl && state.sel.key === key ? ' open' : ''}>` +
    `<summary data-lvl="${lvl}" data-key="${esc(key)}" class="${state.sel && state.sel.lvl === lvl && state.sel.key === key ? 'active' : ''}">` +
    `<span class="caret">${inner ? '▸' : ''}</span><span class="dot ${cls}"></span><span class="nm">${esc(name)}</span><span class="ct">${n}</span></summary>${inner || ''}</details>`;

  const chKeys = [...new Set([...[...M.chapters.values()].sort((a, b) => a.order - b.order).map(c => c.key), ...M.questions.map(q => q.chapter)])];
  let html = '';
  for (const ch of chKeys) {
    const tKeys = [...new Set([...[...M.topics.keys()].filter(t => M.questions.some(q => q.topic === t && q.chapter === ch) || (M.chapters.size <= 1 || isTopicOf(ch, t))), ...M.questions.filter(q => q.chapter === ch).map(q => q.topic)])]
      .sort((a, b) => (M.topicOrder.get(a) ?? 1e9) - (M.topicOrder.get(b) ?? 1e9));
    let tHtml = '';
    for (const t of tKeys) {
      const cKeys = [...new Set([...splitList(M.topics.get(t)?.row.topic_concept_labels).map(codeOf), ...M.questions.filter(q => q.topic === t && q.chapter === ch).map(q => q.concept)])]
        .sort((a, b) => (M.conceptOrder.get(a) ?? 1e9) - (M.conceptOrder.get(b) ?? 1e9));
      let cHtml = '';
      for (const c of cKeys) {
        const gKeys = [...new Set(M.questions.filter(q => q.concept === c && q.topic === t).map(q => q.group))];
        let gHtml = '';
        for (const g of gKeys) {
          const gname = g ? `${label(M.groups, g, 'group_display_name').replace(/^\([^)]*\)\s*/, '')}${M.groups.get(g)?.type ? ' · ' + M.groups.get(g).type : ''}` : 'No group';
          gHtml += node('gp', g || '__none', gname, count(q => q.group === g && q.concept === c && q.topic === t), '', 'gp');
        }
        cHtml += node('cn', c || '__none', c ? label(M.concepts, c, 'concept_display_name') : 'Unlinked questions', count(q => q.concept === c && q.topic === t), gHtml, 'cn');
      }
      tHtml += node('tp', t || '__none', t ? label(M.topics, t, 'topic_display_name') : 'No topic', count(q => q.topic === t && q.chapter === ch), cHtml, 'tp');
    }
    html += node('ch', ch || '__none', ch ? label(M.chapters, ch, 'chapter_display_name') : 'No chapter', count(q => q.chapter === ch), tHtml, 'ch');
  }
  $('#tree').innerHTML = html;
  $('#tree').querySelectorAll(':scope > details').forEach(d => d.open = true);
  if (state.sel) { // expand ancestors of selection
    const el = $('#tree').querySelector(`summary.active`);
    let p = el && el.parentElement;
    while (p && p.id !== 'tree') { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
  }
}
function isTopicOf(ch, t) {
  const c = state.model.chapters.get(ch);
  return c && [...splitList(c.row.post_topics), ...splitList(c.row.pre_topics)].some(x => codeOf(x) === t);
}

function matchesSel(q) {
  const s = state.sel;
  if (!s) return true;
  const k = s.key === '__none' ? '' : s.key;
  return {ch: q.chapter, tp: q.topic, cn: q.concept, gp: q.group}[s.lvl] === k;
}
function searchText(q) {
  if (!q._search) q._search = Object.values(q.row).join('   ').toLowerCase();
  return q._search;
}
function filtered() {
  const M = state.model, term = state.q.toLowerCase();
  return M.questions.filter(q =>
    matchesSel(q) &&
    (!state.fType || q.kind === state.fType) &&
    (!state.fCat || str(q.row.question_category) === state.fCat) &&
    (!state.fDiff || str(q.row.level_of_difficulty) === state.fDiff) &&
    (!state.fGroupType || (M.groups.get(q.group)?.type || '') === state.fGroupType) &&
    (!term || searchText(q).includes(term) || q.label.toLowerCase().includes(term)));
}

function chip(cls, tag, text, lvl, key, missing) {
  return `<span class="chip ${cls}${missing ? ' missing' : ''}" data-lvl="${lvl}" data-key="${esc(key || '__none')}" title="${esc(key || 'not linked')}"><i>${tag}</i>${esc(text)}</span>`;
}

function cardHTML(q, idx) {
  const M = state.model, r = q.row;
  currentCtx = {label: q.label};
  const g = M.groups.get(q.group);
  const diff = str(r.level_of_difficulty);
  let h = `<article class="card" id="q-${esc(q.key)}"><div class="card-h">` +
    `<span class="qno">Q${idx + 1}</span><span class="qlabel" title="Click to copy">${esc(q.label)}</span><span class="spacer"></span>` +
    `<span class="badge type">${esc(q.kind)}</span>` +
    (str(r.question_category) ? `<span class="badge">${esc(r.question_category)}</span>` : '') +
    (diff ? `<span class="badge ${esc(diff)}">${esc(diff)}</span>` : '') +
    (str(r.cognitive_skills) ? `<span class="badge">${esc(r.cognitive_skills)}</span>` : '') +
    (str(r.marks) ? `<span class="badge marks">${fmtNum(r.marks)} mark${num(r.marks) === 1 ? '' : 's'}</span>` : '') +
    `</div><div class="path">` +
    chip('ch', 'Chapter', q.chapter ? label(M.chapters, q.chapter, 'chapter_display_name') : 'not linked', 'ch', q.chapter, !M.chapters.has(q.chapter)) +
    chip('tp', 'Topic', q.topic ? label(M.topics, q.topic, 'topic_display_name') : 'not linked', 'tp', q.topic, !M.topics.has(q.topic)) +
    chip('cn', 'Concept', q.concept ? label(M.concepts, q.concept, 'concept_display_name') : 'not linked', 'cn', q.concept, !M.concepts.has(q.concept)) +
    chip('gp', 'Group', q.group ? `${label(M.groups, q.group, 'group_display_name')}${g?.type ? ' · ' + g.type : ''}` : 'not in any group', 'gp', q.group, !g) +
    `</div><div class="card-b">`;

  // blanks map for $$a$$ placeholders
  const blanks = {};
  for (let n = 1; n <= 40; n++) if (str(r['placeholder_' + n])) blanks[str(r['placeholder_' + n]).toUpperCase()] = r['answer_' + n];

  const qStem = str(r.question), qText = str(r.question_text);
  if (qStem && qText && qStem !== qText) {
    h += blk('Question', `<div class="rich qtext">${rich(qStem, {blanks})}</div>`);
    h += blk('Question text', `<div class="rich qtext">${rich(qText, {blanks})}</div>`);
  } else if (qStem || qText) {
    h += blk('Question', `<div class="rich qtext">${rich(qStem || qText, {blanks})}</div>`);
  }
  if (str(r.question_disclaimer)) h += blk('Disclaimer', `<div class="rich">${rich(r.question_disclaimer)}</div>`);

  if (q.kind === 'Objective') {
    const opts = options(r);
    if (opts.length) h += blk('Options', `<ul class="opts">${opts.map((o, i) =>
      `<li class="${o.correct ? 'correct' : ''}"><span class="ol">${String.fromCharCode(97 + i)})</span><span class="rich">${answerHTML(o.content, o.type)}</span><span class="w">${esc(o.type)}${o.w !== '' ? ' · wt ' + fmtNum(o.w) : ''}</span></li>`).join('')}</ul>`);
  }

  if (str(r.display_answer)) h += blk('Answer to display', `<div class="rich ans">${rich(r.display_answer)}</div>`, 'ans-only');

  if (q.kind === 'Descriptive') {
    const cr = criteria(r, 'answer_type_', 'answer_weightage_', 'answer_content_');
    if (cr.length) h += blk('Marking criteria', critTable(cr), 'mark-only');
    for (let s = 1; s <= 15; s++) {
      if (!str(r['sub_question_' + s])) continue;
      const sc = criteria(r, `sq${s}_answer_type_`, `sq${s}_weightage_`, `sq${s}_keyword_`);
      h += `<div class="subq"><div class="subq-h"><b>Sub-question ${s}</b>${str(r['sub_question_marks_' + s]) ? `<span class="badge">${fmtNum(r['sub_question_marks_' + s])} marks</span>` : ''}</div>` +
           `<div class="rich">${rich(r['sub_question_' + s])}</div>` +
           (sc.length ? `<div class="mark-only" style="margin-top:8px">${critTable(sc)}</div>` : '') + `</div>`;
    }
  }
  if (q.kind === 'Subjective') {
    const acc = [];
    for (let n = 1; n <= 40; n++) if (str(r['answer_' + n])) acc.push({n, type: str(r['answer_type_' + n]), w: str(r['weightage_' + n]), content: r['answer_' + n], ph: str(r['placeholder_' + n]), disp: str(r['answer_display_' + n])});
    if (acc.length) h += blk('Accepted answers', `<table class="mk"><thead><tr><th>Blank</th><th>Answer</th><th>Type</th><th>Weightage</th><th>Display</th></tr></thead><tbody>${acc.map(a =>
      `<tr><td class="n">${esc(a.ph || a.n)}</td><td class="rich">${answerHTML(a.content, a.type)}</td><td class="n">${esc(a.type)}</td><td class="n">${fmtNum(a.w)}</td><td class="n">${esc(a.disp)}</td></tr>`).join('')}</tbody></table>`, 'ans-only');
  }
  if (q.kind !== 'Objective' && q.kind !== 'Descriptive' && q.kind !== 'Subjective') {
    const cr = criteria(r, 'answer_type_', 'answer_weightage_', 'answer_content_');
    if (cr.length) h += blk('Answers', critTable(cr), 'ans-only');
  }
  const expl = str(r.answer_explanation);
  if (expl && expl !== str(r.display_answer)) h += blk('Answer explanation', `<div class="rich expl">${rich(expl)}</div>`, 'ans-only');

  const meta = [['Cognitive skill', r.cognitive_skills], ['Source', r.question_source], ['Duration (min)', r.question_duration], ['Appears in', r.question_appears_in],
    ['Answer restriction', r.answer_restriction], ['Math keyboard', r.math_keyboard], ['Update?', r.is_update_question], ['Group description', g?.row.group_description],
    ['Sheet / row', `${q.sheet} · row ${q.rowNo}`]].filter(([, v]) => str(v));
  h += blk('Metadata', `<div class="meta">${meta.map(([k, v]) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join('')}</div>`, 'meta-only');
  h += blk('Raw cells', `<div class="raw">${Object.entries(r).filter(([k]) => k !== '__row').map(([k, v]) => `<b>${esc(k)}</b>: ${esc(v)}`).join('\n')}</div>`, 'raw-only');
  h += `</div></article>`;
  return h;
}
function blk(title, inner, cls = '') { return `<div class="blk ${cls}"><div class="lbl">${esc(title)}</div>${inner}</div>`; }
function critTable(cr) {
  return `<table class="mk"><thead><tr><th>#</th><th>Answer content</th><th>Answer type</th><th>Weightage</th></tr></thead><tbody>${cr.map(c =>
    `<tr><td class="n">${c.n}</td><td class="rich">${answerHTML(c.content, c.type)}</td><td class="n">${esc(c.type)}</td><td class="n">${fmtNum(c.w)}</td></tr>`).join('')}</tbody></table>`;
}

function conceptHeader(q) {
  const M = state.model, c = M.concepts.get(q.concept);
  currentCtx = {label: 'concept ' + q.concept};
  const det = c && str(c.row.concept_details);
  const kw = c && str(c.row.keywords);
  return `<div class="sec-h"><div class="crumbs">${esc(q.chapter ? label(M.chapters, q.chapter, 'chapter_display_name') : 'No chapter')} › ${esc(q.topic ? label(M.topics, q.topic, 'topic_display_name') : 'No topic')}</div>` +
    `<h3>${esc(q.concept ? label(M.concepts, q.concept, 'concept_display_name') : 'Questions not linked to a concept')}</h3>` +
    (det || kw ? `<details><summary>Concept details</summary><div class="concept-body rich">${kw ? `<p><b>Keywords:</b> ${esc(kw)}</p>` : ''}${det ? rich(det) : ''}</div></details>` : '') + `</div>`;
}

function renderList() {
  const list = filtered();
  const shown = list.slice(0, state.limit);
  let html = '', lastSec = null;
  shown.forEach((q, i) => {
    const sec = q.chapter + '|' + q.topic + '|' + q.concept;
    if (sec !== lastSec) { html += conceptHeader(q); lastSec = sec; }
    html += cardHTML(q, i);
  });
  if (!list.length) html = `<div class="empty">No questions match these filters.</div>`;
  if (list.length > shown.length) html += `<button class="btn ghost more" id="moreBtn" type="button">Show ${Math.min(60, list.length - shown.length)} more (${list.length - shown.length} hidden)</button>`;
  $('#list').innerHTML = html;
  const M = state.model;
  const marks = list.reduce((s, q) => s + (num(q.row.marks) || 0), 0);
  const byKind = {};
  list.forEach(q => byKind[q.kind] = (byKind[q.kind] || 0) + 1);
  $('#summary').innerHTML = `<span><b>${list.length}</b> of ${M.questions.length} questions</span><span><b>${fmtNum(marks)}</b> marks</span>` +
    Object.entries(byKind).map(([k, v]) => `<span>${esc(k)}: <b>${v}</b></span>`).join('') +
    `<span>${M.chapters.size} chapter · ${M.topics.size} topics · ${M.concepts.size} concepts · ${M.groups.size} groups</span>` +
    (state.sel ? `<span>Filtered by ${{ch: 'chapter', tp: 'topic', cn: 'concept', gp: 'group'}[state.sel.lvl]} — <button class="link" id="clearSel" type="button">clear</button></span>` : '');
  renderIssues();
}

function renderIssues() {
  const all = [...state.model.issues, ...katexIssues.map(k => ({type: 'LaTeX error', text: `${k.label}: ${k.msg} — ${k.tex}`}))];
  const uniq = [...new Map(all.map(i => [i.type + i.text, i])).values()];
  const el = $('#issues');
  if (!uniq.length) { el.hidden = true; return; }
  const byType = {};
  uniq.forEach(i => (byType[i.type] ||= []).push(i.text));
  el.hidden = false;
  el.innerHTML = `<details><summary>⚠ ${uniq.length} data check${uniq.length > 1 ? 's' : ''} to review (${Object.entries(byType).map(([k, v]) => `${k}: ${v.length}`).join(' · ')})</summary><ul>` +
    uniq.map(i => `<li><b>${esc(i.type)}</b> — ${esc(i.text)}</li>`).join('') + `</ul></details>`;
}

function fillSelect(id, values, allLabel) {
  const sel = $(id);
  sel.innerHTML = `<option value="">${allLabel}</option>` + [...values].filter(Boolean).sort(natural).map(v => `<option>${esc(v)}</option>`).join('');
}

function applyToggles() {
  const L = $('#list');
  L.classList.toggle('show-ans', $('#tAns').checked); L.classList.toggle('hide-ans', !$('#tAns').checked);
  L.classList.toggle('hide-mark', !$('#tMark').checked);
  L.classList.toggle('hide-meta', !$('#tMeta').checked);
  L.classList.toggle('hide-raw', !$('#tRaw').checked);
}

function rerender(resetLimit = true) {
  if (resetLimit) state.limit = 60;
  katexIssues = [];
  renderList();
}

/* ---------------- loading ---------------- */
async function loadFiles(files) {
  showLoading(true);
  try {
    const sheets = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, {type: 'array', cellDates: false, cellFormula: false});
      sheets.push(...parseSheets(wb, f.name));
    }
    start(sheets, files.map(f => f.name).join(', '));
  } catch (e) { fail(e); }
  finally { showLoading(false); }
}
async function loadLink(url) {
  const id = (str(url).match(/\/spreadsheets\/d\/([\w-]{20,})/) || [])[1];
  if (!id) return fail(new Error('That does not look like a Google Sheets link.'));
  showLoading(true);
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {credentials: 'omit'});
    if (!res.ok) throw new Error(`Google returned ${res.status}.`);
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 2));
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error('Google did not return a spreadsheet.');
    const wb = XLSX.read(buf, {type: 'array'});
    start(parseSheets(wb, 'Google Sheet ' + id), 'Google Sheet ' + id);
    try { history.replaceState(null, '', '#sheet=' + id); } catch (_) {}
  } catch (e) {
    fail(new Error(`${e.message}\nThe sheet could not be fetched directly. Either share it as "Anyone with the link – Viewer", or download it (File → Download → Microsoft Excel) and upload the file.`));
  } finally { showLoading(false); }
}
function start(sheets, name) {
  if (!sheets.length) throw new Error('No sheet with a question_label / chapter_title header row was found in this file.');
  state.sheets = sheets;
  state.model = buildModel(sheets);
  state.sel = null;
  if (!state.model.questions.length) throw new Error('The file was read, but no question rows (question_label column) were found.');
  $('#fileInfo').textContent = `${name} — tabs: ${sheets.map(s => `${s.name} (${s.rows.length})`).join(', ')}`;
  document.title = name + ' · Question Bank Viewer';
  const Q = state.model.questions;
  fillSelect('#fType', new Set(Q.map(q => q.kind)), 'All sheets');
  fillSelect('#fCat', new Set(Q.map(q => str(q.row.question_category))), 'All categories');
  fillSelect('#fDiff', new Set(Q.map(q => str(q.row.level_of_difficulty))), 'All difficulty');
  fillSelect('#fGroupType', new Set([...state.model.groups.values()].map(g => g.type)), 'All group levels');
  Object.assign(state, {q: '', fType: '', fCat: '', fDiff: '', fGroupType: ''});
  $('#search').value = '';
  $('#landing').hidden = true; $('#viewer').hidden = false; $('#loadErr').textContent = '';
  renderTree(); applyToggles(); rerender();
  window.scrollTo(0, 0);
}
function fail(e) {
  console.error(e);
  $('#landing').hidden = false; $('#viewer').hidden = true;
  $('#loadErr').textContent = e.message || String(e);
}
function showLoading(on) {
  let el = document.getElementById('loadingOverlay');
  if (on && !el) { el = document.createElement('div'); el.id = 'loadingOverlay'; el.className = 'loading'; el.textContent = 'Reading sheet…'; document.body.appendChild(el); }
  if (!on && el) el.remove();
}

/* ---------------- events ---------------- */
$('#fileInput').addEventListener('change', e => { const f = [...e.target.files]; if (f.length) loadFiles(f); e.target.value = ''; });
const dz = $('#dropZone');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('over'); }));
document.addEventListener('drop', e => { const f = [...(e.dataTransfer?.files || [])]; if (f.length) loadFiles(f); });
$('#linkForm').addEventListener('submit', e => { e.preventDefault(); loadLink($('#linkInput').value); });
$('#linkBtn').addEventListener('click', () => { const u = prompt('Paste the Google Sheets link (it must be shared as "Anyone with the link"):'); if (u) loadLink(u); });
$('#themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('qv-theme', root.dataset.theme); } catch (_) {}
});
try { const t = localStorage.getItem('qv-theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) {}

let searchT;
$('#search').addEventListener('input', e => { clearTimeout(searchT); searchT = setTimeout(() => { state.q = e.target.value.trim(); rerender(); }, 180); });
[['#fType', 'fType'], ['#fCat', 'fCat'], ['#fDiff', 'fDiff'], ['#fGroupType', 'fGroupType']].forEach(([id, k]) =>
  $(id).addEventListener('change', e => { state[k] = e.target.value; rerender(); }));
['#tAns', '#tMark', '#tMeta', '#tRaw'].forEach(id => $(id).addEventListener('change', applyToggles));

function select(lvl, key) {
  state.sel = (state.sel && state.sel.lvl === lvl && state.sel.key === key) ? null : {lvl, key};
  renderTree(); rerender();
  document.querySelector('.content').scrollIntoView({block: 'start'});
}
$('#tree').addEventListener('click', e => {
  const s = e.target.closest('summary'); if (!s) return;
  if (e.target.closest('.caret')) return; // caret only expands/collapses
  e.preventDefault();
  select(s.dataset.lvl, s.dataset.key);
});
$('#clearTree').addEventListener('click', () => { state.sel = null; renderTree(); rerender(); });
document.addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (c) { select(c.dataset.lvl, c.dataset.key); return; }
  if (e.target.id === 'clearSel') { state.sel = null; renderTree(); rerender(); return; }
  if (e.target.id === 'moreBtn') { state.limit += 60; katexIssues = []; renderList(); return; }
  const ql = e.target.closest('.qlabel');
  if (ql) { navigator.clipboard?.writeText(ql.textContent); ql.style.color = 'var(--ok)'; setTimeout(() => ql.style.color = '', 700); return; }
  const img = e.target.closest('.fig img');
  if (img) { const lb = $('#lightbox'); lb.querySelector('img').src = img.src; lb.querySelector('p').textContent = img.alt; lb.hidden = false; return; }
  if (e.target.closest('#lightbox')) $('#lightbox').hidden = true;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#lightbox').hidden = true; });
// image fallbacks (Drive links etc.)
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.fig')) return;
  const fb = (img.dataset.fallbacks || '').split(' ').filter(Boolean);
  if (fb.length) { img.dataset.fallbacks = fb.slice(1).join(' '); img.src = fb[0]; return; }
  const fig = img.closest('.fig');
  fig.classList.add('broken');
  const orig = img.dataset.orig;
  img.replaceWith(Object.assign(document.createElement('div'), {className: 'imgerr', innerHTML:
    `Image could not be loaded${/drive\.google/.test(orig) ? ' (Drive files must be shared as "Anyone with the link")' : ''}.<br><a href="${esc(orig)}" target="_blank" rel="noopener">Open image link ↗</a>`}));
}, true);

// keep sticky offsets in sync with the header height
const setTb = () => document.documentElement.style.setProperty('--tb', $('.topbar').offsetHeight + 'px');
new ResizeObserver(setTb).observe($('.topbar')); setTb();

// expose for testing
window.QV = {parseSheets, buildModel, rich, answerHTML, loadFiles, state};
})();
