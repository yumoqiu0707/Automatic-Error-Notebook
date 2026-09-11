/**
 * 一键分享给朋友 —— 把本机服务变成一个公网 HTTPS 网址
 *
 *   node share.js                     随机口令，端口 5178
 *   node share.js --code 888888       指定访问口令
 *   node share.js --port 5190         指定本机服务端口
 *
 * 自动选通道（优先前者）：
 *   1. cloudflared  —— 需要 tools/cloudflared（Windows 上是 cloudflared.exe），无时长限制，网址不暴露 IP
 *   2. pinggy（SSH）—— 系统自带 ssh，零下载，但免费版 60 分钟失效
 *                      且网址里会带你的公网 IP（在意隐私就用 cloudflared）
 *
 * 做了三件事：
 *   1. 把访问口令写进 config.json（需要重启服务才生效，会提示）
 *   2. 建立隧道，拿到公网 HTTPS 网址
 *   3. 打印分享链接 + 生成二维码页面并自动打开
 *
 * 按 Ctrl+C 结束分享（网址随即失效）。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, exec } = require('child_process');

const QR = require('./qr');

const ROOT = __dirname;
const CF_NAME = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const CF = path.join(ROOT, 'tools', CF_NAME);
const CONFIG_PATH = path.join(ROOT, 'config.json');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : dflt;
}
const CODE = arg('code', 'ctj' + Math.floor(1000 + Math.random() * 9000));
const PORT = Number(arg('port', 5178));
const OFF = argv.indexOf('--off') > -1;

/* --off：关掉访问口令，恢复成本机自用（不发链接给任何人） */
if (OFF) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
  delete cfg.access_code;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  console.log('\n  已关闭访问口令（config.json 里的 access_code 已移除）。');
  console.log('  重启「错题集助手」后，本机访问就像以前一样直接进，不用口令。\n');
  process.exit(0);
}

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const line = '─'.repeat(52);

function openUrl(u) {
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [u], { stdio: 'ignore', detached: true }).unref(); } catch (e) {}
}

function probe() {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/lan', timeout: 2500 }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        let j = {};
        try { j = JSON.parse(d); } catch (e) {}
        resolve({ up: true, codeOn: j.access_code_on === true, status: r.statusCode });
      });
    }).on('error', () => resolve({ up: false }));
  });
}

/* cloudflared 真的能跑吗？（文件存在 ≠ 能用，下载中断会留下半个 exe） */
function cfUsable() {
  if (!fs.existsSync(CF)) return false;
  if (fs.statSync(CF).size < 20 * 1024 * 1024) return false;   // 完整版 50MB+，太小肯定是残file
  try {
    const r = require('child_process').spawnSync(CF, ['--version'], { timeout: 15000 });
    return r.status === 0 && /cloudflared/i.test(String(r.stdout || '') + String(r.stderr || ''));
  } catch (e) {
    return false;
  }
}

function writeAccessCode(code) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
  cfg.access_code = code;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function qrHtml(url, backend) {
  const extra = backend === 'pinggy'
    ? '<br>· 这是免费 SSH 通道，<b>60 分钟后失效</b>，网址里还带你的公网 IP'
    : '';
  const svg = QR.generateSVG(url, { size: 240, margin: 2 });
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>分享 · 错题集助手</title><style>' +
    '*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
    'background:#f6f7fb;color:#1c2024;display:flex;justify-content:center;padding:24px}' +
    '.card{background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(20,30,60,.10);padding:28px 30px;max-width:600px;width:100%}' +
    'h1{margin:0 0 4px;font-size:20px}p.sub{margin:0 0 18px;color:#6a7381;font-size:13px}' +
    '.qr{background:#fff;border:1px solid #e6e9ef;border-radius:12px;padding:10px;display:inline-block}' +
    '.qr svg{display:block;width:230px;height:230px}' +
    '.url{margin-top:14px;font-family:ui-monospace,Consolas,monospace;font-size:14px;background:#f2f5fa;' +
    'border:1px solid #e2e7f0;border-radius:8px;padding:10px 12px;word-break:break-all}' +
    '.code{display:inline-block;margin-top:10px;background:#eef3ff;color:#2f4bd8;border:1px solid #c9d6ff;' +
    'border-radius:7px;padding:5px 11px;font-family:ui-monospace,Consolas,monospace;font-size:14px}' +
    'ol{margin:18px 0 0;padding-left:20px;line-height:1.9;font-size:14px}' +
    '.warn{margin-top:18px;background:#fff7e6;border:1px solid #ffe0a3;border-radius:10px;padding:12px 14px;' +
    'font-size:13px;color:#8a5a00;line-height:1.75}' +
    '</style></head><body><div class="card">' +
    '<h1>把这条链接发给朋友</h1>' +
    '<p class="sub">朋友点开就能用，不用装任何东西</p>' +
    '<div class="qr">' + svg + '</div>' +
    '<div class="url">' + url + '</div>' +
    '<div class="code">访问口令 ' + CODE + '</div>' +
    '<ol><li>复制上面的链接，微信发给朋友</li><li>朋友用手机或电脑浏览器打开，自动通过口令验证</li>' +
    '<li>手机浏览器菜单 →「添加到主屏幕」，就能当成 App 用</li></ol>' +
    '<div class="warn">' +
    '· <b>你的电脑必须一直开着</b>，关掉程序或关机，链接就失效了<br>' +
    '· 网址是<b>临时的</b>：每次重新运行本脚本都会变，要发给朋友就别关这个窗口<br>' +
    '· 朋友做的题会存进<b>你这台电脑</b>的错题集（和你自己的混在一起）<br>' +
    '· 朋友用的是<b>你的 API 额度</b>，口令已经开了，外人拿到网址也进不来' + extra +
    '</div></div></body></html>';
}

