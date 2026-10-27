<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

# pi-cc-extensions

> Claude Code-style TUI output with some personal touches and handy utilities (no extra built-in tools).

## Preview

<a href="https://github.com/user-attachments/assets/6c858000-fdad-43f9-957f-4d0278648498"><img src="./assets/readme/preview.webp" alt="pi-cc-extensions UI preview" width="100%"></a>

Click the cover to play the demo video

## Quick start

```bash
pi install npm:pi-cc-extensions

# GitHub
pi install git:github.com/minuque/pi-cc-extensions
```

Run `/reload` after installation.

## Features

| Feature                     | Description                                                                                                                                  | Entry point                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Claude Code UI              | Tool summaries, expand/collapse, rich edit/write diffs, and `on` / `compact` / `off` modes                                                   | `/ccstyle`                                      |
| Markdown enhancements       | Mermaid dialects and circled-number conversion                                                                                               | Automatic; turn off with `enableMarkdownEnhance: false` |
| Fullscreen mode             | Tool card/group expand and collapse on click, previews, hover highlight, and a back-to-bottom button                                         | `TUIMODE=fullscreen` or `--tui-mode fullscreen` |
| Settings panel              | `Style / Features / UI / Diff / Thinking / Footer` tabs. The Footer tab edits tokenSpeed visually (display mode / icon / count strategy / end-of-stream behavior / sliding window / tier thresholds / tier colors; provider overrides read-only); the Features tab toggles agentSummary segments plus done-date and italic | `/ccstyle`                                      |
| Context inspection          | Usage breakdown and previews for the system prompt, memory, skills, tools definition, and messages                                           | `/context`                                      |
| Session/Subagent references | Search and inject effective context from previous Sessions or existing SubAgents                                                             | `@`                                             |
| Status bar                  | Shows model, context, cache, cost, and git; also works with `@narumitw/pi-usage` for live quota. Output rate is tier-colored via `tokenSpeed`. Git/cache Nerd Font icons can be turned off | `/ccstyle`                                      |
| Theme                       | Bundled CC Dark and CC Light themes                                                                                                          | `/settings` → Theme                             |

Renderer snapshots for `on` / `compact` modes: [default](./docs/tool-render-examples-default.md) · [compact](./docs/tool-render-examples-compact.md)

## Configuration

`/ccstyle` behavior is configured through `~/.pi/agent/pi-cc-extensions.json`:

