/**
 * 打包成免安装桌面应用（单文件 exe）
 *
 * 原理：Node.js 的 SEA（Single Executable Application）特性 ——
 *   1. 把 server.js / db.js / system-prompt.js / paths.js 捆成一个 JS 文件
 *   2. 用 `node --experimental-sea-config` 生成 sea-prep.blob
 *   3. 复制 node.exe，再用 postject 把 blob 注入进去
 * 产物：dist/错题集助手/ 目录，双击 exe 即可运行，目标机器不需要装 Node。
 *
 * 用法：node build-exe.js
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = __dirname;
const BUILD_DIR = path.join(ROOT, 'build');
const DIST_DIR = path.join(ROOT, 'dist');
const APP_DIR = path.join(DIST_DIR, '错题集助手');
const APP_NAME = '错题集助手.exe';

const ENTRIES = ['server.js', 'db.js', 'system-prompt.js', 'paths.js', 'qr.js'];
const COPY_DIRS = ['public'];
const COPY_FILES = ['config.example.json'];
/* 不打包进分发目录的文件（早期的纯前端模拟页，与打包版无关） */
const EXCLUDE = ['public/mock-demo.html'];
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const log = (...a) => console.log(...a);
function step(n, t) { log('\n[' + n + '] ' + t); }
function fail(msg) { console.error('\n  ✗ ' + msg); process.exit(1); }

/* 手写递归拷贝（不用 fs.cpSync，某些受限环境下会被拦） */
function copyDir(src, dest, exclude, relBase) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    const rel = (relBase ? relBase + '/' : '') + entry.name;
    if (exclude.indexOf(rel) > -1) { log('  · 跳过 ' + rel); continue; }
    if (entry.isDirectory()) copyDir(s, d, exclude, rel);
    else fs.copyFileSync(s, d);
  }
}

function dirSize(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

/* ================================================================== */
/* 1. 打包：把多个 CommonJS 模块捆成一个文件                              */
/* ================================================================== */
function bundle() {
  let out = '';
  out += '/* 由 build-exe.js 自动生成，请勿手改；改源码后重新执行 node build-exe.js */\n';
  out += '(function () {\n';
  out += '  var __mods = {};\n';
  out += '  var __cache = {};\n';
  out += '  function __def(name, fn) { __mods[name] = fn; }\n';
  out += '  function __req(name) {\n';
  out += '    var key = String(name).replace(/^\\.\\//, "").replace(/\\.js$/, "");\n';
  out += '    if (!__mods[key]) return require(name);   /* 内置模块直通 */\n';
  out += '    if (__cache[key]) return __cache[key].exports;\n';
  out += '    var m = { exports: {} };\n';
  out += '    __cache[key] = m;\n';
  out += '    __mods[key](m, m.exports, __req);\n';
  out += '    return m.exports;\n';
  out += '  }\n';

  ENTRIES.forEach(file => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) fail('缺少源文件 ' + file);
    let src = fs.readFileSync(full, 'utf8');
    src = src.replace(/^#![^\n]*\n/, '');            // 去掉 shebang
    src = src.replace(/\r\n/g, '\n');
    const name = file.replace(/\.js$/, '');
    out += '\n/* ===== ' + file + ' ===== */\n';
    out += '__def(' + JSON.stringify(name) + ', function (module, exports, require) {\n';
    out += src;
    out += '\n});\n';
  });

  out += '\n__req("server");\n';
  out += '})();\n';
  return out;
}

/* ================================================================== */
/* 写入 PE 资源：应用图标 + 版本信息                                     */
/* ================================================================== */

/** resedit 3.x 是 ESM 包，从 CommonJS 里用动态 import 加载 */
async function loadResEdit() {
  const entry = path.join(BUILD_DIR, 'node_modules', 'resedit', 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error('未安装 resedit（cd build && npm install resedit --no-save）');
  }
  return await import(require('url').pathToFileURL(entry).href);
}

async function applyExeResources(exePath, icoPath) {
  const { NtExecutable, NtExecutableResource, Resource, Data } = await loadResEdit();

  /* node.exe 是签过名的，改资源会破坏签名，必须 ignoreCert */
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  /* 1) 图标组 */
  const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, 1, 1033,
    iconFile.icons.map(item => item.data)
  );

  /* 2) 版本信息（鼠标悬停 exe 时显示的属性） */
  const vi = Resource.VersionInfo.createEmpty();
  vi.setFileVersion(1, 1, 0, 0);
  vi.setProductVersion(1, 1, 0, 0);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: '错题集助手',
    FileDescription: '错题集生成与知识点拓展助手',
    OriginalFilename: '错题集助手.exe',
    InternalName: 'CuotijiAssistant',
    CompanyName: '',
    LegalCopyright: ''
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

