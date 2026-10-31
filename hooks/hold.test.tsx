import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// The test runner has setTimeout; the engine's declarations leave it out.
declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

type On = Parameters<TestBody>[1]
type $T = Parameters<TestBody>[0]

// process.run answers only when the test opens the gate: a command still running.
const world = (on: On, opts: { stderr?: string; exit?: number; hold?: boolean } = {}) => {
  const toasts: string[] = []
  let open: () => void = () => {}
  const gate = new Promise<void>(r => { open = r })
  let runs = 0
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('process.run', async () => {
    runs++
    if (opts.hold) await gate
    return { value: { exitCode: opts.exit ?? 0, stdout: '', stderr: opts.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => { toasts.push(String((e as { text?: unknown }).text ?? e)); return { value: undefined } })
  return { toasts, open: () => open(), runs: () => runs }
}

const settle = () => new Promise(r => setTimeout(r, 50))

const end = ($: $T, reason: 'answer' | 'aborted') =>
  $.turn.complete({ answer: '', durationMs: 4200, isAborted: reason === 'aborted', turnId: 't1', reason } as Parameters<$T['turn']['complete']>[0])

const settlesWithin = async (p: Promise<unknown>, ms: number) =>
  Promise.race([p.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), ms))])

test('an interrupted turn ends while the command is still running',
  { options: { command: 'sleep 600', timeout: '600' } }, async ($, on) => {
  const w = world(on, { hold: true })
  const ended = await settlesWithin(end($, 'aborted'), 300)
  await settle()
  expect(w.runs()).toBe(1)
  w.open()
  expect(ended).toBe(true)
})

test('a turn that ended with an answer ends at once',
  { options: { command: 'sleep 600', timeout: '600' } }, async ($, on) => {
  const w = world(on, { hold: true })
  const ended = await settlesWithin(end($, 'answer'), 300)
  w.open()
  expect(ended).toBe(true)
})

test('a CRLF stderr gives a toast without a trailing carriage return',
  { options: { command: 'x' } }, async ($, on) => {
  const w = world(on, { exit: 2, stderr: 'no such host\r\nmore\r\n' })
  await end($, 'aborted')
  await settle()
  expect(w.toasts).toEqual(['the command exited 2: no such host'])
})

test('an LF stderr gives the first line',
  { options: { command: 'x' } }, async ($, on) => {
  const w = world(on, { exit: 2, stderr: 'no such host\nmore\n' })
  await end($, 'aborted')
  await settle()
  expect(w.toasts).toEqual(['the command exited 2: no such host'])
})
