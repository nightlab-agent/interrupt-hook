import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type $T = Parameters<TestBody>[0]

// A prompt typed while turn-1 runs. The engine raises prompt.submit at Enter, with the running
// turn's id (index.d.ts:4231-4232 "Typed while a turn ran, it fires at Enter, with that turn's id"; 9628-9636
// turnId; the binary: "prompt.submit at Enter failed, leaving it to the drain"). "Enter to send them immediately"
// then cuts turn-1 as an abort (binary: sendNowCutTurn; by: "stop" | "send-now") and the queued prompt starts
// turn-2 with no second prompt.submit. The person's UserPromptSubmit hook wrote "working" at Enter.

const gate = () => {
  let open: () => void = () => {}
  const wait = new Promise<void>(r => { open = r })
  return { wait, open: () => open() }
}
const settle = () => new Promise(r => setTimeout(r, 50))
const OPT = { options: { command: 'echo idle > status' } }
const start = ($: $T) => $.turn.start({ text: 'next', turnId: 'turn-2' })
const interrupt = ($: $T) => $.turn.complete({
  answer: '', durationMs: 4200, isAborted: true, turnId: 'turn-1', reason: 'aborted',
})
const queuedOver = ($: $T, turnId: string | undefined) => $.prompt.submit({
  text: 'next', wait: false, origin: { kind: 'composer' }, ...(turnId ? { turnId } : {}),
})

const world = (on: On, drop = false, hold?: ReturnType<typeof gate>) => {
  const entered = gate()
  const release = gate()
  const waited = gate()
  const waits: number[] = []
  const runs: string[] = []
  const status: string[] = []
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.id', async () => { entered.open(); await release.wait; return { value: 'sess-1' } })
  on('session.cwd', () => ({ value: '/work/first' }))
  on('prompt.submit', async (_, e) => {
    await hold?.wait
    if (drop) return { drop: 'refused' }
    status.push('working')
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    runs.push(JSON.parse(String(e.init?.stdin)).turn_id)
    status.push('idle')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('clock.sleep', async (_, e) => {
    waits.push(e.ms)
    await waited.wait
    return { value: undefined }
  })
  return { entered, release, waited, waits, runs, status }
}

test('a prompt queued over the running turn, then the turn cut (send now): the interrupt does not write idle over its working', OPT, async ($, on) => {
  const w = world(on)
  await queuedOver($, 'turn-1')          // Enter while turn-1 runs: UserPromptSubmit wrote "working"
  await interrupt($)                     // the cut ends turn-1 as aborted
  await w.entered.wait
  w.release.open()
  await settle()
  expect(w.waits).toEqual([1000])
  await start($)                         // the queued prompt begins turn-2; no second prompt.submit
  w.waited.open()
  await settle()
  expect(w.status).toEqual(['working'])
})

test('the same prompt sent after the interrupt is skipped', OPT, async ($, on) => {
  const w = world(on)
  await interrupt($)
  await w.entered.wait
  await queuedOver($, undefined)
  w.release.open()
  await settle()
  await start($)
  expect(w.status).toEqual(['working'])
})

test('no prompt queued over the turn: the command runs once', OPT, async ($, on) => {
  const w = world(on)
  await interrupt($)
  await w.entered.wait
  w.release.open()
  await settle()
  expect(w.runs).toEqual(['turn-1'])
})

test('a queued prompt whose turn never starts (given back to the composer): the command still runs after its wait', OPT, async ($, on) => {
  const w = world(on)
  w.release.open()
  await queuedOver($, 'turn-1')
  await interrupt($)
  await settle()
  expect(w.runs).toEqual([])
  w.waited.open()
  await settle()
  expect(w.runs).toEqual(['turn-1'])
})

test('a queued prompt still beneath the plugin when the turn is cut, then given back to the composer: the command still runs', OPT, async ($, on) => {
  const hold = gate()
  const w = world(on, false, hold)
  w.release.open()
  const queued = queuedOver($, 'turn-1')
  await interrupt($)
  await settle()
  hold.open()
  await queued
  expect(w.runs).toEqual([])
  w.waited.open()
  await settle()
  expect(w.runs).toEqual(['turn-1'])
})

test('a prompt queued over a turn that ended with an answer does not delay the next interrupt', OPT, async ($, on) => {
  const w = world(on)
  w.release.open()
  await queuedOver($, 'turn-1')
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 'turn-2', reason: 'aborted' })
  await settle()
  expect(w.runs).toEqual(['turn-2'])
})

test('a prompt dropped beneath the plugin during the lookups does not skip the command', OPT, async ($, on) => {
  const w = world(on, true)
  await interrupt($)
  await w.entered.wait
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  w.release.open()
  await settle()
  expect(w.runs).toEqual(['turn-1'])
})
