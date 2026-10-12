import { expect, mock, test } from 'claude-code/testing'

const OFF = { options: { dock: false, installAssets: false, chrome: false, theme: 'claude' } }
const CRIT = '#EC7070'

type Result = { result: unknown; isError?: true; text?: string }

function world(on: any, placed = true) {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on)
  const results: Record<string, Result> = {}
  const waits: Record<string, number> = {}
  const sent = { id: '' }
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.root', () => ({ value: '/repo' }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'ag1' }))
  on('tool.call', async (_$: unknown, e: { tool_use_id: string }) => {
    // Tidepool re-runs task calls as its own, under a fresh id: those answer for the call the test made.
    const id = e.tool_use_id in waits ? e.tool_use_id : sent.id
    if (waits[id]) await clock.sleep(waits[id]!)
    return results[id] ?? { result: {} }
  })
  const asked = { panes: 0 }
  on('ui.panes', () => {
    asked.panes++
    return { value: [{ id: 'tidepool-rail', title: 'tidepool', isShown: true, isFocused: false, isPlaced: placed }] }
  })
  on('ui.open', () => ({ value: { isPlaced: placed } }))
  on('ui.close', () => ({ value: undefined }))
  on('env.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name, agent: '' } }))
  on('session.start', () => ({ cwd: '/repo' }))
  return { clock, results, waits, sent, asked }
}

type World = ReturnType<typeof world>

async function call($: any, w: World, id: string, tool: string, input: Record<string, unknown>, ms = 0, result?: Result) {
  if (result) w.results[id] = result
  w.waits[id] = ms
  w.sent.id = id
  const pending = $.tool.call({ tool, tool_use_id: id, ...input })
  if (ms) await w.clock.advance(ms)
  await pending
}

