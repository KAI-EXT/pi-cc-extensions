# pi-token-speed → pi-cc-extensions 合并规划

> 来源项目：<https://github.com/gsanhueza/pi-token-speed>（42 ⭐ · TypeScript · MIT）
> 目标：将其实时 TPS 能力移植进 pi-cc-extensions，配置统一融合进 `~/.pi/agent/pi-cc-extensions.json`。

---

## 1. pi-token-speed 功能结构

```
pi-token-speed (src/)
├── index.ts                 # 入口：注册 /tps 命令 + 5 个事件钩子
│                           #   (session_start / session_shutdown / message_start /
│                           #    message_update / agent_end)
├── commands/                # ── 命令层 ──
│   ├── index.ts             #   CommandManager：/tps、/tps overrides
│   ├── settings-handler.ts  #   交互式设置菜单（TUI）
│   └── overrides-handler.ts #   per-provider 覆盖管理
├── config/                  # ── 配置层 ──（读 settings.json 的 tokenSpeed 段）
│   ├── types.ts             #   TokenSpeedConfig 类型
│   ├── settings.ts          #   createSettings()
│   ├── settings-validator.ts#   校验（阈值升序、hex 颜色、枚举）
│   ├── settings-storage.ts  #   持久化
│   └── constants.ts
├── core/                    # ── 核心引擎 ──
│   ├── engine.ts            #   TokenSpeedEngine：TPS/TTFT/总 token/计时暂停
│   ├── events.ts            #   EventManager：pi 事件 → 引擎
│   ├── sliding-window.ts    #   滑动窗口：burst/stall 处理、100ms 最小跨度
│   └── message-handler*.ts  #   delta 采集（text/thinking/toolcall）
├── settings/                # ── /tps 菜单 TUI 组件 ──
│   └── items/(colors|display-colors|thresholds)
└── ui/renderer.ts           # ── 状态栏渲染 ──（显示模式、颜色分级、图标）
```

### 功能清单

| # | 功能 | 说明 |
|---|------|------|
| F1 | 实时 TPS | 滑动窗口计算，窗口可配（默认 1s，慢服务器可到 15s） |
| F2 | Burst/Stall 处理 | 整批 flush 时把时间跨度向前扩展，避免 5000 tok/s 假读数 |
| F3 | TTFT | 用户消息 → 首个内容块（text/thinking/toolcall）的延迟 |
| F4 | 速度分级着色 | 4 档（slow/medium/fast/blazing），阈值与颜色均可配 |
| F5 | 显示模式 | `tps` / `ttft` / `stats`（token 数+耗时）/ `full` |
| F6 | 图标 | ⚡ 🔥 💨 🚀 / 自定义 / 无 |
| F7 | 更新节流 | `updateInterval`（0/50/100/200/500ms），只节流渲染不影响计算 |
| F8 | token 计数策略 | `direct`（1 delta=1 token）/ `estimate`（按文本估算）；可选 provider 上报值 |
| F9 | 流结束行为 | `average`（整段平均）/ `last`（最后窗口值） |
| F10 | 时长格式化 | `92.3s → 1m 32.3s`、`7325s → 2h 2m` |
| F11 | per-provider 覆盖 | 按 provider（anthropic/openai/…）覆盖整块配置 |
| F12 | `/tps` 交互菜单 | TUI 设置菜单 + 颜色选择器 + 阈值编辑器 + 覆盖管理 |

---

## 2. 与 pi-cc-extensions 现状对比

pi-cc-extensions 已有一套**同功能的简化版**：`extensions/feature/shell/token-rate.ts`
（working-message 采集、footer `rate` 芯片显示、`agentSummary` 的 `rate` 段消费）。

