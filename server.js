/**
 * 错题集生成与知识点拓展助手 · 本地后端
 *
 * 零依赖 Node 服务，实现交付版规范里的后端硬规则：
 *   - 真实调用 OpenAI 兼容接口（支持视觉模型）
 *   - user_visible / server_only 强隔离：locked_solutions 只存服务端，绝不返回前端
 *   - 返回 JSON Schema 校验，失败重试一次，仍失败返回业务异常
 *   - 同一图片按 img_hash 缓存，避免重复消耗 token
 *   - 阶段二只读取服务端存储的 locked_solutions，禁止重算
 *   - 越权校验：submitted_answers 的 ID 必须存在于 locked_solutions
 *   - 泄漏检测：user_visible 中若出现锁定答案，直接标红告警
 *
 * 启动：node server.js   （默认 http://127.0.0.1:5178）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { buildInitialMessages, buildGradeMessages, SYSTEM_PROMPT } = require('./system-prompt');
const DB = require('./db');
const QR = require('./qr');
const { APP_ROOT, IS_SEA } = require('./paths');

const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const CONFIG_PATH = path.join(APP_ROOT, 'config.json');
const PORT = Number(process.env.PORT || 5178);

/* 资源缺失时给出人话提示，而不是一堆 ENOENT */
if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  console.error('');
  console.error('  [错误] 找不到前端资源目录 public/');
  console.error('  期望位置：' + PUBLIC_DIR);
  console.error('');
  console.error('  如果是打包版 exe，请确保 public 文件夹和 exe 放在同一目录下。');
  console.error('');
  process.exit(1);
}

/* ================================================================== */
/* 配置                                                                */
/* ================================================================== */

const DEFAULT_CONFIG = {
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o-mini',
  vision: true,
  temperature: 0.2,
  top_p: 0.8,
  use_json_mode: true,
  /* 监听地址：0.0.0.0 允许同一 Wi-Fi 下的手机访问；改成 127.0.0.1 则只允许本机 */
  host: '0.0.0.0'
};

function readConfig() {
  try {
    return Object.assign({}, DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (e) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function writeConfig(patch) {
  const next = Object.assign(readConfig(), patch || {});
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function isConfigured(cfg) {
  return Boolean(cfg.api_key && cfg.base_url && cfg.model);
}

/* 监听地址：默认 0.0.0.0 让同一 Wi-Fi 下的手机能访问；
   可在 config.json 里把 "host" 改成 "127.0.0.1" 限制为本机。 */
const HOST = process.env.HOST || readConfig().host || '0.0.0.0';

/* ================================================================== */
/* 访问口令（把网址分享到公网时必开）                                    */
/* ================================================================== */
/*
 * 设置环境变量 ACCESS_CODE 后，任何人访问都必须带上正确口令，否则拿不到页面、
 * 也调不动接口 —— 防止别人拿到网址后白嫖你的 API 额度。
 *
 *   本机自用：不用管，留空就是和以前一样。
 *   分享给朋友：set ACCESS_CODE=123456 再启动，把链接发成
 *              https://你的域名/?code=123456   朋友点开即用，只需进一次。
 *
 * 校验通过后会种一个 HttpOnly Cookie，之后直接访问域名也能进，不用每次带 code。
 */
const ACCESS_CODE = (process.env.ACCESS_CODE || readConfig().access_code || '').trim();

/* 公网地址（可选）。用内网穿透分享时填进来，启动横幅和二维码会直接用它。 */
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

const GATE_COOKIE = 'ctj_access';

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function gateCookieValue() {
  /* Cookie 里存的是口令的哈希，不存明文口令 */
  return crypto.createHash('sha256').update('ctj:' + ACCESS_CODE).digest('hex').slice(0, 32);
}

/* 返回 true 表示放行 */
function checkAccess(req, res, urlPath) {
  if (!ACCESS_CODE) return true;

  const cookies = parseCookies(req);
  if (cookies[GATE_COOKIE] === gateCookieValue()) return true;

  /* 查询串里带正确口令 → 种 Cookie 后放行 */
  const qs = new URL(req.url || '/', 'http://x').searchParams;
  if (qs.get('code') === ACCESS_CODE) {
    res.setHeader('Set-Cookie',
      GATE_COOKIE + '=' + gateCookieValue() + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (180 * 86400));
    return true;
  }

  if (urlPath.startsWith('/api/')) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'ACCESS_CODE_REQUIRED', message: '需要访问口令' }));
  } else {
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(GATE_PAGE);
  }
  return false;
}

