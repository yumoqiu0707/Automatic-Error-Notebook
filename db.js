/**
 * 数据层：错题集持久化
 *
 * 设计要点：
 *   - 单文件数据库 data/db.json，原子写入（先写 .tmp 再 rename），避免写坏
 *   - 每次落盘顺带打一份当日备份到 data/backups/，保留最近 30 天
 *   - 错题按「题干指纹」去重：同一道题再次做错只累加 wrong_count，不新增条目
 *   - 同类型题的锁定答案仍留在 records 里，错题条目只保存原题信息
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { APP_ROOT } = require('./paths');

const DATA_DIR = path.join(APP_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const LEGACY_RECORDS = path.join(DATA_DIR, 'records.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;

const MASTERY_LEVELS = ['待批改', '未掌握', '基本掌握', '掌握'];

let db = null;
let saveTimer = null;
let lastBackupDay = null;

/* ================================================================== */
/* 基础工具                                                            */
/* ================================================================== */

/** 归一化文本，用于题干指纹 */
function normalizeText(s) {
  return String(s === null || s === undefined ? '' : s)
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\s$\\{}_^~]/g, '')
    .replace(/[，。、；：？！,.;:?!（）()【】\[\]“”"'’‘`]/g, '');
}

/** 题干指纹 → 错题 ID（同题同 ID，天然去重） */
function stemKey(stem) {
  return 'mk_' + crypto.createHash('sha1').update(normalizeText(stem)).digest('hex').slice(0, 12);
}

function nowISO() { return new Date().toISOString(); }

/** ISO 时间 → 本地时间字符串（导出用，避免显示成 UTC） */
function fmtLocal(iso, withTime) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = n => String(n).padStart(2, '0');
  const date = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  return withTime === false ? date : date + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function dayStr(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

/* ================================================================== */
/* 读写                                                                */
/* ================================================================== */

function emptyDb() {
  return { version: 1, created_at: nowISO(), updated_at: nowISO(), records: {}, mistakes: {} };
}

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!db.records) db.records = {};
    if (!db.mistakes) db.mistakes = {};
  } catch (e) {
    db = emptyDb();
    /* 兼容早期版本：把 data/records.json 迁移进来 */
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_RECORDS, 'utf8'));
      let n = 0;
      Object.keys(legacy).forEach(id => {
        const rec = legacy[id];
        db.records[id] = rec;
        if (rec.user_visible && Array.isArray(rec.user_visible.mistakes)) {
          addMistakesFromRecord(rec, rec.user_visible.mistakes, { silent: true });
        }
        n++;
      });
      if (n) {
        console.log('[db] 已从 records.json 迁移 ' + n + ' 条记录');
        saveNow();
      }
    } catch (e2) { /* 没有旧数据，忽略 */ }
  }
  return db;
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeBackup() {
  try {
    const day = dayStr();
    if (lastBackupDay === day) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, 'db-' + day + '.json');
    if (!fs.existsSync(target)) {
      atomicWrite(target, JSON.stringify(db, null, 2));
      console.log('[db] 已生成当日备份 ' + path.basename(target));
    }
    lastBackupDay = day;
    /* 清理超出保留期的备份 */
    const files = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) {
    console.error('[db] 备份失败：' + e.message);
  }
}

function saveNow() {
  if (!db) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db.updated_at = nowISO();
    writeBackup();
    atomicWrite(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('[db] 落盘失败：' + e.message);
  }
}

/** 防抖落盘：连续写入只落一次盘，但最多延迟 400ms */
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 400);
}

/** 进程退出前强制落盘 */
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveNow();
}

/* ================================================================== */
/* 错题条目                                                            */
/* ================================================================== */

const MISTAKE_FIELDS = [
  'subject', 'grade', 'difficulty', 'question_type', 'topic_path',
  'question', 'user_answer', 'correct_answer', 'answer_explanation',
  'error_analysis', 'knowledge_review', 'similar_questions'
];