| 能力 | pi-token-speed | pi-cc-extensions 现状 | 结论 |
|---|---|---|---|
| 平均速率（average） | ✅ | ✅ `currentTokenRate()` | 保留现有 |
| 瞬时速率（live/滑动窗口） | ✅ 可配窗口 + burst/stall | ⚠️ 固定 1s 窗口，无 burst/stall | **移植增强** |
| TTFT | ✅ | ✅ `currentTtftMs()` | 保留现有 |
| 速度分级着色 | ✅ 4 档可配 | ❌ | **移植** |
| 显示模式/图标 | ✅ | ❌ 芯片格式固定 | **移植** |
| 更新节流 | ✅ | ❌ 每 delta 渲染 | **移植** |
| 计数策略 direct/estimate | ✅ | ⚠️ 仅 estimate | **移植** |
| 流结束行为 average/last | ✅ | ⚠️ 定格为平均 | **移植** |
| 时长格式化 | ✅ | ✅ `formatDuration()`（utils） | 保留现有 |
| provider 覆盖 | ✅ | ❌ | 后置（P3） |
| /tps 交互菜单 | ✅ | ❌（有 /ccstyle 面板体系） | 后置（P3，并入 /ccstyle） |

**关键重叠结论**：两边的采集管线（delta 采样、provider usage 覆盖、工具暂停）几乎等价，
不该两套并存——以 pi-cc-extensions 的 `token-rate.ts` 为基座，**吸收** pi-token-speed 的
滑动窗口算法与渲染能力。

---

## 3. 合并策略：增量融合（不做双轨）

```
pi-token-speed                    pi-cc-extensions（合并后）
─────────────────                 ─────────────────────────────────────────
config/settings.json              ~/.pi/agent/pi-cc-extensions.json
  └─ "tokenSpeed": {...}    ──►     └─ "tokenSpeed": {...}   ← P1 配置融合
core/sliding-window.ts     ──►   feature/shell/token-rate.ts  ← P2 引擎吸收
core/engine.ts（部分）      ──►     （burst/stall、countStrategy、
                                    endTpsBehavior 并入现有状态机）
ui/renderer.ts             ──►   footer rate 芯片 + agentSummary rate 段
                                    （分级着色、显示模式、图标、节流）← P3
settings/（/tps 菜单）      ──►   后置：并入 /ccstyle 面板 Footer 页签 ← P4
commands//tps               ──►   后置（同上）
```

**不做的事**：不保留独立 `/tps` 命令与独立配置段 `settings.json#tokenSpeed`；
不移植其 settings TUI 框架（pi-cc-extensions 已有 `/ccstyle` 面板体系）。

### 融合后的配置 schema（`pi-cc-extensions.json` 新增段）

```jsonc
{
  // ── 现有 footer 速率配置保留，语义不变 ──
  "footerTokenRate": true,           // 速率芯片开关
  "footerTokenRateMode": "average",  // average / live
  "footerTokenRateTtft": true,

  // ── 新增：tokenSpeed（来自 pi-token-speed）──
  "tokenSpeed": {
    "thresholds": { "slow": 0, "medium": 15, "fast": 30, "blazing": 45 },
    "colors": {
      "slow": "#ff4444", "medium": "#ffaa00",
      "fast": "#00ff88", "blazing": "#44ddff"
    },
    "icon": "",                // "" = 跟随 footerNerdIcons 默认；可设 ⚡/🔥/🚀 等
    "countStrategy": "estimate",   // estimate（现有行为）/ direct（1 delta=1 token；CJK 下失真，自担）
    "endTpsBehavior": "average",   // average / last
    "slidingWindow": 1000,         // ms；live 模式窗口，硬顶 30s 防呆
    "updateInterval": 0,           // 渲染节流 ms；实施前先验证 pi 渲染管线是否已合帧
    "formatDuration": false
    // display / displayColors / providerOverrides → P3/P4 再放开
  }
}
```

### 拍板记录（grill-me 盘问结论，2026-10-27）

