import { expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

test('band lists tasks once a plan starts', { options: { powerline: true } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'schema', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'routes', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'schema', status: 'in_progress' })
  await clock.advance(10 * 60000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'schema', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'routes', status: 'in_progress' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tidepool', surface, ...BAND })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    expect(text).toContain(' Plan ')
    expect(text).toContain(' 1/2 ━━━━━ ╸─────')
    expect(text).toContain(' ~10m left ')
    expect(text).toContain('✓ 1. schema  10m')
    expect(text).toContain('▶ 2. routes  0s')
    // Powerline glyphs only where a Nerd Font is likely.
    expect(text.includes('\uE0B0')).toBe(surface === 'terminal')
    await ui.unmount()
  }
})

test('history is kept per project, borrowed by a project with none', async ($, on) => {
  const clock = mock.clock(on)
  let root = '/repo/a'
  on('session.root', () => ({ value: root }))
  mock.store(on, { 'history-by-project': { '/repo/a': [6 * 60000], '/repo/b': [30 * 60000] } })
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  const header = async () => {
    const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
    const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    await ui.unmount()
    return text.match(/~\S+ left \(from past plans\)/)?.[0]
  }

  // Project a uses only its own 6m, not b's 30m.
  await $.tool.call({ tool: 'TaskCreate', subject: 'a1', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'a2', description: '' })
  expect(await header()).toBe('~12m left (from past plans)')

  // Finishing a task in a adds 9m to a's history only: median of 6m and 9m is 7.5m.
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'a1', status: 'in_progress' })
  await clock.advance(9 * 60000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'a1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'a2', status: 'completed' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'a3', description: '' })
  expect(await header()).toBe('~6m left (from past plans)') // a: 6m, 9m, 0m -> median 6m

  // A project with no history borrows everyone's: a's 6, 9, 0, 0 and b's 30 -> median 6m.
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'a3', status: 'completed' })
  root = '/repo/new'
  await $.tool.call({ tool: 'TaskCreate', subject: 'n1', description: '' })
  expect(await header()).toBe('~6m left (from past plans)')
})

test('agents nest under the running task and fold away after finishing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  const text = async () => {
    const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    await ui.unmount()
    return all
  }

  await $.tool.call({ tool: 'TaskCreate', subject: 'tests', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'tests', status: 'in_progress' })
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'run', description: 'Running engine tests', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await clock.advance(167_000)
  expect(await text()).toContain('◆ general-purpose · sonnet  Running engine tests  2m 47s')

  await $.turn.complete({
    answer: 'done', durationMs: 1, isAborted: false, turnId: 't', agentId: 'ag1', reason: 'answer',
    usage: { model: 'm', input_tokens: 100_000, output_tokens: 1_100, cache_read_input_tokens: 95_000, cache_creation_input_tokens: 0 },
  })
  expect(await text()).toContain('✓ general-purpose · sonnet  Running engine tests  2m 47s · 196.1k tokens')

  await clock.advance(31_000)
  expect(await text()).not.toContain('general-purpose')
})

// Hooks beneath the plugin must all be registered before the test first calls $.
function engine(on: any) {
  mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$: unknown, e: { subject: string }) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
}

async function onePlan($: any, on: any) {
  engine(on)
  await $.tool.call({ tool: 'TaskCreate', subject: 'only', description: '' })
}

test('band uses no powerline glyphs when the option is off', { options: { powerline: false } }, async ($, on) => {
  await onePlan($, on)
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(text).toContain(' Plan ')
  expect(text.includes('\uE0B0') || text.includes('\uE0B6')).toBe(false)
})

test('band header drops the time-left segment at 40 columns', async ($, on) => {
  await onePlan($, on)
  const narrow = { ...BAND, props: { ...BAND.props, bodyColumns: 40 } }
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...narrow })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(text).toContain('0/1')
  expect(text).not.toContain('ETA')
})

