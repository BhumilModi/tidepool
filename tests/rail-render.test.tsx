import { expect, mock, test } from 'claude-code/testing'

// Quiet the rest of the plugin: only the tracker and the rail matter here.
const OFF = { options: { dock: false, installAssets: false, chrome: false, theme: 'claude' } }

type Result = { result: unknown; isError?: true; text?: string }

function world(on: any, stored?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: 1000 })
  mock.store(on, stored)
  const usage = { startedAt: 1, context: { window: 200_000, percent: 38 }, rateLimits: [], cost: { usd: 1 } }
  const results: Record<string, Result> = {}
  const waits: Record<string, number> = {}
  const sent = { id: '' }
  const closed: string[] = []
  const opened: { id: string; title?: string }[] = []
  on('session.usage', () => ({ value: usage }))
  on('session.root', () => ({ value: '/repo' }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('classic.Notification', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('agent.spawn', () => ({ model: 'm', agentId: 'ag1' }))
  on('tool.call', async (_$: unknown, e: { tool_use_id: string }) => {
    // Tidepool re-runs task calls as its own, under a fresh id: those answer for the call the test made.
    const id = e.tool_use_id in waits ? e.tool_use_id : sent.id
    if (waits[id]) await clock.sleep(waits[id]!)
    return results[id] ?? { result: {} }
  })
  on('ui.close', (_$: unknown, e: { id: string }) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.open', (_$: unknown, e: { id: string; title?: string }) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  return { clock, usage, results, waits, sent, closed, opened }
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

const complete = (turnId: string, extra: Record<string, unknown> = {}) => ({
  answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' as const, ...extra,
})

const pane = (placement: 'dock' | 'inline' = 'dock', bodyColumns = 46, bodyRows = 40) => ({
  plugin: 'tidepool', surface: 'terminal', component: 'Pane', requestId: 'tidepool-rail',
  props: { title: 'tidepool', isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows }, view: {} },
}) as const

const textOf = async (ui: any) =>
  [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map((n: any) => n.text ?? '').join('|')

async function twoCallTurn($: any, w: World) {
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await call($, w, 'r1', 'Read', { file_path: '/repo/src/a.ts' }, 400)
  await call($, w, 'b1', 'Bash', { command: 'npm test' }, 4000, { isError: true, result: 'Exit code 1', text: 'Exit code 1\nexpected 200' })
  w.usage.context.percent = 52
  w.usage.cost.usd = 1.31
  await $.turn.complete(complete('t1'))
}

test('docked pane draws header, rows with span bars and axis, and no cost summary', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane())
  const text = await textOf(ui)
  for (const part of ['turn 1', 'Read', 'src/a.ts', 'npm test', '━', '✕', '0s']) expect(text).toContain(part)
  expect(text).not.toContain('$0.31')
  // The status line shows context; the rail does not repeat it.
  expect(text).not.toContain('ctx')
  expect(text).not.toContain('live')
})

test('pressing a row expands its detail; pressing again collapses', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane())
  expect(await textOf(ui)).not.toContain('$ npm test')
  await ui.press({ key: 'row:b1' })
  expect(await textOf(ui)).toContain('$ npm test')
  expect(await textOf(ui)).toContain('Exit code 1')
  await ui.press({ key: 'row:b1' })
  expect(await textOf(ui)).not.toContain('$ npm test')
})

test('pressing an agent row lists its child calls with └', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'look', turnId: 't1' })
  await call($, w, 'tu1', 'Agent', { description: 'Explore auth', prompt: 'p', subagent_type: 'Explore' }, 100)
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'p', description: 'Explore auth', subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: true, fork: false,
  })
  await call($, w, 'c1', 'Grep', { pattern: 'token', agentId: 'ag1' }, 100)
  await call($, w, 'c2', 'Read', { file_path: '/repo/auth.ts', agentId: 'ag1' }, 100)
  const ui = await $.ui.mount(pane())
  expect(await textOf(ui)).toContain('2 tools')
  expect(await textOf(ui)).not.toContain('└ Grep')
  await ui.press({ key: 'row:tu1' })
  expect(await textOf(ui)).toContain('└ Grep')
})

