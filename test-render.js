/* 渲染验证：桩化 DOM，喂入真实接口数据，检查科目分组的输出结构
 * 断言全部基于实际数据计算，不写死数量，因此可以随时重复运行。 */
const fs = require('fs');
const vm = require('vm');

/* 本机服务若开启了访问口令（config.json 里的 access_code），测试请求自动带上 ?code=，
   等价于本机浏览器自用（启动时打开的链接本就会自动带口令）。 */
(function installAccessCodeShim() {
  let code = '';
  try { code = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8')).access_code || ''; } catch (e) {}
  if (!code) return;
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('127.0.0.1') > -1 && url.indexOf('code=') === -1) {
      url += (url.indexOf('?') > -1 ? '&' : '?') + 'code=' + encodeURIComponent(code);
    }
    return origFetch.call(this, url, opts);
  };
})();

const html = fs.readFileSync('public/index.html', 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---------- DOM 桩：同一选择器返回同一对象 ---------- */
const els = {};
function mkEl(key) {
  const o = {
    _html: '', _text: '', value: '', checked: false,
    style: {}, dataset: {}, tagName: 'DIV',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, scrollIntoView() {}, closest() { return null; },
    querySelector() { return mkEl('__inner'); }, querySelectorAll() { return []; }
  };
  Object.defineProperty(o, 'innerHTML', { get() { return o._html; }, set(v) { o._html = v; } });
  Object.defineProperty(o, 'textContent', { get() { return o._text; }, set(v) { o._text = v; } });
  return o;
}
function q(sel) { if (!els[sel]) els[sel] = mkEl(sel); return els[sel]; }

global.document = {
  querySelector: q,
  querySelectorAll: () => [],
  createElement: () => mkEl('__created'),
  body: { appendChild() {}, removeChild() {} },
  head: { appendChild() {} }
};
global.window = { addEventListener() {}, location: { search: '' }, scrollTo() {} };
global.navigator = {};
global.location = { search: '', href: '' };
global.alert = m => console.log('ALERT >>', m);
global.confirm = () => false;

vm.runInThisContext(code);

const count = (s, re) => (s.match(re) || []).length;
const strip = h => h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '\u0001')
  .split('\u0001').map(t => t.trim()).filter(Boolean);

