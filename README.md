# Tidepool

**Low tide for Claude Code: see every tool, agent and job beside your chat.**

Claude Code tracks a lot it never shows you: when each tool ran and for how long, which calls ran side by side, what each subagent and background shell is doing, what a turn cost and how much context it used. Tidepool moves all of that out of the chat into the **Tide rail**, a timeline beside the conversation, so the chat holds only what you and Claude said. It also restyles the rest of the terminal to match: your prompts, Claude's replies, the tasks band, the spinner and the status line.

![Tidepool with the Warm Claude theme and Maple Mono NF: a one-line prompt in the chat, the crab running its course above the input while the test suite runs, and the Tide rail on the right in three sections: the turn's timeline, the plan at 2/3 with the running test suite under its task and a background dev server outside the plan, and the one file the turn changed; the status line below](docs/screenshot.png)

```
▌ you  fix the login bug                    │ ≈ tidepool                following scroll
                                            │ ▾ timeline · turn 4 · 52s  fix the login bug
  ◇ 14 tools · 1 agent · 52s · 1 error ▸ rail│ Read  auth.ts         ╸─────────── 0.4s
                                            │ ✕ Bash npm test     ─━━━━━━━╸─── 41s
◆ claude                                    │ Agent Explore auth    ──━━━━━━━─── 30s  9 tools ▸
  Found it: the token check compared expiry │ Edit  auth.ts         ─────────╺── 0.1s  +12 −3
  with < instead of <=.                     │                       0s        52s
                                            │ ▾  Plan  2/3 ━━━━━━━━────  ~4m left  ▾ show all
                                            │ ✓ 1. Find the expiry check        3m
                                            │ ▶ 2. Fix the comparison           52s
                                            │     ▸ add a regression test       12s
                                            │         ▶ $ npm test -- auth      8s
                                            │ · 3. Run the full suite
                                            │ ▾ files · 2 changed · +32 −3
                                            │   src/auth.ts                +12 −3
                                            │   src/auth.test.ts           +20 −0
```

## What you get

| Where | Before | With Tidepool |
|---|---|---|
| Beside the chat | Tool calls stacked between your prompt and the answer | **The Tide rail.** A timeline for the turn you are reading: one row per tool call with a bar for when it ran, so slow steps and parallel calls show at a glance. Subagents show their tool count and open into their own calls. Background shells keep running past the turn's end (`⇢`) until they finish. Press a row for its command, output or error. The rail has three sections, each under a header you press to fold it away: the **timeline**, **the plan** (see the tasks band below) with each shell, background job and subagent under the task it started in, and the **files** the turn changed with their `+ −` counts. Press a file to open its diff in a tab beside the rail; its `✕ close` closes just the diff, and the rail's own `✕` closes just the rail. The rail follows your scroll. |
| In the chat | Every tool call and its output | **One receipt line per turn:** what the turn opened and changed, `◇ 2 pages (code.claude.com, github.com) · 1 search · 6 read · 2 edited · 3 shell · 1 agent · Linear ×2 · 52s · 1 error  ▸ rail`. Parts that do not fit drop from the end. Press it to pin that turn in the rail, where the same receipt sits under the turn's prompt: press a part to show only those calls, again to show all. A turn that opened nothing reads `from memory` in the rail. |
| Above the prompt | Nothing | **Tasks band.** Every task with done, running or waiting, how long each took, and the time left. The estimate learns from your past plans in each project, so it shows before the first task finishes. Steps inside a task nest under it as sub-items. Subagents, shell commands and background jobs nest under the task or sub-item that was running when they started: agents with a live timer and their tokens once done, shells with how long each has run, `~40s left` once the same command has run before, and a background job's latest output line. Anything still running stays under its task; finished work folds away after 30 seconds. Work started outside any task closes the plan under `outside the plan`. When not every row fits, `▾ show all` on the Plan header shows the rest. A finished plan shows its total for 30 seconds (in the rail, a done card with the crab's finish), then folds away. While the Tide rail is docked, the plan and the shells move into the rail, and this band keeps only the usage line and the prompt dock. |
| Above the prompt | Nothing | **Usage line, only when it matters:** a warning when a turn re-sent your context at full price because the prompt cache had gone cold, and tokens split by agent when subagents ran. Tokens, cache rate and the cache countdown live in the status line. |
| Your prompts and replies | `> fix the queue test`, `●` before each reply | **A styled transcript:** `▌ you` before your prompts and `◆ claude` above each reply, in the theme's accent colour. Replies still go through Claude Code's own markdown renderer, so code blocks and links look the same. An image you attached from a file gets a line under your prompt with its name and `open ↗`: in Orca it opens in a tab of Orca's own browser beside the terminal, elsewhere in your system's viewer. Slash command output (`/cost` and others) gets a title line. |
| Each tool call, with the rail off | `Read(src/very/long/path/file.ts)` blocks | **One line each:** `◆ Edit src/queue.ts  +12 −3  0.4s`, with Claude Code's own diff and output kept underneath. Runs of reads and searches fold into `◇ Read ×6  ⌕ Grep ×2`, with `· 1 failed` when any of them failed. |
| Spinner | A random word (`Sauteing…`) | **What is actually running:** `Editing queue.ts`, `Run the test suite`, `Agent: Find entry points`. Claude Code's timer and token count stay. |
| Above the prompt | Nothing | **The prompt dock.** A little clay crab lives above the input. Idle, it stands beside `◆ Ask Claude` and the keys that matter. When you send a prompt it hops onto a dinosaur-game course and runs while Claude works: walking while it waits on the API, jogging while it thinks, sprinting while tools run or the reply streams. Cacti and rocks come by, every tool call drops a crate, and it jumps them all. Above the scene: the current step, the time in each phase and the turn's clock; below it, the latest calls ticking to ✓. When the turn finishes, a checkered flag scrolls in, the crab runs through it and does a victory hop, and the header shows the score: `★ 23 jumped · 6 crates · 1m 42s`. Then it hops home. A turn you stop with Esc skips the flag. |
| Under the prompt | Dim labels | **Themed labels:** mode labels as small chips, notices with their `/command` in the accent colour, the run-in-background hint as `⇣ ctrl+b to run in background`. The hint line (`? for shortcuts`) stays Claude Code's, so its keys keep working. |
| Between turns | `Baked for 1m 3s` | **Nothing.** The spinner already shows the time while a turn runs. |
| When you are away | Silence | **A chime and a toast** when a turn longer than 30 seconds finishes or fails, and when Claude needs your permission. |
| Status line | Whatever you set up | **A matching status line:** model, effort, folder, git branch and changes, the branch's pull request (`#5 MERGED`), context meter, cache countdown, and your session and weekly limits with reset times. |

