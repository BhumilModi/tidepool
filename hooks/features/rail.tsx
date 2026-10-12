import { atom, read, update } from 'claude-code'
import type { EngineInterface, Frozen, On, RenderChildren, RenderElement, RenderInput } from 'claude-code'

import type { RailRow } from '../../types'
import { opts } from '../options'
import { agentRows, agentTools, finishedAt, historyFor, planShows, topLevel } from '../plan'
import { doneCard, planBody, planHeader, planLines } from '../planview'
import { DONE_COLS, DONE_ROWS, doneCrabCells, encodeCells } from '../dock'
import type { PlanData } from '../planview'
import { MAX_TAIL_BYTES, shellRows, shellTails } from '../shell'
import { receipt, receiptKey } from '../receipt'
import { GAME_BEST_KEY, GAME_HEIGHT, GAME_LINGER_MS, GAME_ON_KEY, PLAY_COMMAND } from '../pop'
import type { PopProps } from './pop-surface'
import { RAIL_COLUMNS, pickTurn, railRows, railSeat, railSummary, sections, showBars, turnOfCall, turnWindow } from '../rail'
import type { SectionName } from '../rail'
import { diffEdits, fileRows, relPath } from '../files'
import { glyphsOn, palette, powerline, runsWidth, span } from '../theme'
import type { Segment } from '../theme'
import { fmtShort } from '../tools'

export const RAIL_ID = 'tidepool-rail'
// The diff pane: a second tab in the rail's dock (the dock shows one pane at a time).
export const DIFF_ID = 'tidepool-diff'

// Written by the tracker (features/track.tsx), the dock (turn starts) and the agent band (features/tasks.tsx).
const calls = atom({ plugin: 'tidepool', key: 'calls' } as const, {})
const spans = atom({ plugin: 'tidepool', key: 'spans' } as const, [])
const jobs = atom({ plugin: 'tidepool', key: 'jobs' } as const, [])
const agents = atom({ plugin: 'tidepool', key: 'agents' } as const, [])
// The rail's own: which turn, which rows are open, the live clock.
const sel = atom({ plugin: 'tidepool', key: 'railSel' } as const, { pinned: false })
const open = atom({ plugin: 'tidepool', key: 'railOpen' } as const, [])
const now = atom({ plugin: 'tidepool', key: 'railNow' } as const, 0)
// Anchor rows on screen, by turn (features/tools.tsx writes it).
const seen = atom({ plugin: 'tidepool', key: 'anchorsSeen' } as const, {})
// The plan the docked rail owns (features/tasks.tsx writes these; its 1s tick redraws live timers).
const tasks = atom({ plugin: 'tidepool', key: 'tasks' } as const, [])
const turns = atom({ plugin: 'tidepool', key: 'turns' } as const, [])
const live = atom({ plugin: 'tidepool', key: 'live' } as const, {})
const shellHistory = atom({ plugin: 'tidepool', key: 'shellHistory' } as const, null)
const planAll = atom({ plugin: 'tidepool', key: 'planAll' } as const, false)
const tick = atom({ plugin: 'tidepool', key: 'tick' } as const, 0)
// Sections the person collapsed (loaded from the store at session start, features/startup.tsx), and the file
// the diff pane shows.
const railCollapsed = atom({ plugin: 'tidepool', key: 'railCollapsed' } as const, [])
const diffFile = atom({ plugin: 'tidepool', key: 'diffFile' } as const, null)
const planState = atom({ plugin: 'tidepool', key: 'planState' } as const, 'running')
const gameOn = atom({ plugin: 'tidepool', key: 'gameOn' } as const, false)
const gameBest = atom({ plugin: 'tidepool', key: 'gameBest' } as const, 0)
const railFilter = atom({ plugin: 'tidepool', key: 'railFilter' } as const, null)

const TOOL = 6
const META = 13
const INLINE_ROWS = 6
// Rows the timeline gives its turn's prompt at most.
const PROMPT_ROWS = 2

