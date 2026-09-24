// Generates the PWA icons as real PNGs, with no image dependency.
//
// The manifest needs raster icons and the app ships no binary assets, so this
// rasterises a barbell mark into a pixel buffer and writes it out as a PNG using
// nothing but node:zlib. Run with `npm run icons`.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const AMBER = [245, 158, 11, 255];
const INK = [20, 20, 16, 255];

/** Draw the mark into an RGBA buffer. `inset` keeps a maskable icon's safe zone clear. */
function render(size, inset) {
  const px = new Uint8Array(size * size * 4);

  const set = (x, y, rgba) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = rgba[0];
    px[i + 1] = rgba[1];
    px[i + 2] = rgba[2];
    px[i + 3] = rgba[3];
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, AMBER);

  const rect = (cx, cy, w, h) => {
    const x0 = Math.round(cx - w / 2);
    const y0 = Math.round(cy - h / 2);
    for (let y = y0; y < y0 + Math.round(h); y++) {
      for (let x = x0; x < x0 + Math.round(w); x++) set(x, y, INK);
    }
  };

  // A barbell: knurled bar through the middle, an inner and outer plate a side.
  const c = size / 2;
  const safe = size * (1 - inset);
  const barLength = safe * 0.78;
  const barThickness = Math.max(2, safe * 0.075);
  const innerPlateH = safe * 0.46;
  const outerPlateH = safe * 0.72;
  const plateW = Math.max(2, safe * 0.1);

  rect(c, c, barLength, barThickness);
  rect(c - barLength * 0.3, c, plateW, outerPlateH);
  rect(c + barLength * 0.3, c, plateW, outerPlateH);
  rect(c - barLength * 0.46, c, plateW, innerPlateH);
  rect(c + barLength * 0.46, c, plateW, innerPlateH);

  return px;
}

// ── PNG encoding ──────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte. Filter 0 (none) keeps this
  // simple; the images are flat colour so compression is excellent regardless.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Write them ────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const icons = [
  { name: 'icon-192.png', size: 192, inset: 0.14 },
  { name: 'icon-512.png', size: 512, inset: 0.14 },
  // Maskable icons get cropped to a circle or squircle by the launcher, so the
  // mark sits inside a much tighter safe zone.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.3 },
];

for (const icon of icons) {
  const png = encodePng(render(icon.size, icon.inset), icon.size);
  writeFileSync(join(OUT_DIR, icon.name), png);
  console.log(`wrote ${icon.name} (${png.length} bytes)`);
}
