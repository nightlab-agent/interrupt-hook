import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type $T = Parameters<TestBody>[0]

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

// Each gate models a slow hook or host call. No real process or file is used.
const world = (on: On, hold: 'complete' | 'id') => {
  const entered = gate()
  const release = gate()
  const promptEntered = gate()
  const promptRelease = gate()
  const runs: { session_id: string; cwd: string; turn_id: string }[] = []
  const status: string[] = []
  let session = 'sess-1'
  let cwd = '/work/first'
  on('turn.complete', async (_, e) => {
    if (hold === 'complete') { entered.open(); await release.wait }
    return { text: e.answer }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.id', async () => {
    if (hold === 'id') { entered.open(); await release.wait }
    return { value: session }
  })
  on('session.cwd', () => ({ value: cwd }))
  on('session.end', (_, e) => {
    session = 'sess-2'
    cwd = '/work/second'
    return { sessionId: e.sessionId }
  })
  on('prompt.submit', async (_, e) => {
    // UserPromptSubmit has written working, but another settings hook still waits.
    // Engine declarations: TurnStartInput, index.d.ts:14381-14383, Claude Code 2.1.312.
    status.push('working')
    promptEntered.open()
    await promptRelease.wait
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    runs.push(JSON.parse(String(e.init?.stdin)))
    status.push('idle')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  return { entered, release, promptEntered, promptRelease, runs, status }
}

test('a new main turn during next(e) makes the older interrupt stale', OPT, async ($, on) => {
  const w = world(on, 'complete')
  const ending = interrupt($)
  await w.entered.wait
  await start($)
  w.release.open()
  await ending
  await settle()
  expect(w.runs).toEqual([])
})

test('comparison: a delayed next(e) with no newer turn runs once', OPT, async ($, on) => {
  const w = world(on, 'complete')
  const ending = interrupt($)
  await w.entered.wait
  w.release.open()
  await ending
  await settle()
  expect(w.runs.map(r => r.turn_id)).toEqual(['turn-1'])
})

test('the next prompt writes working before turn.start; a pending interrupt must not overwrite it', OPT, async ($, on) => {
  const w = world(on, 'id')
  await interrupt($)
  await w.entered.wait
  const submitting = $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  await w.promptEntered.wait
  w.release.open()
  await settle()
  const beforeTurnStart = [...w.status]
  w.promptRelease.open()
  await submitting
  await start($)
  expect(beforeTurnStart).toEqual(['working'])
})

test('comparison: turn.start before the lookup finishes suppresses the interrupt', OPT, async ($, on) => {
  const w = world(on, 'id')
  await interrupt($)
  await w.entered.wait
  await start($)
  w.release.open()
  await settle()
  expect(w.runs).toEqual([])
})

test('quitting is not a session switch: the pending command still runs', OPT, async ($, on) => {
  const w = world(on, 'id')
  await interrupt($)
  await w.entered.wait
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  w.release.open()
  await settle()
  expect(w.runs.length).toBe(1)
})

test('a session switch must not run the old turn command under the new session', OPT, async ($, on) => {
  const w = world(on, 'id')
  await interrupt($)
  await w.entered.wait
  await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  w.release.open()
  await settle()
  // Skipping obsolete work or retaining its original owner is safe; mixing owners is not.
  expect(w.runs.filter(r => r.session_id !== 'sess-1' || r.cwd !== '/work/first')).toEqual([])
})

test('comparison: without a session switch the pending command keeps its owner', OPT, async ($, on) => {
  const w = world(on, 'id')
  await interrupt($)
  await w.entered.wait
  w.release.open()
  await settle()
  expect(w.runs).toEqual([{ session_id: 'sess-1', cwd: '/work/first', turn_id: 'turn-1', hook_event_name: 'UserInterrupt', duration_ms: 4200 }])
})
