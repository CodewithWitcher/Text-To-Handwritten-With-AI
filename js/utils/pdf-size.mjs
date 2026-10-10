/**
 * Keeps generated PDFs under a hard size limit (10 MB: many university
 * upload forms reject anything bigger). Page images are re-encoded with
 * lower JPEG quality, then lower resolution, until they all fit.
 */

export const PDF_MAX_BYTES = 10 * 1024 * 1024;
// Leave room for the PDF's own structure on top of the images.
const IMAGE_BUDGET = PDF_MAX_BYTES * 0.92;

// [scale, JPEG quality], tried in order: quality first, it's barely visible.
const STEPS = [
  [1, 0.85],
  [1, 0.75],
  [1, 0.65],
  [0.85, 0.65],
  [0.85, 0.55],
  [0.7, 0.55],
  [0.6, 0.5],
  [0.5, 0.5],
  [0.4, 0.45],
  [0.3, 0.4],
  [0.25, 0.35]
];

/** Decoded size of a base64 data URL in bytes. */
export function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.length - dataUrl.indexOf(',') - 1;
  return Math.ceil((b64 * 3) / 4);
}

async function toCanvas(src) {
  if (src instanceof HTMLCanvasElement) return src;
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function encode(canvas, scale, quality) {
  let c = canvas;
  if (scale < 1) {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * scale));
    c.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
  }
  const ctx = c.getContext('2d');
  // JPEG has no transparency: put a white page behind anything see-through.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-over';
  return c.toDataURL('image/jpeg', quality);
}

/**
 * Returns JPEG data URLs for `sources` (data URLs or canvases) whose total
 * size fits `budget` bytes, at the best quality that does.
 */
export async function fitImagesToBudget(sources, budget = IMAGE_BUDGET) {
  const isJpeg = (s) =>
    typeof s === 'string' && s.startsWith('data:image/jpeg');
  // Already small enough: keep the originals untouched.
  if (
    sources.every(isJpeg) &&
    sources.reduce((n, s) => n + dataUrlBytes(s), 0) <= budget
  ) {
    return sources;
  }
  const canvases = [];
  for (const s of sources) canvases.push(await toCanvas(s));
  let out = [];
  for (const [scale, quality] of STEPS) {
    out = canvases.map((c) => encode(c, scale, quality));
    if (out.reduce((n, s) => n + dataUrlBytes(s), 0) <= budget) return out;
  }
  return out; // Smallest we can make; the caller checks the final PDF.
}

/**
 * Builds a PDF with `build(images)` (which must return the jsPDF doc) and
 * shrinks the images until the file is under PDF_MAX_BYTES, then saves it.
 */
export async function saveUnderLimit(sources, build, filename) {
  let budget = IMAGE_BUDGET;
  for (let attempt = 0; attempt < 4; attempt++) {
    const images = await fitImagesToBudget(sources, budget);
    const doc = build(images);
    const size = doc.output('arraybuffer').byteLength;
    if (size <= PDF_MAX_BYTES) {
      doc.save(filename);
      return size;
    }
    budget *= (PDF_MAX_BYTES / size) * 0.9;
  }
  throw new Error(
    'Could not get the PDF under 10 MB. Try fewer pages or download them in parts.'
  );
}
