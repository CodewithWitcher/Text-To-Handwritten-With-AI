/**
 * Assessment templates: how a document is structured (title block, how each
 * question is headed, answer label) and how answers are written (length,
 * structure, tone). Built-ins are read-only; users can duplicate and edit.
 *
 * Content flowing between steps uses a tiny Markdown subset that the
 * renderer understands:
 *   # Title      ## Heading      ### Sub-heading
 *   - bullet     1. numbered     **underlined emphasis**
 *   ---          (page break)    blank line = new paragraph
 */
import { load, save } from './store.mjs';
import { uid } from './ui.mjs';

export const BUILTIN_TEMPLATES = [
  {
    id: 'qa-standard',
    name: 'University assignment (Q&A)',
    description:
      'Each question as a heading, then "Ans." and a structured answer. Length scales with marks.',
    kind: 'qa',
    titleBlock: true,
    questionFormat: 'Q{n}. {question}',
    showMarks: true,
    answerLabel: 'Ans.',
    wordsPerMark: 45,
    defaultWords: 250,
    minWords: 60,
    maxWords: 1200,
    instructions:
      'Write like a strong university student answering in an exam-style assignment. ' +
      'Start with a one or two line definition or direct answer, then explain with ' +
      'sub-headings and bullet points where they help, give an example if relevant, ' +
      'and finish with a short conclusion for longer answers.'
  },
  {
    id: 'qa-short',
    name: 'Short answers',
    description:
      'Concise, to-the-point answers. Good for 2–5 mark questions and class tests.',
    kind: 'qa',
    titleBlock: true,
    questionFormat: 'Q{n}. {question}',
    showMarks: true,
    answerLabel: 'Ans.',
    wordsPerMark: 30,
    defaultWords: 120,
    minWords: 40,
    maxWords: 300,
    instructions:
      'Answer directly and concisely. Use at most one sub-heading. Prefer 2–5 short ' +
      'bullet points or a compact paragraph. No filler.'
  },
  {
    id: 'qa-detailed',
    name: 'Detailed / long answers',
    description:
      'Introduction, explained body with sub-headings, examples, advantages/disadvantages, conclusion.',
    kind: 'qa',
    titleBlock: true,
    questionFormat: 'Q{n}. {question}',
    showMarks: true,
    answerLabel: 'Ans.',
    wordsPerMark: 60,
    defaultWords: 500,
    minWords: 200,
    maxWords: 1800,
    instructions:
      'Write a thorough answer: an "Introduction" sub-heading, then 2–4 explanatory ' +
      'sub-headings (working, features, types, examples, advantages/disadvantages ' +
      'as relevant), then a "Conclusion" sub-heading.'
  },
  {
    id: 'essay',
    name: 'Essay / article',
    description:
      'Continuous prose with a title, introduction, themed sections and conclusion. Questions become topics.',
    kind: 'essay',
    titleBlock: true,
    questionFormat: '{question}',
    showMarks: false,
    answerLabel: '',
    wordsPerMark: 60,
    defaultWords: 700,
    minWords: 300,
    maxWords: 2500,
    instructions:
      'Write an essay/article in flowing paragraphs. Use a few descriptive ' +
      'sub-headings for sections. Avoid bullet lists unless essential. Keep a ' +
      'formal, engaging tone with a clear introduction and conclusion.'
  },
  {
    id: 'lab-report',
    name: 'Lab report / practical',
    description:
      'Aim, Apparatus/Requirements, Theory, Procedure, Observations, Result, Conclusion.',
    kind: 'qa',
    titleBlock: true,
    questionFormat: 'Experiment {n}: {question}',
    showMarks: false,
    answerLabel: '',
    wordsPerMark: 50,
    defaultWords: 450,
    minWords: 200,
    maxWords: 1500,
    instructions:
      'Write a practical/lab record using these sub-headings in order: Aim, ' +
      'Apparatus / Requirements, Theory, Procedure (numbered steps), Observations, ' +
      'Result, Conclusion. Describe tables or diagrams in words since this will be ' +
      'handwritten.'
  },
  {
    id: 'case-study',
    name: 'Case study',
    description: 'Background, problem, analysis, solutions and recommendation.',
    kind: 'qa',
    titleBlock: true,
    questionFormat: 'Q{n}. {question}',
    showMarks: true,
    answerLabel: 'Ans.',
    wordsPerMark: 55,
    defaultWords: 600,
    minWords: 250,
    maxWords: 1800,
    instructions:
      'Answer as a case analysis with sub-headings: Background, Problem ' +
      'Identification, Analysis, Possible Solutions, Recommendation and Conclusion.'
  }
];

