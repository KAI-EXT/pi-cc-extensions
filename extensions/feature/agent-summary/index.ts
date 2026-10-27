/**
 * Agent 回合摘要展示：agent_end 时把本回合工具统计写入会话条目，
 * 由 entry renderer 渲染为 markdown 引用块 `> [!TIP] *斜体内容*`。
 *
 * 统计复用 ./core.ts（bash|powershell/read/edit/write/other）。
 * 段顺序/分隔符/图标由 `~/.pi/agent/pi-cc-extensions.json` 的
 * `agentSummaryKeys` / `agentSummarySep` / `agentSummaryIcons` / `agentSummaryMinTools` 控制。
 *
 * appendEntry 不进 LLM 上下文，只显示在聊天区。
 * 引用块文字色取主题 mdQuote（cc 主题下为 muted 灰）。
 */

import { Markdown } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { config, getAgentSummaryConfig } from "../../config/config.ts";
import { footerGlyphs } from "../shell/footer.ts";
import { currentTokenRate } from "../shell/token-rate.ts";
import { bindAgentSummary, summaryMarkdown, type AgentSummaryData } from "./core.ts";

export const AGENT_SUMMARY_ENTRY_TYPE = "agent-summary";

export default function (pi: ExtensionAPI): void {
	pi.registerEntryRenderer(AGENT_SUMMARY_ENTRY_TYPE, (entry, _options, theme) => {
		// 渲染时读配置：/ccstyle 面板或配置文件改完立即生效。
		const { keys, sep, icons, doneDate, italic } = getAgentSummaryConfig(config);
		const line = summaryMarkdown(
			entry.data as AgentSummaryData,
			{
				success: theme.getFgAnsi("success"),
				failed: theme.getFgAnsi("error"),
			},
			{
				keys,
				sep,
				icons,
				doneDate,
				italic,
				cacheIcon: footerGlyphs(config.footerNerdIcons).cache,
				tokenSpeed: config.tokenSpeed,
			},
		);
		if (!line) return undefined;
		// pi-tui 对引用块的渲染硬编码整行 italic（markdown.js blockquote: theme.quote(theme.italic(text))），
		// 连 Nerd Font 图标一起斜。italic 配置为 false（默认）时注入恒等 italic 的主题包装：
		// 保留引用块竖线/灰底视觉，去掉斜体；italic: true 时走原样斜体。
		const baseTheme = getMarkdownTheme();
		const mdTheme = italic
			? baseTheme
			: Object.assign(Object.create(baseTheme), { italic: (text: string) => text });
		return new Markdown(line, 1, 0, mdTheme);
	});

	const { minTools } = getAgentSummaryConfig(config);
	bindAgentSummary(
		pi,
		(data) => {
			pi.appendEntry(AGENT_SUMMARY_ENTRY_TYPE, data);
		},
		{ minTools, getRate: () => currentTokenRate() },
	);
}
