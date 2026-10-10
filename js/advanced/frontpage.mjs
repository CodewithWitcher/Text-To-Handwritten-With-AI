/**
 * Front page filler.
 *
 * Upload a university/college front page (image or PDF). We find the blanks
 * next to labels like "Name:", "Roll No.:", "Subject:" and write the student's
 * details there in the chosen handwriting.
 *
 * Detection:
 *  - OCR (no AI): Tesseract gives every line and word with its position; we
 *    match labels from the profile dictionary and place the value after the
 *    label, skipping labels that are already filled in.
 *  - Smart (AI): the same OCR lines are sent to the AI, which decides which line
 *    is which field (handles unusual wording). Positions still come from OCR,
 *    so this works with text-only models too.
 *  - Manual: add a field and drag it into place.
 *
 * The preview is drawn on the same canvas that gets exported (WYSIWYG).
 */
import { allFields, fieldValue, getProfile } from './profile.mjs';
import { ocrLines, pdfFirstPageImage } from './pdf-input.mjs';
import { completeJSON } from './llm.mjs';
import { load, save, putBlob, getBlob, deleteBlob } from './store.mjs';
import { el, readFileAs, uid, toast, $ } from './ui.mjs';

const MAX_W = 2000;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/* ------------------------------ Image input ------------------------------ */

async function fileToImageDataUrl(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return pdfFirstPageImage(file);
  }
  return readFileAs(file);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = src;
  });
}

/** Downscale very large scans so OCR and the PDF stay fast. */
async function normalizeImage(dataUrl) {
  const img = await loadImage(dataUrl);
  if (img.naturalWidth <= MAX_W)
    return { dataUrl, w: img.naturalWidth, h: img.naturalHeight };
  const scale = MAX_W / img.naturalWidth;
  const c = document.createElement('canvas');
  c.width = MAX_W;
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.92), w: c.width, h: c.height };
}

/* ------------------------------- Detection ------------------------------- */
/*
 * Coordinates: every item stores x and y as the text's left edge and
 * alphabetic BASELINE in image pixels, so text sits on the printed blank.
 * Optional extras:
 *   maxWidth  - width of the blank; longer text wraps or shrinks to fit
 *   wrap      - {x, y, maxWidth} a second blank line below (e.g. Address)
 *   parts     - [{x, y, w}] separate slots, e.g. "Date: __/__/____"
 */

const compact = (s) => norm(s).replace(/ /g, '');

// Words that often sit between a label and its blank ("Roll No.", "E-mail Id").
const LABEL_SUFFIX = /^(no|number|num|id|i|d|td|ld|1d)$/;

// Labels that end the previous field but are never filled automatically.
const STOP_LABELS = [
  'signature of the student',
  'signature of student',
  'student signature',
  'signature',
  'sign',
  'seal',
  'stamp'
];

function labelDictionary() {
  const entries = STOP_LABELS.map((l) => ({ key: null, c: compact(l) }));
  for (const f of allFields(getProfile())) {
    for (const l of f.labels) {
      const c = compact(l);
      if (c) entries.push({ key: f.key, c });
    }
  }
  // Longest first, so "programme code" wins over "programme".
  return entries.sort((a, b) => b.c.length - a.c.length);
}

/**
 * Flattens an OCR line into a compact string (lowercase letters/digits only)
 * plus, for every character, its approximate x position and whether a word
 * starts there. OCR often merges words ("ProgrammeCode", "phoneNo."), so we
 * match labels on this string instead of word by word.
 */
function lineChars(line) {
  const chars = [];
  for (const w of line.words) {
    const raw = String(w.text || '');
    const total = raw.length || 1;
    let offset = 0;
    for (const part of raw.toLowerCase().split(/([^a-z0-9]+)/)) {
      if (part && /^[a-z0-9]+$/.test(part)) {
        for (let k = 0; k < part.length; k++) {
          const i = offset + k;
          chars.push({
            ch: part[k],
            start: k === 0,
            x0: w.bbox.x0 + ((w.bbox.x1 - w.bbox.x0) * i) / total,
            x1: w.bbox.x0 + ((w.bbox.x1 - w.bbox.x0) * (i + 1)) / total
          });
        }
      }
      offset += part.length;
    }
  }
  return chars;
}