function pickMistakeFields(mk) {
  const out = {};
  MISTAKE_FIELDS.forEach(k => { if (mk[k] !== undefined) out[k] = mk[k]; });
  /* similar_questions 只保留题干与选项，答案本来就不在 user_visible 里 */
  if (Array.isArray(out.similar_questions)) {
    out.similar_questions = out.similar_questions.map(q => ({
      question_id: q.question_id, stem: q.stem, options: q.options || [],
      answer_locked: true, submit_required: true
    }));
  }
  return out;
}

/**
 * 把阶段一识别出的错题写入错题集。
 * 同一题干再次出现 → 合并，wrong_count +1，并记录一次 occurrence。
 */
function addMistakesFromRecord(rec, mistakes, opts) {
  load();
  const silent = opts && opts.silent;
  const added = [];
  const at = rec.created_at || nowISO();

  (mistakes || []).forEach(mk => {
    if (!mk || !mk.question || !mk.question.stem) return;
    const id = stemKey(mk.question.stem);
    const fields = pickMistakeFields(mk);

    if (db.mistakes[id]) {
      const ex = db.mistakes[id];
      Object.assign(ex, fields);
      ex.record_id = rec.id;
      ex.updated_at = at;
      ex.wrong_count = (ex.wrong_count || 1) + 1;
      ex.occurrences = ex.occurrences || [];
      ex.occurrences.push({ at: at, record_id: rec.id, my_answer: mk.user_answer });
      added.push({ id: id, merged: true, stem: mk.question.stem });
    } else {
      db.mistakes[id] = Object.assign({
        id: id,
        created_at: at,
        updated_at: at,
        record_id: rec.id,
        source: rec.source || 'auto',
        img_hash: rec.img_hash || null,
        wrong_count: 1,
        occurrences: [{ at: at, record_id: rec.id, my_answer: mk.user_answer }],
        mastery: '待批改',
        review_count: 0,
        last_review_at: null,
        starred: false,
        tags: [],
        note: '',
        similar_attempts: {},
        grading_history: []
      }, fields);
      added.push({ id: id, merged: false, stem: mk.question.stem });
    }
  });

  if (!silent) scheduleSave();
  return added;
}

/**
 * 把阶段二批改结果回写到对应错题条目（按 mistake_id 反查题干指纹）
 */
function applyGrading(rec, gradingResults) {
  load();
  if (!rec || !rec.user_visible || !Array.isArray(rec.user_visible.mistakes)) return [];
  const map = {};
  rec.user_visible.mistakes.forEach(mk => {
    if (mk && mk.question && mk.question.stem) map[mk.mistake_id] = stemKey(mk.question.stem);
  });

  const touched = [];
  const at = nowISO();
  const byMistake = {};

  (gradingResults || []).forEach(r => {
    const id = map[r.mistake_id];
    if (!id || !db.mistakes[id]) return;
    const m = db.mistakes[id];
    m.similar_attempts = m.similar_attempts || {};
    m.similar_attempts[r.question_id] = {
      answer: r.submitted_answer,
      is_correct: r.is_correct === true,
      score: r.score,
      mastery: r.mastery || '',
      at: at
    };
    (byMistake[r.mistake_id] = byMistake[r.mistake_id] || []).push(r);
    touched.push(id);
  });

  Object.keys(byMistake).forEach(mid => {
    const id = map[mid];
    if (!id || !db.mistakes[id]) return;
    const m = db.mistakes[id];
    const list = byMistake[mid];
    const correct = list.filter(x => x.is_correct === true).length;
    const total = list.length;
    m.review_count = (m.review_count || 0) + 1;
    m.last_review_at = at;
    m.updated_at = at;
    m.mastery = masteryFromRate(correct, total, list);
    m.grading_history = m.grading_history || [];
    m.grading_history.push({
      at: at, record_id: rec.id, total: total, correct: correct,
      accuracy: total ? Math.round(correct / total * 100) + '%' : '0%'
    });
  });

  scheduleSave();
  return Array.from(new Set(touched));
}

function masteryFromRate(correct, total, list) {
  if (!total) return '待批改';
  const rate = correct / total;
  if (rate >= 1) return '掌握';
  if (rate >= 0.5) return '基本掌握';
  return '未掌握';
}

