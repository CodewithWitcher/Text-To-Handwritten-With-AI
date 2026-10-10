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

/**
 * The question as the AI should see it: a sub-question carries its parent's
 * text ("Solve the following...") so it makes sense on its own.
 */
export function questionForPrompt(q, { forAnswer = true } = {}) {
  if (!q.group) return q.text;
  return [
    q.stem && `Main question ${q.groupNumber}: ${q.stem}`,
    `Part ${q.label}: ${q.text}`,
    forAnswer && `Answer only part ${q.label}.`
  ]
    .filter(Boolean)
    .join('\n');
}

// "[diagram: caption]" lines the AI puts in answers (see FORMAT_RULES).
const DIAGRAM_LINE_RE = /^\[(?:diagram|figure|fig)\s*:?\s*([^|\]]*?)\s*(?:\|\s*\d{1,2}\s*)?\]$/gim;

/** The diagrams an answer asks for: [{ caption, index }]. */
export function answerDiagrams(answer) {
  return [...String(answer || '').matchAll(DIAGRAM_LINE_RE)].map((m, i) => ({
    caption: m[1] || 'Diagram',
    index: i
  }));
}

/** Replaces the n-th "[diagram: ...]" line of an answer. */
export function replaceDiagramLine(answer, index, replacement) {
  let n = -1;
  return String(answer || '').replace(DIAGRAM_LINE_RE, (line) =>
    ++n === index ? replacement : line
  );
}

/**
 * Prompt for an image-making AI (Gemini, ChatGPT...) to draw one diagram
 * from an answer, in a style that sits well on a handwritten page.
 */
export function diagramPrompt({
  question,
  answer,
  index,
  caption,
  docInfo,
  ink,
  withFigure = false
}) {
  // The answer text around the diagram, so the labels match what's written.
  const marked = replaceDiagramLine(answer, index, '>>> THE DIAGRAM GOES HERE <<<')
    .replace(DIAGRAM_LINE_RE, '')
    .trim();
  const at = Math.max(0, marked.indexOf('>>> THE DIAGRAM'));
  const context = marked
    .slice(Math.max(0, at - 1500), at + 1500)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const figure = withFigure
    ? '\nThe figure from the question paper is attached: take the data (names, values, edges...) from it.\n'
    : '';
  return `Create an image: a diagram for a university assignment answer.

Diagram: ${caption}
${docInfo.subject ? `Subject: ${docInfo.subject}\n` : ''}Question: ${questionForPrompt(question, { forAnswer: false })}
${figure}
The answer around the diagram (use the same names, values and labels):
---
${context}
---

Requirements:
- A clear, simple, correctly labelled diagram of exactly "${caption}", as a student would draw it in an exam answer.
- Looks hand-drawn with a ${ink} pen on plain white paper: thin lines, neat handwritten labels, no colours or shading, no 3D.
- Plain white background, landscape layout, everything inside the frame with a small margin.
- Only the labels the diagram needs: no title, caption, watermark or extra text (the caption is written under it separately).
- Every label, number and arrow must be correct and readable.`;
}

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
- If a diagram, flowchart or figure is really needed, put it on a line of its own as [diagram: short caption], e.g. "[diagram: Recursion tree for T(n) = 2T(n/2) + n]". Blank space is left there for the student to draw it by hand. Also explain what it shows in the text. At most two per answer.
- Tables: write them as short bullet lists instead.
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
    questionForPrompt(question),
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
Do not answer the questions. Do not invent questions. Merge a question that continues across a page break into one item.
Formulas: write them in plain linear text, e.g. "T(n) = 16T(n/4) + n^2", "x_1", "sqrt(b^2 - 4ac)". Text taken from PDFs often garbles equations into stray symbols (e.g. "16T * ! \" + + n #" for "16T(n/4) + n^2"): read the formula from the page if you can see it; otherwise reconstruct it only when the pattern makes it certain, and if not, keep the text and add " [check formula in paper]".
Figures: if a question shows a diagram, graph, table or figure, keep the question text and add a short description in square brackets, e.g. "[Figure: binary tree with root 50, left child 30, right child 70]".`;

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
        } [about ${targetWords(q, template)} words]\n${questionForPrompt(q)}${
          (q.figures || []).length
            ? '\n[This question has a figure that is not included in this prompt.]'
            : ''
        }`
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