```
 Opus 5.5  high  my-app  main +2 ?1 ↑1  #5 OPEN  ctx ━━╸───────── 22% 44k/200k  warm 52m
 Session 40% · resets 1h 26m  Weekly 68% · resets 1d 17h
```

Everything runs locally. Tidepool sends nothing anywhere.

## Install

You need **Claude Code 2.1.288 or later** (`claude --version`; `claude update` to upgrade). Older versions install the plugin without an error but never load it, so nothing changes on screen.

Tidepool's own colours and glyphs default to the screenshot's look (Theme `warm`, Powerline glyphs on). Four things sit outside what a plugin may change: your `settings.json`, your terminal's font and colours, and Claude Code's screen mode. Do all five steps below and your terminal looks like the screenshot:

1. Add the plugin.
2. Turn on the status line.
3. Let Claude keep a task list.
4. Set up your terminal: font, colours, 24-bit colour.
5. Switch Claude Code to fullscreen, in a window at least 144 columns wide.

**1. Add the plugin.** Inside Claude Code:

```
/plugin marketplace add BhumilModi/tidepool
/plugin install tidepool@tidepool
```

Claude Code may say the options are not set yet; every option has a default, so you can skip `/plugin configure`. Start a new session: a session that was already running does not load the plugin. The transcript style, tool rows and spinner work right away. The tasks band appears the first time Claude works through a task list (see step 3).

**2. Turn on the status line.** Claude Code only runs a status line that `settings.json` points to, and plugins cannot edit that file. So, inside Claude Code, run:

```
/tidepool-statusline
```