const GATE_PAGE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>需要访问口令</title><style>' +
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
  'background:#f6f7fb;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}' +
  '.box{background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(20,30,60,.10);' +
  'padding:32px 30px;max-width:360px;width:calc(100% - 40px);text-align:center}' +
  'h1{margin:0 0 8px;font-size:19px}p{margin:0 0 20px;color:#6a7381;font-size:13px}' +
  'input{width:100%;padding:12px 14px;font-size:16px;border:1px solid #d8dee8;border-radius:9px;' +
  'outline:none;box-sizing:border-box}input:focus{border-color:#5b7cfa}' +
  'button{margin-top:12px;width:100%;padding:12px;font-size:15px;color:#fff;background:#5b7cfa;' +
  'border:0;border-radius:9px;cursor:pointer}button:hover{background:#4a6ae8}' +
  '.err{margin-top:12px;color:#d4380d;font-size:13px;min-height:18px}' +
  '</style></head><body><div class="box">' +
  '<h1>错题集助手</h1><p>请输入访问口令</p>' +
  '<form method="get"><input name="code" type="password" placeholder="访问口令" autofocus>' +
  '<button type="submit">进入</button></form>' +
  '<div class="err" id="e"></div></div>' +
  '<script>if(location.search.indexOf("code=")>-1){document.getElementById("e").textContent="口令不对，再试一次";}</script>' +
  '</body></html>';

/* ================================================================== */
/* 记录存储（模拟数据库：server_only 只存在这里）                        */
/* ================================================================== */

const DB_DATA = DB.load();
const records = DB_DATA.records;   // record_id -> { user_visible, server_only, grading }

function persist() { DB.scheduleSave(); }

function newRecordId() {
  return 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ================================================================== */
/* 局域网地址（手机访问用）                                             */
/* ================================================================== */

function isPrivate(ip) {
  return /^192\.168\./.test(ip) || /^10\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** 列出本机可被手机访问的局域网 IPv4 地址，私有网段优先 */
function lanAddresses() {
  const found = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(info => {
      if (info.family !== 'IPv4' || info.internal) return;
      if (/^169\.254\./.test(info.address)) return;   // 链路本地地址，没用
      found.push({ iface: name, address: info.address, priv: isPrivate(info.address) });
    });
  });
  found.sort((a, b) => (b.priv ? 1 : 0) - (a.priv ? 1 : 0));
  return found;
}

function lanUrls() {
  return lanAddresses().map(x => 'http://' + x.address + ':' + PORT);
}

/* ================================================================== */
/* 模型调用                                                            */
/* ================================================================== */

function stripFences(s) {
  let t = String(s || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a > -1 && b > a) t = t.slice(a, b + 1);
  return t.trim();
}

async function callModel(messages, cfg, { jsonMode = true } = {}) {
  const url = String(cfg.base_url).replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature != null ? cfg.temperature : 0.2,
    top_p: cfg.top_p != null ? cfg.top_p : 0.8
  };
  if (jsonMode && cfg.use_json_mode !== false) body.response_format = { type: 'json_object' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.api_key
    },
    body: JSON.stringify(body)
  });

  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`模型接口返回 ${res.status}：${raw.slice(0, 400)}`);
    err.status = res.status;
    err.raw = raw;
    throw err;
  }

  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error('模型接口返回的不是 JSON：' + raw.slice(0, 300)); }
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!content) throw new Error('模型返回内容为空');
  return { content, usage: data.usage || null };
}

/* ================================================================== */
/* Schema 校验 + 泄漏检测                                              */
/* ================================================================== */

const ERR_TYPES = ['概念不清', '审题失误', '运算错误', '方法错误', '知识点缺失', '其他'];

