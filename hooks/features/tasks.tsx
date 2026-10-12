import { atom, read, update } from 'claude-code'
import type { EngineInterface, Frozen, On, RenderElement, RenderInput, Timer, ToolCallInput } from 'claude-code'

import type { PlanAgent, PlanTask } from '../../types'
import type { KeptPlans } from '../plan'
import {
  AGENT_LINGER_MS,
  PLAN_NUDGE,
  RESUME_KEY,
  sessionKey,
  agentRows,
  agentTools,
  currentTaskId,
  fmtClock,
  fmtTokens,
  finishedAt,
  historyFor,
  newlyDone,
  planShows,
  setStatus,
  syncTodos,
  topLevel,
} from '../plan'
import { planBody, planHeader, planWanted } from '../planview'
import type { PlanData } from '../planview'
import { fitBand } from '../layout'
import { railSeat } from '../rail'
import type { BandFit } from '../layout'
import { palette } from '../theme'
import { opts } from '../options'
import { bySource, lastTurn, wasCold } from '../usage'
import { activity } from '../activity'
import { MAX_TAIL_BYTES, parseHistory, shellRows, shellTails } from '../shell'
import { DONE_MS, IDLE_COLS, IDLE_ROWS, SCENE_ROWS, doneCrabCells, dockView, encodeCells, idleCells, modeAt, phaseTimes, sceneCells, score, site } from '../dock'

const tasks = atom({ plugin: 'tidepool', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'tidepool', key: 'agents' } as const, [])
// Written by the tracker (features/track.tsx); atoms must be declared in the file that reads them.
const turns = atom({ plugin: 'tidepool', key: 'turns' } as const, [])
// Bumped every second while something runs, so live timers redraw.
const tick = atom({ plugin: 'tidepool', key: 'tick' } as const, 0)
// The prompt dock's turn (features/dock.tsx) and the calls in flight (features/track.tsx).
const dock = atom({ plugin: 'tidepool', key: 'dock' } as const, null)
const liveCalls = atom({ plugin: 'tidepool', key: 'live' } as const, {})
// The tracker's calls, for the shell rows.
const calls = atom({ plugin: 'tidepool', key: 'calls' } as const, {})
// Background shells (features/track.tsx) and past shell durations by command, for the band's shell rows.
const jobs = atom({ plugin: 'tidepool', key: 'jobs' } as const, [])
const shellHistory = atom({ plugin: 'tidepool', key: 'shellHistory' } as const, null)
// Every plan row, or only what fits beside the dock; toggled from the Plan header.
const planAll = atom({ plugin: 'tidepool', key: 'planAll' } as const, false)
const planState = atom({ plugin: 'tidepool', key: 'planState' } as const, 'running')

// Sessions whose plan is kept for a resume (features/startup.tsx restores it): the newest few.
const RESUME_KEEP = 20

let ticker: Timer | undefined