/** Prompt for one question, for pasting into a chatbot. */
export function singleCopyPrompt({ question, template, context, docInfo }) {
  const figures = (question.figures || []).length;
  return `${answerSystemPrompt(template)}

${answerUserPrompt({ question, template, context, docInfo })}${
    figures
      ? `\n\nThe figure${
          figures > 1 ? 's' : ''
        } from the question paper ${
          figures > 1 ? 'are' : 'is'
        } attached as an image. Use it to answer.`
      : ''
  }

Reply with only the answer text, nothing before or after it.`;
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

// A sub-part at the start of a line: (a) a) a. (iv) iv) and OCR's "¢" for c.
const SUBPART_START_RE = /^\(?(?:[a-h]|[ivx]{1,4}|¢)[).]\s/i;
// The same inside a line; only the "(a)" / "a)" forms, "a." is too common.
const SUBPART_INLINE_RE = /(^|\s)\(?([a-h]|[ivx]{1,4})\)\s/gi;

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
function subpartIndex(label) {
  const l = label.toLowerCase();
  const r = ROMAN.indexOf(l);
  // "i" could be a letter or a roman one; the sequence decides below.
  return { letter: l.length === 1 ? l.charCodeAt(0) - 97 : -1, roman: r };
}

/** "... (a) xx (b) yy" on one line -> one line per sub-part. */
function splitInlineSubparts(line) {
  const marks = [...line.matchAll(SUBPART_INLINE_RE)].map((m) => ({
    at: m.index + m[1].length,
    ...subpartIndex(m[2])
  }));
  // Keep only markers that count up from (a) or (i): (a)(b)(c) / (i)(ii).
  for (const kind of ['letter', 'roman']) {
    const seq = [];
    for (const m of marks) if (m[kind] === seq.length) seq.push(m);
    if (seq.length >= 2) {
      const parts = [];
      let from = 0;
      for (const m of seq) {
        if (m.at > from) parts.push(line.slice(from, m.at).trim());
        from = m.at;
      }
      parts.push(line.slice(from).trim());
      return parts.filter(Boolean);
    }
  }
  return [line];
}

/**
 * A question as lines: the question itself, then one line per sub-part
 * ((a), (b), (i)...). Other line breaks (PDF wrapping) are joined back.
 */
export function questionLines(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (!out.length || SUBPART_START_RE.test(line)) out.push(line);
    else out[out.length - 1] += ` ${line}`;
  }
  return out.flatMap(splitInlineSubparts);
}

const MARKS_END_RE = /\s*[[(]\s*(\d+(?:\.\d+)?)\s*marks?\s*[\])]\s*$/i;
const PART_RE = /^\(?((?:[a-h]|[ivx]{1,4}|¢))[).]\s*(.*)$/i;
// "2(a)", "2 a", "Q2(b)", "2.b": a sub-question numbered on its own.
const PART_NUMBER_RE = /^(?:Q\.?\s*)?(\d{1,2})\s*[.(]?\s*([a-h]|[ivx]{1,4})\)?$/i;

const round1 = (x) => String(Math.round(x * 10) / 10);

/**
 * Turns a question with sub-parts ((a), (b)... or (i), (ii)...) into one
 * question per part, so each part gets its own answer. Parts keep a link to
 * the main question (group, stem) for the page layout and the AI prompt.
 * Parts without their own marks share what's left of the question's marks.
 */
