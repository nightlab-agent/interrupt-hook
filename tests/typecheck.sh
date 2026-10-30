#!/bin/sh
# Type-check the hooks module, its tests and the mod's contract against the
# engine's own declarations (tsc --noEmit, the options the engine's types
# header gives a hooks module). The declarations come from, in order:
# CC_TYPES; the copy the engine lays beside a loaded mod
# (.claude-plugin/types/claude-code/index.d.ts); /nightlab/tools/cc-types/current.
# tsc comes from TSC (a path or a command on PATH; anything else FAILS), else /nightlab/tools, then PATH.
# No hooks module file (tests and .d.ts do not count) is a FAIL. Missing types or a missing tsc is a
# FAIL, never a skip. Run from the repo root: sh tests/typecheck.sh
set -e
cd "$(dirname "$0")/.."
types="${CC_TYPES:-}"
[ -n "$types" ] || { [ -f .claude-plugin/types/claude-code/index.d.ts ] && types=.claude-plugin/types/claude-code/index.d.ts; }
[ -n "$types" ] || types=/nightlab/tools/cc-types/current/claude-code.d.ts
[ -f "$types" ] || { echo "typecheck: FAIL, no engine types at $types (set CC_TYPES)"; exit 1; }
if [ -n "${TSC:-}" ]; then
  tsc="$(command -v "$TSC" || true)"
  [ -n "$tsc" ] && [ -x "$tsc" ] || { echo "typecheck: FAIL, TSC=$TSC is not an executable or a command on PATH"; exit 1; }
else
  tsc=/nightlab/tools/node_modules/.bin/tsc
  [ -x "$tsc" ] || tsc="$(command -v tsc || true)"
fi
[ -n "$tsc" ] || { echo "typecheck: FAIL, no tsc (npm install typescript, or set TSC)"; exit 1; }
files=$(ls hooks/*.ts hooks/*.tsx types/*.d.ts 2>/dev/null || true)
echo "$files" | grep '^hooks/' | grep -v -E '\.test\.tsx?$|\.d\.ts$' | grep -q . || { echo "typecheck: FAIL, no hooks module (hooks/*.ts or *.tsx other than tests and .d.ts) to check"; exit 1; }
# Claude Code lays a tsconfig.json beside a loaded mod (git ignores it); tsc 6 and later refuse to run with
# files on the command line while one is present, so an untracked one is told to be ignored (tsc 5 ignores it
# on its own and does not know the option).
extra=""
major=$("$tsc" --version 2>/dev/null | sed -n 's/^Version \([0-9]*\).*/\1/p')
if [ -f tsconfig.json ] && ! git ls-files --error-unmatch tsconfig.json >/dev/null 2>&1 && [ "${major:-0}" -ge 6 ]; then extra="--ignoreConfig"; fi
"$tsc" --noEmit $extra --target es2023 --lib es2023 --module esnext \
  --moduleResolution bundler --strict --noUncheckedIndexedAccess --skipLibCheck \
  --jsx react --jsxFactory h --jsxFragmentFactory Fragment "$types" $files
echo "typecheck: tsc --noEmit passed against $(head -1 "$types" | sed 's,^// ,,')"
