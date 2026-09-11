/* 测试运行器：先起一个「隔离数据目录」的应用实例，再依次跑各测试。
 *
 * 为什么需要它：test-api / test-e2e / test-render / test-persistence 都会真实写入
 * 错题数据（/api/ingest、/api/grade 等）。如果直接打你自己那个实例，就会污染你的
 * data/（错题次数被刷高、留下大量测试记录）。这里用一个临时数据目录起实例，
 * 跑完即删，你的真实 data/ 不受影响。
 *
 * 用法：npm test      （无需先手动启动服务）
 *       node test-runner.js
 */
const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TESTS = [
  'test-api.js', 'test-e2e.js', 'test-persistence.js',
  'test-render.js', 'test-qr.js', 'test-share.js'
];

/* 找一个空闲端口，避免和你正在运行的实例（默认 5178）冲突 */
function freePort(preferred, attempts) {
  attempts = attempts || 0;
  return new Promise((resolve) => {
    if (attempts > 50) return resolve(0);
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(freePort(preferred + 1, attempts + 1)));
    srv.listen(preferred, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function waitForServer(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(base + '/api/status');
        if (r.status === 200 || r.status === 401) return resolve();
      } catch (e) { /* 尚未就绪 */ }
      if (Date.now() > deadline) return reject(new Error('应用实例启动超时'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

function run(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, file)], { cwd: ROOT, env: env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code == null ? 1 : code));
  });
}

(async () => {
  const port = await freePort(5190);
  if (!port) { console.error('[test-runner] 找不到空闲端口'); process.exitCode = 1; return; }

  const base = 'http://127.0.0.1:' + port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuotiji-test-'));

  console.log('\n[test-runner] 隔离数据目录：' + dataDir);
  console.log('[test-runner] 应用实例：' + base + '\n');

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--no-open'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { CUOTIJI_DATA: dataDir, PORT: String(port), AUTO_OPEN: '0' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });

  const cleanup = () => {
    try { server.kill(); } catch (e) {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  };

  try {
    await waitForServer(base, 20000);
  } catch (e) {
    console.error('[test-runner] ' + e.message);
    console.error(serverLog);
    cleanup();
    process.exitCode = 1;
    return;
  }

  const env = Object.assign({}, process.env, { CTJ_TEST_BASE: base, CUOTIJI_DATA: dataDir });
  let code = 0;
  for (const t of TESTS) {
    const c = await run(t, env);
    if (c !== 0) {
      code = c;
      console.error('\n[test-runner] ' + t + ' 失败（exit ' + c + '），停止后续用例');
      break;
    }
  }

  cleanup();
  console.log('\n[test-runner] ' + (code === 0 ? '全部通过 ✓' : '存在失败 ✗') + '（隔离数据目录已清理，你的真实 data/ 未被触碰）');
  process.exitCode = code;
})();
