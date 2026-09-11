/* 错题集持久化测试：自动保存 / 去重合并 / 批改回写 / 编辑 / 导出 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const MOCK_PORT = 5198;
const APP = 'http://127.0.0.1:5178';

const INITIAL = {
  status: 'ok', stage: 'INITIAL', message: '',
  user_visible: {
    mistakes: [{
      mistake_id: 'm1', subject: '数学', grade: '初二',
      topic_path: ['初中数学', '方程与不等式', '一元二次方程根的判别式'],
      difficulty: '基础', question_type: '选择题',
      question: { stem: '【持久化测试专用题】若关于 $x$ 的方程 $x^{2}+5x+p=0$ 有两个不相等的实数根，则 $p$ 的取值范围是（  ）', options: ['A. $p<6.25$', 'B. $p>6.25$'], figure_description: '', blanks: [] },
      user_answer: 'B',
      correct_answer: 'A',
      answer_explanation: '$\\Delta=4-4k>0$，解得 $k<1$。',
      error_analysis: { where_wrong: '不等式两边同除负数未变号', error_type: '运算错误', root_cause: '不等式性质不熟', knowledge_gap: ['不等式变号'] },
      knowledge_review: { definition: '判别式决定根的个数', formulas: ['$\\Delta=b^{2}-4ac$'], conditions: ['$a\\neq 0$'], steps: ['化一般式', '算 $\\Delta$'], common_mistakes: ['漏变号'], method_summary: '看根个数先写 $\\Delta$' },
      similar_questions: [
        { question_id: 'm1_q1', stem: '关于 $x$ 的方程 $x^{2}+4x+c=0$ 有两个不相等的实数根，则 $c$ 的取值范围是（  ）', options: ['A. $c<4$', 'B. $c>4$'], answer_locked: true, submit_required: true },
        { question_id: 'm1_q2', stem: '若 $2x^{2}-3x+k=0$ 有两个相等的实数根，则 $k=$ ____', options: [], answer_locked: true, submit_required: true }
      ]
    }],
    next_action: '请完成同类型题并提交答案。'
  },
  server_only: {
    locked_solutions: [
      { mistake_id: 'm1', question_id: 'm1_q1', correct_answer: 'A', explanation: '$c<4$', scoring_points: ['写 $\\Delta$'], knowledge_point: '根的判别式', common_mistakes: ['变号'] },
      { mistake_id: 'm1', question_id: 'm1_q2', correct_answer: '$k=\\frac{9}{8}$', explanation: '$k=9/8$', scoring_points: ['写 $\\Delta$'], knowledge_point: '判别式为零', common_mistakes: ['混用'] }
    ]
  }
};

const mock = http.createServer((req, res) => {
  let buf = '';
  req.on('data', c => buf += c);
  req.on('end', () => {
    const body = JSON.parse(buf || '{}');
    const allUser = (body.messages || []).filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    let out;
    if (/stage:\s*GRADE_SIMILAR/.test(allUser)) {
      const m = allUser.match(/submitted_answers:\s*(\[[\s\S]*?\])\s*$/m);
      let subs = [];
      try { subs = JSON.parse(m ? m[1] : '[]'); } catch (e) {}
      const results = subs.map(s => s.question_id === 'm1_q1'
        ? { mistake_id: 'm1', question_id: 'm1_q1', submitted_answer: s.answer, correct_answer: 'A', is_correct: true, score: '10/10', explanation: '$c<4$', error_analysis: { where_wrong: '', error_type: '', root_cause: '', knowledge_gap: [] }, mastery: '掌握', review_suggestion: '继续保持。' }
        : { mistake_id: 'm1', question_id: 'm1_q2', submitted_answer: s.answer, correct_answer: '$k=\\frac{9}{8}$', is_correct: false, score: '0/10', explanation: '$k=9/8$', error_analysis: { where_wrong: '解方程出错', error_type: '运算错误', root_cause: '移项出错', knowledge_gap: ['一元一次方程'] }, mastery: '未掌握', review_suggestion: '重做本题。' });
      const correct = results.filter(r => r.is_correct).length;
      out = { status: 'ok', stage: 'GRADE_SIMILAR', message: '', user_visible: { grading_results: results, summary: { total: results.length, correct_count: correct, accuracy: Math.round(correct / results.length * 100) + '%', weak_points: ['一元一次方程'], next_steps: ['复习解方程'] } }, server_only: {} };
    } else {
      out = INITIAL;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(out) } }] }));
  });
});

async function post(p, body) {
  const r = await fetch(APP + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function get(p) {
  const r = await fetch(APP + p, { cache: 'no-store' });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** 等服务就绪（最多 20 秒） */
