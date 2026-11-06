import { inflateSync } from 'node:zlib';

/** More decoded pixel data than this isn't a logo (and would cost too much memory to check). */
const MAX_PIXEL_BYTES = 64 * 1024 * 1024;

/** Channels per pixel by PNG colour type: grey, RGB, palette, grey + alpha, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** The Adam7 passes of an interlaced PNG: x start, y start, x step, y step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * Whether a PNG's pixel data decodes (CD-378), checked synchronously. pdfkit decodes PNGs with
 * transparency or interlacing later and asynchronously (png-js), and an error there isn't
 * catchable: it ends the process. So a PNG goes to pdfkit only after this check: the chunks are
 * whole, the IDAT data inflates to exactly the size the header promises, and every row starts
 * with a known filter type. For a PNG pdfkit decodes, png-js's own walk over the data must
 * succeed as well (`pngJsDecodes`). Not a PNG at all: false.
 */
export function pngPixelDataOk(buffer: Buffer): boolean {
  try {
    if (buffer.length < 8 + 25 || buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return false;
    let pos = 8;
    let header: { width: number; height: number; depth: number; type: number; interlace: number } | null = null;
    const idat: Buffer[] = [];
    let ended = false;
    let transparency = false;
    while (pos + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(pos);
      const type = buffer.toString('latin1', pos + 4, pos + 8);
      const data = pos + 8;
      if (data + length + 4 > buffer.length) return false;
      if (type === 'IHDR') {
        if (length !== 13) return false;
        header = {
          width: buffer.readUInt32BE(data),
          height: buffer.readUInt32BE(data + 4),
          depth: buffer[data + 8]!,
          type: buffer[data + 9]!,
          interlace: buffer[data + 12]!,
        };
      } else if (type === 'IDAT') idat.push(buffer.subarray(data, data + length));
      else if (type === 'tRNS') transparency = true;
      else if (type === 'IEND') {
        ended = true;
        break;
      }
      pos = data + length + 4;
    }
    if (!header || !ended || !idat.length) return false;
    const channels = CHANNELS[header.type];
    if (!channels || ![1, 2, 4, 8, 16].includes(header.depth) || header.width < 1 || header.height < 1 || header.interlace > 1) return false;
    const bitsPerPixel = channels * header.depth;
    // Each pass (the whole image without interlacing): its rows, each a filter byte and the pixels.
    const passes = header.interlace
      ? ADAM7.map(([xs, ys, dx, dy]) => [Math.ceil(Math.max(0, header!.width - xs) / dx), Math.ceil(Math.max(0, header!.height - ys) / dy)] as const)
      : [[header.width, header.height] as const];
    let expected = 0;
    for (const [w, h] of passes) if (w && h) expected += h * (1 + Math.ceil((w * bitsPerPixel) / 8));
    if (expected > MAX_PIXEL_BYTES) return false;
    const pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
    if (pixels.length !== expected) return false;
    let row = 0;
    for (const [w, h] of passes) {
      if (!w || !h) continue;
      const rowBytes = 1 + Math.ceil((w * bitsPerPixel) / 8);
      for (let y = 0; y < h; y++, row += rowBytes) if (pixels[row]! > 4) return false;
    }
    // pdfkit decodes (with png-js) an image with an alpha channel, an interlaced one, and a palette with transparency.
    const decoded = header.type === 4 || header.type === 6 || header.interlace === 1 || (header.type === 3 && transparency);
    return !decoded || pngJsDecodes(pixels, header.width, header.height, bitsPerPixel, header.interlace === 1);
  } catch {
    return false;
  }
}

/**
 * png-js's `decodePixels` (0.20.x) replayed on the inflated data, without decoding: whether it gets
 * through without throwing. It differs from the PNG specification in two ways that matter here:
 * an interlaced pass with no columns still has its rows read (a filter byte each, so a narrow
 * image's pixel bytes are taken as filter types), and it counts in bytes per pixel, so with fewer
 * than 8 bits a pixel a buffer size that isn't whole throws. Both throws end the process.
 */
function pngJsDecodes(data: Buffer, width: number, height: number, bitsPerPixel: number, interlaced: boolean): boolean {
  const pixelBytes = bitsPerPixel / 8;
  if (!Number.isInteger(width * height * pixelBytes)) return false;
  let pos = 0;
  for (const [x0, y0, dx, dy] of interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const)) {
    const w = Math.ceil((width - x0) / dx);
    const h = Math.ceil((height - y0) / dy);
    const scanline = pixelBytes * w;
    if (interlaced && !Number.isInteger(scanline * h)) return false;
    for (let row = 0; row < h && pos < data.length; row++) {
      if (data[pos++]! > 4) return false;
      pos += Math.ceil(scanline);
    }
  }
  return true;
}