test('inline placement shows the live turn only, at most 6 rows, then one summary line', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'read', turnId: 't1' })
  for (let i = 0; i < 8; i++) await call($, w, `r${i}`, 'Read', { file_path: `/repo/f${i}.ts` }, 100)
  const ui = await $.ui.mount(pane('inline', 80))
  const text = await textOf(ui)
  expect(text).toContain('2 earlier')
  expect(text).not.toContain('f1.ts')
  expect(text).toContain('f7.ts')
  expect(text).toContain('live')
  await ui.unmount()
  await $.turn.complete(complete('t1'))
  const idle = await textOf(await $.ui.mount(pane('inline', 80)))
  expect(idle).toContain('turn 1 · ')
  expect(idle).toContain('8 tools')
  expect(idle).not.toContain('f7.ts')
})

test('the one-line inline summary counts every failed call', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await $.turn.start({ text: 'again', turnId: 't2' })
  await call($, w, 'b2', 'Bash', { command: 'npm test' }, 100, { isError: true, result: 'Exit code 1', text: 'Exit code 1' })
  await call($, w, 'b3', 'Bash', { command: 'npm test' }, 100, { isError: true, result: 'Exit code 1', text: 'Exit code 1' })
  await $.turn.complete(complete('t2'))
  expect(await textOf(await $.ui.mount(pane('inline', 80)))).toContain('2 failed')
})

test('narrow dock drops bars', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane('dock', 39))
  const text = await textOf(ui)
  expect(text).toContain('npm test')
  expect(text).not.toContain('━')
})

test('a turn with no tools says so', OFF, async ($, on) => {
  world(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(complete('t1'))
  const ui = await $.ui.mount(pane())
  expect(await textOf(ui)).toContain('from memory')
  expect(await textOf(ui)).toContain('nothing opened')
})

test('a background shell runs past its turn until its notification ends it', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'serve', turnId: 't1' })
  await call($, w, 'b1', 'Bash', { command: 'npm run dev', run_in_background: true }, 100, { result: { backgroundTaskId: 'j1' } })
  await w.clock.advance(5000)
  await $.turn.complete(complete('t1'))
  await w.clock.advance(60_000)
  const ui = await $.ui.mount(pane())
  expect(await textOf(ui)).toContain('running')
  expect(await textOf(ui)).toContain('⇢')
  await ui.unmount()
  await $.prompt.submit({ text: '<task-notification><task-id>j1</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } } as never)
  const after = await $.ui.mount(pane())
  expect(await textOf(after)).not.toContain('running')
})

test('a turn stopped with Esc still closes', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await call($, w, 'r1', 'Read', { file_path: '/repo/a.ts' }, 100)
  await $.turn.complete(complete('t1', { isAborted: true, reason: 'aborted' }))
  const ui = await $.ui.mount(pane())
  const text = await textOf(ui)
  expect(text).toContain('stopped')
  expect(text).not.toContain('live')
})

test('/clear empties the rail', OFF, async ($, on) => {
  const w = world(on)
  await $.prompt.submit({ text: 'first', origin: { kind: 'composer' } } as never)
  await twoCallTurn($, w)
  w.usage.startedAt = 2
  await $.prompt.submit({ text: 'after clear', origin: { kind: 'composer' } } as never)
  const ui = await $.ui.mount(pane())
  expect(await textOf(ui)).toContain('no turns yet')
})

function startup(on: any, panes: { id: string }[]) {
  on('env.get', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name, agent: '' } }))
  on('command.run', (_$: unknown, e: { command: string }) => ({ text: e.command }))
  on('session.start', () => ({ cwd: '/repo' }))
  on('ui.panes', () => ({ value: panes }))
}

const start = ($: any) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

test('session start closes a stale rail then opens a fresh one', OFF, async ($, on) => {
  const w = world(on)
  startup(on, [{ id: 'tidepool-rail' }])
  await start($)
  expect(w.closed).toEqual(['tidepool-rail'])
  expect(w.opened.map(o => [o.id, o.title])).toEqual([['tidepool-rail', 'tidepool']])
  // Wide enough for the timing bars.
  expect((w.opened[0] as { columns?: number }).columns).toBe(44)
})

test('with rail off nothing opens', { options: { ...OFF.options, rail: false } }, async ($, on) => {
  const w = world(on)
  startup(on, [])
  await start($)
  expect(w.opened).toEqual([])
})

