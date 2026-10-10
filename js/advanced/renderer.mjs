/**
 * Turns a Markdown-lite document into handwritten A4 pages.
 *
 * 1. parseDocument()  -> blocks (title, heading, subheading, paragraph, list item, page break)
 * 2. paginate()       -> page DOM nodes; text is split between pages at word
 *                        boundaries, headings are never left alone at a page bottom
 * 3. capturePages()   -> JPEG data URLs via html2canvas (+ shadow / scanner effects)
 *
 * Every line sits on a ruled line: all blocks use the same line height.
 */

export const PAGE_W = 620;
export const PAGE_H = Math.round((PAGE_W * 297) / 210); // A4 ratio

export const DEFAULT_STYLE = {
  font: "'QE Dave Mergens', cursive",
  fontSize: 20,
  lineHeight: 28,
  inkBody: '#000f55',
  inkHeading: '#000000',
  headingUnderline: true,
  titleCentered: true,
  headingBold: true,
  headingScale: 1.12,
  paragraphGap: 0,
  lines: true,
  margin: true,
  effect: 'shadows',
  resolution: 2,
  humanize: 1,
  textOffset: 0,
  pageHeader: true,
  pageNumbers: true,
  pageFooter: false,
  headerText: ''
};

/* -------------------------------- Parsing -------------------------------- */

/**
 * Removes Markdown that has no handwritten equivalent so no stray symbols
 * reach the page: *italic* / _italic_ become plain text, `code` loses its
 * backticks, ***x*** and __x__ become **x** (underlined emphasis).
 * Real asterisks like "2 * 3" or "(3*4= 12 Marks)" are kept.
 */
export function cleanInline(text) {
  const kept = [];
  const keep = (inner) => `\u0000${kept.push(inner) - 1}\u0000`;
  let t = String(text)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*{3}(\S(?:[^*]*?\S)?)\*{3}/g, (_, x) => keep(x))
    .replace(/\*\*(\S(?:[^*]*?\S)?)\*\*/g, (_, x) => keep(x))
    .replace(
      /(^|[^\w])__(\S(?:[^_]*?\S)?)__(?![\w])/g,
      (_, a, x) => a + keep(x)
    );
  // *italic* and _italic_ -> plain text (no handwritten italics).
  t = t
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[\s(])_(?=\S)([^_\n]+?)(?<=\S)_(?=[\s.,;:!?)]|$)/g, '$1$2');
  // Leftover markers: stray "**", or "*" stuck to a word ("*word", "word*").
  // A "*" between spaces or digits is maths ("2 * 3", "3*4") and stays.
  t = t
    .replace(/\*{2,}/g, '')
    .replace(/(^|\s)\*(?=[A-Za-z])/g, '$1')
    .replace(/(?<=[A-Za-z.,:;!?)])\*(?=\s|$)/g, '')
    .replace(/^\s*\*\s+/, '');
  return t.replace(/\u0000(\d+)\u0000/g, (_, n) => `**${kept[n]}**`);
}

function tokenize(text) {
  // **emphasis** -> em tokens; everything split into words.
  const tokens = [];
  const parts = cleanInline(text).split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    const em = /^\*\*[^*]+\*\*$/.test(part);
    const clean = em ? part.slice(2, -2) : part;
    for (const word of clean.split(/\s+/))
      if (word) tokens.push({ t: word, em });
  }
  return tokens;
}

