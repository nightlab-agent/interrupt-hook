# Changelog

The form is Keep a Changelog; versions follow SemVer.

## Unreleased

### Fixed
- An interrupt no longer writes over your next prompt in four more cases: that prompt's UserPromptSubmit hook
  already wrote "working" but the turn had not started, the next turn started while the interrupted one was still
  ending (modelled in the tests, neither seen in a session), `/clear` or a resume moved to another session (the
  command used to run with the new session's id and the old turn's id), or a prompt queued over the turn starts
  when that turn is cut, as "Enter to send now" does. The command then waits one second for that turn; if none
  starts it runs. A prompt another plugin drops no longer skips the command. Tests: tests/ordering.test.tsx,
  tests/queued.test.tsx.
- Tests: a second interrupt while the first command still runs (each runs once, with its own turn id),
  and a subagent's turn starting after an interrupt (not the next prompt: the command still runs). No change
  to the code.

## 0.1.3 - 2026-10-31

### Fixed
- Toasts no longer repeat the mod's name: Claude Code already puts it in front, so they read
  "interrupt-hook: interrupt-hook: ..." before. Test: hooks/register.test.tsx.

### Changed
- README: a link to the Nightlab YouTube channel.

## 0.1.2 - 2026-10-30

### Fixed
- An interrupt whose command had not started yet when you sent your next prompt no longer runs it, so the
  command cannot overwrite what that prompt's hooks wrote. Test: tests/stale-interrupt.test.tsx.

### Changed
- README: the turn.start hook, two known limits (a turn ended by another plugin; an administrator's plugin that
  ends the event), what the release check needs, and a second way it was seen working (Escape while Claude was
  still thinking).

## 0.1.1 - 2026-10-30

### Changed
- README: a wider preview picture, its status line not cut off. No change to the mod.

## 0.1.0 - 2026-10-30

### Added
- When a turn of the main conversation ends because you interrupted it, the mod runs the command set in its
  `command` option once, with one JSON line on stdin (`hook_event_name` "UserInterrupt", `session_id`, `cwd`,
  `turn_id`, `duration_ms`). It runs under `sh -c`, after the turn has ended, without holding it. Timeout option, 10 s by default, kept within 1 to 600 s.
- A toast when the command exits non-zero or does not finish (no `sh`, or the timeout); nothing on screen when it
  succeeds.
