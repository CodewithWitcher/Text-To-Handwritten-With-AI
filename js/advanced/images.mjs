/**
 * Images placed in an assignment: figures from the question paper (pasted
 * screenshots or uploads) and pictures inside answers. Stored in IndexedDB;
 * documents refer to them with a "[image: id]" line.
 */
import { putBlob, getBlob, deleteBlob } from './store.mjs';
import { uid } from './ui.mjs';

const MAX_SIDE = 1600;
const cache = new Map();

export const IMAGE_LINE_RE = /^\[image:\s*([a-z0-9]+)\s*\]$/i;
const IMAGE_ANY_RE = /\[image:\s*([a-z0-9]+)\s*\]/gi;

export const imageMarker = (id) => `[image: ${id}]`;

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

/** Saves an image file/blob (downscaled, as JPEG) and returns its id. */
export async function addImage(blob) {
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
  const entry = { src: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
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

/** Attaches image data to parsed "image" blocks; drops missing ones. */
export async function resolveImageBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== 'image') {
      out.push(b);
      continue;
    }
    const img = await getImage(b.id);
    if (img) out.push({ ...b, img });
  }
  return out;
}

/**
 * Copies images to the clipboard as one PNG (stacked if several), so they
 * paste into ChatGPT / Claude.ai / Gemini as a single attachment.
 */
export async function copyImagesToClipboard(ids) {
  const imgs = [];
  for (const id of ids) {
    const entry = await getImage(id);
    if (!entry) continue;
    const img = new Image();
    img.src = entry.src;
    await img.decode();
    imgs.push(img);
  }
  if (!imgs.length) return false;
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
  try {
    // Pass a promise so Safari keeps the click's permission while encoding.
    const png = new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
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
