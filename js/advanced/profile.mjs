/**
 * The student's profile, stored locally. These fields fill front pages,
 * page headers and give the AI context (course, subject, level...).
 *
 * `labels` are the phrases we look for on an uploaded front page to decide
 * where each value belongs. Longer phrases are matched first.
 */
import { load, save } from './store.mjs';
import { el, uid } from './ui.mjs';

export const PROFILE_FIELDS = [
  {
    key: 'name',
    label: 'Full name',
    labels: [
      'name of the student',
      'name of student',
      'student name',
      'student s name',
      'submitted by',
      'name'
    ]
  },
  {
    key: 'rollNo',
    label: 'Roll number',
    labels: ['roll number', 'roll no', 'roll num', 'roll']
  },
  {
    key: 'enrollmentNo',
    label: 'Enrollment / Registration no.',
    labels: [
      'enrollment number',
      'enrolment number',
      'enrollment no',
      'enrolment no',
      'enrollment',
      'enrolment',
      'registration number',
      'registration no',
      'registration',
      'reg no',
      'student id',
      'id no',
      'prn',
      'usn',
      'uid',
      'admission no'
    ]
  },
  {
    key: 'address',
    label: 'Address',
    labels: ['postal address', 'correspondence address', 'address']
  },
  {
    key: 'phone',
    label: 'Phone',
    labels: [
      'phone number',
      'phone no',
      'mobile number',
      'mobile no',
      'contact number',
      'contact no',
      'phone',
      'mobile',
      'contact'
    ]
  },
  {
    key: 'email',
    label: 'Email',
    labels: ['e mail id', 'email id', 'e mail', 'email']
  },
  {
    key: 'university',
    label: 'University',
    labels: [
      'name of the university',
      'name of university',
      'university name',
      'university'
    ]
  },
  {
    key: 'college',
    label: 'College / Institute',
    labels: [
      'name of the college',
      'name of college',
      'name of the institute',
      'college name',
      'institute name',
      'college',
      'institute',
      'school'
    ]
  },
  {
    key: 'course',
    label: 'Programme / Course',
    labels: [
      'name of the programme',
      'name of the program',
      'programme name',
      'program name',
      'programme',
      'program',
      'degree',
      'course',
      'class'
    ]
  },
  {
    key: 'programmeCode',
    label: 'Programme code',
    labels: ['programme code', 'program code']
  },
  {
    key: 'branch',
    label: 'Branch / Department',
    labels: [
      'department',
      'branch',
      'dept',
      'stream',
      'specialization',
      'specialisation'
    ]
  },
  {
    key: 'semester',
    label: 'Semester / Year',
    labels: ['semester', 'sem', 'year']
  },
  {
    key: 'section',
    label: 'Section / Batch',
    labels: ['section', 'division', 'batch', 'div', 'group']
  },
  {
    key: 'session',
    label: 'Academic session',
    labels: ['academic session', 'academic year', 'session']
  },
  {
    key: 'regionalCentre',
    label: 'Regional centre',
    labels: [
      'regional centre code',
      'regional center code',
      'regional centre',
      'regional center'
    ]
  },
  {
    key: 'studyCentre',
    label: 'Study centre',
    labels: [
      'study centre code',
      'study center code',
      'study centre',
      'study center'
    ]
  },
  {
    key: 'subject',
    label: 'Subject / Course title',
    labels: [
      'subject name',
      'name of subject',
      'name of the course',
      'course title',
      'course tittle',
      'course name',
      'paper name',
      'subject'
    ]
  },
  {
    key: 'subjectCode',
    label: 'Subject / Course code',
    labels: ['subject code', 'course code', 'paper code', 'code']
  },
  {
    key: 'submittedTo',
    label: 'Submitted to (teacher)',
    labels: [
      'submitted to',
      'faculty name',
      'name of the faculty',
      'name of faculty',
      'name of the teacher',
      'faculty',
      'teacher',
      'instructor',
      'professor',
      'guided by',
      'guide',
      'supervisor'
    ]
  },
  {
    key: 'assignmentNo',
    label: 'Assignment no.',
    labels: ['assignment number', 'assignment no', 'assignment code']
  },
  {
    key: 'assignmentTitle',
    label: 'Assignment title / topic',
    labels: ['assignment title', 'title of assignment', 'topic', 'title']
  },
  {
    key: 'date',
    label: 'Date of submission (DD/MM/YYYY)',
    labels: ['date of submission', 'submission date', 'date']
  }
];

