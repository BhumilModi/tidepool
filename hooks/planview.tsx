import type { EngineInterface, RenderElement } from 'claude-code'

import type { PlanState, PlanTask } from '../types'
import { estimate, fmt, fmtClock, fmtTokens, modelName, planStats, stages, timeLeft, topLevel, visibleAgents, windowLines } from './plan'
import type { AgentRow } from './plan'
import { commandKey, shellEta } from './shell'
import type { ShellRow } from './shell'
import { bar, glyphsOn, palette, powerline, runsWidth } from './theme'
import type { Segment } from './theme'

// The plan's drawing, shared by the band (features/tasks.tsx) and the rail (features/rail.tsx).
// Pure: each caller reads state and output files itself, since `$` never crosses an import.

export type Palette = ReturnType<typeof palette>
type Resolved = ReturnType<EngineInterface['ui']['resolve']>
export type PlanUi = Pick<Resolved, 'Box' | 'Text' | 'Button'>

export type PlanData = {
  tasks: PlanTask[]
  agents: AgentRow[]
  shells: ShellRow[]
  // A background job's output file -> its newest line.
  tails: Record<string, string>
  shellHistory: Record<string, number[]>
  planHistory: number[]
  now: number
  all: boolean
  // Waiting on the person or stopped short; absent reads as running.
  state?: PlanState
  // Each running agent's tool in flight, by agent id.
  agentTools?: Record<string, string>
}

export const MAX_TASK_ROWS = 12
// Agents and shells shown under one task, the newest; a note counts the rest.
const MAX_WORK_ROWS = 4

export type Line =
  | { kind: 'task'; task: PlanTask; n: number }
  | { kind: 'sub'; task: PlanTask }
  | { kind: 'agent'; agent: AgentRow; indent: string }
  | { kind: 'shell'; shell: ShellRow; indent: string }
  | { kind: 'tail'; text: string; indent: string }
  | { kind: 'note'; text: string }

type Work = { at: number; line: Line; tail?: Line }

// The plan as one tree, a row per line: each task; its sub-items while it or one of them runs, or has work to show
// (every task's sub-items when showing all); under each, the agents and shells that started under it, a running
// background shell's newest output line under its row. Work from no task in the plan closes the tree in one group;
// with no plan, that group is the shells alone, labelled "shell". `focus` is the running task's line, else the first unfinished one.
export function planLines(d: PlanData): { lines: Line[]; focus: number } {
  const ids = new Set(d.tasks.map(t => t.id))
  const owned = new Map<string | undefined, Work[]>()
  const own = (taskId: string | undefined, work: Work) => {
    const key = taskId !== undefined && ids.has(taskId) ? taskId : undefined
    owned.set(key, [...(owned.get(key) ?? []), work])
  }
  // With no plan, agents are left to the tool rows, as before; shells still draw.
  for (const agent of d.tasks.length > 0 ? visibleAgents(d.agents, d.now) : []) {
    own(agent.taskId, { at: agent.startedAt, line: { kind: 'agent', agent, indent: '' } })
  }
  for (const shell of d.shells) {
    const said = shell.status === 'running' && shell.outputFile !== undefined ? d.tails[shell.outputFile] : undefined
    own(shell.taskId, {
      at: shell.startedAt,
      line: { kind: 'shell', shell, indent: '' },
      ...(said ? { tail: { kind: 'tail' as const, text: said, indent: '' } } : {}),
    })
  }
  const workOf = (taskId: string | undefined, indent: string): Line[] => {
    const list = [...(owned.get(taskId) ?? [])].sort((x, y) => x.at - y.at)
    const shown = list.slice(-MAX_WORK_ROWS)
    const out: Line[] = list.length > shown.length ? [{ kind: 'note', text: `${indent}+${list.length - shown.length} earlier` }] : []
    for (const w of shown) {
      out.push({ ...w.line, indent } as Line)
      if (w.tail) out.push({ ...w.tail, indent: `${indent}  ` } as Line)
    }
    return out
  }

  const lines: Line[] = []
  let focus = -1
  let next = -1
  topLevel(d.tasks).forEach((t, i) => {
    if (focus < 0 && t.status === 'in_progress') focus = lines.length
    if (next < 0 && t.status !== 'completed') next = lines.length
    lines.push({ kind: 'task', task: t, n: i + 1 })
    const subs = d.tasks.filter(c => c.parent === t.id)
    const open = d.all || t.status === 'in_progress' || subs.some(c => c.status === 'in_progress' || owned.has(c.id))
    if (open) {
      for (const sub of subs) {
        lines.push({ kind: 'sub', task: sub }, ...workOf(sub.id, '        '))
      }
    }
    lines.push(...workOf(t.id, '    '))
  })
  const loose = workOf(undefined, '    ')
  if (loose.length > 0) lines.push({ kind: 'note', text: d.tasks.length > 0 ? '  outside the plan' : '  shell' }, ...loose)
  return { lines, focus: Math.max(0, focus >= 0 ? focus : next) }
}