// Runs the 1s redraw timer only while a task, agent or shell is live, or a finished one is still fading out.
// `force` starts it before the tracker has recorded a new shell; the next tick re-checks.
async function syncTicker($: EngineInterface, force = false) {
  const now = await $.clock.now()
  const list = await read($, tasks)
  const live =
    force ||
    (opts.tasks && shellRows(await read($, calls), await read($, liveCalls), await read($, jobs), now).length > 0) ||
    list.some(t => t.status === 'in_progress') ||
    // A finished plan shows its total briefly, then folds away until a new one starts.
    (finishedAt(topLevel(list)) !== undefined && planShows(list, now)) ||
    agentRows(await read($, agents), await read($, turns)).some(a => a.status === 'running' || now - (a.endedAt ?? now) < AGENT_LINGER_MS)
  if (live && ticker === undefined) {
    ticker = $.clock.every(1000, () => {
      void update($, tick, n => n + 1).then(() => syncTicker($))
    })
  } else if (!live && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}
const HISTORY_SIZE = 50

// Task durations from past plans per project root, kept across sessions in this plugin's store; read on first use.
// ponytail: keyed by session root, so each git worktree learns separately; key by repo remote if that matters.
let byProject: Record<string, number[]> | undefined

async function loadHistory($: EngineInterface): Promise<Record<string, number[]>> {
  byProject ??= parseHistory(await $.store.get('history-by-project'))
  return byProject
}

const RAIL_ID = 'tidepool-rail'
let doneLoop: Timer | undefined

// Plays the rail's plan-done crab (features/rail.tsx draws the card): a frame every 50ms for DONE_MS.
// A rail that is closed or off screen refuses the blit; that frame is skipped.
function playDone($: EngineInterface, doneAt: number) {
  doneLoop?.cancel()
  doneLoop = $.clock.every(50, () => {
    void (async () => {
      const ms = (await $.clock.now()) - doneAt
      if (ms >= DONE_MS) {
        doneLoop?.cancel()
        doneLoop = undefined
      }
      await $.ui.blit({ requestId: RAIL_ID, key: 'plan-crab', cells: encodeCells(doneCrabCells(Math.min(ms, DONE_MS), palette())) }).catch(() => undefined)
    })()
  })
}

// Mirrors the plan to the store for a resume. A convenience: a failure here never stops the plan.
// It writes the plan as it stands now, so task calls finishing out of order never keep an older list.
async function keepForResume($: EngineInterface) {
  try {
    const list = await read($, tasks)
    const session = sessionKey(await $.session.usage())
    const kept = ((await $.store.get(RESUME_KEY)) ?? {}) as KeptPlans
    const { [session]: _old, ...others } = kept
    await $.store.set(RESUME_KEY, Object.fromEntries([...Object.entries(others).slice(-(RESUME_KEEP - 1)), [session, list]]))
  } catch {
    // No usage or store: the plan is not kept for a resume.
  }
}

// Applies `change` to the latest list inside the update: task calls sent together run side by side, and a
// read-then-write would let one overwrite the other.
async function apply($: EngineInterface, change: (list: PlanTask[]) => PlanTask[]) {
  let before: PlanTask[] = []
  let after: PlanTask[] = []
  await update($, tasks, list => {
    before = list
    after = change(list)
    return after
  })
  await keepForResume($)
  const doneAt = finishedAt(topLevel(after))
  if (opts.rail && finishedAt(topLevel(before)) === undefined && doneAt !== undefined) playDone($, doneAt)
  const finished = newlyDone(topLevel(before), topLevel(after))
  if (finished.length > 0) {
    const all = await loadHistory($)
    const root = await $.session.root()
    byProject = { ...all, [root]: [...(all[root] ?? []), ...finished].slice(-HISTORY_SIZE) }
    await $.store.set('history-by-project', byProject)
  }
  await syncTicker($)
}

// Claude Code 2.1.289 stopped typing these tools' inputs and results; the shapes are unchanged.
type TaskCreateInput = { subject: string; activeForm?: string; metadata?: Record<string, unknown> }
type TaskUpdateInput = { taskId: string; status?: PlanTask['status'] | 'deleted'; subject?: string; activeForm?: string; metadata?: Record<string, unknown> }

// `metadata.parent` names a sub-item's task; null on an update makes it top-level again.
function parentOf(metadata: Record<string, unknown> | undefined): string | null | undefined {
  const p = metadata?.parent
  return typeof p === 'string' || typeof p === 'number' ? String(p) : p === null ? null : undefined
}
type TodoWriteInput = { todos: Parameters<typeof syncTodos>[1] }

// TaskCreate and TaskUpdate open Claude Code's own task panel through the progress callback the session's
// call hands them (todoFeatureEnabled does not stop it), duplicating this plan. Run as Tidepool's own call
// instead of next(), which hands them none.
function ownCall($: EngineInterface, raw: Frozen<ToolCallInput>) {
  const { tool_use_id: _id, ...args } = raw
  return $.tool.call(args)
}

export function registerTasks(on: On) {
  on('tool.call', { tool: 'TaskCreate' }, async ($, raw) => {
    const e = raw as typeof raw & TaskCreateInput
    const ran = await ownCall($, raw)
    if (ran.deny !== undefined || ran.isError) return ran
    const now = await $.clock.now()
    const task: PlanTask = { id: (ran.result as { task: { id: string } }).task.id, subject: e.subject, status: 'pending', createdAt: now }
    if (e.activeForm) task.activeForm = e.activeForm
    const parent = parentOf(e.metadata)
    if (parent) task.parent = parent
    // A new task after everything finished starts a new plan; a sub-item joins its parent's.
    await apply($, list => [...(!parent && list.every(t => t.status === 'completed') ? [] : list), task])
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, raw) => {
    const e = raw as typeof raw & TaskUpdateInput
    const ran = await ownCall($, raw)
    if (ran.deny !== undefined || ran.isError) return ran
    const now = await $.clock.now()
    const status = e.status
    const parent = parentOf(e.metadata)
    const reparent = (t: PlanTask): PlanTask => {
      if (parent === undefined) return t
      const { parent: _old, ...rest } = t
      return parent === null ? rest : { ...rest, parent }
    }
    await apply($, list =>
      status === 'deleted'
        ? list.filter(t => t.id !== e.taskId)
        : list.map(t =>
            t.id !== e.taskId
              ? t
              : setStatus(reparent({ ...t, subject: e.subject ?? t.subject, activeForm: e.activeForm ?? t.activeForm }), status ?? t.status, now),
          ),
    )
    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, raw, next) => {
    const e = raw as typeof raw & TodoWriteInput
    const ran = await next(raw)
    if (ran.deny !== undefined || ran.isError) return ran
    const now = await $.clock.now()
    await apply($, list => syncTodos(list, e.todos, now))
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (opts.tasks) {
      // Drawing cannot write state, so the band's ETA history is loaded here, at the first shell.
      if ((await read($, shellHistory)) === null) {
        const loaded = parseHistory(await $.store.get('shell-history'))
        await update($, shellHistory, known => known ?? loaded)
      }
      await syncTicker($, true)
    }
    return next(e)
  })

  // An approved plan-mode plan becomes the band's plan: the model is asked to track it as tasks.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    if (!opts.tasks || ran.deny !== undefined || ran.isError) return ran
    if (topLevel(await read($, tasks)).some(t => t.status !== 'completed')) return ran
    // A result with `ref` is replayed as core produced it; without it, core maps the result anew with our context.
    const { ref: _ref, ...rest } = ran
    return { ...rest, context: [...(ran.context ?? []), PLAN_NUDGE] }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny !== undefined) return spawned
    const agent: PlanAgent = {
      id: spawned.agentId ?? e.tool_use_id,
      description: e.description,
      type: e.subagentType,
      taskId: currentTaskId(await read($, tasks)),
      startedAt: await $.clock.now(),
      callId: e.tool_use_id,
      ...(spawned.model ? { model: spawned.model } : {}),
    }
    await update($, agents, list => [...list, agent].slice(-50))
    await syncTicker($)
    return spawned
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const docking = opts.dock && e.surface === 'terminal' && !e.props.hasSurvey
    const kind = !docking ? 'none' : dockView((await read($, dock)) ?? undefined, await $.clock.now()).kind === 'idle' ? 'idle' : 'live'
    // The plan and the dock share the band's rows (layout.ts), so the dock is never scrolled out of sight.
    const band = e.props.hasSurvey ? null : await planBand($, e, kind)
    const alone = { maxRows: e.props.maxRows, dock: kind, header: false, focus: false, shell: 0, plan: 0, tails: 0, usage: 0, expanded: false } as const
    const docked = docking ? await dockBand($, e, band?.fit ?? fitBand(alone)) : null
    if (!docked) {
      site.id = undefined
      return band?.el ?? next(e)
    }
    const { Box } = $.ui.resolve(e)
    return band?.el ? <Box flexDirection="column">{band.el}{docked}</Box> : docked
  })
}