const DEFAULT_PROFILE = {
  values: {},
  custom: [],
  courses: [],
  activeCourseId: ''
};

export function getProfile() {
  const p = load('profile', DEFAULT_PROFILE);
  return {
    values: { ...(p.values || {}) },
    custom: Array.isArray(p.custom) ? p.custom : [],
    courses: Array.isArray(p.courses) ? p.courses : [],
    activeCourseId: p.activeCourseId || ''
  };
}

export function saveProfile(profile) {
  save('profile', profile);
}

/** All fillable fields: built-ins plus user-defined custom fields. */
export function allFields(profile = getProfile()) {
  const custom = profile.custom.map((c) => ({
    key: `custom:${c.id}`,
    label: c.label,
    labels: [c.label.toLowerCase(), ...(c.aliases || [])]
  }));
  return [...PROFILE_FIELDS, ...custom];
}

/* -------------------------------- Courses -------------------------------- */

/** Which profile field each course property fills on a front page. */
export const COURSE_FIELDS = [
  { prop: 'title', key: 'subject', label: 'Course title' },
  { prop: 'code', key: 'subjectCode', label: 'Course code' },
  { prop: 'assignmentNo', key: 'assignmentNo', label: 'Assignment no.' },
  { prop: 'submittedTo', key: 'submittedTo', label: 'Submitted to' }
];

export function activeCourse(profile = getProfile()) {
  return profile.courses.find((c) => c.id === profile.activeCourseId) || null;
}

export function setActiveCourse(id) {
  const profile = getProfile();
  profile.activeCourseId = profile.courses.some((c) => c.id === id) ? id : '';
  saveProfile(profile);
}

const sameText = (a, b) =>
  String(a || '')
    .trim()
    .toLowerCase() ===
  String(b || '')
    .trim()
    .toLowerCase();

export function findCourse({ code, title }, profile = getProfile()) {
  return (
    (code && profile.courses.find((c) => sameText(c.code, code))) ||
    (title && profile.courses.find((c) => sameText(c.title, title))) ||
    null
  );
}

/** Adds or updates a course (matched by code, then title). Returns it. */
export function upsertCourse(data, { makeActive = false } = {}) {
  const profile = getProfile();
  let course = findCourse(data, profile);
  if (course) {
    for (const { prop } of COURSE_FIELDS) {
      if (data[prop]) course[prop] = data[prop];
    }
  } else {
    course = {
      id: uid(),
      title: '',
      code: '',
      assignmentNo: '',
      submittedTo: ''
    };
    for (const { prop } of COURSE_FIELDS) course[prop] = data[prop] || '';
    profile.courses.push(course);
  }
  if (makeActive) profile.activeCourseId = course.id;
  saveProfile(profile);
  return course;
}

/* ------------------- Values approved for this assignment ----------------- */
// e.g. values found in the uploaded question paper. They win over the
// selected course and the profile, but only for the current assignment.

export function getAssignmentValues() {
  return load('assignment-values', {});
}

export function setAssignmentValues(values) {
  save('assignment-values', { ...getAssignmentValues(), ...values });
}

export function clearAssignmentValues(key) {
  if (!key) return save('assignment-values', {});
  const v = getAssignmentValues();
  delete v[key];
  save('assignment-values', v);
}

/**
 * The value written on front pages / headers. Order:
 * this assignment's approved values -> selected course -> profile.
 */
