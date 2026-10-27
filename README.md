<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

# pi-cc-extensions

> 类 Claude Code TUI 输出风格，并融入了一些个人喜好，和一些实用小功能（无额外内置工具）。

## 界面预览

<a href="https://github.com/user-attachments/assets/6c858000-fdad-43f9-957f-4d0278648498"><img src="./assets/readme/preview.webp" alt="pi-cc-extensions 界面预览" width="100%"></a>

点击封面播放演示视频

## 快速开始

```bash
pi install npm:pi-cc-extensions

# GitHub
pi install git:github.com/minuque/pi-cc-extensions
```

安装后执行 `/reload`

## 功能

| 功能                  | 说明                                                                            | 入口                                            |
| --------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Claude Code UI        | 工具摘要、折叠展开、rich edit/write diff，以及`on` / `compact` / `off` 三种模式 | `/ccstyle`                                      |
| Markdown 增强         | Mermaid 方言渲染、圈数字转半角括号                                                         | 自动生效；`enableMarkdownEnhance: false` 关闭   |
| Fullscreen mode       | 工具卡/group 单击展开与收起、预览、hover 高亮、回到底部按钮                 | `TUIMODE=fullscreen` 或 `--tui-mode fullscreen` |
| 配置面板              | `Style / Features / UI / Diff / Thinking / Footer` 六页签                       | `/ccstyle`                                      |
| 上下文检查            | 查看上下文占用，并预览 System prompt、Memory、Skills、Tools definition 和消息内容 | `/context`                                      |
| Session/Subagent 引用 | 搜索并注入历史 Session 或现有 SubAgent 的有效上下文                             | `@`                                             |
| 状态栏                | 显示：模型、上下文、缓存、费用、git并适配 @narumitw/pi-usage 实时显示额度；git/缓存图标可关 Nerd Font | `/ccstyle`                              |
| 主题                  | 随包提供内置 CC Dark、CC Light 主题                                             | `/settings` → Theme                             |

`on` / `compact` 两种模式的渲染样例：[默认模式](./docs/tool-render-examples-default.md) · [紧凑模式](./docs/tool-render-examples-compact.md)

## 配置

`/ccstyle` 的行为由 `~/.pi/agent/pi-cc-extensions.json` 配置：

```jsonc
{
  // style
  "mode": "on",                            // on / compact / off
  "excludeRenderers": [],                  // 走原生渲染的工具名，匹配忽略大小写；Agent 始终保留专用渲染器

  // features
  "enableSessionReference": true,          // @ session 引用
  "enableSubagentAutocomplete": true,      // @subagent:[name] 补全与委派提示
  "enableContextCommand": true,            // /context 上下文检查
  "enableAgentSummary": true,              // 每回合工具摘要
  "enableWorkingMessage": true,            // Working... 底部 token/耗时
  "enableAliases": true,                   // /clear、/exit 别名
  "enableMarkdownEnhance": true,           // markdown 转换：Mermaid 方言渲染、圈数字转半角括号；false 让位给其他扩展
  "enableEditorPrefix": true,              // 输入框 ❯ 前缀

  // ui
  "expandedInputMaxLines": 5,              // 展开工具卡 Input 可见行数，超出在末行显示展开提示
  "expandedOutputMaxLines": 10,            // 展开工具卡 Output 可见行数，超出在末行显示展开提示
  "expandedPreviewMaxLines": 40,           // 展开 TaskList 正文最大行数（展开 diff 始终全量）
  "toolLabelClip": 0,                      // 工具摘要 path/command 折叠字符数；0 = 按可用宽度
  "showStartupHeader": true,               // 启动头（logo + tips）开关
  "stickyUserMessage": true,               // fullscreen：userMessage 正文首行滚出视口上沿后钉住，直到下一条指令接手
  "scrollButtonMode": "dock",              // fullscreen：dock 独占行 / native Pi 原生浮层

  // diff
  "diffViewMode": "auto",                  // 布局：auto / split / unified
  "diffIndicatorMode": "bars",             // 变更指示：bars / classic / none
  "diffSplitMinWidth": 120,                // 左右分栏的最小终端宽度
  "editDiffCollapsedLines": 24,            // edit 折叠行数；0 仅显示变更统计摘要
  "writeDiffCollapsedLines": 0,            // write 折叠行数，0 仅显示创建摘要
  "diffWordWrap": true,                    // 长 diff 行换行

  // thinking
  "useSummaryTitlesAsThinkingTitle": true, // 用最新摘要作思考标题
  "previewLines": 3,                       // 预览行数，0 隐藏
  "animationIntervalMs": 90,               // 标题动画间隔（毫秒）

  // footer
  "enableCustomFooter": true,              // 自定义状态栏
  "footerTokenRate": true,                 // 输出速率芯片；false 隐藏
  "footerTokenRateMode": "average",        // average：整段指令平均（avg）；live：最近 1 秒瞬时（live）
  "footerTokenRateTtft": true,             // 速率芯片是否带 TTFT；false 只显示 tok/s
  "footerCurrency": "USD",                 // 底栏费用的显示币种
  "footerCurrencyRate": null,              // 1 单位费用换成多少显示币种；null 只换符号、不乘倍率
  "footerNerdIcons": true,                 // git/缓存用 Nerd Font 图标；false 为纯文本
  "footerGitStatsMode": "working",         // working（默认）：未提交改动；branch：分支累计净改动
  "footerHiddenKeys": [],                  // 隐藏的芯片 key
  "footerLine1Keys": ["model", "context", "cache", "rate", "cost", "pi-usage"], // 每行芯片顺序；内置项与插件同一套排布
  "footerLine2Keys": ["cwd", "git"],       // cwd：目录和会话名；git：分支和改动。可换到任意行
  "footerLine3Keys": []                    // 有可见芯片才占行

  // agent-summary（回合摘要行）
  "agentSummaryKeys": ["duration", "tokens", "cache", "cache-hit", "rate", "tools", "cost", "failed", "done"], // 段顺序与开关；可选：duration/tokens/cache/cache-hit/rate/reasoning/turns/model/tools/cost/failed/done
  "agentSummarySep": " · ",                // 段分隔符
  "agentSummaryIcons": true,               // emoji 图标；false 为纯文本
  "agentSummaryMinTools": 0,               // 触发显示的最小工具数；0 = 有任意内容就显示，2 = 恢复旧行为
  "agentSummaryDoneDate": false            // done 段是否带日期：true = "done 03-12 19:24"，false = "done 19:24"
  "agentSummaryItalic": false              // 整行斜体（Claude Code 原版样式）；false 直体
}
```

