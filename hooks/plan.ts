import type { LiveCall, PlanAgent, PlanTask, TurnRecord } from '../types'
import { totalTokens } from './timing'

type Status = PlanTask['status']

export function setStatus(task: PlanTask, status: Status, now: number): PlanTask {
  if (status === task.status) return task
  if (status === 'in_progress') return { ...task, status, startedAt: now }
  if (status === 'completed') return { ...task, status, doneAt: now }
  return { ...task, status }
}

// TodoWrite sends the whole list each time; keep timestamps of todos we already know.
export function syncTodos(
  old: PlanTask[],
  todos: ReadonlyArray<{ content: string; status: Status; activeForm?: string }>,
  now: number,
): PlanTask[] {
  return todos.map(todo => {
    const known = old.find(t => t.id === todo.content)
    const base = known ?? { id: todo.content, subject: todo.content, status: 'pending' as Status, createdAt: now }
    return setStatus(todo.activeForm ? { ...base, activeForm: todo.activeForm } : base, todo.status, now)
  })
}

// How long each finished task took. A task marked done without being started counts from the previous finish.
export function durations(tasks: PlanTask[]): Map<string, number> {
  let prevDone = Math.min(...tasks.map(t => t.createdAt))
  const out = new Map<string, number>()
  for (const t of tasks.filter(t => t.status === 'completed').sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0))) {
    const start = t.startedAt ?? prevDone
    prevDone = t.doneAt ?? prevDone
    out.set(t.id, Math.max(0, (t.doneAt ?? start) - start))
  }
  return out
}

// Durations of tasks that finished between two versions of the list.
export function newlyDone(before: PlanTask[], after: PlanTask[]): number[] {
  const wasDone = new Set(before.filter(t => t.status === 'completed').map(t => t.id))
  const took = durations(after)
  return after.filter(t => t.status === 'completed' && !wasDone.has(t.id)).map(t => took.get(t.id) ?? 0)
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

// Past plans count as PRIOR_WEIGHT tasks, so this plan's own pace takes over after a few tasks.
// Median of history so one task left running overnight doesn't skew it.
// ponytail: one global history across projects and task sizes; key by project if estimates drift.
const PRIOR_WEIGHT = 2

export function estimate(tasks: PlanTask[], now: number, history: number[] = []) {
  const took = [...durations(tasks).values()]
  const done = took.length
  const left = tasks.length - done
  const prior = median(history)
  const sum = took.reduce((a, b) => a + b, 0)
  const avg =
    prior === undefined ? (done ? sum / done : undefined) : (sum + PRIOR_WEIGHT * prior) / (done + PRIOR_WEIGHT)
  const running = tasks.filter(t => t.status === 'in_progress')
  const runningElapsed = running.reduce((total, t) => total + Math.min(avg ?? 0, now - (t.startedAt ?? now)), 0)
  const msLeft = avg === undefined ? undefined : Math.max(0, avg * left - runningElapsed)
  const first = Math.min(...tasks.map(t => t.startedAt ?? t.createdAt))
  // A finished plan stops at its last task's finish; otherwise the clock runs to now.
  const end = done === tasks.length ? Math.max(...tasks.map(t => t.doneAt ?? first)) : now
  return { done, total: tasks.length, msLeft, elapsed: end - first, fromPastOnly: done === 0 && prior !== undefined, avg }
}

export type Stage = { text: string; part: 'done' | 'run' | 'todo' | 'gap' }

// The bar split into one stage per top-level task, a blank cell between stages: done stages full, the running one
// filled by its elapsed over the average task (held short of full), the rest track. Undefined when the tasks do not
// fit two cells each; the caller draws the plain bar.
export function stages(tasks: PlanTask[], now: number, history: number[] = [], min = 12, max = 24): Stage[] | undefined {
  const n = tasks.length
  // Two cells a stage and a gap between, widening past `min` up to `max` for longer plans.
  const width = Math.max(min, n * 3 - 1)
  const cells = width - (n - 1)
  if (n === 0 || width > max) return undefined
  const { avg } = estimate(tasks, now, history)
  const out: Stage[] = []
  tasks.forEach((t, i) => {
    const w = Math.floor((cells * (i + 1)) / n) - Math.floor((cells * i) / n)
    if (i > 0) out.push({ text: ' ', part: 'gap' })
    if (t.status === 'completed') return out.push({ text: '━'.repeat(w), part: 'done' })
    if (t.status === 'pending') return out.push({ text: '─'.repeat(w), part: 'todo' })
    const ran = avg ? Math.min(0.9, (now - (t.startedAt ?? now)) / avg) : 0
    // Held at least a half cell short of full: a full stage reads as done.
    const units = Math.min(w * 2 - 1, Math.max(1, Math.round(ran * w * 2)))
    const full = units >> 1
    const filled = '━'.repeat(full) + (units % 2 ? '╸' : '')
    out.push({ text: filled, part: 'run' }, { text: '─'.repeat(w - filled.length), part: 'todo' })
  })
  return out.filter(s => s.text !== '')
}

// Each agent's tool in flight, by agent id: the last one listed when it runs several.
export function agentTools(live: Record<string, LiveCall>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of Object.values(live)) if (c.agentId !== undefined) out[c.agentId] = c.tool
  return out
}

