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
    labels: ['name of the student', 'name of student', 'student name', 'student s name', 'submitted by', 'name']
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
      'enrollment number', 'enrolment number', 'enrollment no', 'enrolment no', 'enrollment', 'enrolment',
      'registration number', 'registration no', 'registration', 'reg no',
      'student id', 'id no', 'prn', 'usn', 'uid', 'admission no'
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
    labels: ['phone number', 'phone no', 'mobile number', 'mobile no', 'contact number', 'contact no', 'phone', 'mobile', 'contact']
  },
  {
    key: 'email',
    label: 'Email',
    labels: ['e mail id', 'email id', 'e mail', 'email']
  },
  {
    key: 'university',
    label: 'University',
    labels: ['name of the university', 'name of university', 'university name', 'university']
  },
  {
    key: 'college',
    label: 'College / Institute',
    labels: ['name of the college', 'name of college', 'name of the institute', 'college name', 'institute name', 'college', 'institute', 'school']
  },
  {
    key: 'course',
    label: 'Programme / Course',
    labels: ['name of the programme', 'name of the program', 'programme name', 'program name', 'programme', 'program', 'degree', 'course', 'class']
  },
  {
    key: 'programmeCode',
    label: 'Programme code',
    labels: ['programme code', 'program code']
  },
  {
    key: 'branch',
    label: 'Branch / Department',
    labels: ['department', 'branch', 'dept', 'stream', 'specialization', 'specialisation']
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
    labels: ['regional centre code', 'regional center code', 'regional centre', 'regional center']
  },
  {
    key: 'studyCentre',
    label: 'Study centre',
    labels: ['study centre code', 'study center code', 'study centre', 'study center']
  },
  {
    key: 'subject',
    label: 'Subject / Course title',
    labels: ['subject name', 'name of subject', 'name of the course', 'course title', 'course tittle', 'course name', 'paper name', 'subject']
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
      'submitted to', 'faculty name', 'name of the faculty', 'name of faculty', 'name of the teacher', 'faculty',
      'teacher', 'instructor', 'professor', 'guided by', 'guide', 'supervisor'
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

const DEFAULT_PROFILE = { values: {}, custom: [] };

export function getProfile() {
  const p = load('profile', DEFAULT_PROFILE);
  return {
    values: { ...(p.values || {}) },
    custom: Array.isArray(p.custom) ? p.custom : []
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

export function fieldValue(key, profile = getProfile()) {
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
    v.subject && `Subject: ${v.subject}`,
    v.university && `University: ${v.university}`
  ]
    .filter(Boolean)
    .join('\n');
}

/* --------------------------------- UI ---------------------------------- */

export function renderProfileForm(container, onChange) {
  const profile = getProfile();
  container.textContent = '';

  const grid = el('div.adv-grid');
  for (const f of PROFILE_FIELDS) {
    const id = `pf-${f.key}`;
    const input = el('input', {
      id,
      type: f.key === 'date' ? 'text' : f.key === 'email' ? 'email' : 'text',
      placeholder: f.key === 'date' ? 'Leave empty to use today' : '',
      autocomplete: 'off'
    });
    input.value = profile.values[f.key] || '';
    input.addEventListener('input', () => {
      profile.values[f.key] = input.value.trim();
      saveProfile(profile);
      onChange && onChange();
    });
    grid.append(el('div', {}, [el('label.block', { for: id, text: f.label }), input]));
  }
  container.append(grid);

  const customWrap = el('div.adv-custom-fields');
  const renderCustom = () => {
    customWrap.textContent = '';
    profile.custom.forEach((c, idx) => {
      const label = el('input', { placeholder: 'Field label (e.g. Lab Batch)' });
      label.value = c.label;
      const value = el('input', { placeholder: 'Value' });
      value.value = c.value || '';
      const persist = () => {
        c.label = label.value.trim();
        c.value = value.value.trim();
        saveProfile(profile);
        onChange && onChange();
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
              profile.custom.splice(idx, 1);
              saveProfile(profile);
              renderCustom();
              onChange && onChange();
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
      text: 'Add anything else your front pages ask for. The label is what we look for on the page.'
    }),
    customWrap,
    el('button', {
      type: 'button',
      text: '+ Add custom field',
      onclick: () => {
        profile.custom.push({ id: uid(), label: '', value: '' });
        saveProfile(profile);
        renderCustom();
      }
    })
  );
}
