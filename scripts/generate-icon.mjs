// Generates assets/extension-icon.png (512x512): a lined notepad with a pencil.
// Pure Node (no image libraries); shapes are signed-distance functions,
// supersampled 4x4 per pixel for anti-aliasing.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 512;
const SAMPLES = 4;

// ---------- shape helpers (negative distance = inside) ----------
function roundedRect(cx, cy, halfW, halfH, radius) {
  return (x, y) => {
    const qx = Math.abs(x - cx) - (halfW - radius);
    const qy = Math.abs(y - cy) - (halfH - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  };
}

function capsule(ax, ay, bx, by, radius) {
  return (x, y) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - radius;
  };
}

function circle(cx, cy, radius) {
  return (x, y) => Math.hypot(x - cx, y - cy) - radius;
}

/** Convex polygon; works for either winding order. */
function polygon(points) {
  return (x, y) => {
    let sign = 0;
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      const cross = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
      if (cross === 0) continue;
      if (sign === 0) sign = cross;
      else if (cross !== sign) return 1;
    }
    return -1;
  };
}

/** Restricts a shape to the band [from, to] measured along an axis from an origin. */
function along(shape, origin, axis, from, to) {
  return (x, y) => {
    const t = (x - origin[0]) * axis[0] + (y - origin[1]) * axis[1];
    return t < from || t > to ? 1 : shape(x, y);
  };
}

// ---------- scene ----------
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

const background = roundedRect(256, 256, 256, 256, 112);
const paper = roundedRect(236, 262, 150, 182, 26);
const paperShadow = roundedRect(244, 274, 150, 182, 26);

const lines = [0, 1, 2, 3, 4].map((i) => capsule(146, 196 + i * 50, i === 4 ? 250 : 326, 196 + i * 50, 7));
const rings = [0, 1, 2, 3].map((i) => capsule(150 + i * 58, 64, 150 + i * 58, 112, 11));
const ringHoles = [0, 1, 2, 3].map((i) => circle(150 + i * 58, 108, 13));

// Pencil from the eraser (upper right) down to the tip (lower left).
const tail = [430, 250];
const tip = [262, 418];
const length = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
const axis = [(tip[0] - tail[0]) / length, (tip[1] - tail[1]) / length];
const normal = [-axis[1], axis[0]];
const at = (t, side) => [tail[0] + axis[0] * t + normal[0] * side, tail[1] + axis[1] * t + normal[1] * side];
const HALF = 30;
const BODY_END = length - 62;
const shaft = capsule(...tail, ...at(BODY_END, 0), HALF);

// The shadow follows the shaft only, so it does not poke out past the sharpened tip.
const [shaftEndX, shaftEndY] = at(BODY_END, 0);
const pencilShadow = capsule(tail[0] + 10, tail[1] + 12, shaftEndX + 10, shaftEndY + 12, HALF);
const eraser = along(shaft, tail, axis, -HALF, 34);
const ferrule = along(shaft, tail, axis, 34, 62);
const body = along(shaft, tail, axis, 62, BODY_END);
const bodyStripe = along(capsule(...tail, ...at(BODY_END, 0), 9), tail, axis, 62, BODY_END);
const wood = polygon([at(BODY_END, -HALF), at(BODY_END, HALF), at(length - 20, 9), at(length - 20, -9)]);
const lead = polygon([at(length - 22, -10), at(length - 22, 10), at(length, 0)]);

const layers = [
  [
    background,
    (x, y) => {
      const t = (x + y) / (2 * SIZE);
      return [Math.round(52 + 26 * t), Math.round(120 - 28 * t), Math.round(246 - 40 * t)];
    },
  ],
  [paperShadow, () => [30, 50, 120], 0.35],
  [paper, () => hex("#FFFFFF")],
  ...lines.map((shape) => [shape, () => hex("#C9D3E3")]),
  ...ringHoles.map((shape) => [shape, () => hex("#2C3E66")]),
  ...rings.map((shape) => [shape, () => hex("#E6EAF2")]),
  [pencilShadow, () => [20, 30, 90], 0.3],
  [eraser, () => hex("#F28CA2")],
  [ferrule, () => hex("#C7CCD6")],
  [body, () => hex("#FFC23D")],
  [bodyStripe, () => hex("#F5A623")],
  [wood, () => hex("#F3D2A2")],
  [lead, () => hex("#3A3A46")],
];

// ---------- raster ----------
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let [r, g, b, a] = [0, 0, 0, 0];
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = px + (sx + 0.5) / SAMPLES;
        const y = py + (sy + 0.5) / SAMPLES;
        let color = null;
        for (const [shape, paint, opacity = 1] of layers) {
          if (shape(x, y) > 0) continue;
          const c = paint(x, y);
          color = color ? color.map((v, i) => v * (1 - opacity) + c[i] * opacity) : c;
        }
        if (color) {
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
    }
    const i = (py * SIZE + px) * 4;
    pixels[i] = a ? Math.round(r / a) : 0;
    pixels[i + 1] = a ? Math.round(g / a) : 0;
    pixels[i + 2] = a ? Math.round(b / a) : 0;
    pixels[i + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
  }
}

// ---------- PNG encoding ----------
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8);

writeFileSync(
  new URL("../assets/extension-icon.png", import.meta.url),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