// What the plan asks of a row budget. With a plan: its rows past the header's task line. With none: the
// running work's rows, its label included, asked as `shell` (those rows come before the crab grows).
// Output lines are rows of the tree, so `tails` is always 0; callers read output files before asking.
export function planWanted(d: PlanData): { plan: number; shell: number; tails: number; focus: boolean } {
  const { lines } = planLines(d)
  if (d.tasks.length === 0) return { plan: 0, shell: lines.length, tails: 0, focus: false }
  const others = Math.max(0, lines.length - 1)
  return { plan: d.all ? others : Math.min(others, MAX_TASK_ROWS), shell: 0, tails: 0, focus: true }
}

// The powerline header; with `toggle`, a show-all Button (key "all") whenever rows are hidden or all are shown.
export function planHeader(
  ui: PlanUi,
  C: Palette,
  d: PlanData,
  o: { surface: string; columns: number; toggle?: { hidden: number; onPress: () => void }; keys?: string },
): RenderElement {
  const { Box, Text, Button } = ui
  const top = topLevel(d.tasks)
  const { done, total } = estimate(top, d.now, d.planHistory)
  const finished = total > 0 && done === total
  // Waiting on the person reads amber, stopped short red; the running stage takes the same colour.
  const state = finished ? 'running' : (d.state ?? 'running')
  const tone = state === 'waiting' ? C.warn : state === 'stopped' ? C.crit : C.accent
  const name = finished ? ' ✓ Plan ' : state === 'waiting' ? ' Plan · needs you ' : state === 'stopped' ? ' Plan · stopped ' : ' Plan '
  const progress = bar(total ? done / total : 0)
  const parts = stages(top, d.now, d.planHistory)
  const meter = finished || !parts
    ? [{ text: progress.filled, color: finished ? C.accent : C.mid }, { text: `${progress.track} `, color: C.track }]
    : [
        ...parts.map(p => ({ text: p.text, color: p.part === 'done' ? C.mid : p.part === 'run' ? tone : C.track })),
        { text: ' ', color: C.track },
      ]
  const header: Segment[] = [
    { bg: tone, parts: [{ text: name, color: C.onAccent, bold: true }] },
    {
      bg: C.seg,
      parts: [{ text: ` ${done}/${total} `, color: C.ink }, ...meter],
    },
    { bg: C.segAlt, parts: [{ text: ` ${timeLeft(top, d.now, d.planHistory)} `, color: finished ? C.mid : C.ink }] },
  ]
  const toggle = !o.toggle ? '' : d.all ? '▴ fewer' : o.toggle.hidden > 0 ? '▾ show all' : ''
  // Narrow: drop the time-left segment rather than wrap the header.
  let runs = powerline(header, glyphsOn(o.surface))
  if (runsWidth(runs) + toggle.length + 2 > o.columns - 2) runs = powerline(header.slice(0, 2), glyphsOn(o.surface))
  return (
    <Box key="header">
      {runs.map((run, i) => (
        <Text key={`${o.keys ?? 'h'}${i}`} color={run.color} backgroundColor={run.backgroundColor} bold={run.bold}>
          {run.text}
        </Text>
      ))}
      {toggle && o.toggle && (
        <Button key="all" plain dimColor onPress={o.toggle.onPress}>
          {`  ${toggle}`}
        </Button>
      )}
    </Box>
  )
}

function drawLine(ui: PlanUi, C: Palette, d: PlanData, line: Line, key: string): RenderElement {
  const { Box, Text } = ui
  const now = d.now
  if (line.kind === 'note') return <Text key={key} color={C.faint}>{line.text}</Text>
  if (line.kind === 'tail') return <Text key={key} color={C.faint} wrap="truncate-end">{`${line.indent}${line.text}`}</Text>
  if (line.kind === 'shell') return drawShell(ui, C, d, line.shell, line.indent, key)
  if (line.kind === 'agent') {
    const a = line.agent
    const time = fmtClock((a.endedAt ?? now) - a.startedAt)
    const meta = a.tokens ? `${time} · ${fmtTokens(a.tokens)} tokens` : time
    const mark = a.status === 'running' ? '◆' : a.status === 'done' ? '✓' : '✕'
    const isLive = a.status === 'running'
    return (
      <Box key={key}>
        <Box flexShrink={0}>
          <Text color={isLive ? C.accent : C.track}>{`${line.indent}${mark} `}</Text>
          <Text color={isLive ? C.soft : C.faint}>{a.type}</Text>
          {a.model && <Text color={C.faint}>{` · ${modelName(a.model)}`}</Text>}
          {isLive && d.agentTools?.[a.id] && <Text color={C.mid}>{` · ${d.agentTools[a.id]}`}</Text>}
        </Box>
        <Text color={C.faint} wrap="truncate-end">{`  ${a.description}`}</Text>
        <Box flexShrink={0}><Text color={isLive ? C.mid : C.track}>{`  ${meta}`}</Text></Box>
      </Box>
    )
  }
  const t = line.task
  const indent = line.kind === 'sub' ? '    ' : ''
  const label = line.kind === 'task' ? `${line.n}. ${t.subject}` : t.subject
  if (t.status === 'completed') {
    const took = t.startedAt !== undefined && t.doneAt !== undefined ? fmt(t.doneAt - t.startedAt) : ''
    return (
      <Box key={key}>
        <Box flexShrink={0}><Text color={C.mid}>{`${indent}✓ `}</Text></Box>
        <Text color={C.faint} wrap="truncate-end">{label}</Text>
        {took && <Box flexShrink={0}><Text color={C.track}>{`  ${took}`}</Text></Box>}
      </Box>
    )
  }
  if (t.status === 'in_progress') {
    const running = t.startedAt !== undefined ? fmtClock(now - t.startedAt) : ''
    const isSub = line.kind === 'sub'
    return (
      <Box key={key}>
        <Box flexShrink={0}><Text color={C.accent} bold={!isSub}>{`${indent}${isSub ? '▸' : '▶'} `}</Text></Box>
        <Text color={isSub ? C.soft : C.ink} bold={!isSub} wrap="truncate-end">{label}</Text>
        {running && <Box flexShrink={0}><Text color={C.mid}>{`  ${running}`}</Text></Box>}
      </Box>
    )
  }
  return (
    <Box key={key}>
      <Box flexShrink={0}><Text color={C.track}>{`${indent}· `}</Text></Box>
      <Text color={C.soft} wrap="truncate-end">{label}</Text>
    </Box>
  )
}

