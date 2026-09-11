/* 验证自研二维码生成器：生成 → 渲染成位图 → 用 jsqr 解码 → 比对原文 */
const jsQR = require('./build/node_modules/jsqr/dist/jsQR.js').default || require('./build/node_modules/jsqr/dist/jsQR.js');
const QR = require('./qr');

/** 把模块矩阵渲染成 jsQR 能吃的 ImageData（带白边和放大） */
function toImageData(modules, scale, margin) {
  const n = modules.length;
  const size = (n + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mr = Math.floor(y / scale) - margin;
      const mc = Math.floor(x / scale) - margin;
      const dark = mr >= 0 && mr < n && mc >= 0 && mc < n && modules[mr][mc] === 1;
      const i = (y * size + x) * 4;
      const v = dark ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

let pass = 0, fail = 0;
const check = (n, c, x) => { console.log((c ? '  [PASS] ' : '  [FAIL] ') + n + (x ? '  → ' + x : '')); c ? pass++ : fail++; };

console.log('\n【1】不同长度的内容都能编码并被正确解码');
const cases = [
  'http://192.168.1.100:5178',
  'http://10.0.0.7:5178',
  'http://172.20.10.3:5178',
  'http://127.0.0.1:5178',
  'A',
  'http://192.168.100.200:5178/?view=book'
];
cases.forEach(text => {
  try {
    const m = QR.generateMatrix(text);
    const decoded = jsQR(toImageData(m, 6, 4).data, toImageData(m, 6, 4).width, toImageData(m, 6, 4).height);
    const ok = decoded && decoded.data === text;
    check('编码/解码「' + text.slice(0, 38) + '」', ok,
      ok ? '版本 ' + ((m.length - 17) / 4) + '，' + m.length + '×' + m.length : (decoded ? '解出：' + decoded.data : '无法解码'));
  } catch (e) {
    check('编码「' + text + '」', false, e.message);
  }
});

console.log('\n【2】中文内容（UTF-8 字节模式）');
{
  const text = '菜就多练！http://192.168.1.100:5178';
  const m = QR.generateMatrix(text);
  const img = toImageData(m, 6, 4);
  const decoded = jsQR(img.data, img.width, img.height);
  check('中文能正确往返', Boolean(decoded) && decoded.data === text,
    decoded ? decoded.data : '无法解码');
}

console.log('\n【3】边界情况');
{
  let tooLong = false;
  try { QR.generateMatrix('x'.repeat(120)); } catch (e) { tooLong = true; }
  check('超长内容抛出明确错误', tooLong);

  const max = QR.generateMatrix('x'.repeat(106));
  check('106 字节（版本 5 上限）可编码', max.length === 37, max.length + '×' + max.length);
}

console.log('\n【4】SVG 输出');
{
  const svg = QR.generateSVG('http://192.168.1.100:5178', { size: 168 });
  check('是合法 SVG', /^<svg[\s\S]*<\/svg>$/.test(svg));
  check('含尺寸属性', /width="168" height="168"/.test(svg));
  check('含路径数据', /<path d="M/.test(svg));
  check('体积合理（<12KB）', Buffer.byteLength(svg) < 12288, (Buffer.byteLength(svg) / 1024).toFixed(1) + ' KB');
}

console.log('\n────────────────────────────');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
