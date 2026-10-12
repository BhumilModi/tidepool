import { expect, mock, test } from 'claude-code/testing'

import { PLAN_NUDGE, RESUME_KEY, agentTools, modelName, stages } from '../hooks/plan'
import type { PlanTask } from '../types'

const BAND = { plugin: 'tidepool', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

const task = (id: string, status: PlanTask['status'], startedAt?: number, doneAt?: number): PlanTask => ({
  id, subject: id, status, createdAt: 0, ...(startedAt === undefined ? {} : { startedAt }), ...(doneAt === undefined ? {} : { doneAt }),
})

test('stages split the bar per task, the running one filled by its share of the average', async () => {
  const s = stages([task('a', 'completed', 0, 60_000), task('b', 'in_progress', 60_000), task('c', 'pending')], 90_000)!
  expect(s.map(x => x.text).join('')).toBe('━━━ ━╸─ ────')
  expect(s.filter(x => x.part === 'gap')).toHaveLength(2)
  // Longer plans widen the bar up to 24 cells; past that the caller draws the plain bar.
  const eight = stages(Array.from({ length: 8 }, (_, i) => task(String(i), 'pending')), 0)!
  expect(eight.map(x => x.text).join('')).toHaveLength(23)
  expect(stages(Array.from({ length: 9 }, (_, i) => task(String(i), 'pending')), 0)).toBeUndefined()
  // A running stage that overran its estimate still reads short of done.
  const late = stages([task('a', 'completed', 0, 1000), task('b', 'in_progress', 1000), task('c', 'pending'), task('d', 'pending')], 60_000)!
  expect(late.find(x => x.part === 'run')?.text).toBe('━╸')
})

test('modelName keeps the family', async () => {
  expect(modelName('claude-haiku-4-5')).toBe('haiku')
  expect(modelName('claude-opus-5-5')).toBe('opus')
  expect(modelName('local-llm')).toBe('local-llm')
  expect(modelName(undefined)).toBeUndefined()
})

const OFF = { options: { dock: false, installAssets: false, chrome: false, theme: 'claude' } }

// Every stub before the first $ call. AskUserQuestion stays open until `answer()`.
function world(on: any, stored?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: 1000 })
  // The store as a plain object, so a test can read what the plugin kept.
  const store: Record<string, unknown> = { ...stored }
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  let reach!: () => void
  let reachHeld!: () => void
  const gate: { answer?: () => void; release?: () => void; reached: Promise<void>; held: Promise<void>; store: Record<string, unknown>; clock: typeof clock } = {
    store,
    clock,
    reached: new Promise(r => { reach = r }),
    held: new Promise(r => { reachHeld = r }),
  }
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 200_000, percent: 1 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name, agent: '' } }))
  on('settings.read', () => ({ value: {} }))
  on('config.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  on('tool.call', (_$: unknown, e: any) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: e.subject, subject: e.subject } } }
    if (e.tool === 'AskUserQuestion') return new Promise(resolve => { gate.answer = () => resolve({ result: { answers: {} } }); reach() })
    // A Bash call held as if at its permission prompt, until `release()`.
    if (e.tool === 'Bash' && e.command === 'hold') return new Promise(resolve => { gate.release = () => resolve({ result: {} }); reachHeld() })
    return { result: {} }
  })
  return gate
}

async function plan($: any) {
  await $.tool.call({ tool: 'TaskCreate', subject: 'one', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'two', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'one', status: 'in_progress' })
}

const header = async ($: any) => {
  const ui = await $.ui.mount(BAND)
  const text = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
  await ui.unmount()
  return text
}

test('the plan reads "needs you" while a question waits, and running once it is answered', OFF, async ($, on) => {
  const gate = world(on)
  await plan($)
  const asked = $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [] } as never)
  // The question is open once it reaches beneath the plugins.
  await gate.reached
  expect(await header($)).toContain(' Plan · needs you ')
  gate.answer!()
  await asked
  expect(await header($)).not.toContain('needs you')
})

test('a call held at a permission prompt keeps the plan amber while another call returns beside it', OFF, async ($, on) => {
  const gate = world(on)
  await plan($)
  const held = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'hold' } as never)
  await gate.held
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'hold' } } as never)
  expect(await header($)).toContain(' Plan · needs you ')
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/repo/a.ts' } as never)
  expect(await header($)).toContain(' Plan · needs you ')
  gate.release!()
  await held
  expect(await header($)).not.toContain('needs you')
})

test('a call let through its permission prompt clears the amber once it is seen running, before it returns', { options: { ...OFF.options, chrome: true } }, async ($, on) => {
  const gate = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await plan($)
  const held = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'hold' } as never)
  await gate.held
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'hold' } } as never)
  expect(await header($)).toContain(' Plan · needs you ')
  // The engine draws the running call's background hint; the rail's timer reads it within a second.
  const progress = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', component: 'ToolProgress', requestId: 'b1', props: { tool_use_id: 'b1', kind: 'background_hint', hint: '(ctrl+b to run in background)' } } as never)
  await progress.unmount()
  await gate.clock.advance(1000)
  expect(await header($)).not.toContain('needs you')
  gate.release!()
  await held
})

test('a permission notification no call is matched to reads amber until a call returns', { options: { ...OFF.options, alerts: false } }, async ($, on) => {
  world(on)
  await plan($)
  await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Claude needs your permission' } as never)
  expect(await header($)).toContain(' Plan · needs you ')
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/repo/a.ts' } as never)
  expect(await header($)).not.toContain('needs you')
})

test('a turn that ends on an error with tasks left reads stopped until the next turn', OFF, async ($, on) => {
  world(on)
  await plan($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: '', turnId: 't1', reason: 'error', durationMs: 1000, isAborted: false } as never)
  expect(await header($)).toContain(' Plan · stopped ')
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await header($)).not.toContain('stopped')
})

test('an approved plan-mode plan asks the model to track it as tasks; a plan already running does not', OFF, async ($, on) => {
  world(on)
  const ran = await $.tool.call({ tool: 'ExitPlanMode', plan: '1. a' } as never)
  expect(ran.context).toContain(PLAN_NUDGE)
  await $.tool.call({ tool: 'TaskCreate', subject: 'a', description: '' })
  const again = await $.tool.call({ tool: 'ExitPlanMode', plan: 'x' } as never)
  expect(again.context ?? []).not.toContain(PLAN_NUDGE)
})

test('the plan is kept per session and restored on start when unfinished', OFF, async ($, on) => {
  world(on, { [RESUME_KEY]: { '1': [task('kept', 'in_progress', 1000)] } })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await header($)).toContain('kept')
})

test('a task change keeps the plan for a resume under the session', OFF, async ($, on) => {
  const w = world(on)
  await plan($)
  const kept = w.store[RESUME_KEY] as Record<string, PlanTask[]>
  expect(kept['1']?.map(t => t.id)).toEqual(['one', 'two'])
})

test('agentTools names each agent\'s call in flight; main-loop calls are left out', async () => {
  expect(agentTools({ a: { tool: 'Grep', input: {}, agentId: 'ag1' }, b: { tool: 'Read', input: {} }, c: { tool: 'Bash', input: {}, agentId: 'ag2' } })).toEqual({ ag1: 'Grep', ag2: 'Bash' })
})
