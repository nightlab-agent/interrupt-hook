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
  // Prompts that went in, main-loop turns and session switches so far: an interrupt whose command has not started when
  // one of these comes is stale. It only counts up: a drop taken off it could cancel the prompt that came after.
  let moves = 0
  // Each prompt gets a number; those a plugin beneath is still deciding on stay here. One that came after the interrupt
  // may be writing "working" now, so it stops the command as a prompt already in does.
  let submitted = 0
  const deciding = new Set<number>()
  // How many prompts are held over each running turn. Their UserPromptSubmit hooks ran or are running, so when the turn is cut
  // one's own turn may be about to start.
  const held = new Map<string, number>()

  // Before the turn: this prompt's UserPromptSubmit hooks run inside next(e) and turn.start comes after them.
  on('prompt.submit', async (_, e, next) => {
    const id = ++submitted
    deciding.add(id)
    const over = e.turnId
    if (over !== undefined) held.set(over, (held.get(over) ?? 0) + 1)
    try {
      const entered = await next(e)
      // Over a running turn its own turn.start says so: it may yet go back to the composer, and the command should run.
      if (entered.drop === undefined) {
        if (over === undefined) moves++
      // Dropped beneath: no turn is coming.
      } else if (over !== undefined && held.has(over)) {
        const left = (held.get(over) ?? 1) - 1
        if (left > 0) held.set(over, left)
        else held.delete(over)
      }
      return entered
    } finally {
      deciding.delete(id)
    }
  })

  on('turn.start', async (_, e, next) => {
    if (e.agentId === undefined) moves++
    return next(e)
  })

  // A /clear or a resume goes on under another session: the interrupt's own id and folder are gone. Quitting is not a
  // switch, so the command still gets its chance.
  on('session.end', async (_, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') moves++
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Read before next(e), in case the next turn starts while this turn's end chain still runs (modelled in
    // tests/ordering.test.tsx, not seen in a session).
    const movesAtEnd = moves
    const submittedAtEnd = submitted
    const queued = e.agentId === undefined && held.has(e.turnId)
    held.delete(e.turnId)
    const done = await next(e)
    // Only the main loop's turns: a subagent's run ending is not the person interrupting.
    if (e.agentId !== undefined || !e.isAborted || command === '') return done
    // Not awaited: the turn ends now and the command runs on after it, so a slow command never holds the end.
    void (async () => {
      try {
        const payload: Payload = {
          hook_event_name: 'UserInterrupt',
          session_id: await $.session.id().catch(() => ''),
          cwd: await $.session.cwd().catch(() => ''),
          turn_id: e.turnId,
          duration_ms: e.durationMs,
        }
        // A queued prompt may start its turn now, or come back to the composer: give it a moment to say which.
        // A wait that was refused has not waited, so the command stays out of that prompt's way, and says so.
        if (queued) {
          try {
            await $.clock.sleep(1000)
          } catch {
            $.ui.toast('the command did not run: the wait for your queued prompt was refused')
            return
          }
        }
        // The person moved on during the lookups or the wait: "idle" would land after "working", or under the wrong session.
        if (moves !== movesAtEnd || [...deciding].some(id => id > submittedAtEnd)) return
        const init = { stdin: JSON.stringify(payload) + '\n', timeoutMs: timeoutMs(options.timeout) }
        let result: { exitCode: number; stderr: string }
        try {
          result = await $.process.run(argv(command), init)
        } catch (err) {
          // not started (no sh) or still running at the timeout: the error text says which
          $.ui.toast(`the command did not finish: ${String(err).slice(0, 80)}`)
          return
        }
        if (result.exitCode !== 0) {
          const why = result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 80) ?? ''
          $.ui.toast(`the command exited ${result.exitCode}${why ? `: ${why}` : ''}`)
        }
      } catch {
        // a failure of its own never changes how the turn ended
      }
    })()
    return done
  })
}
