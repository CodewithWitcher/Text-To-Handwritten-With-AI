# Text to Handwriting AI

[![Live site](https://img.shields.io/badge/try%20it-online-2ea44f)](https://codewithwitcher.github.io/Text-To-Handwritten-With-AI/)
[![npm](https://img.shields.io/npm/v/text-to-handwriting-ai?label=npm)](https://www.npmjs.com/package/text-to-handwriting-ai)
[![PyPI](https://img.shields.io/pypi/v/text-to-handwriting-ai?label=PyPI)](https://pypi.org/project/text-to-handwriting-ai/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Turn typed text into realistic handwritten pages, or build a complete handwritten assignment, with a filled-in front page and AI-drafted answers. Everything runs in your browser, and your data stays on your device.

![A front page filled in with handwriting, next to a handwritten answer page](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/sample-output.jpg)

Maintained by [CodewithWitcher](https://github.com/CodewithWitcher). Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Quick start

| Option | How | Best for |
| --- | --- | --- |
| **Online** | Open **https://codewithwitcher.github.io/Text-To-Handwritten-With-AI/** | Trying it out, nothing to install |
| **One command (Python)** | `pipx run text-to-handwriting-ai` or `uvx text-to-handwriting-ai` (Python 3.8+) | Every AI provider, fully on your machine |
| **One command (Node)** | `npx text-to-handwriting-ai` ([Node.js](https://nodejs.org) 18+) | Same, if you have Node instead of Python |
| **From source** | Clone the repo, then `npm start` or `python3 server.py` | Contributing |

Your data stays in your browser in every option. The online version calls AI providers straight from your browser. Claude and DeepSeek allow that, but some providers block it (CORS). If a provider fails online, use one of the one-command options: they run a small local relay that works with all of them.

## Two modes

Use the switch at the top of the page.

### Classic

The original quick converter. Type or paste text, choose a font, ink and paper, then generate images or a PDF.

![Classic mode: text on ruled paper with handwriting options](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/classic-mode.png)

### Advanced (AI)

A guided, four-step flow that produces a complete assignment PDF.

#### 1. Template & handwriting

Pick an assessment template: Q&A, short answers, detailed answers, essay, lab report, case study, or your own. Choose a font (QE Dave Mergens by default) or upload your own `.ttf`. Then set ink colours for answers and headings, heading style, ruled lines, margin, and *natural variation* (a small per-word tilt so it doesn't look like a font). The live preview updates as you change things.

![Step 1: template, handwriting and page options with a live preview](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/step1-style.png)

#### 2. Front page (optional)

Upload your university or college front page as an image or PDF.
- **Auto-detect** finds blanks such as *Name*, *Roll No.*, *Course Code* and *Date*, and writes your details on the printed lines in your handwriting. It handles dates split into `__ / __ / ____` slots and addresses that need two lines.
- **Smart detect (AI)** lets the AI decide which blank is which.
- **Pick a course** from *My Courses* to fill the course title, code, assignment number and teacher.
- **Click any field** to change it, resize it or delete it, or drag it into place. Then save the layout to reuse next time.

![Step 2: a sample front page with every blank filled in automatically](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/step2-front-page.png)

#### 3. Questions & answers

Choose where the questions come from:
- **Upload the question paper (PDF).** Every question is found with its marks, including IGNOU-style papers and scanned PDFs (read with OCR, or directly by Claude). If the paper lists a course code, title or assignment number, you're asked whether to use them on the front page.
- **Paste the questions.**
- **Write or paste your own content.** No AI needed. Use simple formatting for headings and lists.

Then generate the answers with AI. Answer length follows the marks and the template, and you can edit, regenerate or reorder anything. **No API key?** Click *Copy prompt*, paste it into ChatGPT, Claude.ai or DeepSeek, paste the reply back, and click *Import answers*.

![Step 3: questions found from the paper, with an answer generated for each](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/step3-questions.png)

#### 4. Preview & download

Text flows across A4 pages: words are never cut, and headings are never left alone at the bottom of a page. Edit the final text if you like, then download one PDF (front page first) or the individual page images.

![Step 4: rendered handwritten pages ready to download](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/step4-pages.png)

### My Profile, courses and AI settings

**My Profile** stores your name, roll number, programme and other details in this browser, plus **My Courses** for each subject you write assignments for. To fill it from a file, click *Download profile template*, fill in the JSON in any text editor, then click *Import profile*.

![My Profile with the profile file template and My Courses](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/profile.png)

**AI Settings** supports Claude, DeepSeek, OpenAI, Google Gemini, OpenRouter, Groq, Ollama (local, no key) and any OpenAI-compatible endpoint. Keys stay in your browser.

![AI Settings: choose a provider, add a key and test the connection](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/ai-settings.png)

Dark mode is included:

![Advanced mode in dark mode](https://raw.githubusercontent.com/CodewithWitcher/Text-To-Handwritten-With-AI/main/docs/screenshots/advanced-dark.png)

## Run locally

**One command, no clone.** Use whichever you have:

```bash
pipx run text-to-handwriting-ai         # Python (pipx)
uvx text-to-handwriting-ai              # Python (uv)
npx text-to-handwriting-ai              # Node.js
```

Each one opens http://127.0.0.1:8080 in your browser. Options: `--port 9000`, `--no-open`, `--host 0.0.0.0` (to reach it from other devices on your network).

To keep it installed instead: `pip install text-to-handwriting-ai`, then run `text-to-handwriting-ai`.

**From a clone** (no dependencies needed to run):

```bash
npm start              # Node 18+
python3 server.py      # or Python 3.8+, same behaviour
```

Both serve the app and relay AI requests to the provider you choose, so browsers don't block them (CORS). If the port is busy, the next free one is used.

> macOS: port 5000 is taken by AirPlay Receiver, which is why the default is 8080.

## Privacy

- Everything you enter (profile, templates, fonts, front pages, drafts, API keys) is stored only in this browser (localStorage and IndexedDB).
- API keys are sent only to the provider you select. When the local server relays a request, it doesn't store or log keys or content.
- Only academic context (course, subject, semester) is included in AI prompts. Your name and ID numbers are never sent.
- *My Profile → Delete all saved data* wipes everything. Data exports never include API keys.

## Content formatting

Own content and the final text step use this formatting:

| Write | Result |
| --- | --- |
| `# Title` | Centered title |
| `## Heading` | Question / section heading |
| `### Sub-heading` | Sub-heading |
| `- item` / `1. item` | Bullet / numbered list |
| `**text**` | Underlined emphasis |
| blank line | New paragraph |
| `---` | New page |

## Project structure

```
index.html              Page shell: Classic markup + Advanced markup
bin/cli.mjs             `npx text-to-handwriting-ai` launcher (Node, no deps)
text_to_handwriting_ai/ Same server + AI relay in Python (stdlib only); the pip package
server.py               Runs the Python server from a clone
pyproject.toml          pip package definition (bundles the site files at build time)
docs/screenshots/       Images used in this README
js/app.mjs              Classic mode (original behaviour)
js/mode-switch.mjs      Classic / Advanced switch (lazy-loads Advanced)
js/config.mjs           Repository / author links
js/advanced/
  main.mjs              Advanced mode controller (tabs, steps)
  llm.mjs               AI providers (Claude SDK + OpenAI-compatible)
  questions.mjs         Question extraction (AI and rule-based)
  templates.mjs         Templates, prompts, document composition
  renderer.mjs          Pagination + handwriting page rendering
  frontpage.mjs         Front page detection / editor
  pdf-input.mjs         PDF text extraction + OCR
  profile.mjs, store.mjs, output.mjs, ui.mjs, loaders.mjs
css/advanced.css        Advanced mode styles
```

## Libraries

- [html2canvas](https://github.com/niklasvh/html2canvas): renders pages to images
- [jsPDF](https://github.com/parallax/jsPDF): builds the PDF
- [pdf.js](https://github.com/mozilla/pdf.js): reads uploaded PDFs
- [Tesseract.js](https://github.com/naptha/tesseract.js): OCR for front pages and scanned papers
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript): Claude integration
- [Cypress](https://github.com/cypress-io/cypress): end-to-end tests (`npm test`, with the server running)

## Contributing

Bug reports, front-page layouts that don't detect well, new templates and fixes are all welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get set up, and follow our [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Responsible use

Use this for notes, practice, accessibility (for example, if handwriting is hard for you) and mock-ups. Check your institution's rules before submitting AI-assisted or generated work.

## License

MIT. See [LICENSE](LICENSE). Based on the MIT-licensed text-to-handwriting project.