function findLabels(line, dict) {
  const chars = lineChars(line);
  const text = chars.map((c) => c.ch).join('');
  const matches = [];
  let i = 0;
  while (i < text.length) {
    let hit = null;
    if (chars[i].start) {
      for (const e of dict) {
        if (!text.startsWith(e.c, i)) continue;
        const end = i + e.c.length;
        // Short labels ("sem", "div", "code") must be whole words.
        if (e.c.length <= 4 && end < text.length && !chars[end].start) continue;
        hit = { key: e.key, from: i, to: end };
        break;
      }
    }
    if (hit) {
      matches.push(hit);
      i = hit.to;
    } else {
      i++;
    }
  }
  const result = matches.map((m, idx) => {
    const nextFrom =
      idx + 1 < matches.length ? matches[idx + 1].from : text.length;
    // Skip "No." / "Id" style suffixes between the label and the blank.
    let to = m.to;
    let rest = text.slice(to, nextFrom);
    const suffix = /^(no|number|id|td|ld|1d|i?d)/.exec(rest);
    if (suffix && LABEL_SUFFIX.test(suffix[0])) to += suffix[0].length;
    rest = text.slice(to, nextFrom);
    return {
      key: m.key,
      startX: chars[m.from].x0,
      endX: chars[to - 1].x1,
      nextX: nextFrom < text.length ? chars[nextFrom].x0 : Infinity,
      // Anything substantial between this label and the next means it's already filled in.
      filled: rest.replace(/^(no|id)/, '').length >= 4
    };
  });
  return result.filter((m) => m.key !== null);
}

/* ---- Pixel helpers: find the printed underline of each blank ---- */

function pixelReader(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const W = c.width;
  const H = c.height;
  const dark = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = (y * W + x) * 4;
    return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 150;
  };
  return { W, H, dark };
}

/** Horizontal dark runs on row y between x0 and x1 (small gaps tolerated). */
function runsOnRow(px, y, x0, x1, gap = 3) {
  const runs = [];
  let start = -1;
  let last = -1;
  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(px.W, x1); x++) {
    // Treat a 2px-thick line robustly: look at this row and the one below.
    if (px.dark(x, y) || px.dark(x, y + 1)) {
      if (start < 0) start = x;
      last = x;
    } else if (start >= 0 && x - last > gap) {
      runs.push({ x0: start, x1: last });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ x0: start, x1: last });
  return runs;
}

/**
 * Finds the underline of the blank that follows a label: the row (around the
 * text baseline) with the longest dark run starting shortly after the label.
 */
function findUnderline(px, line, fromX, toX) {
  const h = line.bbox.y1 - line.bbox.y0;
  let best = null;
  for (
    let y = Math.round(line.bbox.y0 + h * 0.4);
    y <= line.bbox.y1 + h * 0.6;
    y++
  ) {
    const runs = runsOnRow(px, y, fromX - 2, Math.min(px.W, toX));
    // Ignore the label's own letters: a real blank is long and nearly unbroken.
    const total = runs
      .filter((r) => r.x1 - r.x0 >= h * 0.6)
      .reduce((n, r) => n + (r.x1 - r.x0), 0);
    if (!runs.length || total < h * 2) continue;
    const first = runs.find((r) => r.x1 - r.x0 >= h * 0.6);
    if (!first || first.x0 - fromX > h * 3) continue;
    if (!best || total > best.total) {
      const segs = runs.filter((r) => r.x1 - r.x0 >= h * 0.6);
      best = { y, x0: first.x0, x1: segs[segs.length - 1].x1, total, segs };
    }
  }
  return best;
}

/** A label-less blank line directly below (e.g. the second Address line). */
function findContinuation(px, line, underline, lines) {
  const h = line.bbox.y1 - line.bbox.y0;
  const yFrom = Math.round(underline.y + h * 1.1);
  const yTo = Math.round(underline.y + h * 3.2);
  // Must not belong to another labelled line.
  if (
    lines.some(
      (l) =>
        l !== line &&
        l.bbox.y1 > yFrom - h * 0.3 &&
        l.bbox.y0 < yTo &&
        l.text.replace(/[^a-z]/gi, '').length > 2
    )
  ) {
    return null;
  }
  for (let y = yFrom; y <= yTo; y++) {
    const runs = runsOnRow(px, y, line.bbox.x0 - h * 2, px.W);
    const r = runs.find((x) => x.x1 - x.x0 > h * 6);
    if (r)
      return {
        x: r.x0 + h * 0.3,
        y: y - Math.max(2, h * 0.12),
        maxWidth: r.x1 - r.x0 - h * 0.5
      };
  }
  return null;
}