test('/tidepool-rail closes an open rail and opens a closed one', OFF, async ($, on) => {
  const w = world(on)
  const panes: { id: string }[] = []
  startup(on, panes)
  await start($)
  panes.push({ id: 'tidepool-rail' })
  await $.command.run({ command: 'tidepool-rail', args: '' } as never)
  expect(w.closed).toEqual(['tidepool-rail'])
  panes.length = 0
  await $.command.run({ command: 'tidepool-rail', args: '' } as never)
  expect(w.opened.length).toBe(2)
  expect((w.opened[1] as { columns?: number }).columns).toBe(44)
})

test('with the warm theme the rail paints the Warm Claude background', { options: { ...OFF.options, theme: 'warm' } }, async ($, on) => {
  world(on)
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ type: 'Box' }))?.props.backgroundColor).toBe('#1A1817')
})

test('every other theme paints its own terminal background', { options: { ...OFF.options, theme: 'nord' } }, async ($, on) => {
  world(on)
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ type: 'Box' }))?.props.backgroundColor).toBe('#2E3440')
})

test('fixed-width pieces never shrink, so a narrow rail truncates instead of wrapping', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane('dock', 30))
  const title = await ui.find({ type: 'Text', text: 'turn 1' })
  expect(title).toBeDefined()
  const fixed = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexShrink === 0)
  // The turn line and each tool row.
  expect(fixed.length).toBeGreaterThan(2)
})

// A plan of `n` tasks named "task 1".., with task `running` in progress.
async function plan($: any, w: World, n: number, running = 1) {
  for (let i = 1; i <= n; i++) {
    await call($, w, `tc${i}`, 'TaskCreate', { subject: `task ${i}`, description: '' }, 0, { result: { task: { id: `t${i}`, subject: `task ${i}` } } })
  }
  await call($, w, 'tu-run', 'TaskUpdate', { taskId: `t${running}`, status: 'in_progress' }, 0, { result: { success: true } })
}

async function bashes($: any, w: World, n: number) {
  for (let i = 0; i < n; i++) await call($, w, `sh${i}`, 'Bash', { command: `echo ${i}`, description: `step ${i}` }, 10)
}

test('rail draws the plan section under the timeline, with no cost footer', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 3, 2)
  const text = await textOf(await $.ui.mount(pane()))
  expect(text).toContain(' Plan ')
  expect(text).toContain('▶ |2. task 2')
  // Tool names are Text; targets are Buttons, which textOf lists last.
  expect(text.indexOf(' Plan ')).toBeGreaterThan(text.indexOf('Read'))
  expect(text).not.toContain('cost')
  // The timeline's axis stays under the tool rows, above the plan.
  const axis = text.search(/\| {4,}0s +\d/)
  expect(axis).toBeGreaterThan(-1)
  expect(axis).toBeLessThan(text.indexOf(' Plan '))
})

test('with no files changed, the plan section shares the rail with the timeline and windows the rest', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 20)
  const text = await textOf(await $.ui.mount(pane('dock', 46, 24)))
  // 24 rows - brand and three headers = 20, halved with the timeline: ten plan lines, markers included.
  expect((text.match(/\d+\. task/g) ?? []).length).toBeLessThanOrEqual(10)
  expect(text).toContain('more')
})

test('tool rows trim to make room for the plan', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'build', turnId: 't1' })
  await bashes($, w, 30)
  await plan($, w, 6)
  const text = await textOf(await $.ui.mount(pane('dock', 46, 24)))
  expect(text).toContain(' earlier')
  expect(text).toContain(' Plan ')
})

test('inline rail draws no plan', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'build', turnId: 't1' })
  await plan($, w, 3)
  expect(await textOf(await $.ui.mount(pane('inline')))).not.toContain(' Plan ')
})

test('show all draws every plan line in the rail', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 20)
  const ui = await $.ui.mount(pane('dock', 46, 24))
  expect(await textOf(ui)).not.toContain('20. task 20')
  await ui.press({ key: 'all' })
  expect(await textOf(ui)).toContain('20. task 20')
})

test('a docked rail with only a shell shows the shell section', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'serve', turnId: 't1' })
  await call($, w, 'bg1', 'Bash', { command: 'pnpm dev', description: 'Dev server', run_in_background: true }, 0, { result: { backgroundTaskId: 'j1' } })
  const text = await textOf(await $.ui.mount(pane()))
  expect(text).toContain('shell')
  expect(text).toContain('Dev server')
  // The plan section's pill says there are no tasks; there is no plan bar.
  expect(text).toContain(' no tasks ')
  expect(text).not.toMatch(/ \d+\/\d+ /)
})

