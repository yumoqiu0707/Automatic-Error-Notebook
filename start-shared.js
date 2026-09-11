/**
 * 起一个「对外共享实例」并打通公网隧道
 *
 *   node start-shared.js [port] [code]
 *
 * 与你自己用的那份实例完全隔离：
 *   - 用 deploy/ 作为根目录（配置、数据都在那里）
 *   - data 写在 deploy/data，朋友的错题不会混进你本机的错题集
 *   - 强制开访问口令
 * 这个进程要一直开着，网址才有效。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = __dirname;
const DEPLOY = path.join(ROOT, 'deploy');
const PORT = Number(process.argv[2] || 5188);
const CODE = process.argv[3] || '246810';

if (!fs.existsSync(path.join(DEPLOY, 'public', 'index.html'))) {
  console.error('缺少 deploy/public —— 请先运行 node build-deploy.js');
  process.exit(1);
}

/* 确保口令写进共享实例的配置 */
const cfgPath = path.join(DEPLOY, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.access_code = CODE;
cfg.host = '0.0.0.0';
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

const srv = spawn(process.execPath, ['server.js', '--no-open'], {
  cwd: DEPLOY,
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let srvOut = '';
srv.stdout.on('data', c => { srvOut += c.toString(); });
srv.stderr.on('data', c => { srvOut += c.toString(); });

function local(p) {
  return new Promise(res => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 3000 }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => res({ s: r.statusCode, b: d }));
    }).on('error', e => res({ s: 0, b: String(e.code) }));
  });
}

const RE = /https:\/\/[a-z0-9.-]+\.(?:pinggy\.net|pinggy-free\.link)/i;

(async () => {
  let up = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 300));
    const r = await local('/api/lan');
    if (r.s === 200 || r.s === 401) { up = true; break; }
  }
  if (!up) {
    console.error('共享实例启动失败：\n' + srvOut.slice(-800));
    process.exit(1);
  }

  const ssh = spawn('ssh', [
    '-p', '443', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes',
    '-R0:localhost:' + PORT, 'a.pinggy.io'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let buf = '';
  const on = d => { buf += d.toString(); };
  ssh.stdout.on('data', on); ssh.stderr.on('data', on);

  let base = null;
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 500));
    const m = buf.match(RE);
    if (m) { base = m[0]; break; }
  }

  if (!base) {
    console.error('隧道建立失败：\n' + buf.slice(-800));
    srv.kill(); process.exit(1);
  }

  console.log('SHARED_URL=' + base + '/?code=' + CODE);
  console.log('SHARED_BASE=' + base);
  console.log('SHARED_CODE=' + CODE);
  console.log('SHARED_PORT=' + PORT);
  console.log('SHARED_DATA=' + path.join(DEPLOY, 'data'));

  const stop = () => { try { ssh.kill(); } catch (e) {} try { srv.kill(); } catch (e) {} process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  ssh.on('exit', () => { srv.kill(); process.exit(0); });
  srv.on('exit', () => { ssh.kill(); process.exit(0); });
})();
