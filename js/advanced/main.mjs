/**
 * Advanced mode controller: tabs, the 4-step "Create" flow, profile,
 * AI settings and templates. Loaded on demand by js/mode-switch.mjs.
 */
import {
  $,
  $$,
  el,
  toast,
  setBusy,
  readFileAs,
  downloadDataUrl,
  downloadText,
  copyText,
  debounce,
  uid,
  sleep
} from './ui.mjs';
import {
  load,
  save,
  putBlob,
  getBlob,
  listKeys,
  clearAllData
} from './store.mjs';
import {
  renderProfileForm,
  getProfile,
  academicContext,
  profileTemplate,
  importProfile,
  isProfileFile,
  setActiveCourse,
  getAssignmentValues,
  clearAssignmentValues,
  fieldValue,
  PROFILE_FIELDS
} from './profile.mjs';
import {
  detectMeta,
  mergeMeta,
  changedMeta,
  reviewMeta
} from './assignment-meta.mjs';
import {
  PROVIDERS,
  getAISettings,
  saveAISettings,
  activeProvider,
  isConfigured,
  complete,
  listModels,
  testConnection
} from './llm.mjs';
import {
  BUILTIN_TEMPLATES,
  allTemplates,
  getTemplate,
  customTemplates,
  saveCustomTemplates,
  duplicateTemplate,
  answerSystemPrompt,
  answerUserPrompt,
  bulkCopyPrompt,
  singleCopyPrompt,
  splitSubQuestions,
  answerDiagrams,
  diagramPrompt,
  replaceDiagramLine,
  parseBulkAnswers,
  composeDocument,
  targetWords
} from './templates.mjs';
import { extractBasic, extractWithAI, garbledMath } from './questions.mjs';
import {
  addImage,
  copyImagesToClipboard,
  copyTextWithImages,
  deleteImage,
  downloadImages,
  getImage,
  imageFromClipboard,
  imageIdsIn,
  imageMarker,
  imageRefsIn,
  blendedImage,
  readClipboardImage,
  resolveImageBlocks
} from './images.mjs';
import { extractPdfText, fileToBase64, pdfPageImages } from './pdf-input.mjs';
import {
  DEFAULT_STYLE,
  parseDocument,
  paginate,
  capturePages,
  ensureFont,
  PAGE_W,
  PAGE_H
} from './renderer.mjs';
import { FrontPageEditor } from './frontpage.mjs';
import { buildPdf } from './output.mjs';

const BUILTIN_FONTS = [
  ["'QE Dave Mergens', cursive", 'Dave Mergens'],
  ["'Homemade Apple', cursive", 'Homemade Apple'],
  ["'Caveat', cursive", 'Caveat'],
  ["'Kalam', cursive", 'Kalam'],
  ["'Indie Flower', cursive", 'Indie Flower'],
  ["'Shadows Into Light', cursive", 'Shadows Into Light'],
  ["'Gloria Hallelujah', cursive", 'Gloria Hallelujah'],
  ["'Reenie Beanie', cursive", 'Reenie Beanie'],
  ["'Nanum Pen Script', cursive", 'Nanum Pen Script'],
  ["'Dawning of a New Day', cursive", 'Dawning of a New Day'],
  ["'Cedarville Cursive', cursive", 'Cedarville Cursive'],
  ["'Liu Jian Mao Cao', cursive", 'Liu Jian Mao Cao'],
  ['Hindi_Font', 'Kruti Dev (Hindi)']
];

// Sensible starting sizes per font (they differ a lot in visual size).
const FONT_SIZE_HINT = {
  'Dave Mergens': 20,
  'Homemade Apple': 14,
  Caveat: 20,
  Kalam: 16,
  'Indie Flower': 17,
  'Shadows Into Light': 18,
  'Gloria Hallelujah': 15,
  'Reenie Beanie': 22,
  'Nanum Pen Script': 22,
  'Dawning of a New Day': 20,
  'Cedarville Cursive': 16,
  'Liu Jian Mao Cao': 20
};

let style;
let draft;
let frontPage;
let renderedPages = [];
let pageEls = [];
let genController = null;
let pdfSource = { file: null, base64: null };
let initialized = false;

const saveDraft = debounce(() => save('draft', draft), 300);
const saveStyle = () => save('style', style);

export async function init() {
  if (initialized) return;
  initialized = true;

  style = { ...DEFAULT_STYLE, pageBreakBetween: false, ...load('style', {}) };
  // One-time switch to the new default font for settings saved before it existed.
  if (!style.defaultFontV2) {
    if (style.font === "'Homemade Apple', cursive") {
      style.font = DEFAULT_STYLE.font;
      style.fontSize = DEFAULT_STYLE.fontSize;
    }
    style.defaultFontV2 = true;
    saveStyle();
  }
  draft = {
    source: 'pdf',
    templateId: BUILTIN_TEMPLATES[0].id,
    pasteText: '',
    ownText: '',
    pdfText: '',
    pdfName: '',
    docInfo: { title: '', subject: '', instructions: '' },
    questions: [],
    answers: {},
    docText: '',
    ...load('draft', {})
  };

  initTabs();
  await registerCustomFonts();
  initStyle();
  initProfile();
  initAISettings();
  initTemplatesTab();
  initFrontPage();
  initContent();
  initBuild();
  refreshAIAvailability();
}

/* --------------------------------- Tabs ---------------------------------- */

function initTabs() {
  $$('.adv-tabs [data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('.adv-tabs [data-tab]').forEach((b) =>
        b.setAttribute('aria-selected', String(b === btn))
      );
      $$('.adv-panel').forEach(
        (p) => (p.hidden = p.dataset.panel !== btn.dataset.tab)
      );
      if (btn.dataset.tab === 'create') {
        frontPage && frontPage.redraw();
        refreshAIAvailability();
      }
    })
  );
}

function goToTab(name) {
  const btn = $(`.adv-tabs [data-tab="${name}"]`);
  btn && btn.click();
}

/* ------------------------------ Fonts / Style ---------------------------- */

async function registerCustomFonts() {
  for (const f of load('fonts', [])) {
    try {
      const buf = await getBlob(`font:${f.id}`);
      if (!buf) continue;
      const face = new FontFace(f.family, buf);
      document.fonts.add(await face.load());
    } catch (e) {
      console.warn('Could not load saved font', f.name, e);
    }
  }
}

function fillFontSelect() {
  const select = $('#st-font');
  select.textContent = '';
  for (const [value, label] of BUILTIN_FONTS) {
    select.append(
      el('option', { value, text: label, style: { fontFamily: value } })
    );
  }
  const custom = load('fonts', []);
  if (custom.length) {
    const group = el('optgroup', { label: 'Your fonts' });
    for (const f of custom)
      group.append(el('option', { value: `'${f.family}'`, text: f.name }));
    select.append(group);
  }
  select.value = style.font;
  if (select.value !== style.font) select.value = BUILTIN_FONTS[0][0];
}

