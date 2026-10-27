# tokenSpeed 使用指南

> 输出速率（tokens-per-second）的测量与可视化配置，功能源自 [pi-token-speed](https://github.com/gsanhueza/pi-token-speed)（MIT）的融合移植。
> 配置位置：`~/.pi/agent/pi-cc-extensions.json` 的 `tokenSpeed` 段。所有字段均可省略。

---

## 它是什么

pi 在流式生成回复时，`tokenSpeed` 负责**测量并展示生成速度**：

- **实时速率**：滑动窗口算法（默认 1 秒窗口），带 burst/stall 防假读数——provider 攒批输出时不会闪出 `5000 tok/s` 这种假值
- **速度分级**：按阈值把速率分为四档，数字染对应颜色，快慢一眼可辨
- **多种形态**：从纯速率到「速率 + token 数 + 耗时 + TTFT」的完整面板

**显示位置**（两处，均需满足条件）：

| 位置 | 前提 |
|---|---|
| 底部状态栏 rate 芯片 | `footerLine1Keys`（或 `footerLine2/3Keys`）中包含 `"rate"`，且 `footerTokenRate: true` |
| 回合摘要行 `rate` 段 | `agentSummaryKeys` 中包含 `"rate"` |

两处都**只在模型流式输出过之后**才有数值——刚开会话没有速率数据时芯片/段落自动隐藏。

**生效方式**：改完配置保存，在 pi 里执行 `/reload`（渲染时实时读配置，无需重启）。
**校验原则**：字段级非法逐项回落默认；仅 `thresholds` 是整块校验（任一非法整块回落）。

---

## 快速开始

什么都不配也能用：默认四档色已开启，`footerLine*Keys` 里有 `"rate"` 即可看到着色的速率。

最小自定义示例——把速率提到青色档的门槛、换一个图标：

```jsonc
{
  "tokenSpeed": {
    "icon": "⚡",
    "thresholds": { "slow": 0, "medium": 20, "fast": 40, "blazing": 60 }
  }
}
```

---

## 参数说明

### `thresholds` — 速度分档阈值

| 档位 | 默认阈值 | 默认颜色 | 含义 |
|---|---|---|---|
| `slow` | `0` | `#ff4444` 红 | 低于此值按 slow 计 |
| `medium` | `15` | `#ffaa00` 橙 | ≥ medium 且 < fast |
| `fast` | `30` | `#00ff88` 绿 | ≥ fast 且 < blazing |
| `blazing` | `45` | `#44ddff` 青 | ≥ blazing |

校验规则：四个值必须为**非负整数且严格升序**（slow < medium < fast < blazing）。任一非法时**整块回落默认**——不做部分合并，避免出现 `15 < 15` 这类退化分档。

### `colors` — 四档颜色

hex 格式（`#RRGGBB`），**逐色校验**：写错的那个色回落默认，其余生效。当前版本不支持关闭着色（四档色默认生效，已拍板）；不想用彩色可把四色都设为主题近似色。

### `display` — 芯片形态

| 值 | 效果示例 |
|---|---|
| `legacy`（默认） | 沿用现有格式：`25 tok/s`（live 模式为 `live 30 tok/s`，由顶层 `footerTokenRateMode` 决定；`footerTokenRateTtft` 控制是否带 TTFT） |
| `tps` | `25 tok/s` |
| `ttft` | `25 tok/s (TTFT: 450ms)` |
| `stats` | `25 tok/s (150 tok in 6.0s)` |
| `full` | `25 tok/s (150 tok in 6.0s · TTFT: 450ms)` |

> 非法值回落 `legacy`。速率 ≥ 1000 自动缩写（`1.2k tok/s`）。

### `displayColors` — 后缀分色（仅非 `legacy` 模式生效）

给括号内的三段独立上色，**缺省不上色**：

```jsonc
"displayColors": {
  "count": "#00ff88",    // 「150 tok」段
  "elapsed": "#ffaa00",  // 「6.0s」段
  "ttft": "#44ddff"      // 「TTFT: 450ms」段
}
```

与 `colors` 相互独立，可同时使用。

### `icon` — 芯片图标

- `""`（默认）：跟随 `footerNerdIcons` 的默认行为（无图标）
- 设为任意字符串即作为芯片前缀：`"icon": "⚡"` → `⚡ 25 tok/s`

### `countStrategy` — token 计数方式

| 值 | 行为 |
|---|---|
| `estimate`（默认） | 按流式增量文本估算（CJK 每字 1 token，其余 4 字符 ≈ 1 token），provider 上报值会覆盖估算 |
| `direct` | 每个流式增量计 1 token——流式小块切割细碎的服务器下数字更稳定，但对 CJK 有偏差 |

### `endTpsBehavior` — 流结束后的显示值

| 值 | 行为 |
|---|---|
| `average`（默认） | 定格为整段平均（总 token ÷ 总耗时） |
| `last` | 定格为流结束时最后一个滑动窗口读数（看收尾速度） |

### `slidingWindow` — 滑动窗口（毫秒）

`live` 模式瞬时速率的计算窗口。范围 **100–30000**（30 秒硬顶），越大约平滑、越小的响应越快：

| 服务器速度 | 推荐窗口 |
|---|---|
| 快（30+ tok/s） | `1000`（默认） |
| 中（5–30 tok/s） | `1000`–`3000` |
| 慢（< 5 tok/s） | `5000`–`15000` |

例：服务器约 1 tok/s 时配 `"slidingWindow": 10000`，窗口内才有足够样本。

### `formatDuration` — 时长人类可读化

`stats`/`full` 模式下耗时的显示格式：

| 实际耗时 | `false`（默认） | `true` |
|---|---|---|
| 45.7s | `45.7s` | `45.7s` |
| 92.3s | `92.3s` | `1m 32.3s` |
| 7325s | `7325.0s` | `2h 2m` |

### `updateInterval` — 已失效的保留键

**不生效**。已实测验证 pi TUI 渲染管线自带合帧（`requestRender` 去重 + 16ms 帧节流），流式期间多次刷新自动合并为一帧，无需扩展层再做节流。键位保留只为兼容旧配置不报错，写了也会被忽略。

### `providerOverrides` — 按 provider 覆盖

不同 provider 的速度与计数行为差异很大，可为每个 provider 单独覆盖一块配置（覆盖规则见下）：

```jsonc
"providerOverrides": {
  "anthropic": {
    "thresholds": { "slow": 0, "medium": 30, "fast": 60, "blazing": 90 },
    "slidingWindow": 3000,
    "display": "full"
  },
  "openai": { "display": "tps" }
}
```

- 键 = 活动模型的 `provider` 精确串（如 `anthropic`、`openai`、`magpie`）
- 匹配时与 base 配置**深合并**：`thresholds` 整块覆盖（保持升序校验语义）、`colors`/`displayColors` 逐色合并、其余字段单值覆盖
- 未匹配任何键时走 base
- `updateInterval` 不开放覆盖

---

## 效果案例

以下示例基于默认阈值与颜色，假设一轮回合：150 token、6.0 秒、TTFT 450ms、平均速率 25 tok/s（medium 档）。

### 案例 1：默认配置（`display: "legacy"`）

```
│ ⚡ 9m55s · ↑12.4k ↓3.1k tok · ↗45k ↘210k cache · 󰆼 78% · 25 tok/s · ⛏ bash×3 · done 19:24
```

底部状态栏芯片：`25 tok/s`（25 落在 medium 档 → 数字橙色 `#ffaa00`）。

### 案例 2：`"display": "full"` + `displayColors` 三色

```jsonc
{ "display": "full", "displayColors": { "count": "#00ff88", "elapsed": "#ffaa00", "ttft": "#44ddff" } }
```

```
│ … · 25 tok/s (150 tok in 6.0s · TTFT: 450ms) · …
```

其中速率数字 25 为橙色（medium 档），`150 tok` 绿色、`6.0s` 橙色、`TTFT: 450ms` 青色。

### 案例 3：快速服务器 + 高阈值

```jsonc
{
  "thresholds": { "slow": 0, "medium": 30, "fast": 60, "blazing": 90 },
  "display": "tps", "icon": "🚀"
}
```

速率 50 tok/s → 落在 medium 档 → 状态栏显示 `🚀 50 tok/s`（橙色）。同样的速率在默认阈值下是 fast 档（绿色）——阈值要按你实际的服务器速度定。

### 案例 4：慢服务器调大窗口

```jsonc
{ "slidingWindow": 10000, "endTpsBehavior": "last", "display": "tps" }
```

服务器约 1 tok/s 时，10 秒窗口攒够样本，`live` 读数稳定在 `1 tok/s` 附近；流结束后定格在最后一个窗口值而非整段平均。

### 案例 5：providerOverrides 差异化

```jsonc
{
  "display": "tps",
  "providerOverrides": {
    "anthropic": { "display": "full", "thresholds": { "slow": 0, "medium": 30, "fast": 60, "blazing": 90 } }
  }
}
```

用 GLM（magpie）时芯片是简洁的 `42 tok/s`；切到 Anthropic 模型自动变成完整面板且阈值放宽（其流式速度通常更高）。

---

## 常见问题

**Q：芯片完全不显示？**
按序检查：① `footerLine*Keys` 是否包含 `"rate"`；② `footerTokenRate` 是否为 `true`；③ 是否已经有过一轮流式输出（无数据时隐藏）。

**Q：为什么我的速率是灰色/没有颜色？**
① 检查 `tokenSpeed.colors` 是否被改成了主题近似色；② agentSummary 的 `rate` 段着色需要渲染主题支持 truecolor（终端 24 位色）。
另：当前版本没有"关闭着色"的开关（`colors: null` 无效，会回落默认四档色）。

**Q：`display` 改了没变化？**
`"display": "legacy"` 时外观由顶层 `footerTokenRateMode` / `footerTokenRateTtft` 控制（刻意保持零破坏）。要看新形态请设为 `tps`/`ttft`/`stats`/`full` 之一，然后 `/reload`。

**Q：与顶层 `footerTokenRate*` 什么关系？**
分工：顶层三键管「开关、average/live 模式、TTFT 开关」（legacy 形态的既有行为）；`tokenSpeed` 段管「增强能力」（四档色、新形态、计数策略、滑动窗口、provider 覆盖）。两者同时生效。

**Q：`updateInterval` 写了没效果？**
见参数说明——该键已失效保留（pi 渲染管线已合帧，无需扩展层节流）。

---

## 参数速查表

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `thresholds` | object | `0/15/30/45` | 四档阈值，非负整数严格升序，整块校验 |
| `colors` | object \| null | 四档默认色 | 档位颜色，hex 逐色校验；`null` 关闭着色 |
| `display` | enum | `"legacy"` | `legacy`/`tps`/`ttft`/`stats`/`full` |
| `displayColors` | object | `{}` | 后缀三段分色（count/elapsed/ttft），非 legacy 生效 |
| `icon` | string | `""` | 芯片前缀图标，空 = 跟随默认 |
| `countStrategy` | enum | `"estimate"` | `estimate` 估算 / `direct` 每 delta 1 token |
| `endTpsBehavior` | enum | `"average"` | 流结束定格：整段平均 / 最后窗口值 |
| `slidingWindow` | number | `1000` | live 窗口毫秒，100–30000 |
| `updateInterval` | number | `0` | **已失效保留键**（pi 已合帧） |
| `formatDuration` | boolean | `false` | 耗时人类可读化（`1m 32.3s`） |
| `providerOverrides` | object | `{}` | 按 provider 精确串覆盖子集 |
