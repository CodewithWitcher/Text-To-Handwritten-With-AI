/**
 * Finding the questions in an assessment.
 *  - extractWithAI: sends the paper (PDF for Claude, text for others) and gets
 *    structured questions back. Long papers are split into chunks.
 *  - extractBasic: rule-based parser for numbered questions, no AI needed.
 */
import { completeJSON, AIError } from './llm.mjs';
import { EXTRACT_SYSTEM, QUESTIONS_SCHEMA } from './templates.mjs';
import { uid } from './ui.mjs';

const CHUNK_CHARS = 60000;

const WORDS_RE = /(?:in\s+)?(?:about|around|approx\.?|max(?:imum)?\.?|not more than|within)?\s*(\d{2,4})\s*words/i;

// "Q1:", "Q.1", "Question 1", "Q1)".
const EXPLICIT_Q_RE = /^\s*Q(?:uestion|ues|n)?\s*\.?\s*(?:No\.?\s*)?(\d{1,2})\s*(?:[:.)\-–]|\s|$)\s*(.*)$/i;
// OCR misreads in scans: "QI:", "Ql:", "QI12:", "QI5:", "Qs:" (1->I/l/|, 5->s,
// 0->O). Only trusted with a ":" "." or ")" after it.
const OCR_Q_RE = /^\s*Q(?:uestion|ues)?\s*\.?\s*([0-9IlOoSs|]{1,3})\s*[:.)]\s*(.*)$/;
const SECTION_RE = /^\s*section\s*[-–:]?\s*([0-9A-Z]{1,3})\b/i;
const EQUAL_MARKS_RE = /(?:carry|carries)\s+equal\s+marks[^\d]{0,25}(\d+(?:\.\d+)?)\s*marks?|each\s+question\s+carries\s+(\d+(?:\.\d+)?)\s*marks?/i;
// "1.", "1)", "1 What..." (used only when a paper has no Q markers).
const NUMBERED_RE = /^\s*(\d{1,2})\s*(?:[.):\-–]|\s(?=[A-Z(]))\s*(.*)$/;
// Sub-parts: (a) a) (i) (1) a. - and OCR's "¢" for c.
const SUBPART_RE = /^\s*(?:\(\s*(?:[a-h]|[ivx]{1,4}|\d{1,2}|¢)\s*\)|(?:[a-h]|[ivx]{1,4}|¢)\s*[.)])\s*/i;
// Lines that open a course section in a booklet ("Course Code : MCS-211").
const HEADER_RE = /^\s*(course\s*code|course\s*title|assignment\s*(number|no)|maximum\s*marks|weightage|last\s*dates?\s*(of|for)\s*submission)\b/i;
const MARK_NUM_RE = /(\d+(?:\.\d+)?)\s*marks?\b/gi;

/**
 * Marks for a question: a total in the first line wins ("Q3: (3*4= 12 Marks)"),
 * otherwise the sub-part marks are added up ("(a) ... (15 Marks)" ...).
 */
function computeMarks(text, headText = String(text).split('\n')[0]) {
  const head = [...String(headText).matchAll(MARK_NUM_RE)];
  if (head.length) return head[head.length - 1][1];
  const all = [...String(text).matchAll(MARK_NUM_RE)].map((m) => Number(m[1]));
  if (!all.length) return '';
  const total = all.reduce((a, b) => a + b, 0);
  return String(Math.round(total * 100) / 100);
}