```jsonc
{
  // style
  "mode": "compact",                            // on / compact / off
  "excludeRenderers": [],                  // tools keeping the native renderer, matched case-insensitively; Agent always keeps its dedicated renderer

  // features
  "enableSessionReference": true,          // @ session references
  "enableSubagentAutocomplete": true,      // @subagent:[name] completion and delegation hints
  "enableContextCommand": false,            // /context usage check
  "enableAgentSummary": true,              // per-turn tool summary
  "enableWorkingMessage": true,            // Working... bottom token/elapsed
  "enableAliases": true,                   // /clear, /exit aliases
  "enableMarkdownEnhance": true,           // markdown pass: Mermaid dialects and circled-number conversion; false hands it to other extensions
  "enableEditorPrefix": true,              // editor ❯ prefix

  // ui
  "expandedInputMaxLines": 5,              // expanded tool Input lines; overflow shows a footer hint
  "expandedOutputMaxLines": 10,            // expanded tool Output lines; overflow shows a footer hint
  "expandedPreviewMaxLines": 40,           // max lines for expanded TaskList bodies (expanded diffs always show all)
  "toolLabelClip": 0,                      // tool summary path/command clip length; 0 = fit width
  "showStartupHeader": true,               // startup header (logo + tips) toggle
  "stickyUserMessage": true,               // fullscreen: pin a user message's first line once it scrolls off the top edge, until the next one takes over
  "scrollButtonMode": "dock",              // fullscreen: extension dock row / native Pi floating overlay

  // diff
  "diffViewMode": "auto",                  // layout: auto / split / unified
  "diffIndicatorMode": "bars",             // change indicators: bars / classic / none
  "diffSplitMinWidth": 120,                // min terminal width for side-by-side columns
  "editDiffCollapsedLines": 24,            // edit collapse lines; 0 = change-count summary only
  "writeDiffCollapsedLines": 0,            // write collapse lines; 0 = creation summary only
  "diffWordWrap": true,                    // wrap long diff lines

  // thinking
  "useSummaryTitlesAsThinkingTitle": true, // use latest summary as thinking title
  "previewLines": 3,                       // preview lines; 0 hides
  "animationIntervalMs": 90,               // title animation interval (ms)

  // footer
  "enableCustomFooter": true,              // custom status bar
  "footerTokenRate": true,                 // output rate chip; false hides it
  "footerTokenRateMode": "average",        // average: whole-prompt avg; live: trailing 1s rate
  "footerTokenRateTtft": true,             // append TTFT to the rate chip; false shows tok/s only
  "footerCurrency": "USD",                 // display currency for the footer cost
  "footerCurrencyRate": null,              // display units per 1 cost unit; null changes the symbol only
  "footerNerdIcons": true,                 // Nerd Font glyphs for git/cache; false = plain text
  "footerGitStatsMode": "working",         // working (default): uncommitted; branch: cumulative net changes
  "footerHiddenKeys": [],                  // hidden chip keys
  "footerLine1Keys": ["cwd", "pi-usage", "git", "model", "context", "cache", "rate"], // chip order per line; builtins and plugins share one layout
  "footerLine2Keys": [],       // cwd: directory and session; git: branch and changes. Either can move to any line
  "footerLine3Keys": [],                   // painted only when a chip is visible

  // tokenSpeed (output rate tiers, from pi-token-speed): the footer rate chip and the summary line's rate segment are tier-colored
  // Full parameter reference and examples: docs/token-speed.md
  // Note: the rate chip renders only if "rate" is listed in footerLine*Keys.
  "tokenSpeed": {
    "thresholds": { "slow": 0, "medium": 15, "fast": 30, "blazing": 45 }, // four tiers (tok/s), non-negative strictly ascending integers; invalid block falls back to defaults
    "colors": {
      "slow": "#ff4444",                     // tier colors (slow/medium/fast/blazing); one invalid color falls back for that tier only
      "medium": "#ffaa00",
      "fast": "#00ff88",
      "blazing": "#44ddff"
    },
    "icon": "",                              // empty = no icon (as before); non-empty prefixes the rate chip, e.g. ⚡/🔥/🚀
    "countStrategy": "estimate",             // estimate (chars/4, CJK counts 1 per char) / direct (1 delta=1 token, CJK distortion is on you)
    "endTpsBehavior": "average",             // average: freeze to the whole-run average / last: freeze to the last window value
    "slidingWindow": 1000,                   // live sliding window in ms, range 100..30000 (30s hard cap)
    "updateInterval": 0,                     // kept but inert: the pi TUI render pipeline already coalesces frames (dedup + 16ms frame throttle)
    "formatDuration": false,                 // duration formatting: 92.3s → 1m 32s (the elapsed suffix in stats/full modes)
    "display": "legacy",                     // chip shape: legacy (default, current format: no label, live prefix in live mode) / tps (`25 tok/s`) / ttft (`25 tok/s (TTFT: 450ms)`), stats (`25 tok/s (150 tok in 6.0s)`), full (both segments joined with `·`)
    "displayColors": {                       // suffix colors for non-legacy modes (token count / elapsed / TTFT segments); missing fields stay unpainted, invalid hex is dropped
      "count": "#00ff88",
      "elapsed": "#ffaa00",
      "ttft": "#44ddff"
    },
    "providerOverrides": {                   // per-provider overrides: keys are exact provider ids of the active model; the block is deep-merged over the base (thresholds whole-block, colors/displayColors per color; overridable: thresholds/colors/display/displayColors/countStrategy/endTpsBehavior/slidingWindow/icon/formatDuration)
      "anthropic": { "display": "full", "slidingWindow": 2000 }
    }
  }

  // agent-summary (turn summary line)
  "agentSummaryKeys": ["duration", "tokens", "rate", "cache-hit", "turns", "tools", "done"], // segment order; options: duration/tokens/cache/cache-hit/rate/reasoning/turns/model/tools/cost/failed/done
  "agentSummarySep": " · ",                // segment separator
  "agentSummaryIcons": true,               // emoji icons; false = plain text
  "agentSummaryMinTools": 0,               // min tool calls before showing; 0 = show whenever there is content, 2 = legacy behavior
  "agentSummaryDoneDate": true             // done segment with date: false = "done 19:24"
  "agentSummaryItalic": false              // italic summary line (Claude Code style); false = upright
}
```