const fit = (text: string, width: number) => (text.length <= width ? text.padEnd(width) : `${text.slice(0, width - 1)}…`)

// Column widths for a body `width` cells wide: tool, target, bar, then what is left for timings.
// The target takes what the bar does not need, the bar stops at 20 cells, timings take the rest.
function columns(width: number, bars: boolean): { target: number; bar: number } {
  if (!bars) return { target: Math.max(8, width - TOOL - META - 2), bar: 0 }
  const room = width - TOOL - META - 3
  const target = Math.min(24, Math.max(10, room - 12))
  return { target, bar: Math.max(6, Math.min(20, room - target)) }
}

function timing(r: RailRow): string {
  if (r.kind === 'job' && r.running) return `running · ${fmtShort(r.ms)}`
  return r.running ? `${fmtShort(r.ms)} …` : fmtShort(r.ms)
}

// A background job's output file for shellTails (shell.ts); a file too big for one read shows nothing.
const readTail = ($: EngineInterface) => async (path: string) =>
  (await $.fs.stat(path)).size <= MAX_TAIL_BYTES ? String(await $.fs.read(path)) : undefined

type PaneInput = Frozen<RenderInput<'Pane'>>

// The plan section's data: the plan, its agents (less those in `shown`, the tool rows of the turn on screen) and
// the shells, with what its body asks for. Null when there is neither a plan nor a shell.
async function planData($: EngineInterface, shown: ReadonlySet<string>) {
  await read($, tick)
  const at = await $.clock.now()
  const list = await read($, tasks)
  const doneAt = finishedAt(topLevel(list))
  const showTasks = opts.tasks && planShows(list, at)
  const shells = opts.tasks ? shellRows(await read($, calls), await read($, live), await read($, jobs), at) : []
  if (!showTasks && shells.length === 0) return null
  const finished = showTasks && doneAt !== undefined
  const d: PlanData = {
    tasks: showTasks && !finished ? list : [],
    agents: agentRows(await read($, agents), await read($, turns)).filter(a => a.callId === undefined || !shown.has(a.callId)),
    shells,
    // Output lines are rows of the plan's tree, so they are read before it is fitted (cached for 2s per file).
    tails: await shellTails(shells, readTail($), at),
    shellHistory: (await read($, shellHistory)) ?? {},
    planHistory: historyFor(await $.store.get('history-by-project'), await $.session.root()),
    now: at,
    all: await read($, planAll),
    state: await read($, planState),
    agentTools: agentTools(await read($, live)),
  }
  const ask = finished ? DONE_ROWS : planLines(d).lines.length
  return { d, list, at, doneAt: finished ? doneAt : undefined, showTasks, ask }
}

// Shows a file's diff for a turn in the diff pane, opening it or re-targeting the open one.
// It asks the rail's width: the dock sizes to the tab shown, so a wider diff moved the tab row under the pointer.
async function openDiff($: EngineInterface, turnId: string, path: string, title: string) {
  await update($, diffFile, () => ({ turnId, path }))
  await $.ui.open({ id: DIFF_ID, title, columns: RAIL_COLUMNS })
}