test('a short rail keeps the plan header and the running task', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'build', turnId: 't1' })
  await bashes($, w, 20)
  await plan($, w, 10, 5)
  const text = await textOf(await $.ui.mount(pane('dock', 46, 8)))
  expect(text).toContain(' Plan ')
  expect(text).toContain('▶ |5. task 5')
})

test('a finished plan shows the done card with its crab, then folds away after 30s', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 2)
  await w.clock.advance(60_000)
  await call($, w, 'tu-done1', 'TaskUpdate', { taskId: 't1', status: 'completed' }, 0, { result: { success: true } })
  await call($, w, 'tu-done2', 'TaskUpdate', { taskId: 't2', status: 'completed' }, 0, { result: { success: true } })
  const ui = await $.ui.mount(pane())
  const text = await textOf(ui)
  // The header pill says the plan is done; the card under it no longer repeats it.
  expect(text).toContain(' ✓ Plan ')
  expect(text).not.toContain('Plan complete')
  expect(text).toContain('★ 2 tasks · 1m')
  expect(text).not.toContain('1. task 1')
  expect((await ui.findAll({ type: 'Raster' })).map((r: any) => [r.props.columns, r.props.rows])).toEqual([[14, 4]])
  await w.clock.advance(31_000)
  await ui.unmount()
  // Folded away: the section is back to its no-tasks pill, the done card and its counts gone.
  const after = await textOf(await $.ui.mount(pane()))
  expect(after).toContain(' no tasks ')
  expect(after).not.toContain('★ 2 tasks')
})

test('finishing the plan plays the crab in the rail for 2.4s, then stops', OFF, async ($, on) => {
  const blits: { requestId: string; key: string }[] = []
  on('ui.blit', (_$: unknown, e: { requestId: string; key: string }) => {
    blits.push(e)
    return { value: {} }
  })
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 1)
  await call($, w, 'tu-done', 'TaskUpdate', { taskId: 't1', status: 'completed' }, 0, { result: { success: true } })
  await w.clock.advance(2400)
  const played = blits.filter(b => b.requestId === 'tidepool-rail' && b.key === 'plan-crab').length
  expect(played).toBeGreaterThan(20)
  await w.clock.advance(3000)
  expect(blits.filter(b => b.key === 'plan-crab').length).toBeLessThanOrEqual(played + 2)
})

test('an agent of the turn on screen shows in the tool rows, not again in the plan', OFF, async ($, on) => {
  const w = world(on)
  await plan($, w, 2)
  await $.turn.start({ text: 'look', turnId: 't1' })
  await call($, w, 'tu1', 'Agent', { description: 'Explore auth', prompt: 'p', subagent_type: 'Explore' }, 100)
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'p', description: 'Explore auth', subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: true, fork: false,
  })
  const text = await textOf(await $.ui.mount(pane()))
  expect(text).toContain(' Plan ')
  // The tool row's target button truncates to "Explore a…"; the plan's agent line would read "  Explore auth".
  expect(text).toContain('Explore a…')
  expect(text).not.toContain('  Explore auth')
})

test('plan and shell rows keep their marks and times whole in a narrow rail', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 2)
  w.waits['sh-long'] = 8000
  const pending = $.tool.call({ tool: 'Bash', tool_use_id: 'sh-long', command: 'npm run build', description: 'Capture the screen to a scratchpad PNG' })
  await w.clock.advance(6000)
  const ui = await $.ui.mount(pane('dock', 30))
  const fixed = async (text: string) => {
    const boxes = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.flexShrink === 0)
    return boxes.some((b: any) => JSON.stringify(b).includes(text))
  }
  expect(await fixed('▶ ')).toBe(true)
  expect(await fixed('    ▶ ')).toBe(true)
  expect(await fixed('  6s')).toBe(true)
  await w.clock.advance(2000)
  await pending
})

