/**
 * Lazy loaders for heavy third-party libraries. Advanced mode only downloads
 * them when a feature actually needs them, so Classic mode stays as light as
 * before.
 */

const PDFJS_VERSION = '6.4.299';
const TESSERACT_VERSION = '7.0.0';
const ANTHROPIC_SDK_VERSION = '0.133.0';

const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
const TESSERACT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const ANTHROPIC_SDK_URL = `https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@${ANTHROPIC_SDK_VERSION}/+esm`;

const cache = {};

function once(key, factory) {
  if (!cache[key]) {
    cache[key] = factory().catch((err) => {
      delete cache[key]; // allow a retry after a network hiccup
      throw err;
    });
  }
  return cache[key];
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(s);
  });
}

export function loadPdfJs() {
  return once('pdfjs', async () => {
    const pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    return pdfjs;
  });
}

export function loadTesseract() {
  return once('tesseract', async () => {
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    if (!window.Tesseract) throw new Error('Tesseract failed to initialise');
    return window.Tesseract;
  });
}

export function loadAnthropic() {
  return once('anthropic', async () => {
    const mod = await import(ANTHROPIC_SDK_URL);
    return mod.default || mod.Anthropic;
  });
}

export async function ensureJsPDF() {
  if (window.jsPDF) return window.jsPDF;
  await loadScript('https://unpkg.com/jspdf@1.5.3/dist/jspdf.min.js');
  return window.jsPDF;
}