function initStyle() {
  fillFontSelect();

  const bind = (key, parse = (v) => v) => {
    const input = $(`#st-${key}`);
    if (!input) return;
    if (input.type === 'checkbox') input.checked = !!style[key];
    else input.value = String(style[key]);
    input.addEventListener('change', () => {
      style[key] =
        input.type === 'checkbox' ? input.checked : parse(input.value);
      saveStyle();
      onStyleChange();
    });
  };
  const num = (v) => Number(v);
  bind('fontSize', num);
  bind('inkBody');
  bind('inkHeading');
  bind('humanize', num);
  bind('headingUnderline');
  bind('headingBold');
  bind('titleCentered');
  bind('headingScale', num);
  bind('lines');
  bind('margin');
  bind('pageHeader');
  bind('pageNumbers');
  bind('pageFooter');
  bind('pageBreakBetween');
  bind('paragraphGap', num);
  bind('effect');
  bind('resolution', num);
  bind('textOffset', num);

  $('#st-font').addEventListener('change', (e) => {
    style.font = e.target.value;
    const label =
      e.target.selectedOptions[0] && e.target.selectedOptions[0].textContent;
    if (FONT_SIZE_HINT[label]) {
      style.fontSize = FONT_SIZE_HINT[label];
      $('#st-fontSize').value = style.fontSize;
    }
    saveStyle();
    onStyleChange();
  });

  $('#st-font-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await readFileAs(file, 'arrayBuffer');
      const id = uid();
      const family = `tth-font-${id}`;
      const face = new FontFace(family, buf);
      document.fonts.add(await face.load());
      await putBlob(`font:${id}`, buf);
      const fonts = load('fonts', []);
      fonts.push({
        id,
        family,
        name: file.name.replace(/\.(ttf|otf|woff2?)$/i, '')
      });
      save('fonts', fonts);
      style.font = `'${family}'`;
      saveStyle();
      fillFontSelect();
      onStyleChange();
      toast('Font added and saved for next time.', 'success');
    } catch (err) {
      toast(`That font could not be loaded: ${err.message}`, 'error');
    }
  });

  const templateSelect = $('#adv-template');
  const fillTemplates = () => {
    templateSelect.textContent = '';
    const builtin = el('optgroup', { label: 'Built-in' });
    BUILTIN_TEMPLATES.forEach((t) =>
      builtin.append(el('option', { value: t.id, text: t.name }))
    );
    templateSelect.append(builtin);
    const custom = customTemplates();
    if (custom.length) {
      const g = el('optgroup', { label: 'Your templates' });
      custom.forEach((t) =>
        g.append(el('option', { value: t.id, text: t.name }))
      );
      templateSelect.append(g);
    }
    templateSelect.value = getTemplate(draft.templateId).id;
    $('#adv-template-desc').textContent =
      getTemplate(draft.templateId).description || '';
  };
  fillTemplates();
  templateSelect.addEventListener('change', () => {
    draft.templateId = templateSelect.value;
    $('#adv-template-desc').textContent =
      getTemplate(draft.templateId).description || '';
    saveDraft();
    renderQuestions();
  });
  initStyle.fillTemplates = fillTemplates;

  renderStylePreview();
}

const renderStylePreview = debounce(async () => {
  const box = $('#style-preview');
  if (!box || $('#advanced-app').hidden) return;
  const sample = parseDocument(
    `# Assignment\n## Q1. What is an operating system?\n**Ans.**\nAn operating system is system software that manages computer hardware and software resources and provides common services for programs.\n### Functions\n- Process management\n- Memory management\n- File handling`
  );
  await ensureFont(style.font);
  const stage = $('#hw-stage');
  const [page] = paginate(sample, style, stage, {
    headerText: headerText(),
    footerText: footerText(),
    maxPages: 1
  });
  box.textContent = '';
  page.style.transform = `scale(${box.clientWidth / PAGE_W || 0.5})`;
  page.style.transformOrigin = '0 0';
  box.style.height = `${PAGE_H * (box.clientWidth / PAGE_W || 0.5)}px`;
  box.append(page);
  stage.textContent = '';
}, 150);

function onStyleChange() {
  renderStylePreview();
  frontPage && frontPage.redraw();
  // Answer image previews follow the ink colour and "Ruled lines".
  $$('#questions-list .q-answer').forEach((t) =>
    t.dispatchEvent(new Event('input'))
  );
  if (pageEls.length) markStale();
}

function headerText() {
  const p = getProfile().values;
  return [p.name, p.rollNo && `Roll No. ${p.rollNo}`]
    .filter(Boolean)
    .join('  |  ');
}

function footerText() {
  const p = getProfile().values;
  const no = p.enrollmentNo || p.rollNo;
  return [p.name, no && `Enrolment No. ${no}`].filter(Boolean).join('  |  ');
}

/* -------------------------------- Profile -------------------------------- */

function initProfile() {
  const onProfileChange = () => {
    frontPage && frontPage.redraw();
    renderStylePreview();
    refreshCourseBar();
  };
  const renderForm = () =>
    renderProfileForm($('#profile-form'), onProfileChange);
  renderForm();

  // Fill-in-the-blanks template so people know exactly what to provide.
  $('#profile-template').addEventListener('click', () => {
    downloadText(
      JSON.stringify(profileTemplate(), null, 2),
      'my-profile-template.json'
    );
    $('#profile-import-status').textContent =
      'Template downloaded. Fill it in, save it, then click "3. Import profile".';
  });

  const applyProfileFile = (data) => {
    const { updated, custom, courses } = importProfile(data);
    renderForm();
    onProfileChange();
    const msg = `Profile imported: ${updated} field(s)${
      custom ? `, ${custom} custom field(s)` : ''
    }${courses ? `, ${courses} course(s)` : ''}.`;
    $('#profile-import-status').textContent = `✓ ${msg}`;
    toast(msg, 'success');
  };

  $('#profile-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const status = $('#profile-import-status');
    try {
      let data;
      try {
        data = JSON.parse(await readFileAs(file, 'text'));
      } catch (err) {
        throw new Error(
          `This file isn't valid JSON (${err.message}). Check for a missing quote or comma, or download a fresh template.`
        );
      }
      if (data && data.app === 'text-to-handwriting-ai' && data.data) {
        throw new Error(
          'This is a full backup. Use "Restore backup" below instead.'
        );
      }
      applyProfileFile(data);
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
      toast(`Import failed: ${err.message}`, 'error', 7000);
    }
  });

  $('#data-export').addEventListener('click', async () => {
    const data = {};
    for (const k of listKeys()) data[k] = load(k);
    // Never export API keys by accident.
    if (data['ai-settings'])
      data['ai-settings'] = { ...data['ai-settings'], keys: {} };
    downloadText(
      JSON.stringify(
        { app: 'text-to-handwriting-ai', version: 1, data },
        null,
        2
      ),
      'handwriting-data.json'
    );
  });

  $('#data-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await readFileAs(file, 'text'));
      // A profile template picked here by mistake: import it anyway.
      if (isProfileFile(parsed) && !parsed.data) {
        applyProfileFile(parsed);
        return;
      }
      if (
        !parsed ||
        parsed.app !== 'text-to-handwriting-ai' ||
        typeof parsed.data !== 'object'
      ) {
        throw new Error('This is not an export from this app.');
      }
      for (const [k, v] of Object.entries(parsed.data)) {
        if (k === 'ai-settings') v.keys = getAISettings().keys; // keep existing keys
        save(k, v);
      }
      toast('Data imported. Reloading…', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  });

  $('#data-clear').addEventListener('click', async () => {
    if (
      !window.confirm(
        'Delete your profile, API keys, templates, fonts, front pages and drafts from this browser?'
      )
    )
      return;
    await clearAllData();
    toast('All saved data deleted. Reloading…', 'success');
    setTimeout(() => location.reload(), 800);
  });
}

/* ------------------------------ AI settings ------------------------------ */

