/**
 * Images placed in an assignment: figures from the question paper (pasted
 * screenshots or uploads) and pictures inside answers. Stored in IndexedDB;
 * documents refer to them with a "[image: id]" line.
 */
import { putBlob, getBlob, deleteBlob } from './store.mjs';
import { uid } from './ui.mjs';

const MAX_SIDE = 1600;
const cache = new Map();

// "[image: id]" or "[image: id | Fig: caption]".
const IMAGE_ANY_RE = /\[image:\s*([a-z0-9]+)\s*(?:\|[^\]]*)?\]/gi;

export const imageMarker = (id, caption = '') =>
  caption ? `[image: ${id} | ${caption}]` : `[image: ${id}]`;

/** The first image on the clipboard (Clipboard API), or null. */
export async function readClipboardImage() {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  return null;
}

/** Images placed in a text: [{ id, caption, marker }] in order. */
export function imageRefsIn(text) {
  return [
    ...String(text || '').matchAll(
      /\[image:\s*([a-z0-9]+)\s*(?:\|\s*([^\]]*?)\s*)?\]/gi
    )
  ].map((m) => ({ id: m[1], caption: m[2] || '', marker: m[0] }));
}

/** Image ids referenced in a piece of text. */
export function imageIdsIn(text) {
  return [...String(text || '').matchAll(IMAGE_ANY_RE)].map((m) => m[1]);
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the image.'));
    r.readAsDataURL(blob);
  });
}

/**
 * Saves an image file/blob (downscaled, as JPEG) and returns its id.
 * kind: 'figure' (from the question paper) or 'drawing' (part of an answer,
 * e.g. a diagram made by Gemini: drawn in the answer's ink on the page).
 */
export async function addImage(blob, { kind = 'figure' } = {}) {
  const img = new Image();
  img.src = await readAsDataUrl(blob);
  await img.decode();
  const scale = Math.min(
    1,
    MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight)
  );
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const entry = {
    src: c.toDataURL('image/jpeg', 0.9),
    w: c.width,
    h: c.height,
    kind
  };
  const id = uid();
  cache.set(id, entry);
  await putBlob(`img:${id}`, entry);
  return id;
}

/** { src, w, h } or null. */
export async function getImage(id) {
  if (cache.has(id)) return cache.get(id);
  const entry = await getBlob(`img:${id}`);
  if (entry && entry.src) {
    cache.set(id, entry);
    return entry;
  }
  return null;
}

export async function deleteImage(id) {
  cache.delete(id);
  await deleteBlob(`img:${id}`);
}

/** The first image in a paste/drop event, if any. */
export function imageFromClipboard(e) {
  const items = (e.clipboardData || e.dataTransfer || {}).items || [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/'))
      return item.getAsFile();
  }
  return null;
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  return m ? m.slice(1).map((h) => parseInt(h, 16)) : [20, 40, 140];
};

/**
 * Makes an image look drawn on the page instead of pasted on it: the paper
 * of the image (white, cream, grey...) becomes transparent so the page's own
 * paper and ruled lines show through, and drawings take the answer's ink.
 */
async function blendIntoPage(entry, ink) {
  const img = new Image();
  img.src = entry.src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = entry.w;
  c.height = entry.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const lum = new Float32Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++)
    lum[j] = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;

  // The image's paper tone, measured locally (per tile) so shading,
  // vignettes and uneven light on "paper" backgrounds disappear too. Most
  // of each tile is paper, so its bright end is the local paper tone.
  const W = c.width;
  const H = c.height;
  const cell = Math.max(12, Math.round(Math.min(W, H) / 20));
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const bg = new Float32Array(cols * rows);
  const all = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const vals = [];
      for (let y = cy * cell; y < Math.min(H, (cy + 1) * cell); y += 2)
        for (let x = cx * cell; x < Math.min(W, (cx + 1) * cell); x += 2)
          vals.push(lum[y * W + x]);
      vals.sort((a, b) => a - b);
      bg[cy * cols + cx] = vals[Math.floor(vals.length * 0.85)];
      all.push(vals[Math.floor(vals.length * 0.02)]);
    }
  }
  // A tile that's almost all ink (a filled shape) would look like dark
  // paper: take the brightest of each tile and its neighbours instead.
  const bgMax = new Float32Array(bg.length);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const y = cy + dy;
          const x = cx + dx;
          if (y >= 0 && y < rows && x >= 0 && x < cols)
            m = Math.max(m, bg[y * cols + x]);
        }
      bgMax[cy * cols + cx] = m;
    }
  // Smooth between tile centres (bilinear) so no tile edges show.
  const paperAt = (x, y) => {
    const fx = Math.min(cols - 1, Math.max(0, x / cell - 0.5));
    const fy = Math.min(rows - 1, Math.max(0, y / cell - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = bgMax[y0 * cols + x0] * (1 - tx) + bgMax[y0 * cols + x1] * tx;
    const bot = bgMax[y1 * cols + x0] * (1 - tx) + bgMax[y1 * cols + x1] * tx;
    return top * (1 - ty) + bot * ty;
  };
  all.sort((a, b) => a - b);
  const dark = all[Math.floor(all.length * 0.05)] || 0;

  const [ir, ig, ib] = hexToRgb(ink);
  const drawing = entry.kind === 'drawing';
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const paper = paperAt(j % W, (j / W) | 0);
    // Anything within this of the local paper tone (texture) disappears.
    const clearAbove = paper - Math.max(18, (paper - dark) * 0.2);
    const span = Math.max(1, clearAbove - dark);
    const t = Math.min(1, Math.max(0, (clearAbove - lum[j]) / span));
    const a = Math.pow(t, 0.75); // soft edges, like ink on paper
    if (drawing) {
      px[i] = ir;
      px[i + 1] = ig;
      px[i + 2] = ib;
      px[i + 3] = Math.round(a * 235); // ink is never fully opaque
    } else {
      px[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(data, 0, 0);
  return { ...entry, src: c.toDataURL('image/png') };
}

const blendCache = new Map();

/**
 * Attaches image data to parsed "image" blocks (drops missing ones), blended
 * into the page with the given answer ink.
 */
export async function resolveImageBlocks(blocks, { ink = '#1a2f8f' } = {}) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'image') {
      out.push(b);
      continue;
    }
    const img = await blendedImage(b.id, ink);
    if (img) out.push({ ...b, img });
  }
  return out;
}