// Leftovers of an equation the PDF didn't store as text: runs of the
// placeholder characters Cambria Math uses for fractions and powers,
// e.g. "16T * ! \" + + n #" for "16T(n/4) + n^2".
// Needs 4+ lone symbols in a row so normal text ("C++ / C#", "3 * 4",
// "Q1: (3*4= 12 Marks)") never matches.
const GARBLED_MATH_RE = /(?:^|\s)[!"#$*+](?:\s+[!"#$*+]){3,}(?=\s|$)/;

/** The garbled fragment (with a little context), or '' if none. */
export function garbledMath(text) {
  const t = String(text || '');
  const m = GARBLED_MATH_RE.exec(t);
  if (!m) return '';
  const from = Math.max(0, t.lastIndexOf(' ', Math.max(0, m.index - 12)));
  return t.slice(from, m.index + m[0].length + 6).trim();
}

export const hasGarbledMath = (text) => !!garbledMath(text);

function normalizeQuestion(q, i) {
  const text = String(q.text || '').trim();
  const marks =
    String(q.marks || '').trim() ||
    computeMarks(text, q.head !== undefined ? q.head : undefined);
  const wordLimit =
    String(q.wordLimit || '').trim() || (WORDS_RE.exec(text) || [])[1] || '';
  return {
    id: uid(),
    number: String(q.number || i + 1).trim(),
    text,
    marks: marks.replace(/[^\d.]/g, ''),
    wordLimit: wordLimit.replace(/[^\d]/g, '')
  };
}

/** Possible question numbers for a (possibly OCR-garbled) token. */
function numberCandidates(token) {
  const map = (t) =>
    t.replace(/[Il|]/g, '1').replace(/[Oo]/g, '0').replace(/[Ss]/g, '5');
  const out = new Set([Number(map(token))]);
  // A stray leading I/l/| is often noise: "QI12" is Q12.
  if (/^[Il|]./.test(token)) out.add(Number(map(token.slice(1))));
  return [...out].filter((n) => Number.isFinite(n) && n > 0);
}

/** Matches a question-start line; returns { n, rest } or null. */
function matchQuestion(line, explicit, last) {
  const fits = (n) => n > last && n <= last + 3;
  if (explicit) {
    let m = EXPLICIT_Q_RE.exec(line);
    if (m && fits(Number(m[1]))) return { n: Number(m[1]), rest: m[2] };
    m = OCR_Q_RE.exec(line);
    if (m) {
      const n = numberCandidates(m[1]).find(fits);
      if (n) return { n, rest: m[2] };
    }
    return null;
  }
  const m = NUMBERED_RE.exec(line);
  return m && fits(Number(m[1])) ? { n: Number(m[1]), rest: m[2] } : null;
}

/**
 * Rule-based question finder (no AI).
 * - If the paper uses explicit markers (Q1:, Question 2) only those start
 *   questions, so numbered notes/instructions/sub-parts are never mistaken
 *   for questions (IGNOU papers have numbered "Important Notes").
 * - Otherwise numbered lines (1., 2) ...) are used, starting after the
 *   course header block when there is one.
 */
export function extractBasic(rawText) {
  const lines = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  const explicit = lines.some((l) => EXPLICIT_Q_RE.test(l) || OCR_Q_RE.test(l));
  // Questions start after the last header line that precedes them.
  let start = 0;
  const firstQ = lines.findIndex((l) =>
    explicit ? EXPLICIT_Q_RE.test(l) || OCR_Q_RE.test(l) : false
  );
  const searchEnd = firstQ >= 0 ? firstQ : lines.length;
  for (let i = 0; i < searchEnd; i++)
    if (HEADER_RE.test(lines[i])) start = i + 1;
  if (firstQ >= 0) start = Math.min(start, firstQ);

  // "This assignment has four questions ... Answer all questions." etc.
  const instructionLines = [];
  const questions = [];
  let current = null;
  let last = 0;
  let section = '';

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/¢/g, 'c');
    if (!line || /^\d{1,3}$/.test(line)) continue; // blank / page number
    // A new course section in a combined booklet ends this one.
    if (current && HEADER_RE.test(line)) {
      break;
    }
    // "Section-2" restarts the numbering (IGNOU lab assignments).
    const sec = SECTION_RE.exec(line);
    if (sec && line.length < 40) {
      section = sec[1];
      last = 0;
      continue;
    }
    // Accept increasing numbers (OCR can drop one), not restarts or jumps.
    const q = matchQuestion(line, explicit, last);
    if (q) {
      const rest = (q.rest || '').trim();
      current = {
        number: section ? `${q.n} (Section ${section})` : String(q.n),
        text: rest,
        // Marks on the question line itself are its total ("Q3: (3*4= 12 Marks)").
        head: SUBPART_RE.test(rest) ? '' : rest
      };
      questions.push(current);
      last = q.n;
    } else if (current) {
      const sub = SUBPART_RE.test(line);
      const sep = sub ? '\n' : current.text ? ' ' : '';
      // A marks-only line or the opening text right after "QI:" is still the head.
      if (!sub && current.text === current.head) current.head += sep + line;
      current.text += sep + line;
    } else {
      instructionLines.push(line);
    }
  }

  // Fallback: no numbering found, treat each paragraph as a question.
  if (!questions.length) {
    String(rawText || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 10)
      .forEach((p, i) =>
        questions.push({
          number: String(i + 1),
          text: p.replace(/\s*\n\s*/g, ' ')
        })
      );
  }

  const instr = instructionLines.join(' ');
  // "all questions carry equal marks ie. 4 marks"
  const eq = EQUAL_MARKS_RE.exec(instr);
  const equalMarks = eq ? eq[1] || eq[2] : '';
  const fromThis = instr.search(
    /this assignment has|answer all|attempt (all|any)/i
  );
  return {
    title: '',
    subject: '',
    instructions: (fromThis >= 0 ? instr.slice(fromThis) : instr).slice(0, 600),
    questions: questions
      .map(normalizeQuestion)
      .map((q) => (q.marks || !equalMarks ? q : { ...q, marks: equalMarks }))
  };
}

