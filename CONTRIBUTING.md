# Contributing to Text to Handwriting AI

Thanks for helping. This guide covers how to set up the project, what we expect in a pull request, and how to report problems. By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug.** Click [New issue](https://github.com/CodewithWitcher/Text-To-Handwritten-With-AI/issues/new/choose) and pick the form that matches the problem: website, front page, questions, AI, PDF, handwriting or installation. Each form asks exactly what we need to find the cause.
- **Send a front page that isn't detected well** (use the *Front page not filled correctly* form). Attach the blank page (remove any personal details) and say which fields were missed or misplaced. This is the most useful report we get.
- **Send a question paper that is parsed badly** (use the *Questions not found in my paper* form). Attach it or paste its text, and say what went wrong (missed questions, wrong marks).
- **Add or improve a template.** Templates live in `js/advanced/templates.mjs`.
- **Fix an issue.** Issues labelled `good first issue` are a good place to start.

For larger changes, such as a new feature or a different library, open an issue first so we can agree on the approach before you spend time on it.

## Project setup

The app is plain HTML, CSS and JavaScript modules. There is **no build step**.

```bash
git clone https://github.com/CodewithWitcher/Text-To-Handwritten-With-AI.git
cd Text-To-Handwritten-With-AI
npm start              # Node 18+, opens http://127.0.0.1:8080
# or
python3 server.py      # Python 3.8+
```

Edit a file and reload the page. To lint or run the end-to-end tests, install the dev tools once:

```bash
npm install
npm run lint           # ESLint (must pass in CI)
npm run format         # Prettier
npm test               # Cypress end-to-end tests (server must be running)
```

Don't open `index.html` directly from disk (`file://`). Browsers block JavaScript modules there, so always use one of the servers above.

## Where things are

| Area | Files |
| --- | --- |
| Classic mode (original converter) | `js/app.mjs`, `js/generate-images.mjs`, `js/utils/` |
| Classic / Advanced switch | `js/mode-switch.mjs` |
| Advanced mode controller | `js/advanced/main.mjs` |
| Handwriting pages (layout, pagination, Markdown) | `js/advanced/renderer.mjs` |
| Front page detection and editor | `js/advanced/frontpage.mjs` |
| Question finding (AI and rule-based) | `js/advanced/questions.mjs` |
| Course details found in papers | `js/advanced/assignment-meta.mjs` |
| Templates and AI prompts | `js/advanced/templates.mjs` |
| AI providers | `js/advanced/llm.mjs` |
| Profile, courses, saved data | `js/advanced/profile.mjs`, `js/advanced/store.mjs` |
| Local server + AI relay | `bin/cli.mjs` (Node) and `text_to_handwriting_ai/server.py` (Python), which must behave the same |

## Rules for changes

1. **Keep Classic mode working as it is.** New features go in Advanced mode (`js/advanced/`).
2. **No build step and no new runtime dependencies** without discussing it first. Third-party browser libraries are loaded on demand from a pinned CDN version (see `js/advanced/loaders.mjs`).
3. **Privacy first.** User data stays in the browser. Never send names, roll numbers or other personal details to an AI provider, never log API keys, and never add analytics or tracking.
4. **Keep both servers in sync.** If you change `text_to_handwriting_ai/server.py`, make the same change in `bin/cli.mjs`, and the other way round.
5. **Match the surrounding code.** Prettier and ESLint settings are in the repo: run `npm run format` and `npm run lint` before you commit.
6. **Test in a real browser.** Check both Classic and Advanced mode, and download a PDF to confirm the pages have content. For layout changes, include a before/after screenshot in the pull request.

## Pull requests

1. Fork the repo and create a branch from `main` (for example `fix/date-slots` or `feat/lab-template`).
2. Keep each pull request to one topic. Smaller pull requests get reviewed faster.
3. Write a clear title and fill in the pull request template: what changed, why, and how you tested it.
4. Make sure the **ESLint** and **End-to-end tests** checks pass.
5. A maintainer will review it. Please respond to comments. We may suggest changes before merging.

Commit messages should be short and in the imperative mood, such as "Fix date slots on IGNOU front page" or "Add lab report template".

## Releasing (maintainers)

- **Website:** every push to `main` deploys to GitHub Pages through `.github/workflows/pages.yml`.
- **npm and PyPI packages:**
  1. Set the same new version in `package.json`, `pyproject.toml` and `text_to_handwriting_ai/__init__.py`, and add it to `CHANGELOG.md`.
  2. Publish a GitHub Release with a tag like `v2.0.1`. `.github/workflows/release.yml` publishes to PyPI and npm.
  3. To check what will be published: `npm pack --dry-run`, and `python -m build` (look inside `dist/`).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