// Store key for each session's plan, kept so a resumed session gets it back: keyed by the session's first launch
// (`$.session.usage().startedAt`), which a resume keeps.
export const RESUME_KEY = 'plans-by-session'
export const sessionKey = (usage: { startedAt: number }) => String(usage.startedAt)
export type KeptPlans = Record<string, PlanTask[]>

// What the model reads after an approved plan: track it as tasks, so the plan band draws it.
export const PLAN_NUDGE = 'Before starting, track this plan with TaskCreate: one task per step, in order. Mark each in_progress when you start it and completed when it is done.'

// A model id's family, for a row: `claude-haiku-4-5` reads `haiku`; anything else as given.
export function modelName(model: string | undefined): string | undefined {
  return model?.match(/opus|sonnet|haiku|fable/i)?.[0]?.toLowerCase() ?? model
}

export function fmt(ms: number): string {
  const m = Math.round(ms / 60000)
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// The time-left part of the header, without the "Plan x/y" prefix.
export function timeLeft(tasks: PlanTask[], now: number, history: number[] = []): string {
  const { done, total, msLeft, elapsed, fromPastOnly } = estimate(tasks, now, history)
  if (done === total) return `done in ${fmt(elapsed)}`
  if (msLeft === undefined) return 'ETA after first task'
  return `~${fmt(msLeft)} left${fromPastOnly ? ' (from past plans)' : ''}`
}

export function summary(tasks: PlanTask[], now: number, history: number[] = []): string | undefined {
  if (tasks.length === 0) return undefined
  const { done, total, msLeft, elapsed, fromPastOnly } = estimate(tasks, now, history)
  if (done === total) return `Plan ${done}/${total} done in ${fmt(elapsed)}`
  if (msLeft === undefined) return `Plan ${done}/${total} · ETA after first task`
  return `Plan ${done}/${total} · ~${fmt(msLeft)} left${fromPastOnly ? ' (from past plans)' : ''}`
}

// Which tasks fit in `room` rows: one finished task for context, then the running one and what's next.
export function window(tasks: PlanTask[], room: number) {
  if (tasks.length <= room) return { start: 0, shown: tasks, after: 0 }
  const current = tasks.findIndex(t => t.status !== 'completed')
  const start = Math.max(0, Math.min(current - 1, tasks.length - room))
  const shown = tasks.slice(start, start + room)
  return { start, shown, after: tasks.length - start - shown.length }
}

// The task new work (an agent, a shell) belongs to: the running sub-item started last, else the running task
// started last. Sub-items whose parent is gone count as tasks.
// ponytail: ignores which loop spawned the work; match on parentAgentId if parallel controllers mix up.
export function currentTaskId(tasks: PlanTask[]): string | undefined {
  const ids = new Set(tasks.map(t => t.id))
  const newest = (list: PlanTask[]) => list.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]?.id
  const running = tasks.filter(t => t.status === 'in_progress')
  return newest(running.filter(t => t.parent !== undefined && ids.has(t.parent))) ?? newest(running)
}

// Finished agents stay visible this long before folding away.
export const AGENT_LINGER_MS = 30_000

export type AgentRow = PlanAgent & { status: 'running' | 'done' | 'stopped'; endedAt?: number; tokens?: number }