function initAISettings() {
  const settings = getAISettings();
  const providerSel = $('#ai-provider');
  providerSel.append(
    el('option', { value: 'none', text: 'No AI – copy/paste with any chatbot' })
  );
  for (const [id, p] of Object.entries(PROVIDERS))
    providerSel.append(el('option', { value: id, text: p.label }));
  providerSel.value = settings.provider;

  const keyInput = $('#ai-key');
  const modelInput = $('#ai-model');
  const baseInput = $('#ai-base');
  const visionInput = $('#ai-vision');

  const show = () => {
    const s = getAISettings();
    const id = s.provider;
    const def = PROVIDERS[id];
    $$('[data-ai]').forEach((n) => (n.hidden = !def));
    $('#ai-test').hidden = !def;
    if (!def) {
      $('#ai-status').textContent =
        'Answers can be produced with the copy-paste workflow in step 3.';
      return;
    }
    $('[data-ai="key"]').hidden = !!def.noKey;
    $('[data-ai="base"]').hidden = !(id === 'custom' || id === 'ollama');
    keyInput.value = s.keys[id] || '';
    modelInput.value = s.models[id] || def.defaultModel || '';
    baseInput.value = s.baseUrls[id] || def.baseUrl || '';
    visionInput.checked =
      s.vision[id] !== undefined ? s.vision[id] : !!def.vision;
    const link = $('#ai-key-link');
    link.hidden = !def.keyUrl;
    if (def.keyUrl) link.href = def.keyUrl;
    const list = $('#ai-model-list');
    list.textContent = '';
    (def.models || []).forEach((m) => list.append(el('option', { value: m })));
    $('#ai-status').textContent = isConfigured(activeProvider(s))
      ? 'Ready.'
      : 'Add your key to start.';
  };

  const update = (fn) => {
    const s = getAISettings();
    fn(s);
    saveAISettings(s);
    refreshAIAvailability();
  };

  providerSel.addEventListener('change', () => {
    update((s) => (s.provider = providerSel.value));
    show();
  });
  keyInput.addEventListener('input', () =>
    update((s) => (s.keys[s.provider] = keyInput.value.trim()))
  );
  modelInput.addEventListener('input', () =>
    update((s) => (s.models[s.provider] = modelInput.value.trim()))
  );
  baseInput.addEventListener('input', () =>
    update((s) => (s.baseUrls[s.provider] = baseInput.value.trim()))
  );
  visionInput.addEventListener('change', () =>
    update((s) => (s.vision[s.provider] = visionInput.checked))
  );
  $('#ai-key-show').addEventListener('click', (e) => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    e.target.textContent = keyInput.type === 'password' ? 'Show' : 'Hide';
  });

  $('#ai-fetch-models').addEventListener('click', async (e) => {
    const p = activeProvider();
    if (!p || (!p.noKey && !p.apiKey))
      return toast('Enter your API key first.', 'error');
    setBusy(e.target, true, 'Loading…');
    try {
      const ids = await listModels(p);
      const list = $('#ai-model-list');
      list.textContent = '';
      ids.forEach((m) => list.append(el('option', { value: m })));
      $(
        '#ai-status'
      ).textContent = `${ids.length} models available. Click the Model box to choose.`;
    } catch (err) {
      $('#ai-status').textContent = err.message;
    } finally {
      setBusy(e.target, false);
    }
  });

  $('#ai-test').addEventListener('click', async (e) => {
    setBusy(e.target, true, 'Testing…');
    $('#ai-status').textContent = '';
    try {
      const reply = await testConnection();
      $(
        '#ai-status'
      ).textContent = `✓ Connected. The model replied: "${reply}"`;
    } catch (err) {
      $('#ai-status').textContent = `✗ ${err.message}`;
    } finally {
      setBusy(e.target, false);
    }
  });

  show();
}

function refreshAIAvailability() {
  const ok = isConfigured();
  ['#find-ai', '#gen-all', '#gen-missing', '#fp-detect-ai'].forEach((sel) => {
    const b = $(sel);
    if (!b) return;
    b.title = ok ? '' : 'Set up a provider in "AI Settings" to use this';
    b.classList.toggle('needs-ai', !ok);
  });
  $$('.q-gen').forEach((b) => b.classList.toggle('needs-ai', !ok));
}

function requireAI() {
  if (isConfigured()) return activeProvider();
  toast(
    'Set up an AI provider first (AI Settings tab), or use the copy-paste workflow.',
    'error',
    6000
  );
  goToTab('ai');
  return null;
}

/* ------------------------------- Templates ------------------------------- */

function initTemplatesTab() {
  let selected = draft.templateId;
  const list = $('#tpl-list');
  const editor = $('#tpl-editor');

  const renderList = () => {
    list.textContent = '';
    for (const t of allTemplates()) {
      list.append(
        el(
          `button.adv-list-item${t.id === selected ? '.active' : ''}`,
          {
            type: 'button',
            onclick: () => ((selected = t.id), renderList(), renderEditor())
          },
          [
            el('b', { text: t.name }),
            el('small', { text: t.custom ? 'Your template' : 'Built-in' })
          ]
        )
      );
    }
  };

  const renderEditor = () => {
    const t = getTemplate(selected);
    editor.textContent = '';
    const readOnly = !t.custom;
    const field = (key, label, type = 'text', opts = {}) => {
      let input;
      if (type === 'textarea') {
        input = el('textarea', { rows: 5 });
        input.value = t[key] || '';
      } else if (type === 'checkbox') {
        input = el('input', { type: 'checkbox' });
        input.checked = !!t[key];
      } else if (type === 'select') {
        input = el('select');
        opts.options.forEach(([v, l]) =>
          input.append(el('option', { value: v, text: l }))
        );
        input.value = t[key];
      } else {
        input = el('input', { type });
        input.value = t[key] === undefined ? '' : t[key];
      }
      input.disabled = readOnly;
      input.addEventListener('change', () => {
        const all = customTemplates();
        const mine = all.find((x) => x.id === t.id);
        if (!mine) return;
        mine[key] =
          type === 'checkbox'
            ? input.checked
            : type === 'number'
            ? Number(input.value)
            : input.value;
        saveCustomTemplates(all);
        initStyle.fillTemplates();
        if (key === 'name') renderList();
      });
      return type === 'checkbox'
        ? el('label.adv-check', {}, [input, ` ${label}`])
        : el('div', {}, [el('label.block', { text: label }), input]);
    };

    editor.append(
      el('div.adv-grid', {}, [
        el('div.span-2', {}, [field('name', 'Name')]),
        el('div.span-2', {}, [field('description', 'Description')]),
        field('kind', 'Type', 'select', {
          options: [
            ['qa', 'Questions & answers'],
            ['essay', 'Essay / article']
          ]
        }),
        field(
          'questionFormat',
          'Question heading ({n} = number, {question} = text)'
        ),
        field('answerLabel', 'Answer label (e.g. "Ans.", empty for none)'),
        field('showMarks', 'Show marks in heading', 'checkbox'),
        field('titleBlock', 'Title at the top of the first page', 'checkbox'),
        field('wordsPerMark', 'Words per mark', 'number'),
        field('defaultWords', 'Words when marks unknown', 'number'),
        field('minWords', 'Minimum words', 'number'),
        field('maxWords', 'Maximum words', 'number'),
        el('div.span-2', {}, [
          field(
            'instructions',
            'How answers should be written (sent to the AI)',
            'textarea'
          )
        ])
      ]),
      el('div.adv-toolbar', {}, [
        el('button', {
          type: 'button',
          text: readOnly ? 'Duplicate to customise' : 'Duplicate',
          onclick: () => {
            const copy = duplicateTemplate(t.id);
            selected = copy.id;
            initStyle.fillTemplates();
            renderList();
            renderEditor();
          }
        }),
        el('button', {
          type: 'button',
          text: 'Use this template',
          className: 'generate-image-button',
          onclick: () => {
            draft.templateId = t.id;
            saveDraft();
            initStyle.fillTemplates();
            renderQuestions();
            toast(`Using "${t.name}".`, 'success');
          }
        }),
        !readOnly &&
          el('button.delete-button', {
            type: 'button',
            text: 'Delete',
            onclick: () => {
              if (!window.confirm(`Delete template "${t.name}"?`)) return;
              saveCustomTemplates(
                customTemplates().filter((x) => x.id !== t.id)
              );
              if (draft.templateId === t.id)
                draft.templateId = BUILTIN_TEMPLATES[0].id;
              selected = draft.templateId;
              saveDraft();
              initStyle.fillTemplates();
              renderList();
              renderEditor();
            }
          })
      ])
    );
  };

  renderList();
  renderEditor();
}

/* ------------------------------- Front page ------------------------------ */

function initFrontPage() {
  frontPage = new FrontPageEditor($('#fp-root'), {
    getStyle: () => style,
    getProvider: () => (isConfigured() ? activeProvider() : null),
    onChange: () => {
      $('#fp-enabled').checked = frontPage ? frontPage.state.enabled : false;
      if (pageEls.length) markStale();
    }
  });
  $('#fp-enabled').checked = !!frontPage.state.enabled;
  $('#fp-enabled').addEventListener('change', (e) =>
    frontPage.setEnabled(e.target.checked)
  );

  $('#fp-course').addEventListener('change', (e) => {
    setActiveCourse(e.target.value);
    onFrontValuesChanged();
  });
  $('#fp-manage-courses').addEventListener('click', () => goToTab('profile'));
  refreshCourseBar();
}