/** 从 exe 里把图标读回来，用于自检 */
async function readBackIcon(exePath) {
  const { NtExecutable, NtExecutableResource, Resource } = await loadResEdit();
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  if (!groups.length) return null;
  return { count: groups[0].icons.length };
}

/* ================================================================== */
/* 主流程                                                              */
/* ================================================================== */
(async function main() {
  log('');
  log('  错题集助手 · 打包成免安装桌面应用');
  log('  ═══════════════════════════════════════');

  const nodeExe = process.execPath;
  if (!fs.existsSync(nodeExe)) fail('找不到 node.exe');

  fs.mkdirSync(BUILD_DIR, { recursive: true });

  /* ---------- 1. 打包 ---------- */
  step(1, '打包源码');
  const bundlePath = path.join(BUILD_DIR, 'bundle.js');
  const code = bundle();
  fs.writeFileSync(bundlePath, code, 'utf8');
  log('  ✓ bundle.js  ' + (Buffer.byteLength(code) / 1024).toFixed(1) + ' KB');

  /* ---------- 2. 生成 SEA blob ---------- */
  step(2, '生成 SEA blob');
  const blobPath = path.join(BUILD_DIR, 'sea-prep.blob');
  const seaConfigPath = path.join(BUILD_DIR, 'sea-config.json');
  fs.writeFileSync(seaConfigPath, JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false
  }, null, 2), 'utf8');

  try {
    cp.execFileSync(nodeExe, ['--experimental-sea-config', seaConfigPath], { stdio: 'pipe' });
  } catch (e) {
    fail('生成 blob 失败：\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
  const blobSize = fs.statSync(blobPath).size;
  log('  ✓ sea-prep.blob  ' + (blobSize / 1024).toFixed(1) + ' KB');

  /* ---------- 3. 准备输出目录 ---------- */
  step(3, '准备输出目录');
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(APP_DIR, { recursive: true });

  const exePath = path.join(APP_DIR, APP_NAME);
  fs.copyFileSync(nodeExe, exePath);
  log('  ✓ 复制 node.exe → ' + APP_NAME + '  ' + (fs.statSync(exePath).size / 1048576).toFixed(1) + ' MB');

  COPY_DIRS.forEach(d => {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) {
      copyDir(src, path.join(APP_DIR, d), EXCLUDE, d);
      log('  ✓ 复制目录 ' + d + '/');
    }
  });
  COPY_FILES.forEach(f => {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(APP_DIR, f));
      log('  ✓ 复制文件 ' + f);
    }
  });

  /* ---------- 4. 注入 ---------- */
  step(4, '注入 SEA blob（postject）');
  const postjectCli = path.join(BUILD_DIR, 'node_modules', 'postject', 'dist', 'cli.js');
  if (!fs.existsSync(postjectCli)) {
    fail('找不到 postject，请先在 build/ 目录执行：\n' +
      '    npm install postject --no-save\n' +
      '  然后用 node build-exe.js 重新打包');
  }
  try {
    const out = cp.execFileSync(nodeExe, [
      postjectCli, exePath, 'NODE_SEA_BLOB', blobPath,
      '--sentinel-fuse', SENTINEL_FUSE
    ], { stdio: 'pipe' });
    log('  ✓ ' + out.toString().trim().split('\n').pop());
  } catch (e) {
    fail('注入失败：\n' + (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : e.message));
  }

  /* ---------- 5. 写入图标与版本信息（PE 资源） ---------- */
  step(5, '写入图标与版本信息（resedit）');
  const icoPath = path.join(ROOT, 'public', 'icons', 'app.ico');
  if (!fs.existsSync(icoPath)) {
    log('  ! 找不到 public/icons/app.ico，跳过（先执行 node make-icons.js）');
  } else {
    try {
      await applyExeResources(exePath, icoPath);
      log('  ✓ 已写入图标（7 个尺寸）与版本信息');
    } catch (e) {
      log('  ! 写入图标失败，exe 仍可用但图标是 Node 默认的：' + e.message);
    }
  }

  /* ---------- 6. 写使用说明 ---------- */
  step(6, '生成使用说明');
  const readme = [
    '错题集生成与知识点拓展助手 —— 免安装版',
    '==========================================',
    '',
    '【怎么用】',
    '  1. 双击「错题集助手.exe」',
    '  2. 浏览器会自动打开 http://127.0.0.1:5178',
    '  3. 点右上角「模型设置」，填入你的 Base URL / API Key / 模型名，保存',
    '  4. 开始用。关掉那个黑色命令行窗口 = 停止程序（数据已自动保存）',
    '',
    '【手机上也能用（拍错题最方便）】',
    '  1. 手机和电脑连同一个 Wi-Fi',
    '  2. 电脑上程序保持运行，点页面右上角「手机访问」',
    '  3. 用手机相机或微信「扫一扫」扫描弹出的二维码',
    '  4. 打开后点浏览器菜单 →「添加到主屏幕」，以后从桌面图标进入',
    '  手机拍错题 → 上传 → 电脑和手机看到的是同一份错题集。',
    '',
    '【本机不需要装 Node.js】',
    '  这个 exe 已经把运行时打进去了，拷到任何 Windows 电脑都能直接跑。',
    '',
    '【数据存在哪】',
    '  和 exe 同一个目录下的 data\\db.json',
    '  data\\backups\\ 里是每天自动生成的备份',
    '  想备份或换电脑，直接拷 data 文件夹即可。',
    '',
    '【目录说明】',
    '  错题集助手.exe     主程序（约 84 MB，内含 Node 运行时）',
    '  public\\            前端资源（删了程序会报错）',
    '  config.example.json 配置模板，可改名成 config.json 后直接编辑',
    '  data\\              你的错题集（首次运行自动创建）',
    '',
    '【常见问题】',
    '  Q: 双击后一闪而过？',
    '     A: 用「命令提示符」cd 到本目录，手动执行 错题集助手.exe 看报错信息。',
    '',
    '  Q: 提示端口被占用？',
    '     A: 说明程序已经在运行了。直接打开 http://127.0.0.1:5178 即可；',
    '        要重启就先在任务管理器里结束「错题集助手.exe」。',
    '',
    '  Q: 手机打不开？',
    '     A: 检查三点：① 电脑上程序还在运行；② 手机和电脑是同一个 Wi-Fi；',
    '        ③ 电脑防火墙允许了本程序（首次运行 Windows 会弹窗询问，要选「允许」）。',
    '',
    '  Q: 不想让别人访问？',
    '     A: 把 config.json 里的 "host" 改成 "127.0.0.1" 并重启程序，',
    '        这样就只有本机能访问了。',
    '',
    '  Q: 换端口？',
    '     A: 在命令行里 set PORT=5190 后再运行 exe。',
    '',
    '  Q: 想改提示词？',
    '     A: 打包版里提示词已经编译进 exe 了。要改请用源码版（node server.js），',
    '        改 system-prompt.js 后重新执行 node build-exe.js 打包。',
    ''
  ].join('\r\n');
  fs.writeFileSync(path.join(APP_DIR, '使用说明.txt'), '\ufeff' + readme, 'utf8');
  log('  ✓ 使用说明.txt');

  /* ---------- 7. 自检 ---------- */
  step(7, '自检');
  try {
    const icon = await readBackIcon(exePath);
    if (icon) log('  ✓ exe 图标已写入（' + icon.count + ' 个尺寸）');
    else log('  ! exe 里没读到图标组');
  } catch (e) {
    log('  ! 图标自检失败：' + e.message);
  }
  log('  ✓ exe 体积 ' + (fs.statSync(exePath).size / 1048576).toFixed(1) + ' MB');

  /* ---------- 完成 ---------- */
  const totalSize = dirSize(APP_DIR);

  log('');
  log('  ═══════════════════════════════════════');
  log('  ✓ 打包完成');
  log('');
  log('  输出目录：' + APP_DIR);
  log('  总体积：' + (totalSize / 1048576).toFixed(1) + ' MB');
  log('  双击运行：' + APP_NAME);
  log('');
  log('  这个目录可以直接压缩发给别人，对方不需要装 Node.js。');
  log('');
})().catch(e => {
  console.error('\n  ✗ 打包失败：' + (e && e.stack || e));
  process.exit(1);
});