// A turn that reads a file and edits it (+2 −1), with an Edit result that carries its patch.
async function editTurn($: any, w: World, file = '/repo/src/a.ts') {
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await call($, w, 'r1', 'Read', { file_path: file }, 400)
  const patch = [{ oldStart: 40, oldLines: 1, newStart: 40, newLines: 2, lines: ['-x', '+y', '+z'] }]
  await call($, w, 'e1', 'Edit', { file_path: file, old_string: 'x', new_string: 'y\nz' }, 100, { result: { filePath: file, structuredPatch: patch } })
}

// A section header: its fold Button's mark and the pill's text beside it.
const header = async (ui: any, name: string) => {
  const mark = (await ui.find({ type: 'Button', key: `sec:${name}` }))?.text
  const box = await ui.find({ type: 'Box', key: `sec-${name}` })
  const texts = (node: any): string[] => (node?.children ?? []).flatMap((c: any) => (typeof c === 'string' ? [c] : c.type === 'Button' ? [] : texts(c)))
  // Powerline caps and arrows are private-use glyphs; the test reads the words.
  return `${mark}${texts(box).join('')}`.replace(/[\uE000-\uF8FF]/g, '')
}

const sectionKeys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key).filter((k: unknown) => typeof k === 'string' && k.startsWith('sec:'))

test('docked rail draws timeline, plan and files headers in order', OFF, async ($, on) => {
  const w = world(on)
  await editTurn($, w)
  await plan($, w, 3, 2)
  const ui = await $.ui.mount(pane())
  expect(await sectionKeys(ui)).toEqual(['sec:timeline', 'sec:plan', 'sec:files'])
  expect(await header(ui, 'timeline')).toContain('▾  Timeline  turn 1 ')
  expect(await header(ui, 'plan')).toContain(' Plan ')
  expect(await header(ui, 'files')).toContain('▾  Files  1 changed  +2 −1 ')
  expect(await textOf(ui)).toContain('src/a.ts')
})

test('pressing a header collapses its section and the others take its rows', OFF, async ($, on) => {
  const written: Record<string, unknown> = {}
  on('state.set', async (_$: unknown, e: any, next: any) => {
    if (e.plugin === 'tidepool') written[e.key] = e.value
    return next(e)
  })
  const w = world(on)
  await editTurn($, w)
  await plan($, w, 3, 2)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'sec:timeline' })
  let text = await textOf(ui)
  expect(await header(ui, 'timeline')).toContain('▸  Timeline ')
  expect(text).not.toContain('Read ')
  expect(written.railCollapsed).toEqual(['timeline'])
  await ui.press({ key: 'sec:timeline' })
  text = await textOf(ui)
  expect(await header(ui, 'timeline')).toContain('▾  Timeline ')
  expect(text).toContain('Read ')
})

test('a collapsed section stays collapsed in the next session', OFF, async ($, on) => {
  const w = world(on, { 'rail-collapsed': ['files'] })
  startup(on, [])
  await start($)
  await editTurn($, w)
  const ui = await $.ui.mount(pane())
  expect(await header(ui, 'files')).toContain('▸  Files  1 changed ')
  expect(await ui.find({ type: 'Button', key: 'file:/repo/src/a.ts' })).toBeUndefined()
})

test('an empty files section folds', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  expect(await header(await $.ui.mount(pane()), 'files')).toContain('▸  Files  none this turn ')
})

test('a long path keeps its counts whole', OFF, async ($, on) => {
  const w = world(on)
  await editTurn($, w, '/repo/a/very/long/path/to/some/deeply/nested/file.ts')
  const ui = await $.ui.mount(pane('dock', 46))
  const row = await ui.find({ type: 'Button', key: 'file:/repo/a/very/long/path/to/some/deeply/nested/file.ts' })
  expect(row?.text).toContain('file.ts')
  expect(row?.text.startsWith('…/')).toBe(true)
  expect(await textOf(ui)).toContain('+2 −1')
})

const diffPane = { plugin: 'tidepool', surface: 'terminal', component: 'Pane', requestId: 'tidepool-diff', props: { title: 'diff', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const

test('pressing a file opens the diff pane with its edits', OFF, async ($, on) => {
  const w = world(on)
  await editTurn($, w)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'file:/repo/src/a.ts' })
  expect(w.opened.map(o => [o.id, o.title])).toContainEqual(['tidepool-diff', 'src/a.ts'])
  // Same width as the rail, so switching tabs never resizes the dock under the pointer.
  expect((w.opened.find(o => o.id === 'tidepool-diff') as { columns?: number } | undefined)?.columns).toBe(44)
  const diff = await $.ui.mount(diffPane)
  // Same width as the rail, so switching tabs never resizes the dock under the pointer.
  expect((w.opened.find(o => o.id === 'tidepool-diff') as { columns?: number } | undefined)?.columns).toBe(44)
  expect(await textOf(diff)).toContain('edit 1 of 1')
  const code = await diff.find({ type: 'Code' })
  expect(code?.props.format).toBe('diff')
  expect(code?.text).toContain('@@ -40,1 +40,2 @@')
})