export function fieldValue(key, profile = getProfile()) {
  const override = getAssignmentValues()[key];
  if (override) return override;
  const course = activeCourse(profile);
  const cf = COURSE_FIELDS.find((f) => f.key === key);
  if (course && cf && course[cf.prop]) return course[cf.prop];
  if (key === 'date' && !profile.values.date) {
    return new Date().toLocaleDateString('en-GB');
  }
  if (key.startsWith('custom:')) {
    const c = profile.custom.find((x) => `custom:${x.id}` === key);
    return c ? c.value || '' : '';
  }
  return profile.values[key] || '';
}

/** Short context string for AI prompts (only non-identifying academic info). */
export function academicContext(profile = getProfile()) {
  const v = profile.values;
  return [
    v.course && `Course: ${v.course}`,
    v.branch && `Branch: ${v.branch}`,
    v.semester && `Semester/Year: ${v.semester}`,
    fieldValue('subject', profile) &&
      `Subject: ${fieldValue('subject', profile)}`,
    v.university && `University: ${v.university}`
  ]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------ Profile template (JSON) ----------------------- */

const APP_ID = 'text-to-handwriting-ai';

// Shown in the downloadable template so people know what each field means.
const FIELD_EXAMPLES = {
  name: 'Riya Sharma',
  rollNo: '21CS042',
  enrollmentNo: '2301234567',
  address: 'H.No. 12, Sector 5, Rohini, New Delhi - 110085',
  phone: '9876543210',
  email: 'riya@example.com',
  university: 'Indira Gandhi National Open University',
  college: 'ABC Institute of Technology',
  course: 'Bachelor of Computer Applications',
  programmeCode: 'BCA',
  branch: 'Computer Science',
  semester: '3rd Semester',
  section: 'A',
  session: '2026-27',
  regionalCentre: 'Delhi-1 (07)',
  studyCentre: '0701',
  subject: 'Introduction to Programming in C',
  subjectCode: 'BCS-011',
  submittedTo: 'Dr. R. Sharma',
  assignmentNo: 'BCA(1)/011/Assignment/2026-27',
  assignmentTitle: 'Assignment 1',
  date: '10/10/2026 (leave empty to use today)'
};

/** A fill-in-the-blanks JSON file, pre-filled with the current values. */
export function profileTemplate(profile = getProfile()) {
  const values = {};
  const guide = {};
  for (const f of PROFILE_FIELDS) {
    values[f.key] = profile.values[f.key] || '';
    guide[f.key] = `${f.label}. Example: ${FIELD_EXAMPLES[f.key] || ''}`;
  }
  const custom = profile.custom
    .filter((c) => c.label)
    .map((c) => ({ label: c.label, value: c.value || '' }));
  return {
    app: APP_ID,
    type: 'profile',
    version: 1,
    instructions: [
      'Type your details between the empty quotes in the profile section below.',
      'Example: next to name, type Riya Sharma between the two quotes.',
      'Leave a field empty if it does not apply to you.',
      'Do not rename the field names on the left (name, rollNo and so on).',
      'fieldGuide at the bottom explains every field with an example.',
      'Need something else on your front page? Fill label and value in customFields, e.g. label Lab Batch, value B2.',
      'List each course you write assignments for under courses (title, code, assignmentNo, submittedTo). Add more rows by copying one.',
      'Save the file, then open My Profile and click 3. Import profile.'
    ],
    profile: values,
    courses: profile.courses.length
      ? profile.courses.map(({ title, code, assignmentNo, submittedTo }) => ({
          title: title || '',
          code: code || '',
          assignmentNo: assignmentNo || '',
          submittedTo: submittedTo || ''
        }))
      : [{ title: '', code: '', assignmentNo: '', submittedTo: '' }],
    customFields: custom.length ? custom : [{ label: '', value: '' }],
    fieldGuide: guide
  };
}

const IGNORED_KEYS = new Set([
  'app',
  'type',
  'version',
  'instructions',
  'fieldguide',
  'profile',
  'customfields',
  'courses'
]);

const keyOf = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Applies an imported profile JSON. Accepts the template format, or a flat
 * object of fields. Field names match by key ("rollNo") or label
 * ("Roll number"). Unknown fields become custom fields.
 * Returns { updated, custom, profile }.
 */
export function importProfile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'The file must contain a JSON object like {"profile": {...}}.'
    );
  }
  const source =
    data.profile &&
    typeof data.profile === 'object' &&
    !Array.isArray(data.profile)
      ? data.profile
      : data;

  const byKey = new Map();
  for (const f of PROFILE_FIELDS) {
    byKey.set(keyOf(f.key), f.key);
    byKey.set(keyOf(f.label), f.key);
  }

  const profile = getProfile();
  const extras = [];
  let updated = 0;
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (source === data && IGNORED_KEYS.has(keyOf(rawKey))) continue;
    if (rawValue !== null && typeof rawValue === 'object') continue;
    const value =
      rawValue === null || rawValue === undefined
        ? ''
        : String(rawValue).trim();
    const key = byKey.get(keyOf(rawKey));
    if (key) {
      profile.values[key] = value;
      updated++;
    } else if (value) {
      extras.push({ label: String(rawKey).trim(), value });
    }
  }

  // customFields from the template, plus any unknown fields found above.
  const incoming = [
    ...(Array.isArray(data.customFields) ? data.customFields : []),
    ...extras
  ]
    .filter((c) => c && typeof c === 'object' && String(c.label || '').trim())
    .map((c) => ({
      label: String(c.label).trim(),
      value: String(c.value ?? '').trim()
    }));

  const existing = new Map(profile.custom.map((c) => [keyOf(c.label), c]));
  const toCustom = (c) => {
    const old = existing.get(keyOf(c.label));
    return { id: old ? old.id : uid(), label: c.label, value: c.value };
  };
  if (Array.isArray(data.customFields)) {
    // A full template lists every custom field: it replaces the current set.
    profile.custom = incoming.map(toCustom);
  } else if (extras.length) {
    // A partial file only adds or updates the fields it mentions.
    for (const c of incoming) {
      const old = existing.get(keyOf(c.label));
      if (old) old.value = c.value;
      else profile.custom.push(toCustom(c));
    }
  }

  // Courses: a full template lists every course, so it replaces the list
  // (keeping ids, and the selected course, when the code/title matches).
  let courses = 0;
  if (Array.isArray(data.courses)) {
    const rows = data.courses
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({
        title: String(c.title ?? c.courseTitle ?? '').trim(),
        code: String(c.code ?? c.courseCode ?? '').trim(),
        assignmentNo: String(c.assignmentNo ?? '').trim(),
        submittedTo: String(c.submittedTo ?? '').trim()
      }))
      .filter((c) => c.title || c.code);
    profile.courses = rows.map((c) => {
      const old = findCourse(c, profile);
      return { ...c, id: old ? old.id : uid() };
    });
    if (!profile.courses.some((c) => c.id === profile.activeCourseId)) {
      profile.activeCourseId = '';
    }
    courses = rows.length;
  }

  if (!updated && !incoming.length && !courses) {
    throw new Error(
      'No profile fields found. Use the downloaded template as a starting point.'
    );
  }
  saveProfile(profile);
  return { updated, custom: incoming.length, courses, profile };
}

