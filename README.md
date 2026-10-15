# clawd-band

A Claude Code mod that puts a band above the prompt: an animated pixel-art Clawd that acts out what Claude is doing, your weekly and five-hour usage bars, and a live countdown to each window's reset.

![clawd-band cycling through every pose](docs/demo/tour.gif)

## The band

```
 ┌ sprite ┐  7d ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  26% ↻   4d 7h
 │ 12 × 3 │  5h ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  38% ↻ 2:14:09
 Opus 5.5 high
```

- **Sprite**: Clawd, drawn with kitty's graphics protocol at 12 columns by 3 rows, in stop-motion (a few frames, each held for 400 ms). It is the only thing that moves: the mod replaces Claude Code's own spinner with an empty box.
- **Model and effort**: the session's model, shortened (`claude-opus-5-5` becomes `Opus 5.5`), with the reasoning effort beside it.
- **Usage bars**: `7d` is the weekly window, `5h` the five-hour window. Each bar turns from green to amber at 60% and to red at 85%.
- **Countdown**: the time to each window's reset, `h:mm:ss` under a day, `Nd Nh` beyond. A window whose reset has passed drops to 0% straight away.

## Every pose

The pose follows Claude's current step: thinking, replying, or the tool it is calling. When the turn ends, Clawd goes back to idle.

| Pose | Raised by | In the band |
| --- | --- | --- |
| idle | Nothing running. Clawd stands and blinks now and then. | <img src="docs/demo/idle.gif" width="560" alt="idle"> |
| thinking | The model is thinking. A hand scratches the head while a thought bubble rises. | <img src="docs/demo/thinking.gif" width="560" alt="thinking"> |
| working | The model is replying, or calls any tool not listed below (`TodoWrite`, an MCP tool, …). Both arms pump. | <img src="docs/demo/working.gif" width="560" alt="working"> |
| reading | `Read`, `Grep`, `Glob`, `LS`, `NotebookRead`, `ToolSearch`, and the Claude Docs connector's `read`, `query` and `guide`. Clawd holds up a book, the eyes run along the line, and a page turns. | <img src="docs/demo/reading.gif" width="560" alt="reading"> |
| writing | `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, and every other Claude Docs tool (`create`, `update`, `batch`, …). A pencil leaves a line of ink. | <img src="docs/demo/writing.gif" width="560" alt="writing"> |
| running | `Bash`, `BashOutput`, `KillShell`, `TaskStop`. A stride and a bounce, with speed lines. | <img src="docs/demo/running.gif" width="560" alt="running"> |
| searching | `WebFetch`, `WebSearch`. A magnifying glass, held up on one side and then the other. | <img src="docs/demo/searching.gif" width="560" alt="searching"> |
| delegating | `Agent`, `Task`, `SendMessage`, `Workflow`, `Skill`. Clawd waves a small Clawd off on its errand. | <img src="docs/demo/delegating.gif" width="560" alt="delegating"> |
| questioning | `AskUserQuestion`. A "?" bobs beside the head while Claude writes the question. | <img src="docs/demo/questioning.gif" width="560" alt="questioning"> |

While an `AskUserQuestion` menu is open, Claude Code hides the band. The mod also swaps the sprite for Claude Code's text logo and stops animating until the menu closes, so a kitty image can't cover the menu.

### About these demos

kitty's graphics protocol draws the sprite as an image on its own layer, and terminal recorders such as asciinema record only the text stream, so a recording would show the bars with no Clawd. The GIFs above are therefore rendered by [`scripts/render-demo.ts`](scripts/render-demo.ts) from the mod's own frame data (`hooks/sprite.ts`). The script uses the band's layout from `hooks/register.tsx` and Claude Code's dark-theme colours. To re-render them:

```sh
node scripts/render-demo.ts   # needs node 23.6+, rsvg-convert and ImageMagick
```

## Requirements

- Claude Code with function-hook plugins (mods): built against 2.1.296, tested on 2.1.299. The mod API is early access and may change between releases.
- A terminal that supports the kitty graphics protocol, for the sprite. It has been tested in [kitty](https://sw.kovidgoyal.net/kitty/); other terminals are untested.
- A claude.ai subscription login (Pro or Max) for the usage bars: the five-hour and weekly windows belong to a subscription, and without them the bars read `--`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clawd-band --marketplace nninkovic95/clawd-band
```

Answer `y` to add the marketplace, then pick a scope. From a shell instead:

```sh
claude plugin install clawd-band --marketplace nninkovic95/clawd-band
```

To run it from a clone while you work on it: `claude --plugin-dir /path/to/clawd-band`.

## What it reads, stores and sends

- **Usage**: rate-limit readings come from Claude Code's own session data, which records them from the response headers of the requests Claude Code already makes. A fresh session has no reading before its first reply, so at startup the mod asks Claude Code for the session's OAuth handle (`$.session.authorize()`). It then makes one `GET` to `https://api.anthropic.com/api/oauth/usage`, the endpoint `/usage` reads. Nothing is sent but that request, and only for subscription logins.
- **Model and effort**: read from the session and from each model request.
- **Local storage**: the last usage reading and the last model and effort are kept in the plugin's store in Claude Code's own plugin storage, so the band is filled at startup. A cached effort is shown only for the same model.
- No other network calls, no telemetry, no files written outside the plugin store.

## Development

```sh
claude plugin validate .
claude plugin test .
```

`claude plugin test` runs `hooks/band.test.tsx`: pose mapping, usage parsing and merging, countdowns and colours, whole RGBA frames, the band's content, the survey case, and a `/clear` reload. Saving a file while the mod is loaded through `--plugin-dir` hot-reloads it.

## Credits

The sprites are original to this project. They are drawn in code (`hooks/sprite.ts`) on a 28 × 14 grid, and Clawd's body is Claude Code's own startup logo (`▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝`) traced pixel for pixel. Every prop (book, pencil, magnifying glass, thought bubble, "?", mini Clawd) is drawn here.

Clawd is the Claude Code mascot. This is an unofficial community project, not affiliated with or endorsed by Anthropic.

## License

[MIT](LICENSE)
