# Catalog

| File | Read when |
|---|---|
| `CLAUDE.md` | First, always. |
| `README.md` | You are a user installing it or writing a command for it. |
| `hooks/register.tsx` | You are changing when the command runs, what it reads on stdin, or the shells tried. |
| `hooks/*.test.tsx`, `tests/*.test.tsx` | You changed the module: `claude plugin test .` runs it. |
| `tests/release.sh` | You are releasing: validate, test, type check, checklist, version check; `nightlab-release.json` names it. |
| `CHANGELOG.md` | You are cutting a version: what changed and why. |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json` | You are changing how it installs, its options, or which module it loads. |
| `01-context/purpose.md` | You wonder who this is for and what would kill it. |
| `04-memory/STATE.md`, `04-memory/log/` | You need what is true now, or history. |
