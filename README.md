# Automation School

An offline-first training app for apprentices: safety, wiring, motors, drives, PLCs, networks and project work. It follows UK practice and uses IEC and Siemens-style examples. All plants, people and tags are fictional.

> **Training only.** The simulators are simplified and never connect to real equipment. An app score never makes anyone competent or authorised. Site procedures always come first.

## Status
Phase 2 (Foundation): profiles, offline install, backup and restore, progress export and import. The lessons start in Phase 3.

## Develop
```bash
npm install
npm run dev          # local dev server
npm test             # unit tests (Vitest)
npm run build        # type-check + production build
npm run test:e2e     # offline journey tests (Playwright), laptop + Android phone
```
If Playwright's own Chromium isn't installed, set `CHROME_PATH` to a local Chrome.

## Deploy
Every push to `main` runs the tests, then GitHub Actions publishes `dist/` to GitHub Pages. Set **Settings → Pages → Source: GitHub Actions** once in the repo.

## Install on a device
Open the Pages address once while online, then install it: Android Chrome uses ⋮ → *Install app*, and laptop Chrome or Edge has an install icon in the address bar. After that it works with no internet. Each device keeps its own data. Move data with a backup (`.asbackup.json`) or a progress file (`.asprogress.json`).

See `docs/` for the trainer notes and the VERIFY list.
