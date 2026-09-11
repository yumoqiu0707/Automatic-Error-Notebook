/* 后端接口联调测试：Schema 校验 / 隔离存储 / 越权校验 / 泄漏检测 */
const BASE = process.env.CTJ_TEST_BASE || 'http://127.0.0.1:5178';

/* 本机服务若开启了访问口令（config.json 里的 access_code），测试请求自动带上 ?code=，
   等价于本机浏览器自用（启动时打开的链接本就会自动带口令）。 */
(function installAccessCodeShim() {
  let code = '';
  try {
    code = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'config.json'), 'utf8')).access_code || '';
  } catch (e) { /* 无 config.json 或未开口令 */ }
  if (!code) return;
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('127.0.0.1') > -1 && url.indexOf('code=') === -1) {
      url += (url.indexOf('?') > -1 ? '&' : '?') + 'code=' + encodeURIComponent(code);
    }
    return origFetch.call(this, url, opts);
  };
})();

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, body: d };
}
async function get(p) {
  const r = await fetch(BASE + p);
  const d = await r.json().catch(() => ({}));
  return { status: r.status, body: d };
}

/* 一份合法的阶段一返回（只留必要结构，2 道同类型题） */
function validInitial(leak) {
  const mk = {
    mistake_id: 'm1', subject: '数学', grade: '初二',
    topic_path: ['初中数学', '方程与不等式', '一元二次方程根的判别式'],
    difficulty: '基础', question_type: '选择题',
    question: { stem: '若关于 x 的方程 x^2+2x+k=0 有两个不相等的实数根，则 k 的取值范围是（  ）', options: ['A. k<1', 'B. k>1'], figure_description: '', blanks: [] },
    user_answer: 'B',
    correct_answer: leak ? 'A（正确答案就是 A）' : 'A',
    answer_explanation: '判别式 Δ=4-4k>0，解得 k<1。',
    error_analysis: { where_wrong: '不等式变号错误', error_type: '运算错误', root_cause: '不等式性质不熟', knowledge_gap: ['不等式变号'] },
    knowledge_review: { definition: '判别式决定根的个数', formulas: ['Δ=b^2-4ac'], conditions: ['a≠0'], steps: ['化一般式', '算 Δ'], common_mistakes: ['漏符号'], method_summary: '看根个数先写 Δ' },
    similar_questions: [
      { question_id: 'm1_q1', stem: '关于 x 的方程 x^2+4x+c=0 有两个不相等的实数根，则 c 的取值范围是（  ）', options: ['A. c<4', 'B. c>4'], answer_locked: true, submit_required: true },
      { question_id: 'm1_q2', stem: '若 2x^2-3x+k=0 有两个相等的实数根，则 k=____', options: [], answer_locked: true, submit_required: true }
    ]
  };
  return {
    status: 'ok', stage: 'INITIAL', message: '',
    user_visible: {
      mistakes: [mk],
      /* leak=true 时：把 m1_q2 的锁定答案 "9/8" 泄漏到 user_visible 里，用于验证检测器 */
      next_action: leak
        ? '请完成同类型题并提交答案。参考答案：k=9/8。'
        : '请完成同类型题并提交答案，提交后开放答案与解析。'
    },
    server_only: {
      locked_solutions: [
        { mistake_id: 'm1', question_id: 'm1_q1', correct_answer: 'A', explanation: 'Δ=16-4c>0 ⇒ c<4', scoring_points: ['写 Δ（5分）', '解出 c<4（5分）'], knowledge_point: '根的判别式', common_mistakes: ['变号'] },
        { mistake_id: 'm1', question_id: 'm1_q2', correct_answer: '9/8', explanation: 'Δ=9-8k=0 ⇒ k=9/8', scoring_points: ['写 Δ（5分）', '解出 k（5分）'], knowledge_point: '判别式为零', common_mistakes: ['与 Δ>0 混用'] }
      ]
    }
  };
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (extra ? '  → ' + extra : ''));
    cond ? pass++ : fail++;
  };

  console.log('\n【1】非法 JSON 结构应被 Schema 拒绝');
  {
    const bad = validInitial();
    delete bad.server_only;               // 缺 locked_solutions
    const r = await post('/api/ingest', { kind: 'initial', raw: JSON.stringify(bad) });
    check('缺少 server_only 返回 422', r.status === 422, 'HTTP ' + r.status);
    check('错误信息指明 locked_solutions', /locked_solutions/.test(r.body.error || ''), r.body.error);
  }

  console.log('\n【2】answer_locked 不是布尔 true 应被拒绝');
  {
    const bad = validInitial();
    bad.user_visible.mistakes[0].similar_questions[0].answer_locked = 'true';
    const r = await post('/api/ingest', { kind: 'initial', raw: JSON.stringify(bad) });
    check('字符串 "true" 被拒绝', r.status === 422, 'HTTP ' + r.status);
    check('提示 answer_locked 必须为 true', /answer_locked/.test(r.body.error || ''), r.body.error);
  }

  console.log('\n【3】同类型题数量越界（只给 1 道）应被拒绝');
  {
    const bad = validInitial();
    bad.user_visible.mistakes[0].similar_questions = [bad.user_visible.mistakes[0].similar_questions[0]];
    bad.server_only.locked_solutions = [bad.server_only.locked_solutions[0]];
    const r = await post('/api/ingest', { kind: 'initial', raw: JSON.stringify(bad) });
    check('1 道题被拒绝', r.status === 422, 'HTTP ' + r.status);
    check('提示 2–3 道', /2–3/.test(r.body.error || ''), r.body.error);
  }

  console.log('\n【4】合法返回应通过，并做隔离存储');
  let recordId = null;
  {
    const r = await post('/api/ingest', { kind: 'initial', raw: JSON.stringify(validInitial(false)) });
    check('通过校验并返回 200', r.status === 200, 'HTTP ' + r.status);
    check('返回 recordId', Boolean(r.body.recordId), r.body.recordId);
    check('返回体不含 server_only', r.body.serverOnly === undefined && r.body.server_only === undefined);
    check('返回体只含 user_visible', Boolean(r.body.userVisible && r.body.userVisible.mistakes));
    recordId = r.body.recordId;
  }

  console.log('\n【5】后端视角可读到 locked_solutions（前端接口拿不到）');
  {
    const r = await get('/api/records/' + recordId);
    check('记录存在', r.status === 200, 'HTTP ' + r.status);
    const ls = r.body.record && r.body.record.server_only && r.body.record.server_only.locked_solutions;
    check('locked_solutions 已落库', Array.isArray(ls) && ls.length === 2, ls && ls.length + ' 条');
  }

  console.log('\n【6】泄漏检测：user_visible 出现锁定答案应告警');
  {
    const r = await post('/api/ingest', { kind: 'initial', raw: JSON.stringify(validInitial(true)) });
    check('仍然接受（告警非阻断）', r.status === 200, 'HTTP ' + r.status);
    check('返回泄漏告警', Array.isArray(r.body.leakWarnings) && r.body.leakWarnings.length > 0,
      JSON.stringify(r.body.leakWarnings));
  }

  console.log('\n【7】阶段二越权校验：非法 question_id 应被拒绝');
  {
    const r = await post('/api/grade', {
      record_id: recordId,
      submitted_answers: [{ mistake_id: 'm1', question_id: 'm1_q99', answer: 'A' }]
    });
    check('非法 ID 返回 400', r.status === 400, 'HTTP ' + r.status);
    check('错误码 ILLEGAL_ID', r.body.code === 'ILLEGAL_ID', r.body.code + ' / ' + r.body.error);
  }

  console.log('\n【8】阶段二记录不存在应被拒绝');
  {
    const r = await post('/api/grade', { record_id: 'rec_not_exist', submitted_answers: [{ mistake_id: 'm1', question_id: 'm1_q1', answer: 'A' }] });
    check('返回 404', r.status === 404, 'HTTP ' + r.status);
    check('错误码 NO_RECORD', r.body.code === 'NO_RECORD', r.body.code);
  }

  console.log('\n【9】手动模式：组装出的请求应含 System 提示词与 locked_solutions');
  {
    const r = await post('/api/manual-prompt', {
      kind: 'grade', recordId,
      submittedAnswers: [{ mistake_id: 'm1', question_id: 'm1_q1', answer: 'A' }]
    });
    check('返回 messages', r.status === 200 && Array.isArray(r.body.messages), 'HTTP ' + r.status);
    const sys = r.body.messages[0].content;
    const usr = r.body.messages[1].content;
    check('system 含防注入规则', /防提示注入/.test(sys));
    check('system 含首轮输出结构', /首轮输出结构/.test(sys));
    check('user 含 locked_solutions', /locked_solutions/.test(usr));
    check('user 含 submitted_answers', /submitted_answers/.test(usr));
    check('user 含正确答案 A', /"correct_answer":"A"/.test(usr.replace(/\s/g, '')));
  }

  console.log('\n【10】未配置模型时给出可操作的提示');
  {
    const st = await get('/api/status');
    if (st.body.configured) {
      console.log('  [SKIP] 当前已配置真实模型（' + st.body.model + '），跳过以免消耗你的 API 额度');
      console.log('         想验证这一项，请先清空 config.json 里的 api_key 再跑。');
    } else {
      const r = await post('/api/initial', { text: '1+1=?' });
      check('返回 428 NOT_CONFIGURED', r.status === 428 && r.body.code === 'NOT_CONFIGURED', 'HTTP ' + r.status);
    }
  }

  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exitCode = fail ? 1 : 0;
})();
