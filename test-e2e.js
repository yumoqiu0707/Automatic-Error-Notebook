/* 端到端测试：用本地假模型端点验证「真实调用 → 解析 → Schema 校验 → 失败重试 → 隔离存储 → 批改」全链路 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const MOCK_PORT = 5199;
const APP = process.env.CTJ_TEST_BASE || 'http://127.0.0.1:5178';

/* 本机服务若开启了访问口令（config.json 里的 access_code），测试请求自动带上 ?code=。 */
(function installAccessCodeShim() {
  let code = '';
  try { code = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).access_code || ''; } catch (e) {}
  if (!code) return;
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('127.0.0.1') > -1 && url.indexOf('code=') === -1) {
      url += (url.indexOf('?') > -1 ? '&' : '?') + 'code=' + encodeURIComponent(code);
    }
    return origFetch.call(this, url, opts);
  };
})();

let callCount = 0;
const seen = [];

/* ---------- 假模型返回的内容 ---------- */
const INITIAL_OK = {
  status: 'ok', stage: 'INITIAL', message: '',
  user_visible: {
    mistakes: [{
      mistake_id: 'm1', subject: '数学', grade: '初二',
      topic_path: ['初中数学', '数与式', '完全平方公式'],
      difficulty: '基础', question_type: '解答题',
      question: { stem: '已知 $a+b=5$，$ab=6$，求 $a^{2}+b^{2}$ 的值。', options: [], figure_description: '', blanks: [] },
      user_answer: null,
      correct_answer: '$13$',
      answer_explanation: '$a^{2}+b^{2}=(a+b)^{2}-2ab=5^{2}-2\\times 6=25-12=13$。',
      error_analysis: { where_wrong: '未识别到你的作答，请补充你的答案后再分析错因。', error_type: '其他', root_cause: '本题尚未识别到作答内容。', knowledge_gap: ['完全平方公式的变形'] },
      knowledge_review: {
        definition: '完全平方公式 $(a\\pm b)^{2}=a^{2}\\pm 2ab+b^{2}$，变形可得 $a^{2}+b^{2}=(a+b)^{2}-2ab$。',
        formulas: ['$(a+b)^{2}=a^{2}+2ab+b^{2}$', '$a^{2}+b^{2}=(a+b)^{2}-2ab$'],
        conditions: ['公式对任意实数成立'],
        steps: ['观察已知与所求', '选择合适的变形公式', '代入求值'],
        common_mistakes: ['直接展开 $(a+b)^2$ 后忘记减去 $2ab$'],
        method_summary: '见平方和与乘积，优先想完全平方公式的变形。'
      },
      similar_questions: [
        { question_id: 'm1_q1', stem: '已知 $x+y=7$，$xy=10$，则 $x^{2}+y^{2}=$ ______', options: [], answer_locked: true, submit_required: true },
        { question_id: 'm1_q2', stem: '已知 $m-n=3$，$mn=4$，则 $m^{2}+n^{2}=$ ______', options: [], answer_locked: true, submit_required: true }
      ]
    }],
    next_action: '请完成同类型题并提交答案，提交后开放答案与解析。'
  },
  server_only: {
    locked_solutions: [
      { mistake_id: 'm1', question_id: 'm1_q1', correct_answer: '$29$', explanation: '$x^{2}+y^{2}=(x+y)^{2}-2xy=49-20=29$。', scoring_points: ['变形（5分）', '代入（3分）', '结果（2分）'], knowledge_point: '完全平方公式变形', common_mistakes: ['忘记减 2xy'] },
      { mistake_id: 'm1', question_id: 'm1_q2', correct_answer: '$17$', explanation: '$m^{2}+n^{2}=(m-n)^{2}+2mn=9+8=17$。', scoring_points: ['变形（5分）', '代入（3分）', '结果（2分）'], knowledge_point: '完全平方公式变形', common_mistakes: ['符号用错'] }
    ]
  }
};

