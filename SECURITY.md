# Security Policy

## Supported versions

Only the latest release (the `main` branch, the hosted site and the latest npm version) receives security fixes.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report it privately through GitHub: open the repository's **Security** tab, then **Report a vulnerability**. Include:

- what the problem is and where it is (file, feature or URL),
- the steps to reproduce it,
- what an attacker could do with it.

We aim to reply within 7 days and to fix confirmed issues as quickly as possible. We'll credit you in the release notes unless you'd rather stay anonymous.

## Scope

Things we especially want to hear about:

- API keys or personal data leaving the browser other than to the AI provider the user selected.
- The local relay (`bin/cli.mjs` or `text_to_handwriting_ai/server.py`) being usable by other websites, reaching non-allowed addresses, or serving files outside the app folder.
- Script injection from uploaded files, imported JSON, AI responses or front-page text.

## How the app handles data

- Profiles, templates, fonts, front pages, drafts and API keys are stored only in the user's browser.
- API keys are sent only to the provider the user chooses. The local relay forwards requests without storing or logging them.
- The relay accepts requests only from the app's own page, forwards only `https` (plain `http` only to `localhost`, for Ollama), and passes on a fixed list of headers.
