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

const MARKS_RE = /[[(]\s*(\d+(?:\.\d+)?)\s*(?:marks?|m|pts?|points?)\s*[\])]|\b(\d+(?:\.\d+)?)\s*marks?\b/i;
const WORDS_RE = /(?:in\s+)?(?:about|around|approx\.?|max(?:imum)?\.?|not more than|within)?\s*(\d{2,4})\s*words/i;
const Q_START_RE = /^\s*(?:Q(?:uestion|ues|n)?\s*\.?\s*(?:No\.?\s*)?)?(\d{1,3})\s*(?:[.):\-–]|\s(?=[A-Z(]))\s*(.*)$/i;
const SUBPART_RE = /^\s*(?:\(?[a-hivx]{1,4}[).]|[a-h]\s*[.)])\s+/i;

function normalizeQuestion(q, i) {
  const text = String(q.text || '').trim();
  const marks = String(q.marks || '').trim() || ((MARKS_RE.exec(text) || [])[1] || (MARKS_RE.exec(text) || [])[2] || '');
  const wordLimit = String(q.wordLimit || '').trim() || ((WORDS_RE.exec(text) || [])[1] || '');
  return {
    id: uid(),
    number: String(q.number || i + 1).trim(),
    text,
    marks: marks.replace(/[^\d.]/g, ''),
    wordLimit: wordLimit.replace(/[^\d]/g, '')
  };
}

export function extractBasic(rawText) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  const questions = [];
  const preamble = [];
  let current = null;
  let expected = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = Q_START_RE.exec(trimmed);
    // Accept the next number in sequence (or a restart at 1) as a new question,
    // which avoids treating "2 marks" or years inside text as question starts.
    if (m && m[2] !== undefined && (Number(m[1]) === expected || (Number(m[1]) === 1 && !current))) {
      current = { number: m[1], text: m[2].trim() };
      questions.push(current);
      expected = Number(m[1]) + 1;
    } else if (current) {
      current.text += (SUBPART_RE.test(trimmed) ? '\n' : ' ') + trimmed;
    } else {
      preamble.push(trimmed);
    }
  }

  // Fallback: no numbering found, treat each paragraph as a question.
  if (!questions.length) {
    String(rawText || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 10)
      .forEach((p, i) => questions.push({ number: String(i + 1), text: p.replace(/\s*\n\s*/g, ' ') }));
  }

  return {
    title: '',
    subject: '',
    instructions: preamble.join(' ').slice(0, 600),
    questions: questions.map(normalizeQuestion)
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
export async function extractWithAI(source, provider, { onProgress = () => {}, signal } = {}) {
  const usePdf = provider.pdf && source.pdfBase64 && source.pdfBase64.length < 30 * 1024 * 1024;
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
                ? `This is part ${i + 1} of ${chunks.length} of the paper. Extract the questions that appear in this part only.\n\n`
                : '') + `Assessment text:\n"""\n${chunks[i]}\n"""`,
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
    throw new AIError('The AI did not find any questions. Try "Find questions (no AI)" or paste them manually.');
  }
  return {
    title: String(first.title || '').trim(),
    subject: String(first.subject || '').trim(),
    instructions: String(first.instructions || '').trim(),
    questions
  };
}
