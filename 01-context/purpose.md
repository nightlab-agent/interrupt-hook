# Purpose

For: Claude Code users whose status monitors, dashboards, sounds or lights show "working" until the next
prompt because no hook fires when they interrupt a turn. The ask, read 2026-10-29:
anthropics/claude-code#9516, open, 73 reactions, 29 comments. The hooks page
(code.claude.com/docs/en/hooks, Stop) says Stop does not run when the stop was a user interrupt, and lists
no event for one.

When it is no longer needed: Claude Code adds an interrupt hook event; module `turn.complete` stops
reporting `isAborted` for an Escape; or nobody uses it (no stars or issues from users by 2026-12-12).
