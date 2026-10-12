import type { On } from 'claude-code'

import { opts } from '../options'
import { runningSeen } from '../rail'
import { palette } from '../theme'

// The hint line under the prompt stays the engine's: a tree or a rewritten hint replaces its live pills.
export function registerChrome(on: On) {
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!opts.chrome || e.props.modes.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const C = palette()
    return (
      <Box>
        {e.props.modes.flatMap((mode, i) => [
          ...(i ? [<Text key={`g${i}`}>{' '}</Text>] : []),
          <Text key={`m${i}`} color={C.soft} backgroundColor={C.seg}>{` ${mode} `}</Text>,
        ])}
      </Box>
    )
  })

  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    if (!opts.chrome) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const C = palette()
    return (
      <Box>
        <Text color={C.faint} wrap="truncate-end">{e.props.text}</Text>
        {e.props.command !== null && <Text color={C.accent}>{` ${e.props.command}`}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    // A call drawn with progress is running: if it waited at a permission prompt, the person said yes.
    runningSeen.add(e.props.tool_use_id)
    if (!opts.chrome || e.props.kind !== 'background_hint' || e.props.hint === '') return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text color={palette().faint} wrap="truncate-end">{`⇣ ${e.props.hint.replace(/^\((.*)\)$/, '$1')}`}</Text>
  })

  // `Baked for 3s` between turns: the spinner already shows elapsed time while a turn runs.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!opts.chrome) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