export function parseDocument(md) {
  const blocks = [];
  const lines = String(md || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  let para = [];
  let gapBefore = false;

  const flushPara = () => {
    if (!para.length) return;
    const tokens = tokenize(para.join(' '));
    const isLabel = tokens.length <= 3 && tokens.every((t) => t.em);
    blocks.push({ type: 'p', tokens, keepNext: isLabel, gap: gapBefore });
    para = [];
    gapBefore = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (!line) {
      flushPara();
      gapBefore = true;
      continue;
    }
    // "[diagram: caption]" or "[diagram: caption | 12]": blank ruled space
    // (default 10 lines) to draw the figure by hand, with the caption below.
    if ((m = /^\[(?:diagram|figure|fig)\s*:?\s*([^|\]]*?)\s*(?:\|\s*(\d{1,2})\s*)?\]$/i.exec(line))) {
      flushPara();
      blocks.push({
        type: 'diagram',
        lines: Math.min(25, Math.max(4, Number(m[2]) || 10)),
        tokens: tokenize(`Fig: ${m[1] || 'Diagram'}`),
        gap: true
      });
      gapBefore = false;
      continue;
    }
    // "[image: id]": a figure (see images.mjs), drawn on the page as is.
    if ((m = /^\[image:\s*([a-z0-9]+)\s*(?:\|\s*([^\]]*?)\s*)?\]$/i.exec(line))) {
      flushPara();
      blocks.push({
        type: 'image',
        id: m[1],
        tokens: m[2] ? tokenize(m[2]) : [],
        gap: true
      });
      gapBefore = false;
      continue;
    }
    if (/^(-{3,}|\[pagebreak\])$/i.test(line)) {
      flushPara();
      blocks.push({ type: 'break' });
      gapBefore = false;
      continue;
    }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushPara();
      const type = ['', 'h1', 'h2', 'h3'][m[1].length];
      const prev = blocks[blocks.length - 1];
      // "## Q1. ..." directly followed by "## (a) ...": sub-parts of the
      // same question, each on its own line, indented, no gap between.
      // A sub-question after the previous part's answer ("(b) ...") is
      // indented the same way, with the usual gap before it.
      const joined = type === 'h2' && !gapBefore && prev && prev.type === 'h2';
      const subpart =
        joined ||
        (type === 'h2' && /^\(?(?:[a-h]|[ivx]{1,4})[).]\s/i.test(m[2]));
      blocks.push({
        type,
        tokens: tokenize(m[2]),
        keepNext: true,
        subpart,
        gap: joined ? false : gapBefore || type !== 'h3'
      });
      gapBefore = false;
      continue;
    }
    if ((m = /^[-*•]\s+(.*)$/.exec(line))) {
      flushPara();
      blocks.push({
        type: 'li',
        marker: '•',
        tokens: tokenize(m[1]),
        gap: false
      });
      gapBefore = false;
      continue;
    }
    if ((m = /^(\d{1,3}|[a-z]|[ivx]{1,4})[.)]\s+(.*)$/i.exec(line))) {
      flushPara();
      blocks.push({
        type: 'li',
        marker: `${m[1]}.`,
        tokens: tokenize(m[2]),
        gap: false
      });
      gapBefore = false;
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks.filter(
    (b) =>
      b.type === 'break' || b.type === 'image' || (b.tokens && b.tokens.length)
  );
}

/* ------------------------------- Rendering ------------------------------- */

/** Stable pseudo-random value in [0,1) for a given key (same every render). */
function hashRandom(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return rng(h)();
}

function rng(seed) {
  // mulberry32: small deterministic PRNG so previews and downloads match.
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pageGeometry(style) {
  const L = style.lineHeight;
  const top = L * 3;
  const left = style.margin ? 78 : 28;
  const right = 22;
  const bottomArea = L;
  const lines = Math.floor((PAGE_H - top - bottomArea) / L);
  return { L, top, left, right, contentH: lines * L, lines };
}

function createPage(style, index) {
  const g = pageGeometry(style);
  const page = document.createElement('div');
  page.className = 'hw-page';
  page.style.cssText = `
    width:${PAGE_W}px;height:${PAGE_H}px;position:relative;overflow:hidden;
    background-color:#fff;
    font-family:${style.font};font-size:${style.fontSize}px;line-height:${g.L}px;
    color:${style.inkBody};
  `;
  // Ruled lines as real elements: html2canvas does not paint repeating
  // gradients reliably, but it always paints borders.
  if (style.lines) {
    for (let i = 1; i <= g.lines + 1; i++) {
      const rule = document.createElement('div');
      rule.style.cssText = `position:absolute;left:0;right:0;top:${
        g.top + i * g.L - 1
      }px;border-top:1px solid #a9bcd6;`;
      page.append(rule);
    }
  }
  if (style.margin) {
    const v = document.createElement('div');
    v.style.cssText = `position:absolute;top:0;bottom:0;left:${
      g.left - 10
    }px;border-left:2px solid #f3a0b5;`;
    const h = document.createElement('div');
    h.style.cssText = `position:absolute;left:0;right:0;top:${
      g.top - 2
    }px;border-top:2px solid #f3a0b5;`;
    page.append(v, h);
  }

  const content = document.createElement('div');
  content.className = 'hw-content';
  content.style.cssText = `
    position:absolute;left:${g.left}px;right:${g.right}px;top:${
    g.top + style.textOffset
  }px;
    height:${g.contentH + Math.round(g.L / 2)}px;overflow:hidden;
  `;
  page.append(content);
  return { el: page, content, index, g, random: rng(9973 * (index + 1)) };
}

function fits(page) {
  // The box has half a line of slack for descenders and jitter; text itself
  // must end on the last ruled line.
  const last = page.content.lastElementChild;
  if (!last) return true;
  return last.offsetTop + last.offsetHeight <= page.g.contentH + 2;
}

// "n^2", "2^(n+1)", "x^{10}": the power, written raised and smaller.
const POWER_RE = /\^(\{[^}]*\}|\([^)]*\)|[A-Za-z0-9.+\-]+)/g;

