export type PlanTask = {
  id: string
  subject: string
  // Present-tense label from TaskCreate/TodoWrite (`Running tests`), shown by the spinner.
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
  // A sub-item's parent task id, from TaskCreate/TaskUpdate `metadata.parent`.
  parent?: string
  createdAt: number
  startedAt?: number
  doneAt?: number
}

export type PlanAgent = {
  id: string
  description: string
  type: string
  // The task that was running when the agent started; undefined when none was.
  taskId?: string
  startedAt: number
  // Set by the tracker when the agent's turn completes, so status survives trimming of old turn records.
  endedAt?: number
  tokens?: number
  stopped?: boolean
  // The Agent call that spawned it: the rail row it shows on.
  callId?: string
  // The model it runs on, as the spawn resolved it.
  model?: string
}

// How the plan stands beside running and done: waiting on the person, or stopped with tasks unfinished.
export type PlanState = 'running' | 'waiting' | 'stopped'

// A tool call in flight, as the spinner reads it.
export type LiveCall = { tool: string; input: Record<string, unknown>; agentId?: string }

export type CallTiming = {
  tool: string
  startedAt: number
  endedAt?: number
  agentId?: string
  // Filled by the tracker for the rail: what the call worked on, its edit size, whether it failed.
  target?: string
  added?: number
  removed?: number
  failed?: true
  // What the rail shows when the row is pressed (hooks/rail.ts callDetail).
  detail?: string[]
  // The plan task running when the call started (hooks/plan.ts currentTaskId): its shell nests under it.
  taskId?: string
  // An Edit or Write: the file it changed, its patch (hooks/files.ts, at most MAX_PATCH_LINES lines), and how
  // many patch lines were dropped past that.
  file?: string
  patch?: Hunk[]
  patchCut?: number
}

// One hunk of a unified diff, as the Edit and Write tools report it (`structuredPatch`).
export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Step = { tool: string; ms: number; count: number }

export type TurnRecord = {
  turnId: string
  agentId?: string
  startedAt: number
  durationMs: number
  usage?: Usage
  steps: Step[]
  aborted?: true
}

export type DockMode = 'requesting' | 'thinking' | 'tool' | 'responding'

// The prompt dock's main turn (hooks/dock.ts draws it).
export type DockTurn = {
  // turn.start's id; turn.complete with the same id ends it.
  turnId?: string
  startedAt: number
  endedAt?: number
  // When the mode changed; before the first, the turn is waiting on the API.
  phases: { mode: DockMode; at: number }[]
  // Main-loop tool calls: each drops a crate on the course.
  // `dist` is the course position the crate drops at, stored once when the call starts.
  calls: { id: string; at: number; label: string; done: boolean; dist?: number }[]
  // Varies the course from turn to turn.
  seed: number
  // Stopped with Esc: no finish line, no score.
  aborted?: boolean
  // Every main-loop tool call this turn (calls keeps only the last 40).
  crates?: number
}

// One main-loop turn, for the rail: when it ran and what context and cost stood at either end.
export type TurnSpan = {
  turnId: string
  // The prompt's first line, shortened: the rail's turn header shows it.
  prompt?: string
  startedAt: number
  endedAt?: number
  aborted?: true
  ctxStart?: number
  ctxEnd?: number
  costStart?: number
  costEnd?: number
}

// A background shell started by a Bash call; it can outlive its turn.
export type Job = {
  id: string
  callId: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'error' | 'killed'
  // The Bash command, for its ETA, and the file its output streams to, for the band's progress line.
  command?: string
  outputFile?: string
  // The plan task its Bash call started under.
  taskId?: string
}

// One rail row. from/to are fractions of the turn's window.
export type RailRow = {
  id: string
  tool: string
  target: string
  from: number
  to: number
  over: boolean
  running: boolean
  failed: boolean
  kind: 'tool' | 'agent' | 'job'
  ms: number
  added?: number
  removed?: number
  children?: number
}

export type RailSummary = {
  ms: number
  tools: number
  agents: number
  ctx?: [number, number]
  cost?: number
  files: { path: string; added: number; removed: number }[]
  failures: { label: string; times: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'tidepool': {
      tasks: PlanTask[]
      agents: PlanAgent[]
      tick: number
      calls: Record<string, CallTiming>
      turns: TurnRecord[]
      live: Record<string, LiveCall>
      dock: DockTurn | null
      spans: TurnSpan[]
      jobs: Job[]
      // Past shell durations by command, loaded from the store on first use (null until then).
      shellHistory: Record<string, number[]> | null
      // The band shows every plan row (toggled from the Plan header).
      planAll: boolean
      chat: number
      railSel: { turnId?: string; pinned: boolean }
      railOpen: string[]
      railNow: number
      anchorsSeen: Record<string, boolean>
      // Docked-rail sections the person collapsed, kept in the store as `rail-collapsed`.
      railCollapsed: ('timeline' | 'plan' | 'files')[]
      // The file the diff pane shows: a turn's id and the file's absolute path.
      diffFile: { turnId: string; path: string } | null
      // The receipt part the rail's timeline is filtered to (hooks/receipt.ts receiptKey), for one turn; or none.
      railFilter: { turnId: string; key: string } | null
      planState: PlanState
    }
  }
}
