import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { argv, timeoutMs } from './register'

// The test runner has setTimeout; the engine's declarations leave it out.
declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

// Each test stands for the engine beneath the plugin: it answers the session's
// id and folder, runs no real command (it records each `process.run` and answers
// as the test says), and keeps the toasts. Each test sets the `command` option.

type On = Parameters<TestBody>[1]
type $T = Parameters<TestBody>[0]

type Run = { argv: readonly string[]; stdin?: string; timeoutMs?: number }

const world = (on: On, opts: { exit?: number; stderr?: string; noSh?: boolean; slow?: boolean } = {}) => {
  const runs: Run[] = []
  const toasts: string[] = []
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('process.run', (_, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin as string | undefined, timeoutMs: e.init?.timeoutMs })
    // a { deny } is how a test makes $.process.run reject, as the engine does for both of these
    if (opts.noSh) return { deny: `spawn ${e.argv[0]} ENOENT` }
    // still running at timeoutMs (claude-code.d.ts:3593-3594): the command did start
    if (opts.slow) return { deny: `still running after ${e.init?.timeoutMs}ms, killed` }
    return { value: { exitCode: opts.exit ?? 0, stdout: '', stderr: opts.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
  return { runs, toasts }
}

const OPT = { options: { command: 'echo interrupted' } }

// The command runs after the turn has ended, so each end waits a moment for it before the test looks.
const settle = () => new Promise(r => setTimeout(r, 50))

const end = async ($: $T, fields: { reason: 'answer' | 'aborted' | 'error'; agentId?: string; turnId?: string }) => {
  const r = await $.turn.complete({
    answer: '',
    durationMs: 4200,
    isAborted: fields.reason === 'aborted',
    turnId: fields.turnId ?? 'turn-1',
    reason: fields.reason,
    ...(fields.agentId ? { agentId: fields.agentId } : {}),
  } as Parameters<$T['turn']['complete']>[0])
  await settle()
  return r
}

test('an interrupted main turn runs the command once, with the JSON line on stdin', OPT, async ($, on) => {
  const { runs, toasts } = world(on)
  await end($, { reason: 'aborted', turnId: 'turn-7' })
  expect(runs.length).toBe(1)
  expect(runs[0]!.argv).toEqual(['sh', '-c', 'echo interrupted'])
  expect(JSON.parse(runs[0]!.stdin!)).toEqual({
    hook_event_name: 'UserInterrupt', session_id: 'sess-1', cwd: '/work/app', turn_id: 'turn-7', duration_ms: 4200,
  })
  expect(runs[0]!.stdin!.endsWith('}\n')).toBe(true)
  expect(runs[0]!.timeoutMs).toBe(10_000)
  expect(toasts).toEqual([])
})

test('a turn that ended with an answer or an error runs nothing; an interrupted one beside it still runs', OPT, async ($, on) => {
  const { runs } = world(on)
  await end($, { reason: 'answer' })
  await end($, { reason: 'error' })
  expect(runs.length).toBe(0)
  await end($, { reason: 'aborted' })
  expect(runs.length).toBe(1)
})

test("a subagent's interrupted run runs nothing; the main loop's does", OPT, async ($, on) => {
  const { runs } = world(on)
  await end($, { reason: 'aborted', agentId: 'agent-1' })
  expect(runs.length).toBe(0)
  await end($, { reason: 'aborted' })
  expect(runs.length).toBe(1)
})

test('two interrupts run the command twice, each with its own turn id', OPT, async ($, on) => {
  const { runs } = world(on)
  await end($, { reason: 'aborted', turnId: 'turn-1' })
  await end($, { reason: 'aborted', turnId: 'turn-2' })
  expect(runs.map(r => JSON.parse(r.stdin!).turn_id)).toEqual(['turn-1', 'turn-2'])
})

test('with no sh, nothing else is tried: one toast names the error and the turn still ends as it did', OPT, async ($, on) => {
  const { runs, toasts } = world(on, { noSh: true })
  const r = await end($, { reason: 'aborted' })
  expect(runs.map(r => r.argv[0])).toEqual(['sh'])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('spawn sh ENOENT')
  expect(r).toBeDefined()
})

test('a command that started and timed out runs once, never a second time', OPT, async ($, on) => {
  const { runs, toasts } = world(on, { slow: true })
  await end($, { reason: 'aborted' })
  expect(runs.length).toBe(1)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('still running after 10000ms')
})

test('a command that exits 0 gives no toast (the comparison case)', OPT, async ($, on) => {
  const { runs, toasts } = world(on)
  await end($, { reason: 'aborted' })
  expect(runs.length).toBe(1)
  expect(toasts).toEqual([])
})

test('a command that exits non-zero gives one toast with the exit code and its first stderr line', OPT, async ($, on) => {
  const { toasts } = world(on, { exit: 2, stderr: 'no such host\nmore' })
  await end($, { reason: 'aborted' })
  expect(toasts).toEqual(['interrupt-hook: the command exited 2: no such host'])
})

test('with no command set, an interrupted turn runs nothing', { options: {} }, async ($, on) => {
  const { runs, toasts } = world(on)
  await end($, { reason: 'aborted' })
  expect(runs.length).toBe(0)
  expect(toasts).toEqual([])
})

test('the timeout option reaches the command', { options: { command: 'x', timeout: '3' } }, async ($, on) => {
  const { runs } = world(on)
  await end($, { reason: 'aborted' })
  expect(runs[0]!.timeoutMs).toBe(3_000)
})

test('argv and timeoutMs: the look-alike values', async () => {
  expect(argv('x')).toEqual(['sh', '-c', 'x'])
  expect(timeoutMs(undefined)).toBe(10_000)
  expect(timeoutMs('')).toBe(10_000)
  expect(timeoutMs('abc')).toBe(10_000)
  expect(timeoutMs(null)).toBe(10_000)
  expect(timeoutMs(' ')).toBe(10_000)
  expect(timeoutMs(0)).toBe(1_000)
  expect(timeoutMs('0')).toBe(1_000)
  expect(timeoutMs('-5')).toBe(1_000)
  expect(timeoutMs(' 10 ')).toBe(10_000)
  expect(timeoutMs('1e3')).toBe(600_000)
  expect(timeoutMs('30')).toBe(30_000)
  expect(timeoutMs(0.4)).toBe(1_000)
  expect(timeoutMs(9999)).toBe(600_000)
})