function placeField(px, line, match, lines) {
  const h = Math.max(10, line.bbox.y1 - line.bbox.y0);
  const size = Math.max(14, Math.min(72, h * 1.05));
  const under =
    px &&
    findUnderline(
      px,
      line,
      match.endX,
      match.nextX === Infinity ? px.W : match.nextX
    );
  if (under) {
    const baseline = under.y - Math.max(2, h * 0.12);
    const item = {
      x: under.x0 + size * 0.25,
      y: baseline,
      size,
      maxWidth: Math.max(size * 2, under.x1 - under.x0 - size * 0.4)
    };
    // "__ / __ / ____" -> one slot per segment (dates).
    if (match.key === 'date' && under.segs.length >= 3) {
      item.parts = under.segs.slice(0, 3).map((sg) => ({
        x: (sg.x0 + sg.x1) / 2,
        y: baseline,
        w: sg.x1 - sg.x0
      }));
    } else {
      const cont = findContinuation(px, line, under, lines);
      if (cont) item.wrap = cont;
    }
    return item;
  }
  // No printed blank (e.g. "Name:" followed by empty space): write after the label.
  return {
    x: match.endX + size * 0.45,
    y: line.bbox.y1 - h * 0.18,
    size,
    maxWidth:
      (match.nextX === Infinity
        ? (px ? px.W : 2000) * 0.95
        : match.nextX - size) -
      (match.endX + size * 0.45)
  };
}

export function detectFromLines(lines, px) {
  const dict = labelDictionary();
  const heights = lines.map((l) => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 30;
  const found = [];
  const used = new Set();
  for (const line of lines) {
    // Skip big titles (university name, logo text).
    if (line.bbox.y1 - line.bbox.y0 > medianH * 1.6) continue;
    for (const m of findLabels(line, dict)) {
      if (used.has(m.key) || m.filled) continue;
      used.add(m.key);
      found.push({ id: uid(), key: m.key, ...placeField(px, line, m, lines) });
    }
  }
  return harmonizeSizes(found);
}

/** Use one text size for all fields (the median), like a real hand would. */
function harmonizeSizes(items) {
  if (items.length < 2) return items;
  const sizes = items.map((i) => i.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  return items.map((i) => ({ ...i, size: median }));
}

async function detectWithAI(lines, imageDataUrl, provider, px) {
  const fields = allFields(getProfile());
  const listing = lines.map((l, i) => `L${i}: ${l.text}`).join('\n');
  const fieldList = fields.map((f) => `${f.key} = ${f.label}`).join('\n');
  const result = await completeJSON(
    {
      system:
        'You map the blank fields on a university/college assignment front page to student profile fields. ' +
        'Only include labels that are followed by a blank to fill in (e.g. "Name: ____", "Roll No. ......"). ' +
        'OCR often drops the underscores and merges words, so "ProgrammeCode" alone on a line is still a blank field. ' +
        'Ignore headings, the university name printed as a title, logos, instructions and "Signature".',
      prompt:
        `Profile fields (key = meaning):\n${fieldList}\nother = a blank that matches none of the above\n\n` +
        `OCR lines of the front page:\n${listing}\n\n` +
        'Return JSON: {"fields":[{"line":"L3","field":"name","label":"exact label text as it appears in that line"}]}',
      images: provider.vision ? [imageDataUrl] : [],
      jsonSchema: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                line: { type: 'string' },
                field: { type: 'string' },
                label: { type: 'string' }
              },
              required: ['line', 'field', 'label'],
              additionalProperties: false
            }
          }
        },
        required: ['fields'],
        additionalProperties: false
      },
      effort: 'low'
    },
    provider
  );

  const out = [];
  const used = new Set();
  for (const f of result.fields || []) {
    const line = lines[Number(String(f.line).replace(/\D/g, ''))];
    if (!line || !line.words.length) continue;
    const key = fields.some((x) => x.key === f.field)
      ? f.field
      : `other:${f.label}`;
    if (used.has(key)) continue;
    // Locate the label inside the line using the same compact matching.
    const own = findLabels(line, [{ key, c: compact(f.label) }]);
    const match = own[0] || {
      key,
      startX: line.bbox.x0,
      endX: line.bbox.x0 + (line.bbox.x1 - line.bbox.x0) * 0.4,
      nextX: Infinity
    };
    used.add(key);
    out.push({
      id: uid(),
      key,
      label: key.startsWith('other:') ? f.label : undefined,
      ...placeField(px, line, { ...match, key }, lines)
    });
  }
  return harmonizeSizes(out);
}