/** Writes a word, drawing "^power" as a superscript (fonts often lack "^"). */
function writeToken(span, text) {
  if (!text.includes('^') || text === '^') {
    span.textContent = text;
    return;
  }
  let last = 0;
  for (const m of text.matchAll(POWER_RE)) {
    if (m.index > last) span.append(text.slice(last, m.index));
    const sup = document.createElement('span');
    sup.textContent = m[1].replace(/^\{(.*)\}$/, '$1');
    // Raised with position (not vertical-align) so the line height and the
    // ruled lines stay put.
    sup.style.cssText =
      'font-size:0.68em;position:relative;top:-0.55em;margin-left:0.05em;';
    span.append(sup);
    last = m.index + m[0].length;
  }
  if (last < text.length) span.append(text.slice(last));
}

function renderBlock(block, page, style, { atTop, continued }) {
  const L = style.lineHeight;
  const node = document.createElement('div');
  const isHeading =
    block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
  node.style.margin = '0';
  node.style.position = 'relative';
  const gapLines =
    atTop || continued
      ? 0
      : block.gap
      ? isHeading
        ? 1
        : Math.max(style.paragraphGap, 0)
      : 0;
  if (gapLines) node.style.marginTop = `${gapLines * L}px`;

  if (isHeading) {
    node.style.color = style.inkHeading;
    const scale =
      block.type === 'h3'
        ? 1
        : style.headingScale * (block.type === 'h1' ? 1.15 : 1);
    node.style.fontSize = `${style.fontSize * scale}px`;
    if (style.headingBold)
      node.style.textShadow = '0 0 0.7px currentColor, 0.4px 0 0 currentColor';
    if (block.type === 'h1' && style.titleCentered)
      node.style.textAlign = 'center';
  }
  if (block.subpart) node.style.paddingLeft = '1.4em';
  if (block.type === 'li') {
    node.style.paddingLeft = '1.7em';
    if (!continued) {
      const marker = document.createElement('span');
      marker.textContent = block.marker;
      marker.style.cssText = 'position:absolute;left:0.2em;top:0;';
      node.append(marker);
    }
  }

  if (block.type === 'image' && block.img) {
    // Fit the content width and at most half a page, then round the height
    // up to whole ruled lines so the text below stays on the lines.
    const { w, h: ih, src } = block.img;
    const maxW = PAGE_W - page.g.left - page.g.right - 16;
    const s = Math.min(1, maxW / w, (page.g.contentH * 0.5) / ih);
    const lines = Math.max(2, Math.ceil((ih * s + 6) / L));
    const box = document.createElement('div');
    box.style.cssText = `height:${
      lines * L
    }px;display:flex;align-items:center;justify-content:center;`;
    const im = document.createElement('img');
    im.src = src;
    im.alt = '';
    // A slight, stable tilt per image, like the handwriting around it.
    const tilt = ((hashRandom(block.id) - 0.5) * 1.2).toFixed(2);
    im.style.cssText = `width:${w * s}px;height:${ih * s}px;display:block;transform:rotate(${tilt}deg);`;
    box.append(im);
    node.append(box);
    node.style.textAlign = 'center'; // caption, if any, under the image
  }
  if (block.type === 'diagram') {
    const space = document.createElement('div');
    space.style.height = `${block.lines * L}px`;
    node.append(space);
    node.style.textAlign = 'center';
  }

  const underlineAll =
    isHeading && style.headingUnderline && block.type !== 'h3';
  const h = Math.max(0, Math.min(3, Number(style.humanize) || 0));
  const offset = block.offset || 0;
  block.tokens.forEach((tok, i) => {
    const span = document.createElement('span');
    writeToken(span, tok.t);
    if (tok.em || underlineAll) {
      // A bottom border renders consistently in html2canvas (text-decoration
      // is drawn at the wrong height for many handwriting fonts).
      // The -1px margin keeps inline-block words exactly one line tall.
      span.style.borderBottom = '1px solid currentColor';
      span.style.marginBottom = '-1px';
    }
    if (tok.em && !isHeading) span.style.color = style.inkHeading;
    if (h > 0) {
      // Seeded per word so re-rendering during pagination gives identical layout.
      let n = 0;
      const r = () => hashRandom(block.id, offset + i, n++);
      span.style.display = 'inline-block';
      span.style.transform = `translateY(${((r() - 0.5) * 1.6 * h).toFixed(
        2
      )}px) rotate(${((r() - 0.5) * 1.4 * h).toFixed(2)}deg)`;
      span.style.opacity = (1 - r() * 0.12 * h).toFixed(2);
    }
    node.append(span);
    if (i < block.tokens.length - 1) node.append(document.createTextNode(' '));
  });
  node._block = { ...block, continued };
  return node;
}