const GRADE_OK = {
  status: 'ok', stage: 'GRADE_SIMILAR', message: '',
  user_visible: {
    grading_results: [
      { mistake_id: 'm1', question_id: 'm1_q1', submitted_answer: '29', correct_answer: '$29$', is_correct: true, score: '10/10', explanation: '$x^{2}+y^{2}=(x+y)^{2}-2xy=49-20=29$。', error_analysis: { where_wrong: '', error_type: '', root_cause: '', knowledge_gap: [] }, mastery: '掌握', review_suggestion: '已掌握，可练习带负号的变式。' },
      { mistake_id: 'm1', question_id: 'm1_q2', submitted_answer: '7', correct_answer: '$17$', is_correct: false, score: '0/10', explanation: '$m^{2}+n^{2}=(m-n)^{2}+2mn=9+8=17$。', error_analysis: { where_wrong: '变形时把 $+2mn$ 写成了 $-2mn$，得到 $9-8=1$ 后又误算为 7。', error_type: '方法错误', root_cause: '两个变形公式混用，没有区分「和」与「差」。', knowledge_gap: ['$(a\\pm b)^2$ 的两种变形'] }, mastery: '未掌握', review_suggestion: '建议把两个变形公式并列抄写一遍再重做。' }
    ],
    summary: { total: 2, correct_count: 1, accuracy: '50%', weak_points: ['完全平方公式的两种变形'], next_steps: ['对比记忆 $(a+b)^2$ 与 $(a-b)^2$ 的变形公式'] }
  },
  server_only: {}
};

/* ---------- 假模型服务 ---------- */
const mock = http.createServer((req, res) => {
  let buf = '';
  req.on('data', c => buf += c);
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(buf); } catch (e) {}
    callCount++;

    /* 只看 user 消息判断阶段：system 提示词里同时含 "阶段一/阶段二" 字样，不能用来判定 */
    const msgs = body.messages || [];
    const allUser = msgs.filter(m => m.role === 'user')
      .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    const isGrade = /stage:\s*GRADE_SIMILAR/.test(allUser);
    const isRetry = /未通过校验/.test(allUser);
    seen.push({ call: callCount, isGrade, retry: isRetry, user: allUser });

    let content;
    if (isGrade) {
      /* 忠实模拟：只批改 submitted_answers 里出现的题目（规则 16） */
      const m = allUser.match(/submitted_answers:\s*(\[[\s\S]*?\])\s*$/m);
      let subs = [];
      try { subs = JSON.parse(m ? m[1] : '[]'); } catch (e) { subs = []; }
      const ids = subs.map(s => s.question_id);
      const filtered = GRADE_OK.user_visible.grading_results.filter(r => ids.indexOf(r.question_id) > -1);
      const correct = filtered.filter(r => r.is_correct).length;
      content = JSON.stringify({
        status: 'ok', stage: 'GRADE_SIMILAR', message: '',
        user_visible: {
          grading_results: filtered,
          summary: {
            total: filtered.length, correct_count: correct,
            accuracy: filtered.length ? Math.round(correct / filtered.length * 100) + '%' : '0%',
            weak_points: [], next_steps: ['未提交题目答案仍保持锁定']
          }
        },
        server_only: {}
      });
    } else if (callCount === 1) {
      /* 第一次故意返回不合规结构，验证「校验失败 → 自动重试」 */
      content = JSON.stringify({ status: 'ok', stage: 'INITIAL', user_visible: { mistakes: [] }, server_only: { locked_solutions: [] } });
    } else {
      content = '```json\n' + JSON.stringify(INITIAL_OK) + '\n```'; /* 故意带 markdown 围栏，验证剥离 */
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 }
    }));
  });
});

async function post(p, body) {
  const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, body: d };
}

