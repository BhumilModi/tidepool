import type { CallTiming, Job, PlanAgent, RailRow, RailSummary, TurnSpan } from '../types'

// Anchor rows on screen, by turn id. Render hooks may not write plugin state, so the anchor row records here
// and the rail's one-second timer (features/startup.tsx) copies changes into the anchorsSeen atom.
// ponytail: the rail follows a scroll within a second, not on the same frame.
export const anchorsOnScreen = new Map<string, boolean>()

// The calls waiting on the person: a question, or a call held at a permission prompt (features/track.tsx). The
// plan reads amber while any waits; only those calls clear it, not another call finishing beside them.
export const waitingOn = new Map<string, 'question' | 'permission'>()
// Calls the engine has drawn as running: a Bash call's background hint (features/chrome.tsx) shows only once it
// runs, so its permission was granted. Recorded while drawing; the one-second timer (features/startup.tsx) clears
// those calls' waits, as with anchorsOnScreen above.
// ponytail: a granted call of another tool keeps the amber until it returns; most return within seconds.
export const runningSeen = new Set<string>()

// Where the surface last seated the rail, recorded by its Pane render (a module value, as above): tool rows
// hand over to the rail only while it is docked beside the transcript.
export const railSeat: { placement?: 'dock' | 'inline' } = {}

// Body columns the rail asks for when it opens: enough for the timing bars (showBars) beside the targets.
// A width the person drags the rail to wins.
export const RAIL_COLUMNS = 44

// Which call carries each turn's anchor: the first of the turn's rows that actually draws. Some tools
// (TodoWrite, the Task tools) draw no row, so "the turn's first call" alone could leave a turn with none.
// ponytail: first to draw keeps it; a row scrolled in later from above draws nothing rather than move the anchor.
export const anchorOf = new Map<string, string>()

// The rail's model: which calls belong to a turn and where each sits on the turn's timeline. No engine calls.

const clamp = (x: number) => Math.min(1, Math.max(0, x))

export function turnWindow(turn: TurnSpan, now: number): { start: number; end: number } {
  return { start: turn.startedAt, end: turn.endedAt ?? now }
}

// The newest turn a moment falls in; an open turn reaches to now.
export function turnOfCall(spans: TurnSpan[], at: number): TurnSpan | undefined {
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i]!
    if (s.startedAt <= at && (s.endedAt === undefined || at <= s.endedAt)) return s
  }
  return undefined
}

export function showBars(bodyColumns: number): boolean {
  return bodyColumns >= 40
}

export function railRows(calls: Record<string, CallTiming>, agents: PlanAgent[], jobs: Job[], turn: TurnSpan, now: number): RailRow[] {
  const { start, end } = turnWindow(turn, now)
  const length = Math.max(1, end - start)
  const isOpen = turn.endedAt === undefined
  const children = new Map<string, number>()
  for (const c of Object.values(calls)) if (c.agentId !== undefined) children.set(c.agentId, (children.get(c.agentId) ?? 0) + 1)

  return Object.entries(calls)
    .filter(([, c]) => c.agentId === undefined && c.startedAt >= start && c.startedAt <= end)
    .sort(([, a], [, b]) => a.startedAt - b.startedAt)
    .map(([id, c]) => {
      const job = jobs.find(j => j.callId === id)
      const agent = agents.find(a => a.callId === id)
      // A background shell runs on after its Bash call returns, and an agent after its Agent call returns:
      // each ends at its own end (the job's notification, the agent's turn completing).
      const running = job ? job.status === 'running' : agent ? agent.endedAt === undefined : c.endedAt === undefined && isOpen
      const stop = job ? (job.endedAt ?? now) : agent ? (agent.endedAt ?? now) : (c.endedAt ?? (isOpen ? now : end))
      const row: RailRow = {
        id,
        tool: c.tool,
        target: c.target ?? '',
        from: clamp((c.startedAt - start) / length),
        to: clamp((Math.min(stop, end) - start) / length),
        over: !isOpen && stop > end,
        running,
        failed: c.failed === true,
        kind: job ? 'job' : agent ? 'agent' : 'tool',
        ms: (job || agent ? stop : Math.min(stop, end)) - c.startedAt,
      }
      if (c.added !== undefined) row.added = c.added
      if (c.removed !== undefined) row.removed = c.removed
      if (agent) row.children = children.get(agent.id) ?? 0
      return row
    })
}

