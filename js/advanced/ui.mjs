/**
 * Small DOM helpers shared by Advanced mode modules.
 * All user/AI-provided text is inserted with textContent, never innerHTML.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) =>
  Array.from(root.querySelectorAll(sel));

/**
 * el('div.card', {onclick}, [children]) - tiny element factory.
 */
export function el(spec, props = {}, children = []) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'text') {
      node.textContent = v;
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k in node && typeof v !== 'string') {
      node[k] = v;
    } else {
      node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

let toastTimer;
export function toast(message, kind = 'info', ms = 4000) {
  let box = $('#adv-toast');
  if (!box) {
    box = el('div', { id: 'adv-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.textContent = message;
  box.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.className = ''), ms);
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.dataset.label || button.textContent;
    button.textContent = label || 'Working…';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    delete button.dataset.label;
    button.disabled = false;
  }
}

export function readFileAs(file, how = 'dataURL') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (how === 'arrayBuffer') reader.readAsArrayBuffer(file);
    else if (how === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

export function downloadDataUrl(dataUrl, filename) {
  const a = el('a', { href: dataUrl, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

export function downloadText(text, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = el('textarea', { style: { position: 'fixed', top: '-1000px' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