export function splitSubQuestions(questions) {
  const out = [];
  questions.forEach((q, qi) => {
    if (q.group) return out.push(q);
    const base = String(q.number || qi + 1)
      .replace(/^Q\.?\s*/i, '')
      .trim();
    // The AI may already list parts separately ("2(a)", "2(b)").
    const numbered = PART_NUMBER_RE.exec(base);
    if (numbered) {
      const label = `(${numbered[2].toLowerCase()})`;
      return out.push({
        ...q,
        group: `n${numbered[1]}`,
        groupNumber: numbered[1],
        stem: '',
        label
      });
    }
    const lines = questionLines(q.text);
    const firstIsPart = PART_RE.test(lines[0] || '');
    const partLines = firstIsPart ? lines : lines.slice(1);
    const parts = partLines.map((l) => PART_RE.exec(l));
    if (parts.length < 2 || parts.some((p) => !p)) return out.push(q);

    let stem = firstIsPart ? '' : lines[0];
    const stemMarks = MARKS_END_RE.exec(stem);
    if (stemMarks) stem = stem.slice(0, stemMarks.index).trim();
    const subs = parts.map((p) => {
      let text = p[2].trim();
      let marks = '';
      const m = MARKS_END_RE.exec(text);
      if (m) {
        marks = m[1];
        text = text.slice(0, m.index).trim();
      }
      return { label: `(${p[1].replace('¢', 'c').toLowerCase()})`, text, marks };
    });
    const total = parseFloat(q.marks) || 0;
    // "(c) ... (10 Marks)" where 10 is the whole question's total: not (c)'s.
    const last = subs[subs.length - 1];
    if (
      last.marks &&
      parseFloat(last.marks) === total &&
      subs.slice(0, -1).every((x) => !x.marks)
    )
      last.marks = '';
    const known = subs.reduce((n, s) => n + (parseFloat(s.marks) || 0), 0);
    const missing = subs.filter((s) => !s.marks).length;
    const share = missing && total > known ? round1((total - known) / missing) : '';
    const words = parseFloat(q.wordLimit) || 0;
    subs.forEach((s, i) =>
      out.push({
        id: `${q.id}-${i}`,
        number: `${base}${s.label}`,
        text: s.text,
        marks: s.marks || share,
        // Shared-out marks guide the answer length but aren't printed.
        marksShared: !s.marks,
        wordLimit: words ? round1(Math.round(words / subs.length)) : '',
        figures: i === 0 ? q.figures : undefined,
        group: q.id,
        groupNumber: base,
        groupMarks: q.marks || '',
        stem,
        label: s.label
      })
    );
  });
  return out;
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
    const sameGroupNext =
      q.group && questions[i + 1] && questions[i + 1].group === q.group;
    if (q.group) {
      // Q1. <main question> once, then "(a) <part>", its answer, "(b)"...
      if (!i || questions[i - 1].group !== q.group) {
        let head = template.questionFormat
          .replace('{n}', q.groupNumber)
          .replace('{question}', q.stem || '')
          .trim();
        if (template.showMarks && q.groupMarks)
          head += ` [${q.groupMarks} marks]`;
        if (head) lines.push(`## ${head}`);
      }
      const partLines = questionLines(q.text);
      if (!partLines.length) partLines.push('');
      partLines[0] = `${q.label} ${partLines[0]}`.trim();
      if (
        template.showMarks &&
        q.marks &&
        !q.marksShared &&
        q.marks !== q.groupMarks
      )
        partLines[partLines.length - 1] += ` [${q.marks} marks]`;
      for (const l of partLines) lines.push(`## ${l}`);
      for (const id of q.figures || []) lines.push(`[image: ${id}]`);
      if (template.answerLabel) lines.push(`**${template.answerLabel}**`);
      lines.push(normalizeAnswer(answers[q.id]) || '(answer pending)');
      lines.push('');
      if (options.pageBreakBetween && i < questions.length - 1 && !sameGroupNext)
        lines.push('---');
      return;
    }
    const n = q.number
      ? String(q.number).replace(/^Q\.?\s*/i, '')
      : String(i + 1);
    const qLines = questionLines(q.text);
    if (!qLines.length) qLines.push('');
    // "(10 marks)" at the end of the question is shown once, as [10 marks].
    // A sub-part's own marks ("(b) ... (3 Marks)") stay where they are.
    if (template.showMarks && q.marks) {
      const last = qLines.length - 1;
      const m = /\s*[[(]\s*(\d+(?:\.\d+)?)\s*marks?\s*[\])]\s*$/i.exec(
        qLines[last]
      );
      if (m && (qLines.length === 1 || Number(m[1]) === Number(q.marks)))
        qLines[last] = qLines[last].slice(0, m.index).trim();
    }
    qLines[0] = template.questionFormat
      .replace('{n}', n)
      .replace('{question}', qLines[0]);
    if (template.showMarks && q.marks)
      qLines[qLines.length - 1] += ` [${q.marks} marks]`;
    // Each sub-part on its own line (consecutive "##" lines stay together).
    for (const l of qLines) lines.push(`## ${l}`);
    // Figures from the question paper, right under the question.
    for (const id of q.figures || []) lines.push(`[image: ${id}]`);
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
