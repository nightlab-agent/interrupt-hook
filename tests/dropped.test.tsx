import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type $T = Parameters<TestBody>[0]

// Prompts dropped beneath, late and early, around the interrupt. A hook beneath can answer the entered shape with its
// optional `drop` key present and undefined (PromptSubmitResult, index.d.ts).

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
const submit = ($: $T, text: string, turnId?: string) => $.prompt.submit({
  text, wait: false, origin: { kind: 'composer' }, ...(turnId ? { turnId } : {}),
})

type Beneath = 'enter' | 'drop' | 'hold-then-drop' | 'enter-with-drop-key'

const world = (on: On, beneath: (text: string) => Beneath) => {
  const entered = gate()
  const release = gate()
  const waited = gate()
  const held = gate()
  const heldRelease = gate()
  const waits: number[] = []
  const runs: string[] = []
  const status: string[] = []
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.id', async () => { entered.open(); await release.wait; return { value: 'sess-1' } })
  on('session.cwd', () => ({ value: '/work/first' }))
  on('prompt.submit', async (_, e) => {
    const how = beneath(e.text)
    if (how === 'drop') return { drop: 'refused' }
    if (how === 'hold-then-drop') { held.open(); await heldRelease.wait; return { drop: 'refused' } }
    // UserPromptSubmit wrote "working"
    status.push('working')
    if (how === 'enter-with-drop-key') return { text: e.text, drop: undefined }
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
  return { entered, release, waited, waits, held, heldRelease, runs, status }
}

// 1. Two prompts queued over turn-1; a plugin beneath drops the first. The second still waits for its turn
//    (send now), but the drop cleared queuedOn, so the interrupt no longer waits for it.
test('a dropped prompt before a second queued over the same turn: the interrupt still waits for the second', OPT, async ($, on) => {
  const w = world(on, t => (t === 'A' ? 'hold-then-drop' : 'enter'))
  const a = submit($, 'A', 'turn-1')      // a guard plugin beneath is still deciding on A
  await w.held.wait
  await submit($, 'B', 'turn-1')          // enters the queue; UserPromptSubmit wrote "working"
  w.heldRelease.open()
  await a                                 // A dropped: queuedOn cleared though B is still queued over turn-1
  await interrupt($)                      // send now cuts turn-1
  await w.entered.wait
  w.release.open()
  await settle()
  expect(w.waits).toEqual([1000])
})

test('one prompt queued over the turn: the interrupt waits for it', OPT, async ($, on) => {
  const w = world(on, () => 'enter')
  await submit($, 'B', 'turn-1')
  await interrupt($)
  await w.entered.wait
  w.release.open()
  await settle()
  expect(w.waits).toEqual([1000])
})

test('a dropped prompt before a second queued over the same turn: idle is not written over the second prompt\'s working when its turn starts', OPT, async ($, on) => {
  const w = world(on, t => (t === 'A' ? 'hold-then-drop' : 'enter'))
  const a = submit($, 'A', 'turn-1')
  await w.held.wait
  await submit($, 'B', 'turn-1')
  w.heldRelease.open()
  await a
  await interrupt($)
  await w.entered.wait
  w.release.open()
  await settle()
  await start($)                          // B's turn begins, as in tests/queued.test.tsx
  w.waited.open()
  await settle()
  expect(w.status).toEqual(['working'])
})

// 2. The decrement on a drop can cancel a later prompt's increment: moves equals movesAtEnd again while that
//    later prompt is between its "working" and its turn.
test('a queued prompt dropped after the cut, then a new prompt during the wait: the command is skipped', OPT, async ($, on) => {
  const w = world(on, t => (t === 'A' ? 'hold-then-drop' : 'enter'))
  const a = submit($, 'A', 'turn-1')      // queued over turn-1; a hook beneath still deciding
  await w.held.wait
  await interrupt($)                      // Escape; movesAtEnd counts A
  await w.entered.wait
  w.release.open()
  await settle()                          // now inside the one-second wait
  w.heldRelease.open()
  await a                                 // A dropped: moves--
  await submit($, 'B')                    // typed after the interrupt: moves++, "working" written
  w.waited.open()
  await settle()
  expect(w.status).toEqual(['working'])
})

test('the same drop landing before the cut: the new prompt during the wait skips the command', OPT, async ($, on) => {
  const w = world(on, t => (t === 'A' ? 'drop' : 'enter'))
  await submit($, 'A', 'turn-1')          // dropped before the cut
  await interrupt($)
  await w.entered.wait
  await submit($, 'B')                    // typed during the lookups
  w.release.open()
  w.waited.open()
  await settle()
  expect(w.status).toEqual(['working'])
})

// 3. A hook beneath answers the entered shape with its optional `drop` key present and undefined.
test('a prompt entered beneath with `drop: undefined` during the lookups still skips the command', OPT, async ($, on) => {
  const w = world(on, () => 'enter-with-drop-key')
  await interrupt($)
  await w.entered.wait
  await submit($, 'B')
  w.release.open()
  await settle()
  expect(w.status).toEqual(['working'])
})

test('the same prompt entered without the key skips the command', OPT, async ($, on) => {
  const w = world(on, () => 'enter')
  await interrupt($)
  await w.entered.wait
  await submit($, 'B')
  w.release.open()
  await settle()
  expect(w.status).toEqual(['working'])
})

// A plugin beneath is still deciding when the interrupt comes, and drops the prompt after it.
test('a prompt held beneath at the cut and dropped after it does not skip the command', OPT, async ($, on) => {
  const w = world(on, () => 'hold-then-drop')
  const a = submit($, 'A', 'turn-1')
  await w.held.wait
  await interrupt($)
  await w.entered.wait
  w.release.open()
  await settle()
  w.heldRelease.open()
  await a
  w.waited.open()
  await settle()
  expect(w.status).toEqual(['idle'])
})

test('comparison: a prompt still being decided, typed during the lookups, skips the command', OPT, async ($, on) => {
  const w = world(on, () => 'hold-then-drop')
  await interrupt($)
  await w.entered.wait
  const a = submit($, 'A')
  await w.held.wait
  w.release.open()
  await settle()
  expect(w.status).toEqual([])
  w.heldRelease.open()
  await a
})

test('a refused wait does not put the command ahead of a queued prompt', OPT, async ($, on) => {
  const runs: string[] = []
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/first' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('process.run', (_, e) => {
    runs.push(String(e.init?.stdin))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('clock.sleep', () => ({ deny: 'timer unavailable' }))
  await submit($, 'B', 'turn-1')
  await interrupt($)
  await settle()
  expect(runs).toEqual([])
})

test('a refused wait says the command did not run', OPT, async ($, on) => {
  const toasts: string[] = []
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/first' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('clock.sleep', () => ({ deny: 'timer unavailable' }))
  await submit($, 'B', 'turn-1')
  await interrupt($)
  await settle()
  expect(toasts).toEqual(['the command did not run: the wait for your queued prompt was refused'])
})
