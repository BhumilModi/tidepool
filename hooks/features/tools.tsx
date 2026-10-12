import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { TurnSpan } from '../../types'
import { opts } from '../options'
import { anchorOf, anchorsOnScreen, pickTurn, railRows, railSeat, turnOfCall } from '../rail'
import { receipt, receiptLine } from '../receipt'
import { palette } from '../theme'
import { describeCall, editStats, fmtShort, groupSummary, isKnownTool } from '../tools'

// Written by the tracker (features/track.tsx), the dock (turn starts) and the agent band (features/tasks.tsx).
const calls = atom({ plugin: 'tidepool', key: 'calls' } as const, {})
const spans = atom({ plugin: 'tidepool', key: 'spans' } as const, [])
const jobs = atom({ plugin: 'tidepool', key: 'jobs' } as const, [])
const agents = atom({ plugin: 'tidepool', key: 'agents' } as const, [])
// The rail's selection (features/rail.tsx): pressing an anchor pins its turn.
const railSel = atom({ plugin: 'tidepool', key: 'railSel' } as const, { pinned: false })
// Ticks once a second while something runs, so a live anchor's counts and time move.
const railNow = atom({ plugin: 'tidepool', key: 'railNow' } as const, 0)
const anchorsSeen = atom({ plugin: 'tidepool', key: 'anchorsSeen' } as const, {})

// With the rail docked beside the transcript, tool calls live there and the chat keeps one anchor line per turn.
// Above the prompt the rail shows only the live turn, so rows stay in the chat.
function railOn(): boolean {
  return opts.rail && railSeat.placement === 'dock'
}

// The main-loop turn a call belongs to; undefined for a subagent's call or one the tracker never saw.
async function turnOf($: EngineInterface, id: string): Promise<TurnSpan | undefined> {
  const call = (await read($, calls))[id]
  if (!call || call.agentId !== undefined) return undefined
  return turnOfCall(await read($, spans), call.startedAt)
}

let root: string | undefined

async function sessionRoot($: EngineInterface): Promise<string> {
  root ??= await $.session.root()
  return root
}

// Cells the anchor keeps beside its receipt: the leading ` ◇ `, `  ▸ rail ` and the chat's own margin.
const ANCHOR_TAIL = 16