(async () => {
  const B = process.env.CTJ_TEST_BASE || 'http://127.0.0.1:5178';
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(B + '/api/status'); if (r.ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
  }
  API_OK = true;
  const d = await (await fetch(B + '/api/mistakes')).json();
  const s = await (await fetch(B + '/api/stats')).json();
  const sub = await (await fetch(B + '/api/subjects')).json();
  book.all = d.items;
  book.stats = s.stats;
  book.subjects = sub.subjects;

  /* 期望值全部由数据推导 */
  const ALL = book.all;
  const N = ALL.length;
  const subjOf = m => (m.subject && String(m.subject).trim()) || '未分类';
  const subjects = Array.from(new Set(ALL.map(subjOf)));
  const mathN = ALL.filter(m => subjOf(m) === '数学').length;
  const topicKeys = new Set(ALL.map(m => subjOf(m) + '|' + ((m.topic_path || []).slice(-1)[0] || '未归类')));

  let pass = 0, fail = 0;
  const check = (n, c, x) => { console.log((c ? '  [PASS] ' : '  [FAIL] ') + n + (x ? '  → ' + x : '')); c ? pass++ : fail++; };

  console.log('\n数据基线：' + N + ' 道题 / ' + subjects.length + ' 个科目（' + subjects.join('、') + '）');

  console.log('\n【1】科目导航条');
  renderBook();
  const nav = els['#subject-nav']._html;
  check('含「全部科目」入口', /全部科目/.test(nav));
  subjects.forEach(s2 => check('科目导航含「' + s2 + '」', nav.indexOf('>' + s2 + '<') > -1));
  check('每个科目显示题量', new RegExp('>' + mathN + '</').test(nav), '数学 ' + mathN + ' 道');
  check('有待复习数量提示', /待复习/.test(nav) || N === 0);

  console.log('\n【2】统计卡片');
  const cards = els['#stat-cards']._html;
  check('含「涉及科目」卡片', /涉及科目/.test(cards));
  check('错题总数正确', new RegExp('>' + N + '<').test(cards), N + ' 道');
  check('科目数正确', new RegExp('>' + subjects.length + '<').test(cards), subjects.length + ' 个');

  console.log('\n【3】按科目分组（默认视图）');
  const list = els['#book-list']._html;
  check('分组数量 = 科目数', count(list, /class="grp"/g) === subjects.length,
    count(list, /class="grp"/g) + ' 个分组');
  subjects.forEach(s2 => check('分组含「' + s2 + '」', list.indexOf(s2) > -1));
  check('分组头部有「待复习 / 已掌握 / 总题数」', /待复习/.test(list) && /已掌握/.test(list) && /总题数/.test(list));
  check('分组头部有掌握度进度条', /掌握度 \d+%/.test(list), (list.match(/掌握度 \d+%/) || [])[0]);
  check('所有题卡都渲染出来', count(list, /class="bk-card/g) === N,
    count(list, /class="bk-card/g) + ' / ' + N + ' 张');

  console.log('\n【4】科目筛选：只看数学');
  book.subject = '数学';
  renderBook();
  const mathList = els['#book-list']._html;
  check('只剩 1 个分组', count(mathList, /class="grp"/g) === 1);
  check('只含数学题卡', count(mathList, /class="bk-card/g) === mathN, mathN + ' 张');
  const otherSubjects = subjects.filter(x => x !== '数学');
  check('不出现其它科目的题', otherSubjects.every(x => mathList.indexOf('>' + x + '<') === -1),
    otherSubjects.join('、') + ' 均未出现');
  book.subject = 'all';

  console.log('\n【5】组内按知识点细分');
  book.byTopic = true;
  renderBook();
  const byTopic = els['#book-list']._html;
  check('知识点子分组数 = 去重后的（科目,知识点）组合数',
    count(byTopic, /class="topic-grp"/g) === topicKeys.size,
    count(byTopic, /class="topic-grp"/g) + ' / ' + topicKeys.size);
  check('数学组内按知识点拆开', ALL.filter(m => subjOf(m) === '数学')
    .every(m => byTopic.indexOf((m.topic_path || []).slice(-1)[0] || '未归类') > -1));
  check('知识点子分组带折叠控件', /data-act="collapse" data-key="t:/.test(byTopic));
  check('细分后题卡总数不变', count(byTopic, /class="bk-card/g) === N);
  book.byTopic = false;

  console.log('\n【6】分组折叠');
  book.collapsed['s:数学'] = true;
  renderBook();
  const collapsed = els['#book-list']._html;
  check('折叠后该分组带 collapsed 类', /class="grp collapsed"/.test(collapsed));
  check('折叠由样式表控制（存在隐藏规则）', /\.grp\.collapsed \.grp-body\{display:none;\}/.test(html));
  book.collapsed = {};

  console.log('\n【7】筛选预设');
  book.preset = 'due'; renderBook();
  const dueN = ALL.filter(m => m.mastery !== '掌握' && (!m.last_review_at ||
    Date.now() - new Date(m.last_review_at).getTime() > 3 * 86400000)).length;
  check('待复习筛选题量正确', count(els['#book-list']._html, /class="bk-card/g) === dueN, dueN + ' 道');
  book.preset = 'weak'; renderBook();
  const weakN = ALL.filter(m => m.mastery === '未掌握').length;
  check('未掌握筛选题量正确', weakN === 0
    ? /当前筛选条件下没有错题/.test(els['#book-list']._html)
    : count(els['#book-list']._html, /class="bk-card/g) === weakN, weakN + ' 道');
  book.preset = 'starred'; renderBook();
  const starN = ALL.filter(m => m.starred).length;
  check('已收藏筛选题量正确', starN === 0
    ? /当前筛选条件下没有错题/.test(els['#book-list']._html)
    : count(els['#book-list']._html, /class="bk-card/g) === starN, starN + ' 道');
  book.preset = 'all';

  console.log('\n【8】渲染文本抽样（去标签）');
  renderBook();
  const texts = strip(els['#book-list']._html);
  console.log('  前 18 段：');
  console.log('    ' + texts.slice(0, 18).join(' | '));

  console.log('\n────────────────────────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exitCode = fail ? 1 : 0;
})();
