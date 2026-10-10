/**
 * Assembles the final PDF: optional front page first, then handwritten pages.
 */
import { ensureJsPDF } from './loaders.mjs';
import { saveUnderLimit } from '../utils/pdf-size.mjs';

function imageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not read a page image.'));
    img.src = dataUrl;
  });
}

export async function buildPdf({
  frontPage,
  pages,
  filename = 'assignment.pdf'
}) {
  const JsPDF = await ensureJsPDF();
  const all = [...(frontPage ? [frontPage] : []), ...pages];
  // Shrinking keeps each page's aspect ratio, so measure the originals once.
  const sizes = [];
  for (const src of all) sizes.push(await imageSize(src));
  return saveUnderLimit(
    all,
    (images) => {
      // eslint-disable-next-line new-cap
      const doc = new JsPDF('p', 'pt', 'a4');
      const ps = doc.internal.pageSize;
      const W = ps.getWidth ? ps.getWidth() : ps.width;
      const H = ps.getHeight ? ps.getHeight() : ps.height;
      images.forEach((img, i) => {
        if (i > 0) doc.addPage();
        const { w, h } = sizes[i];
        // Fit inside A4 keeping aspect ratio, centered.
        const scale = Math.min(W / w, H / h);
        const dw = w * scale;
        const dh = h * scale;
        doc.addImage(
          img,
          'JPEG',
          (W - dw) / 2,
          (H - dh) / 2,
          dw,
          dh,
          `page-${i}`,
          'FAST'
        );
      });
      return doc;
    },
    filename
  );
}
