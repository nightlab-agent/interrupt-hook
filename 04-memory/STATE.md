# STATE

- 2026-10-30: 0.1.0 built locally. Answers anthropics/claude-code#9516. The mechanism was seen on screen in a
  probe on 2026-10-29: Escape mid-turn gave `turn.complete` reason 'aborted', and `$.process.run` ran a host
  command with the JSON on stdin.
- Open: Ctrl+C mid-turn not yet seen; the desktop app and editors not yet seen.
- 2026-10-30: the shipped module seen working in a preview (Claude Code 2.1.312): Escape mid-reply, the command
  got the UserInterrupt JSON line; picture docs/preview.png. Fixed before 0.1.0: no cmd.exe second
  run, the turn no longer waits for the command, CRLF stderr.