function chunkText(text) {
  if (text.length <= CHUNK_CHARS) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n\n', end);
      if (breakAt > start + CHUNK_CHARS / 2) end = breakAt;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * source: { text, pdfFile?, pdfBase64? }
 */
export async function extractWithAI(
  source,
  provider,
  { onProgress = () => {}, signal } = {}
) {
  const usePdf =
    provider.pdf &&
    source.pdfBase64 &&
    source.pdfBase64.length < 30 * 1024 * 1024;
  const results = [];

  if (usePdf) {
    onProgress('Sending the PDF to the AI to find the questions…');
    results.push(
      await completeJSON(
        {
          system: EXTRACT_SYSTEM,
          prompt: 'Extract all questions from the attached assessment PDF.',
          pdfBase64: source.pdfBase64,
          jsonSchema: QUESTIONS_SCHEMA,
          effort: 'low',
          signal
        },
        provider
      )
    );
  } else {
    const text = String(source.text || '').trim();
    if (!text) throw new AIError('No text found in the document to analyse.');
    const pageImages = provider.vision ? source.pageImages || [] : [];
    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i++) {
      onProgress(
        chunks.length > 1
          ? `Finding questions (part ${i + 1} of ${chunks.length})…`
          : 'Finding questions…'
      );
      results.push(
        await completeJSON(
          {
            system: EXTRACT_SYSTEM,
            prompt:
              (chunks.length > 1
                ? `This is part ${i + 1} of ${
                    chunks.length
                  } of the paper. Extract the questions that appear in this part only.\n\n`
                : '') +
              (pageImages.length
                ? 'The attached images are the pages that contain formulas or figures. The text below garbles formulas, so copy every formula and describe every figure from the images.\n\n'
                : '') +
              `Assessment text:\n"""\n${chunks[i]}\n"""`,
            images: pageImages,
            jsonSchema: QUESTIONS_SCHEMA,
            effort: 'low',
            signal
          },
          provider
        )
      );
    }
  }

  const first = results[0] || {};
  const questions = results
    .flatMap((r) => (Array.isArray(r.questions) ? r.questions : []))
    .filter((q) => q && String(q.text || '').trim())
    .map(normalizeQuestion);
  if (!questions.length) {
    throw new AIError(
      'The AI did not find any questions. Try "Find questions (no AI)" or paste them manually.'
    );
  }
  return {
    title: String(first.title || '').trim(),
    subject: String(first.subject || '').trim(),
    instructions: String(first.instructions || '').trim(),
    // Course / assignment details for the front page (reviewed by the user).
    meta: {
      subject: String(first.subject || '').trim(),
      subjectCode: String(first.courseCode || '').trim(),
      assignmentNo: String(first.assignmentNo || '').trim(),
      programmeCode: String(first.programmeCode || '').trim()
    },
    questions
  };
}