It prints a `"statusLine"` block with the path to your install. Paste it into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json` if you use a custom config folder), replacing any existing `"statusLine"`, and start a new session. The status line needs **Node 18 or later** on your `PATH`. It reads the Tidepool theme from your user settings, so set the theme there rather than in a project's settings.

The pull request badge needs the [GitHub CLI](https://cli.github.com/) (`gh`), logged in. Tidepool looks the PR up in the background at most once a minute per branch and keeps the answer in `~/.cache/tidepool/pr.json`, so the status line never waits on the network. A new PR shows up within about a minute. Without `gh`, or outside a GitHub repo, the badge just doesn't appear.

When Tidepool updates, its install folder changes. If your status line still points at the old one, Tidepool shows a reminder at startup: run `/tidepool-statusline` again and paste the new block.

**3. Let Claude keep a task list (needed on current models).** The plan comes from Claude's task tools (`TaskCreate`, `TaskUpdate`, `TodoWrite`). Claude Code 2.1.289 only turns them on by default for older models, so on Claude 5 models there is no task list and the plan never shows. Add this to `~/.claude/settings.json`, merging it into your existing `env` rather than replacing it:

```json
{
  "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" }
}
```

You don't need to hide Claude Code's own task panel. `TaskCreate` and `TaskUpdate` open it above the prompt, where it would duplicate the plan and squeeze the prompt dock. Tidepool runs both as its own calls, so the panel stays shut. The `todoFeatureEnabled` setting does not hide it: Claude Code 2.1.289 to 2.1.293 save the setting but never read it.

**4. Set up your terminal.** The first session after install copies the Maple Mono NF font and the terminal colour themes onto your machine, but no terminal lets a plugin switch to them. Follow [Set up your terminal](#set-up-your-terminal) for yours: Ghostty, iTerm2, macOS Terminal, VS Code or Cursor, JetBrains, Windows Terminal, kitty, WezTerm, Alacritty, Warp and Orca each have their own steps there. Then run the [checks](#check-your-setup).

Until your terminal uses Maple Mono NF (or another [Nerd Font](https://www.nerdfonts.com/)), the powerline separators show as `?` or empty boxes. Pick the font, or turn **Powerline glyphs** off in `/config`.

**5. Switch to fullscreen.** The Tide rail docks beside the chat only in Claude Code's fullscreen layout. Inside Claude Code, run:

```
/tui fullscreen
```

It stores `"tui": "fullscreen"` in your settings; `/tui default` goes back. The rail opens by itself when the window is at least 144 columns wide. In a narrower window, run `/tidepool-rail` to open it from 110 columns. Below 110 columns, or without fullscreen, the rail sits above the prompt instead (see [Tide rail](#tide-rail)).

**Coming from ccshine?** Tidepool is ccshine's new name. Uninstall `ccshine@ccshine`, install `tidepool@tidepool`, and run `/tidepool-statusline` to point the status line at the new install. Your plan-time history carries over on the first start; settings in `/config` start from their defaults.

**From a local copy** (for trying changes):

```
git clone https://github.com/BhumilModi/tidepool
claude --plugin-dir ./tidepool
```

## Themes and font

Tidepool comes with five colour themes and a font. Each theme has two halves that match: the colours Tidepool draws with (the rail, tasks band, dock, tool rows, chips and status line), set by **Theme** in `/config`, and a terminal colour theme for everything else on screen (the background, Claude's replies, code blocks, diffs and the prompt). The rail paints its background in the terminal theme's background, so it reads as part of the terminal.

| Theme in `/config` | Terminal theme | Look |
|---|---|---|
| `warm` (default) | **Warm Claude** | Warm near-black (`#1A1817`), warm off-white text, Claude's clay accent. The screenshot above |
| `claude` | **Tidepool Claude** | Cool slate (`#1A1B26`), clay accent, bright blues and greens |
| `nord` | **Tidepool Nord** | [Nord](https://www.nordtheme.com/)'s polar night (`#2E3440`) and frost blue accent |
| `dracula` | **Tidepool Dracula** | [Dracula](https://draculatheme.com/)'s purple-grey (`#282A36`) and purple accent |
| `mono` | **Tidepool Mono** | Neutral greys (`#1C1C1C`), white accent, muted colours for code |

Every terminal theme is shipped for Ghostty, iTerm2, macOS Terminal, Windows Terminal, kitty, WezTerm, Alacritty, Warp and VS Code under [`themes/`](themes), and listed colour by colour in the [colour reference](#colour-reference) for every other terminal. **To switch themes, change both halves:** pick the Theme in `/config`, then pick the matching terminal theme in your terminal ([Set up your terminal](#set-up-your-terminal)). Tidepool shows a reminder when the Theme changes, and `/tidepool-setup` prints the steps with the file paths for the theme you picked.

- **Font: [Maple Mono NF](https://github.com/subframe7536/maple-font)** (v7.9, with Nerd Font glyphs for the powerline separators). Rounded shapes and cursive italics; your prompts are drawn in italic. It goes with every theme.

**What installs by itself.** When a session starts, Tidepool copies whatever of these is missing (it never overwrites a file); the first session after you install Tidepool does the work and shows one toast:

| System | Font goes to | Themes go to |
|---|---|---|
| macOS | `~/Library/Fonts` | All five Ghostty themes into `~/.config/ghostty/themes/` |
| Linux | `~/.local/share/fonts` (or `$XDG_DATA_HOME/fonts`), then `fc-cache` | All five Ghostty themes into `~/.config/ghostty/themes/` (or under `$XDG_CONFIG_HOME`) |
| Windows | `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, registered for your user (Windows 10 1809 or later, no admin); restart your terminal to see it | Not copied: paste the Windows Terminal scheme yourself |

Under WSL or over SSH your terminal runs on another machine, so Tidepool installs nothing there; `/tidepool-setup` shows where the font files are so you can install them on that machine. Turn all of this off with **Install font and theme** in `/config`. Run `/tidepool-setup` at any time to install again and see the steps for your terminal.

Maple Mono is distributed under the SIL Open Font License 1.1; see [`fonts/OFL.txt`](fonts/OFL.txt).

## Set up your terminal

Tidepool draws its own parts, but the terminal draws everything around them. For the look in the screenshot, every terminal needs the same four things:

1. **Font: Maple Mono NF**, size 14, **line height 1.0** (the default; macOS Terminal is the one exception, below). The powerline separators and the dock's pixels need a Nerd Font, and your prompts are drawn in its italic. The crab, Claude Code's logo and the rail's bars are built from block characters that must touch the rows above and below; with extra line spacing, many terminals leave a stripe of background between rows.
2. **Colours: the terminal theme that matches your Tidepool Theme** (Warm Claude for the default `warm`; see [Themes and font](#themes-and-font)). Without it the background, Claude's replies and code blocks keep your old colours, and the rail shows as a panel of a different shade.
3. **24-bit colour.** Tidepool draws exact hex colours. A terminal that only shows 256 colours rounds them, so the greys band and the rail stops matching the background.
4. **Room:** a window at least 144 columns wide, with Claude Code in fullscreen (`/tui fullscreen`, install step 5), so the rail docks beside the chat.

**Where the theme files are.** Inside Claude Code, `/tidepool-setup` prints every step below with the full path to each file in your install. You can also download them from the [`themes/`](themes) folder on GitHub. Copy a file into your terminal's own config folder rather than pointing at the install: the install folder changes with each Tidepool version.

**File names for each theme.** The steps below use Warm Claude. For another theme, use its name instead:

| Theme in `/config` | Ghostty, iTerm2, macOS Terminal, WezTerm | Windows Terminal, kitty, Alacritty, VS Code | Warp, Orca |
|---|---|---|---|
| `warm` | `Warm Claude` | `warm-claude` | `warm_claude` |
| `claude` | `Tidepool Claude` | `tidepool-claude` | `tidepool_claude` |
| `nord` | `Tidepool Nord` | `tidepool-nord` | `tidepool_nord` |
| `dracula` | `Tidepool Dracula` | `tidepool-dracula` | `tidepool_dracula` |
| `mono` | `Tidepool Mono` | `tidepool-mono` | `tidepool_mono` |

### Ghostty

Tidepool already put all five themes in `~/.config/ghostty/themes/`. Add these lines to `~/.config/ghostty/config`:

```
font-family = Maple Mono NF
font-size = 14
theme = Warm Claude
```

Reload the config (cmd+shift+, on macOS) or restart Ghostty. Ghostty has 24-bit colour on by default.

### iTerm2

1. Settings → Profiles → Colors → Color Presets… → Import…, choose `themes/iterm2/Warm Claude.itermcolors`, then pick **Warm Claude** from the same menu.
2. Settings → Profiles → Text → Font: **Maple Mono NF**, size 14.

iTerm2 has 24-bit colour on by default.

### macOS Terminal

1. Double-click `themes/terminal-app/Warm Claude.terminal` (or `open` it from a shell). Terminal adds a **Warm Claude** profile, with the colours, Maple Mono NF at size 14, line spacing 0.9 and a 160-column window, and opens a window with it.
2. Settings → Profiles, select **Warm Claude**, then click **Default** under the profile list so new windows use it.

Keep the line spacing at 0.9 (Text tab). Terminal adds space of its own between lines, so at 1.0 thin stripes run through the crab and the powerline caps spill past their segments; at 0.9 the rows meet exactly.

To update the profile after a Tidepool update, delete the old one first (Settings → Profiles, `−` under the list). Opening the file while a profile of that name exists adds a second copy, `Warm Claude 1`.

Older versions of Terminal only show 256 colours. If the [colour check](#check-your-setup) shows a striped or wrong-coloured block, use one of the other terminals here for the full look.

### VS Code, Cursor and other VS Code-based editors

This is for running `claude` in the editor's integrated terminal. Open your user `settings.json` (Command Palette → Preferences: Open User Settings (JSON)) and add:

```json
"terminal.integrated.fontFamily": "Maple Mono NF",
"terminal.integrated.fontSize": 14,
"terminal.integrated.minimumContrastRatio": 1
```

Then merge the `workbench.colorCustomizations` block from `themes/vscode/warm-claude.json` into the same file. It only sets the terminal's colours, not the editor's. `minimumContrastRatio: 1` stops VS Code from shifting colours it thinks are too faint, which otherwise changes Tidepool's greys. Give the terminal room: drag the panel wide, or move the terminal into the editor area.

### JetBrains IDEs (IntelliJ, PyCharm, WebStorm and others)

1. Settings → Editor → Color Scheme → Console Font: tick **Use console font instead of the default**, then **Maple Mono NF**, size 14, line height 1.0.
2. Settings → Editor → Color Scheme → Console Colors: set the console background and foreground, and each colour under **ANSI Colors**, from the [colour reference](#colour-reference).

### Windows Terminal

1. Settings → Open JSON file. Paste the contents of `themes/windows-terminal/warm-claude.json` into the `"schemes"` list.
2. Under `"profiles"` → `"defaults"` (or the profile you use), add:

```json
"colorScheme": "Warm Claude",
"font": { "face": "Maple Mono NF", "size": 14 }
```

Restart Windows Terminal so it sees the newly installed font. It has 24-bit colour on by default.

### kitty

Copy `themes/kitty/warm-claude.conf` into `~/.config/kitty/`, then add to `~/.config/kitty/kitty.conf`:

```
include warm-claude.conf
font_family Maple Mono NF
font_size 14
```

Reload with ctrl+shift+f5 (cmd+ctrl+, on macOS).

### WezTerm

Copy `themes/wezterm/Warm Claude.toml` into `~/.config/wezterm/colors/`, then in `~/.wezterm.lua`:

```lua
config.font = wezterm.font 'Maple Mono NF'
config.font_size = 14
config.color_scheme = 'Warm Claude'
```

### Alacritty

Copy `themes/alacritty/warm-claude.toml` into `~/.config/alacritty/`, then in `~/.config/alacritty/alacritty.toml`:

```toml
[general]
import = ["~/.config/alacritty/warm-claude.toml"]

[font]
normal = { family = "Maple Mono NF" }
size = 14
```

### Warp

Copy `themes/warp/warm_claude.yaml` into `~/.warp/themes/`, then Settings → Appearance → Themes and pick **Warm Claude**. Under Settings → Appearance → Text, set the terminal font to **Maple Mono NF**, size 14, line height 1.0.

### Orca, and other apps that import Warp themes

Settings → Terminal Themes → Import from YAML, choose `themes/warp/warm_claude.yaml`, then pick it. Set the terminal font to **Maple Mono NF**, size 14.

### Anything else

Pick Maple Mono NF, then copy the colours from the [colour reference](#colour-reference) below, or from `themes/warm-claude.json`.

### tmux, SSH and WSL

- **tmux** passes 24-bit colour through only when told to. Add to `~/.tmux.conf`, then restart tmux:

  ```
  set -g default-terminal "tmux-256color"
  set -as terminal-features ",*:RGB"
  ```

- **SSH and WSL:** the font and colours belong to the machine your terminal runs on, not the one Claude Code runs on. Tidepool installs nothing over SSH or under WSL. Install the font from the `fonts/` folder and set up the terminal on your own machine.

### Claude Code's own colours

The input box, diffs, permission dialogs and the logo use Claude Code's `/theme`, not Tidepool's. Keep it on a dark theme; Tidepool's palettes are made for dark backgrounds. To have those parts follow your terminal theme too, pick **Dark mode (ANSI colors only)** in `/theme`. That suits the Nord, Dracula and Mono themes best.

### The desktop app and IDE chat panels

The steps above are for Claude Code running in a terminal. In the Claude desktop app, or the chat panel of the VS Code or JetBrains extension, the app draws the chat: the prompt dock, powerline glyphs, terminal colours and the status line do not apply there. The rest of Tidepool follows that app's own look.

### Colour reference

Every colour of every terminal theme, for terminals with no theme file (JetBrains and others):

<!-- theme-colours:start -->
| Colour | Warm Claude | Tidepool Claude | Tidepool Nord | Tidepool Dracula | Tidepool Mono |
|---|---|---|---|---|---|
| Background | `#1A1817` | `#1A1B26` | `#2E3440` | `#282A36` | `#1C1C1C` |
| Text | `#E8E2D9` | `#DEE0E6` | `#D8DEE9` | `#F8F8F2` | `#E4E4E4` |
| Bold text | `#E8E2D9` | `#DEE0E6` | `#D8DEE9` | `#F8F8F2` | `#E4E4E4` |
| Cursor | `#D97757` | `#D97757` | `#88C0D0` | `#BD93F9` | `#E4E4E4` |
| Selection | `#3A3330` | `#3A3E46` | `#434C5E` | `#44475A` | `#3A3A3A` |
| ANSI Black | `#2A2624` | `#2A2D35` | `#3B4252` | `#21222C` | `#303030` |
| ANSI Red | `#E06C5F` | `#EC7070` | `#BF616A` | `#FF5555` | `#D75F5F` |
| ANSI Green | `#8FB573` | `#9ECE6A` | `#A3BE8C` | `#50FA7B` | `#87AF87` |
| ANSI Yellow | `#E2B266` | `#E2B266` | `#EBCB8B` | `#F1FA8C` | `#D7AF5F` |
| ANSI Blue | `#7FA3D1` | `#7AA2F7` | `#81A1C1` | `#BD93F9` | `#87AFD7` |
| ANSI Magenta | `#C49BD6` | `#BB9AF7` | `#B48EAD` | `#FF79C6` | `#AF87AF` |
| ANSI Cyan | `#7DBFB5` | `#7DCFFF` | `#88C0D0` | `#8BE9FD` | `#87AFAF` |
| ANSI White | `#C9C2B8` | `#B4B9C4` | `#E5E9F0` | `#F8F8F2` | `#C6C6C6` |
| ANSI bright Black | `#7A746C` | `#787D88` | `#4C566A` | `#6272A4` | `#808080` |
| ANSI bright Red | `#EC8A7F` | `#F28B8B` | `#BF616A` | `#FF6E6E` | `#E08787` |
| ANSI bright Green | `#A8C98F` | `#B5DE8A` | `#A3BE8C` | `#69FF94` | `#A8C8A8` |
| ANSI bright Yellow | `#EDC889` | `#EDC889` | `#EBCB8B` | `#FFFFA5` | `#E4C887` |
| ANSI bright Blue | `#9DBBE0` | `#9AB8FA` | `#81A1C1` | `#D6ACFF` | `#A8C8E4` |
| ANSI bright Magenta | `#D5B5E3` | `#CDB4FA` | `#B48EAD` | `#FF92DF` | `#C8A8C8` |
| ANSI bright Cyan | `#9DD2C9` | `#A0DDFF` | `#8FBCBB` | `#A4FFFF` | `#A8C8C8` |
| ANSI bright White | `#F4EFE8` | `#F2F3F7` | `#ECEFF4` | `#FFFFFF` | `#F2F2F2` |
<!-- theme-colours:end -->

### Check your setup

Run these in the terminal you set up:

```sh
claude --version   # 2.1.288 or later
tput cols          # 144 or more
printf '\e[48;2;217;119;87m      \e[0m clay  \xee\x82\xb0 \xee\x82\xb6 arrows\n'
```

The last line should show a smooth clay-coloured block, then a right-pointing arrow and a rounded cap. A block of the wrong colour means no 24-bit colour (see tmux above, or try another terminal). `?` or empty boxes in place of the arrows mean the font is not a Nerd Font.

Inside Claude Code, the status line should sit under the prompt, the crab above it, and after the first turn the rail beside the chat.

| What you see | Why | Fix |
|---|---|---|
| Nothing changed at all | Claude Code older than 2.1.288, or a session started before the install | `claude update`, then start a new session |
| `?` or empty boxes in the status line and headers | The terminal font has no Nerd Font glyphs | Pick Maple Mono NF, or turn Powerline glyphs off in `/config` |
| The rail is a different shade from the chat | The terminal theme does not match the Tidepool Theme | Pick the matching terminal theme ([file names](#set-up-your-terminal)) |
| Colours look banded, washed out or off | No 24-bit colour, or VS Code's contrast adjustment | tmux: the lines above. VS Code: `minimumContrastRatio: 1`. An older macOS Terminal: try another terminal |
| The rail sits above the prompt, not beside the chat | Not in fullscreen, or the window is narrower than 144 columns | `/tui fullscreen`, widen the window, or `/tidepool-rail` from 110 columns |
| No status line | The `statusLine` block is not in your settings, or Node 18+ is missing | Install step 2 |
| No plan in the rail or band | The task tools are off on Claude 5 models | Install step 3 |
| Your prompts are not in italics | The font has no italic | Pick Maple Mono NF |
| Stripes or gaps through the crab, Claude Code's logo or the status line, or powerline caps taller than their segments | The line height does not match the glyphs: the terminal spaces out the rows of block characters | Set line height (line spacing, cell height) back to 1.0. macOS Terminal: 0.9; or delete the old profile in Settings → Profiles (`−` under the list) and open the latest `.terminal` file |

## Tide rail

The rail opens by itself when a session starts.

- **Fullscreen, 110 columns or wider:** it docks beside the chat, 44 columns wide unless you drag it, and shows the turn you are reading. Scroll the chat and it follows; press an anchor line to pin a turn until you scroll again. Claude Code sets the width floor. The rail that opens by itself at startup needs 144 columns the first time; once you have opened it with `/tidepool-rail` (and not closed it by hand since), 110 is enough. Narrower, it waits until the window widens or you open it.
- **Anything else** (the main screen, or a window under 110 columns when you open it yourself): Claude Code places it above the prompt. There it shows the turn that is running, six rows at most, and between turns shrinks to one line: `≈ tidepool  turn 4 · 52s · 14 tools`.
- `/tidepool-rail` hides or shows it for the session. Switch it off for good with the Tide rail setting; tool rows then go back to one line each in the chat.
- **While it is docked, the rail owns the plan.** Top to bottom: timeline, plan, files. Open sections share the rail in thirds; a section that needs fewer rows, or is folded (pressed, or with nothing to show), leaves its rows to the others, the plan first. Folded sections stay folded in later sessions. `▾ show all` gives the plan every row it needs and the rail scrolls. When the last task finishes, the plan becomes a done card: a small crab runs in and does victory hops beside `✓ Plan complete`, the count of tasks and sub-items with the total time, and the fastest and longest task. The card stays for 30 seconds, then folds away and the timeline gets its rows back. While the rail owns the plan, the tasks band above the prompt draws none of it, so the prompt dock keeps its room. A rail above the prompt leaves the plan to the band.

## Settings

Open `/config` and find the Tidepool rows. Every switched-off feature leaves Claude Code's own display exactly as it was.

| Setting | Default | What it does |
|---|---|---|
| Theme | `warm` | Colours for everything Tidepool draws, including the status line and the rail's background: `warm`, `claude`, `nord`, `dracula`, `mono`. Each has a matching terminal theme (see [Themes and font](#themes-and-font)) |
| Powerline glyphs | on | Arrow and rounded-cap separators in headers and the status line. Needs a [Nerd Font](https://www.nerdfonts.com/) in your terminal, such as the bundled Maple Mono NF; otherwise you see empty boxes |
| Tide rail | on | Tool calls, agents and background jobs on a timeline beside the chat, with one anchor line per turn in the chat |
| Tasks band | on | Tasks, sub-items, agents, running shells and time left above the prompt, or in the rail while it is docked |
| Tool rows | on | Tidepool's tool rows: the anchor line and rail, or one-line calls with the rail off. Off leaves Claude Code's own rows |
| Spinner activity | on | Spinner says what is running |
| Transcript style | on | `▌ you` and `◆ claude` markers, titled command output |
| Prompt chrome | on | Mode chips, notices and the background hint; hides the `Baked for` line between turns |
| Prompt dock | on | The crab and its course above the prompt (terminal only). It replaces the spinner line, so Claude Code's live token count is not shown during a turn |
| Install font and theme | on | Copy the bundled Maple Mono NF font and the Ghostty themes on first start (see [Themes and font](#themes-and-font)) |
| Usage line | on | Cold-cache warnings and the token split by agent above the prompt |
| Attention alerts | on | Chime and toast |
| Alert after (seconds) | `30` | Only alert for turns at least this long |

## Good to know

- **Tasks band empty?** It only shows while Claude has a task list. Ask for a plan, or anything with several steps. On Claude 5 models it also needs `CLAUDE_CODE_ENABLE_TODO_TOOLS` (install step 3); without it Claude has no task tools.
- **Sub-items** are tasks Claude creates with `metadata: { parent: "<task id>" }`. They nest under their task and do not count toward the plan's progress or time left. Tell Claude to use them (for example in your `CLAUDE.md`) if you want steps inside a task.
- **The crab looks squeezed?** Claude Code's own task panel shares the space above the prompt. Tidepool keeps it shut (install step 3). If it still opens, press ctrl+t to close it. When space is short the scene shrinks to four rows before it drops, and the dock's status line always stays.
- **The prompt dock** is drawn in half-block pixels, so it looks best with a Nerd Font such as the bundled Maple Mono NF. Collapse it with ctrl+x ctrl+a, or switch it off in `/config` to get Claude Code's spinner back.
- **Token counts look large.** A turn's tokens add up every request in that turn, and each request re-reads the cached context. That is how Claude Code bills usage, which is why the cache state matters.
- **No chime?** Sounds play through `afplay` on macOS. Linux and Windows get the toast only.
- **Dark terminals.** The palettes are designed for dark backgrounds. If Claude Code's own theme is a light one, Tidepool says so once at startup; it never changes the setting.
- **What stays Claude Code's.** The input box, the logo, permission dialogs and the `bypass permissions on` line are drawn where plugins cannot restyle them. Tool output under each tool row is Claude Code's own too.
- **Early-access API.** Tidepool uses Claude Code's function-hooks plugin API, which may change between releases. If something stops drawing after a Claude Code update, switch that feature off in `/config` and open an issue.

## Uninstall

```
/plugin uninstall tidepool@tidepool
```

Then remove the `"statusLine"` block from `~/.claude/settings.json` if you added it.

## Development

```
git clone https://github.com/BhumilModi/tidepool && cd tidepool
CLAUDE_CODE_TYPES=/path/to/claude-code.d.ts ./verify.sh
```

`verify.sh` validates the manifest, runs the tests with `claude plugin test`, type-checks with `tsc`, smoke-runs the status line script, and checks the terminal theme files are up to date. After changing `themes/terminal.mjs`, run `node scripts/build-themes.mjs`: it rewrites every theme file and the README's colour reference.

Claude Code writes its plugin API types into `.claude-plugin/types/` the first time it loads the plugin (run `claude --plugin-dir .` once). Until then, editors show type errors and `verify.sh` needs `CLAUDE_CODE_TYPES` pointing at a `claude-code.d.ts`: Claude Code's built-in plugin-authoring skill prints that file's path when it loads. `docs/spike.md` records what was checked live against Claude Code 2.1.288.

Layout: `hooks/features/*.tsx` are the hooks, one file per feature; `hooks/*.ts` are the pure helpers they use; `statusline/` is the status line script; `tests/` has one file per feature.

## Licence

MIT
