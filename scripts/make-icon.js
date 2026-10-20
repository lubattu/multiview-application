import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZES = [256, 128, 64, 48, 32, 16];

function drawImage(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const u = size / 256;
  const r = 48 * u;
  const bg = [24, 26, 32];
  const fg = [90, 156, 214];
  const cell = 76 * u;
  const gap = 20 * u;
  const m = (size - 2 * cell - gap) / 2;
  const inRound = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
  const inCell = (x, y, i, j) => {
    const x0 = m + i * (cell + gap);
    const y0 = m + j * (cell + gap);
    return x >= x0 && x < x0 + cell && y >= y0 && y < y0 + cell;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (!inRound(x, y)) continue;
      const lit = inCell(x, y, 0, 0) || inCell(x, y, 1, 0) || inCell(x, y, 0, 1) || inCell(x, y, 1, 1);
      const c = lit ? fg : bg;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

function encodeBmp(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const rowBytes = size * 4;
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    xor.subarray((size - 1 - y) * rowBytes, (size - y) * rowBytes)
      .set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes));
  }
  const and = Buffer.alloc((((size + 31) >> 5) << 2) * size);
  return Buffer.concat([header, xor, and]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'icon.ico');
fs.writeFileSync(outFile, encodeIco(SIZES.map((size) => ({ size, data: encodeBmp(size, drawImage(size)) }))));
console.log(`OK: ${outFile}`);