// The diff pane: each of the turn's edits to the file, a dim label then its hunks as a diff.
async function drawDiff($: EngineInterface, e: PaneInput) {
  const { Box, Button, Code, Text } = $.ui.resolve(e)
  const C = palette()
// It asks the rail's width: the dock sizes to the tab shown, so a wider diff moved the tab row under the pointer.
  const shown = await read($, diffFile)
  if (!shown) {
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={C.faint}>no file chosen: press a file in the rail</Text>
        <Button key="diff:close" plain dimColor onPress={() => $.ui.close({ id: DIFF_ID })}>{'✕ close'}</Button>
      </Box>
    )
  }
  const turnList = await read($, spans)
  const turn = turnList.find(t => t.turnId === shown.turnId)
  const turnCalls = Object.entries(await read($, calls))
    .filter(([, c]) => turnOfCall(turnList, c.startedAt)?.turnId === shown.turnId)
    .sort(([, x], [, y]) => x.startedAt - y.startedAt)
  const edits = diffEdits(turnCalls, shown.path, turn?.startedAt ?? 0)
  const root = await $.session.root().catch(() => '')
  const width = Math.max(10, e.props.bodyColumns - 2)
  // The pane's own close: it closes the diff alone, and the rail comes back in front.
  const close = async () => {
    await update($, diffFile, () => null)
    await $.ui.close({ id: DIFF_ID })
  }
  const out: RenderElement[] = [
    <Box key="head" flexDirection="row" height={1} justifyContent="space-between" marginBottom={1}>
      <Text color={C.ink} bold wrap="truncate-start">{relPath(shown.path, root, width - 10)}</Text>
      <Box flexShrink={0}>
        <Button key="diff:close" plain dimColor onPress={close}>{'✕ close'}</Button>
      </Box>
    </Box>,
  ]
  for (const [i, d] of edits.entries()) {
    out.push(<Text key={`l${i}`} color={C.faint}>{d.label}</Text>)
    out.push(d.source ? <Code key={`c${i}`} format="diff" source={d.source} /> : <Text key={`n${i}`} color={C.faint}>no diff recorded</Text>)
    if (d.cut) out.push(<Text key={`m${i}`} color={C.faint}>{`… ${d.cut} more lines`}</Text>)
  }
  if (edits.length === 0) out.push(<Text key="none" color={C.faint}>no edits to this file in that turn</Text>)
  return <Box flexDirection="column">{out}</Box>
}