type Band = Frozen<RenderInput<'AbovePrompt'>>

// The rail owns the plan while it is docked beside the chat: fullscreen, placed, and not seated inline (an asked
// rail under 110 columns sits above the prompt and draws no plan). The engine decides the floor, so no column
// count here; a rail not drawn yet counts as docked.
async function railDocked($: EngineInterface, e: Band): Promise<boolean> {
  if (!opts.rail || e.viewport?.isFullscreen !== true || railSeat.placement === 'inline') return false
  try {
    return (await $.ui.panes()).some(pane => pane.id === 'tidepool-rail' && pane.isPlaced)
  } catch {
    return false
  }
}


// The plan, its agents, running shells and the usage rows, fitted with the dock into the band's rows.
// Null when there is nothing to show; `dock` is the size the dock should draw at.
async function planBand($: EngineInterface, e: Band, dockKind: 'none' | 'idle' | 'live'): Promise<{ el: RenderElement | null; fit: BandFit } | null> {
  const list = await read($, tasks)
  const turnList = await read($, turns)
  const last = lastTurn(turnList)
  await read($, tick)
  const now = await $.clock.now()
  const doneAt = finishedAt(topLevel(list))
  const showTasks = opts.tasks && planShows(list, now)
  const showUsage = opts.usage && last !== undefined
  // A docked rail owns the plan and the shells (features/rail.tsx); the band draws neither.
  const docked = await railDocked($, e)
  const shells = opts.tasks && !docked ? shellRows(await read($, calls), await read($, liveCalls), await read($, jobs), now) : []
  if (!showTasks && !showUsage && shells.length === 0) return null
  const C = palette()
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui

  // Usage: only what the status line does not show — a cold-cache warning, and tokens split by agent.
  const usageRows: RenderElement[] = []
  if (showUsage && last && last.usage) {
    const previous = [...turnList].reverse().find(t => t.agentId === undefined && t.usage && t !== last && t.startedAt < last.startedAt)
    const sources = bySource(turnList, await read($, agents), now - 30 * 60_000)
    if (wasCold(last, previous)) {
      usageRows.push(<Text key="cold" color={C.warn} wrap="truncate-end">{` ⚠ cache was cold · this turn re-sent ${fmtTokens(last.usage.cacheWrite)} at full price`}</Text>)
    }
    if (sources.length > 1) {
      usageRows.push(<Text key="sources" color={C.faint} wrap="truncate-end">{` ${sources.map(s => `${s.source} ${fmtTokens(s.tokens)}`).join(' · ')}`}</Text>)
    }
  }

  const finished = doneAt !== undefined
  const d: PlanData = {
    tasks: showTasks && !finished ? list : [],
    agents: agentRows(await read($, agents), turnList),
    shells,
    // Output lines are rows of the plan's tree, so they are read before it is fitted (cached for 2s per file).
    tails: await shellTails(shells, readTail($), now),
    shellHistory: (await read($, shellHistory)) ?? {},
    planHistory: historyFor(await loadHistory($), await $.session.root()),
    now,
    all: await read($, planAll),
    state: await read($, planState),
    agentTools: agentTools(await read($, liveCalls)),
  }
  const want = docked ? { plan: 0, shell: 0, tails: 0, focus: false } : planWanted(d)
  const fit = fitBand({
    maxRows: e.props.maxRows,
    dock: dockKind,
    header: showTasks && !docked,
    focus: want.focus,
    shell: want.shell,
    plan: want.plan,
    tails: want.tails,
    usage: usageRows.length,
    expanded: d.all,
  })
  // With no plan, running shells and agents draw alone in the shell slot, their label included.
  const shell = !fit.header && fit.shell > 1 ? <Box key="shell" flexDirection="column">{planBody(ui, C, d, fit.shell).rows}</Box> : null
  const usage = fit.usage && usageRows.length ? <Box key="usage" flexDirection="column">{usageRows}</Box> : null
  const band = (rows: (RenderElement | null | undefined)[]) => ({
    fit,
    el: (
      <Box flexDirection="column" marginTop={fit.margin ? 1 : 0} paddingLeft={1}>
        {rows}
      </Box>
    ),
  })
  if (!showTasks || !fit.header) return shell || usage ? band([shell, usage]) : { el: null, fit }

  const body = planBody(ui, C, d, fit.focus ? fit.plan + 1 : 0)
  // The header reads the whole list for its count, even once the plan is finished.
  const header = planHeader(ui, C, { ...d, tasks: list }, {
    surface: e.surface,
    columns: e.props.bodyColumns,
    toggle: { hidden: body.hidden, onPress: () => update($, planAll, v => !v) },
  })
  return band([header, ...body.rows, usage])
}

