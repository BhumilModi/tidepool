import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import { dockView, encodeCells, sceneCells, site } from '../dock'
import type { DockMode } from '../dock'
import { opts } from '../options'
import { palette } from '../theme'
import { openSpan, promptLabel } from '../timing'

// The main turn the dock draws; the tracker (features/track.tsx) adds its tool calls and its end.
const dock = atom({ plugin: 'tidepool', key: 'dock' } as const, null)
// Bumped to redraw the band (features/tasks.tsx): on a change of layout, and once a second for the clock.
const tick = atom({ plugin: 'tidepool', key: 'tick' } as const, 0)
// The rail's turns (features/track.tsx closes them): this module owns turn.start, so it opens them.
const spans = atom({ plugin: 'tidepool', key: 'spans' } as const, [])
const planState = atom({ plugin: 'tidepool', key: 'planState' } as const, 'running')

// Context % and session cost at turn start; the tracker reads the same at turn end.
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

const FRAME_MS = 50
let timer: Timer | undefined
let busy = false
let lastKind = ''
let lastSecond = -1
let lastMode: DockMode | undefined

async function notePhase($: EngineInterface, mode: DockMode) {
  if (mode === lastMode) return
  lastMode = mode
  // A cosmetic feature never breaks the model's stream.
  try {
    const at = await $.clock.now()
    await update($, dock, t => (t && t.endedAt === undefined ? { ...t, phases: [...t.phases, { mode, at }] } : t))
  } catch {
    // The next change records it.
  }
}

// One timer at a time. Started at turn.start, and again from turn.step if a reload dropped it mid-turn.
function ensureTimer($: EngineInterface) {
  if (timer) return
  const own: { t?: Timer } = {}
  own.t = $.clock.every(FRAME_MS, () => {
    void frame($, own)
  })
  timer = own.t
}

function stop(own?: { t?: Timer }) {
  if (own && timer !== own.t) return
  timer?.cancel()
  timer = undefined
}

// One frame: redraw the band when its layout or clock changes, repaint the scene, stop once the crab is home.
async function frame($: EngineInterface, own: { t?: Timer }) {
  if (busy) return
  busy = true
  try {
    const turn = await read($, dock)
    const now = await $.clock.now()
    const view = dockView(turn ?? undefined, now)
    const second = Math.floor(now / 1000)
    if (view.kind !== lastKind || second !== lastSecond) {
      lastKind = view.kind
      lastSecond = second
      await update($, tick, n => n + 1)
    }
    if (view.kind === 'idle' || !turn) {
      stop(own)
      // Only this turn: a new prompt may have started one since this frame began.
      await update($, dock, t => (t && turn && t.startedAt === turn.startedAt ? null : t))
      return
    }
    // A hidden, collapsed or survey-held band refuses the repaint; keep going, it shows again on its own.
    if (site.id && site.cols) await $.ui.blit({ requestId: site.id, key: 'dock-scene', cells: encodeCells(sceneCells(view, turn, now, site.cols, palette(), site.rows)) })
  } catch {
    // A failed frame is skipped; the next one tries again.
  } finally {
    busy = false
  }
}

export function registerDock(on: On) {
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    // A new turn picks a stopped plan back up.
    await update($, planState, () => 'running')
    const at = await $.clock.now()
    const level = await gauges($)
    await update($, spans, list => openSpan(list, { turnId: e.turnId, at, prompt: promptLabel(e.text), ...level }))
    if (!opts.dock) return started
    // Subagent runs raise no turn.start, so every one is a main turn: always start fresh.
    const now = await $.clock.now()
    lastMode = undefined
    await update($, dock, () => ({ turnId: e.turnId, startedAt: now, phases: [], calls: [], seed: now % 997 }))
    stop()
    ensureTimer($)
    return started
  })

  // The stream says what the model is doing: thinking, writing text, or calling a tool.
  on('turn.step', async function* ($, e, next) {
    const main = opts.dock && e.agentId === undefined
    if (main) {
      ensureTimer($)
      await notePhase($, 'requesting')
    }
    const stream = next(e)
    for await (const chunk of stream) {
      if (main) {
        const mode = chunk.kind === 'thinking' ? 'thinking' : chunk.kind === 'text' ? 'responding' : chunk.kind === 'tool' || chunk.kind === 'input' ? 'tool' : undefined
        if (mode) await notePhase($, mode)
      }
      yield chunk
    }
    return await stream.result
  })
}