function decoratePage(page, style, total, headerText, footerText) {
  const g = page.g;
  if (style.pageHeader && headerText) {
    const head = document.createElement('div');
    head.textContent = headerText;
    head.style.cssText = `position:absolute;left:${g.left}px;right:${
      g.right
    }px;top:${g.L * 1.15}px;
      font-size:${style.fontSize * 0.85}px;line-height:${g.L}px;color:${
      style.inkBody
    };text-align:right;white-space:nowrap;overflow:hidden;`;
    page.el.append(head);
  }
  // Name & enrolment no. at the bottom of every page (IGNOU asks for this).
  if (style.pageFooter && footerText) {
    const foot = document.createElement('div');
    foot.textContent = footerText;
    foot.style.cssText = `position:absolute;left:${g.left}px;right:${
      g.right + (style.pageNumbers ? g.L * 2 : 0)
    }px;bottom:${Math.round(g.L * 0.15)}px;
      font-size:${style.fontSize * 0.85}px;line-height:${g.L}px;color:${
      style.inkBody
    };white-space:nowrap;overflow:hidden;`;
    page.el.append(foot);
  }
  if (style.pageNumbers) {
    const num = document.createElement('div');
    num.textContent = `${page.index + 1}${total > 1 ? '' : ''}`;
    num.style.cssText = `position:absolute;right:${
      g.right + 4
    }px;bottom:${Math.round(g.L * 0.15)}px;
      font-size:${style.fontSize * 0.85}px;line-height:${g.L}px;color:${
      style.inkBody
    };`;
    page.el.append(num);
  }
  if (style.effect === 'shadows' || style.effect === 'scanner') {
    const overlay = document.createElement('div');
    const angle =
      style.effect === 'scanner'
        ? 50 + Math.floor(page.random() * 71)
        : Math.floor(page.random() * 360);
    overlay.style.cssText = `position:absolute;inset:0;pointer-events:none;
      background:linear-gradient(${angle}deg, #0005, #0000);`;
    page.el.append(overlay);
  }
}

/**
 * Lays the blocks out across pages inside `stage` (must be in the document so
 * text can be measured). Returns the page elements.
 */