/** Course picker + chips for values approved for this assignment. */
function refreshCourseBar() {
  const select = $('#fp-course');
  if (!select) return;
  const { courses, activeCourseId } = getProfile();
  select.textContent = '';
  select.append(
    el('option', {
      value: '',
      text: courses.length
        ? '— No course selected —'
        : '— Add courses in My Profile —'
    })
  );
  for (const c of courses) {
    const name =
      [c.code, c.title].filter(Boolean).join(' – ') || 'Untitled course';
    select.append(el('option', { value: c.id, text: name }));
  }
  select.value = activeCourseId;

  const box = $('#fp-assignment-values');
  box.textContent = '';
  const values = Object.entries(getAssignmentValues()).filter(([, v]) => v);
  if (!values.length) {
    box.append(el('span.adv-hint', { text: 'None yet.' }));
    return;
  }
  for (const [key, value] of values) {
    const f = PROFILE_FIELDS.find((x) => x.key === key);
    box.append(
      el('span.chip', {}, [
        el('span.chip-text', {
          text: `${f ? f.label.replace(/ \(.*\)$/, '') : key}: ${value}`
        }),
        el('button.chip-x', {
          type: 'button',
          text: '×',
          'aria-label': `Stop using ${value}`,
          onclick: () => {
            clearAssignmentValues(key);
            onFrontValuesChanged();
          }
        })
      ])
    );
  }
  box.append(
    el('button.adv-small', {
      type: 'button',
      text: 'Clear all',
      onclick: () => {
        clearAssignmentValues();
        onFrontValuesChanged();
      }
    })
  );
}

function onFrontValuesChanged() {
  refreshCourseBar();
  frontPage && frontPage.redraw();
  renderStylePreview();
  if (pageEls.length) markStale();
}

/**
 * Offers values found in the question paper (course code, title, assignment
 * no. ...) for the front page. Asks only when something would change, and
 * never twice for the same findings.
 */
let lastOffered = '';
async function offerPaperDetails(found, source) {
  const changes = changedMeta(found);
  const signature = JSON.stringify(changes);
  if (!Object.keys(changes).length || signature === lastOffered) return;
  lastOffered = signature;
  const applied = await reviewMeta(found, { source });
  if (!Object.keys(applied).length) return;
  if (applied.subject && !draft.docInfo.subject) {
    draft.docInfo.subject = applied.subject;
    $('#doc-subject').value = applied.subject;
    saveDraft();
  }
  onFrontValuesChanged();
  toast('Front page updated with the details from your paper.', 'success');
}

/* -------------------------------- Content -------------------------------- */

function initContent() {
  const radios = $$('input[name="src"]');
  const applySource = () => {
    radios.forEach((r) => (r.checked = r.value === draft.source));
    $$('[data-src]').forEach(
      (n) => (n.hidden = !n.dataset.src.split(' ').includes(draft.source))
    );
  };
  radios.forEach((r) =>
    r.addEventListener('change', () => {
      draft.source = r.value;
      saveDraft();
      applySource();
    })
  );
  applySource();

  // Paper inputs
  $('#src-paste-text').value = draft.pasteText;
  $('#src-paste-text').addEventListener('input', (e) => {
    draft.pasteText = e.target.value;
    saveDraft();
  });
  if (draft.pdfName)
    $(
      '#src-pdf-info'
    ).textContent = `Last paper: ${draft.pdfName} (text kept). Upload again to use AI PDF reading.`;

  /**
   * A new paper is a new assignment: drop everything from the previous one
   * (questions, answers, title/subject/instructions, course code etc. taken
   * from the old paper). The profile, courses and front page layout stay.
   */
  const startNewAssignment = () => {
    for (const q of draft.questions) deleteQuestionImages(q);
    draft.questions = [];
    draft.answers = {};
    draft.docText = '';
    draft.mathPages = [];
    if ($('#doc-text')) $('#doc-text').value = '';
    draft.docInfo = { title: '', subject: '', instructions: '' };
    for (const key of ['title', 'subject', 'instructions'])
      $(`#doc-${key}`).value = '';
    clearAssignmentValues();
    lastOffered = '';
    $('#find-status').textContent = '';
    saveDraft();
    renderQuestions();
    onFrontValuesChanged();
  };

  // Clear all (step 4): empties steps 3 and 4 for the next assignment.
  // Profile, courses, front page, handwriting and AI settings stay.
  $('#clear-all').addEventListener('click', () => {
    if (
      !window.confirm(
        'Clear the question paper, all questions and answers (with their images), the final text and the rendered pages?\n\nYour profile, front page and settings are kept. This cannot be undone.'
      )
    )
      return;
    startNewAssignment();
    draft.pdfText = '';
    draft.pdfName = '';
    draft.pasteText = '';
    draft.ownText = '';
    draft.docTextEdited = false;
    pdfSource = { file: null, base64: null };
    $('#src-pdf-file').value = '';
    $('#src-pdf-info').textContent = '';
    $('#src-paste-text').value = '';
    $('#own-text').value = '';
    $('#bulk-answers').value = '';
    $('#gen-status').textContent = '';
    saveDraft();
    clearRenderedPages();
    toast('Cleared. Ready for the next assignment.', 'success');
  });

  $('#src-pdf-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const info = $('#src-pdf-info');
    startNewAssignment();
    try {
      if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
        draft.pdfText = await readFileAs(file, 'text');
        pdfSource = { file: null, base64: null };
      } else {
        pdfSource = { file, base64: null };
        const res = await extractPdfText(file, {
          onProgress: (m) => (info.textContent = m)
        });
        draft.pdfText = res.text.slice(0, 500000);
        draft.mathPages = res.mathPages;
        info.textContent = `${file.name}: ${res.numPages} page(s)${
          res.scannedPages.length
            ? `, ${res.scannedPages.length} read with OCR`
            : ''
        }.`;
      }
      draft.pdfName = file.name;
      saveDraft();
      offerPaperDetails(detectMeta(draft.pdfText), `"${file.name}"`);
      if (!draft.pdfText.trim())
        info.textContent +=
          ' No text found. Try "Find questions (AI)" with Claude, which can read scanned PDFs.';
    } catch (err) {
      info.textContent = `Could not read the PDF: ${err.message}`;
    }
  });

  // Doc info
  for (const key of ['title', 'subject', 'instructions']) {
    const input = $(`#doc-${key}`);
    input.value = draft.docInfo[key] || '';
    input.addEventListener('input', () => {
      draft.docInfo[key] = input.value;
      saveDraft();
    });
  }

  const paperText = () =>
    draft.source === 'paste' ? draft.pasteText : draft.pdfText;

  const applyExtraction = (res) => {
    // (a), (b), (c)... become questions of their own, each with an answer.
    draft.questions = splitSubQuestions(res.questions);
    draft.answers = {};
    // The paper's own title/subject/instructions win over older values.
    for (const key of ['title', 'subject', 'instructions']) {
      if (res[key]) {
        draft.docInfo[key] = res[key];
        $(`#doc-${key}`).value = res[key];
      }
    }
    if (!draft.docInfo.subject && getProfile().values.subject) {
      draft.docInfo.subject = getProfile().values.subject;
      $('#doc-subject').value = draft.docInfo.subject;
    }
    saveDraft();
    renderQuestions();
  };

  $('#find-basic').addEventListener('click', () => {
    const text = paperText();
    if (!String(text).trim())
      return toast('Upload a paper or paste the questions first.', 'error');
    if (
      draft.questions.length &&
      !window.confirm('Replace the current questions and answers?')
    )
      return;
    const res = extractBasic(text);
    applyExtraction(res);
    offerPaperDetails(detectMeta(text), 'the question paper');
    $(
      '#find-status'
    ).textContent = `Found ${res.questions.length} question(s). Check and edit them below.`;
  });

  $('#find-ai').addEventListener('click', async (e) => {
    const provider = requireAI();
    if (!provider) return;
    const text = paperText();
    const canUsePdf = draft.source === 'pdf' && pdfSource.file && provider.pdf;
    if (!String(text).trim() && !canUsePdf)
      return toast('Upload a paper or paste the questions first.', 'error');
    if (
      draft.questions.length &&
      !window.confirm('Replace the current questions and answers?')
    )
      return;
    setBusy(e.target, true, 'Finding…');
    const status = $('#find-status');
    try {
      if (canUsePdf && !pdfSource.base64)
        pdfSource.base64 = await fileToBase64(pdfSource.file);
      // Providers that only get the text can still see the pages with
      // formulas as images, if they accept images.
      let pageImages = [];
      if (
        !canUsePdf &&
        provider.vision &&
        draft.source === 'pdf' &&
        pdfSource.file &&
        (draft.mathPages || []).length
      ) {
        status.textContent = 'Preparing the pages with formulas…';
        pageImages = await pdfPageImages(
          pdfSource.file,
          draft.mathPages.slice(0, 8)
        );
      }
      const res = await extractWithAI(
        { text, pdfBase64: canUsePdf ? pdfSource.base64 : null, pageImages },
        provider,
        { onProgress: (m) => (status.textContent = m) }
      );
      applyExtraction(res);
      status.textContent = `Found ${res.questions.length} question(s). Check them, then generate answers.`;
      // Exact text matches first; the AI fills anything they missed.
      offerPaperDetails(
        mergeMeta(detectMeta(text), res.meta),
        'the question paper'
      );
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
    } finally {
      setBusy(e.target, false);
    }
  });

  $('#add-question').addEventListener('click', () => {
    draft.questions.push({
      id: uid(),
      number: String(draft.questions.length + 1),
      text: '',
      marks: '',
      wordLimit: ''
    });
    saveDraft();
    renderQuestions();
  });

  $('#gen-all').addEventListener('click', () => generateAnswers(false));
  $('#gen-missing').addEventListener('click', () => generateAnswers(true));
  $('#gen-stop').addEventListener(
    'click',
    () => genController && genController.abort()
  );

  $('#copy-prompt').addEventListener('click', async () => {
    if (!draft.questions.length)
      return toast('Find or add questions first.', 'error');
    const prompt = bulkCopyPrompt({
      questions: draft.questions,
      template: getTemplate(draft.templateId),
      context: academicContext(),
      docInfo: draft.docInfo
    });
    const withFigures = draft.questions.filter((q) => (q.figures || []).length);
    if (!(await copyText(prompt))) return toast('Copy failed.', 'error');
    toast(
      withFigures.length
        ? `Prompt copied. ${withFigures
            .map((q) => `Q${q.number}`)
            .join(', ')} ha${
            withFigures.length > 1 ? 've' : 's'
          } a figure that isn't in this prompt: use "Copy prompt" on ${
            withFigures.length > 1 ? 'those questions' : 'that question'
          } instead.`
        : 'Prompt copied. Paste it into your chatbot.',
      withFigures.length ? 'info' : 'success'
    );
  });

  $('#import-answers').addEventListener('click', () => {
    const text = $('#bulk-answers').value;
    const parts = parseBulkAnswers(text, draft.questions.length);
    let count = 0;
    parts.forEach((a, i) => {
      if (a) {
        draft.answers[draft.questions[i].id] = a;
        count++;
      }
    });
    if (!count && text.trim() && draft.questions.length === 1) {
      draft.answers[draft.questions[0].id] = text.trim();
      count = 1;
    }
    saveDraft();
    renderQuestions();
    toast(
      count
        ? `Imported ${count} answer(s).`
        : 'No "=== ANSWER n ===" markers found.',
      count ? 'success' : 'error'
    );
  });

  // Own content
  const own = $('#own-text');
  own.value = draft.ownText;
  own.addEventListener('input', () => {
    draft.ownText = own.value;
    saveDraft();
  });
  $$('#own-toolbar button').forEach((b) =>
    b.addEventListener('click', () => {
      const { selectionStart: s, selectionEnd: en, value } = own;
      if (b.dataset.wrap) {
        const w = b.dataset.wrap;
        own.setRangeText(
          `${w}${value.slice(s, en) || 'text'}${w}`,
          s,
          en,
          'end'
        );
      } else {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        own.setRangeText(b.dataset.insert, lineStart, lineStart, 'end');
      }
      own.focus();
      draft.ownText = own.value;
      saveDraft();
    })
  );

  renderQuestions();
}

