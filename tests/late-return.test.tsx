import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]
const gate = () => {
  let open: () => void = () => {}
  const wait = new Promise<void>(r => { open = r })
  return { wait, open: () => open() }
}
const settle = () => new Promise(r => setTimeout(r, 50))
const OPT = { options: { command: 'echo idle' } }
const interrupt = ($: Engine) => $.turn.complete({
  answer: '', durationMs: 100, isAborted: true, turnId: 'turn-1', reason: 'aborted',
})
const submit = ($: Engine) => $.prompt.submit({
  text: 'next', wait: false, origin: { kind: 'composer' },
})
const world = (on: On) => {
  const lookup = gate()
  const releaseLookup = gate()
  const runs: string[] = []
  on('session.id', async () => {
    lookup.open()
    await releaseLookup.wait
    return { value: 'session-1' }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('process.run', (_, e) => {
    runs.push(JSON.parse(String(e.init?.stdin)).turn_id)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  return { lookup, releaseLookup, runs }
}

// PromptSubmitResult says next(e) resolves after the turn starts (or queues),
// not after it ends. A lower hook can hold its answer after starting the turn.
const scenario = (delayed: boolean): TestBody => async ($, on) => {
  const w = world(on)
  const started = gate()
  const releasePrompt = gate()
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', async (_, e) => {
    await $.turn.start({ text: e.text, turnId: 'turn-1' })
    started.open()
    await releasePrompt.wait
    return { text: e.text }
  })
  const prompt = submit($)
  await started.wait
  if (!delayed) { releasePrompt.open(); await prompt }
  await interrupt($)
  await w.lookup.wait
  if (delayed) { releasePrompt.open(); await prompt }
  w.releaseLookup.open()
  await settle()
  expect(w.runs).toEqual(['turn-1'])
}

test("comparison: the turn's own prompt returns before its interrupt", OPT, scenario(false))
test("the turn's own prompt returning after its interrupt must not suppress its command", OPT, scenario(true))
