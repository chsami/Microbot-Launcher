# Repository Guidelines

## Project Structure & Module Organization
The Electron main process lives in `main.js`, with `preload.js` and `renderer.js` bridging UI logic. Shared functionality sits under `libs/` (IPC handlers, utilities) while static assets reside in `css/`, `images/`, and `index.html`. Tests are under `tests/` (`*.test.js`), and packaging assets live in `build/`. Keep new binaries or large downloads out of the repo—stage them under `.microbot` at runtime instead.

## Build, Test, and Development Commands
Use `npm install` to sync dependencies. During feature work, `npm run dev` launches Electron with debug tooling, and `npm start` uses the Forge pipeline for a production-like run. Validate changes with `npm test`; `npm run test:watch` is best for iterative work, and `npm run test:coverage` publishes Jest coverage into `coverage/`. Ship-ready artifacts are generated with `npm run release`, or platform-specific builds via `npm run linux` / `npm run mac`.

## Coding Style & Naming Conventions
JavaScript files use 4-space indentation, trailing semicolons, and single quotes, matching existing code. Prefer `const`/`let` over `var`, async/await over raw Promises, and keep Electron IPC handlers isolated in `libs/`. Renderer assets follow kebab-case (`css/app-shell.css`), while shared modules and tests use camelCase (`libs/memoryUtils.js`, `tests/memory-utils.test.js`). No automated linter ships here, so run Prettier locally or format on save to stay consistent.

## Testing Guidelines
Jest powers unit and integration coverage. Mirror existing naming (`feature-name.test.js`) and colocate mocks under `tests/__fixtures__/` if you add them. All new IPC handlers and download flows should ship with at least one regression test, and coverage should remain stable; run `npm run test:coverage` before opening a PR and review hotspots in `coverage/lcov-report/`.

## Commit & Pull Request Guidelines
History favors concise, imperative commit subjects such as `Adjust client RAM options`; internal chores optionally use prefixes like `chore:`. Squash trivial WIP commits before pushing. Pull requests should link issues where applicable, describe user-facing impact, and include test notes (`npm test` output or manual steps). Attach UI screenshots or GIFs when renderer changes affect the interface, and mention packaging concerns if a change touches `build/` artifacts.

## Release & Configuration Tips
Versioning follows `package.json`. When tweaking auto-update endpoints or build metadata, update the `build.publish.url` and corresponding icons in `images/`. For platform quirks (e.g., proxy handling, Linux jar execution), verify paths through `libs/dir-module.js` and document overrides in the PR to aid downstream agents.