/* ================================================================== */
/* 查询 / 统计 / 导出                                                   */
/* ================================================================== */

function allMistakes() {
  load();
  return Object.keys(db.mistakes).map(k => db.mistakes[k]);
}

function listMistakes(f) {
  load();
  f = f || {};
  let items = allMistakes();

  if (f.q) {
    const kw = String(f.q).toLowerCase();
    items = items.filter(m =>
      (m.question && m.question.stem || '').toLowerCase().indexOf(kw) > -1 ||
      (m.correct_answer || '').toLowerCase().indexOf(kw) > -1 ||
      (m.note || '').toLowerCase().indexOf(kw) > -1 ||
      (m.tags || []).join(',').toLowerCase().indexOf(kw) > -1 ||
      (m.topic_path || []).join('/').toLowerCase().indexOf(kw) > -1);
  }
  if (f.subject) items = items.filter(m => m.subject === f.subject);
  if (f.mastery) items = items.filter(m => m.mastery === f.mastery);
  if (f.topic) items = items.filter(m => (m.topic_path || []).join('/').indexOf(f.topic) > -1);
  if (f.tag) items = items.filter(m => (m.tags || []).indexOf(f.tag) > -1);
  if (f.starred === true || f.starred === 'true') items = items.filter(m => m.starred === true);
  if (f.from) items = items.filter(m => (m.created_at || '') >= f.from);
  if (f.to) items = items.filter(m => (m.created_at || '') <= f.to + '\uffff');

  const sort = f.sort || 'created_desc';
  const cmp = {
    created_desc: (a, b) => (b.created_at || '').localeCompare(a.created_at || ''),
    created_asc: (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
    wrong_desc: (a, b) => (b.wrong_count || 0) - (a.wrong_count || 0),
    updated_desc: (a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')
  }[sort] || ((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  items.sort(cmp);

  const total = items.length;
  const offset = Number(f.offset || 0);
  const limit = f.limit ? Number(f.limit) : 0;
  if (limit > 0) items = items.slice(offset, offset + limit);

  return {
    total: total,
    items: items,
    facets: {
      subjects: uniq(allMistakes().map(m => m.subject).filter(Boolean)).sort(),
      mastery: MASTERY_LEVELS.map(l => ({ level: l, count: allMistakes().filter(m => m.mastery === l).length })),
      topics: topN(allMistakes().flatMap(m => (m.topic_path || []).slice(-1)).filter(Boolean), 12),
      tags: uniq(allMistakes().flatMap(m => m.tags || [])).sort()
    }
  };
}

function uniq(a) { return Array.from(new Set(a)); }
function topN(a, n) {
  const c = {};
  a.forEach(x => c[x] = (c[x] || 0) + 1);
  return Object.keys(c).sort((x, y) => c[y] - c[x]).slice(0, n).map(k => ({ name: k, count: c[k] }));
}

/** 是否属于「待复习」：未掌握 / 基本掌握 / 待批改，且距上次复习超过 3 天 */
const REVIEW_INTERVAL_DAYS = 3;
function isDue(m) {
  if (!m || m.mastery === '掌握') return false;
  if (!m.last_review_at) return true;
  return Date.now() - new Date(m.last_review_at).getTime() > REVIEW_INTERVAL_DAYS * 86400000;
}

/**
 * 按科目汇总：每个科目下有多少题、待复习多少、掌握分布、涉及的知识点。
 * 这是「错题集」的一级分类，题目都挂在对应科目下。
 */
function subjectsSummary() {
  load();
  const items = allMistakes();
  const groups = {};

  items.forEach(m => {
    const name = (m.subject && String(m.subject).trim()) || '未分类';
    const g = groups[name] = groups[name] || {
      name: name, total: 0, due_review: 0, starred: 0, wrong_multiple: 0,
      mastery: {}, topics: {}, last_added_at: null, last_review_at: null
    };
    g.total++;
    if (isDue(m)) g.due_review++;
    if (m.starred) g.starred++;
    if ((m.wrong_count || 1) > 1) g.wrong_multiple++;
    const lv = m.mastery || '待批改';
    g.mastery[lv] = (g.mastery[lv] || 0) + 1;
    const t = (m.topic_path || []).slice(-1)[0] || '未归类';
    g.topics[t] = (g.topics[t] || 0) + 1;
    if (!g.last_added_at || (m.created_at || '') > g.last_added_at) g.last_added_at = m.created_at;
    if (m.last_review_at && (!g.last_review_at || m.last_review_at > g.last_review_at)) g.last_review_at = m.last_review_at;
  });

  const list = Object.keys(groups).map(name => {
    const g = groups[name];
    const mastered = g.mastery['掌握'] || 0;
    const partial = g.mastery['基本掌握'] || 0;
    return {
      name: g.name,
      total: g.total,
      due_review: g.due_review,
      starred: g.starred,
      wrong_multiple: g.wrong_multiple,
      mastery: MASTERY_LEVELS.map(l => ({ level: l, count: g.mastery[l] || 0 })),
      mastered: mastered,
      progress: g.total ? Math.round((mastered + partial * 0.5) / g.total * 100) : 0,
      topics: Object.keys(g.topics).sort((a, b) => g.topics[b] - g.topics[a]).map(k => ({ name: k, count: g.topics[k] })),
      last_added_at: g.last_added_at,
      last_review_at: g.last_review_at
    };
  });

  /* 未分类永远排最后，其余按题量从多到少 */
  list.sort((a, b) => {
    if (a.name === '未分类') return 1;
    if (b.name === '未分类') return -1;
    return b.total - a.total;
  });

  return { subjects: list, total: items.length };
}

function stats() {
  const items = allMistakes();
  const now = Date.now();
  const DAY = 86400000;
  const due = items.filter(isDue);
  return {
    total: items.length,
    starred: items.filter(m => m.starred).length,
    subjects: uniq(items.map(m => (m.subject && String(m.subject).trim()) || '未分类')).length,
    by_subject: topN(items.map(m => (m.subject && String(m.subject).trim()) || '未分类'), 20),
    by_mastery: MASTERY_LEVELS.map(l => ({ level: l, count: items.filter(m => m.mastery === l).length })),
    top_topics: topN(items.flatMap(m => (m.topic_path || []).slice(-1)).filter(Boolean), 10),
    due_review: due.length,
    added_7d: items.filter(m => now - new Date(m.created_at).getTime() < 7 * DAY).length,
    wrong_multiple: items.filter(m => (m.wrong_count || 1) > 1).length,
    last_saved_at: db ? db.updated_at : null
  };
}

function getMistake(id) {
  load();
  return db.mistakes[id] || null;
}

function updateMistake(id, patch) {
  load();
  const m = db.mistakes[id];
  if (!m) return null;
  const allow = ['mastery', 'starred', 'tags', 'note'];
  allow.forEach(k => { if (patch[k] !== undefined) m[k] = patch[k]; });
  if (Array.isArray(m.tags)) m.tags = uniq(m.tags.map(t => String(t).trim()).filter(Boolean));
  m.updated_at = nowISO();
  scheduleSave();
  return m;
}

function deleteMistake(id) {
  load();
  if (!db.mistakes[id]) return false;
  delete db.mistakes[id];
  scheduleSave();
  return true;
}

/* ---------------- 导出 ---------------- */

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return '"' + s.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
}

function exportCsv(items) {
  const head = ['添加时间', '最近复习', '学科', '年级', '难度', '题型', '知识点', '题干', '我的作答',
    '正确答案', '解析', '错因类型', '错误步骤', '掌握程度', '错题次数', '复习次数', '标签', '笔记'];
  const rows = items.map(m => [
    fmtLocal(m.created_at),
    fmtLocal(m.last_review_at),
    m.subject || '', m.grade || '', m.difficulty || '', m.question_type || '',
    (m.topic_path || []).join(' / '),
    (m.question && m.question.stem) || '',
    m.user_answer === null || m.user_answer === undefined ? '未识别到作答' : m.user_answer,
    m.correct_answer || '',
    m.answer_explanation || '',
    (m.error_analysis && m.error_analysis.error_type) || '',
    (m.error_analysis && m.error_analysis.where_wrong) || '',
    m.mastery || '', m.wrong_count || 1, m.review_count || 0,
    (m.tags || []).join('、'), m.note || ''
  ]);
  return '\ufeff' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
}

function exportMarkdown(items) {
  const groups = {};
  items.forEach(m => {
    const key = (m.subject || '未分类') + ' · ' + ((m.topic_path || []).slice(-1)[0] || '未归类');
    (groups[key] = groups[key] || []).push(m);
  });

  let out = '# 我的错题集\n\n';
  out += '> 导出时间：' + new Date().toLocaleString('zh-CN') + '　共 ' + items.length + ' 道题\n\n';

  Object.keys(groups).sort().forEach(g => {
    out += '## ' + g + '\n\n';
    groups[g].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    groups[g].forEach((m, i) => {
      out += '### ' + (i + 1) + '. ' + ((m.question && m.question.stem) || '').replace(/\n/g, ' ') + '\n\n';
      out += '| 项目 | 内容 |\n|---|---|\n';
      out += '| 学科 / 年级 | ' + (m.subject || '—') + ' / ' + (m.grade || '—') + ' |\n';
      out += '| 题型 / 难度 | ' + (m.question_type || '—') + ' / ' + (m.difficulty || '—') + ' |\n';
      out += '| 添加时间 | ' + (fmtLocal(m.created_at) || '—') + ' |\n';
      out += '| 我的作答 | ' + (m.user_answer === null || m.user_answer === undefined ? '未识别到作答' : m.user_answer) + ' |\n';
      out += '| 正确答案 | ' + (m.correct_answer || '—') + ' |\n';
      out += '| 掌握程度 | ' + (m.mastery || '待批改') + '　（错 ' + (m.wrong_count || 1) + ' 次 / 复习 ' + (m.review_count || 0) + ' 次） |\n';
      out += '\n**解析**\n\n' + (m.answer_explanation || '—') + '\n\n';
      if (m.error_analysis) {
        out += '**错因分析**\n\n';
        out += '- 错误步骤：' + (m.error_analysis.where_wrong || '—') + '\n';
        out += '- 错误类型：' + (m.error_analysis.error_type || '—') + '\n';
        out += '- 根本原因：' + (m.error_analysis.root_cause || '—') + '\n';
        if ((m.error_analysis.knowledge_gap || []).length) {
          out += '- 知识缺口：' + m.error_analysis.knowledge_gap.join('；') + '\n';
        }
        out += '\n';
      }
      const kr = m.knowledge_review;
      if (kr) {
        out += '**知识点复习**\n\n';
        if (kr.definition) out += (kr.definition) + '\n\n';
        if ((kr.formulas || []).length) out += '- 核心公式：' + kr.formulas.join('；') + '\n';
        if ((kr.conditions || []).length) out += '- 适用条件：' + kr.conditions.join('；') + '\n';
        if ((kr.steps || []).length) out += '- 解题步骤：' + kr.steps.join(' → ') + '\n';
        if ((kr.common_mistakes || []).length) out += '- 高频易错：' + kr.common_mistakes.join('；') + '\n';
        if (kr.method_summary) out += '- 方法总结：' + kr.method_summary + '\n';
        out += '\n';
      }
      if ((m.tags || []).length) out += '标签：' + m.tags.join('、') + '\n\n';
      if (m.note) out += '我的笔记：' + m.note + '\n\n';
      out += '---\n\n';
    });
  });
  return out;
}

function exportJson() {
  load();
  return JSON.stringify({ exported_at: nowISO(), ...db }, null, 2);
}

module.exports = {
  load, saveNow, scheduleSave, flush,
  addMistakesFromRecord, applyGrading,
  listMistakes, stats, subjectsSummary, isDue, getMistake, updateMistake, deleteMistake,
  exportCsv, exportMarkdown, exportJson, stemKey, allMistakes,
  DB_PATH, BACKUP_DIR
};