/** Grows a textarea to show all its text (capped by CSS max-height). */
function autoGrow(t) {
  if (!t.isConnected || !t.offsetParent) return;
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}

function growAllQuestions() {
  document
    .querySelectorAll('#questions-list textarea')
    .forEach((t) => autoGrow(t));
}

let growListeners = false;
function watchQuestionSizes() {
  if (growListeners) return;
  growListeners = true;
  // Closed <details> have no size; text wraps differently after a resize.
  $('#step-content')?.addEventListener('toggle', growAllQuestions);
  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(growAllQuestions, 150);
  });
}

/** Removes a question's figures and the images inside its answer. */
function deleteQuestionImages(q) {
  for (const id of [...(q.figures || []), ...imageIdsIn(draft.answers[q.id])])
    deleteImage(id);
}

function renderQuestions() {
  const list = $('#questions-list');
  if (!list) return;
  list.textContent = '';
  const template = getTemplate(draft.templateId);
  if (!draft.questions.length) {
    list.append(
      el('p.adv-hint', {
        text:
          'No questions yet. Upload or paste the paper, then click "Find questions".'
      })
    );
    return;
  }
  draft.questions.forEach((q, idx) => {
    const num = el('input.q-num', { 'aria-label': 'Question number' });
    num.value = q.number;
    const marks = el('input.q-marks', {
      placeholder: 'marks',
      'aria-label': 'Marks'
    });
    marks.value = q.marks;
    const words = el('input.q-marks', {
      placeholder: 'words',
      'aria-label': 'Word limit'
    });
    words.value = q.wordLimit;
    const text = el('textarea.q-text', {
      rows: 2,
      'aria-label': 'Question text'
    });
    text.value = q.text;
    const answer = el('textarea.q-answer', {
      rows: 6,
      placeholder: 'Answer (generate with AI, import, or type/paste here)',
      'aria-label': 'Answer'
    });
    answer.value = draft.answers[q.id] || '';
    const status = el('span.adv-status.q-status');
    const formulaWarn = el('p.adv-hint.q-warn');
    const updateWarn = (value) => {
      const bad = garbledMath(value);
      formulaWarn.hidden = !bad;
      formulaWarn.textContent = bad
        ? `⚠ "${bad}" looks like a formula the PDF stored as symbols. Compare it with the question paper and fix it here, e.g. T(n) = 16T(n/4) + n^2.`
        : '';
    };
    updateWarn(q.text);

    // Figures (e.g. the graph in "Consider the following graph"): paste a
    // screenshot into the question, or upload. Drawn under the question.
    const figs = el('div.q-figs');
    // Shown only when the question has a figure: the chatbot needs it too.
    const figCaution = el('p.adv-hint.q-fig-caution', {
      text:
        '⚠ This question has a figure. "Copy prompt" copies one picture with the prompt printed above the figure: paste it once into a chatbot that accepts images (ChatGPT, Gemini, Claude.ai) and send. If the chat asks for text, type "Answer the question in this image". "Copy text only" and "Copy figure" copy the parts separately.'
    });
    const copyFigBtn = el('button.adv-small', {
      type: 'button',
      text: 'Copy figure',
      title: 'Copy the figure to paste into a chatbot',
      onclick: async () => {
        if (await copyImagesToClipboard(q.figures || [])) {
          toast(
            'Figure copied. Paste it into the same chat message.',
            'success'
          );
        } else {
          toast(
            'This browser blocked copying images. The figure was downloaded instead: attach it in the chat.',
            'info'
          );
          downloadImages(q.figures || [], `Q${q.number || idx + 1}-figure`);
        }
      }
    });
    const copyTextBtn = el('button.adv-small', {
      type: 'button',
      text: 'Copy text only',
      title: 'Copy just the prompt text (if a paste brought only the image)',
      onclick: async () => {
        const prompt = singleCopyPrompt({
          question: q,
          template: getTemplate(draft.templateId),
          context: academicContext(),
          docInfo: draft.docInfo
        });
        (await copyText(prompt))
          ? toast(
              'Prompt text copied. Paste it into the same chat message.',
              'success'
            )
          : toast('Copy failed.', 'error');
      }
    });
    const updateFigUI = () => {
      const has = (q.figures || []).length > 0;
      figCaution.hidden = !has;
      copyFigBtn.hidden = !has;
      copyTextBtn.hidden = !has;
    };
    updateFigUI();
    const renderFigs = async () => {
      updateFigUI();
      figs.textContent = '';
      for (const id of q.figures || []) {
        const img = await getImage(id);
        if (!img) continue;
        figs.append(
          el('div.q-fig', {}, [
            el('img', { src: img.src, alt: 'Figure for this question' }),
            el('button.adv-icon-btn', {
              type: 'button',
              text: '×',
              title: 'Remove figure',
              'aria-label': 'Remove figure',
              onclick: async () => {
                q.figures = q.figures.filter((x) => x !== id);
                await deleteImage(id);
                saveDraft();
                renderFigs();
              }
            })
          ])
        );
      }
    };
    const addFigure = async (file) => {
      try {
        const id = await addImage(file);
        q.figures = [...(q.figures || []), id];
        saveDraft();
        renderFigs();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    renderFigs();
    const pickImage = (onFile) => {
      const input = el('input', { type: 'file', accept: 'image/*' });
      input.addEventListener('change', () => {
        if (input.files[0]) onFile(input.files[0]);
      });
      input.click();
    };
    text.addEventListener('paste', (e) => {
      const file = imageFromClipboard(e);
      if (!file) return;
      e.preventDefault();
      addFigure(file);
    });

    // Images inside the answer go exactly where the cursor is.
    const insertInAnswer = async (file) => {
      try {
        const id = await addImage(file, { kind: 'drawing' });
        const at = answer.selectionStart ?? answer.value.length;
        const before = answer.value.slice(0, at).replace(/[ \t]*$/, '');
        const after = answer.value.slice(at).replace(/^[ \t]*/, '');
        answer.value = `${before}${before ? '\n\n' : ''}${imageMarker(id)}${
          after ? '\n\n' : ''
        }${after}`;
        draft.answers[q.id] = answer.value;
        saveDraft();
        autoGrow(answer);
        refreshAnswerExtras();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    answer.addEventListener('paste', (e) => {
      const file = imageFromClipboard(e);
      if (!file) return;
      e.preventDefault();
      insertInAnswer(file);
    });
    const target = el('small.adv-hint');
    const updateTarget = () =>
      (target.textContent = `≈ ${targetWords(q, template)} words`);
    updateTarget();

    const bindQ = (input, key) =>
      input.addEventListener('input', () => {
        q[key] = input.value;
        saveDraft();
        updateTarget();
      });
    bindQ(num, 'number');
    bindQ(marks, 'marks');
    bindQ(words, 'wordLimit');
    bindQ(text, 'text');
    text.addEventListener('input', () => {
      autoGrow(text);
      updateWarn(text.value);
    });
    // Each "[diagram: ...]" in the answer: copy a prompt for an image AI,
    // then put the picture it makes in place of the blank diagram space.
    const diagramsBox = el('div.q-diagrams');
    const inkName = () => {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
        String(style.inkBody || '')
      );
      if (!m) return 'blue';
      const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
      return b > r + 30 && b > g ? 'blue' : 'black';
    };
    const replaceDiagram = async (d, file) => {
      const current = answerDiagrams(answer.value)[d.index];
      if (!current)
        return toast('That diagram line is no longer in the answer.', 'error');
      try {
        const id = await addImage(file, { kind: 'drawing' });
        answer.value = replaceDiagramLine(
          answer.value,
          d.index,
          imageMarker(id, `Fig: ${current.caption}`)
        );
        draft.answers[q.id] = answer.value;
        saveDraft();
        autoGrow(answer);
        refreshAnswerExtras();
        toast('Diagram added to the answer.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const renderDiagrams = () => {
      const list = answerDiagrams(answer.value);
      diagramsBox.textContent = '';
      if (!list.length) return;
      diagramsBox.append(
        el('span.q-label', { text: 'Diagrams in this answer' }),
        el('p.adv-hint', {
          text:
            'Copy the prompt into Gemini or ChatGPT, copy the picture it makes (right-click → Copy image), then click "Paste image". Until then, blank space is left on the page to draw it by hand.'
        })
      );
      for (const d of list) {
        diagramsBox.append(
          el('div.q-diagram', {}, [
            el('span.q-diagram-name', { text: `Fig: ${d.caption}` }),
            // Text only: no image from this question goes along unless asked
            // for with the next button.
            el('button.adv-small', {
              type: 'button',
              text: 'Copy diagram prompt',
              onclick: async () => {
                const prompt = diagramPrompt({
                  question: q,
                  answer: answer.value,
                  index: d.index,
                  caption: d.caption,
                  docInfo: draft.docInfo,
                  ink: inkName()
                });
                (await copyText(prompt))
                  ? toast(
                      'Diagram prompt copied. Paste it into Gemini or ChatGPT.',
                      'success'
                    )
                  : toast('Copy failed.', 'error');
              }
            }),
            // Only when the diagram must use data from the question's own
            // figure (e.g. "draw the MST of the graph in Figure 1").
            (q.figures || []).length > 0 &&
              el('button.adv-small', {
                type: 'button',
                text: '+ with question figure',
                title:
                  "Also copy the question's figure, when the diagram must use its data (e.g. the graph's nodes and weights)",
                onclick: async () => {
                  const prompt = diagramPrompt({
                    question: q,
                    answer: answer.value,
                    index: d.index,
                    caption: d.caption,
                    docInfo: draft.docInfo,
                    ink: inkName(),
                    withFigure: true
                  });
                  if (await copyTextWithImages(prompt, q.figures))
                    return toast(
                      "Diagram prompt and the question's figure copied. Paste into Gemini or ChatGPT.",
                      'success'
                    );
                  (await copyText(prompt))
                    ? toast(
                        'Prompt copied, but this browser couldn\'t copy the figure with it: use "Copy figure" too.',
                        'info'
                      )
                    : toast('Copy failed.', 'error');
                }
              }),
            el('button.adv-small', {
              type: 'button',
              text: 'Paste image',
              title: 'Use the image you copied from the AI',
              onclick: async () => {
                let img = null;
                try {
                  img = await readClipboardImage();
                } catch (e) {
                  /* blocked or empty: handled below */
                }
                if (!img)
                  return toast(
                    'No image on the clipboard. Copy the image in the AI chat first (right-click → Copy image), or use "Upload image".',
                    'info'
                  );
                replaceDiagram(d, img);
              }
            }),
            el('button.adv-small', {
              type: 'button',
              text: 'Upload image',
              onclick: () => pickImage((file) => replaceDiagram(d, file))
            })
          ])
        );
      }
    };
    // The "[image: ...]" lines in the answer, shown as the pictures they
    // stand for (as they will look on the page), so it's clear what's where.
    const imagesBox = el('div.q-answer-imgs');
    const setAnswer = (value) => {
      answer.value = value;
      draft.answers[q.id] = value;
      saveDraft();
      autoGrow(answer);
      refreshAnswerExtras();
    };
    let imagesKey = '';
    const renderAnswerImages = async () => {
      const refs = imageRefsIn(answer.value);
      const key =
        refs.map((r) => r.marker).join('\n') + style.inkBody + style.lines;
      if (key === imagesKey) return; // typing elsewhere: nothing to redo
      imagesKey = key;
      const items = [];
      for (const [i, ref] of refs.entries()) {
        const img = await blendedImage(ref.id, style.inkBody);
        items.push(
          el('figure.q-answer-img', {}, [
            img
              ? el(style.lines ? 'img.ruled' : 'img', {
                  src: img.src,
                  alt: ref.caption || 'Image in the answer'
                })
              : el('p.adv-hint', { text: 'Image missing: add it again.' }),
            el('figcaption', {}, [
              el('span', {
                text: `${i + 1}. ${ref.caption || 'Image (no caption)'}`
              }),
              el('button.adv-small', {
                type: 'button',
                text: 'Replace',
                onclick: () =>
                  pickImage(async (file) => {
                    try {
                      const id = await addImage(file, { kind: 'drawing' });
                      setAnswer(
                        answer.value.replace(
                          ref.marker,
                          imageMarker(id, ref.caption)
                        )
                      );
                      deleteImage(ref.id);
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  })
              }),
              el('button.adv-small', {
                type: 'button',
                text: 'Remove',
                onclick: () => {
                  if (!window.confirm('Remove this image from the answer?'))
                    return;
                  // Back to a blank diagram space if it had a caption.
                  const back = /^Fig:\s*/i.test(ref.caption)
                    ? `[diagram: ${ref.caption.replace(/^Fig:\s*/i, '')}]`
                    : '';
                  setAnswer(
                    answer.value
                      .replace(ref.marker, back)
                      .replace(/\n{3,}/g, '\n\n')
                  );
                  deleteImage(ref.id);
                }
              })
            ])
          ])
        );
      }
      // Still the latest answer? (another render may have started meanwhile)
      if (key !== imagesKey) return;
      imagesBox.textContent = '';
      if (!items.length) return;
      imagesBox.append(
        el('span.q-label', { text: 'Images in this answer' }),
        el('p.adv-hint', {
          text:
            'Each "[image: …]" line in the answer is one of these pictures, shown as it will look on the page.'
        }),
        ...items
      );
    };
    const refreshAnswerExtras = () => {
      renderDiagrams();
      renderAnswerImages();
    };
    refreshAnswerExtras();

    answer.addEventListener('input', () => {
      draft.answers[q.id] = answer.value;
      saveDraft();
      autoGrow(answer);
      refreshAnswerExtras();
    });

    const card = el('div.q-card', { dataset: { id: q.id } }, [
      q.group &&
        el('p.adv-hint.q-parent', {
          text: `Part ${q.label} of Q${q.groupNumber}${
            q.stem ? `: ${q.stem}` : ''
          }`
        }),
      el('div.q-head', {}, [
        num,
        marks,
        words,
        target,
        el('span.q-spacer'),
        el('button.adv-small.q-gen', {
          type: 'button',
          text: answer.value ? 'Regenerate' : 'Generate',
          onclick: () => generateAnswers(false, [q])
        }),
        el('button.adv-small', {
          type: 'button',
          text: 'Copy prompt',
          title: 'No API key? Copy this question as a prompt for any chatbot',
          onclick: async () => {
            const prompt = singleCopyPrompt({
              question: q,
              template: getTemplate(draft.templateId),
              context: academicContext(),
              docInfo: draft.docInfo
            });
            const figures = q.figures || [];
            // With a figure: text and image on the clipboard together.
            if (figures.length && (await copyTextWithImages(prompt, figures))) {
              return toast(
                'Copied as one picture: the prompt with the figure under it. Paste it once into the chat and send.',
                'success'
              );
            }
            if (!(await copyText(prompt)))
              return toast('Copy failed.', 'error');
            toast(
              figures.length
                ? 'Prompt copied (this browser can\'t copy text and image together). Paste it, then click "Copy figure" and paste that too.'
                : 'Prompt copied. Paste it into your chatbot, then paste its reply with "Paste answer".',
              figures.length ? 'info' : 'success'
            );
          }
        }),
        copyFigBtn,
        copyTextBtn,
        !q.group &&
          splitSubQuestions([q]).length > 1 &&
          el('button.adv-small', {
            type: 'button',
            text: 'Split into parts',
            title:
              'Make (a), (b), (c)... separate questions, each with its own answer',
            onclick: () => {
              if (
                String(draft.answers[q.id] || '').trim() &&
                !window.confirm(
                  'Each part will get its own answer, so the current answer for this question will be removed. Continue?'
                )
              )
                return;
              const parts = splitSubQuestions([q]);
              const at = draft.questions.indexOf(q);
              draft.questions.splice(at, 1, ...parts);
              delete draft.answers[q.id];
              saveDraft();
              renderQuestions();
            }
          }),
        el('button.adv-small', {
          type: 'button',
          text: '↑',
          title: 'Move up',
          'aria-label': 'Move question up',
          disabled: idx === 0,
          onclick: () => {
            [draft.questions[idx - 1], draft.questions[idx]] = [
              draft.questions[idx],
              draft.questions[idx - 1]
            ];
            saveDraft();
            renderQuestions();
          }
        }),
        el('button.adv-icon-btn', {
          type: 'button',
          text: '×',
          title: 'Delete question',
          'aria-label': 'Delete question',
          onclick: () => {
            draft.questions.splice(idx, 1);
            deleteQuestionImages(q);
            delete draft.answers[q.id];
            saveDraft();
            renderQuestions();
          }
        })
      ]),
      // Side by side on wide screens, stacked on narrow ones.
      el('div.q-body', {}, [
        el('div.q-col', {}, [
          el('span.q-label', { text: 'Question' }),
          text,
          figs,
          figCaution,
          el('button.adv-small.q-add-img', {
            type: 'button',
            text: '+ Add figure',
            title:
              'Upload an image, or paste a screenshot into the question box',
            onclick: () => pickImage(addFigure)
          })
        ]),
        el('div.q-col', {}, [
          el('span.q-label', { text: 'Answer' }),
          answer,
          imagesBox,
          diagramsBox,
          el('button.adv-small.q-add-img', {
            type: 'button',
            text: 'Paste answer',
            title: "Paste the chatbot's reply as this question's answer",
            onclick: async () => {
              let reply = '';
              try {
                reply = await navigator.clipboard.readText();
              } catch (e) {
                answer.focus();
                return toast(
                  'Click in the answer box and press Ctrl+V / ⌘V to paste.',
                  'info'
                );
              }
              // Drop a stray "=== ANSWER 1 ===" marker if the bot added one.
              reply = reply
                .replace(/^\s*=+\s*ANSWER\s+\d+\s*=+\s*$/gim, '')
                .trim();
              if (!reply) return toast('The clipboard is empty.', 'error');
              if (
                answer.value.trim() &&
                !window.confirm(
                  'Replace the current answer with the pasted one?'
                )
              )
                return;
              answer.value = reply;
              draft.answers[q.id] = reply;
              saveDraft();
              autoGrow(answer);
              refreshAnswerExtras();
              toast('Answer pasted.', 'success');
            }
          }),
          el('button.adv-small.q-add-img', {
            type: 'button',
            text: '+ Image at cursor',
            title:
              'Insert an image where the cursor is in the answer (you can also paste one)',
            onclick: () => pickImage(insertInAnswer)
          })
        ])
      ]),
      formulaWarn,
      status
    ]);
    list.append(card);
  });
  watchQuestionSizes();
  requestAnimationFrame(growAllQuestions);
  refreshAIAvailability();
}

async function generateAnswers(onlyMissing, subset) {
  const provider = requireAI();
  if (!provider) return;
  const template = getTemplate(draft.templateId);
  const targets = (subset || draft.questions).filter(
    (q) =>
      String(q.text).trim() &&
      (!onlyMissing || !String(draft.answers[q.id] || '').trim())
  );
  if (!targets.length)
    return toast(
      onlyMissing
        ? 'Every question already has an answer.'
        : 'No questions to answer.',
      'info'
    );
  if (genController)
    return toast('Already generating. Press Stop first.', 'info');

  genController = new AbortController();
  const signal = genController.signal;
  $('#gen-stop').hidden = false;
  const status = $('#gen-status');
  const context = academicContext();
  let done = 0;
  let failed = 0;

  try {
    for (const q of targets) {
      if (signal.aborted) break;
      const card = $(`.q-card[data-id="${q.id}"]`);
      const qStatus = card && $('.q-status', card);
      status.textContent = `Writing answer ${done + failed + 1} of ${
        targets.length
      }…`;
      if (qStatus) qStatus.textContent = 'Writing…';
      card && card.classList.add('working');

      let attempt = 0;
      for (;;) {
        try {
          const figures = [];
          for (const id of q.figures || []) {
            const img = await getImage(id);
            if (img) figures.push(img.src);
          }
          const { text, truncated } = await complete(
            {
              system: answerSystemPrompt(template),
              prompt:
                answerUserPrompt({
                  question: q,
                  template,
                  context,
                  docInfo: draft.docInfo
                }) +
                (figures.length && provider.vision
                  ? '\n\nThe figure(s) from the question paper are attached. Use them to answer.'
                  : ''),
              images: provider.vision ? figures : [],
              maxTokens: 16000,
              effort: 'medium',
              signal
            },
            provider
          );
          draft.answers[q.id] = text.trim();
          saveDraft();
          if (card) {
            $('.q-answer', card).value = draft.answers[q.id];
            // Refreshes the size and the diagram buttons for the new answer.
            $('.q-answer', card).dispatchEvent(new Event('input'));
            $('.q-gen', card).textContent = 'Regenerate';
          }
          if (qStatus)
            qStatus.textContent = truncated
              ? '⚠ Answer was cut off by the model’s length limit. Regenerate or edit.'
              : figures.length && !provider.vision
              ? '✓ Done. This AI model can’t see images, so it answered without the figure: check the answer.'
              : '✓ Done';
          done++;
          break;
        } catch (err) {
          if (signal.aborted || err.name === 'AbortError') throw err;
          if (err.retryable && attempt < 2) {
            attempt++;
            if (qStatus) qStatus.textContent = `Retrying (${err.message})…`;
            await sleep(2500 * attempt);
            continue;
          }
          failed++;
          if (qStatus) qStatus.textContent = `✗ ${err.message}`;
          if (err.status === 401 || err.status === 403 || err.status === 402)
            throw err; // key problem: stop
          break;
        }
      }
      card && card.classList.remove('working');
    }
    status.textContent = `Finished: ${done} written${
      failed ? `, ${failed} failed` : ''
    }.`;
    if (pageEls.length) markStale();
  } catch (err) {
    status.textContent = signal.aborted
      ? `Stopped. ${done} answer(s) written.`
      : `✗ ${err.message}`;
  } finally {
    $$('.q-card.working').forEach((c) => c.classList.remove('working'));
    genController = null;
    $('#gen-stop').hidden = true;
  }
}

/* --------------------------------- Build --------------------------------- */

function composeCurrent() {
  if (draft.source === 'own') return draft.ownText;
  return composeDocument({
    template: getTemplate(draft.templateId),
    questions: draft.questions,
    answers: draft.answers,
    docInfo: draft.docInfo,
    options: { pageBreakBetween: style.pageBreakBetween }
  });
}

/** Forgets the rendered pages (preview, downloads) of step 4. */
function clearRenderedPages() {
  pageEls = [];
  renderedPages = [];
  $('#pages-preview').textContent = '';
  $('#hw-stage').textContent = '';
  $('#download-pdf').disabled = true;
  $('#download-images').disabled = true;
  $('#build-status').textContent = '';
}

function markStale() {
  $('#build-status').textContent =
    'Settings changed. Click "Render pages" to update.';
}

function initBuild() {
  const docText = $('#doc-text');
  docText.value = draft.docText || '';
  docText.addEventListener('input', () => {
    draft.docText = docText.value;
    draft.docTextEdited = true;
    saveDraft();
  });

  $('#build-doc').addEventListener('click', () => {
    if (
      draft.docTextEdited &&
      draft.docText &&
      !window.confirm(
        'Rebuild the document? Your manual edits to the final text will be replaced.'
      )
    )
      return;
    draft.docText = composeCurrent();
    draft.docTextEdited = false;
    docText.value = draft.docText;
    saveDraft();
    $('#doc-text-wrap').open = true;
    $('#build-status').textContent =
      'Document built. Review the text, then click "Render pages".';
  });

  $('#render-pages').addEventListener('click', async (e) => {
    // Use the edited text if the user built/edited it; otherwise compose fresh.
    const text =
      draft.docTextEdited && draft.docText ? draft.docText : composeCurrent();
    if (!draft.docTextEdited) {
      draft.docText = text;
      docText.value = text;
      saveDraft();
    }
    const blocks = await resolveImageBlocks(parseDocument(text), {
      ink: style.inkBody
    });
    if (!blocks.some((b) => b.type !== 'break')) {
      return toast(
        draft.source === 'own'
          ? 'Write some content first.'
          : 'Add questions and answers first.',
        'error'
      );
    }
    const missing =
      draft.source !== 'own'
        ? draft.questions.filter(
            (q) => !String(draft.answers[q.id] || '').trim()
          ).length
        : 0;
    if (
      missing &&
      !window.confirm(
        `${missing} question(s) have no answer yet. Render anyway?`
      )
    )
      return;

    setBusy(e.target, true, 'Rendering…');
    const status = $('#build-status');
    try {
      status.textContent = 'Loading handwriting font…';
      await ensureFont(style.font, text.slice(0, 200));
      status.textContent = 'Laying out pages…';
      await sleep(20);
      pageEls = paginate(blocks, style, $('#hw-stage'), {
        headerText: headerText(),
        footerText: footerText()
      });
      showPreview(pageEls);
      renderedPages = [];
      $('#download-pdf').disabled = false;
      $('#download-images').disabled = false;
      status.textContent = `${pageEls.length} page(s)${
        frontPage.isEnabled() ? ' + front page' : ''
      }. Download when ready.`;
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
    } finally {
      setBusy(e.target, false);
    }
  });

  const capture = async () => {
    if (renderedPages.length === pageEls.length && renderedPages.length)
      return renderedPages;
    const status = $('#build-status');
    // html2canvas needs the pages in the live document, unscaled.
    const stage = $('#hw-stage');
    stage.textContent = '';
    pageEls.forEach((p) => {
      p.style.transform = '';
      stage.append(p);
    });
    try {
      renderedPages = await capturePages(
        pageEls,
        style,
        (m) => (status.textContent = m)
      );
    } finally {
      showPreview(pageEls);
    }
    return renderedPages;
  };

  $('#download-pdf').addEventListener('click', async (e) => {
    setBusy(e.target, true, 'Preparing PDF…');
    const status = $('#build-status');
    try {
      const pages = await capture();
      status.textContent = 'Building PDF…';
      const front = frontPage.isEnabled()
        ? await frontPage.exportDataUrl()
        : null;
      const name = outputName();
      const bytes = await buildPdf({
        frontPage: front,
        pages,
        filename: `${name}.pdf`
      });
      status.textContent = `PDF downloaded (${
        pages.length + (front ? 1 : 0)
      } pages, ${(bytes / 1024 / 1024).toFixed(1)} MB).`;
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
    } finally {
      setBusy(e.target, false);
    }
  });

  $('#download-images').addEventListener('click', async (e) => {
    setBusy(e.target, true, 'Preparing…');
    try {
      const pages = await capture();
      if (frontPage.isEnabled())
        downloadDataUrl(
          await frontPage.exportDataUrl(),
          `${outputName()}_page-00-front.jpg`
        );
      for (let i = 0; i < pages.length; i++) {
        downloadDataUrl(
          pages[i],
          `${outputName()}_page-${String(i + 1).padStart(2, '0')}.jpg`
        );
        await sleep(250);
      }
    } catch (err) {
      $('#build-status').textContent = `✗ ${err.message}`;
    } finally {
      setBusy(e.target, false);
    }
  });
}

/**
 * File name for downloads: course code first, then the assignment title,
 * e.g. "MCS-211_MCA-First-Semester-Assignment". No title: programme,
 * semester and "Assignment". The code isn't repeated if the title has it.
 */
function outputName() {
  const clean = (t) =>
    String(t || '')
      .replace(/[^\w\- ]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');
  const code = String(fieldValue('subjectCode') || '').trim();
  let title =
    draft.docInfo.title ||
    [
      fieldValue('programmeCode') || fieldValue('course'),
      fieldValue('semester') &&
        `Semester ${fieldValue('semester')}`.replace(
          /^Semester\s+(semester|sem)\b\.?\s*/i,
          'Semester '
        ),
      'Assignment'
    ]
      .filter(Boolean)
      .join(' ');
  if (code) {
    // "MCSL-217", "MCSL 217" and "MCSL217" all count as the code.
    const parts = code.match(/[a-z]+|\d+/gi) || [];
    if (parts.length) {
      const re = new RegExp(parts.join('[\\s\\-_./]*'), 'gi');
      title = title.replace(re, ' ');
    }
  }
  return [clean(code), clean(title)].filter(Boolean).join('_') || 'assignment';
}

function showPreview(pages) {
  const box = $('#pages-preview');
  box.textContent = '';
  const thumbW = 230;
  const scale = thumbW / PAGE_W;
  pages.forEach((p, i) => {
    p.style.transform = `scale(${scale})`;
    p.style.transformOrigin = '0 0';
    const frame = el(
      'div.adv-thumb',
      { style: { width: `${thumbW}px`, height: `${PAGE_H * scale}px` } },
      [p]
    );
    box.append(
      el('figure', {}, [frame, el('figcaption', { text: `Page ${i + 1}` })])
    );
  });
}