(async () => {
  console.log('\n' + C.b + '错题集助手 · 一键分享' + C.x + '\n' + line + '\n');

  /* 1. 选通道 —— 都不可用时给出可操作的指引
     注意：不能只看文件在不在。下载中断会留下半个 exe，直接跑会 EBUSY / 不是有效程序，
     所以必须真的执行 --version 验一次。 */
  const backend = cfUsable() ? 'cloudflared' : 'pinggy';
  if (backend === 'pinggy') {
    console.log(C.y + '  未找到 tools/' + CF_NAME + '，改用系统自带 SSH 通道（免费版 60 分钟后失效）。' + C.x);
    console.log(C.d + '  想要不限时且不暴露 IP：把 ' + CF_NAME + ' 放到 tools/ 目录再运行本脚本。' + C.x + '\n');
  }

  /* 2. 本机服务在跑吗 */
  const p = await probe();
  if (!p.up) {
    console.log(C.r + '  本机服务没在运行（端口 ' + PORT + ' 没响应）' + C.x);
    console.log('  请先启动「错题集助手」——Windows 双击 启动错题集助手.bat；macOS/Linux 在终端里 bash start.sh，再回来执行分享。\n');
    process.exit(1);
  }

  /* 3. 口令 */
  writeAccessCode(CODE);
  if (!p.codeOn) {
    console.log(C.y + '  访问口令已写入 config.json，但当前运行的服务还没启用它。' + C.x);
    console.log('  要让口令生效，请：关掉现在那个「错题集助手」黑窗口，再重新双击启动脚本。');
    console.log('  （不重启也能分享，只是没有口令保护 —— ' + C.r + '不建议' + C.x + '）\n');
  } else {
    console.log(C.g + '  ✓ 访问口令已启用：' + CODE + C.x + '\n');
  }

  /* 4. 起隧道 */
  console.log('  正在建立公网隧道（' + backend + '）…\n');

  let cf, buf = '', got = null, expireNote = '';

  if (backend === 'cloudflared') {
    cf = spawn(CF, ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    cf = spawn('ssh', [
      '-p', '443',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-R0:localhost:' + PORT,
      'a.pinggy.io'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  function onData(s) {
    buf += s.toString();
    if (got) return;
    const m = backend === 'cloudflared'
      ? buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
      : buf.match(/https:\/\/[a-z0-9.-]+\.(?:pinggy\.net|pinggy-free\.link)/i);
    if (m) got = m[0];
  }
  cf.stdout.on('data', onData);
  cf.stderr.on('data', onData);

  for (let i = 0; i < 180 && !got; i++) await new Promise(r => setTimeout(r, 500));

  if (!got) {
    console.log(C.r + '  隧道建立失败，输出如下：' + C.x);
    console.log(C.d + buf.slice(-1200) + C.x + '\n');
    cf.kill();
    process.exit(1);
  }

  if (backend === 'pinggy') {
    expireNote = '· 这是 SSH 通道的免费版，' + C.y + '60 分钟后失效' + C.x + '，网址里还会带上你的公网 IP\n  ';
  }

  const shareUrl = got + '/?code=' + encodeURIComponent(CODE);

  console.log(line);
  console.log(C.g + C.b + '\n  把这个链接发给朋友：\n' + C.x);
  console.log('  ' + C.b + shareUrl + C.x + '\n');
  console.log('  二维码页面已生成，即将在浏览器打开。\n');
  console.log(line);
  console.log(C.y + '  注意：这个窗口关掉 = 网址失效。朋友用完之前别关。' + C.x);
  console.log('  ' + expireNote + C.d + '按 Ctrl+C 结束分享。' + C.x + '\n');

  const out = path.join(ROOT, '_share.html');
  fs.writeFileSync(out, qrHtml(shareUrl, backend), 'utf8');
  setTimeout(() => openUrl(out), 300);

  const stop = () => { try { cf.kill(); } catch (e) {} process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  cf.on('exit', () => { console.log('\n  隧道已关闭。\n'); process.exit(0); });
})();
