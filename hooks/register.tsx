import type { Register } from 'claude-code'

/** What the person's command reads on stdin, one JSON line, shaped like a settings hook's input. */
export type Payload = {
  hook_event_name: 'UserInterrupt'
  session_id: string
  cwd: string
  turn_id: string
  duration_ms: number
}

/** The command runs under sh only: the engine rejects both "could not start" and "timed out"
 *  the same way, so a second shell after a rejection could run a command that already ran. */
export const argv = (command: string): string[] => ['sh', '-c', command]

/** Seconds from the `timeout` option, 10 when unset or not a number, kept within 1 to 600. */
export const timeoutMs = (value: unknown): number => {
  if (value === undefined || value === null || String(value).trim() === '') return 10_000
  const n = Number(value)
  if (!Number.isFinite(n)) return 10_000
  return Math.min(600, Math.max(1, Math.round(n))) * 1000
}

export const register: Register = (on, options) => {
  const command = String(options.command ?? '').trim()
  // Main-loop turns started so far: an interrupt whose command has not started when the next one begins is stale.
  let mainTurns = 0

  on('turn.start', async (_, e, next) => {
    if (e.agentId === undefined) mainTurns++
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Only the main loop's turns: a subagent's run ending is not the person interrupting.
    if (e.agentId !== undefined || !e.isAborted || command === '') return done
    // Not awaited: the turn ends now and the command runs on after it, so a slow command never holds the end.
    const turnsAtEnd = mainTurns
    void (async () => {
      try {
        const payload: Payload = {
          hook_event_name: 'UserInterrupt',
          session_id: await $.session.id().catch(() => ''),
          cwd: await $.session.cwd().catch(() => ''),
          turn_id: e.turnId,
          duration_ms: e.durationMs,
        }
        // The person sent the next prompt while the lookups ran: "idle" would land after "working".
        if (mainTurns !== turnsAtEnd) return
        const init = { stdin: JSON.stringify(payload) + '\n', timeoutMs: timeoutMs(options.timeout) }
        let result: { exitCode: number; stderr: string }
        try {
          result = await $.process.run(argv(command), init)
        } catch (err) {
          // not started (no sh) or still running at the timeout: the error text says which
          $.ui.toast(`interrupt-hook: the command did not finish: ${String(err).slice(0, 80)}`)
          return
        }
        if (result.exitCode !== 0) {
          const why = result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 80) ?? ''
          $.ui.toast(`interrupt-hook: the command exited ${result.exitCode}${why ? `: ${why}` : ''}`)
        }
      } catch {
        // a failure of its own never changes how the turn ended
      }
    })()
    return done
  })
}
