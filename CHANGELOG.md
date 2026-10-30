# Changelog

The form is Keep a Changelog; versions follow SemVer.

## 0.1.2 - unreleased

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