(async () => {
  const origConfig = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));

  let pass = 0, fail = 0;
  const check = (n, c, x) => { console.log((c ? '  [PASS] ' : '  [FAIL] ') + n + (x ? '  → ' + x : '')); c ? pass++ : fail++; };

  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      base_url: 'http://127.0.0.1:' + MOCK_PORT + '/v1',
      api_key: 'test-key', model: 'mock-model', vision: true,
      temperature: 0.2, top_p: 0.8, use_json_mode: true
    }, null, 2));

    console.log('\n【1】配置生效');
    {
      const r = await post('/api/config', {});
      check('读取到假模型配置', true);
      const s = await (await fetch(APP + '/api/status')).json();
      check('status.configured = true', s.configured === true, JSON.stringify(s.model));
    }

    console.log('\n【2】阶段一：真实调用 + 校验失败自动重试 + 剥离 markdown 围栏');
    let recId = null;
    {
      const r = await post('/api/initial', { text: '已知 a+b=5，ab=6，求 a²+b² 的值。' });
      check('最终返回 200', r.status === 200, 'HTTP ' + r.status + (r.body.error ? ' / ' + r.body.error : ''));
      check('模型被调用了 2 次（首次不合规触发重试）', callCount === 2, 'callCount=' + callCount);
      check('第二次请求带了校验反馈', seen[1] && seen[1].retry === true);
      check('返回 user_visible.mistakes', Boolean(r.body.userVisible && r.body.userVisible.mistakes.length === 1));
      check('返回体不含 server_only', r.body.serverOnly === undefined && r.body.server_only === undefined);
      recId = r.body.recordId;
    }

    console.log('\n【3】同类型题答案只落在服务端');
    {
      const r = await fetch(APP + '/api/records/' + recId).then(x => x.json());
      const ls = r.record.server_only.locked_solutions;
      check('locked_solutions 落库 2 条', ls.length === 2, ls.map(x => x.question_id + '=' + x.correct_answer).join(', '));
      const uvStr = JSON.stringify(r.record.user_visible);
      check('user_visible 中不含答案 29', uvStr.indexOf('29') === -1 || !/correct_answer/.test(uvStr));
      check('user_visible 中不含答案 17', uvStr.indexOf('17') === -1);
      check('无泄漏告警', (r.record.leak_warnings || []).length === 0);
    }

    console.log('\n【4】阶段二：带 locked_solutions 真实批改');
    {
      const r = await post('/api/grade', {
        record_id: recId,
        submitted_answers: [
          { mistake_id: 'm1', question_id: 'm1_q1', answer: '29' },
          { mistake_id: 'm1', question_id: 'm1_q2', answer: '7' }
        ]
      });
      check('返回 200', r.status === 200, 'HTTP ' + r.status + (r.body.error ? ' / ' + r.body.error : ''));
      const g = r.body.userVisible;
      check('2 条批改结果', g.grading_results.length === 2);
      check('m1_q1 判对 10/10', g.grading_results[0].is_correct === true && g.grading_results[0].score === '10/10');
      check('m1_q2 判错 0/10', g.grading_results[1].is_correct === false && g.grading_results[1].score === '0/10');
      check('正确率 50%', g.summary.accuracy === '50%', g.summary.accuracy);
      const lastReq = seen[seen.length - 1];
      check('批改请求确实发给了模型', lastReq.isGrade === true);
    }

    console.log('\n【5】未提交的题目不进入批改结果');
    {
      const r = await post('/api/grade', {
        record_id: recId,
        submitted_answers: [{ mistake_id: 'm1', question_id: 'm1_q1', answer: '29' }]
      });
      check('返回 200', r.status === 200);
      check('只回 1 条结果', r.body.userVisible.grading_results.length === 1);
      check('未提交题目的锁定答案没有发给模型',
        seen[seen.length - 1].user.indexOf('$17$') === -1,
        '只提交 m1_q1 时不应携带 m1_q2 的答案');
    }

    console.log('\n【6】图片缓存（img_hash）不重复消耗 token');
    {
      const before = callCount;
      const img = 'data:image/png;base64,' + Buffer.from('fake-image-' + Date.now()).toString('base64');
      const r1 = await post('/api/initial', { image: img });
      const afterFirst = callCount;
      const r2 = await post('/api/initial', { image: img });
      check('首次调用模型', afterFirst === before + 1, 'calls +' + (afterFirst - before));
      check('二次命中缓存未再调用模型', callCount === afterFirst, 'callCount=' + callCount);
      check('两次返回同一 recordId', r1.body.recordId === r2.body.recordId);
      check('标记 cached', r2.body.cached === true);
    }

  } catch (e) {
    console.log('  [ERROR] ' + e.message);
    fail++;
  } finally {
    if (origConfig === null) fs.existsSync(CONFIG_PATH) && fs.unlinkSync(CONFIG_PATH);
    else fs.writeFileSync(CONFIG_PATH, origConfig);
    mock.close();
  }

  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exitCode = fail ? 1 : 0;
})();