export function customTemplates() {
  return load('templates', []);
}

export function saveCustomTemplates(list) {
  save('templates', list);
}

export function allTemplates() {
  return [...BUILTIN_TEMPLATES, ...customTemplates()];
}

export function getTemplate(id) {
  return allTemplates().find((t) => t.id === id) || BUILTIN_TEMPLATES[0];
}

export function duplicateTemplate(id) {
  const base = getTemplate(id);
  const copy = {
    ...base,
    id: `custom-${uid()}`,
    name: `${base.name} (copy)`,
    custom: true
  };
  const list = customTemplates();
  list.push(copy);
  saveCustomTemplates(list);
  return copy;
}

/* ------------------------------ Word targets ----------------------------- */

export function targetWords(question, template) {
  if (question.wordLimit) return Number(question.wordLimit);
  const marks = parseFloat(question.marks);
  const words =
    marks > 0 ? marks * template.wordsPerMark : template.defaultWords;
  return (
    Math.round(
      Math.min(template.maxWords, Math.max(template.minWords, words)) / 10
    ) * 10
  );
}

/* -------------------------------- Prompts -------------------------------- */

const FORMAT_RULES = `Formatting rules (the text will be converted to handwriting on ruled paper):
- Use only this markup: "### " for sub-headings, "- " for bullets, "1. " for numbered steps, **text** for a few key terms, blank lines between paragraphs.
- Do NOT use "#" or "##" headings, tables, code blocks, LaTeX, emojis or images. Write formulas in plain text (e.g. "v = u + at", "x^2").
- If a diagram or table would normally be drawn, describe it briefly in words instead.
- Do not repeat the question. Do not add a preamble like "Here is the answer" or any closing remarks.`;

export function answerSystemPrompt(template) {
  return `You write answers for academic assessments that will be rendered as neat handwritten pages.
${template.instructions}

${FORMAT_RULES}`;
}

export function answerUserPrompt({ question, template, context, docInfo }) {
  const words = targetWords(question, template);
  return [
    docInfo.title && `Assessment: ${docInfo.title}`,
    docInfo.subject && `Subject: ${docInfo.subject}`,
    context && `Student context:\n${context}`,
    docInfo.instructions &&
      `General instructions from the paper:\n${docInfo.instructions}`,
    '',
    `Question ${question.number || ''}${
      question.marks ? ` (${question.marks} marks)` : ''
    }:`,
    question.text,
    '',
    `Write the answer in about ${words} words.`
  ]
    .filter((x) => x !== undefined && x !== null && x !== false)
    .join('\n');
}

export const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subject: { type: 'string' },
    courseCode: { type: 'string' },
    assignmentNo: { type: 'string' },
    programmeCode: { type: 'string' },
    instructions: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'string' },
          text: { type: 'string' },
          marks: { type: 'string' },
          wordLimit: { type: 'string' }
        },
        required: ['number', 'text', 'marks', 'wordLimit'],
        additionalProperties: false
      }
    }
  },
  required: [
    'title',
    'subject',
    'courseCode',
    'assignmentNo',
    'programmeCode',
    'instructions',
    'questions'
  ],
  additionalProperties: false
};

