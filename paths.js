/**
 * 应用根目录解析。
 *
 * 同一个应用有两种运行形态，资源位置不一样：
 *   1. 开发形态：`node server.js` → 资源在脚本所在目录
 *   2. 打包形态：单文件 exe（Node SEA）→ 资源在 exe 所在目录
 *
 * SEA 环境下 `__dirname` 不可靠，所以优先用 `process.execPath` 的目录，
 * 并用「该目录下有没有 public/index.html」来判断到底哪个才是应用根目录。
 */

const path = require('path');
const fs = require('fs');

function isSea() {
  try { return require('node:sea').isSea() === true; } catch (e) { return false; }
}

function resolveAppRoot() {
  const candidates = [];

  /* 允许通过环境变量强制指定（便于把数据放到别处） */
  if (process.env.CUOTIJI_HOME) candidates.push(path.resolve(process.env.CUOTIJI_HOME));

  /* 打包成 exe 后，资源就在 exe 旁边 */
  if (process.execPath) candidates.push(path.dirname(process.execPath));

  /* 开发形态：脚本所在目录 */
  try { if (typeof __dirname !== 'undefined' && __dirname) candidates.push(__dirname); } catch (e) { /* SEA 下可能未定义 */ }

  /* 兜底：当前工作目录 */
  candidates.push(process.cwd());

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(path.join(c, 'public', 'index.html'))) return c;
    } catch (e) { /* 忽略无权限等异常 */ }
  }

  /* 都没找到，用 exe 目录（或脚本目录）——启动时会给出明确报错 */
  return candidates[1] || candidates[0] || process.cwd();
}

const APP_ROOT = resolveAppRoot();

module.exports = {
  APP_ROOT,
  IS_SEA: isSea(),
  IS_PACKAGED: isSea()
};
