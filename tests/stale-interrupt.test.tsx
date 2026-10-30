import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type $T = Parameters<TestBody>[0]

// session.id answers only when the test opens the gate: the round trip the mod awaits before it runs the command.
const world = (on: On) => {
  const runs: string[] = []
  let open: () => void = () => {}
  const gate = new Promise<void>(r => { open = r })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', () => ({ turnId: 'turn-2' }) as never)
  on('session.id', async () => { await gate; return { value: 'sess-1' } })
  on('session.cwd', () => ({ value: '/work/app' }))
  on('process.run', (_, e) => {
    runs.push(String(e.init?.stdin))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  return { runs, open: () => open() }
}
const settle = () => new Promise(r => setTimeout(r, 50))
const interrupt = ($: $T) => $.turn.complete({ answer: '', durationMs: 4200, isAborted: true, turnId: 'turn-1', reason: 'aborted' } as Parameters<$T['turn']['complete']>[0])

test('a stale interrupt: an interrupt whose command would land after the next main turn has started runs nothing',
  { options: { command: 'echo idle > status' } }, async ($, on) => {
  const w = world(on)
  await interrupt($)
  // the person sends the next prompt: the main loop's new turn starts (their UserPromptSubmit hook wrote "working")
  await $.turn.start({ prompt: 'next', turnId: 'turn-2' } as unknown as Parameters<$T['turn']['start']>[0])
  w.open()
  await settle()
  // "idle" now lands after "working": the stale interrupt overwrites the newer state
  expect(w.runs.length).toBe(0)
})

test('a stale interrupt, comparison: an interrupt with no new turn after it runs the command once',
  { options: { command: 'echo idle > status' } }, async ($, on) => {
  const w = world(on)
  await interrupt($)
  w.open()
  await settle()
  expect(w.runs.length).toBe(1)
})
