import type { SamDetection } from "./sam";

// Draws SAM's result on the photo: the mask as a translucent fill with a solid outline, and
// the box as a thin frame. Done on raw pixels (one RGBA layer) so it needs no SVG renderer
// and no font, only sharp for decode/encode.

const MASK_RGBA = [225, 29, 72] as const; // rose-600: reads on both light and dark products
const BOX_RGBA = [245, 158, 11] as const; // amber-500

function setPixel(layer: Uint8Array, width: number, x: number, y: number, rgb: readonly number[], alpha: number) {
  const offset = (y * width + x) * 4;
  layer[offset] = rgb[0];
  layer[offset + 1] = rgb[1];
  layer[offset + 2] = rgb[2];
  layer[offset + 3] = alpha;
}

/** Paint the detections onto a transparent RGBA layer the size of the image. */
export function paintDetections(
  detections: readonly SamDetection[],
  width: number,
  height: number,
): Uint8Array {
  const layer = new Uint8Array(width * height * 4);
  // Thickness follows the photo size so the outline stays visible on a 3000 px photo and
  // does not swallow a 300 px one.
  const thickness = Math.max(2, Math.round(Math.max(width, height) / 500));

  for (const detection of detections) {
    // @meta-sam/parser reports right and bottom as EXCLUSIVE edges (the wire x2/y2 are
    // inclusive; the parser adds one), so the box is [left, right) x [top, bottom).
    const { left, top, right, bottom } = detection.box;
    const boxWidth = right - left;
    const boxHeight = bottom - top;

    const mask = detection.mask;
    if (mask && mask.width > 0 && mask.height > 0 && boxWidth > 0 && boxHeight > 0) {
      // The mask raster covers the box area. If its size differs by a pixel or two from the
      // box (rounding), map it nearest-neighbour instead of trusting equality.
      const at = (x: number, y: number): boolean => {
        const mx = Math.min(mask.width - 1, Math.floor(((x - left) * mask.width) / boxWidth));
        const my = Math.min(mask.height - 1, Math.floor(((y - top) * mask.height) / boxHeight));
        return mask.raster[my * mask.width + mx] === 1;
      };
      const inside = (x: number, y: number) =>
        x >= left && x < right && y >= top && y < bottom && at(x, y);

      for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
        for (let x = Math.max(0, left); x < Math.min(width, right); x++) {
          if (!at(x, y)) continue;
          let edge = false;
          for (let dy = -thickness; dy <= thickness && !edge; dy++) {
            for (let dx = -thickness; dx <= thickness; dx++) {
              if (dx * dx + dy * dy > thickness * thickness) continue;
              if (!inside(x + dx, y + dy)) {
                edge = true;
                break;
              }
            }
          }
          if (edge) setPixel(layer, width, x, y, MASK_RGBA, 255);
          else setPixel(layer, width, x, y, MASK_RGBA, 90);
        }
      }
    }

    // Box frame (drawn after the mask so it stays visible over the fill).
    // At least 2 px: a 1 px line vanishes in JPEG chroma subsampling and on a downscaled preview.
    const frame = thickness;
    for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
      for (let x = Math.max(0, left); x < Math.min(width, right); x++) {
        const onFrame =
          x - left < frame || right - 1 - x < frame || y - top < frame || bottom - 1 - y < frame;
        if (onFrame) setPixel(layer, width, x, y, BOX_RGBA, 255);
      }
    }
  }
  return layer;
}

/** Return the photo (JPEG bytes) with the detections drawn on it. */
export async function annotateImage(
  jpeg: Buffer,
  detections: readonly SamDetection[],
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(jpeg).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new Error("cannot read the photo size");
  const layer = paintDetections(detections, width, height);
  return sharp(jpeg)
    .composite([{ input: Buffer.from(layer.buffer), raw: { width, height, channels: 4 } }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