/* -------------------------------- Drawing -------------------------------- */

function itemText(item) {
  if (item.value !== undefined && item.value !== null && item.value !== '')
    return item.value;
  if (item.key.startsWith('other:')) return '';
  return fieldValue(item.key);
}

/** Splits text so the first part fits `width`. */
function splitToFit(ctx, text, width) {
  const words = text.split(/\s+/);
  let first = '';
  let i = 0;
  for (; i < words.length; i++) {
    const tryText = first ? `${first} ${words[i]}` : words[i];
    if (ctx.measureText(tryText).width > width && first) break;
    first = tryText;
  }
  return [first, words.slice(i).join(' ')];
}

/**
 * Works out exactly where an item's text goes (shared by drawing and the
 * drag handles): [{ text, x, y, size, align }]
 */
/**
 * Handwriting fonts draw very different letter sizes at the same px size.
 * Scale each font so its lowercase letters (x-height, which most text is)
 * look about as big as printed form text. Cached once the font is loaded.
 */
const TARGET_X_HEIGHT = 48; // per 100px; printed Calibri/Arial are ~50-52
const fontScaleCache = new Map();
function fontScale(ctx, font) {
  if (fontScaleCache.has(font)) return fontScaleCache.get(font);
  ctx.font = `100px ${font}`;
  const x = ctx.measureText('x').actualBoundingBoxAscent || TARGET_X_HEIGHT;
  const scale = Math.min(1.6, Math.max(0.85, TARGET_X_HEIGHT / x));
  const family = font.split(',')[0].trim();
  if (document.fonts.check(`100px ${family}`)) fontScaleCache.set(font, scale);
  return scale;
}

export function layoutItem(ctx, item, text, font) {
  const out = [];
  const base = item.size * fontScale(ctx, font);
  let size = base;
  const setFont = (s) => (ctx.font = `${s}px ${font}`);
  setFont(size);

  if (item.parts && item.parts.length) {
    const pieces = text.split(/\s*[/\-.]\s*/).filter(Boolean);
    if (pieces.length === item.parts.length) {
      pieces.forEach((p, i) =>
        out.push({
          text: p,
          x: item.parts[i].x,
          y: item.parts[i].y,
          size,
          align: 'center'
        })
      );
      return out;
    }
  }

  const maxW = item.maxWidth || Infinity;
  if (ctx.measureText(text).width <= maxW) {
    out.push({ text, x: item.x, y: item.y, size, align: 'left' });
    return out;
  }
  if (item.wrap) {
    // Fit across two lines, shrinking a little if needed.
    for (let s = size; s >= size * 0.65; s -= 1) {
      setFont(s);
      const [a, b] = splitToFit(ctx, text, maxW);
      if (!b || ctx.measureText(b).width <= item.wrap.maxWidth) {
        out.push({ text: a, x: item.x, y: item.y, size: s, align: 'left' });
        if (b)
          out.push({
            text: b,
            x: item.wrap.x,
            y: item.wrap.y,
            size: s,
            align: 'left'
          });
        return out;
      }
    }
  }
  // Shrink to fit the blank (not below 65%).
  while (size > base * 0.65 && ctx.measureText(text).width > maxW) {
    size -= 1;
    setFont(size);
  }
  out.push({ text, x: item.x, y: item.y, size, align: 'left' });
  return out;
}

function drawFrontPage(canvas, img, items, style) {
  const ctx = canvas.getContext('2d');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = style.inkBody;
  for (const item of items) {
    const text = itemText(item);
    if (!text) continue;
    for (const piece of layoutItem(ctx, item, text, style.font)) {
      ctx.font = `${piece.size}px ${style.font}`;
      ctx.textAlign = piece.align;
      ctx.fillText(piece.text, piece.x, piece.y);
    }
  }
  ctx.textAlign = 'left';
}

