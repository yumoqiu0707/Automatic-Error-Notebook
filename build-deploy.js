/**
 * 生成一个干净的部署目录 deploy/
 *
 * 只拷运行必需的文件，刻意排除：
 *   dist/   87MB 的 exe，没必要上云
 *   data/   你本机的真实错题（含 server_only 锁定答案），绝不能带上去
 *   build/  打包中间产物 + node_modules
 *   test-*  测试脚本
 *   share.js / *.bat  隧道分享用的，云端不需要
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'deploy');

const CODE = process.argv[2] || '246810';

function rmDir(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? rmDir(p) : fs.unlinkSync(p);
  }
  fs.rmdirSync(d);
}
function copyDir(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const e of fs.readdirSync(s, { withFileTypes: true })) {
    const a = path.join(s, e.name), b = path.join(d, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

rmDir(OUT);
fs.mkdirSync(OUT, { recursive: true });

/* 1. 后端源码 */
['server.js', 'db.js', 'system-prompt.js', 'paths.js', 'qr.js'].forEach(f => {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  console.log('  + ' + f);
});

/* 2. 前端资源（排除早期写死的模拟版） */
const pubOut = path.join(OUT, 'public');
fs.mkdirSync(pubOut, { recursive: true });
let n = 0;
for (const e of fs.readdirSync(path.join(ROOT, 'public'), { withFileTypes: true })) {
  if (e.name === 'mock-demo.html') continue;
  const a = path.join(ROOT, 'public', e.name), b = path.join(pubOut, e.name);
  e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  n++;
}
console.log('  + public/  (' + n + ' 项)');

/* 3. 配置：带上模型密钥，开口令，关掉视觉（DeepSeek 不支持） */
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const deployCfg = {
  base_url: cfg.base_url,
  api_key: cfg.api_key,
  model: cfg.model,
  vision: false,                 // deepseek-chat 是纯文字模型，别给朋友一个点了就报错的拍照按钮
  temperature: 0.2,
  top_p: 0.8,
  use_json_mode: true,
  host: '0.0.0.0',               // 云端必须监听全部网卡
  access_code: CODE              // 公网必须开口令，否则谁都能刷你的额度
};
fs.writeFileSync(path.join(OUT, 'config.json'), JSON.stringify(deployCfg, null, 2), 'utf8');
console.log('  + config.json  (model=' + deployCfg.model + ', vision=false, access_code=' + CODE + ')');

/* 4. package.json */
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({
  name: 'cuotiji-assistant',
  version: '1.1.0',
  private: true,
  description: '错题集生成与知识点拓展助手',
  main: 'server.js',
  scripts: { start: 'node server.js --no-open' },
  engines: { node: '>=18' }
}, null, 2), 'utf8');
console.log('  + package.json');

/* 5. 体积与自检 */
function sizeOf(p) {
  let t = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    t += e.isDirectory() ? sizeOf(f) : fs.statSync(f).size;
  }
  return t;
}
const total = sizeOf(OUT);
console.log('\n  部署目录总体积：' + (total / 1024 / 1024).toFixed(2) + ' MB');

/* 自检：关键文件必须在 */
const must = [
  'server.js', 'db.js', 'system-prompt.js', 'paths.js', 'qr.js',
  'package.json', 'config.json',
  'public/index.html', 'public/manifest.webmanifest', 'public/sw.js',
  'public/assets/cover.jpg', 'public/icons/icon-192.png'
];
const missing = must.filter(f => !fs.existsSync(path.join(OUT, f)));
if (missing.length) {
  console.error('\n  [错误] 缺少文件：' + missing.join(', '));
  process.exit(1);
}
console.log('  关键文件自检：' + must.length + '/' + must.length + ' 齐全');
console.log('  data/ 未包含 → 云端会从空白错题集开始，不会混入你本机的题\n');