// A background job's output file for shellTails (shell.ts); a file too big for one read shows nothing.
const readTail = ($: EngineInterface) => async (path: string) =>
  (await $.fs.stat(path)).size <= MAX_TAIL_BYTES ? String(await $.fs.read(path)) : undefined

const SCENE_MAX = 64
// Below these widths the key hints, then the phase times, drop rather than wrap the row.
const KEYS_FROM = 72
const PHASES_FROM = 56
const KEYS = [['⏎', 'send'], ['/', 'commands'], ['@', 'files'], ['?', 'shortcuts']] as const

// The prompt dock: the crab's corner and the prompt label when idle; the step, the scene and the calls while a turn runs.
// A compact size (layout.ts, when the plan needs the rows) keeps the label, or the step and calls, without the picture.
async function dockBand($: EngineInterface, e: Band, fit: BandFit): Promise<RenderElement> {
  const size = fit.dock
  const { Box, Text, Raster } = $.ui.resolve(e) as ReturnType<EngineInterface['ui']['resolve']> & { Raster: (props: Record<string, unknown>) => RenderElement }
  const C = palette()
  await read($, tick)
  const turn = await read($, dock)
  const now = await $.clock.now()
  const view = dockView(turn ?? undefined, now)
  site.id = e.requestId
  if (view.kind === 'idle' || !turn) {
    site.cols = undefined
    const project = (await $.session.root()).split(/[\\/]/).filter(Boolean).pop() ?? ''
    const label = (
      <Box key="dock-label">
        <Box flexShrink={0}><Text color={C.accent} bold wrap="truncate-end">{'◆ '}</Text></Box>
        <Text color={C.ink} bold wrap="truncate-end">Ask Claude</Text>
        {project && <Text color={C.faint} wrap="truncate-end">{`  ${project}`}</Text>}
        <Box flexGrow={1} />
        {e.props.bodyColumns >= KEYS_FROM && (
          <Box flexShrink={0}>
            {KEYS.flatMap(([key, word], i) => [
              <Text key={`k${i}`} color={C.accent} wrap="truncate-end">{`${i ? '   ' : ''}${key}`}</Text>,
              <Text key={`w${i}`} color={C.faint} wrap="truncate-end">{` ${word}`}</Text>,
            ])}
          </Box>
        )}
      </Box>
    )
    if (size === 'idle-compact') {
      return (
        <Box key="dock" marginTop={1} paddingLeft={1}>
          {label}
        </Box>
      )
    }
    return (
      <Box key="dock" marginTop={1} paddingLeft={1}>
        <Raster key="dock-idle" columns={IDLE_COLS} rows={IDLE_ROWS} cells={encodeCells(idleCells(false, C))} />
        <Box flexDirection="column" flexGrow={1}>
          <Text> </Text>
          {label}
          <Text> </Text>
        </Box>
      </Box>
    )
  }
  const compact = fit.scene === 0
  const cols = Math.max(20, Math.min(SCENE_MAX, e.props.bodyColumns - 2))
  // A squeezed band draws a shorter scene (layout.ts); the dock's frame loop paints at the same height.
  const rows = fit.scene || SCENE_ROWS
  site.cols = compact ? undefined : cols
  site.rows = rows
  const mode = modeAt(turn, now)
  const live = Object.values(await read($, liveCalls)).filter(c => c.agentId === undefined)
  const ending = view.kind === 'finish' || view.kind === 'outro'
  const step = ending ? (turn.aborted ? 'Stopped' : 'Done!') : (activity(live) ?? STEP[mode])
  const result = ending && !turn.aborted ? score(turn) : undefined
  const spent = phaseTimes(turn, now)
  const color = MODE_COLOR(C)[mode]
  const recent = turn.calls.slice(-3)
  return (
    <Box key="dock" flexDirection="column" marginTop={1} paddingLeft={1}>
      <Box>
        <Box flexShrink={0}><Text color={ending ? C.accent : color} bold wrap="truncate-end">{'◆ '}</Text></Box>
        <Text color={C.ink} bold wrap="truncate-end">{ending ? step : `${step}…`}</Text>
        {result && <Text color={C.warn} bold wrap="truncate-end">{'  ★ '}</Text>}
        {result && <Text color={C.ink} wrap="truncate-end">{`${result.jumped} jumped · ${result.crates} crate${result.crates === 1 ? '' : 's'} · ${fmtClock(result.ms)}`}</Text>}
        <Box flexGrow={1} />
        {/* The phase times and the clock hold their width; a long step label truncates instead. */}
        {!ending && e.props.bodyColumns >= PHASES_FROM && (
          <Box key="phases" flexShrink={0}>
            {(['thinking', 'tool', 'responding'] as const).flatMap((m, i) => [
              <Text key={`p${m}`} color={m === mode ? MODE_COLOR(C)[m] : C.faint} wrap="truncate-end">{`${i ? ' · ' : '  '}${PHASE_LABEL[m]} `}</Text>,
              <Text key={`s${m}`} color={m === mode ? C.ink : C.faint} wrap="truncate-end">{`${Math.round(spent[m])}s`}</Text>,
            ])}
          </Box>
        )}
        {!result && (
          <Box key="clock" flexShrink={0}>
            <Text color={C.mid} wrap="truncate-end">{`   ${fmtClock((turn.endedAt ?? now) - turn.startedAt)}`}</Text>
          </Box>
        )}
      </Box>
      {!compact && <Raster key="dock-scene" columns={cols} rows={rows} cells={encodeCells(sceneCells(view, turn, now, cols, C, rows))} />}
      {fit.calls && <Box>
        {recent.length === 0 ? (
          <Text color={C.faint} wrap="truncate-end">Waiting for the first tool call</Text>
        ) : (
          recent.map((c, i) => (
            <Box key={`c${c.id}`}>
              <Text color={c.done ? C.mid : color} wrap="truncate-end">{`${i ? '    ' : ''}${c.done ? '✓' : '…'} `}</Text>
              <Text color={c.done ? C.faint : C.ink} wrap="truncate-end">{c.label}</Text>
            </Box>
          ))
        )}
      </Box>}
    </Box>
  )
}

const STEP = { requesting: 'Working', thinking: 'Thinking', tool: 'Running a tool', responding: 'Writing the reply' } as const
const PHASE_LABEL = { thinking: 'think', tool: 'tools', responding: 'reply' } as const
const MODE_COLOR = (C: ReturnType<typeof palette>) => ({ requesting: C.faint, thinking: C.accent, tool: C.info, responding: C.ink })