| 议题 | 决议 |
|---|---|
| 颜色分级默认 | **默认开启四档色**（视觉优先，接受与 cc 主题 dim 风格的差异）；`colors: null` 预留为关闭开关 |
| `countStrategy: "direct"` | **保留**（明知 CJK 失真，做成可选即为自担） |
| `endTpsBehavior: "last"` | **保留** |
| `updateInterval` | **先验证** pi TUI 渲染管线是否已合帧，已合帧则砍掉该选项 |
| 配置归位 | `footerTokenRate*` 留顶层，`tokenSpeed` 子段只放新增项，保持分裂 |
| 移植归属 | token-rate.ts 头注释 + `docs/ATTRIBUTION` 注明 pi-token-speed（MIT） |
| 滑动窗口 | 样本按 `slidingWindow` 动态裁剪，30s 硬顶；`now` 保持参数注入可测 |

> 兼容性约束（2026-10-27 拍板修订）：配置 schema 兼容、结构零破坏；**颜色分级默认开启**
> （照搬 pi-token-speed 四档色），即视觉行为有默认变化——接受。想回到纯主题色可设
> `tokenSpeed.colors: null`（后续实现）。

---

## 4. 分阶段任务计划

### P1 配置融合（低风险，先行）
- [ ] config.ts：`Config` 增加 `tokenSpeed: TokenSpeedConfig`；`DEFAULT_CONFIG` 给默认块
- [ ] 新建 `extensions/feature/shell/token-speed-config.ts`：类型 + 校验
      （阈值升序、hex 颜色、枚举、窗口/节流范围），`normalizeConfig` 深合并
- [ ] README 配置示例同步
- 验收：非法值回落默认；`formatConfigStatus` 可见；注意默认四档色生效后芯片颜色即变（已拍板接受）

### P2 引擎吸收（核心）
- [ ] `token-rate.ts`：live 通道改滑动窗口实现（移植 burst/stall + 100ms clamp）
- [ ] `countStrategy: "direct"` 支持（现有 estimate 保留为默认）
- [ ] `endTpsBehavior: "last"`：`displayTokenRate("live")` 流结束后可返回最后窗口值
- [ ] 回归：`currentTokenRate()` / `currentTtftMs()` 接口不变；
      agent-summary `rate` 段、working-message 采集不受影响
- 验收：现有 token-rate 相关测试全绿 + 新增滑动窗口单测（含 stall 场景）

### P3 渲染增强
- [ ] footer rate 芯片：按 `tokenSpeed.colors` 分级着色（阈值 → 颜色）
- [ ] `icon` 支持；`updateInterval` 节流渲染（前置任务：验证 pi 渲染管线已合帧则砍）
- [ ] agentSummary `rate` 段：可选沿用同一分级着色（复用同一取色函数）
- [ ] `formatDuration` 接入耗时显示（若开放 stats 模式）
- 验收：`tokenSpeed` 缺省时芯片外观与现在一致

### P4 后置（本次不做）
- [ ] `display` / `displayColors` 模式族
- [ ] `providerOverrides`（按 provider 覆盖块）
- [ ] `/ccstyle` Footer 页签加 tokenSpeed 可视化编辑

---

## 5. 风险与边界

| 风险 | 缓解 |
|---|---|
| token-rate.ts 是 working-message 与 footer 的共享状态机，改坏影响面大 | P2 保持对外函数签名不变；现有单测全量回归 |
| live 窗口算法替换可能改变 footer 数值口径 | 新旧实现并跑对比测试（同一采样序列喂两版，断言差值 < ε） |
| 颜色分级与 cc 主题冲突 | 颜色默认值仅在 `tokenSpeed` 段出现时生效；遵循主题色优先原则可加 `colors: null` 表示关闭 |
| pi-token-speed 的 burst/stall 依赖逐 delta 时间戳，现有采样窗口只存 1s | 窗口长度参数化，采样数组按 `slidingWindow` 保留 |
| providerOverrides 与 magpie/自定义 provider 的 id 匹配歧义 | P4 再做，键匹配用 `ctx.model.provider` 精确串 |

---

## 6. 参考

- 来源 README：<https://github.com/gsanhueza/pi-token-speed#readme>
- 本项目现有实现：`extensions/feature/shell/token-rate.ts`（模块头注释含完整口径说明）
- 消费方：`footer.ts`（rate 芯片）、`agent-summary`（`rate` 段）、`working-message`（采集）
