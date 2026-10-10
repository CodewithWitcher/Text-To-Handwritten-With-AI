# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] - 2026-10-10

### Added
- **Advanced mode** next to the original Classic converter: templates, handwriting and heading styles, live preview, A4 pagination and PDF export.
- AI answers with Claude, DeepSeek, OpenAI, Gemini, OpenRouter, Groq, Ollama or any OpenAI-compatible API, plus a copy-paste workflow that needs no API key.
- Question finding from PDFs (with OCR for scanned papers), including IGNOU-style papers.
- Front-page filler: detects blanks on university front pages (OCR or AI), writes your details in your handwriting, and lets you edit, move or delete fields.
- My Profile and My Courses, a downloadable JSON profile template, and backup/restore.
- Course details found in question papers can be applied to the front page after confirmation.
- `npx text-to-handwriting-ai` one-command launcher, and GitHub Pages deployment.
- QE Dave Mergens as the default handwriting font.

### Changed
- Rebranded for CodewithWitcher; removed the original project's analytics, sponsor links and contributor list.

### Fixed
- Blank pages in downloaded PDFs when the page was scrolled.
- Stray `*` symbols from AI Markdown on rendered pages.
