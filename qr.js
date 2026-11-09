const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// Version 1–10, error correction M.
// [ec per block, group1 blocks, group1 data, group2 blocks, group2 data]
const TABLE = [
  null,
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

const ALIGN = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function rsGenerator(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= mul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();
}

function rsRemainder(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = msg[i];
    if (!factor) continue;
    for (let j = 0; j < gen.length; j++) msg[i + j] ^= mul(gen[j], factor);
  }
  return msg.slice(data.length);
}

function dataBytes(version, bytes) {
  const [ec, b1, d1, b2, d2] = TABLE[version];
  const capacity = b1 * d1 + b2 * d2;
  const ccBits = version <= 9 ? 8 : 16;
  const out = [];
  let acc = 0;
  let bits = 0;
  function put(value, width) {
    acc = (acc << width) | (value & ((1 << width) - 1));
    bits += width;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  put(0b0100, 4);
  put(bytes.length, ccBits);
  for (const byte of bytes) put(byte, 8);
  const totalBits = capacity * 8;
  const used = 4 + ccBits + bytes.length * 8;
  put(0, Math.min(4, totalBits - used));
  if (bits) put(0, 8 - bits);
  const pads = [0xec, 0x11];
  let p = 0;
  while (out.length < capacity) out.push(pads[p++ % 2]);
  return out.slice(0, capacity);
}

function interleave(version, codewords) {
  const [ec, b1, d1, b2, d2] = TABLE[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < b1; i++) {
    const data = codewords.slice(offset, offset + d1);
    offset += d1;
    blocks.push({ data, ec: rsRemainder(data, ec) });
  }
  for (let i = 0; i < b2; i++) {
    const data = codewords.slice(offset, offset + d2);
    offset += d2;
    blocks.push({ data, ec: rsRemainder(data, ec) });
  }
  const out = [];
  const maxData = Math.max(d1, d2 || 0);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

function formatBits(mask) {
  const data = mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | rem;
}

function paint(version, codewords) {
  const size = 21 + (version - 1) * 4;
  const dark = Array.from({ length: size }, () => Array(size).fill(false));
  const hold = Array.from({ length: size }, () => Array(size).fill(false));
  function set(y, x, on, reserved) {
    if (y < 0 || x < 0 || y >= size || x >= size) return;
    dark[y][x] = !!on;
    if (reserved) hold[y][x] = true;
  }
  function finder(x, y) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= size || xx >= size) continue;
        const inside = dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6;
        const border = dy === 0 || dy === 6 || dx === 0 || dx === 6;
        const core = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
        set(yy, xx, inside && (border || core), true);
      }
    }
  }
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let i = 0; i < size; i++) {
    if (!hold[6][i]) set(6, i, i % 2 === 0, true);
    if (!hold[i][6]) set(i, 6, i % 2 === 0, true);
  }
  const spots = ALIGN[version] || [];
  for (const y of spots) {
    for (const x of spots) {
      if ((x < 9 && y < 9) || (x > size - 10 && y < 9) || (x < 9 && y > size - 10)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(y + dy, x + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1, true);
        }
      }
    }
  }
  set(size - 8, 8, true, true);
  for (let i = 0; i < 9; i++) {
    hold[8][i] = true;
    hold[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    hold[8][size - 1 - i] = true;
    hold[size - 1 - i][8] = true;
  }
  if (version >= 7) {
    const bits = versionBits(version);
    let i = 0;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 3; x++) {
        const on = ((bits >> i) & 1) === 1;
        set(y, size - 11 + x, on, true);
        set(size - 11 + x, y, on, true);
        i++;
      }
    }
  }

  const bits = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  let cursor = 0;
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x -= 1;
    for (let i = 0; i < size; i++) {
      const y = upward ? size - 1 - i : i;
      for (const xx of [x, x - 1]) {
        if (hold[y][xx]) continue;
        dark[y][xx] = cursor < bits.length ? bits[cursor++] === 1 : false;
      }
    }
    upward = !upward;
  }
  return { dark, hold, size };
}