export function registerTools(on: On) {
  // Header row only: the engine keeps drawing the result (diff, output) under it.
  // marginTop keeps the blank line the engine puts above each tool call.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!opts.tools) return next(e)
    const p = e.props
    const turn = railOn() ? await turnOf($, p.tool_use_id) : undefined
    if (turn) {
      const { Box, Button, Text } = $.ui.resolve(e)
      // The turn's first row to draw carries the anchor; the rest of its rows draw nothing.
      if (!anchorOf.has(turn.turnId)) anchorOf.set(turn.turnId, p.tool_use_id)
      if (anchorOf.get(turn.turnId) !== p.tool_use_id) return <Box />
      const all = await read($, calls)
      const now = Math.max(await read($, railNow), await $.clock.now())
      const rows = railRows(all, await read($, agents), await read($, jobs), turn, now)
      if (p.onScreen !== undefined) anchorsOnScreen.set(turn.turnId, p.onScreen !== null)
      const C = palette()
      const tools = rows.reduce((n, r) => n + 1 + (r.children ?? 0), 0)
      const errors = rows.filter(r => r.failed).length
      const live = turn.endedAt === undefined
      // The receipt: what the turn opened and changed (hooks/receipt.ts); a turn of only plan tools counts its tools.
      const opened = receipt(rows)
      const parts = opened.length ? opened : [{ key: 'tools', text: `${tools} tool${tools === 1 ? '' : 's'}` }]
      const took = `${fmtShort((turn.endedAt ?? now) - turn.startedAt)}${live ? ' …' : ''}`
      // Room for the line beside the error count and `▸ rail`; parts that do not fit drop whole, from the end.
      const line = receiptLine(parts, took, (e.viewport?.columns ?? 100) - ANCHOR_TAIL - (errors ? ` · ${errors} errors`.length : 0))
      const pin = () => update($, railSel, () => ({ turnId: turn.turnId, pinned: true }))
      // The turn the rail is showing reads in accent on a faint band; pointing at it lights the rail's turn line too.
      const isShown = pickTurn(await read($, spans), await read($, railSel), await read($, anchorsSeen))?.turnId === turn.turnId
      return (
        <Box marginTop={1} flexDirection="row" height={1} backgroundColor={isShown ? C.seg : undefined} hover={{ scope: `tidepool-turn-${turn.turnId}`, backgroundColor: C.seg }}>
          <Text color={isShown ? C.soft : C.faint} wrap="truncate-end">{` ◇ ${line}`}</Text>
          {errors > 0 && (
            <Box flexShrink={0}>
              <Text color={C.crit}>{` · ${errors} error${errors === 1 ? '' : 's'}`}</Text>
            </Box>
          )}
          <Box flexShrink={0}>
            <Button key="anchor" plain dimColor={!isShown} onPress={pin}>
              {'  ▸ rail '}
            </Button>
          </Box>
        </Box>
      )
    }
    const described = describeCall(p.tool, p.input, await sessionRoot($))
    if (!described) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const C = palette()
    const timing = (await read($, calls))[p.tool_use_id]
    const took = timing?.endedAt !== undefined ? fmtShort(timing.endedAt - timing.startedAt) : undefined
    const stats = editStats(p.tool, p.input)
    const icon = p.isErrored ? '✕' : described.icon
    const iconColor = p.isErrored ? C.crit : p.isInterrupted ? C.faint : C.accent
    return (
      // Only the target shrinks: in a narrow chat it truncates rather than wrapping the pieces beside it.
      <Box marginTop={1} height={1}>
        <Box flexShrink={0}>
          <Text color={iconColor} bold>{icon}</Text>
          <Text color={C.soft}>{` ${p.tool} `}</Text>
        </Box>
        <Text color={C.ink} wrap="truncate-end">{described.target}</Text>
        <Box flexShrink={0}>
          {stats && stats.added > 0 && <Text color={C.info}>{`  +${stats.added}`}</Text>}
          {stats && stats.removed > 0 && <Text color={C.crit}>{`${stats.added > 0 ? ' ' : '  '}−${stats.removed}`}</Text>}
          {p.isRunning && <Text color={C.faint}>{'  …'}</Text>}
          {took && !p.isRunning && <Text color={C.faint}>{`  ${took}`}</Text>}
        </Box>
      </Box>
    )
  })

  // With the rail on, a call's result lives in the rail.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!opts.tools || !railOn() || !(await turnOf($, e.props.tool_use_id))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    // Unfolded, each call is a ToolUse row with its id, so the anchor rule above sees it.
    if (opts.tools && railOn()) return next({ ...e, props: { ...e.props, isExpanded: true } })
    // MCP and other unknown tools keep the engine's own wording.
    if (!opts.tools || e.props.isExpanded || !e.props.calls.every(c => isKnownTool(c.tool))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const C = palette()
    const parts = groupSummary(e.props.calls)
    const failed = e.props.calls.filter(c => c.isErrored).length
    return (
      // One Text for the line, so a narrow chat truncates its end rather than wrapping each piece.
      <Box marginTop={1} height={1}>
        <Text color={C.soft} wrap="truncate-end">
          {parts.map((g, i) => `${i ? '  ' : ''}${g.icon} ${g.tool}${g.count > 1 ? ` ×${g.count}` : ''}`).join('')}
          {e.props.isActive ? <Text color={C.faint}>{'  …'}</Text> : ''}
          {failed > 0 ? <Text color={C.crit}>{`  · ${failed} failed`}</Text> : ''}
        </Text>
      </Box>
    )
  })
}