/** An image as it will look on the page ({ src, w, h }), or null. */
export async function blendedImage(id, ink = '#1a2f8f') {
  const img = await getImage(id);
  if (!img) return null;
  const key = `${id}|${img.kind === 'drawing' ? ink : ''}`;
  if (!blendCache.has(key)) {
    try {
      blendCache.set(key, await blendIntoPage(img, ink));
    } catch (e) {
      blendCache.set(key, img); // keep the original if anything fails
    }
  }
  return blendCache.get(key);
}

/** The images stacked into one PNG canvas (null if none). */
async function stackImages(ids) {
  const imgs = [];
  for (const id of ids) {
    const entry = await getImage(id);
    if (!entry) continue;
    const img = new Image();
    img.src = entry.src;
    await img.decode();
    imgs.push(img);
  }
  if (!imgs.length) return null;
  const gap = 20;
  const c = document.createElement('canvas');
  c.width = Math.max(...imgs.map((i) => i.naturalWidth));
  c.height =
    imgs.reduce((n, i) => n + i.naturalHeight, 0) + gap * (imgs.length - 1);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const img of imgs) {
    ctx.drawImage(img, 0, y);
    y += img.naturalHeight + gap;
  }
  return c;
}

const pngBlob = (canvas) =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

/**
 * Copies images to the clipboard as one PNG (stacked if several), so they
 * paste into ChatGPT / Claude.ai / Gemini as a single attachment.
 */
export async function copyImagesToClipboard(ids) {
  try {
    // write() runs right away (still inside the click) with the image as a
    // promise; waiting first makes browsers drop or refuse the copy.
    const png = stackImages(ids).then((c) => {
      if (!c) throw new Error('No image');
      return pngBlob(c);
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch (e) {
    return false;
  }
}

const escapeHtml = (t) =>
  t.replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])
  );

/**
 * Copies a prompt and its figures in one go. The clipboard gets three
 * versions of the same thing and each chat site takes what it supports:
 * plain text, rich text (HTML with the figure inside) and the image itself.
 */
export async function copyTextWithImages(text, ids) {
  try {
    // Must be called straight from the click, before any await: write()
    // starts immediately and the image parts follow as promises. Waiting for
    // the image first loses the click, and browsers then drop parts of the
    // copy (e.g. the text).
    const canvas = stackImages(ids).then((c) => {
      if (!c) throw new Error('No image');
      return c;
    });
    const html = canvas.then(
      (c) =>
        new Blob(
          [
            `<div>${escapeHtml(text).replace(
              /\n/g,
              '<br>'
            )}</div><img src="${c.toDataURL('image/png')}" alt="Figure">`
          ],
          { type: 'text/html' }
        )
    );
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': html,
        'image/png': canvas.then(pngBlob)
      })
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

/** Downloads the figures as image files (when the clipboard is blocked). */
export async function downloadImages(ids, name = 'figure') {
  let n = 0;
  for (const id of ids) {
    const entry = await getImage(id);
    if (!entry) continue;
    n++;
    const a = document.createElement('a');
    a.href = entry.src;
    a.download = `${name}-${n}.jpg`;
    a.click();
  }
}