function maskOf(mask, y, x) {
  if (mask === 0) return (y + x) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (y + x) % 3 === 0;
  if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
  if (mask === 5) return ((y * x) % 2 + (y * x) % 3) === 0;
  if (mask === 6) return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0;
  return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0;
}

function drawFormat(modules, size, mask) {
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const on = ((bits >>> i) & 1) === 1;
    if (i < 6) modules[i][8] = on;
    else if (i < 8) modules[i + 1][8] = on;
    else modules[size - 15 + i][8] = on;
    if (i < 8) modules[8][size - i - 1] = on;
    else if (i < 9) modules[8][7] = on;
    else modules[8][15 - i - 1] = on;
  }
  modules[size - 8][8] = true;
}

function penalty(modules) {
  const n = modules.length;
  let score = 0;
  for (let y = 0; y < n; y++) {
    let run = 1;
    for (let x = 1; x < n; x++) {
      if (modules[y][x] === modules[y][x - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + run - 5;
        run = 1;
      }
    }
    if (run >= 5) score += 3 + run - 5;
  }
  for (let x = 0; x < n; x++) {
    let run = 1;
    for (let y = 1; y < n; y++) {
      if (modules[y][x] === modules[y - 1][x]) run += 1;
      else {
        if (run >= 5) score += 3 + run - 5;
        run = 1;
      }
    }
    if (run >= 5) score += 3 + run - 5;
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
    }
  }
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  function finderScore(row) {
    let add = 0;
    for (let i = 0; i <= row.length - 7; i++) {
      let ok = true;
      for (let k = 0; k < 7; k++) if (row[i + k] !== !!pattern[k]) ok = false;
      if (!ok) continue;
      const left = i >= 4 && row.slice(i - 4, i).every((v) => !v);
      const right = i + 11 <= row.length && row.slice(i + 7, i + 11).every((v) => !v);
      if (left || right) add += 40;
    }
    return add;
  }
  for (let y = 0; y < n; y++) score += finderScore(modules[y]);
  for (let x = 0; x < n; x++) score += finderScore(modules.map((row) => row[x]));
  let darks = 0;
  for (const row of modules) for (const cell of row) if (cell) darks += 1;
  score += 10 * Math.floor(Math.abs(darks / (n * n) * 100 - 50) / 5);
  return score;
}

function chooseVersion(length) {
  for (let version = 1; version <= 10; version++) {
    const [ec, b1, d1, b2, d2] = TABLE[version];
    const capacity = b1 * d1 + b2 * d2;
    const ccBits = version <= 9 ? 8 : 16;
    if (4 + ccBits + length * 8 <= capacity * 8) return version;
  }
  return 0;
}

function qrMatrix(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const version = chooseVersion(bytes.length);
  if (!version) throw new Error('That code is too long to draw');
  const packed = interleave(version, dataBytes(version, bytes));
  const base = paint(version, packed);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const modules = base.dark.map((row) => row.slice());
    for (let y = 0; y < base.size; y++) {
      for (let x = 0; x < base.size; x++) {
        if (!base.hold[y][x] && maskOf(mask, y, x)) modules[y][x] = !modules[y][x];
      }
    }
    drawFormat(modules, base.size, mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      best = modules;
    }
  }
  return best;
}

function qrSvg(text) {
  const matrix = qrMatrix(text);
  const n = matrix.length;
  const quiet = 4;
  const span = n + quiet * 2;
  let body = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!matrix[y][x]) {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < n && matrix[y][x + w]) w += 1;
      body += `<rect x="${x + quiet}" y="${y + quiet}" width="${w}" height="1"/>`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges"><rect width="${span}" height="${span}" fill="#fff"/><g fill="#111">${body}</g></svg>`;
}

module.exports = { qrMatrix, qrSvg };