const complete = (turnId: string) => ({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' as const })

const row = (id: string, tool: string, input: unknown, extra: Record<string, unknown> = {}) => ({
  plugin: 'tidepool', surface: 'terminal', component: 'ToolUse', requestId: id,
  props: { tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra },
}) as const

const paneAt = (placement: 'dock' | 'inline') => ({ plugin: 'tidepool', surface: 'terminal', component: 'Pane', requestId: 'tidepool-rail',
  props: { title: 'tidepool', isFocused: false, bodyColumns: 46, placement, scroll: { offset: 0, bodyRows: 40 }, view: {} } }) as const
const pane = paneAt('dock')

// The rail has drawn docked beside the transcript, which is when tool rows hand over to it.
const docked = async ($: any, placement: 'dock' | 'inline' = 'dock') => (await $.ui.mount(paneAt(placement))).unmount()

const textOf = async (ui: any) =>
  [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map((n: any) => n.text ?? '').join('')

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

async function threeCalls($: any, w: World) {
  await $.turn.start({ text: 'go', turnId: 't1' })
  await call($, w, 'r1', 'Read', { file_path: '/repo/a.ts' }, 100)
  await call($, w, 'r2', 'Read', { file_path: '/repo/b.ts' }, 100)
  await call($, w, 'b1', 'Bash', { command: 'npm test' }, 2000, { isError: true, result: 'Exit code 1', text: 'Exit code 1' })
}

test('first tool row of a turn draws the anchor; the rest draw nothing', OFF, async ($, on) => {
  const w = world(on)
  await threeCalls($, w)
  await docked($)
  const first = await textOf(await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' })))
  // The failed Bash opened nothing: it shows in the error count, not the receipt.
  expect(first).toContain('◇ 2 read · ')
  expect(first).toContain('▸ rail')
  expect(await textOf(await $.ui.mount(row('r2', 'Read', { file_path: '/repo/b.ts' })))).toBe('')
  const result = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', component: 'ToolResult', requestId: 'r1', props: { tool_use_id: 'r1', tool: 'Read', output: {}, isErrored: false } } as never)
  expect(await textOf(result)).toBe('')
})

test('anchor counts errors in the crit colour', OFF, async ($, on) => {
  const w = world(on)
  await threeCalls($, w)
  await docked($)
  const ui = await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' }))
  const err = await ui.find({ type: 'Text', text: ' · 1 error' })
  expect(err?.props.color).toBe(CRIT)
})

test('anchor names agents and background jobs', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await call($, w, 'tu1', 'Agent', { description: 'Explore', prompt: 'p', subagent_type: 'Explore' }, 100)
  await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'Explore', subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: true, fork: false })
  await call($, w, 'b1', 'Bash', { command: 'npm run dev' }, 100, { result: { backgroundTaskId: 'j1' } })
  await docked($)
  const text = await textOf(await $.ui.mount(row('tu1', 'Agent', { description: 'Explore' })))
  expect(text).toContain('1 agent')
  // A background shell is a shell in the receipt.
  expect(text).toContain('1 shell')
})

test('pressing the anchor pins its turn in the rail', OFF, async ($, on) => {
  const w = world(on)
  await threeCalls($, w)
  await $.turn.complete(complete('t1'))
  await docked($)
  const ui = await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' }))
  await ui.press({ key: 'anchor' })
  expect(await textOf(await $.ui.mount(pane))).toContain('pinned')
})

test('the rail follows the anchor on screen', OFF, async ($, on) => {
  const w = world(on)
  await start($)
  await threeCalls($, w)
  await $.turn.complete(complete('t1'))
  await $.turn.start({ text: 'again', turnId: 't2' })
  await call($, w, 'r9', 'Read', { file_path: '/repo/z.ts' }, 100)
  await $.turn.complete(complete('t2'))
  await docked($)
  await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' }, { onScreen: { first: 0, last: 2, of: 3 } }))
  await $.ui.mount(row('r9', 'Read', { file_path: '/repo/z.ts' }, { onScreen: null }))
  await w.clock.advance(1000)
  expect(await textOf(await $.ui.mount(pane))).toContain('turn 1')
})

test('with rail off, rows render as before', { options: { ...OFF.options, rail: false } }, async ($, on) => {
  const w = world(on)
  await threeCalls($, w)
  expect(await textOf(await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' })))).toContain('◇ Read a.ts')
})

test('before the rail has drawn, rows render as before', OFF, async ($, on) => {
  const w = world(on, false)
  await threeCalls($, w)
  expect(await textOf(await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' })))).toContain('◇ Read a.ts')
})

test('a call the tracker never saw keeps its row', OFF, async ($, on) => {
  world(on)
  expect(await textOf(await $.ui.mount(row('old', 'Read', { file_path: '/repo/a.ts' })))).toContain('◇ Read a.ts')
})

test('a folded group unfolds into rows while the rail is on', OFF, async ($, on) => {
  world(on)
  on('ui.render', { component: 'ToolGroup' }, ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>{`expanded:${e.props.isExpanded}`}</Text>
  })
  await docked($)
  const calls = [{ tool: 'Read', input: { file_path: '/a' }, isRunning: false, isErrored: false, isInterrupted: false }]
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', component: 'ToolGroup', requestId: 'g1', props: { calls, isActive: false, isExpanded: false } } as never)
  expect(await textOf(ui)).toBe('expanded:true')
})

test('in normal mode the inline rail leaves tool rows in the chat', OFF, async ($, on) => {
  const w = world(on)
  await threeCalls($, w)
  await docked($, 'inline')
  expect(await textOf(await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' })))).toContain('◇ Read a.ts')
})

test('a turn whose first call draws no row still gets an anchor', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'plan', turnId: 't1' })
  await call($, w, 'td1', 'TodoWrite', { todos: [] }, 50)
  await call($, w, 'r1', 'Read', { file_path: '/repo/a.ts' }, 100)
  await docked($)
  expect(await textOf(await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' })))).toContain('◇ 1 read')
})

test('tool rows ask the engine nothing on each render', OFF, async ($, on) => {
  const w = world(on)
  await threeCalls($, w)
  await docked($)
  const before = w.asked.panes
  await $.ui.mount(row('r1', 'Read', { file_path: '/repo/a.ts' }))
  await $.ui.mount(row('r2', 'Read', { file_path: '/repo/b.ts' }))
  expect(w.asked.panes).toBe(before)
})

test('a failing usage read does not block a prompt', OFF, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => {
    throw new Error('no usage here')
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  const done = await $.prompt.submit({ text: 'hello', origin: { kind: 'composer' } } as never)
  expect(done.text).toBe('hello')
})
