// A prompt accepted while the lookups or the end chain run: each case beside its comparison.
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
const interrupt = ($: Engine, turnId = 'turn-1') => $.turn.complete({
  answer: '', durationMs: 100, isAborted: true, turnId, reason: 'aborted',
})
const submit = ($: Engine, turnId?: string) => $.prompt.submit({
  text: 'next', wait: false, origin: { kind: 'composer' }, ...(turnId ? { turnId } : {}),
})

// The world: session.id is held open so the check runs when the test says; clock.sleep (the queued
// wait) is held the same way; prompt.submit is scripted per test.
const world = (on: On) => {
  const lookup = gate()
  const releaseLookup = gate()
  const waited = gate()
  const waits: number[] = []
  const runs: string[] = []
  on('session.id', async () => {
    lookup.open()
    await releaseLookup.wait
    return { value: 'session-1' }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('clock.sleep', async (_, e) => { waits.push(e.ms); await waited.wait; return { value: undefined } })
  on('process.run', (_, e) => {
    runs.push(JSON.parse(String(e.init?.stdin)).turn_id)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  return { lookup, releaseLookup, waited, waits, runs }
}

// A: a stop `moves` used to give, now given by `accepted`: an idle prompt accepted during the lookups that starts
// no turn (a local slash command; PromptSubmitInput.command: prompt.submit fires for those too) still stops.
const idleNoTurn = (drop: boolean): TestBody => async ($, on) => {
  const w = world(on)
  on('prompt.submit', async (_, e) => {
    if (e.text === 'own') { await $.turn.start({ text: e.text, turnId: 'turn-1' }); return { text: e.text } }
    return drop ? { drop: 'refused' } : { text: e.text }
  })
  await $.prompt.submit({ text: 'own', wait: false, origin: { kind: 'composer' } })
  await interrupt($)
  await w.lookup.wait
  await submit($)
  w.releaseLookup.open()
  await settle()
  expect(w.runs).toEqual(drop ? ['turn-1'] : [])
}
test('A: a newer idle prompt accepted during the lookups, starting no turn, stops the command', OPT, idleNoTurn(false))
test('A comparison: the same prompt dropped beneath leaves the command to run', OPT, idleNoTurn(true))

// B: the turn's own prompt returns late AND a newer idle prompt is accepted in the same window: still a stop.
test('B: a late own return plus a newer accepted idle prompt: the command stays out', OPT, async ($, on) => {
  const w = world(on)
  const started = gate()
  const releaseOwn = gate()
  on('prompt.submit', async (_, e) => {
    if (e.text === 'own') {
      await $.turn.start({ text: e.text, turnId: 'turn-1' })
      started.open()
      await releaseOwn.wait
    }
    return { text: e.text }
  })
  const own = $.prompt.submit({ text: 'own', wait: false, origin: { kind: 'composer' } })
  await started.wait
  await interrupt($)
  await w.lookup.wait
  releaseOwn.open()
  await own
  await submit($)                       // newer, idle, accepted, no turn yet
  w.releaseLookup.open()
  await settle()
  expect(w.runs).toEqual([])
})

// C: the own prompt returns late while a second prompt is queued over the cut turn. Send-now starts turn-2
// inside the wait: no command. Handed back to the composer: the command runs (the base's `moves` stopped it).
const lateWithQueued = (sendNow: boolean): TestBody => async ($, on) => {
  const w = world(on)
  const started = gate()
  const releaseOwn = gate()
  on('prompt.submit', async (_, e) => {
    if (e.text === 'own') {
      await $.turn.start({ text: e.text, turnId: 'turn-1' })
      started.open()
      await releaseOwn.wait
    }
    return { text: e.text }
  })
  const own = $.prompt.submit({ text: 'own', wait: false, origin: { kind: 'composer' } })
  await started.wait
  await submit($, 'turn-1')             // typed over turn-1, held
  await interrupt($)
  await w.lookup.wait
  releaseOwn.open()
  await own                             // the own prompt's late return, after the end
  w.releaseLookup.open()
  await settle()
  expect(w.waits).toEqual([1000])
  if (sendNow) await $.turn.start({ text: 'next', turnId: 'turn-2' })
  w.waited.open()
  await settle()
  expect(w.runs).toEqual(sendNow ? [] : ['turn-1'])
}
test('C: late own return, queued prompt sent now (turn-2 inside the wait): no command', OPT, lateWithQueued(true))
test('C comparison: late own return, queued prompt handed back: the command runs', OPT, lateWithQueued(false))

// D: two idle prompts in flight. P1 is held BEFORE its turn starts (a slow UserPromptSubmit hook), P2 goes in
// idle and starts turn-2, turn-2 is cut, then P1's hooks finish and turn-1 starts during the lookups: no command.
test('D: an older idle prompt whose turn starts during the lookups stops the command', OPT, async ($, on) => {
  const w = world(on)
  const releaseP1 = gate()
  on('prompt.submit', async (_, e) => {
    if (e.text === 'p1') { await releaseP1.wait; await $.turn.start({ text: e.text, turnId: 'turn-1' }); return { text: e.text } }
    await $.turn.start({ text: e.text, turnId: 'turn-2' })
    return { text: e.text }
  })
  const p1 = $.prompt.submit({ text: 'p1', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'p2', wait: false, origin: { kind: 'composer' } })
  await interrupt($, 'turn-2')
  await w.lookup.wait
  releaseP1.open()
  await p1
  w.releaseLookup.open()
  await settle()
  expect(w.runs).toEqual([])
})
test('D comparison: the older idle prompt dropped during the lookups leaves the command to run', OPT, async ($, on) => {
  const w = world(on)
  const releaseP1 = gate()
  on('prompt.submit', async (_, e) => {
    if (e.text === 'p1') { await releaseP1.wait; return { drop: 'refused' } }
    await $.turn.start({ text: e.text, turnId: 'turn-2' })
    return { text: e.text }
  })
  const p1 = $.prompt.submit({ text: 'p1', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'p2', wait: false, origin: { kind: 'composer' } })
  await interrupt($, 'turn-2')
  await w.lookup.wait
  releaseP1.open()
  await p1
  w.releaseLookup.open()
  await settle()
  expect(w.runs).toEqual(['turn-2'])
})

// E: an idle prompt whose turn ended with an answer, its hooks still holding its return past the NEXT turn's cut:
// older than that end, it must not stop the next turn's command (the base's `moves` did).
test('E: an earlier prompt returning after a later turn was cut does not stop that command', OPT, async ($, on) => {
  const w = world(on)
  const releaseP1 = gate()
  on('prompt.submit', async (_, e) => {
    if (e.text === 'p1') { await $.turn.start({ text: e.text, turnId: 'turn-1' }); await releaseP1.wait; return { text: e.text } }
    await $.turn.start({ text: e.text, turnId: 'turn-2' })
    return { text: e.text }
  })
  const p1 = $.prompt.submit({ text: 'p1', wait: false, origin: { kind: 'composer' } })
  await settle()
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await $.prompt.submit({ text: 'p2', wait: false, origin: { kind: 'composer' } })
  await interrupt($, 'turn-2')
  await w.lookup.wait
  releaseP1.open()
  await p1
  w.releaseLookup.open()
  await settle()
  expect(w.runs).toEqual(['turn-2'])
})

// F: order of returns. P2 (newer) returns before P1 (older): accepted keeps the newest number.
test('F: a newer accepted idle prompt returning before an older one still stops the command', OPT, async ($, on) => {
  const w = world(on)
  const releaseOwn = gate()
  const started = gate()
  on('prompt.submit', async (_, e) => {
    if (e.text === 'own') { await $.turn.start({ text: e.text, turnId: 'turn-1' }); started.open(); await releaseOwn.wait }
    return { text: e.text }
  })
  const own = $.prompt.submit({ text: 'own', wait: false, origin: { kind: 'composer' } })
  await started.wait
  await interrupt($)
  await w.lookup.wait
  await submit($)                       // newer idle prompt, returns first, starts no turn
  releaseOwn.open()
  await own                             // older one returns after it
  w.releaseLookup.open()
  await settle()
  expect(w.runs).toEqual([])
})

// G: a newer idle prompt accepted INSIDE the cut turn's end chain (returned before the end, numbered after the
// snapshot): a stop. Comparison: the same prompt dropped there leaves the command to run.
const insideEnd = (drop: boolean): TestBody => async ($, on) => {
  const lookup = gate()
  const releaseLookup = gate()
  const ending = gate()
  const releaseEnd = gate()
  const runs: string[] = []
  on('session.id', async () => { lookup.open(); await releaseLookup.wait; return { value: 'session-1' } })
  on('session.cwd', () => ({ value: '/work' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_, e) => { ending.open(); await releaseEnd.wait; return { text: e.answer } })
  on('prompt.submit', async (_, e) => {
    if (e.text === 'own') { await $.turn.start({ text: e.text, turnId: 'turn-1' }); return { text: e.text } }
    return drop ? { drop: 'refused' } : { text: e.text }
  })
  on('process.run', (_, e) => {
    runs.push(JSON.parse(String(e.init?.stdin)).turn_id)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  await $.prompt.submit({ text: 'own', wait: false, origin: { kind: 'composer' } })
  const end = interrupt($)
  await ending.wait
  await submit($)                       // idle, newer, returns inside the end chain
  releaseEnd.open()
  await end
  await lookup.wait
  releaseLookup.open()
  await settle()
  expect(runs).toEqual(drop ? ['turn-1'] : [])
}
test('G: a newer idle prompt accepted inside the end chain stops the command', OPT, insideEnd(false))
test('G comparison: the same prompt dropped inside the end chain leaves the command to run', OPT, insideEnd(true))