/** Moves an item and everything attached to it. */
function shiftItem(item, dx, dy) {
  item.x += dx;
  item.y += dy;
  if (item.wrap) {
    item.wrap.x += dx;
    item.wrap.y += dy;
  }
  if (item.parts) item.parts.forEach((p) => ((p.x += dx), (p.y += dy)));
}

/** Older saves stored the text's top edge; convert to baseline. */
function migrateItems(items, version) {
  if (version >= 2) return items;
  return items.map((i) => ({ ...i, y: i.y + i.size * 0.85 }));
}

/* ------------------------------- Controller ------------------------------ */

export class FrontPageEditor {
  constructor(root, { getStyle, getProvider, onChange }) {
    this.root = root;
    this.getStyle = getStyle;
    this.getProvider = getProvider;
    this.onChange = onChange || (() => {});
    this.state = load('frontpage', {
      enabled: false,
      items: [],
      hasImage: false,
      v: 2
    });
    this.state.items = migrateItems(this.state.items || [], this.state.v || 1);
    this.state.v = 2;
    this.img = null;
    this.canvas = $('#fp-canvas', root);
    this.handles = $('#fp-handles', root);
    this.list = $('#fp-fields', root);
    this.status = $('#fp-status', root);
    this.wire();
    this.restore();
  }

  persist() {
    save('frontpage', this.state);
    this.onChange();
  }

  async restore() {
    if (!this.state.hasImage) return this.refreshEmpty();
    const dataUrl = await getBlob('frontpage-image');
    if (!dataUrl) {
      this.state.hasImage = false;
      return this.refreshEmpty();
    }
    this.img = await loadImage(dataUrl);
    this.redraw();
  }

  refreshEmpty() {
    $('#fp-editor', this.root).hidden = true;
    $('#fp-empty', this.root).hidden = false;
    this.renderSaved();
  }