async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(APP + '/api/status', { cache: 'no-store' });
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** 等待防抖落盘完成（最多 3 秒）；cond 为可选条件，不满足则继续等 */
async function waitForDb(cond) {
  let last = null;
  for (let i = 0; i < 12; i++) {
    try {
      last = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (last && (!cond || cond(last))) return last;
    } catch (e) { /* 还没落盘 */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return last;
}

(async () => {
  const orig = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  let pass = 0, fail = 0;
  const check = (n, c, x) => { console.log((c ? '  [PASS] ' : '  [FAIL] ') + n + (x ? '  → ' + x : '')); c ? pass++ : fail++; };

  try {
    if (!await waitForServer()) {
      console.log('  [ERROR] 本地服务未就绪，请先运行 node server.js');
      process.exitCode = 1;
      return;
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      base_url: 'http://127.0.0.1:' + MOCK_PORT + '/v1', api_key: 'k', model: 'mock', vision: true, use_json_mode: true
    }, null, 2));

    console.log('\n【0】测试前置：记录基线');
    let baseTotal = 0;
    {
      const st = await get('/api/stats');
      baseTotal = st.body.stats.total;
      console.log('  当前错题集已有 ' + baseTotal + ' 道，本测试将以「基线 + 1」为断言依据');
    }

    console.log('\n【1】生成即自动保存');
    let recId, mkId;
    {
      const r = await post('/api/initial', { text: '【持久化测试专用题】若关于 x 的方程 x^2+5x+p=0 有两个不相等的实数根，求 p。' });
      check('阶段一成功', r.status === 200, 'HTTP ' + r.status);
      check('返回 savedMistakes', Array.isArray(r.body.savedMistakes) && r.body.savedMistakes.length === 1);
      check('标记为新增（非合并）', r.body.savedMistakes[0].merged === false);
      recId = r.body.recordId;
      mkId = r.body.savedMistakes[0].id;

      const st = await get('/api/stats');
      check('统计里错题数为基线 +1', st.body.stats.total === baseTotal + 1,
        'total=' + st.body.stats.total + '（基线 ' + baseTotal + '）');
    }

    console.log('\n【2】错题条目内容完整（原题信息已入库）');
    {
      const r = await get('/api/mistakes');
      const m = r.body.items[0];
      check('列表中能找到这道题', r.body.items.some(x => x.question.stem.indexOf('持久化测试专用题') > -1));
      check('题干已保存', /有两个不相等的实数根/.test(m.question.stem));
      check('我的作答 / 正确答案已保存', m.user_answer === 'B' && m.correct_answer === 'A');
      check('解析与错因已保存', Boolean(m.answer_explanation && m.error_analysis.error_type));
      check('知识点路径已保存', m.topic_path.length === 3, m.topic_path.join('/'));
      check('初始掌握程度为待批改', m.mastery === '待批改');
      check('记录错题次数 1 次', m.wrong_count === 1);
      check('条目里不含同类型题答案', JSON.stringify(m).indexOf('9/8') === -1 && JSON.stringify(m).indexOf('"A"') > -1);
    }

    console.log('\n【3】同一道题再次做错 → 合并而非新增');
    {
      const r = await post('/api/initial', { text: '【持久化测试专用题】若关于 x 的方程 x^2+5x+p=0 有两个不相等的实数根，求 p。' });
      check('标记为合并', r.body.savedMistakes[0].merged === true);
      check('错题 ID 不变', r.body.savedMistakes[0].id === mkId);
      const st = await get('/api/stats');
      check('总数仍为基线 +1（去重生效）', st.body.stats.total === baseTotal + 1,
        'total=' + st.body.stats.total);
      check('错题次数累加为 2', st.body.stats.wrong_multiple >= 1);
      const m = (await get('/api/mistakes/' + mkId)).body.mistake;
      check('wrong_count = 2', m.wrong_count === 2, 'wrong_count=' + m.wrong_count);
      check('occurrences 记录了两次', m.occurrences.length === 2);
    }

    console.log('\n【4】批改结果自动回写错题集');
    {
      const r = await post('/api/grade', {
        record_id: recId,
        submitted_answers: [
          { mistake_id: 'm1', question_id: 'm1_q1', answer: 'A' },
          { mistake_id: 'm1', question_id: 'm1_q2', answer: '9' }
        ]
      });
      check('批改成功', r.status === 200, 'HTTP ' + r.status);
      check('返回 updatedMistakes', Array.isArray(r.body.updatedMistakes) && r.body.updatedMistakes.length === 1);
      const m = (await get('/api/mistakes/' + mkId)).body.mistake;
      check('掌握程度被更新（1对1错 → 基本掌握）', m.mastery === '基本掌握', 'mastery=' + m.mastery);
      check('复习次数 +1', m.review_count === 1);
      check('记录了批改时间', Boolean(m.last_review_at));
      check('变式题作答记录已保存', Object.keys(m.similar_attempts).length === 2,
        Object.keys(m.similar_attempts).join(','));
      check('m1_q2 记录为答错', m.similar_attempts.m1_q2.is_correct === false);
      check('grading_history 有 1 条', m.grading_history.length === 1);
    }

    console.log('\n【5】手动编辑：收藏 / 标签 / 笔记 / 掌握程度');
    {
      await fetch(APP + '/api/mistakes/' + mkId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ starred: true, tags: ['判别式', '易错'], note: '下次先看二次项系数' }) });
      let m = (await get('/api/mistakes/' + mkId)).body.mistake;
      check('收藏生效', m.starred === true);
      check('标签生效', m.tags.join(',') === '判别式,易错', m.tags.join(','));
      check('笔记生效', m.note === '下次先看二次项系数');

      await fetch(APP + '/api/mistakes/' + mkId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mastery: '掌握' }) });
      m = (await get('/api/mistakes/' + mkId)).body.mistake;
      check('手动改掌握程度生效', m.mastery === '掌握');

      const starred = await get('/api/mistakes?starred=true');
      check('按收藏筛选能查到这条', starred.body.items.some(x => x.id === mkId));
      const byTag = await get('/api/mistakes?q=判别式');
      check('按标签/关键词搜索能查到', byTag.body.items.some(x => x.id === mkId));
    }

    console.log('\n【6】落盘到磁盘（重启不丢）');
    {
      /* 落盘是防抖的（最长 400ms），等到本轮的记录与笔记都落盘再读 */
      const raw = await waitForDb(r =>
        r.records && r.records[recId] && r.mistakes && r.mistakes[mkId] && r.mistakes[mkId].note);
      check('data/db.json 存在', Boolean(raw), path.relative(ROOT, DB_PATH));
      check('db.json 里存有这条错题', Boolean(raw && raw.mistakes[mkId]));
      check('db.json 里存有记录与锁定答案',
        Boolean(raw && raw.records[recId] && raw.records[recId].server_only.locked_solutions.length === 2));
      check('db.json 里保存了笔记与标签', raw && raw.mistakes[mkId].note === '下次先看二次项系数');
      const bdir = path.join(ROOT, 'data', 'backups');
      check('已生成当日备份', fs.existsSync(bdir) && fs.readdirSync(bdir).length > 0,
        fs.existsSync(bdir) ? fs.readdirSync(bdir).join(',') : '无');
      check('无残留 .tmp 文件', !fs.existsSync(DB_PATH + '.tmp'));
    }

    console.log('\n【7】导出');
    {
      const md = await fetch(APP + '/api/export?format=md');
      const mdt = await md.text();
      check('Markdown 导出 200', md.status === 200);
      check('Markdown 含标题与题目', /# 我的错题集/.test(mdt) && /有两个不相等的实数根/.test(mdt));
      check('Markdown 含错因与笔记', /错因分析/.test(mdt) && /下次先看二次项系数/.test(mdt));
      check('Markdown 带下载头', /attachment/.test(md.headers.get('content-disposition') || ''));

      const csv = await (await fetch(APP + '/api/export?format=csv')).text();
      check('CSV 含表头', /添加时间/.test(csv) && /掌握程度/.test(csv));
      const mm = (await get('/api/mistakes/' + mkId)).body.mistake;
      const dd = new Date(mm.created_at);
      const p2 = n => String(n).padStart(2, '0');
      const expect = dd.getFullYear() + '-' + p2(dd.getMonth() + 1) + '-' + p2(dd.getDate()) +
        ' ' + p2(dd.getHours()) + ':' + p2(dd.getMinutes());
      check('CSV 时间是本地时间而非 UTC', csv.split('\r\n')[1].indexOf(expect) > -1, expect);
      check('CSV 含题目行', /有两个不相等的实数根/.test(csv));

      const js = await (await fetch(APP + '/api/export?format=json')).json();
      check('JSON 备份含 mistakes 与 records', Boolean(js.mistakes && js.records && js.exported_at));
    }

    console.log('\n【8】删除');
    {
      const r = await fetch(APP + '/api/mistakes/' + mkId, { method: 'DELETE' });
      check('删除成功', r.status === 200);
      const st = await get('/api/stats');
      check('总数回到基线', st.body.stats.total === baseTotal, 'total=' + st.body.stats.total);
    }

  } catch (e) {
    console.log('  [ERROR] ' + e.message + '\n' + e.stack);
    fail++;
  } finally {
    if (orig === null) fs.existsSync(CONFIG_PATH) && fs.unlinkSync(CONFIG_PATH);
    else fs.writeFileSync(CONFIG_PATH, orig);
    mock.close();
  }

  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
