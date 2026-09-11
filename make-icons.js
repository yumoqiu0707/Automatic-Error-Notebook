/**
 * 生成应用图标（用封面图 + 「菜就多练！」）
 *
 * 用法：node make-icons.js
 * 依赖：@napi-rs/canvas（安装在 build/node_modules，仅打包期需要，不进入 exe）
 *       缺失时先执行：cd build && npm install @napi-rs/canvas postject --no-save
 *
 * 产出：public/icons/ 下的 192 / 512 / maskable-512 / apple-touch / favicon / icon.svg
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const COVER = path.join(ROOT, 'public', 'assets', 'cover.jpg');
const SLOGAN = '菜就多练！';

/* ---------- 加载 canvas ---------- */
let Canvas;
try {
  Canvas = require(path.join(ROOT, 'build', 'node_modules', '@napi-rs', 'canvas'));
} catch (e) {
  console.error('\n  [错误] 找不到 @napi-rs/canvas。\n');
  console.error('  请先安装（仅生成图标时需要，不会进入最终 exe）：');
  console.error('      cd build && npm install @napi-rs/canvas postject --no-save\n');
  process.exit(1);
}
const { createCanvas, loadImage, GlobalFonts } = Canvas;

if (!fs.existsSync(COVER)) {
  console.error('\n  [错误] 找不到封面图：' + COVER + '\n');
  process.exit(1);
}

/* ---------- 字体探测（中文必须能正常渲染） ---------- */
const FONT_STACK = '"Microsoft YaHei","微软雅黑","PingFang SC","Noto Sans CJK SC","Source Han Sans SC","SimHei",sans-serif';
const available = (() => {
  try { return GlobalFonts.families.map(f => f.family); } catch (e) { return []; }
})();
const cjk = available.filter(f => /YaHei|雅黑|PingFang|Noto Sans CJK|Source Han|SimHei|黑体|宋体/i.test(f));
console.log('  系统可用中文字体：' + (cjk.length ? cjk.slice(0, 5).join('、') : '（未识别到，将用系统默认）'));

/* ---------- 绘制 ---------- */
/**
 * @param size      输出边长
 * @param opts      { maskable, withText }
 */
async function renderIcon(img, size, opts) {
  opts = opts || {};
  const withText = opts.withText !== false;
  const k = opts.maskable ? 0.78 : 1.0;     // maskable 需要留安全区
  const C = size * k;
  const ox = (size - C) / 2;
  const oy = (size - C) / 2;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  /* 背景：纯白，和封面图的白底无缝衔接 */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  /* 封面图：放在内容区上方 */
  const maxW = C * 0.84;
  const maxH = C * (withText ? 0.66 : 0.86);
  let w = img.width, h = img.height;
  const scale = Math.min(maxW / w, maxH / h);
  w *= scale; h *= scale;
  const ix = ox + (C - w) / 2;
  const iy = oy + C * (withText ? 0.045 : 0.07);
  ctx.drawImage(img, ix, iy, w, h);

  /* 标语：渐变文字 */
  if (withText) {
    const fs2 = Math.round(C * 0.165);
    ctx.font = '900 ' + fs2 + 'px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const grad = ctx.createLinearGradient(ox, 0, ox + C, 0);
    grad.addColorStop(0, '#2f6fed');
    grad.addColorStop(1, '#6b4fd8');
    ctx.fillStyle = grad;
    ctx.fillText(SLOGAN, ox + C / 2, oy + C * 0.935);
  }

  return canvas.toBuffer('image/png');
}

/* ---------- ICO 打包（给 exe 用） ---------- */
/**
 * ICO 结构：
 *   ICONDIR    reserved(2)=0, type(2)=1, count(2)=N
 *   ICONDIRENTRY × N   width(1) height(1) colorCount(1) reserved(1)
 *                      planes(2) bitCount(2) bytesInRes(4) imageOffset(4)
 *   各尺寸的 PNG 数据（Vista 起支持 PNG 压缩的图标条目）
 * width/height 写 0 表示 256。
 */
function packIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);      // 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];

  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1);
    dir.writeUInt8(0, b + 2);       // 调色板数
    dir.writeUInt8(0, b + 3);       // 保留
    dir.writeUInt16LE(1, b + 4);    // 色彩平面
    dir.writeUInt16LE(32, b + 6);   // 位深
    dir.writeUInt32LE(e.data.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.data.length;
    blobs.push(e.data);
  });

  return Buffer.concat([header, dir].concat(blobs));
}

/* ---------- SVG 版（浏览器标签页 / 高分屏） ---------- */
function renderSvg(imgBuffer, withText) {
  const b64 = imgBuffer.toString('base64');
  const imgH = withText ? 300 : 400;
  const imgW = Math.round(imgH * 480 / 530);
  const imgY = withText ? 30 : 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="tg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2f6fed"/>
      <stop offset="1" stop-color="#6b4fd8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#ffffff"/>
  <image x="${(512 - imgW) / 2}" y="${imgY}" width="${imgW}" height="${imgH}" href="data:image/jpeg;base64,${b64}"/>
  ${withText ? `<text x="256" y="482" text-anchor="middle" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-weight="900" font-size="84" fill="url(#tg)" letter-spacing="2">菜就多练！</text>` : ''}
</svg>
`;
}

/* ---------- 执行 ---------- */
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const img = await loadImage(COVER);
  console.log('  封面图：' + img.width + '×' + img.height);

  const jobs = [
    ['icon-192.png', 192, { maskable: false, withText: true }],
    ['icon-512.png', 512, { maskable: false, withText: true }],
    ['icon-maskable-512.png', 512, { maskable: true, withText: true }],
    ['apple-touch-icon.png', 180, { maskable: false, withText: true }],
    ['favicon.png', 64, { maskable: false, withText: false }]   // 太小，只放图
  ];

  for (const [name, size, opts] of jobs) {
    const buf = await renderIcon(img, size, opts);
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    console.log('  ' + name.padEnd(26) + size + '×' + size + '   ' + (buf.length / 1024).toFixed(1) + ' KB');
  }

  const coverBuf = fs.readFileSync(COVER);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), renderSvg(coverBuf, true), 'utf8');
  console.log('  icon.svg                 矢量版（内嵌封面图 + 文字）');

  /* ---------- app.ico：给打包后的 exe 用 ---------- */
  /* 小尺寸（≤48）放文字会糊成一团，只保留封面图 */
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoEntries = [];
  for (const size of icoSizes) {
    const withText = size >= 64;
    const buf = await renderIcon(img, size, { maskable: false, withText: withText });
    icoEntries.push({ size, data: buf });
  }
  const ico = packIco(icoEntries);
  fs.writeFileSync(path.join(OUT_DIR, 'app.ico'), ico);
  console.log('  app.ico                  ' + icoSizes.join('/') + '   ' + (ico.length / 1024).toFixed(1) + ' KB');

  console.log('\n图标已生成到 public/icons/');
})();