#### `agentSummaryKeys` 可选段

每回合结束的摘要行按 `agentSummaryKeys` 的顺序渲染；某段没有数据时自动省略，不占位。

| key | 显示效果 | 说明 | 省略条件 |
| --- | --- | --- | --- |
| `duration` | `⚡ 9m55s` | 回合墙钟耗时 | — |
| `tokens` | `↑12.4k ↓3.1k tok` | 输入 / 输出 token | 无 token 上报 |
| `cache` | `↗45k ↘210k cache` | 缓存流量：↗ 写入（上传）、↘ 命中读取（下载） | provider 未上报缓存 |
| `cache-hit` | `󰆼 78%` | 缓存命中率 = 命中 ÷（输入 + 写入 + 命中），回合累计值；与 footer 缓存芯片同图标同算法，`footerNerdIcons: false` 时显示为 `hit 78%` | 无缓存数据 |
| `reasoning` | `🧠 1.8k` | 思考 token（`output` 的子集） | provider 未上报 |
| `turns` | `󰑓 4` | 模型请求轮数 | 0 轮 |
| `model` | `🤖 glm-5.3-flash` | 最后一轮使用的模型 | — |
| `rate` | `avg 42 tok/s` | 整段平均输出速率，与 footer 速率芯片同源；`agent_end` 时定格，会话重放不漂移 | 无速率数据 |
| `tools` | `⛏ bash×19 edit×6 read×4` | bash 按调用计，read/edit/write 按文件去重，其余归 `other×N` | 无工具调用 |
| `cost` | `💰 $0.05` | 本回合累计成本 | 模型未配置单价 |
| `failed` | `✗1` | 失败的工具调用数 | 0 次失败 |
| `done` | `done 19:24` | 回合结束时刻（本地时区 HH:MM） | — |

示例（`agentSummaryIcons: false` 为纯文本模式，emoji 前缀消失）：

```
│ ⚡ 9m55s · ↑12.4k ↓3.1k tok · ↗45k ↘210k cache · 󰆼 78% · avg 42 tok/s · ⛏ bash×19 edit×6 · 💰 $0.05 · ✗1 · done 19:24
```

`agentSummaryMinTools` 控制整行是否出现：`0`（默认）只要回合有工具调用或 token 输出就显示；设为 `2` 恢复旧行为（工具数 ≥ 2 才显示）。

> [!TIP]
> **全屏模式**：展开态 diff 全量显示。Input/Output 超行时末行给 `… +N more lines`，单击看全量，再击收起。

> [!NOTE]
> **Mermaid 渲染**：`markdown.mermaid` 建议设为 `final`（`~/.pi/agent/settings.json` 或 `/settings`）。默认 `streaming` 逐帧重绘，`final` 只渲染最终版。

## 本地开发

```bash
./test.sh            # macOS/Linux，需要 node 和 pi
./test.bat           # Windows，经 Git Bash 运行 test.sh
pi -e .              # 只跑一次，不改 settings.json
```

## 兼容性

- Node.js `>=22.19.0`，Pi `^0.84.0`

## 推荐搭配

| 扩展                                     | 用途                                             |
| ---------------------------------------- | ------------------------------------------------ |
| `npm:pi-web-access`                      | 网页搜索、URL 抓取、GitHub 克隆、PDF/视频解析    |
| `npm:@narumitw/pi-usage`                 | 查看当前账号用量（Codex / Copilot / OpenRouter） |
| `npm:@juicesharp/rpiv-ask-user-question` | 模型拿不准时向你提问的选择题面板                 |

## 致谢

- Rich diff 改编自 [`MasuRii/pi-tool-display`](https://github.com/MasuRii/pi-tool-display)（MIT）；详见 [`extensions/renderer/tool/diff/ATTRIBUTION.md`](./extensions/renderer/tool/diff/ATTRIBUTION.md)。

## 许可证

[MIT](./LICENSE) © minuque