function validateInitial(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['返回不是 JSON 对象'];
  if (obj.status === 'need_clarification') {
    if (!obj.user_visible || !Array.isArray(obj.user_visible.missing)) errs.push('user_visible.missing 必须是数组');
    return errs;
  }
  if (obj.status !== 'ok') errs.push('status 必须为 "ok" 或 "need_clarification"');
  if (obj.stage !== 'INITIAL') errs.push('stage 必须为 "INITIAL"');

  const uv = obj.user_visible;
  if (!uv || typeof uv !== 'object') { errs.push('缺少 user_visible'); return errs; }
  if (!Array.isArray(uv.mistakes) || uv.mistakes.length === 0) {
    errs.push('user_visible.mistakes 必须是非空数组');
    return errs;
  }
  if (uv.mistakes.length > 5) errs.push('mistakes 超过 5 道（规则 11）');

  uv.mistakes.forEach((m, i) => {
    const at = `mistakes[${i}]`;
    if (!m.mistake_id) errs.push(`${at}.mistake_id 缺失`);
    if (!Array.isArray(m.topic_path)) errs.push(`${at}.topic_path 必须是数组`);
    if (!m.question || typeof m.question !== 'object') errs.push(`${at}.question 缺失`);
    else {
      if (typeof m.question.stem !== 'string') errs.push(`${at}.question.stem 必须是字符串`);
      if (!Array.isArray(m.question.options)) errs.push(`${at}.question.options 必须是数组`);
    }
    if (!(m.user_answer === null || typeof m.user_answer === 'string')) {
      errs.push(`${at}.user_answer 必须是 string 或 null`);
    }
    if (typeof m.correct_answer !== 'string') errs.push(`${at}.correct_answer 必须是字符串`);
    if (typeof m.answer_explanation !== 'string') errs.push(`${at}.answer_explanation 必须是字符串`);
    if (!m.error_analysis || typeof m.error_analysis !== 'object') errs.push(`${at}.error_analysis 缺失`);
    else {
      if (!Array.isArray(m.error_analysis.knowledge_gap)) errs.push(`${at}.error_analysis.knowledge_gap 必须是数组`);
      if (m.error_analysis.error_type && ERR_TYPES.indexOf(m.error_analysis.error_type) === -1) {
        errs.push(`${at}.error_analysis.error_type 取值非法：${m.error_analysis.error_type}`);
      }
    }
    const kr = m.knowledge_review;
    if (!kr || typeof kr !== 'object') errs.push(`${at}.knowledge_review 缺失`);
    else {
      ['formulas', 'conditions', 'steps', 'common_mistakes'].forEach(k => {
        if (!Array.isArray(kr[k])) errs.push(`${at}.knowledge_review.${k} 必须是数组`);
      });
    }
    if (!Array.isArray(m.similar_questions) || m.similar_questions.length < 2 || m.similar_questions.length > 3) {
      errs.push(`${at}.similar_questions 必须是 2–3 道（规则 8）`);
    } else {
      m.similar_questions.forEach((q, j) => {
        const qa = `${at}.similar_questions[${j}]`;
        if (!q.question_id) errs.push(`${qa}.question_id 缺失`);
        if (q.answer_locked !== true) errs.push(`${qa}.answer_locked 必须为 true`);
        if (q.submit_required !== true) errs.push(`${qa}.submit_required 必须为 true`);
      });
    }
  });

  const so = obj.server_only;
  if (!so || !Array.isArray(so.locked_solutions) || so.locked_solutions.length === 0) {
    errs.push('server_only.locked_solutions 必须是非空数组');
  } else {
    const want = [];
    uv.mistakes.forEach(m => (m.similar_questions || []).forEach(q => want.push(m.mistake_id + '/' + q.question_id)));
    const got = so.locked_solutions.map(l => l.mistake_id + '/' + l.question_id);
    const miss = want.filter(w => got.indexOf(w) === -1);
    if (miss.length) errs.push('locked_solutions 与 similar_questions 不一一对应，缺少：' + miss.join('、'));
  }
  return errs;
}

function validateGrade(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['返回不是 JSON 对象'];
  if (obj.status === 'need_clarification') {
    if (!obj.user_visible || !Array.isArray(obj.user_visible.missing)) errs.push('user_visible.missing 必须是数组');
    return errs;
  }
  if (obj.stage !== 'GRADE_SIMILAR') errs.push('stage 必须为 "GRADE_SIMILAR"');
  const uv = obj.user_visible;
  if (!uv || !Array.isArray(uv.grading_results)) { errs.push('user_visible.grading_results 必须是数组'); return errs; }
  uv.grading_results.forEach((r, i) => {
    const at = `grading_results[${i}]`;
    if (!r.question_id) errs.push(`${at}.question_id 缺失`);
    if (typeof r.is_correct !== 'boolean') errs.push(`${at}.is_correct 必须是布尔值，不能是字符串`);
    if (typeof r.score !== 'string') errs.push(`${at}.score 必须是字符串，如 "10/10"`);
    if (typeof r.correct_answer !== 'string') errs.push(`${at}.correct_answer 必须是字符串`);
    if (!r.error_analysis || !Array.isArray(r.error_analysis.knowledge_gap)) {
      errs.push(`${at}.error_analysis.knowledge_gap 必须是数组`);
    }
  });
  const s = uv.summary;
  if (!s || typeof s !== 'object') errs.push('user_visible.summary 缺失');
  else {
    if (typeof s.total !== 'number') errs.push('summary.total 必须是数字');
    if (typeof s.correct_count !== 'number') errs.push('summary.correct_count 必须是数字');
    if (typeof s.accuracy !== 'string') errs.push('summary.accuracy 必须是字符串，如 "67%"');
    if (!Array.isArray(s.weak_points)) errs.push('summary.weak_points 必须是数组');
    if (!Array.isArray(s.next_steps)) errs.push('summary.next_steps 必须是数组');
  }
  return errs;
}