test('tasks off: band hook returns next(e)', { options: { dock: false, tasks: false, usage: false } }, async ($, on) => {
  engine(on)
  on('ui.render', { component: 'AbovePrompt' }, ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  await $.tool.call({ tool: 'TaskCreate', subject: 'only', description: '' })
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['ENGINE'])
})

test('band leaves agent rows to a docked rail and keeps them otherwise', { options: { dock: false } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }))
  on('ui.panes', () => ({ value: [{ id: 'tidepool-rail', title: 'tidepool', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.render', { component: 'AbovePrompt' }, ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 200_000 }, rateLimits: [] } }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: {} }))
  await $.tool.call({ tool: 'TaskCreate', subject: 'tests', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'tests', status: 'in_progress' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'Running engine tests', prompt: 'run', subagent_type: 'general-purpose' } as never)
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'run', description: 'Running engine tests', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  const text = async (viewport: { columns: number; rows: number; isFullscreen: boolean }) => {
    const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND, viewport })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    await ui.unmount()
    return all
  }
  const docked = await text({ columns: 140, rows: 40, isFullscreen: true })
  expect(docked).not.toContain(' Plan ')
  expect(docked).not.toContain('general-purpose')
  expect(await text({ columns: 140, rows: 40, isFullscreen: false })).toContain('general-purpose')
})

test('a docked rail takes every agent, earlier turns included, out of the band', { options: { dock: false } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 200_000 }, rateLimits: [] } }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: {} }))
  on('agent.spawn', (_$: unknown, e: { tool_use_id: string }) => ({ model: 'm', agentId: e.tool_use_id === 'tu1' ? 'ag1' : 'ag2' }))
  on('ui.panes', () => ({ value: [{ id: 'tidepool-rail', title: 'tidepool', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.render', { component: 'AbovePrompt' }, ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  const spawn = async (id: string, description: string) => {
    await $.tool.call({ tool: 'Agent', tool_use_id: id, description, prompt: 'p', subagent_type: 'general-purpose' } as never)
    await $.agent.spawn({ tool_use_id: id, prompt: 'p', description, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: true, fork: false })
  }
  await $.tool.call({ tool: 'TaskCreate', subject: 'tests', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'tests', status: 'in_progress' })
  await $.turn.start({ text: 'one', turnId: 't1' })
  await spawn('tu1', 'Older agent')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1000)
  await $.turn.start({ text: 'two', turnId: 't2' })
  await spawn('tu2', 'Newer agent')
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND, viewport: { columns: 140, rows: 40, isFullscreen: true } })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(text).not.toContain(' Plan ')
  expect(text).not.toContain('Older agent')
  expect(text).not.toContain('Newer agent')
})

test('shell rows show elapsed, the ETA from past runs and a background job\'s last output line', { options: { dock: false, usage: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { 'shell-history': { 'npm test': [100_000] } })
  on('session.root', () => ({ value: '/repo/a' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 40, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'building\n\u001b[32m✓ 142/310 tests\u001b[0m\n' }))
  on('ui.render', { component: 'AbovePrompt' }, ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    if (e.run_in_background) return { result: { backgroundTaskId: 'j1' }, text: 'Output is being written to: /tmp/s/tasks/j1.output' }
    await clock.sleep(200_000)
    return { result: {} }
  })
  const text = async () => {
    const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    await ui.unmount()
    return all
  }

  expect(await text()).toBe('ENGINE')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'pnpm dev', description: 'Dev server', run_in_background: true })
  const pending = $.tool.call({ tool: 'Bash', tool_use_id: 'f1', command: 'npm  test', description: 'Run tests' })
  await clock.advance(40_000)
  let shown = await text()
  expect(shown).toContain('shell')
  expect(shown).toContain('bg Dev server  40s')
  expect(shown).toContain('✓ 142/310 tests')
  expect(shown).toContain('▶ $ Run tests  40s · ~1m left')

  await clock.advance(80_000)
  expect(await text()).toContain('Run tests  2m 0s · over by 20s')

  // A finished slow shell lingers, then folds away; its run teaches the next ETA.
  await clock.advance(80_000)
  await pending
  shown = await text()
  expect(shown).toContain('✓ $ Run tests  3m 20s')
  await clock.advance(31_000)
  expect(await text()).not.toContain('Run tests')
})

