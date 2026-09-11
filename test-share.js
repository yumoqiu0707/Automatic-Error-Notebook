/**
 * 分享能力测试：访问口令 + 公网地址
 *
 * 用一个隔离的临时目录（CUOTIJI_HOME）起一个独立实例，端口 5199，
 * 不碰用户正在运行的服务，也不碰真实 data/db.json。
 *
 *   node test-share.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const TMP = path.join(ROOT, '_gatetest');
const PORT = 5199;
const CODE = 'abc123';
const PUBLIC_URL = 'https://demo-share.trycloudflare.com';

let pass = 0, fail = 0;
function ok(name, extra) {
  pass++;
  console.log('  [PASS] ' + name + (extra ? '  → ' + extra : ''));
}
function bad(name, extra) {
  fail++;
  console.log('  [FAIL] ' + name + (extra ? '  → ' + extra : ''));
}
function assert(cond, name, extra) { cond ? ok(name, extra) : bad(name, extra); }

/* ---------- 准备隔离目录 ---------- */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    e.isDirectory() ? rmDir(p) : fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

function req(pathname, headers) {
  return new Promise((resolve) => {
    const http = require('http');
    http.get({ host: '127.0.0.1', port: PORT, path: pathname, headers: headers || {}, timeout: 5000 }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d, headers: r.headers }));
    }).on('error', e => resolve({ status: 0, body: String(e.code) }));
  });
}

(async () => {
  console.log('\n分享能力测试（访问口令 / 公网地址）\n' + '─'.repeat(46));

  rmDir(TMP);
  copyDir(path.join(ROOT, 'public'), path.join(TMP, 'public'));
  fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({
    base_url: 'https://api.deepseek.com/v1', api_key: 'sk-test-not-real', model: 'deepseek-chat'
  }), 'utf8');

  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--no-open'], {
    cwd: TMP,
    env: Object.assign({}, process.env, {
      CUOTIJI_HOME: TMP, PORT: String(PORT), ACCESS_CODE: CODE, PUBLIC_URL: PUBLIC_URL
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let banner = '';
  child.stdout.on('data', c => banner += c.toString());
  child.stderr.on('data', c => banner += c.toString());

  /* 等服务起来 */
  let up = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 300));
    const r = await req('/api/status');
    if (r.status === 200 || r.status === 401) { up = true; break; }
  }

  if (!up) {
    bad('服务能在隔离目录启动', banner.slice(-400));
    child.kill(); rmDir(TMP);
    console.log('\n  通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
    process.exitCode = 1;
    return;
  }
  ok('服务能在隔离目录启动');

  console.log('\n【1】未带口令 → 一律拒绝');
  let r = await req('/');
  assert(r.status === 401, '页面返回 401', 'HTTP ' + r.status);
  assert(r.body.includes('访问口令'), '页面是口令输入页而不是首页');

  r = await req('/api/status');
  assert(r.status === 401, '接口返回 401', 'HTTP ' + r.status);
  let j = {};
  try { j = JSON.parse(r.body); } catch (e) {}
  assert(j.error === 'ACCESS_CODE_REQUIRED', '接口给出机器可读错误码', j.error);

  console.log('\n【2】口令错误 → 仍然拒绝');
  r = await req('/?code=wrong');
  assert(r.status === 401, '错误口令返回 401', 'HTTP ' + r.status);
  r = await req('/api/mistakes?code=wrong');
  assert(r.status === 401, '错误口令调用接口返回 401', 'HTTP ' + r.status);

  console.log('\n【3】口令正确 → 放行并种 Cookie');
  r = await req('/?code=' + CODE);
  assert(r.status === 200, '页面返回 200', 'HTTP ' + r.status);
  const setCookie = String(r.headers['set-cookie'] || '');
  assert(setCookie.includes('ctj_access='), '返回了 Set-Cookie', setCookie.split(';')[0]);
  assert(setCookie.includes('HttpOnly'), 'Cookie 带 HttpOnly');
  const cookie = setCookie.split(';')[0];

  console.log('\n【4】带 Cookie 再访问 → 不用再带口令');
  r = await req('/', { Cookie: cookie });
  assert(r.status === 200, '首页返回 200', 'HTTP ' + r.status);
  r = await req('/api/status', { Cookie: cookie });
  assert(r.status === 200, '接口返回 200', 'HTTP ' + r.status);
  assert(r.body.includes('"configured"'), '接口内容正常');

  console.log('\n【5】Cookie 里不能出现明文口令');
  assert(!cookie.toLowerCase().includes(CODE), 'Cookie 值是哈希，不含明文口令');

  console.log('\n【6】/api/lan 暴露公网地址与分享链接');
  r = await req('/api/lan', { Cookie: cookie });
  assert(r.status === 200, '/api/lan 可访问', 'HTTP ' + r.status);
  j = JSON.parse(r.body);
  assert(j.public_url === PUBLIC_URL, '返回公网地址', j.public_url);
  assert(j.share_url === PUBLIC_URL + '/?code=' + CODE, '分享链接自带口令', j.share_url);
  assert(j.access_code_on === true, '标记口令已开启');
  assert(typeof j.qr_svg === 'string' && j.qr_svg.includes('<svg'), '二维码基于公网地址生成');

  console.log('\n【7】启动横幅提示口令与公网链接');
  assert(banner.includes('访问口令：已开启'), '横幅显示口令已开启');
  assert(banner.includes('?code=' + CODE), '横幅显示带口令的链接');
  assert(banner.includes(PUBLIC_URL), '横幅显示公网地址');

  console.log('\n【8】未设口令时行为不变（回归）');
  child.kill();
  await new Promise(r2 => setTimeout(r2, 800));

  const child2 = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--no-open'], {
    cwd: TMP,
    env: Object.assign({}, process.env, { CUOTIJI_HOME: TMP, PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let banner2 = '';
  child2.stdout.on('data', c => banner2 += c.toString());
  let up2 = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r2 => setTimeout(r2, 300));
    const rr = await req('/api/status');
    if (rr.status === 200) { up2 = true; break; }
  }
  assert(up2, '无口令实例能启动');
  if (up2) {
    const rr = await req('/');
    assert(rr.status === 200, '无口令时首页直接可访问（与以前一致）', 'HTTP ' + rr.status);
    const rj = await req('/api/lan');
    const jj = JSON.parse(rj.body);
    assert(jj.access_code_on === false, '标记口令未开启');
    assert(jj.public_url === null, '无公网地址时为 null');
    assert(banner2.includes('访问口令：未开启'), '横幅提示未开启口令');
  }
  child2.kill();

  await new Promise(r2 => setTimeout(r2, 500));
  rmDir(TMP);

  console.log('\n' + '─'.repeat(46));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (banner2 && fail) console.log('\n--- 第二个实例输出 ---\n' + banner2.slice(-600));
  console.log('');
  process.exitCode = fail ? 1 : 0;
})();