  wire() {
    for (const id of ['#fp-file', '#fp-file-replace']) {
      $(id, this.root).addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.setImageFromFile(file);
        e.target.value = '';
      });
    }
    $('#fp-detect-ocr', this.root).addEventListener('click', () =>
      this.detect(false)
    );
    $('#fp-detect-ai', this.root).addEventListener('click', () =>
      this.detect(true)
    );
    $('#fp-add', this.root).addEventListener('click', () => this.addItem());
    $('#fp-clear-fields', this.root).addEventListener('click', () => {
      this.state.items = [];
      this.persist();
      this.redraw();
    });
    $('#fp-remove', this.root).addEventListener('click', () =>
      this.removeImage()
    );
    $('#fp-save-template', this.root).addEventListener('click', () =>
      this.saveAsTemplate()
    );
    $('#fp-download', this.root).addEventListener('click', async () => {
      const url = await this.exportDataUrl();
      if (url) {
        const a = el('a', { href: url, download: 'front-page.jpg' });
        a.click();
      }
    });
    window.addEventListener('resize', () => this.positionHandles());
  }

  setStatus(msg) {
    this.status.textContent = msg || '';
  }

  async setImageFromFile(file) {
    try {
      this.setStatus('Loading front page…');
      const raw = await fileToImageDataUrl(file);
      const { dataUrl } = await normalizeImage(raw);
      await putBlob('frontpage-image', dataUrl);
      this.img = await loadImage(dataUrl);
      this.state.hasImage = true;
      this.state.enabled = true;
      this.state.items = [];
      this.persist();
      this.redraw();
      this.setStatus(
        'Front page loaded. Click "Auto-detect fields" to fill it in.'
      );
    } catch (e) {
      this.setStatus('');
      toast(`Could not open that file: ${e.message}`, 'error');
    }
  }

  async removeImage() {
    await deleteBlob('frontpage-image');
    this.img = null;
    this.state = { enabled: false, items: [], hasImage: false, v: 2 };
    this.persist();
    this.refreshEmpty();
  }

  async detect(useAI) {
    if (!this.img) return;
    const btn = useAI
      ? $('#fp-detect-ai', this.root)
      : $('#fp-detect-ocr', this.root);
    btn.disabled = true;
    try {
      const provider = this.getProvider();
      if (useAI && !provider) {
        toast(
          'Set up an AI provider in "AI Settings" first, or use OCR detection.',
          'error'
        );
        return;
      }
      const lines = await ocrLines(this.img.src, (m) => this.setStatus(m));
      if (!lines.length) {
        this.setStatus('No text found on this page. Add fields manually.');
        return;
      }
      this.setStatus('Measuring the blank lines…');
      const px = pixelReader(this.img);
      let items;
      if (useAI) {
        this.setStatus('Asking the AI which blanks are which…');
        items = await detectWithAI(lines, this.img.src, provider, px);
      } else {
        items = detectFromLines(lines, px);
      }
      this.state.items = items;
      this.persist();
      this.redraw();
      const missing = items.filter((i) => !itemText(i)).length;
      this.setStatus(
        items.length
          ? `Found ${items.length} field(s).${
              missing
                ? ` ${missing} have no value yet; fill them in below or in My Profile.`
                : ''
            } Drag text to fine-tune.`
          : 'No blank fields recognised. Use "Add field" to place them manually.'
      );
    } catch (e) {
      this.setStatus('');
      toast(e.message, 'error', 7000);
    } finally {
      btn.disabled = false;
    }
  }

  addItem() {
    if (!this.img) return;
    const size = Math.round(this.img.naturalWidth / 45);
    this.state.items.push({
      id: uid(),
      key: 'name',
      x: this.img.naturalWidth * 0.3,
      y: this.img.naturalHeight * 0.5,
      maxWidth: this.img.naturalWidth * 0.6,
      size
    });
    this.persist();
    this.redraw();
  }

  redraw() {
    if (!this.img) return this.refreshEmpty();
    $('#fp-editor', this.root).hidden = false;
    $('#fp-empty', this.root).hidden = true;
    const style = this.getStyle();
    drawFrontPage(this.canvas, this.img, this.state.items, style);
    // Redraw once the handwriting font has loaded (sizes depend on it).
    this.fontWaits = this.fontWaits || new Set();
    if (!this.fontWaits.has(style.font)) {
      this.fontWaits.add(style.font);
      document.fonts.load(`40px ${style.font}`).then(() => this.redraw());
    }
    this.renderList();
    this.positionHandles();
    this.renderSaved();
  }

  positionHandles() {
    if (!this.img) return;
    const scale = this.canvas.clientWidth / this.img.naturalWidth || 1;
    const ctx = this.canvas.getContext('2d');
    const style = this.getStyle();
    this.handles.textContent = '';
    for (const item of this.state.items) {
      const text = itemText(item) || item.label || item.key;
      // Box around the first piece of text (or the whole date slots).
      const pieces = layoutItem(ctx, item, text, style.font);
      const first = pieces[0];
      ctx.font = `${first.size}px ${style.font}`;
      let left = item.x;
      let width = Math.max(40, ctx.measureText(first.text).width);
      if (item.parts && item.parts.length) {
        left = item.parts[0].x - item.parts[0].w / 2;
        const lastPart = item.parts[item.parts.length - 1];
        width = lastPart.x + lastPart.w / 2 - left;
      } else if (item.maxWidth) {
        width = Math.min(Math.max(width, 40), item.maxWidth);
      }
      const h = el('div.fp-handle', {
        title: `${text} (drag to move, arrow keys to nudge)`,
        style: {
          left: `${left * scale}px`,
          top: `${(item.y - first.size * 0.85) * scale}px`,
          width: `${width * scale}px`,
          height: `${first.size * 1.05 * scale}px`
        }
      });
      if (!itemText(item)) h.classList.add('empty');
      this.makeDraggable(h, item, scale);
      this.handles.append(h);
    }
  }

  makeDraggable(handle, item, scale) {
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      start = {
        x: e.clientX,
        y: e.clientY,
        left: parseFloat(handle.style.left),
        top: parseFloat(handle.style.top)
      };
      start.moved = { x: 0, y: 0 };
      handle.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = (e.clientX - start.x) / scale;
      const dy = (e.clientY - start.y) / scale;
      shiftItem(item, dx - start.moved.x, dy - start.moved.y);
      start.moved = { x: dx, y: dy };
      handle.style.left = `${start.left + dx * scale}px`;
      handle.style.top = `${start.top + dy * scale}px`;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() =>
        drawFrontPage(this.canvas, this.img, this.state.items, this.getStyle())
      );
    });
    const end = () => {
      if (!start) return;
      start = null;
      handle.classList.remove('dragging');
      this.persist();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    // Arrow keys for fine positioning.
    handle.tabIndex = 0;
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 2;
      const d = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }[e.key];
      if (!d) return;
      e.preventDefault();
      shiftItem(item, d[0], d[1]);
      this.persist();
      this.redraw();
    });
  }

  renderList() {
    const fields = allFields(getProfile());
    this.list.textContent = '';
    if (!this.state.items.length) {
      this.list.append(el('p.adv-hint', { text: 'No fields placed yet.' }));
      return;
    }
    for (const item of this.state.items) {
      const select = el('select', { 'aria-label': 'Field' });
      for (const f of fields) {
        select.append(el('option', { value: f.key, text: f.label }));
      }
      if (item.key.startsWith('other:')) {
        select.append(
          el('option', { value: item.key, text: `Other: ${item.label || ''}` })
        );
      }
      select.value = item.key;
      select.addEventListener('change', () => {
        item.key = select.value;
        item.value = '';
        this.persist();
        this.redraw();
      });

      const value = el('input', {
        placeholder: fieldValue(item.key) || 'Type the value',
        'aria-label': 'Value override'
      });
      value.value = item.value || '';
      value.addEventListener('input', () => {
        item.value = value.value;
        this.persist();
        drawFrontPage(this.canvas, this.img, this.state.items, this.getStyle());
        this.positionHandles();
      });

      const size = el('input', {
        type: 'number',
        min: '8',
        max: '200',
        'aria-label': 'Text size'
      });
      size.value = Math.round(item.size);
      size.addEventListener('change', () => {
        item.size = Math.max(8, Number(size.value) || item.size);
        this.persist();
        this.redraw();
      });

      this.list.append(
        el('div.fp-row', {}, [
          select,
          value,
          size,
          el('button.adv-icon-btn', {
            type: 'button',
            text: '×',
            title: 'Remove',
            'aria-label': 'Remove field',
            onclick: () => {
              this.state.items = this.state.items.filter((x) => x !== item);
              this.persist();
              this.redraw();
            }
          })
        ])
      );
    }
  }

  /* Saved front pages: reuse the same layout for every assignment. */
  savedList() {
    return load('frontpage-templates', []);
  }

  async saveAsTemplate() {
    if (!this.img) return;
    const name = window.prompt(
      'Name this front page (e.g. "XYZ University – assignment"):'
    );
    if (!name) return;
    const id = uid();
    await putBlob(`frontpage-template:${id}`, this.img.src);
    const list = this.savedList();
    list.push({
      id,
      name,
      v: 2,
      items: this.state.items.map((i) => ({ ...i, value: '' }))
    });
    save('frontpage-templates', list);
    this.renderSaved();
    toast('Front page saved for reuse.', 'success');
  }

  renderSaved() {
    const box = $('#fp-saved', this.root);
    const list = this.savedList();
    box.textContent = '';
    if (!list.length) return;
    box.append(el('span.adv-hint', { text: 'Saved front pages: ' }));
    for (const t of list) {
      box.append(
        el('span.chip', {}, [
          el('button.chip-main', {
            type: 'button',
            text: t.name,
            onclick: async () => {
              const dataUrl = await getBlob(`frontpage-template:${t.id}`);
              if (!dataUrl)
                return toast('That saved image is missing.', 'error');
              await putBlob('frontpage-image', dataUrl);
              this.img = await loadImage(dataUrl);
              this.state = {
                enabled: true,
                hasImage: true,
                v: 2,
                items: migrateItems(t.items, t.v || 1).map((i) => ({
                  ...i,
                  id: uid()
                }))
              };
              this.persist();
              this.redraw();
            }
          }),
          el('button.chip-x', {
            type: 'button',
            text: '×',
            'aria-label': `Delete saved front page ${t.name}`,
            onclick: async () => {
              await deleteBlob(`frontpage-template:${t.id}`);
              save(
                'frontpage-templates',
                this.savedList().filter((x) => x.id !== t.id)
              );
              this.renderSaved();
            }
          })
        ])
      );
    }
  }

  isEnabled() {
    return !!(this.state.enabled && this.img);
  }

  setEnabled(on) {
    this.state.enabled = on;
    this.persist();
  }

  async exportDataUrl() {
    if (!this.img) return null;
    const style = this.getStyle();
    try {
      await document.fonts.load(`32px ${style.font}`);
    } catch (e) {
      /* ignore */
    }
    const c = document.createElement('canvas');
    drawFrontPage(c, this.img, this.state.items, style);
    return c.toDataURL('image/jpeg', 0.92);
  }
}