export function railSummary(rows: RailRow[], turn: TurnSpan, now: number): RailSummary {
  const { start, end } = turnWindow(turn, now)
  const files = new Map<string, { path: string; added: number; removed: number }>()
  const failures = new Map<string, { label: string; times: number }>()
  for (const r of rows) {
    if (r.added !== undefined || r.removed !== undefined) {
      const f = files.get(r.target) ?? { path: r.target, added: 0, removed: 0 }
      f.added += r.added ?? 0
      f.removed += r.removed ?? 0
      files.set(r.target, f)
    }
    if (r.failed) {
      const label = `${r.tool} ${r.target}`.trim()
      const f = failures.get(label) ?? { label, times: 0 }
      f.times += 1
      failures.set(label, f)
    }
  }
  const summary: RailSummary = {
    ms: end - start,
    tools: rows.reduce((n, r) => n + 1 + (r.children ?? 0), 0),
    agents: rows.filter(r => r.kind === 'agent').length,
    files: [...files.values()],
    failures: [...failures.values()],
  }
  if (turn.ctxStart !== undefined) summary.ctx = [turn.ctxStart, turn.ctxEnd ?? turn.ctxStart]
  if (turn.costStart !== undefined && turn.costEnd !== undefined) summary.cost = turn.costEnd - turn.costStart
  return summary
}

// Which turn the rail shows: a pinned one; else the live turn while its anchor is on screen or not drawn yet;
// else the first turn whose anchor is on screen; else the newest.
// ponytail: with no anchor on screen (mid long reply) it falls back to the newest turn, not the one scrolled past.
export function pickTurn(
  spans: TurnSpan[],
  sel: { turnId?: string; pinned: boolean },
  seen: Record<string, boolean>,
): TurnSpan | undefined {
  if (sel.pinned) {
    const pinned = spans.find(s => s.turnId === sel.turnId)
    if (pinned) return pinned
  }
  const live = spans.findLast(s => s.endedAt === undefined)
  if (live && seen[live.turnId] !== false) return live
  return spans.find(s => seen[s.turnId] === true) ?? spans.at(-1)
}

const MAX_DETAIL = 200
const firstLine = (text: unknown) => (typeof text === 'string' ? (text.split('\n')[0] ?? '') : '').slice(0, MAX_DETAIL)

// What a pressed rail row shows under itself: the Bash command and its last output lines, or the error.
export function callDetail(tool: string, input: unknown, ran: { result?: unknown; isError?: boolean; text?: string }): string[] {
  const i = (input ?? {}) as Record<string, unknown>
  const lines: string[] = []
  if (tool === 'Bash') {
    lines.push(`$ ${firstLine(i.command)}`)
    const out = (ran.result ?? {}) as { stdout?: unknown; stderr?: unknown }
    const text = [out.stdout, out.stderr].filter(t => typeof t === 'string').join('\n')
    lines.push(...text.split('\n').filter(l => l.trim()).slice(-3).map(l => l.slice(0, MAX_DETAIL)))
  }
  if (ran.isError && ran.text) lines.push(firstLine(ran.text))
  return lines
}

export type SectionName = 'timeline' | 'plan' | 'files'
// Who gets the odd row and the rows another section leaves.
const SECTION_ORDER: SectionName[] = ['plan', 'timeline', 'files']

// Rows the docked rail spends besides the sections' bodies: the brand line, then a blank row and a header for each
// of the three sections.
export const RAIL_FIXED_ROWS = 7

// Body rows for each docked-rail section, headers and gaps excluded: the rest of the rail split in fixed thirds among
// the open sections that have something to show, the odd rows to the first in plan, timeline, files order. An open
// section keeps its third even when it needs fewer rows, so the split never moves; a collapsed or empty section gets
// 0 and the open ones share its third. With `all`, the plan gets its whole tree (at least its third) and the rail
// scrolls.
export function sections(a: {
  bodyRows: number
  asks: Record<SectionName, number>
  open: Record<SectionName, boolean>
  all: boolean
}): Record<SectionName, number> {
  const out: Record<SectionName, number> = { timeline: 0, plan: 0, files: 0 }
  const avail = Math.max(0, a.bodyRows - RAIL_FIXED_ROWS)
  const live = SECTION_ORDER.filter(s => a.open[s] && a.asks[s] > 0)
  if (live.length === 0) return out
  const share = Math.floor(avail / live.length)
  const odd = avail - share * live.length
  for (const s of live) out[s] = share + (s === live[0] ? odd : 0)
  if (a.all && live.includes('plan')) out.plan = Math.max(out.plan, a.asks.plan)
  return out
}
