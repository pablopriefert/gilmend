// Generates the six illustration photos used by the demo-case buttons (public/demo/).
// They are flat, clearly fake placeholders drawn with a tiny rasteriser (no dependency, no
// real customer image). Before filming, replace them with our own photos of damaged parcels
// under the same file names. Run: node scripts/make-demo-photos.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const W = 640;
const H = 480;
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "demo");

function makeCanvas() {
  const px = new Uint8Array(W * H * 3);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
  };
  const api = {
    px,
    background(top, bottom) {
      for (let y = 0; y < H; y++) {
        const t = y / (H - 1);
        const c = top.map((v, k) => Math.round(v + (bottom[k] - v) * t));
        for (let x = 0; x < W; x++) set(x, y, c);
      }
    },
    rect(x, y, w, h, c) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, c);
    },
    poly(points, c) {
      const ys = points.map((p) => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
        const xs = [];
        for (let k = 0; k < points.length; k++) {
          const [x1, y1] = points[k];
          const [x2, y2] = points[(k + 1) % points.length];
          if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++) set(x, y, c);
      }
    },
    ellipse(cx, cy, rx, ry, c) {
      for (let y = -ry; y <= ry; y++) {
        const half = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
        for (let x = -half; x <= half; x++) set(cx + x, cy + y, c);
      }
    },
    line(x1, y1, x2, y2, c, thick = 3) {
      const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
      for (let k = 0; k <= n; k++) {
        const x = x1 + ((x2 - x1) * k) / n;
        const y = y1 + ((y2 - y1) * k) / n;
        for (let a = -thick / 2; a <= thick / 2; a++) for (let b = -thick / 2; b <= thick / 2; b++) set(Math.round(x + a), Math.round(y + b), c);
      }
    },
    blur(radius) {
      // Three box-blur passes per axis approximate a Gaussian well enough for a "bad photo".
      const tmp = new Uint8Array(px.length);
      for (let pass = 0; pass < 3; pass++) {
        for (const horizontal of [true, false]) {
          for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++)
              for (let ch = 0; ch < 3; ch++) {
                let sum = 0;
                let n = 0;
                for (let d = -radius; d <= radius; d++) {
                  const xx = horizontal ? x + d : x;
                  const yy = horizontal ? y : y + d;
                  if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                  sum += px[(yy * W + xx) * 3 + ch];
                  n++;
                }
                tmp[(y * W + x) * 3 + ch] = Math.round(sum / n);
              }
          px.set(tmp);
        }
      }
    },
  };
  return api;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(px) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CARDBOARD = [196, 158, 108];
const CARDBOARD_DARK = [150, 114, 72];
const TAPE = [226, 206, 160];
const FLOOR_TOP = [214, 208, 198];
const FLOOR_BOTTOM = [176, 168, 156];

function floor(c) {
  c.background(FLOOR_TOP, FLOOR_BOTTOM);
}
function box(c, x, y, w, h) {
  c.rect(x + 8, y + h, w, 10, [150, 144, 134]); // shadow
  c.rect(x, y, w, h, CARDBOARD);
  c.rect(x, y, w, 14, CARDBOARD_DARK);
  c.rect(x + w / 2 - 22, y, 44, h, TAPE);
}

const scenes = {
  "illustration-broken-vase": (c) => {
    floor(c);
    box(c, 90, 190, 250, 190);
    const blue = [52, 104, 160];
    const light = [120, 168, 214];
    c.poly([[360, 300], [420, 270], [440, 340]], blue);
    c.poly([[430, 350], [500, 320], [520, 390]], light);
    c.poly([[330, 390], [390, 360], [410, 420]], blue);
    c.poly([[470, 250], [520, 240], [505, 300]], light);
    c.poly([[400, 400], [470, 395], [440, 440]], blue);
    c.poly([[290, 215], [330, 190], [345, 240]], blue); // shard inside the box
  },
  "illustration-crushed-box": (c) => {
    floor(c);
    box(c, 70, 170, 290, 210);
    c.poly([[70, 170], [150, 190], [140, 330], [70, 380]], CARDBOARD_DARK); // dent
    c.line(150, 190, 140, 330, [110, 80, 48], 4);
    // the lamp, intact next to the box
    c.rect(470, 330, 70, 14, [90, 90, 96]);
    c.rect(499, 220, 12, 112, [90, 90, 96]);
    c.poly([[440, 220], [570, 220], [540, 150], [470, 150]], [238, 228, 200]);
  },
  "illustration-blurry": (c) => {
    floor(c);
    c.rect(150, 90, 340, 270, [88, 62, 40]); // frame
    c.rect(180, 120, 280, 210, [226, 232, 238]); // glass
    c.line(180, 120, 330, 240, [60, 60, 66], 4);
    c.line(330, 240, 460, 200, [60, 60, 66], 4);
    c.line(330, 240, 300, 330, [60, 60, 66], 4);
    c.blur(10);
  },
  "illustration-opened-parcel": (c) => {
    floor(c);
    box(c, 120, 210, 300, 170);
    c.poly([[120, 210], [180, 120], [260, 130], [250, 210]], CARDBOARD_DARK); // torn flap
    c.poly([[420, 210], [470, 130], [400, 125], [380, 210]], CARDBOARD_DARK);
    c.rect(150, 214, 240, 56, [60, 48, 38]); // empty inside
    c.ellipse(215, 244, 26, 18, [240, 240, 236]); // the one mug left
    c.rect(238, 238, 20, 8, [240, 240, 236]);
    c.line(430, 330, 560, 380, TAPE, 10); // torn tape on the floor
    c.line(430, 330, 450, 345, [196, 176, 130], 10);
  },
  "illustration-cracked-screen": (c) => {
    floor(c);
    c.rect(300, 410, 120, 12, [60, 60, 66]);
    c.rect(345, 360, 30, 52, [60, 60, 66]);
    c.rect(130, 70, 460, 290, [30, 32, 38]); // screen
    c.rect(150, 90, 420, 250, [18, 20, 26]);
    const hub = [380, 210];
    for (const [dx, dy] of [[-210, -120], [-190, 100], [200, -110], [190, 120], [10, -130], [-30, 130], [-120, 0], [150, 20]])
      c.line(hub[0], hub[1], hub[0] + dx, hub[1] + dy, [226, 230, 236], 3);
    c.poly([[560, 360], [640, 360], [640, 440], [600, 400]], CARDBOARD_DARK); // dented box corner
  },
  "illustration-cracked-bowl": (c) => {
    floor(c);
    for (const [cx, cy] of [[190, 330], [320, 300], [450, 330]]) {
      c.ellipse(cx, cy + 10, 78, 30, [150, 144, 134]);
      c.ellipse(cx, cy, 74, 52, [236, 236, 232]);
      c.ellipse(cx, cy - 8, 56, 34, [246, 246, 244]);
    }
    c.line(300, 268, 330, 300, [60, 60, 66], 4); // the crack on the middle bowl
    c.line(330, 300, 322, 330, [60, 60, 66], 4);
    c.line(330, 300, 362, 316, [60, 60, 66], 3);
    c.poly([[372, 296], [392, 292], [384, 312]], [236, 236, 232]); // chip on the floor
  },
};

mkdirSync(outDir, { recursive: true });
for (const [name, draw] of Object.entries(scenes)) {
  const canvas = makeCanvas();
  draw(canvas);
  writeFileSync(path.join(outDir, `${name}.png`), encodePng(canvas.px));
  console.log("wrote", `public/demo/${name}.png`);
}
