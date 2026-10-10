/**
 * Course / assignment details found in an uploaded question paper
 * (e.g. "Course Code : BCS-011", "Assignment Number : BCA(1)/011/...").
 *
 * detectMeta(text)      -> { subjectCode: 'BCS-011', subject: '...', ... }
 * reviewMeta(found, ..) -> pop-up listing what was found next to the current
 *                          front-page values; approved values are used for
 *                          this assignment and can be saved as a course.
 */
import {
  PROFILE_FIELDS,
  fieldValue,
  setAssignmentValues,
  findCourse,
  upsertCourse
} from './profile.mjs';
import { el } from './ui.mjs';

/** What we look for, longest labels first so "programme code" beats "programme". */
export const META_FIELDS = [
  {
    key: 'subjectCode',
    labels: ['course code', 'subject code', 'paper code', 'course no']
  },
  {
    key: 'subject',
    labels: [
      'title of the course',
      'course title',
      'course tittle',
      'course name',
      'subject name',
      'name of the subject',
      'paper name',
      'paper title',
      'subject'
    ]
  },
  {
    key: 'assignmentNo',
    labels: [
      'assignment number',
      'assignment no',
      'assignment code',
      'assignment id'
    ]
  },
  { key: 'programmeCode', labels: ['programme code', 'program code'] },
  { key: 'course', labels: ['programme', 'program'] },
  { key: 'semester', labels: ['semester'] },
  { key: 'session', labels: ['academic session', 'academic year', 'session'] },
  {
    key: 'submittedTo',
    labels: ['submitted to', 'faculty name', 'course coordinator']
  }
];

const LABEL_TO_KEY = new Map();
for (const f of META_FIELDS)
  for (const l of f.labels) LABEL_TO_KEY.set(l, f.key);
const ALL_LABELS = [...LABEL_TO_KEY.keys()].sort((a, b) => b.length - a.length);
const escape = (s) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
// A label must be followed by ":" or a spaced dash ("Code - X", "Code -X"),
// so sentences and words like "subject-wise" don't match.
const LABEL_RE = new RegExp(
  `\\b(${ALL_LABELS.map(escape).join(
    '|'
  )})\\.?(?:\\s*no\\.?)?\\s*(?::|(?<=\\s)[-–]|[-–](?=\\s))\\s*`,
  'gi'
);

// Scanned papers: OCR often reads the ":" as H, 3, |, ; ... ("Assignment
// Number H MCA_NEW(I)/213/..."). Only trusted when the label starts the line.
const OCR_LABEL_RE = new RegExp(
  `^\\s*(${ALL_LABELS.map(escape).join(
    '|'
  )})\\.?(?:\\s*no\\.?)?\\s+[Hh3|;!il1]\\s+(\\S.*)$`,
  'i'
);

const labelOf = (key) => {
  const f = PROFILE_FIELDS.find((x) => x.key === key);
  return f ? f.label.replace(/ \(.*\)$/, '') : key;
};

function cleanValue(v) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:\-–]+|[\s,;:\-–]+$/g, '')
    .trim();
}

export function detectMeta(text) {
  const found = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const matches = [...line.matchAll(LABEL_RE)];
    if (!matches.length) {
      const m = OCR_LABEL_RE.exec(line);
      const key =
        m && LABEL_TO_KEY.get(m[1].toLowerCase().replace(/\s+/g, ' '));
      const value = m && cleanValue(m[2]);
      if (key && !found[key] && value && value.length <= 120)
        found[key] = value;
      continue;
    }
    matches.forEach((m, i) => {
      const key = LABEL_TO_KEY.get(m[1].toLowerCase().replace(/\s+/g, ' '));
      if (!key || found[key]) return;
      const end = i + 1 < matches.length ? matches[i + 1].index : line.length;
      const value = cleanValue(line.slice(m.index + m[0].length, end));
      // Skip empty or sentence-like values (instructions, not data).
      if (value && value.length <= 120 && value.split(' ').length <= 16) {
        found[key] = value;
      }
    });
  }
  return found;
}

/** Combines regex results (exact text) with AI results (fills the gaps). */
export function mergeMeta(primary, secondary) {
  const out = { ...primary };
  for (const [k, v] of Object.entries(secondary || {})) {
    if (v && !out[k]) out[k] = cleanValue(v);
  }
  return out;
}

const same = (a, b) =>
  String(a || '')
    .trim()
    .toLowerCase() ===
  String(b || '')
    .trim()
    .toLowerCase();

/** Only values that would actually change something on the front page. */
export function changedMeta(found) {
  return Object.fromEntries(
    Object.entries(found).filter(([k, v]) => v && !same(fieldValue(k), v))
  );
}

/**
 * Shows the review pop-up. Resolves to the applied values ({} if dismissed).
 */
export function reviewMeta(found, { source = 'the question paper' } = {}) {
  const entries = Object.entries(changedMeta(found));
  if (!entries.length) return Promise.resolve({});

  return new Promise((resolve) => {
    const rows = entries.map(([key, value]) => {
      const check = el('input', {
        type: 'checkbox',
        checked: true,
        'aria-label': `Use ${labelOf(key)}`
      });
      const input = el('input', { 'aria-label': labelOf(key) });
      input.value = value;
      const current = fieldValue(key);
      return {
        key,
        check,
        input,
        node: el('label.meta-row', {}, [
          check,
          el('span.meta-label', { text: labelOf(key) }),
          input,
          el('small.meta-current', {
            text: current ? `now: ${current}` : 'now: empty'
          })
        ])
      };
    });

    const code = found.subjectCode;
    const title = found.subject;
    const existing = findCourse({ code, title });
    const canSave = !!(code || title);
    const saveCourse = el('input', { type: 'checkbox', checked: canSave });
    const saveLabel = existing
      ? `Update my saved course "${
          existing.title || existing.code
        }" and select it`
      : 'Save as a new course in My Courses and select it';

    const dialog = el(
      'dialog.meta-dialog',
      { 'aria-labelledby': 'meta-title' },
      [
        el('h3', {
          id: 'meta-title',
          text: 'Use these details on the front page?'
        }),
        el('p.adv-hint', {
          text: `We found these in ${source}. Untick anything you don't want, or correct a value before applying.`
        }),
        el(
          'div.meta-rows',
          {},
          rows.map((r) => r.node)
        ),
        canSave && el('label.adv-check', {}, [saveCourse, ` ${saveLabel}`]),
        el('div.adv-toolbar', {}, [
          el('button.generate-image-button', {
            type: 'button',
            text: 'Use selected values',
            value: 'apply'
          }),
          el('button', { type: 'button', text: 'Not now', value: 'cancel' })
        ])
      ]
    );

    const finish = (apply) => {
      const applied = {};
      if (apply) {
        for (const r of rows) {
          const v = cleanValue(r.input.value);
          if (r.check.checked && v) applied[r.key] = v;
        }
        if (Object.keys(applied).length) setAssignmentValues(applied);
        if (canSave && saveCourse.checked) {
          upsertCourse(
            {
              code: applied.subjectCode || code,
              title: applied.subject || title,
              assignmentNo: applied.assignmentNo || '',
              submittedTo: applied.submittedTo || ''
            },
            { makeActive: true }
          );
        }
      }
      dialog.close();
      dialog.remove();
      resolve(applied);
    };

    dialog.addEventListener('click', (e) => {
      const btn = e.target.closest('button[value]');
      if (btn) finish(btn.value === 'apply');
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
