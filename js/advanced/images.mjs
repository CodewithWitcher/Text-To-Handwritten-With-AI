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
  t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

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