/** 泄漏检测：user_visible 里是否出现了锁定答案（规则 6 的自动化守卫） */
function detectLeak(initial) {
  const so = initial.server_only;
  if (!so || !Array.isArray(so.locked_solutions)) return [];
  const haystack = JSON.stringify(initial.user_visible);
  const hits = [];
  so.locked_solutions.forEach(l => {
    const ans = String(l.correct_answer || '').replace(/[$\\{}\s]/g, '');
    if (ans.length >= 3 && haystack.indexOf(ans) > -1) {
      hits.push(`${l.question_id} 的答案「${l.correct_answer}」疑似出现在 user_visible 中`);
    }
  });
  return hits;
}

/* ================================================================== */
/* 业务：阶段一 / 阶段二                                                */
/* ================================================================== */

const imgCache = {}; // img_hash -> record_id（规则 4）

async function runInitial({ text, imageDataUrl, subjectHint, gradeLevel, ocrText }) {
  const cfg = readConfig();
  if (!isConfigured(cfg)) {
    const err = new Error('尚未配置模型接口，请在页面右上角「模型设置」里填写，或使用手动模式。');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!text && !imageDataUrl && !ocrText) {
    const err = new Error('请先提供题目内容（粘贴题目文字，或上传题目/错题图片）。');
    err.code = 'EMPTY_INPUT';
    throw err;
  }

  let imgHash = null;
  if (imageDataUrl) {
    imgHash = crypto.createHash('sha256').update(imageDataUrl).digest('hex').slice(0, 32);
    if (imgCache[imgHash] && records[imgCache[imgHash]]) {
      const cached = records[imgCache[imgHash]];
      console.log('[initial] 命中图片缓存', imgHash);
      return { recordId: cached.id, userVisible: cached.user_visible, cached: true, usage: null };
    }
  }

  const mergedOcr = [text, ocrText].filter(Boolean).join('\n\n');
  const messages = buildInitialMessages({
    subjectHint, gradeLevel, ocrText: mergedOcr, imageDataUrl
  });

  let parsed = null, usage = null, attempts = 0, errs = [];
  while (attempts < 2) {
    attempts++;
    const { content, usage: u } = await callModel(messages, cfg);
    usage = u;
    try { parsed = JSON.parse(stripFences(content)); }
    catch (e) { errs = ['JSON.parse 失败：' + e.message]; parsed = null; continue; }
    errs = validateInitial(parsed);
    if (errs.length === 0) break;
    messages.push({ role: 'assistant', content: stripFences(content) });
    messages.push({
      role: 'user',
      content: '上一次返回未通过校验，问题如下：\n- ' + errs.join('\n- ') +
        '\n请严格按【首轮输出结构】重新输出完整 JSON，不要输出任何解释文字。'
    });
  }
  if (!parsed || errs.length) {
    const err = new Error('模型返回未通过 Schema 校验：' + errs.slice(0, 6).join('；'));
    err.code = 'SCHEMA_FAIL';
    err.detail = errs;
    throw err;
  }

  const leaks = parsed.status === 'ok' ? detectLeak(parsed) : [];

  const id = newRecordId();
  records[id] = {
    id,
    created_at: new Date().toISOString(),
    stage: 'INITIAL',
    subject_hint: subjectHint || '',
    grade_level: gradeLevel || '',
    input_text: mergedOcr.slice(0, 4000),
    img_hash: imgHash,
    user_visible: parsed.user_visible,
    server_only: parsed.server_only,
    leak_warnings: leaks,
    grading: null
  };
  persist();
  if (imgHash) imgCache[imgHash] = id;

  /* 自动保存：识别成功即写入错题集（同题自动合并） */
  const saved = parsed.status === 'ok'
    ? DB.addMistakesFromRecord(records[id], parsed.user_visible.mistakes)
    : [];

  return {
    recordId: id, userVisible: parsed.user_visible, leakWarnings: leaks,
    cached: false, usage, savedMistakes: saved
  };
}