export function paginate(
  blocks,
  style,
  stage,
  { headerText = '', footerText = '', maxPages = 200 } = {}
) {
  stage.textContent = '';
  const pages = [];
  let page = createPage(style, 0);
  stage.append(page.el);
  const queue = blocks.map((b, i) => ({ id: i, ...b }));

  const newPage = () => {
    // Keep headings / "Ans." labels with the text that follows them.
    const kids = Array.from(page.content.children);
    const moved = [];
    while (kids.length > 1 && kids[kids.length - 1]._block.keepNext) {
      const node = kids.pop();
      moved.unshift(node._block);
      node.remove();
    }
    queue.unshift(...moved);
    pages.push(page);
    if (pages.length >= maxPages)
      throw new Error(`Document is longer than ${maxPages} pages.`);
    page = createPage(style, pages.length);
    stage.append(page.el);
  };

  let guard = 0;
  while (queue.length) {
    if (++guard > 100000) throw new Error('Pagination did not converge.');
    const block = queue.shift();
    if (block.type === 'break') {
      if (page.content.children.length) newPage();
      continue;
    }
    const atTop = page.content.children.length === 0;
    const opts = { atTop, continued: !!block.continued };
    let node = renderBlock(block, page, style, opts);
    page.content.append(node);
    if (fits(page)) continue;
    // Long question headings (e.g. IGNOU "Q1. a) ... g)" spanning 20 lines) can't
    // be kept whole: moving them would leave near-empty pages behind.
    const tallHeading = node.offsetHeight > style.lineHeight * 3;
    node.remove();

    // Find how many words fit on this page (binary search).
    const canSplit =
      block.type !== 'diagram' &&
      block.type !== 'image' &&
      block.tokens.length > 1 &&
      (!block.keepNext || atTop || block.type === 'p' || tallHeading);
    let best = 0;
    if (canSplit) {
      let lo = 1;
      let hi = block.tokens.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        node = renderBlock(
          { ...block, tokens: block.tokens.slice(0, mid) },
          page,
          style,
          opts
        );
        page.content.append(node);
        const ok = fits(page);
        node.remove();
        if (ok) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }

    if (best > 0) {
      const head = renderBlock(
        { ...block, tokens: block.tokens.slice(0, best) },
        page,
        style,
        opts
      );
      head._block.keepNext = false;
      page.content.append(head);
      queue.unshift({
        ...block,
        tokens: block.tokens.slice(best),
        offset: (block.offset || 0) + best,
        continued: true,
        gap: false
      });
      newPage();
    } else if (atTop) {
      // A single word taller than the page: place it anyway to guarantee progress.
      page.content.append(renderBlock(block, page, style, opts));
      newPage();
    } else {
      queue.unshift(block);
      newPage();
    }
  }
  if (page.content.children.length || !pages.length) pages.push(page);
  else page.el.remove();

  pages.forEach((p) =>
    decoratePage(p, style, pages.length, headerText, footerText)
  );
  return pages.map((p) => p.el);
}

/* -------------------------------- Capture -------------------------------- */

function contrast(canvas, amount = 0.55) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const c = amount * 255;
  const f = (c + 255) / (255.01 - c);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = f * (d[i] - 128) + 128;
    d[i + 1] = f * (d[i + 1] - 128) + 128;
    d[i + 2] = f * (d[i + 2] - 128) + 128;
  }
  ctx.putImageData(img, 0, 0);
}

export async function capturePages(pageEls, style, onProgress = () => {}) {
  if (typeof window.html2canvas !== 'function')
    throw new Error('html2canvas is not loaded');
  const out = [];
  for (let i = 0; i < pageEls.length; i++) {
    onProgress(`Rendering page ${i + 1} of ${pageEls.length}…`);
    const canvas = await window.html2canvas(pageEls[i], {
      scale: Number(style.resolution) || 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      // html2canvas measures the element relative to the visible window, so it
      // must be told the current scroll position. Without this, pages captured
      // while the user is scrolled down (Download is at the bottom) are blank.
      scrollX: -window.scrollX,
      scrollY: -window.scrollY
    });
    if (style.effect === 'scanner') contrast(canvas);
    out.push(canvas.toDataURL('image/jpeg', 0.9));
    canvas.width = canvas.height = 0; // free memory early
  }
  return out;
}

/** Make sure the handwriting font is loaded before measuring text. */
export async function ensureFont(fontFamily, sample = 'Handwriting') {
  try {
    await document.fonts.load(`16px ${fontFamily}`, sample);
    await document.fonts.ready;
  } catch (e) {
    /* fall back to whatever is available */
  }
}
