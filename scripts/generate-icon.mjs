// Generates assets/extension-icon.png (512x512) without extra dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 512;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

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

function distanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

const c = SIZE / 2;
const radius = 112;
const corner = 110;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const qx = Math.max(Math.abs(x + 0.5 - c) - (c - corner), 0);
    const qy = Math.max(Math.abs(y + 0.5 - c) - (c - corner), 0);
    if (Math.hypot(qx, qy) > corner) continue; // transparent outside the rounded square

    const t = y / SIZE;
    let [r, g, b] = [Math.round(40 + 30 * t), Math.round(44 + 20 * t), Math.round(52 + 40 * t)];
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    const ring = Math.abs(d - radius) < 16;
    const hands = distanceToSegment(x, y, c, c, c, c - 78) < 12 || distanceToSegment(x, y, c, c, c + 58, c + 22) < 12;
    if (ring || hands) [r, g, b] = [255, 255, 255];
    pixels.set([r, g, b, 255], i);
  }
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