async function runGrade({ recordId, submittedAnswers }) {
  const rec = records[recordId];
  if (!rec) {
    const err = new Error('记录不存在或已失效，请重新生成错题集。');
    err.code = 'NO_RECORD';
    throw err;
  }
  if (!Array.isArray(submittedAnswers) || submittedAnswers.length === 0) {
    const err = new Error('请至少填写一道同类型题的答案。');
    err.code = 'EMPTY_ANSWERS';
    throw err;
  }

  /* 硬规则 6：ID 越权校验（放在模型配置检查之前，保证无 Key 时也能得到准确提示） */
  const locked = (rec.server_only && rec.server_only.locked_solutions) || [];
  const illegal = submittedAnswers.filter(s => !locked.some(l =>
    l.mistake_id === s.mistake_id && l.question_id === s.question_id));
  if (illegal.length) {
    const err = new Error('提交的题目 ID 非法或对应记录不存在：' +
      illegal.map(x => x.question_id).join('、'));
    err.code = 'ILLEGAL_ID';
    throw err;
  }

  const cfg = readConfig();
  if (!isConfigured(cfg)) {
    const err = new Error('尚未配置模型接口，请在页面右上角「模型设置」里填写，或使用手动模式。');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  /* 硬规则 7：只把服务端存储的 locked_solutions 传下去，模型不得重算 */
  const messages = buildGradeMessages({
    serverOnlyData: { locked_solutions: locked },
    submittedAnswers
  });

  let parsed = null, usage = null, attempts = 0, errs = [];
  while (attempts < 2) {
    attempts++;
    const { content, usage: u } = await callModel(messages, cfg);
    usage = u;
    try { parsed = JSON.parse(stripFences(content)); }
    catch (e) { errs = ['JSON.parse 失败：' + e.message]; parsed = null; continue; }
    errs = validateGrade(parsed);
    if (errs.length === 0) break;
    messages.push({ role: 'assistant', content: stripFences(content) });
    messages.push({
      role: 'user',
      content: '上一次返回未通过校验，问题如下：\n- ' + errs.join('\n- ') +
        '\n请严格按【批改输出结构】重新输出完整 JSON，不要输出任何解释文字。'
    });
  }
  if (!parsed || errs.length) {
    const err = new Error('批改返回未通过 Schema 校验：' + errs.slice(0, 6).join('；'));
    err.code = 'SCHEMA_FAIL';
    err.detail = errs;
    throw err;
  }

  rec.grading = { at: new Date().toISOString(), submitted_answers: submittedAnswers, result: parsed.user_visible };
  rec.stage = 'GRADE_SIMILAR';
  persist();

  /* 自动保存：批改结果回写到错题条目（掌握程度 / 复习次数 / 作答记录） */
  const updated = DB.applyGrading(rec, parsed.user_visible.grading_results || []);

  return { userVisible: parsed.user_visible, usage, updatedMistakes: updated };
}

/* ================================================================== */
/* 手动模式：无 API Key 时，把组装好的请求交给用户自行调用                */
/* ================================================================== */

function buildManualPrompt(kind, payload) {
  if (kind === 'grade') {
    const rec = records[payload.recordId];
    if (!rec) throw Object.assign(new Error('记录不存在'), { code: 'NO_RECORD' });
    const locked = (rec.server_only && rec.server_only.locked_solutions) || [];
    const subs = payload.submittedAnswers || [];
    const illegal = subs.filter(s => !locked.some(l =>
      l.mistake_id === s.mistake_id && l.question_id === s.question_id));
    if (illegal.length) {
      throw Object.assign(new Error('提交的题目 ID 非法或对应记录不存在：' +
        illegal.map(x => x.question_id).join('、')), { code: 'ILLEGAL_ID' });
    }
    return buildGradeMessages({ serverOnlyData: { locked_solutions: locked }, submittedAnswers: subs });
  }
  const mergedOcr = [payload.text, payload.ocrText].filter(Boolean).join('\n\n');
  return buildInitialMessages({
    subjectHint: payload.subjectHint,
    gradeLevel: payload.gradeLevel,
    ocrText: mergedOcr,
    imageDataUrl: null
  });
}

/** 用户把模型返回的 JSON 粘回来 → 走同样的校验 + 隔离存储 */
function ingestInitial(rawJson) {
  let parsed;
  try { parsed = JSON.parse(stripFences(rawJson)); }
  catch (e) { throw Object.assign(new Error('不是合法 JSON：' + e.message), { code: 'BAD_JSON' }); }
  const errs = validateInitial(parsed);
  if (errs.length) {
    throw Object.assign(new Error('未通过 Schema 校验：' + errs.slice(0, 6).join('；')), { code: 'SCHEMA_FAIL', detail: errs });
  }
  const leaks = parsed.status === 'ok' ? detectLeak(parsed) : [];
  const id = newRecordId();
  records[id] = {
    id,
    created_at: new Date().toISOString(),
    stage: 'INITIAL',
    source: 'manual',
    user_visible: parsed.user_visible,
    server_only: parsed.server_only,
    leak_warnings: leaks,
    grading: null
  };
  persist();
  const saved = parsed.status === 'ok'
    ? DB.addMistakesFromRecord(records[id], parsed.user_visible.mistakes)
    : [];
  return { recordId: id, userVisible: parsed.user_visible, leakWarnings: leaks, savedMistakes: saved };
}

function ingestGrade(recordId, rawJson) {
  const rec = records[recordId];
  if (!rec) throw Object.assign(new Error('记录不存在'), { code: 'NO_RECORD' });
  let parsed;
  try { parsed = JSON.parse(stripFences(rawJson)); }
  catch (e) { throw Object.assign(new Error('不是合法 JSON：' + e.message), { code: 'BAD_JSON' }); }
  const errs = validateGrade(parsed);
  if (errs.length) {
    throw Object.assign(new Error('未通过 Schema 校验：' + errs.slice(0, 6).join('；')), { code: 'SCHEMA_FAIL', detail: errs });
  }
  rec.grading = { at: new Date().toISOString(), source: 'manual', result: parsed.user_visible };
  rec.stage = 'GRADE_SIMILAR';
  persist();
  const updated = DB.applyGrading(rec, parsed.user_visible.grading_results || []);
  return { userVisible: parsed.user_visible, updatedMistakes: updated };
}

/* ================================================================== */
/* HTTP                                                                */
/* ================================================================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function send(res, code, data, headers) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => {
      buf += c;
      if (buf.length > 30 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('请求体不是 JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found: ' + rel);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (!checkAccess(req, res, urlPath)) return;

  if (!urlPath.startsWith('/api/')) return serveStatic(req, res, urlPath);

  try {
    if (req.method === 'GET' && urlPath === '/api/status') {
      const cfg = readConfig();
      return send(res, 200, {
        configured: isConfigured(cfg),
        base_url: cfg.base_url,
        model: cfg.model,
        vision: cfg.vision !== false,
        has_key: Boolean(cfg.api_key),
        records: Object.keys(records).length,
        mistakes: DB.allMistakes().length
      });
    }

    if (req.method === 'GET' && urlPath === '/api/config') {
      const cfg = readConfig();
      return send(res, 200, {
        base_url: cfg.base_url, model: cfg.model, vision: cfg.vision !== false,
        temperature: cfg.temperature, top_p: cfg.top_p, use_json_mode: cfg.use_json_mode !== false,
        api_key_set: Boolean(cfg.api_key)
      });
    }

    if (req.method === 'POST' && urlPath === '/api/config') {
      const body = await readBody(req);
      const patch = {};
      ['base_url', 'model', 'temperature', 'top_p'].forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
      ['vision', 'use_json_mode'].forEach(k => { if (body[k] !== undefined) patch[k] = Boolean(body[k]); });
      if (body.api_key) patch.api_key = String(body.api_key).trim();
      if (body.clear_key) patch.api_key = '';
      writeConfig(patch);
      const cfg = readConfig();
      return send(res, 200, { ok: true, configured: isConfigured(cfg), model: cfg.model });
    }

    if (req.method === 'GET' && urlPath === '/api/system-prompt') {
      return send(res, 200, { system_prompt: SYSTEM_PROMPT });
    }

    if (req.method === 'POST' && urlPath === '/api/initial') {
      const body = await readBody(req);
      const out = await runInitial({
        text: (body.text || '').trim(),
        ocrText: (body.ocr_text || '').trim(),
        imageDataUrl: body.image || null,
        subjectHint: (body.subject_hint || '').trim(),
        gradeLevel: (body.grade_level || '').trim()
      });
      return send(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && urlPath === '/api/grade') {
      const body = await readBody(req);
      const out = await runGrade({
        recordId: body.record_id,
        submittedAnswers: body.submitted_answers || []
      });
      return send(res, 200, { ok: true, ...out });
    }

    if (req.method === 'POST' && urlPath === '/api/manual-prompt') {
      const body = await readBody(req);
      const messages = buildManualPrompt(body.kind === 'grade' ? 'grade' : 'initial', body);
      return send(res, 200, { ok: true, messages });
    }

    if (req.method === 'POST' && urlPath === '/api/ingest') {
      const body = await readBody(req);
      const out = body.kind === 'grade'
        ? ingestGrade(body.record_id, body.raw)
        : ingestInitial(body.raw);
      return send(res, 200, { ok: true, ...out });
    }

    /* ---------------- 错题集 ---------------- */

    if (req.method === 'GET' && urlPath === '/api/lan') {
      const cfg = readConfig();
      const urls = lanUrls();
      /* 有公网地址时优先展示公网地址（扫码要能在任何网络下扫） */
      const shareUrl = PUBLIC_URL
        ? PUBLIC_URL + (ACCESS_CODE ? '/?code=' + encodeURIComponent(ACCESS_CODE) : '/')
        : (urls[0] || '');
      let qr = null;
      if (shareUrl) {
        try { qr = QR.generateSVG(shareUrl, { size: 168, margin: 2 }); }
        catch (e) { console.error('[qr]', e.message); }
      }
      return send(res, 200, {
        ok: true,
        bound: cfg.host || '0.0.0.0',
        port: PORT,
        urls: urls,
        interfaces: lanAddresses(),
        qr_svg: qr,
        public_url: PUBLIC_URL || null,
        share_url: shareUrl || null,
        access_code_on: Boolean(ACCESS_CODE)
      });
    }

    if (req.method === 'GET' && urlPath === '/api/stats') {
      return send(res, 200, { ok: true, stats: DB.stats() });
    }

    if (req.method === 'GET' && urlPath === '/api/subjects') {
      return send(res, 200, { ok: true, ...DB.subjectsSummary() });
    }

    if (req.method === 'GET' && urlPath === '/api/mistakes') {
      const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());
      return send(res, 200, { ok: true, ...DB.listMistakes(q) });
    }

    if (req.method === 'GET' && urlPath === '/api/export') {
      const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());
      const format = (q.format || 'md').toLowerCase();
      const list = DB.listMistakes(Object.assign({}, q, { limit: 0 }));
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="mistakes-${stamp}.json"`,
          'Cache-Control': 'no-store'
        });
        return res.end(DB.exportJson());
      }
      if (format === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="mistakes-${stamp}.csv"`,
          'Cache-Control': 'no-store'
        });
        return res.end(DB.exportCsv(list.items));
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="mistakes-${stamp}.md"`,
        'Cache-Control': 'no-store'
      });
      return res.end(DB.exportMarkdown(list.items));
    }

    if (urlPath.startsWith('/api/mistakes/')) {
      const id = decodeURIComponent(urlPath.slice('/api/mistakes/'.length));
      if (req.method === 'GET') {
        const m = DB.getMistake(id);
        if (!m) return send(res, 404, { error: '错题不存在' });
        return send(res, 200, { ok: true, mistake: m });
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const m = DB.updateMistake(id, body);
        if (!m) return send(res, 404, { error: '错题不存在' });
        return send(res, 200, { ok: true, mistake: m });
      }
      if (req.method === 'DELETE') {
        const okDel = DB.deleteMistake(id);
        if (!okDel) return send(res, 404, { error: '错题不存在' });
        return send(res, 200, { ok: true, deleted: id });
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    /* 仅用于「后端视角」演示面板，展示服务端到底存了什么 */
    if (req.method === 'GET' && urlPath.startsWith('/api/records/')) {
      const id = urlPath.slice('/api/records/'.length);
      const rec = records[id];
      if (!rec) return send(res, 404, { error: '记录不存在' });
      return send(res, 200, {
        record: {
          id: rec.id,
          created_at: rec.created_at,
          stage: rec.stage,
          img_hash: rec.img_hash || null,
          leak_warnings: rec.leak_warnings || [],
          user_visible: rec.user_visible,
          server_only: rec.server_only,
          grading: rec.grading
        }
      });
    }

    return send(res, 404, { error: 'unknown api: ' + urlPath });
  } catch (e) {
    const code = e.code || 'INTERNAL';
    const status = code === 'NOT_CONFIGURED' ? 428
      : code === 'EMPTY_INPUT' || code === 'EMPTY_ANSWERS' || code === 'ILLEGAL_ID' || code === 'BAD_JSON' ? 400
      : code === 'NO_RECORD' ? 404
      : code === 'SCHEMA_FAIL' ? 422
      : 500;
    if (status === 500) console.error('[api]', e);
    return send(res, status, { error: e.message, code, detail: e.detail || null });
  }
});

/**
 * 是否自动打开浏览器。
 * 打包成 exe 后双击运行，默认就打开（--no-open 可关掉）；
 * 开发形态下需要显式加 --open。
 */
const OPEN_BROWSER = process.argv.indexOf('--no-open') === -1 &&
  (IS_SEA || process.argv.indexOf('--open') > -1 || process.env.AUTO_OPEN === '1');

function openBrowser() {
  /* 开了访问口令时，自动打开的链接要自带口令 —— 浏览器拿到 Cookie 之后就再也
     不用输口令了（Cookie 有效期 180 天），所以本机自用其实是无感的。 */
  const url = 'http://127.0.0.1:' + PORT +
    (ACCESS_CODE ? '/?code=' + encodeURIComponent(ACCESS_CODE) : '');
  const cmd = process.platform === 'win32' ? 'start "" "' + url + '"'
    : process.platform === 'darwin' ? 'open "' + url + '"'
      : 'xdg-open "' + url + '"';
  require('child_process').exec(cmd, () => {});
}

/* 端口被占用：多半是服务已经在跑了，直接打开浏览器，不要报错吓人 */
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log('');
    console.log('  端口 ' + PORT + ' 已被占用 —— 错题集助手可能已经在运行了。');
    console.log('  直接使用：http://127.0.0.1:' + PORT);
    if (OPEN_BROWSER) openBrowser();
    console.log('  如需重启，请先双击「停止错题集助手.bat」再启动。');
    console.log('');
    setTimeout(() => process.exit(0), OPEN_BROWSER ? 1200 : 3000);
    return;
  }
  console.error('[server] ' + e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const cfg = readConfig();
  const st = DB.stats();
  const urls = lanUrls();

  console.log('');
  console.log('  错题集生成与知识点拓展助手 · 本地服务已启动');
  console.log('  ─────────────────────────────────────────────');
  console.log('  本机地址：http://127.0.0.1:' + PORT);
  if (urls.length) {
    console.log('  手机访问：' + urls[0]);
    urls.slice(1).forEach(u => console.log('            ' + u));
    console.log('            （手机与电脑连同一个 Wi-Fi，扫码或直接输入上面的地址）');
  } else {
    console.log('  手机访问：未检测到局域网地址（可能没连 Wi-Fi）');
  }
  console.log('  模型：' + (isConfigured(cfg) ? cfg.model + '  (' + cfg.base_url + ')' : '未配置（页面可切手动模式）'));
  console.log('  错题集：' + st.subjects + ' 个科目 / 共 ' + st.total + ' 道题　待复习 ' + st.due_review + ' 道');
  console.log('  数据：' + DB.DB_PATH);
  console.log('  运行方式：' + (IS_SEA ? '打包版（免安装 Node）' : '开发版（node server.js）'));
  if (ACCESS_CODE) {
    console.log('  访问口令：已开启（' + ACCESS_CODE + '）　分享链接要带 ?code=' + ACCESS_CODE);
    if (PUBLIC_URL) console.log('  公网地址：' + PUBLIC_URL + '/?code=' + ACCESS_CODE);
  } else {
    console.log('  访问口令：未开启（任何拿到网址的人都能用你的 API 额度）');
  }
  console.log('');
  if (HOST === '0.0.0.0') {
    console.log('  提示：已开放局域网访问，同一 Wi-Fi 下的设备都能打开。');
    console.log('        若只想本机使用，把 config.json 里的 "host" 改成 "127.0.0.1"。');
  }
  console.log('  关闭此窗口即停止服务（错题集已自动保存，不会丢）。');
  console.log('');

  if (OPEN_BROWSER) openBrowser();
});

/* 退出前强制落盘，避免丢数据 */
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
  process.on(sig, () => {
    console.log('\n[db] 正在保存错题集…');
    DB.flush();
    console.log('[db] 已保存到 ' + DB.DB_PATH);
    process.exit(0);
  });
});
process.on('exit', () => DB.flush());