// An agent is done once a turn of its loop has completed; tokens add up over all its turns.
// ponytail: a background agent woken again by SendMessage reads as done until that turn ends too.
export function agentRows(agents: PlanAgent[], turns: TurnRecord[]): AgentRow[] {
  return agents.map(a => {
    if (a.endedAt !== undefined) return { ...a, status: a.stopped ? 'stopped' : 'done', endedAt: a.endedAt, tokens: a.tokens ?? 0 }
    const own = turns.filter(t => t.agentId === a.id)
    const last = own[own.length - 1]
    if (!last) return { ...a, status: 'running' }
    return {
      ...a,
      status: last.aborted ? 'stopped' : 'done',
      endedAt: last.startedAt + last.durationMs,
      tokens: own.reduce((n, t) => n + (t.usage ? totalTokens(t.usage) : 0), 0),
    }
  })
}

// Running agents, and finished ones until they fade.
export function visibleAgents(agents: AgentRow[], now: number): AgentRow[] {
  return agents.filter(a => a.status === 'running' || now - (a.endedAt ?? now) < AGENT_LINGER_MS)
}

// Clock-style duration for live rows, like Claude Code's own agent list: 47s, 2m 47s, 1h 37m.
export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Tasks that count toward the plan: sub-items nest under their parent, unless the parent is gone.
export function topLevel(tasks: PlanTask[]): PlanTask[] {
  const ids = new Set(tasks.map(t => t.id))
  return tasks.filter(t => t.parent === undefined || !ids.has(t.parent))
}

// When a fully finished plan finished; undefined while any task is open.
export function finishedAt(tasks: PlanTask[]): number | undefined {
  if (tasks.length === 0 || tasks.some(t => t.status !== 'completed')) return undefined
  return Math.max(...tasks.map(t => t.doneAt ?? 0))
}

// The plan shows while it has tasks, and for AGENT_LINGER_MS after its last task finishes.
export function planShows(tasks: PlanTask[], now: number): boolean {
  const top = topLevel(tasks)
  const at = finishedAt(top)
  return top.length > 0 && (at === undefined || now - at < AGENT_LINGER_MS)
}

// Which lines fit in `room` rows, an "N earlier" and a "+N more" marker counted as one row each;
// keeps the line before the focus for context. `before` and `after` count what each shown marker hides.
export function windowLines<T>(lines: T[], focus: number, room: number): { start: number; shown: T[]; before: number; after: number } {
  const len = lines.length
  if (len <= room) return { start: 0, shown: lines, before: 0, after: 0 }
  // Too little room for markers around the focus: the focus alone, then a "+N more" if a row is left.
  if (room <= 2) return { start: focus, shown: lines.slice(focus, focus + 1), before: 0, after: room === 2 ? len - focus - 1 : 0 }
  const one = room - 1
  if (focus < one) return { start: 0, shown: lines.slice(0, one), before: 0, after: len - one }
  if (focus >= len - one) return { start: len - one, shown: lines.slice(len - one), before: len - one, after: 0 }
  const body = room - 2
  // The line before the focus only when the body has room for both.
  const start = Math.min(Math.max(1, body > 1 ? focus - 1 : focus), len - body - 1)
  return { start, shown: lines.slice(start, start + body), before: start, after: len - start - body }
}

// Past plans' task durations for a project root, from the store's `history-by-project`;
// a project with none borrows every project's.
export function historyFor(saved: unknown, root: string): number[] {
  if (!saved || typeof saved !== 'object') return []
  const by = saved as Record<string, unknown>
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [])
  return by[root] !== undefined ? nums(by[root]) : Object.values(by).flatMap(nums)
}

// A finished plan's summary: top-level tasks, sub-items, total time, and the fastest and longest task.
export function planStats(tasks: PlanTask[]): { tasks: number; subs: number; ms: number; fastest?: number; longest?: number } {
  const top = topLevel(tasks)
  const took = [...durations(top).values()]
  const { elapsed } = estimate(top, Math.max(...top.map(t => t.doneAt ?? 0)))
  return {
    tasks: top.length,
    subs: tasks.length - top.length,
    ms: elapsed,
    ...(took.length ? { fastest: Math.min(...took), longest: Math.max(...took) } : {}),
  }
}
