import type { ClientModule } from 'claude-code'

import { FRAME_MS, GAME_LINGER_MS, draw, holeAt, layout, newGame, pop, step } from '../pop'
import type { Colors, Game } from '../pop'

// Anemone pop's drawing, a Client in the rail (features/rail.tsx). It runs its own frame clock and takes clicks
// and number keys; the hooks module says when Claude needs the person (`paused`) or is done (`ending`), and keeps
// the best score from what this posts.

export type PopProps = {
  colors: Colors & { ink: string; warn: string }
  best: number
  paused: boolean
  ending: boolean
  seed: number
  cols: number
}

// `ref` carries the newest props into the timer and listeners, which are set once; `endTicks` counts frames since
// the turn ended, for the countdown.
type State = { game: Game; ref: { props: PopProps }; endTicks: number }

const Pop: ClientModule<PopProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const cols = () => surface.columns || props.cols
  if (surface.state === undefined) {
    const ref = { props }
    const act = (i: number) => {
      const s = surface.state
      if (!s || s.ref.props.paused || s.ref.props.ending) return
      surface.setState({ ...s, game: pop(s.game, i) })
    }
    // Number keys pop their hole; any other key starts or resumes a round.
    surface.onKey(e => {
      const n = Number(e.key)
      act(Number.isInteger(n) && n >= 1 ? n - 1 : -1)
    })
    // Row 0 is the hint line; the pool starts on row 1. A click off every hole only starts or resumes.
    surface.onPointer(e => e.type === 'down' && act(holeAt(cols(), e.x, e.y - 1) ?? -1))
    surface.every(FRAME_MS, () => {
      const s = surface.state
      if (!s) return
      const p = s.ref.props
      const running = s.game.mode === 'run'
      // Claude is done: the round holds where it is and the countdown to the fold runs.
      if (p.ending) {
        if (running && s.game.score > 0) surface.post({ game: s.game.score })
        return surface.setState({ ...s, game: running ? { ...s.game, mode: 'paused' } : s.game, endTicks: s.endTicks + 1 })
      }
      if (!running) return
      // Claude needs the person: the round holds until they press again.
      if (p.paused) {
        if (s.game.score > 0) surface.post({ game: s.game.score })
        return surface.setState({ ...s, game: { ...s.game, mode: 'paused' } })
      }
      const game = step(s.game, FRAME_MS)
      if (game.mode === 'over') surface.post({ game: game.score })
      surface.setState({ ...s, game })
    })
    surface.setState({ game: newGame(props.seed, layout(cols()).length), ref, endTicks: 0 })
  }
  const state = surface.state ?? { game: newGame(props.seed, layout(cols()).length), ref: { props }, endTicks: 0 }
  state.ref.props = props
  const g = state.game
  const C = props.colors
  const hint =
    props.ending ? `Claude is done · ${Math.max(1, Math.ceil((GAME_LINGER_MS - state.endTicks * FRAME_MS) / 1000))}`
    : props.paused ? 'Claude needs you'
    : g.mode === 'ready' ? `click open ones, or 1–${g.holes.length}`
    : g.mode === 'paused' ? 'held · click to go on'
    : g.mode === 'over' ? 'click to play again'
    : ''
  const tally = `${'♥'.repeat(g.lives)}  ${g.score} · best ${Math.max(props.best, g.score)}`
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" height={1} justifyContent="space-between">
        <Text color={props.paused ? C.warn : C.faint} wrap="truncate-end">{hint}</Text>
        {/* The score never gives way; the hint truncates instead. */}
        <Box flexShrink={0}><Text color={C.ink}>{tally}</Text></Box>
      </Box>
      {draw(g, cols(), C).map((runs, r) => (
        <Box key={`r${r}`} flexDirection="row" height={1}>
          {runs.map((run, i) => (
            <Text key={`c${i}`} color={run.color}>{run.text}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Pop
