export function fileToDataUrl(file, opts = {}) {
  if (opts.original) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('Choose an image')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });
  }
  const maxW = opts.maxW || 512;
  const maxH = opts.maxH || 512;
  const quality = opts.quality || 0.82;
  const maxBytes = opts.maxBytes || 8 * 1024 * 1024;
  const isGif = /image\/gif/i.test(file.type) || /\.gif$/i.test(file.name || '');
  return new Promise((resolve, reject) => {
    if (isGif) {
      if (file.size > maxBytes) {
        reject(new Error('GIF is too large (max ~8MB).'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('Could not read GIF'));
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

export function frameDataUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width || 1;
      const height = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, 640 / width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.72;
      let out = canvas.toDataURL('image/jpeg', quality);
      while (out.length > 90000 && quality > 0.4) {
        quality -= 0.08;
        out = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(out.length > 140000 ? '' : out);
    };
    img.onerror = () => reject(new Error('Could not read that picture'));
    img.src = src;
  });
}

function lzwEncode(minCodeSize, indices) {
  const bits = 12;
  const hsize = 5003;
  const htab = new Int32Array(hsize);
  const codetab = new Int32Array(hsize);
  htab.fill(-1);
  const initBits = minCodeSize + 1;
  let nBits = initBits;
  let maxcode = (1 << nBits) - 1;
  const clearCode = 1 << minCodeSize;
  const eofCode = clearCode + 1;
  let freeEnt = clearCode + 2;
  let clearFlg = false;
  let curAccum = 0;
  let curBits = 0;
  const accum = [];
  const bytes = [minCodeSize];
  let packet = [];
  const flushPacket = () => {
    if (!packet.length) return;
    bytes.push(packet.length, ...packet);
    packet = [];
  };
  const pushByte = (value) => {
    packet.push(value & 255);
    if (packet.length === 255) flushPacket();
  };
  let hshift = 0;
  for (let fcode = hsize; fcode < 65536; fcode *= 2) hshift++;
  hshift = 8 - hshift;
  const masks = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535];
  const output = (code) => {
    curAccum &= masks[curBits];
    curAccum = curBits > 0 ? (curAccum | (code << curBits)) : code;
    curBits += nBits;
    while (curBits >= 8) {
      pushByte(curAccum);
      curAccum >>= 8;
      curBits -= 8;
    }
    if (freeEnt > maxcode || clearFlg) {
      if (clearFlg) {
        nBits = initBits;
        maxcode = (1 << nBits) - 1;
        clearFlg = false;
      } else {
        nBits++;
        maxcode = nBits === bits ? (1 << nBits) : (1 << nBits) - 1;
      }
    }
    if (code === eofCode) {
      while (curBits > 0) {
        pushByte(curAccum);
        curAccum >>= 8;
        curBits -= 8;
      }
      flushPacket();
    }
  };
  output(clearCode);
  let ent = indices[0] || 0;
  for (let idx = 1; idx < indices.length; idx++) {
    const c = indices[idx];
    const fcode = (c << bits) + ent;
    let i = ((c << hshift) ^ ent) % hsize;
    if (htab[i] === fcode) {
      ent = codetab[i];
      continue;
    }
    const disp = i === 0 ? 1 : hsize - i;
    let found = false;
    while (htab[i] >= 0) {
      i -= disp;
      if (i < 0) i += hsize;
      if (htab[i] === fcode) {
        ent = codetab[i];
        found = true;
        break;
      }
    }
    if (found) continue;
    output(ent);
    ent = c;
    if (freeEnt < (1 << bits)) {
      codetab[i] = freeEnt++;
      htab[i] = fcode;
    } else {
      htab.fill(-1);
      freeEnt = clearCode + 2;
      clearFlg = true;
      output(clearCode);
    }
  }
  output(ent);
  output(eofCode);
  bytes.push(0);
  return bytes;
}

function concatBytes(parts) {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function encodeSmallGif(width, height, frames, colorCount = 32) {
  const colors = Math.max(4, Math.min(64, colorCount));
  const counts = new Map();
  const step = Math.max(1, Math.floor((width * height) / 2500));
  for (const frame of frames) {
    const data = frame.rgba;
    for (let i = 0; i < width * height; i += step) {
      const o = i * 4;
      if (data[o + 3] < 16) continue;
      const key = ((data[o] & 240) << 16) | ((data[o + 1] & 240) << 8) | (data[o + 2] & 240);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, colors - 1);
  if (!ranked.length) ranked.push([0, 1]);
  let sizeBits = 0;
  const count = ranked.length + 1;
  while ((1 << (sizeBits + 1)) < count) sizeBits++;
  const tableLen = 1 << (sizeBits + 1);
  const pal = new Uint8Array(tableLen * 3);
  const lookup = new Map();
  ranked.forEach(([key], i) => {
    pal[i * 3] = (key >> 16) & 255;
    pal[i * 3 + 1] = (key >> 8) & 255;
    pal[i * 3 + 2] = key & 255;
    lookup.set(key, i);
  });
  const transparent = tableLen - 1;
  const parts = [new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])];
  const lsd = new Uint8Array(7);
  lsd[0] = width & 255;
  lsd[1] = width >> 8;
  lsd[2] = height & 255;
  lsd[3] = height >> 8;
  parts.push(lsd, new Uint8Array([0x21, 0xff, 11]), new Uint8Array([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]), new Uint8Array([3, 1, 0, 0, 0]));
  for (const frame of frames) {
    const indexes = new Uint8Array(width * height);
    const data = frame.rgba;
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      if (data[o + 3] < 16) {
        indexes[i] = transparent;
        continue;
      }
      const key = ((data[o] & 240) << 16) | ((data[o + 1] & 240) << 8) | (data[o + 2] & 240);
      let hit = lookup.get(key);
      if (hit == null) {
        let best = 0;
        let score = Infinity;
        for (let p = 0; p < ranked.length; p++) {
          const dr = pal[p * 3] - data[o];
          const dg = pal[p * 3 + 1] - data[o + 1];
          const db = pal[p * 3 + 2] - data[o + 2];
          const s = dr * dr + dg * dg + db * db;
          if (s < score) {
            score = s;
            best = p;
            if (!s) break;
          }
        }
        lookup.set(key, best);
        hit = best;
      }
      indexes[i] = hit;
    }
    const delay = Math.max(2, frame.delay || 10);
    const gce = new Uint8Array(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 4;
    gce[3] = 9;
    gce[4] = delay & 255;
    gce[5] = delay >> 8;
    gce[6] = transparent;
    const desc = new Uint8Array(10);
    desc[0] = 0x2c;
    desc[5] = width & 255;
    desc[6] = width >> 8;
    desc[7] = height & 255;
    desc[8] = height >> 8;
    desc[9] = 128 | sizeBits;
    parts.push(gce, desc, pal, new Uint8Array(lzwEncode(Math.max(2, sizeBits + 1), indexes)));
  }
  parts.push(new Uint8Array([0x3b]));
  return concatBytes(parts);
}

export async function shrinkGif(file, opts = {}) {
  const max = opts.max || 480;
  const maxFrames = opts.frames || 20;
  if (!file || file.size < 280 * 1024 || typeof ImageDecoder === 'undefined') return file;
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  try {
    await dec.tracks.ready;
    const count = Math.max(1, dec.tracks.selectedTrack.frameCount || 1);
    const step = Math.max(1, Math.ceil(count / maxFrames));
    const frames = [];
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i += step) {
      const { image } = await dec.decode({ frameIndex: i });
      const srcW = image.displayWidth || image.codedWidth || 1;
      const srcH = image.displayHeight || image.codedHeight || 1;
      if (!width) {
        const scale = Math.min(1, max / Math.max(srcW, srcH));
        width = Math.max(1, Math.round(srcW * scale));
        height = Math.max(1, Math.round(srcH * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, width, height);
      const delay = image.duration ? Math.max(2, Math.round(image.duration / 10000)) : 10;
      frames.push({ rgba: ctx.getImageData(0, 0, width, height).data, delay: delay * step });
      image.close();
    }
    if (!frames.length) return file;
    const bytes = encodeSmallGif(width, height, frames, opts.colors || 32);
    if (!bytes || bytes.length >= file.size * 0.92) return file;
    return new Blob([bytes], { type: 'image/gif' });
  } catch (_) {
    return file;
  } finally {
    try { dec.close(); } catch (_) {}
  }
}

export function readSmallImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Choose an image'));
    if (file.size > 300000) return reject(new Error('Keep the image under 300 KB'));
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (typeof url !== 'string' || url.length > 400000) reject(new Error('That image is too large'));
      else resolve(url);
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}
