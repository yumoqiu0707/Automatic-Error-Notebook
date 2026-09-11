/**
 * 极简二维码生成器（零依赖）
 *
 * 支持范围：字节模式、纠错等级 L、版本 1–5（容量 17–106 字节）。
 * 对「http://192.168.x.x:5178」这类局域网地址绰绰有余。
 *
 * 为什么自己写：这个模块要被打进单文件 exe，引入 npm 依赖会让打包链路复杂化。
 */

/* ================= GF(256) 运算 ================= */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function polyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) r[i + j] ^= gfMul(a[i], b[j]);
  }
  return r;
}

/** 生成 degree 次的 RS 生成多项式 */
function rsGeneratorPoly(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) g = polyMul(g, [1, EXP[i]]);
  return g;
}

/** Reed–Solomon 纠错码字 */
function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return res;
}

/* ================= 版本规格（纠错等级 L，均为单块） ================= */
const SPECS = [
  null,
  { dataCW: 19, ecCW: 7, align: [] },
  { dataCW: 34, ecCW: 10, align: [6, 18] },
  { dataCW: 55, ecCW: 15, align: [6, 22] },
  { dataCW: 80, ecCW: 20, align: [6, 26] },
  { dataCW: 108, ecCW: 26, align: [6, 30] }
];

function pickVersion(byteLen) {
  for (let v = 1; v < SPECS.length; v++) {
    if (byteLen <= SPECS[v].dataCW - 2) return v;
  }
  return null;
}

/* ================= 位流 → 码字 ================= */
function buildCodewords(bytes, version) {
  const spec = SPECS[version];
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };

  put(4, 4);                       // 模式指示符：字节模式
  put(bytes.length, 8);            // 字符计数（版本 1–9 为 8 位）
  for (const b of bytes) put(b, 8);

  const capacity = spec.dataCW * 8;
  put(0, Math.min(4, capacity - bits.length));      // 终止符
  while (bits.length % 8 !== 0) bits.push(0);       // 补齐到字节边界

  const dataCW = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCW.push(b);
  }
  const PAD = [0xEC, 0x11];
  for (let i = 0; dataCW.length < spec.dataCW; i++) dataCW.push(PAD[i % 2]);

  return dataCW.concat(rsEncode(dataCW, spec.ecCW));
}

/* ================= 矩阵构建 ================= */
function makeMatrix(version) {
  const size = version * 4 + 17;
  const modules = [], reserved = [];
  for (let i = 0; i < size; i++) {
    modules.push(new Array(size).fill(0));
    reserved.push(new Array(size).fill(false));
  }
  return { size, modules, reserved };
}

function placeFinder(m, row, col) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || r >= m.size || c < 0 || c >= m.size) continue;
      const ring = (dr === 0 || dr === 6) && dc >= 0 && dc <= 6 ||
                   (dc === 0 || dc === 6) && dr >= 0 && dr <= 6;
      const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      m.modules[r][c] = (ring || core) ? 1 : 0;
      m.reserved[r][c] = true;
    }
  }
}

function drawFunctionPatterns(m, version) {
  const size = m.size;

  /* 定位图形（三个角）+ 分隔符 */
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);

  /* 定时图形 */
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    m.modules[6][i] = v; m.reserved[6][i] = true;
    m.modules[i][6] = v; m.reserved[i][6] = true;
  }

  /* 校正图形 */
  const align = SPECS[version].align;
  for (const r of align) {
    for (const c of align) {
      if (m.reserved[r][c]) continue;   // 与定位图形重叠则跳过
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          m.modules[r + dr][c + dc] = on ? 1 : 0;
          m.reserved[r + dr][c + dc] = true;
        }
      }
    }
  }

  /* 预留格式信息区 */
  for (let i = 0; i <= 8; i++) {
    m.reserved[8][i] = true; m.reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8][size - 1 - i] = true;
    m.reserved[size - 1 - i][8] = true;
  }
}

function drawCodewords(m, codewords) {
  const size = m.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                    // 跳过定时列
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (!m.reserved[row][col] && i < codewords.length * 8) {
          m.modules[row][col] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }
}

function maskFn(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return (row * col) % 2 + (row * col) % 3 === 0;
    case 6: return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
    default: return ((row + col) % 2 + (row * col) % 3) % 2 === 0;
  }
}

function applyMask(m, mask) {
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.reserved[r][c] && maskFn(mask, r, c)) m.modules[r][c] ^= 1;
    }
  }
}

function formatBits(mask) {
  const data = (1 << 3) | mask;                 // 纠错等级 L = 0b01
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(m, mask) {
  const size = m.size;
  const bits = formatBits(mask);
  const bit = i => (bits >>> i) & 1;

  for (let i = 0; i <= 5; i++) m.modules[i][8] = bit(i);
  m.modules[7][8] = bit(6);
  m.modules[8][8] = bit(7);
  m.modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m.modules[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i++) m.modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m.modules[size - 15 + i][8] = bit(i);
  m.modules[size - 8][8] = 1;                    // 固定黑点
}

/** 掩码惩罚分（只用于挑一个扫描效果好的掩码；挑错也不影响可解码性） */
function penalty(m) {
  const size = m.size;
  let score = 0;
  const lines = [];
  for (let r = 0; r < size; r++) lines.push(m.modules[r]);
  for (let c = 0; c < size; c++) lines.push(m.modules.map(row => row[c]));

  for (const line of lines) {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) { run++; }
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m.modules[r][c];
      if (v === m.modules[r][c + 1] && v === m.modules[r + 1][c] && v === m.modules[r + 1][c + 1]) score += 3;
    }
  }
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m.modules[r][c];
  const ratio = dark / (size * size);
  score += Math.floor(Math.abs(ratio - 0.5) * 20) * 10;
  return score;
}

/* ================= 对外接口 ================= */

/** 生成二维码模块矩阵（二维 0/1 数组） */
function generateMatrix(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  const version = pickVersion(bytes.length);
  if (version === null) throw new Error('内容过长，超出本生成器支持范围（最多 106 字节）');

  const codewords = buildCodewords(bytes, version);

  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = makeMatrix(version);
    drawFunctionPatterns(m, version);
    drawCodewords(m, codewords);
    applyMask(m, mask);
    drawFormatBits(m, mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return best.modules;
}

/** 生成 SVG 字符串 */
function generateSVG(text, opts) {
  opts = opts || {};
  const margin = opts.margin == null ? 3 : opts.margin;
  const dark = opts.dark || '#1b2430';
  const light = opts.light || '#ffffff';

  const modules = generateMatrix(text);
  const count = modules.length;
  const total = count + margin * 2;
  const px = opts.size || 200;
  const unit = px / total;

  let path = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (modules[r][c]) {
        const x = ((c + margin) * unit).toFixed(2);
        const y = ((r + margin) * unit).toFixed(2);
        path += `M${x} ${y}h${unit.toFixed(2)}v${unit.toFixed(2)}h-${unit.toFixed(2)}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges">` +
    `<rect width="${px}" height="${px}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`;
}

module.exports = { generateMatrix, generateSVG };