export const EXTRACT_SYSTEM = `You extract every question from an assessment / assignment / question paper.
Return JSON with keys: title, subject, courseCode, assignmentNo, programmeCode, instructions, questions.
- title: the assessment title if present, else "".
- subject: the subject/course name (course title) if present, else "".
- courseCode: the course/subject/paper code exactly as printed (e.g. "BCS-011"), else "".
- assignmentNo: the assignment number/code exactly as printed (e.g. "BCA(1)/011/Assignment/2024-25"), else "".
- programmeCode: the programme/degree code (e.g. "BCA"), else "".
- instructions: general instructions for students (word limits, "attempt any five", formatting), else "".
- questions: in order. For each: number (as printed, e.g. "1", "2(a)", "Q3"), text (the full question verbatim including its sub-parts, OR-choices and any data it gives; keep sub-parts on separate lines), marks (e.g. "10" or ""), wordLimit (e.g. "500" or "").
Do not answer the questions. Do not invent questions. Merge a question that continues across a page break into one item.`;

/**
 * Prompt the user can paste into ChatGPT / Claude.ai / DeepSeek chat when they
 * don't want to use an API key. The response is pasted back and split on the
 * === ANSWER n === markers.
 */
export function bulkCopyPrompt({ questions, template, context, docInfo }) {
  const blocks = questions
    .map(
      (q, i) =>
        `=== QUESTION ${i + 1} ===${
          q.marks ? ` (${q.marks} marks)` : ''
        } [about ${targetWords(q, template)} words]\n${q.text}`
    )
    .join('\n\n');
  return `${answerSystemPrompt(template)}

${[
  docInfo.title && `Assessment: ${docInfo.title}`,
  docInfo.subject && `Subject: ${docInfo.subject}`,
  context,
  docInfo.instructions && `Instructions: ${docInfo.instructions}`
]
  .filter(Boolean)
  .join('\n')}

Answer each question below. Start every answer with a marker line exactly like "=== ANSWER 1 ===" (matching the question number), then the answer. Output nothing else.

${blocks}`;
}

export function parseBulkAnswers(text, count) {
  const out = new Array(count).fill('');
  const re = /^\s*=+\s*ANSWER\s+(\d+)\s*=+\s*$/gim;
  const marks = [];
  let m;
  while ((m = re.exec(text)))
    marks.push({ n: Number(m[1]), start: m.index, end: re.lastIndex });
  marks.forEach((mk, i) => {
    const next = marks[i + 1] ? marks[i + 1].start : text.length;
    if (mk.n >= 1 && mk.n <= count)
      out[mk.n - 1] = text.slice(mk.end, next).trim();
  });
  return out;
}

/* -------------------------- Compose the document ------------------------- */

/** Demotes any #/## the AI or user used inside an answer to ### sub-headings. */
function normalizeAnswer(md) {
  return String(md || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\s*#{1,3}\s+/gm, '### ')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .trim();
}

export function composeDocument({
  template,
  questions,
  answers,
  docInfo,
  options = {}
}) {
  const lines = [];
  if (template.titleBlock) {
    const title =
      docInfo.title || (template.kind === 'essay' ? '' : 'Assignment');
    if (title) lines.push(`# ${title}`);
    if (docInfo.subject && options.subjectLine !== false)
      lines.push(`### Subject: ${docInfo.subject}`);
    lines.push('');
  }
  questions.forEach((q, i) => {
    const n = q.number
      ? String(q.number).replace(/^Q\.?\s*/i, '')
      : String(i + 1);
    let qText = String(q.text || '')
      .trim()
      .replace(/\n+/g, ' ');
    // "(10 marks)" at the end of the question is shown once, as [10 marks].
    if (template.showMarks && q.marks) {
      qText = qText
        .replace(/\s*[[(]\s*\d+(?:\.\d+)?\s*marks?\s*[\])]\s*$/i, '')
        .trim();
    }
    let heading = template.questionFormat
      .replace('{n}', n)
      .replace('{question}', qText);
    if (template.showMarks && q.marks) heading += ` [${q.marks} marks]`;
    lines.push(`## ${heading}`);
    if (template.answerLabel) lines.push(`**${template.answerLabel}**`);
    lines.push(normalizeAnswer(answers[q.id]) || '(answer pending)');
    lines.push('');
    if (options.pageBreakBetween && i < questions.length - 1) lines.push('---');
  });
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