test('sub-items nest under their running task, count apart from the plan, and show all reveals the rest', { options: { dock: false, usage: false } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  const sub = (subject: string, parent: string) => $.tool.call({ tool: 'TaskCreate', subject, description: '', metadata: { parent } })

  await $.tool.call({ tool: 'TaskCreate', subject: 'schema', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'routes', description: '' })
  await sub('tables', 'schema')
  await sub('indexes', 'schema')
  await sub('handlers', 'routes')
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'schema', status: 'in_progress' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'tables', status: 'completed' })

  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
  const text = async () => [...(await ui.findAll({ type: 'Text' })).map(t => t.text), ...(await ui.findAll({ type: 'Button' })).map(b => JSON.stringify(b.props))].join('\n')
  let shown = await text()
  expect(shown).toContain(' 0/2 ')
  expect(shown).toContain('▶ \n1. schema')
  expect(shown).toContain('    ✓ \ntables')
  expect(shown).toContain('    · \nindexes')
  // routes is not running, so its sub-item waits behind the toggle.
  expect(shown).not.toContain('handlers')
  expect(shown).toContain('show all')

  await ui.press({ key: 'all' })
  shown = await text()
  expect(shown).toContain('handlers')
  expect(shown).toContain('fewer')
  await ui.press({ key: 'all' })
  expect(await text()).not.toContain('handlers')
  await ui.unmount()
})

function railWorld(on: any, rail = { placed: true }) {
  const clock = mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$: unknown, e: { subject: string }) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$: unknown, e: any) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { backgroundTaskId: 'j1' }, text: 'Output is being written to: /t/j1.output' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 4, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'ready\n' }))
  on('ui.panes', () => ({ value: [{ id: 'tidepool-rail', title: 'tidepool', isShown: true, isFocused: false, isPlaced: rail.placed }] }))
  on('ui.render', { component: 'AbovePrompt' }, ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  return clock
}

async function railPlan($: any) {
  await $.tool.call({ tool: 'TaskCreate', subject: 'schema', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'routes', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'schema', status: 'in_progress' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'pnpm dev', description: 'Dev server', run_in_background: true })
}

const bandText = async ($: any, viewport: { columns: number; rows: number; isFullscreen: boolean }) => {
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND, viewport })
  const all = [...(await ui.findAll({ type: 'Text' })).map((t: any) => t.text), ...(await ui.findAll({ type: 'Button' })).map((b: any) => String(b.props.label ?? ''))].join('')
  await ui.unmount()
  return all
}

test('band draws no plan while the rail owns it', { options: { dock: false, usage: false } }, async ($, on) => {
  railWorld(on)
  await railPlan($)
  const text = await bandText($, { columns: 140, rows: 40, isFullscreen: true })
  expect(text).not.toContain(' Plan ')
  expect(text).not.toContain('1. ')
  expect(text).not.toContain('shell')
  expect(text).not.toContain('show all')
})

test('a rail the person opened owns the plan at any width', { options: { dock: false, usage: false } }, async ($, on) => {
  // An asked pane docks below 110 columns too; placed in fullscreen means docked.
  railWorld(on)
  await railPlan($)
  expect(await bandText($, { columns: 100, rows: 40, isFullscreen: true })).not.toContain('1. schema')
})

test('band takes the plan back when the rail is no longer placed', { options: { dock: false, usage: false } }, async ($, on) => {
  const rail = { placed: true }
  railWorld(on, rail)
  await railPlan($)
  expect(await bandText($, { columns: 140, rows: 40, isFullscreen: true })).not.toContain('1. schema')
  rail.placed = false
  const text = await bandText($, { columns: 140, rows: 40, isFullscreen: true })
  expect(text).toContain('1. schema')
  // The plan's shells come back with it, nested under their task.
  expect(text).toContain('Dev server')
})

