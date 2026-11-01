import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type $T = Parameters<TestBody>[0]

// Two of the three collision kinds. The engine below: session.id waits on a gate when the test
// asks (the lookup before the command), and process.run can be held open (a slow command).
const world = (on: On, gates: { id?: boolean; run?: boolean } = {}) => {
  const runs: string[] = []
  const finished: string[] = []
  let openId: () => void = () => {}
  let openRun: () => void = () => {}
  const idGate = new Promise<void>(r => { openId = r })
  const runGate = new Promise<void>(r => { openRun = r })
  let held = gates.run === true
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: (e as { turnId?: string }).turnId ?? 't' }) as never)
  on('session.id', async () => {
    if (gates.id) await idGate
    return { value: 'sess-1' }
  })
  on('session.cwd', () => ({ value: '/work/app' }))
  on('process.run', async (_, e) => {
    const turn = JSON.parse(String(e.init?.stdin)).turn_id as string
    runs.push(turn)
    // only the first command is slow: it is still running when the second interrupt comes
    if (held) {
      held = false
      await runGate
    }
    finished.push(turn)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  return { runs, finished, openId: () => openId(), openRun: () => openRun() }
}
const settle = () => new Promise(r => setTimeout(r, 50))
const interrupt = ($: $T, turnId: string) =>
  $.turn.complete({ answer: '', durationMs: 4200, isAborted: true, turnId, reason: 'aborted' } as Parameters<$T['turn']['complete']>[0])
const start = ($: $T, turnId: string, agentId?: string) =>
  $.turn.start({ prompt: 'next', turnId, ...(agentId ? { agentId } : {}) } as unknown as Parameters<$T['turn']['start']>[0])

const OPT = { options: { command: 'echo idle > status' } }

test('two at once: a second interrupt while the first command still runs: each runs once, with its own turn id', OPT, async ($, on) => {
  const w = world(on, { run: true })
  await interrupt($, 'turn-1')
  await settle() // turn-1's command has started and is held
  await start($, 'turn-2')
  await interrupt($, 'turn-2')
  await settle()
  expect(w.runs).toEqual(['turn-1', 'turn-2'])
  w.openRun()
  await settle()
  expect(w.finished.sort()).toEqual(['turn-1', 'turn-2'])
})

test('two at once (comparison): the same two interrupts one after the other run the same two commands', OPT, async ($, on) => {
  const w = world(on)
  await interrupt($, 'turn-1')
  await settle()
  await start($, 'turn-2')
  await interrupt($, 'turn-2')
  await settle()
  expect(w.runs).toEqual(['turn-1', 'turn-2'])
})

test("look-alikes: a subagent's turn starting after an interrupt is not the next prompt; the command still runs", OPT, async ($, on) => {
  const w = world(on, { id: true })
  await interrupt($, 'turn-1')
  await start($, 'sub-1', 'agent-a')
  w.openId()
  await settle()
  expect(w.runs).toEqual(['turn-1'])
})

test("look-alikes (comparison): a main turn starting there is the next prompt; the stale command runs nothing", OPT, async ($, on) => {
  const w = world(on, { id: true })
  await interrupt($, 'turn-1')
  await start($, 'turn-2')
  w.openId()
  await settle()
  expect(w.runs).toEqual([])
})
