/* 验证打包后的 exe 能否独立运行（不依赖 Node、不依赖当前工作目录） */
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, 'dist', '错题集助手');
const EXE = path.join(APP_DIR, '错题集助手.exe');
const PORT = 5180;

console.log('exe 路径：' + EXE);
console.log('exe 大小：' + (fs.statSync(EXE).size / 1048576).toFixed(1) + ' MB');
console.log('目录内容：' + fs.readdirSync(APP_DIR).join('  '));
console.log('');

/* 故意把工作目录设成 C:\ —— 验证程序是靠 exe 位置找资源，而不是靠 cwd */
const child = cp.spawn(EXE, [], {
  cwd: 'C:\\',
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  windowsHide: true
});

let out = '', err = '';
child.stdout.on('data', d => out += d.toString('utf8'));
child.stderr.on('data', d => err += d.toString('utf8'));

setTimeout(async () => {
  let pass = 0, fail = 0;
  const check = (n, c, x) => { console.log((c ? '  [PASS] ' : '  [FAIL] ') + n + (x ? '  → ' + x : '')); c ? pass++ : fail++; };

  console.log('=== 子进程输出 ===');
  out.split('\n').filter(l => l.trim()).forEach(l => console.log('  ' + l));
  if (err.trim()) { console.log('  [stderr] ' + err.trim()); }

  console.log('\n=== 功能验证 ===');
  try {
    const st = await (await fetch('http://127.0.0.1:' + PORT + '/api/status')).json();
    check('服务已启动', true, '错题 ' + st.mistakes + ' 道 / 模型 ' + st.model);

    const page = await (await fetch('http://127.0.0.1:' + PORT + '/')).text();
    check('前端页面能读到（exe 相对路径生效）', page.indexOf('我的错题集') > -1,
      page.length + ' 字节');

    const man = await fetch('http://127.0.0.1:' + PORT + '/manifest.webmanifest');
    check('PWA 清单可访问', man.status === 200);

    const icon = await fetch('http://127.0.0.1:' + PORT + '/icons/icon-512.png');
    check('图标可访问', icon.status === 200 && (await icon.arrayBuffer()).byteLength > 1000);

    const cover = await fetch('http://127.0.0.1:' + PORT + '/assets/cover.jpg');
    check('封面图可访问', cover.status === 200 && (await cover.arrayBuffer()).byteLength > 1000);
    check('页面含标语「菜就多练！」', page.indexOf('菜就多练！') > -1);

    /* 手机访问：局域网地址 + 二维码 */
    const lan = await (await fetch('http://127.0.0.1:' + PORT + '/api/lan')).json();
    check('监听地址为 0.0.0.0（允许手机访问）', lan.bound === '0.0.0.0', lan.bound);
    check('返回局域网网址', Array.isArray(lan.urls) && lan.urls.length > 0,
      (lan.urls || []).join('  ') || '(未检测到网卡)');
    check('生成了二维码 SVG', typeof lan.qr_svg === 'string' && lan.qr_svg.indexOf('<svg') === 0,
      lan.qr_svg ? (lan.qr_svg.length / 1024).toFixed(1) + ' KB' : '无');

    /* 真实写入一条错题，验证数据落在 exe 旁边而不是 cwd */
    const payload = {
      status: 'ok', stage: 'INITIAL', message: '',
      user_visible: {
        mistakes: [{
          mistake_id: 'm1', subject: '数学', grade: '初二',
          topic_path: ['初中数学', '数与式', '有理数运算'],
          difficulty: '基础', question_type: '填空题',
          question: { stem: '【exe 自检题】计算 $(-3)+5$ 的值。', options: [], figure_description: '', blanks: [] },
          user_answer: null, correct_answer: '$2$',
          answer_explanation: '$(-3)+5=2$。',
          error_analysis: { where_wrong: '未识别到作答', error_type: '其他', root_cause: '无', knowledge_gap: [] },
          knowledge_review: { definition: '异号两数相加取绝对值较大数的符号', formulas: [], conditions: [], steps: [], common_mistakes: [], method_summary: '' },
          similar_questions: [
            { question_id: 'm1_q1', stem: '计算 $(-7)+4$。', options: [], answer_locked: true, submit_required: true },
            { question_id: 'm1_q2', stem: '计算 $8+(-3)$。', options: [], answer_locked: true, submit_required: true }
          ]
        }],
        next_action: '请完成同类型题并提交答案。'
      },
      server_only: {
        locked_solutions: [
          { mistake_id: 'm1', question_id: 'm1_q1', correct_answer: '$-3$', explanation: '', scoring_points: [], knowledge_point: '', common_mistakes: [] },
          { mistake_id: 'm1', question_id: 'm1_q2', correct_answer: '$5$', explanation: '', scoring_points: [], knowledge_point: '', common_mistakes: [] }
        ]
      }
    };
    const ing = await fetch('http://127.0.0.1:' + PORT + '/api/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'initial', raw: JSON.stringify(payload) })
    });
    check('能写入错题', ing.status === 200);

    await new Promise(r => setTimeout(r, 900));   // 等防抖落盘
    const dbPath = path.join(APP_DIR, 'data', 'db.json');
    check('数据文件写在 exe 旁边', fs.existsSync(dbPath), dbPath);
    check('数据内容正确', fs.existsSync(dbPath) &&
      fs.readFileSync(dbPath, 'utf8').indexOf('exe 自检题') > -1);
    check('备份目录已创建', fs.existsSync(path.join(APP_DIR, 'data', 'backups')));
    check('没有污染 C 盘根目录', !fs.existsSync('C:\\data'));
    check('分发的 exe 里没有带上我的 API Key',
      !fs.existsSync(path.join(APP_DIR, 'config.json')), 'config.json 未被打包（符合预期）');
  } catch (e) {
    check('服务可访问', false, e.message);
  }

  child.kill();
  setTimeout(() => {
    console.log('\n────────────────────────────');
    console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    process.exitCode = fail ? 1 : 0;
  }, 600);
}, 4000);