// Plan lines in `room` rows around the running task, markers included. `hidden` counts what the toggle would add.
export function planBody(ui: PlanUi, C: Palette, d: PlanData, room: number): { rows: RenderElement[]; hidden: number } {
  const { Text } = ui
  const { lines, focus } = planLines(d)
  const { start, shown, before, after } = room > 0 ? windowLines(lines, focus, room) : { start: 0, shown: [], before: 0, after: 0 }
  const hidden = d.all ? 0 : planLines({ ...d, all: true }).lines.length - shown.length
  const rows: RenderElement[] = []
  if (before > 0) rows.push(<Text key="before" color={C.faint}>{`  ${before} earlier`}</Text>)
  shown.forEach((line, i) => rows.push(drawLine(ui, C, d, line, `line-${start + i}`)))
  if (after > 0) rows.push(<Text key="after" color={C.faint}>{`  +${after} more`}</Text>)
  return { rows, hidden }
}

// One shell's row: elapsed time, and the ETA from past runs of the same command while it runs.
function drawShell(ui: PlanUi, C: Palette, d: PlanData, r: ShellRow, indent: string, key: string): RenderElement {
  const { Box, Text } = ui
  const isLive = r.status === 'running'
  let meta = fmtClock((r.endedAt ?? d.now) - r.startedAt)
  const eta = isLive && r.command !== undefined ? shellEta(d.shellHistory, commandKey(r.command), d.now - r.startedAt) : undefined
  if (eta) meta += 'left' in eta ? ` · ~${fmt(eta.left)} left` : ` · over by ${fmt(eta.over)}`
  if (r.status === 'killed') meta += ' · stopped'
  const mark = isLive ? '▶' : r.status === 'done' ? '✓' : '✕'
  return (
    <Box key={key}>
      <Box flexShrink={0}>
        <Text color={isLive ? C.accent : r.status === 'error' ? C.crit : C.track}>{`${indent}${mark} `}</Text>
        <Text color={r.background ? C.warn : C.faint}>{r.background ? 'bg ' : '$ '}</Text>
      </Box>
      <Text color={isLive ? C.ink : C.faint} wrap="truncate-end">{r.label}</Text>
      <Box flexShrink={0}><Text color={isLive ? C.mid : C.track}>{`  ${meta}`}</Text></Box>
    </Box>
  )
}

// A finished plan's card under its `✓ Plan` header: the crab (a Raster the caller draws and animates), then the
// count of tasks and sub-items with the total time, and the fastest and longest task.
export function doneCard(ui: PlanUi, C: Palette, tasks: PlanTask[], crab: RenderElement): RenderElement {
  const { Box, Text } = ui
  const s = planStats(tasks)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const count = [plural(s.tasks, 'task'), s.subs ? plural(s.subs, 'sub-item') : '', fmt(s.ms)].filter(Boolean).join(' · ')
  const pace = s.tasks > 1 && s.fastest !== undefined && s.longest !== undefined ? `fastest ${fmt(s.fastest)} · longest ${fmt(s.longest)}` : ''
  return (
    <Box key="done" flexDirection="row">
      {crab}
      <Box flexDirection="column" paddingLeft={2}>
        <Text color={C.ink} wrap="truncate-end">{`★ ${count}`}</Text>
        {pace ? <Text color={C.faint} wrap="truncate-end">{pace}</Text> : null}
      </Box>
    </Box>
  )
}