#### `agentSummaryKeys` segments

The turn summary line renders segments in `agentSummaryKeys` order; segments without data are omitted.

| key | Renders | Notes | Hidden when |
| --- | --- | --- | --- |
| `duration` | `⚡ 9m55s` | Wall-clock turn duration | — |
| `tokens` | `↑12.4k ↓3.1k tok` | Input / output tokens | no token usage reported |
| `cache` | `↗45k ↘210k cache` | Cache traffic: ↗ written (upload), ↘ cache-hit read (download) | provider reports no cache |
| `cache-hit` | `󰆼 78%` | Cache hit rate = reads ÷ (input + writes + reads), accumulated over the turn; same icon and math as the footer cache chip, falls back to `hit 78%` when `footerNerdIcons: false` | no cache data |
| `reasoning` | `🧠 1.8k` | Reasoning tokens (subset of `output`) | provider reports none |
| `turns` | `󰑓 4` | Model request count | 0 turns |
| `model` | `🤖 glm-5.3-flash` | Model of the last turn | — |
| `rate` | `42 tok/s` | Average output rate, same source as the footer rate chip, tier-colored via `tokenSpeed`; frozen at `agent_end` so replays stay stable | no rate data |
| `tools` | `⛏ bash×19 edit×6 read×4` | bash counts calls; read/edit/write dedupe by file; rest are `other×N` | no tool calls |
| `cost` | `💰 $0.05` | Accumulated turn cost | model has no pricing |
| `failed` | `✗1` | Failed tool calls | 0 failures |
| `done` | `done 19:24` | Turn end time (local HH:MM) | — |

Example (`agentSummaryIcons: false` drops the emoji prefixes):

```
│ ⚡ 9m55s · ↑12.4k ↓3.1k tok · ↗45k ↘210k cache · 󰆼 78% · 42 tok/s · ⛏ bash×19 edit×6 · 💰 $0.05 · ✗1 · done 19:24
```

`agentSummaryMinTools` gates the whole line: `0` (default) shows whenever the turn had tool calls or token output; set `2` for the legacy behavior (≥ 2 tool calls).

> [!TIP]
> **Fullscreen**: expanded diffs always show every line. When expanded Input/Output exceeds the line cap, the footer shows `… +N more lines`; click for the full preview, click again to collapse.

> [!NOTE]
> **Mermaid rendering**: set `markdown.mermaid` to `final` via `~/.pi/agent/settings.json` or `/settings`. Default `streaming` redraws every frame; `final` renders once.

## Local development

```bash
./test.sh            # macOS/Linux; needs node and pi
./test.bat           # Windows; runs test.sh through Git Bash
pi -e .              # one run, does not edit settings.json
```

## Compatibility

- Node.js `>=22.19.0`, Pi `^0.84.0`

## Recommended companions

| Extension                                | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `npm:pi-web-access`                      | Web search, URL fetching, GitHub cloning, PDF/video parsing |
| `npm:@narumitw/pi-usage`                 | Current-account usage for Codex / Copilot / OpenRouter      |
| `npm:@juicesharp/rpiv-ask-user-question` | Multiple-choice questionnaire the model can ask you         |

## Credits

- Rich diffs are adapted from [`MasuRii/pi-tool-display`](https://github.com/MasuRii/pi-tool-display) (MIT). See [`extensions/renderer/tool/diff/ATTRIBUTION.md`](./extensions/renderer/tool/diff/ATTRIBUTION.md).

## License

[MIT](./LICENSE) © minuque
