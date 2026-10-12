import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { LiveCall, TurnRecord } from '../../types'
import { activity } from '../activity'
import { travelled } from '../dock'
import { addJob, endJob, parseNotifications } from '../jobs'
import { commandKey, parseHistory, parseOutputPath, recordRun } from '../shell'
import { addCall, closeSpan, closeTurn, endCall, totalTokens } from '../timing'
import { callDetail, runningSeen, waitingOn } from '../rail'
import { currentTaskId, topLevel } from '../plan'
import { describeCall, editStats } from '../tools'
import { cutPatch, editPatch } from '../files'
import type { Hunk } from '../../types'

export const calls = atom({ plugin: 'tidepool', key: 'calls' } as const, {})
export const turns = atom({ plugin: 'tidepool', key: 'turns' } as const, [])
const MAX_TURNS = 200

// Calls in flight, by tool_use_id. State (not a module map) so the spinner redraws when one starts or ends.
const live = atom({ plugin: 'tidepool', key: 'live' } as const, {})
// Agent rows (features/tasks.tsx); the tracker records when each agent's turn completes.
const agents = atom({ plugin: 'tidepool', key: 'agents' } as const, [])
// The prompt dock's turn (features/dock.tsx): each main-loop tool call drops a crate, and the turn's end sends the crab home.
const dock = atom({ plugin: 'tidepool', key: 'dock' } as const, null)
// The rail's turns and background shells (features/rail.tsx), and when the current chat began: /clear moves it.
export const spans = atom({ plugin: 'tidepool', key: 'spans' } as const, [])
export const jobs = atom({ plugin: 'tidepool', key: 'jobs' } as const, [])
const chat = atom({ plugin: 'tidepool', key: 'chat' } as const, 0)
// The file the rail's diff pane shows (features/rail.tsx); /clear closes the pane.
const diffFile = atom({ plugin: 'tidepool', key: 'diffFile' } as const, null)
// The plan (features/tasks.tsx): a main-loop call records the task running when it starts.
const tasks = atom({ plugin: 'tidepool', key: 'tasks' } as const, [])
const planState = atom({ plugin: 'tidepool', key: 'planState' } as const, 'running')

// A call that waited on the person has returned: its wait is over.
async function stopWaiting($: EngineInterface, id: string) {
  waitingOn.delete(id)
  runningSeen.delete(id)
  // A permission prompt no call was matched to (alerts.tsx sets it from the notification) clears with any return.
  if (waitingOn.size === 0) await update($, planState, s => (s === 'waiting' ? 'running' : s))
}
// Past shell durations by command (read by the band in features/tasks.tsx), kept in the store across sessions.
const shellHistory = atom({ plugin: 'tidepool', key: 'shellHistory' } as const, null)

async function saveShellRun($: EngineInterface, command: string, ms: number) {
  const key = commandKey(command)
  if (!key) return
  const known = (await read($, shellHistory)) ?? parseHistory(await $.store.get('shell-history'))
  const next = recordRun(known, key, ms)
  await update($, shellHistory, () => next)
  await $.store.set('shell-history', next)
}

let root: string | undefined

// Context % and session cost right now; either is absent where the host keeps none.
async function gauges($: EngineInterface): Promise<{ ctx?: number; cost?: number }> {
  try {
    const usage = await $.session.usage()
    const out: { ctx?: number; cost?: number } = {}
    if (usage.context.percent !== undefined) out.ctx = usage.context.percent
    if (usage.cost) out.cost = usage.cost.usd
    return out
  } catch {
    return {}
  }
}

// A new chat (fresh start or /clear) starts with no turns and no jobs on the rail.
async function syncChat($: EngineInterface) {
  const startedAt = (await $.session.usage()).startedAt
  if ((await read($, chat)) === startedAt) return
  await update($, chat, () => startedAt)
  await update($, spans, () => [])
  await update($, jobs, () => [])
  // The diff pane shows a turn that is gone.
  if ((await read($, diffFile)) !== null) {
    await update($, diffFile, () => null)
    await $.ui.close({ id: 'tidepool-diff' }).catch(() => undefined)
  }
}

