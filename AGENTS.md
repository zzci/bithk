## Agent Rules

- Chinese must not appear in documentation or code unless the user explicitly requests Chinese documentation.
- When committing to a remote repository, collaborator information and Chinese text must not appear.
- Communication with the user should primarily be in Chinese.
- Keep responses concise and direct.

## Project Development

This repository follows the PMA workflow. The actual rules live in the `/pma`
skill and the stack skills below; do not duplicate them here. If a rule in this
file ever conflicts with `/pma`, treat `/pma` as the source of truth and update
this file.

### Skill Stack

- `/pma` — workflow control, three-phase gate, task and plan tracking
- `/pma-bun` — Bun API/backend implementation baseline
- `/pma-web` — React + Vite frontend implementation baseline

### Triggers

Any feature, bug fix, refactor, planning, progress tracking, or multi-agent
execution goes through `/pma` (investigate -> proposal -> implement). Do not
skip phases. Do not implement before explicit approval such as `proceed`.

### Project-Specific Facts

- Primary language / runtime: TypeScript on Bun 1.4.0, Node 24.14 for compatible tooling.
- Database / storage: SQLite via Bun's native SQLite driver and Drizzle; local file storage through the `file` module.
- Dev URL routing: nsl routes `bit.localhost` and `bit.a.fr.ds.cc`; `bun run dev` starts web and API.
- Deployment target: lode-managed release artifact via `bun run package`.
- Quality-gate command: `bun run check`.

### Local Divergences

Any deliberate deviation from a skill rule is recorded in `docs/decisions/`
with a sunset date. Do not silently override skill rules in this file.

### Documentation Entry Points

- Tasks: `docs/task/index.md`
- Plans: `docs/plan/index.md`
- Decisions: `docs/decisions/`
- Architecture: `docs/architecture.md`
- Changelog: `docs/changelog.md`

## Shell

- Prefer `bash` for all command execution.
- Do not use `zsh` unless the user explicitly requests it.
- Never use unfiltered port-kill commands.

## Git

- Use English for commit messages, pull request titles, pull request descriptions, and other remote-visible Git metadata.
- Do not mention AI assistants, agents, or model names in commit messages, pull request text, comments, or any other remote-visible content.