test('pressing another file re-targets the open pane', OFF, async ($, on) => {
  const w = world(on)
  await editTurn($, w)
  const patch = [{ oldStart: 7, oldLines: 0, newStart: 7, newLines: 1, lines: ['+bee'] }]
  await call($, w, 'e2', 'Edit', { file_path: '/repo/src/b.ts', old_string: '', new_string: 'bee' }, 100, { result: { filePath: '/repo/src/b.ts', structuredPatch: patch } })
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'file:/repo/src/a.ts' })
  await ui.press({ key: 'file:/repo/src/b.ts' })
  const code = await (await $.ui.mount(diffPane)).find({ type: 'Code' })
  expect(code?.text).toContain('+bee')
  expect(code?.text).not.toContain('+y')
})

test('the diff pane keeps its turn when the rail moves to another', OFF, async ($, on) => {
  const w = world(on)
  await editTurn($, w)
  await $.turn.complete(complete('t1'))
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'file:/repo/src/a.ts' })
  await $.turn.start({ text: 'next', turnId: 't2' })
  await call($, w, 'r9', 'Read', { file_path: '/repo/src/a.ts' }, 10)
  const code = await (await $.ui.mount(diffPane)).find({ type: 'Code' })
  expect(code?.text).toContain('+y')
})

test('an edit with no patch says so', OFF, async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await call($, w, 'e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' }, 100, { result: { filePath: '/repo/src/a.ts', structuredPatch: [] } })
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'file:/repo/src/a.ts' })
  expect(await textOf(await $.ui.mount(diffPane))).toContain('no diff recorded')
})

test('/clear closes the diff pane', OFF, async ($, on) => {
  const w = world(on)
  await $.prompt.submit({ text: 'first', origin: { kind: 'composer' } } as never)
  await editTurn($, w)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'file:/repo/src/a.ts' })
  w.usage.startedAt = 2
  await $.prompt.submit({ text: 'after clear', origin: { kind: 'composer' } } as never)
  expect(w.closed).toContain('tidepool-diff')
})

test('a file edited in two turns lists and diffs only the rail\'s turn', OFF, async ($, on) => {
  const w = world(on)
  await editTurn($, w)
  await $.turn.complete(complete('t1'))
  // A real turn starts after the last one ended.
  await w.clock.advance(1000)
  await $.turn.start({ text: 'again', turnId: 't2' })
  const patch = [{ oldStart: 90, oldLines: 1, newStart: 90, newLines: 1, lines: ['-q', '+r'] }]
  await call($, w, 'e2', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'q', new_string: 'r' }, 100, { result: { filePath: '/repo/src/a.ts', structuredPatch: patch } })
  await $.turn.complete(complete('t2'))
  // Pin the rail to turn 1 through the anchor on its first tool row.
  await (await $.ui.mount(pane())).unmount()
  const anchor = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', component: 'ToolUse', requestId: 'r1',
    props: { tool_use_id: 'r1', tool: 'Read', input: { file_path: '/repo/src/a.ts' }, isRunning: false, isErrored: false, isInterrupted: false } } as const)
  await anchor.press({ key: 'anchor' })
  const ui = await $.ui.mount(pane())
  expect(await textOf(ui)).toContain('pinned')
  expect(await header(ui, 'files')).toContain('▾  Files  1 changed  +2 −1 ')
  await ui.press({ key: 'file:/repo/src/a.ts' })
  const diff = await $.ui.mount(diffPane)
  expect(await textOf(diff)).toContain('edit 1 of 1')
  expect((await diff.find({ type: 'Code' }))?.text).not.toContain('+r')
})