export function registerTrack(on: On) {
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    // Tidepool's own re-run of a call (TaskUpdate, features/tasks.tsx) is already tracked as the model's call.
    if (id === undefined || next.origin.plugin === 'tidepool') return next(e)
    const { tool, tool_use_id: _id, agentId, ...rest } = e as typeof e & { agentId?: string; consent?: string }
    const { consent: _consent, ...input } = rest as Record<string, unknown>
    const startedAt = await $.clock.now()
    // Without a root, paths stay absolute; the call is still tracked.
    root ??= await $.session.root().catch(() => '')
    const target = describeCall(tool, input, root)?.target
    const stats = editStats(tool, input)
    const taskId = agentId === undefined ? currentTaskId(await read($, tasks)) : undefined
    await update($, calls, list =>
      addCall(list, id, {
        tool,
        startedAt,
        ...(agentId === undefined ? {} : { agentId }),
        ...(target === undefined ? {} : { target }),
        ...(stats ? { added: stats.added, removed: stats.removed } : {}),
        ...(taskId === undefined ? {} : { taskId }),
      }),
    )
    const call: LiveCall = agentId === undefined ? { tool, input } : { tool, input, agentId }
    await update($, live, map => ({ ...map, [id]: call }))
    if (agentId === undefined) {
      const label = activity([call]) ?? tool
      await update($, dock, t => {
        if (!t || t.endedAt !== undefined) return t
        const phases = t.phases.at(-1)?.mode === 'tool' ? t.phases : [...t.phases, { mode: 'tool' as const, at: startedAt }]
        // Its crate's course position, once; the dock keeps the last 40 calls (it shows three, and crates only near the crab).
        const call = { id, at: startedAt, label, done: false, dist: travelled(t, startedAt) }
        return { ...t, phases, calls: [...t.calls, call].slice(-40), crates: (t.crates ?? t.calls.length) + 1 }
      })
    }
    let failed = true
    let backgrounded = false
    let detail: string[] = []
    // An Edit or Write's change, for the rail's files section (hooks/files.ts).
    let edit: { file: string; patch: Hunk[]; patchCut?: number } | undefined
    // A question to the person holds the plan amber until it is answered (see finally).
    if (tool === 'AskUserQuestion') {
      waitingOn.set(id, 'question')
      await update($, planState, () => 'waiting')
    }
    try {
      const ran = await next(e)
      failed = ran.isError === true
      detail = callDetail(tool, input, ran as { result?: unknown; isError?: boolean; text?: string })
      if ((tool === 'Edit' || tool === 'Write') && agentId === undefined && !failed && typeof input.file_path === 'string') {
        const { patch, cut } = cutPatch(editPatch(tool, input, ran.result))
        edit = { file: input.file_path, patch, ...(cut > 0 ? { patchCut: cut } : {}) }
      }
      const result = ran.result as { backgroundTaskId?: string; task_id?: string } | undefined
      if (agentId === undefined && result?.backgroundTaskId) {
        backgrounded = true
        // The path is in the call's text; some versions also give it as a result field.
        const said = [(ran as { text?: string }).text, ...Object.values(result)].filter(v => typeof v === 'string')
        const outputFile = said.find(v => v.endsWith('.output')) ?? parseOutputPath(said.join('\n'))
        const command = typeof input.command === 'string' ? input.command : undefined
        const job = {
          id: result.backgroundTaskId,
          callId: id,
          startedAt,
          status: 'running' as const,
          ...(command === undefined ? {} : { command }),
          ...(outputFile === undefined ? {} : { outputFile }),
          ...(taskId === undefined ? {} : { taskId }),
        }
        await update($, jobs, list => addJob(list, job))
      }
      if (tool === 'TaskStop' && result?.task_id) {
        const stopped = result.task_id
        const at = await $.clock.now()
        await update($, jobs, list => endJob(list, stopped, 'killed', at))
      }
      return ran
    } finally {
      await stopWaiting($, id)
      await update($, live, map => {
        const { [id]: _done, ...rest } = map
        return rest
      })
      const at = await $.clock.now()
      await update($, calls, list => {
        const ended = endCall(list, id, at, failed)
        const call = ended[id]
        return call && (detail.length || edit) ? { ...ended, [id]: { ...call, ...(detail.length ? { detail } : {}), ...edit } } : ended
      })
      if (agentId === undefined) await update($, dock, t => (t ? { ...t, calls: t.calls.map(c => (c.id === id ? { ...c, done: true } : c)) } : t))
      // A shell that finished in the foreground teaches the band's ETA; a backgrounded one teaches it when its job ends.
      if (tool === 'Bash' && agentId === undefined && !failed && !backgrounded && typeof input.command === 'string') {
        await saveShellRun($, input.command, at - startedAt)
      }
    }
  })

  // A permission prompt names the tool and input, not the call: the call in flight with both is the one waiting.
  on('classic.PermissionRequest', async ($, e, next) => {
    const asked = JSON.stringify(e.tool_input)
    const id = Object.entries(await read($, live)).find(([, c]) => c.tool === e.tool_name && JSON.stringify(c.input) === asked)?.[0]
    if (id !== undefined) {
      waitingOn.set(id, 'permission')
      await update($, planState, () => 'waiting')
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') await syncChat($)
    if (e.origin.kind === 'task-notification') {
      const at = await $.clock.now()
      for (const { id, status } of parseNotifications(e.text)) {
        const job = (await read($, jobs)).find(j => j.id === id && j.status === 'running')
        await update($, jobs, list => endJob(list, id, status, at))
        if (job?.command !== undefined && status === 'done') await saveShellRun($, job.command, at - job.startedAt)
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      const level = await gauges($)
      const aborted = e.isAborted || e.reason === 'aborted'
      await update($, spans, list => closeSpan(list, { at, ...level, aborted }))
      // Ended on an error or Esc with tasks left: the plan reads stopped until the next turn starts.
      const unfinished = topLevel(await read($, tasks)).some(t => t.status !== 'completed')
      await update($, planState, () => ((aborted || e.reason === 'error') && unfinished ? 'stopped' : 'running'))
    }
    const u = done.usage ?? e.usage
    const usage = u && { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens }
    const turn: TurnRecord = closeTurn(await read($, calls), {
      turnId: e.turnId,
      agentId: e.agentId,
      durationMs: e.durationMs,
      endedAt: await $.clock.now(),
      usage,
    })
    if (e.isAborted) turn.aborted = true
    await update($, turns, list => [...list, turn].slice(-MAX_TURNS))
    if (e.agentId === undefined) {
      const endedAt = await $.clock.now()
      const aborted = e.isAborted || e.reason === 'aborted'
      await update($, dock, t => (t && t.endedAt === undefined && (t.turnId === undefined || t.turnId === e.turnId) ? { ...t, endedAt, ...(aborted ? { aborted: true } : {}) } : t))
    }
    if (e.agentId !== undefined) {
      const id = e.agentId
      const endedAt = turn.startedAt + turn.durationMs
      const used = usage ? totalTokens(usage) : 0
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, endedAt, tokens: (a.tokens ?? 0) + used, stopped: e.isAborted } : a)),
      )
    }
    return done
  })
}
