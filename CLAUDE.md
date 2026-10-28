<!-- 本文件是 AGENTS.md 的镜像副本：AGENTS.md 为源文件，修改 AGENTS.md 后须同步本文件。 -->

# pi-cc-extensions 代理协作约定

本文件是 pi-cc-extensions 项目的代理（agent）协作约定，对本仓库工作的所有编码代理生效。

- 本文件另有镜像副本 `CLAUDE.md`（供 Claude Code 读取）：**AGENTS.md 为源文件**，修改本文件后必须同步更新 `CLAUDE.md`，保持两者内容一致。

## 方案与计划文档管理

- 所有方案、计划、设计文档统一存放在 **`agent/plan/`** 目录。
- 该目录**不提交 git，仅保留在本地**（已加入 `.gitignore`）；不要在其中放置需要提交的文件。
- 方案文件名必须带**三位数编号**前缀，格式：`NNN-描述性名称.md`（短横线连接小写单词），例如 `002-ccstyle-panel-i18n-plan.md`。
- 编号递增分配：创建新方案前先查看目录中编号最大的方案，新文件编号 = 最大编号 + 1；编号一经分配不复用，废弃方案保留原编号。
- 方案内容为中文；如方案内引用了仓库内文件路径，迁移或重命名方案时同步更新引用。

## 常用命令

- `npm test` — 运行全部测试（node --test）
- `npm run lint` — biome 检查
- `npm run typecheck` — tsc --noEmit
- `npm run format` — biome 格式化
- `node scripts/gen-i18n-dict.mjs` — 从 `docs/i18n/*.json` 重新生成面板 i18n 字典（`extensions/config/i18n/{en,zh}.ts`）

## 代码约定

- 缩进用 tab、字符串用双引号、行宽 100（以 `biome.json` 为准）；提交前跑 `npm run lint` 与 `npm run typecheck`。
- 面板（`/ccstyle`）新增设置项时，必须同步补充 `docs/i18n/ccstyle-panel-en.json` 与 `ccstyle-panel-zh.json` 的键（en/zh 键集合一致性与空值由字典完整性测试校验），然后重新生成字典。
- 配置新增字段必须走 `normalizeConfig`（含默认值回落），保证旧配置文件向后兼容。