test('pressing an empty section\'s header does not collapse it', OFF, async ($, on) => {
  const written: Record<string, unknown> = {}
  on('state.set', async (_$: unknown, e: any, next: any) => {
    if (e.plugin === 'tidepool') written[e.key] = e.value
    return next(e)
  })
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane())
  await ui.press({ key: 'sec:files' })
  expect(written.railCollapsed).toBeUndefined()
  expect(await header(ui, 'files')).toContain('▸  Files  none this turn ')
})

test('a folded section\'s name is muted, an open one is in the accent colour', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane())
  const name = async (label: string) => (await ui.findAll({ type: 'Text' })).find((t: any) => t.text === ` ${label} `)?.props.backgroundColor
  expect(await name('Timeline')).toBeDefined()
  expect(await name('Timeline')).not.toBe(await name('Files'))
})

test('the plan header with no tasks is a pill like the other headers', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  expect(await header(await $.ui.mount(pane()), 'plan')).toContain('▸  Plan  no tasks ')
})

test('the turn\'s prompt sits on its own line under the timeline header', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane())
  expect(await header(ui, 'timeline')).not.toContain('fix it')
  expect((await ui.findAll({ type: 'Text' })).some((t: any) => t.text.trim() === 'fix it')).toBe(true)
})

test('each open section holds its third, and a blank row sits above every header', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 2)
  const ui = await $.ui.mount(pane('dock', 46, 40))
  // 40 - brand, three gaps, three headers = 33; files is empty, so timeline and plan split it 16 / 17.
  expect((await ui.find({ type: 'Box', key: 'timeline' }))?.props.height).toBe(16)
  expect((await ui.find({ type: 'Box', key: 'plan-body' }))?.props.height).toBe(17)
  for (const key of ['sec-timeline-gap', 'sec-plan-gap', 'sec-files-gap']) expect((await ui.find({ type: 'Box', key }))?.props.marginTop).toBe(1)
})

test('a folded plan header turns muted like the other folded headers', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  await plan($, w, 2)
  const ui = await $.ui.mount(pane())
  const planBg = async () => (await ui.findAll({ type: 'Text' })).find((t: any) => t.text === ' Plan ')?.props.backgroundColor
  const open = await planBg()
  await ui.press({ key: 'sec:plan' })
  expect(await header(ui, 'plan')).toContain('▸')
  expect(await planBg()).not.toBe(open)
})

test('the rail\'s own close button closes the rail', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane())
  const close = await ui.find({ type: 'Button', key: 'rail:close' })
  // No hotkey: a plain Button draws one as an 'x:' prefix beside its label.
  expect(close?.text).toBe('✕')
  expect(close?.props.hotkey).toBeUndefined()
  await ui.press({ key: 'rail:close' })
  expect(w.closed).toContain('tidepool-rail')
})

test('the diff pane names its file and closes itself alone, back to the rail', OFF, async ($, on) => {
  const w = world(on)
  await editTurn($, w)
  const rail = await $.ui.mount(pane())
  await rail.press({ key: 'file:/repo/src/a.ts' })
  const diff = await $.ui.mount(diffPane)
  const close = await diff.find({ type: 'Button', key: 'diff:close' })
  expect(close?.text).toBe('✕ close')
  expect(close?.props.hotkey).toBeUndefined()
  expect((await diff.findAll({ type: 'Text' })).some((t: any) => t.text.includes('src/a.ts'))).toBe(true)
  await diff.press({ key: 'diff:close' })
  expect(w.closed).toEqual(['tidepool-diff'])
})

test('the rail shows the turn\'s receipt; pressing a part filters the timeline to it, again clears it', OFF, async ($, on) => {
  const w = world(on)
  await twoCallTurn($, w)
  const ui = await $.ui.mount(pane())
  const read = await ui.find({ type: 'Button', key: 'rc:read' })
  expect(read?.text).toBe('1 read')
  // The failed Bash opened nothing, so it has no part of its own.
  expect(await ui.find({ type: 'Button', key: 'rc:shell' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'row:b1' })).toBeTruthy()
  await ui.press({ key: 'rc:read' })
  expect(await ui.find({ type: 'Button', key: 'row:r1' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'row:b1' })).toBeFalsy()
  expect((await ui.find({ type: 'Button', key: 'rc:read' }))?.props.dimColor).toBe(false)
  await ui.press({ key: 'rc:read' })
  expect(await ui.find({ type: 'Button', key: 'row:b1' })).toBeTruthy()
})