export function isProfileFile(data) {
  return (
    !!data &&
    typeof data === 'object' &&
    (data.type === 'profile' || 'profile' in data)
  );
}

/* --------------------------------- UI ---------------------------------- */

/** Read-modify-write so concurrent edits (e.g. a course saved from a pop-up) aren't lost. */
function updateProfile(fn) {
  const p = getProfile();
  fn(p);
  saveProfile(p);
  return p;
}

export function renderProfileForm(container, onChange) {
  const changed = () => onChange && onChange();
  const profile = getProfile();
  container.textContent = '';

  const grid = el('div.adv-grid');
  for (const f of PROFILE_FIELDS) {
    const id = `pf-${f.key}`;
    const input = el('input', {
      id,
      type: f.key === 'email' ? 'email' : 'text',
      placeholder: f.key === 'date' ? 'Leave empty to use today' : '',
      autocomplete: 'off'
    });
    input.value = profile.values[f.key] || '';
    input.addEventListener('input', () => {
      updateProfile((p) => (p.values[f.key] = input.value.trim()));
      changed();
    });
    grid.append(
      el('div', {}, [el('label.block', { for: id, text: f.label }), input])
    );
  }
  container.append(grid);

  /* My courses */
  const coursesWrap = el('div.adv-courses');
  const renderCourses = () => {
    coursesWrap.textContent = '';
    const { courses, activeCourseId } = getProfile();
    if (!courses.length) {
      coursesWrap.append(
        el('p.adv-hint', {
          text: 'No courses yet. Add the courses you write assignments for.'
        })
      );
    }
    courses.forEach((c) => {
      const inputs = COURSE_FIELDS.map(({ prop, label }) => {
        const input = el('input', { placeholder: label, 'aria-label': label });
        input.value = c[prop] || '';
        input.addEventListener('input', () => {
          updateProfile((p) => {
            const x = p.courses.find((y) => y.id === c.id);
            if (x) x[prop] = input.value.trim();
          });
          changed();
        });
        return input;
      });
      coursesWrap.append(
        el(
          `div.adv-course-row${c.id === activeCourseId ? '.active' : ''}`,
          {},
          [
            ...inputs,
            el('button.adv-icon-btn', {
              type: 'button',
              text: '×',
              title: 'Remove course',
              'aria-label': `Remove course ${c.title || c.code}`,
              onclick: () => {
                updateProfile((p) => {
                  p.courses = p.courses.filter((y) => y.id !== c.id);
                  if (p.activeCourseId === c.id) p.activeCourseId = '';
                });
                renderCourses();
                changed();
              }
            })
          ]
        )
      );
    });
  };
  renderCourses();

  container.append(
    el('h4', { text: 'My courses' }),
    el('p.adv-hint', {
      text:
        'Pick a course in Step 2 (Front page) and its title, code, assignment no. and teacher fill the front page automatically.'
    }),
    el('div.adv-course-row.adv-course-head', {}, [
      ...COURSE_FIELDS.map(({ label }) => el('small', { text: label })),
      el('span')
    ]),
    coursesWrap,
    el('button', {
      type: 'button',
      text: '+ Add course',
      onclick: () => {
        updateProfile((p) =>
          p.courses.push({
            id: uid(),
            title: '',
            code: '',
            assignmentNo: '',
            submittedTo: ''
          })
        );
        renderCourses();
        changed();
      }
    })
  );

  /* Custom fields */
  const customWrap = el('div.adv-custom-fields');
  const renderCustom = () => {
    customWrap.textContent = '';
    getProfile().custom.forEach((c) => {
      const label = el('input', {
        placeholder: 'Field label (e.g. Lab Batch)'
      });
      label.value = c.label;
      const value = el('input', { placeholder: 'Value' });
      value.value = c.value || '';
      const persist = () => {
        updateProfile((p) => {
          const x = p.custom.find((y) => y.id === c.id);
          if (x) {
            x.label = label.value.trim();
            x.value = value.value.trim();
          }
        });
        changed();
      };
      label.addEventListener('input', persist);
      value.addEventListener('input', persist);
      customWrap.append(
        el('div.adv-row', {}, [
          label,
          value,
          el('button.adv-icon-btn', {
            type: 'button',
            title: 'Remove field',
            'aria-label': 'Remove custom field',
            text: '×',
            onclick: () => {
              updateProfile(
                (p) => (p.custom = p.custom.filter((y) => y.id !== c.id))
              );
              renderCustom();
              changed();
            }
          })
        ])
      );
    });
  };
  renderCustom();

  container.append(
    el('h4', { text: 'Custom fields' }),
    el('p.adv-hint', {
      text:
        'Add anything else your front pages ask for. The label is what we look for on the page.'
    }),
    customWrap,
    el('button', {
      type: 'button',
      text: '+ Add custom field',
      onclick: () => {
        updateProfile((p) =>
          p.custom.push({ id: uid(), label: '', value: '' })
        );
        renderCustom();
      }
    })
  );
}
