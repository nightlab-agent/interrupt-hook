#!/bin/sh
# Release check: the manifest and module validate, the tests pass, and the
# version string is the same in the plugin manifest, the marketplace manifest,
# the changelog's newest release and package.json (the README carries no version).
# Exit non-zero on any of them. Run from the repo root: sh tests/release.sh
# Type-check: tests/typecheck.sh, tsc --noEmit against the engine's declarations.
set -e
cd "$(dirname "$0")/.."
claude plugin validate .
claude plugin test .
sh tests/typecheck.sh
python3 -I tests/checklist.py
python3 -I - <<'PY'
import json, re, sys
plugin = json.load(open('.claude-plugin/plugin.json'))['version']
market = json.load(open('.claude-plugin/marketplace.json'))['plugins'][0]['version']
changelog = re.search(r'^## (\d+\.\d+\.\d+) ', open('CHANGELOG.md').read(), re.M).group(1)
package = json.load(open('package.json'))['version']
versions = {'plugin.json': plugin, 'marketplace.json': market, 'CHANGELOG.md': changelog, 'package.json': package}
if len(set(versions.values())) != 1:
    sys.exit(f"version strings differ: {versions}")
print(f"version check: all four say {plugin}")
import pathlib
stated = re.search(r'claude plugin test \.` \((\d+) tests', open('README.md').read())
declared = sum(len(re.findall(r'^test\(', p.read_text(encoding='utf-8'), re.M))
               for folder in ('hooks', 'tests') for p in pathlib.Path(folder).glob('*.test.tsx'))
if stated is None or int(stated.group(1)) != declared:
    sys.exit(f"README's test count is not the suite's: README {stated and stated.group(1)}, suite {declared}")
print(f"test count check: README and suite say {declared}")
PY
echo "release check: validate, test, type check, checklist and version check passed"