export function registerRail(on: On) {
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId === DIFF_ID) return drawDiff($, e)
    if (e.requestId !== RAIL_ID) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const C = palette()
    const p = e.props
    railSeat.placement = p.placement
    // The rail paints the background of the terminal theme Tidepool ships for this palette (its onAccent), so it
    // reads as part of the terminal rather than a grey panel.
    const paint = C.onAccent
    const width = Math.max(10, p.bodyColumns - 2)
    const surface = (key: string, children: RenderChildren) => (
      <Box key={key} flexDirection="column" backgroundColor={paint} paddingX={1} minHeight={p.placement === 'dock' ? p.scroll.bodyRows : undefined}>
        {children}
      </Box>
    )

    const list = await read($, spans)
    // Reading railNow redraws the rail on each live tick; the clock itself is the truth.
    const clock = Math.max(await read($, now), await $.clock.now())
    const isInline = p.placement === 'inline'
    const live = list.findLast(s => s.endedAt === undefined)
    // Above the prompt (no fullscreen) the rail follows the live turn, and between turns shrinks to one line.
    if (isInline && !live && list.length > 0) {
      const last = list.at(-1)!
      const sum = railSummary(railRows(await read($, calls), await read($, agents), await read($, jobs), last, clock), last, clock)
      const failed = sum.failures.reduce((n, f) => n + f.times, 0)
      const line = [`turn ${list.length}`, fmtShort(sum.ms), `${sum.tools} tools`].join(' · ')
      return surface(
        'idle',
        <Box flexDirection="row" height={1}>
          <Text color={C.accent} bold>≈ tidepool</Text>
          <Text color={C.faint} wrap="truncate-end">{`  ${line}`}</Text>
          {failed > 0 && <Text color={C.crit}>{` · ${failed} failed`}</Text>}
        </Box>,
      )
    }
    const pinned = (await read($, sel)).pinned
    const turn = isInline ? live : pickTurn(list, await read($, sel), await read($, seen))
    const follow = isInline ? '' : pinned ? 'pinned · scroll to follow' : 'following scroll'
    // The rail's own close: the dock's ✕ closes every pane in it, this one only the rail.
    const brand = (
      <Box key="brand" flexDirection="row" height={1} justifyContent="space-between">
        <Text color={C.accent} bold>≈ tidepool</Text>
        <Box flexShrink={0}>
          <Text color={C.faint}>{follow}</Text>
          <Text>{'   '}</Text>
          <Button key="rail:close" plain dimColor onPress={() => $.ui.close({ id: RAIL_ID })}>{'✕'}</Button>
        </Box>
      </Box>
    )
    if (isInline && !turn) return surface('empty', [brand, <Text key="none" color={C.faint}>no turn running</Text>])

    const { start, end } = turn ? turnWindow(turn, turn.endedAt ?? clock) : { start: clock, end: clock }
    const allCalls = await read($, calls)
    const all = turn ? railRows(allCalls, await read($, agents), await read($, jobs), turn, clock) : []
    const opened = await read($, open)
    // The turn's receipt; pressing one of its parts filters the timeline to that kind, pressing it again clears it.
    const parts = receipt(all)
    // The filter belongs to the turn it was chosen on.
    const chosen = await read($, railFilter)
    const filter = chosen && chosen.turnId === turn?.turnId && parts.some(part => part.key === chosen.key) ? chosen.key : null
    const shownRows = filter ? all.filter(r => receiptKey(r.tool) === filter) : all
    const bars = showBars(p.bodyColumns)
    const col = columns(width, bars)
    const state = !turn ? '' : turn.endedAt === undefined ? 'live' : turn.aborted ? 'stopped' : ''
    const toggle = (id: string) => update($, open, ids => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]))

    // The turn's tool rows, the last `room` rows of them: an "earlier" marker and the axis count in `room`.
    const toolRows = async (room: number) => {
      const body: RenderElement[] = []
      if (all.length === 0) return [<Text key="empty" color={C.faint}>nothing opened</Text>]
      const axis = bars ? 1 : 0
      const fitsAll = shownRows.length + axis <= room
      const count = fitsAll ? shownRows.length : Math.max(0, room - 1 - axis)
      const hidden = shownRows.length - count
      if (hidden) body.push(<Text key="earlier" color={C.faint}>{`${' '.repeat(TOOL + 1)}${hidden} earlier`}</Text>)
      for (const r of shownRows.slice(hidden)) {
        const color = r.failed ? C.crit : r.kind === 'job' ? C.warn : r.kind === 'agent' ? C.info : r.running ? C.mid : C.soft
        const b = bars ? span(r.from, r.to, col.bar) : { before: '', filled: '', after: '' }
        const isOpen = opened.includes(r.id)
        body.push(
          <Box key={`r-${r.id}`} flexDirection="row" height={1} hover={{ backgroundColor: C.seg }}>
            <Box flexShrink={0}>
              <Text color={r.failed ? C.crit : C.mid}>{`${fit(r.failed ? `✕ ${r.tool}` : r.tool, TOOL)} `}</Text>
              <Button key={`row:${r.id}`} plain onPress={() => toggle(r.id)}>
                {fit(r.target || r.tool, col.target)}
              </Button>
              {bars && (
                <Text color={C.track}>
                  {` ${b.before}`}
                  <Text color={color}>{b.filled}</Text>
                  {b.after}
                  {r.over ? <Text color={color}>⇢</Text> : ''}
                </Text>
              )}
            </Box>
            <Text color={r.running ? C.mid : C.faint} wrap="truncate-end">
              {` ${timing(r)}`}
              {(r.added || r.removed) ? <Text color={C.info}>{`  +${r.added ?? 0}`}</Text> : ''}
              {(r.added || r.removed) ? <Text color={C.crit}>{` −${r.removed ?? 0}`}</Text> : ''}
              {r.children !== undefined ? <Text color={C.info}>{`  ${r.children} tools ${isOpen ? '▾' : '▸'}`}</Text> : ''}
            </Text>
          </Box>,
        )
        if (!isOpen) continue
        if (r.kind === 'agent') {
          const agentId = (await read($, agents)).find(a => a.callId === r.id)?.id
          const kids = Object.values(allCalls)
            .filter(c => c.agentId !== undefined && c.agentId === agentId)
            .sort((x, y) => x.startedAt - y.startedAt)
          for (const [i, c] of kids.entries()) {
            body.push(<Text key={`k-${r.id}-${i}`} color={C.mid} wrap="truncate-end">{`${' '.repeat(TOOL - 2)}└ ${fit(c.tool, TOOL)} ${c.target ?? ''}`}</Text>)
          }
        }
        for (const [i, line] of (allCalls[r.id]?.detail ?? []).entries()) {
          body.push(<Text key={`d-${r.id}-${i}`} color={C.faint} wrap="truncate-end">{`${' '.repeat(TOOL + 1)}${line}`}</Text>)
        }
      }
      // The time axis closes the timeline.
      if (bars && count > 0) {
        const label = fmtShort(end - start)
        body.push(<Text key="axis" color={C.faint}>{`${' '.repeat(TOOL + col.target + 2)}0s${label.padStart(col.bar - 2)}`}</Text>)
      }
      return body
    }

    // The turn line shares a hover group with its anchor in the chat: pointing at either lights both.
    const turnLine = (lead: string) =>
      !turn ? (
        <Text color={C.faint}>{`${lead}no turns yet`}</Text>
      ) : (
        <Box flexDirection="row" height={1} hover={{ scope: `tidepool-turn-${turn.turnId}`, backgroundColor: C.seg }}>
          <Box flexShrink={0}>
            <Text color={C.ink} bold>{`${lead}turn ${list.indexOf(turn) + 1}`}</Text>
            {state && <Text color={state === 'live' ? C.accent : C.warn}>{` · ${state}`}</Text>}
            <Text color={C.ink}>{` · ${fmtShort(end - start)}`}</Text>
          </Box>
          {turn.prompt && <Text color={C.faint} wrap="truncate-end">{`  ${turn.prompt}`}</Text>}
        </Box>
      )

    // The receipt as a row of pressable parts, as many as fit whole; dim but for the part filtered to.
    const receiptRow = () => {
      const fitted: typeof parts = []
      for (const part of parts) {
        if ([...fitted, part].map(x => x.text).join(' · ').length > width) break
        fitted.push(part)
      }
      const pick = (key: string) => update($, railFilter, () => (filter === key || !turn ? null : { turnId: turn.turnId, key }))
      return (
        <Box key="receipt" flexDirection="row" height={1}>
          {fitted.flatMap((part, i) => [
            i > 0 ? <Text key={`rs${i}`} color={C.faint}>{' · '}</Text> : null,
            <Button key={`rc:${part.key}`} plain dimColor={filter !== part.key} onPress={() => pick(part.key)}>{part.text}</Button>,
          ])}
        </Box>
      )
    }

    if (isInline) {
      // Above the prompt the rail follows the live turn: its last few rows, no sections.
      return surface('rail', [brand, <Box key="title">{turnLine('')}</Box>, <Box key="rows" flexDirection="column" marginTop={1}>{await toolRows(INLINE_ROWS + 1 + (bars ? 1 : 0))}</Box>])
    }

    // Docked: timeline, plan and files sections, each under a header that collapses it (hooks/rail.ts sections).
    const showAll = await read($, planAll)
    const collapsed = await read($, railCollapsed)
    // An empty section folds by itself; pressing it while open would only hide it from later turns.
    const flip = async (name: SectionName, empty: boolean) => {
      if (empty && !collapsed.includes(name)) return
      const flipped = collapsed.includes(name) ? collapsed.filter(n => n !== name) : [...collapsed, name]
      await update($, railCollapsed, () => flipped)
      await $.store.set('rail-collapsed', flipped)
    }
    // A folded or empty section's name sits in the muted segment colours instead of the accent.
    const muted = { ...C, accent: C.segAlt, onAccent: C.faint }
    // A section header: its fold mark (the Button; a Button takes no colours), then the powerline pill the Plan
    // header and the status line use, dropping segments from the right rather than wrapping.
    // `fold` replaces the fold mark's press (the play section's turns the game off).
    const header = (name: SectionName | 'play', label: string, open: boolean, empty: boolean, rest: Segment[], after?: RenderElement | null, fold = () => flip(name as SectionName, empty)) => {
      const P = open && !empty ? C : muted
      let segs: Segment[] = [{ bg: P.accent, parts: [{ text: ` ${label} `, color: P.onAccent, bold: true }] }, ...rest]
      const glyphs = glyphsOn(e.surface)
      while (segs.length > 1 && runsWidth(powerline(segs, glyphs)) > width - 2) segs = segs.slice(0, -1)
      const runs = powerline(segs, glyphs)
      const nameAt = glyphs ? 1 : 0
      return (
        <Box key={`sec-${name}`} flexDirection="row" height={1}>
          <Box flexShrink={0}>
            <Button key={`sec:${name}`} plain onPress={fold}>{open && !empty ? '▾' : '▸'}</Button>
            <Text> </Text>
            {runs.map((run, i) => (
              <Text key={`pill-${name}-${i === nameAt ? 'name' : i}`} color={run.color} backgroundColor={run.backgroundColor} bold={run.bold}>
                {run.text}
              </Text>
            ))}
          </Box>
          {after}
        </Box>
      )
    }
    const plan = await planData($, new Set(all.filter(r => r.kind === 'agent').map(r => r.id)))
    const root = await $.session.root().catch(() => '')
    const turnIds = new Set(all.map(r => r.id))
    const files = fileRows(Object.entries(allCalls).filter(([id]) => turnIds.has(id)).sort(([, x], [, y]) => x.startedAt - y.startedAt), root)
    // The turn's prompt, on one row, or two when it does not fit one; a longer prompt is cut at the end of the second.
    const promptRows = !turn?.prompt ? 0 : turn.prompt.length <= width ? 1 : PROMPT_ROWS
    const receiptRows = parts.length ? 1 : 0
    // Anemone pop, while a turn runs and a moment after, when it is on: its rows come off the sections' share.
    const lastEnd = list.at(-1)?.endedAt ?? -Infinity
    const gameShown = 'Client' in ui && (await read($, gameOn)) && (live !== undefined || lastEnd > clock - GAME_LINGER_MS)
    const playRows = gameShown ? GAME_HEIGHT + 2 : 0
    const rows = sections({
      bodyRows: p.scroll.bodyRows - playRows,
      asks: { timeline: turn ? promptRows + receiptRows + (all.length === 0 ? 1 : shownRows.length + (bars ? 1 : 0)) : 0, plan: plan?.ask ?? 0, files: files.length },
      open: { timeline: !collapsed.includes('timeline'), plan: !collapsed.includes('plan'), files: !collapsed.includes('files') },
      all: showAll,
    })

    const out: RenderElement[] = [brand]
    // A blank row above each section header, so the sections read apart.
    const gap = (name: SectionName | 'play', el: RenderElement) => <Box key={`sec-${name}-gap`} marginTop={1} flexDirection="column">{el}</Box>
    // Each open section's body holds its whole share, so the split stays put however little it shows.
    const body = (key: string, rowsHeld: number, children: RenderChildren) => <Box key={key} flexDirection="column" height={rowsHeld} overflow="hidden">{children}</Box>

    // Timeline.
    const timelineSegs: Segment[] = !turn
      ? [{ bg: C.seg, parts: [{ text: ' no turns yet ', color: C.faint }] }]
      : [
          { bg: C.seg, parts: [{ text: ` turn ${list.indexOf(turn) + 1} `, color: C.ink }] },
          ...(state === 'live' ? [{ bg: C.seg, parts: [{ text: '● live ', color: C.accent }] }] : []),
          ...(state === 'stopped' ? [{ bg: C.seg, parts: [{ text: 'stopped ', color: C.warn }] }] : []),
          // A finished turn that opened nothing answered from what Claude already had.
          ...(state === '' && all.length === 0 ? [{ bg: C.seg, parts: [{ text: 'from memory ', color: C.faint }] }] : []),
          { bg: C.segAlt, parts: [{ text: ` ${fmtShort(end - start)} `, color: C.ink }] },
        ]
    const timelineHeader = header('timeline', 'Timeline', rows.timeline > 0, !turn, timelineSegs)
    // The turn line shares a hover group with its anchor in the chat: pointing at either lights both.
    out.push(gap('timeline', turn ? <Box key="sec-timeline-hover" hover={{ scope: `tidepool-turn-${turn.turnId}`, backgroundColor: C.seg }}>{timelineHeader}</Box> : timelineHeader))
    if (rows.timeline) {
      // The turn's prompt opens the section, on up to PROMPT_ROWS rows of its own, before the tool rows.
      const lines = Math.min(promptRows, Math.max(0, rows.timeline - 1))
      const receiptShown = Math.min(receiptRows, Math.max(0, rows.timeline - 1 - lines))
      out.push(
        body('timeline', rows.timeline, [
          lines > 0 && turn?.prompt ? <Box key="prompt" height={lines}><Text color={C.soft} italic wrap="wrap">{turn.prompt}</Text></Box> : null,
          receiptShown ? receiptRow() : null,
          ...(await toolRows(rows.timeline - lines - receiptShown)),
        ]),
      )
    }

    // Plan.
    const planOpen = rows.plan > 0
    if (plan && plan.showTasks) {
      const lines = planOpen && !plan.doneAt ? planBody(ui, C, plan.d, rows.plan) : { rows: [], hidden: 0 }
      out.push(
        gap('plan',
          <Box key="sec-plan" flexDirection="row" height={1}>
            <Box flexShrink={0}>
              <Button key="sec:plan" plain onPress={() => flip('plan', false)}>{planOpen ? '▾' : '▸'}</Button>
              <Text> </Text>
            </Box>
            {planHeader(ui, planOpen ? C : muted, { ...plan.d, tasks: plan.list }, {
              surface: e.surface,
              columns: width - 2,
              toggle: { hidden: lines.hidden, onPress: () => update($, planAll, v => !v) },
              keys: 'pill-plan-',
            })}
          </Box>,
        ),
      )
      if (planOpen) {
        const card = plan.doneAt !== undefined && rows.plan >= DONE_ROWS
        // The crab's frames are blitted by features/tasks.tsx for DONE_MS after the plan finishes; this draws the frame due now.
        const { Raster } = ui as unknown as { Raster: (props: Record<string, unknown>) => RenderElement }
        const crab = card && plan.doneAt !== undefined ? <Raster key="plan-crab" columns={DONE_COLS} rows={DONE_ROWS} cells={encodeCells(doneCrabCells(plan.at - plan.doneAt, C))} /> : null
        out.push(body('plan-body', rows.plan, [crab ? doneCard(ui, C, plan.list, crab) : null, ...lines.rows]))
      }
    } else {
      out.push(gap('plan', header('plan', 'Plan', planOpen, !plan, [{ bg: C.seg, parts: [{ text: ' no tasks ', color: C.faint }] }])))
      if (planOpen && plan) out.push(body('plan-body', rows.plan, planBody(ui, C, plan.d, rows.plan).rows))
    }

    // Files.
    const added = files.reduce((n, f) => n + f.added, 0)
    const removed = files.reduce((n, f) => n + f.removed, 0)
    out.push(
      gap('files', header('files', 'Files', rows.files > 0, files.length === 0, files.length === 0
        ? [{ bg: C.seg, parts: [{ text: ' none this turn ', color: C.faint }] }]
        : [
            { bg: C.seg, parts: [{ text: ` ${files.length} changed `, color: C.ink }] },
            { bg: C.segAlt, parts: [{ text: ` +${added}`, color: C.info }, { text: ` −${removed} `, color: C.crit }] },
          ])),
    )
    if (rows.files) {
      const shown = files.length <= rows.files ? files : files.slice(0, Math.max(0, rows.files - 1))
      const fileLines: RenderElement[] = shown.map(f => {
        const counts = `  +${f.added} −${f.removed}`
        return (
          <Box key={`f-${f.path}`} flexDirection="row" height={1} hover={{ backgroundColor: C.seg }}>
            <Text>{'  '}</Text>
            <Button key={`file:${f.path}`} plain onPress={() => openDiff($, turn?.turnId ?? '', f.path, f.rel)}>
              {relPath(f.path, root, Math.max(8, width - counts.length - 2))}
            </Button>
            <Box flexShrink={0}><Text color={C.info}>{`  +${f.added}`}</Text><Text color={C.crit}>{` −${f.removed}`}</Text></Box>
          </Box>
        )
      })
      if (shown.length < files.length) fileLines.push(<Text key="files-more" color={C.faint}>{`  +${files.length - shown.length} more`}</Text>)
      out.push(body('files-body', rows.files, fileLines))
    }

    // Play: anemone pop (features/pop-surface.tsx). It holds while Claude needs the person, and when the turn ends
    // it holds for GAME_LINGER_MS, then folds.
    if (gameShown && 'Client' in ui) {
      const { Client } = ui
      const best = await read($, gameBest)
      const off = async () => {
        await update($, gameOn, () => false)
        await $.store.set(GAME_ON_KEY, false)
      }
      out.push(gap('play', header('play', 'Play', true, false, [{ bg: C.seg, parts: [{ text: ` best ${best} `, color: C.ink }] }], null, off)))
      const props: PopProps = {
        colors: { open: C.accent, closing: C.mid, eye: C.onAccent, hole: C.track, sand: C.segAlt, pop: C.warn, miss: C.crit, faint: C.faint, ink: C.ink, warn: C.warn },
        best,
        paused: (await read($, planState)) === 'waiting',
        ending: live === undefined,
        seed: list.at(-1)?.startedAt ?? 0,
        cols: width,
      }
      out.push(<Client key="game" module="./pop-surface.tsx" props={props} height={GAME_HEIGHT} />)
    }
    return surface('rail', out)
  })

  on('command.run', { command: PLAY_COMMAND }, async $ => {
    const turnedOn = !(await read($, gameOn))
    await update($, gameOn, () => turnedOn)
    await $.store.set(GAME_ON_KEY, turnedOn)
    return { text: turnedOn ? 'Anemone pop on: it shows in the Tide rail while Claude works. Click the open anemones, or press their number.' : 'Anemone pop off.' }
  })

  // The game posts its score when a round ends or holds; the best is kept across sessions.
  on('ui.message', async ($, e, next) => {
    const score = (e.data as { game?: unknown } | null)?.game
    if (e.requestId === RAIL_ID && typeof score === 'number' && score > (await read($, gameBest))) {
      await update($, gameBest, () => score)
      await $.store.set(GAME_BEST_KEY, score)
    }
    return next(e)
  })

  on('command.run', { command: RAIL_ID }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === RAIL_ID)
    if (isOpen) await $.ui.close({ id: RAIL_ID })
    else if (opts.rail) await $.ui.open({ id: RAIL_ID, title: 'tidepool', columns: RAIL_COLUMNS })
    return { text: isOpen ? 'Tide rail closed.' : 'Tide rail open.' }
  })
}
