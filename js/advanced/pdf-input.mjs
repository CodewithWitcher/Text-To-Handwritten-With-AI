/**
 * Reading uploaded documents: PDF text extraction (pdf.js), rendering PDF
 * pages to images, and OCR (Tesseract) for scanned pages and front pages.
 */
import { loadPdfJs, loadTesseract } from './loaders.mjs';
import { readFileAs } from './ui.mjs';

async function openPdf(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await readFileAs(file, 'arrayBuffer'));
  return pdfjs.getDocument({ data }).promise;
}

/** Rebuilds readable lines from pdf.js text items (keeps line breaks). */
function itemsToText(items) {
  const lines = [];
  let current = '';
  let lastY = null;
  for (const item of items) {
    if (!('str' in item)) continue;
    const y = item.transform ? Math.round(item.transform[5]) : lastY;
    if (
      lastY !== null &&
      y !== null &&
      Math.abs(y - lastY) > 2 &&
      current.trim()
    ) {
      lines.push(current.trimEnd());
      current = '';
    }
    current += item.str;
    if (item.hasEOL) {
      lines.push(current.trimEnd());
      current = '';
    }
    lastY = y;
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.join('\n');
}

/**
 * Extracts text from a PDF. Pages with no text layer (scans) are OCR'd.
 * onProgress(message) is called with human-readable progress.
 */
export async function extractPdfText(
  file,
  { onProgress = () => {}, ocr = true } = {}
) {
  const pdf = await openPdf(file);
  const pages = [];
  const scanned = [];
  const mathPages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress(`Reading page ${n} of ${pdf.numPages}…`);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const raw = itemsToText(content.items).trim();
    // Equations (Word/Cambria Math) use maths letters like "𝑇(𝑛)", and their
    // fractions and powers come out as junk ("* ! \" +"). Remember the page
    // so the AI can read those formulas from its image instead.
    if (MATH_CHARS.test(raw)) mathPages.push(n);
    // NFKC turns "𝑇(𝑛)" into plain "T(n)" and ligatures like "ﬁ" into "fi".
    const text = raw.normalize('NFKC');
    pages.push(text);
    if (text.replace(/\s/g, '').length < 20) scanned.push(n);
  }

  if (ocr && scanned.length) {
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker('eng');
    try {
      for (const n of scanned) {
        onProgress(
          `Page ${n} looks scanned, running OCR (this can take a while)…`
        );
        const img = await renderPageToDataUrl(pdf, n, 2);
        const { data } = await worker.recognize(img);
        pages[n - 1] = (data.text || '').trim();
      }
    } finally {
      await worker.terminate();
    }
  }
  return {
    text: pages.join('\n\n'),
    pages,
    numPages: pdf.numPages,
    scannedPages: scanned,
    mathPages
  };
}

// Mathematical Alphanumeric Symbols block (𝑇, 𝑛, 𝐴, ...).
const MATH_CHARS = /[\u{1D400}-\u{1D7FF}]/u;

/** Pages of a PDF as JPEG data URLs, e.g. to show formulas to the AI. */
export async function pdfPageImages(file, pageNumbers, scale = 1.6) {
  const pdf = await openPdf(file);
  const out = [];
  for (const n of pageNumbers) {
    if (n >= 1 && n <= pdf.numPages)
      out.push(await renderPageToDataUrl(pdf, n, scale, 'image/jpeg'));
  }
  return out;
}

async function renderPageToDataUrl(pdf, n, scale = 2, type = 'image/png') {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toDataURL(type, 0.85);
}

/** First page of a PDF as a PNG data URL (for front pages). */
export async function pdfFirstPageImage(file, scale = 2.5) {
  const pdf = await openPdf(file);
  return renderPageToDataUrl(pdf, 1, scale);
}

/**
 * OCR an image and return text lines with pixel boxes and word boxes:
 * [{ text, bbox: {x0,y0,x1,y1}, words: [{ text, bbox }] }]
 */
export async function ocrLines(imageDataUrl, onProgress = () => {}) {
  const Tesseract = await loadTesseract();
  onProgress('Loading OCR engine…');
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(`Reading the page… ${Math.round((m.progress || 0) * 100)}%`);
      }
    }
  });
  try {
    const { data } = await worker.recognize(
      imageDataUrl,
      {},
      { blocks: true, text: true }
    );
    const lines = [];
    if (Array.isArray(data.lines) && data.lines.length) {
      lines.push(...data.lines);
    } else {
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) lines.push(line);
        }
      }
    }
    return lines
      .map((l) => ({
        text: (l.text || '').replace(/\s+/g, ' ').trim(),
        bbox: l.bbox,
        words: (l.words || []).map((w) => ({ text: w.text, bbox: w.bbox }))
      }))
      .filter((l) => l.text);
  } finally {
    await worker.terminate();
  }
}

export function fileToBase64(file) {
  return readFileAs(file).then((url) => String(url).split(',')[1] || '');
}
