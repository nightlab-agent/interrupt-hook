"""Offline host reproduction: python3 -I tests/real-engine.py [module].

The first case passes; the delayed case must also run the interrupt command.
A turn.step hook aborts its own turn without making a model request. The
process.run hook records the command without executing a shell.
"""

import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parent.parent
MODULE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "hooks/register.tsx"


def reproduce(delayed):
    with tempfile.TemporaryDirectory(prefix=".review-native-", dir=ROOT) as temp:
        fixture = Path(temp)
        for name in ("target", "lower"):
            plugin = fixture / name
            (plugin / ".claude-plugin").mkdir(parents=True)
            (plugin / "hooks").mkdir()
            manifest = {"name": name, "version": "0.0.0", "description": "Offline review probe"}
            if name == "target":
                manifest = json.loads((ROOT / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))
                manifest["name"] = name
                manifest["userConfig"]["command"]["default"] = "echo idle"
            (plugin / ".claude-plugin/plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
            (plugin / "hooks/hooks.json").write_text('{"modules":["./register.tsx"]}', encoding="utf-8")
        (fixture / "target/hooks/register.tsx").write_text(MODULE.read_text(encoding="utf-8"), encoding="utf-8")
        (fixture / "lower/hooks/register.tsx").write_text("""
export const register = on => {
  let release = () => {}
  const held = new Promise(resolve => { release = resolve })
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (DELAY) await held
    $.ui.log('PROMPT_RETURN')
    return result
  })
  on('turn.step', async function* ($, e) {
    await $.turn.abort({ turnId: e.turnId })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  on('turn.complete', (_, e, next) => { release(); return next(e) })
  on('session.id', async ($, e, next) => {
    await $.clock.sleep(250)
    $.ui.log('LOOKUP_DONE')
    return next(e)
  })
  on('process.run', ($) => {
    $.ui.log('COMMAND_RUN')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}
""".replace("DELAY", str(delayed).lower()), encoding="utf-8")
        env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "TMPDIR") if key in os.environ}
        env.update(CLAUDE_CONFIG_DIR=str(fixture / "config"), ANTHROPIC_API_KEY="offline-review",
                   ANTHROPIC_BASE_URL="http://127.0.0.1:9", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1")
        args = ["claude", "--plugin-dir", str(fixture / "target"), "--plugin-dir", str(fixture / "lower"),
                "--print", "--input-format", "stream-json", "--output-format", "stream-json",
                "--verbose", "--no-session-persistence", "--strict-mcp-config"]
        with subprocess.Popen(args, cwd=ROOT, env=env, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
            child.stdin.write(b'{"type":"user","message":{"role":"user","content":"offline probe"}}\n')
            child.stdin.flush()
            output = b""
            deadline = time.monotonic() + 5
            lookup_seen = False
            while time.monotonic() < deadline:
                ready, _, _ = select.select([child.stdout], [], [], max(0, deadline - time.monotonic()))
                if not ready:
                    break
                chunk = os.read(child.stdout.fileno(), 65536)
                if not chunk:
                    break
                output += chunk
                if not lookup_seen and b'"text":"LOOKUP_DONE"' in output:
                    lookup_seen = True
                    deadline = time.monotonic() + 0.3
            child.stdin.close()
            child.stdin = None
            try:
                rest, errors = child.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()
                raise RuntimeError("offline host did not exit") from None
            output += rest
        rows = [json.loads(line) for line in output.splitlines()]
        messages = [row.get("text") for row in rows if row.get("subtype") == "ui_log"]
        assert "PROMPT_RETURN" in messages and lookup_seen, (messages, errors.decode(errors="replace"))
        assert any(row.get("type") == "result" and row.get("duration_api_ms") == 0 for row in rows), rows
        ran = messages.count("COMMAND_RUN")
        print(f"{'PASS' if ran == 1 else 'FAIL'} delayed={delayed}: expected 1 command, got {ran}")
        return ran == 1


if __name__ == "__main__":
    results = [reproduce(delayed) for delayed in (False, True)]
    sys.exit(0 if all(results) else 1)