test('two task updates sent together both land', { options: { dock: false, usage: false } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: e.subject, subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }))
  await Promise.all([
    $.tool.call({ tool: 'TaskCreate', subject: 'one', description: '' }),
    $.tool.call({ tool: 'TaskCreate', subject: 'two', description: '' }),
    $.tool.call({ tool: 'TaskCreate', subject: 'three', description: '' }),
  ])
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'one', status: 'in_progress' })
  await Promise.all([
    $.tool.call({ tool: 'TaskUpdate', taskId: 'one', status: 'completed' }),
    $.tool.call({ tool: 'TaskUpdate', taskId: 'two', status: 'completed' }),
  ])
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  await ui.unmount()
  expect(text).toContain(' 2/3 ')
  expect(text).toContain('3. three')
})

test('two shells finishing together both teach the ETA', { options: { dock: false, usage: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.root', () => ({ value: '/repo/a' }))
  on('ui.render', { component: 'AbovePrompt' }, ($e: any, e: any) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    await clock.sleep(20_000)
    return { result: {} }
  })
  const run = (id: string, command: string) => $.tool.call({ tool: 'Bash', tool_use_id: id, command, description: command })
  const first = [run('a1', 'npm test'), run('b1', 'npm run lint')]
  await clock.advance(20_000)
  await Promise.all(first)
  await clock.advance(40_000)
  const again = [run('a2', 'npm test'), run('b2', 'npm run lint')]
  await clock.advance(5_000)
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  await ui.unmount()
  expect(text.match(/~15s left/g)?.length).toBe(2)
  await clock.advance(20_000)
  await Promise.all(again)
})

test('a band left mounted takes the plan back on its next tick once the rail undocks', { options: { dock: false, usage: false } }, async ($, on) => {
  const rail = { placed: true }
  const clock = railWorld(on, rail)
  await railPlan($)
  const ui = await $.ui.mount({ plugin: 'tidepool', surface: 'terminal', ...BAND, viewport: { columns: 140, rows: 40, isFullscreen: true } })
  const text = async () => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
  expect(await text()).not.toContain('1. schema')
  rail.placed = false
  await clock.advance(1000)
  expect(await text()).toContain('1. schema')
  await ui.unmount()
})

test('a plan finished while the rail is docked never shows ✓ Plan in the band, and has folded away when it undocks', { options: { dock: false, usage: false } }, async ($, on) => {
  const rail = { placed: true }
  const clock = railWorld(on, rail)
  await $.tool.call({ tool: 'TaskCreate', subject: 'schema', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'schema', status: 'in_progress' })
  await clock.advance(5000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'schema', status: 'completed' })
  const view = { columns: 140, rows: 40, isFullscreen: true }
  expect(await bandText($, view)).not.toContain('Plan')
  await clock.advance(31_000)
  rail.placed = false
  expect(await bandText($, view)).not.toContain('Plan')
})

test('a rail seated inline above the prompt leaves the plan to the band', { options: { dock: false, usage: false } }, async ($, on) => {
  railWorld(on)
  await railPlan($)
  const seat = async (placement: 'dock' | 'inline') => {
    const pane = await $.ui.mount({
      plugin: 'tidepool', surface: 'terminal', component: 'Pane', requestId: 'tidepool-rail',
      props: { title: 'tidepool', isFocused: false, bodyColumns: 46, placement, scroll: { offset: 0, bodyRows: 20 }, view: {} },
    } as never)
    await pane.unmount()
  }
  const view = { columns: 100, rows: 40, isFullscreen: true }
  await seat('inline')
  expect(await bandText($, view)).toContain('1. schema')
  await seat('dock')
  expect(await bandText($, view)).not.toContain('1. schema')
})
