/**
 * Agent 回合摘要：统计一次 agent 运行的工具使用并格式化成摘要文本。
 *
 * 分类：bash / read / edit / write / other（精确工具名；MCP 风格名归 other）。
 * 计数：bash/powershell 按调用次数；read/edit/write 按非空 path/file_path 去重；other 按调用次数。
 * 失败单独累计；另记回合耗时。
 *
 * 呈现：`summaryLine` 纯文本，`summaryMarkdown` Markdown 引用块（无斜体）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatTokenRate } from "../shell/token-rate.ts";
import { tokenSpeedRateAnsi, type TokenSpeedConfig } from "../shell/token-speed-config.ts";
import { formatDuration } from "../../utils/format.ts";

/** 工具分类。 */
export type AgentToolCategory = "bash" | "read" | "edit" | "write" | "other";

/** 一次 agent 回合的统计快照。 */
export type AgentSummaryData = {
	commands: number;
	reads: number;
	edits: number;
	writes: number;
	others: number;
	failed: number;
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	/** 缓存命中读取的 token。 */
	cacheRead: number;
	/** 写入缓存的 token。 */
	cacheWrite: number;
	/** 思考 token（output 子集，provider 上报才有）。 */
	reasoning: number;
	/** 本回合累计成本；模型未配置单价时为 0。 */
	cost: number;
	/** 模型请求轮数。 */
	turns: number;
	/** 最后一轮使用的模型 id。 */
	model: string;
	/** 整段指令平均输出速率（tok/s，与 footer 同源），agent_end 时定格。 */
	tokensPerSec: number;
	/** 回合结束时刻（毫秒时间戳）。 */
	endedAt: number;
};

export function classifyTool(toolName: string): AgentToolCategory {
	const base = toolName.split(".").pop() ?? toolName;
	if (base === "bash" || base === "powershell") return "bash";
	if (base === "read") return "read";
	if (base === "edit") return "edit";
	if (base === "write") return "write";
	return "other";
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function toolPath(args?: Record<string, unknown> | null): string | undefined {
	const path = args?.path ?? args?.file_path;
	return nonEmptyString(path) ? path : undefined;
}

/** turn_end 消息上关注的 usage 字段。 */
export interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	/** 思考 token（output 的子集，provider 上报才有）。 */
	reasoning?: number;
	cost?: { total?: number };
}

/** 摘要渲染配置：段的顺序与开关、分隔符、图标。 */
export interface AgentSummaryViewConfig {
	keys?: readonly string[];
	sep?: string;
	icons?: boolean;
	/** cache-hit 段的 Nerd Font 图标（由调用方按 footerNerdIcons 解析）；空串回退 `hit N%` 文本。 */
	cacheIcon?: string;
	/** done 段是否带日期（`done 03-12 19:24`）；false 只显示 `done 19:24`。 */
	doneDate?: boolean;
	/** 整行斜体（markdown *…*）；false 直体。 */
	italic?: boolean;
	/** 传入时 rate 段数字按 tokenSpeed 四档真彩着色（与 footer 芯片共用取档函数）；缺省不着色。 */
	tokenSpeed?: TokenSpeedConfig;
}

/** 从全局 config 取出的完整摘要配置（含显示阈值）。 */
export interface AgentSummaryFeatureConfig extends AgentSummaryViewConfig {
	minTools: number;
}

/** 累积一次 agent 回合的工具统计；agent_start 时新建实例。 */
export class AgentRunSummary {
	toolCount = 0;
	commandCount = 0;
	readFiles = new Set<string>();
	editFiles = new Set<string>();
	writeFiles = new Set<string>();
	otherCount = 0;
	failedCount = 0;
	inputTokens = 0;
	outputTokens = 0;
	cacheReadTokens = 0;
	cacheWriteTokens = 0;
	reasoningTokens = 0;
	cost = 0;
	turns = 0;
	model = "";

	readonly startedAt: number;

	constructor(startedAt = Date.now()) {
		this.startedAt = startedAt;
	}

	/** tool_execution_start 时调用。 */
	recordToolStart(toolName: string, args?: Record<string, unknown> | null): void {
		this.toolCount++;
		const path = toolPath(args);
		switch (classifyTool(toolName)) {
			case "bash":
				this.commandCount++;
				break;
			case "read":
				if (path) this.readFiles.add(path);
				break;
			case "edit":
				if (path) this.editFiles.add(path);
				break;
			case "write":
				if (path) this.writeFiles.add(path);
				break;
			default:
				this.otherCount++;
		}
	}

	/** tool_execution_end 时调用；isError 为 true 计入失败。 */
	recordToolResult(isError: boolean): void {
		if (isError) this.failedCount++;
	}

	/** turn_end 时调用；累加该轮 assistant 消息的 usage，并记录轮数与模型。 */
	recordUsage(usage?: UsageLike | null, model?: string): void {
		this.turns++;
		if (model) this.model = model;
		if (!usage) return;
		this.inputTokens += usage.input ?? 0;
		this.outputTokens += usage.output ?? 0;
		this.cacheReadTokens += usage.cacheRead ?? 0;
		this.cacheWriteTokens += usage.cacheWrite ?? 0;
		this.reasoningTokens += usage.reasoning ?? 0;
		this.cost += usage.cost?.total ?? 0;
	}

	snapshot(now = Date.now()): AgentSummaryData {
		return {
			commands: this.commandCount,
			reads: this.readFiles.size,
			edits: this.editFiles.size,
			writes: this.writeFiles.size,
			others: this.otherCount,
			failed: this.failedCount,
			durationMs: now - this.startedAt,
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
			cacheRead: this.cacheReadTokens,
			cacheWrite: this.cacheWriteTokens,
			reasoning: this.reasoningTokens,
			cost: this.cost,
			turns: this.turns,
			model: this.model,
			tokensPerSec: 0,
			endedAt: now,
		};
	}
}

/** token 数缩写：980 → "980"，12.4k → "12.4k"，210345 → "210k"（去尾零）。 */
export function formatTokens(count: number): string {
	if (count >= 100_000) return `${Math.round(count / 1000)}k`;
	if (count >= 1000) return `${parseFloat((count / 1000).toFixed(1))}k`;
	return String(count);
}

/** 成本缩写：<0.01 保留有效数字（去尾零），其余 2 位小数。 */
export function formatCost(cost: number): string {
	if (cost <= 0) return "";
	if (cost < 0.01) return `$${parseFloat(cost.toFixed(4))}`;
	return `$${cost.toFixed(2)}`;
}

/** emoji 分段风输出；段顺序由 options.keys 决定，缺省段自动省略。 */
function summaryParts(data: AgentSummaryData, options: AgentSummaryViewConfig): string[] {
	const icons = options.icons !== false;
	const parts: string[] = [];
	const duration = formatDuration(data.durationMs);
	for (const key of options.keys ?? DEFAULT_SUMMARY_KEYS) {
		switch (key) {
			case "duration":
				if (duration) parts.push(icons ? `⚡ ${duration}` : duration);
				break;
			case "tokens":
				if (data.inputTokens || data.outputTokens) {
					parts.push(`↑${formatTokens(data.inputTokens)} ↓${formatTokens(data.outputTokens)} tok`);
				}
				break;
			case "cache":
				// ↗ = 写入缓存（上传），↘ = 缓存命中（下载使用）
				if (data.cacheRead || data.cacheWrite) {
					parts.push(`↗${formatTokens(data.cacheWrite)} ↘${formatTokens(data.cacheRead)} cache`);
				}
				break;
			case "cache-hit": {
				// 命中率与 footer 芯片同算法：cacheRead / (input + cacheWrite + cacheRead)，回合累计值
				const denom = data.inputTokens + data.cacheWrite + data.cacheRead;
				if (!denom) break;
				const pct = `${Math.floor((data.cacheRead * 100) / denom)}%`;
				const glyph = icons ? (options.cacheIcon ?? "") : "";
				parts.push(glyph ? `${glyph} ${pct}` : `hit ${pct}`);
				break;
			}
			case "reasoning":
				if (data.reasoning)
					parts.push(
						icons ? `🧠 ${formatTokens(data.reasoning)}` : `think ${formatTokens(data.reasoning)}`,
					);
				break;
			case "turns":
				if (data.turns) parts.push(icons ? `󰑓 ${data.turns}` : `${data.turns} turns`);
				break;
			case "tools": {
				const tools: string[] = [];
				if (data.commands) tools.push(`bash×${data.commands}`);
				if (data.edits) tools.push(`edit×${data.edits}`);
				if (data.reads) tools.push(`read×${data.reads}`);
				if (data.writes) tools.push(`write×${data.writes}`);
				if (data.others) tools.push(`other×${data.others}`);
				if (tools.length) parts.push(icons ? `⛏ ${tools.join(" ")}` : tools.join(" "));
				break;
			}
			case "cost": {
				const cost = formatCost(data.cost);
				if (cost) parts.push(icons ? `💰 ${cost}` : cost);
				break;
			}
			case "failed":
				if (data.failed) parts.push(`✗${data.failed}`);
				break;
			case "done": {
				// 回合结束时刻（本地时区）；0 = 无效时间戳，省略。
				if (data.endedAt > 0) {
					const d = new Date(data.endedAt);
					const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
					if (options.doneDate) {
						const mm = String(d.getMonth() + 1).padStart(2, "0");
						const dd = String(d.getDate()).padStart(2, "0");
						parts.push(`done ${mm}-${dd} ${hhmm}`);
					} else {
						parts.push(`done ${hhmm}`);
					}
				}
				break;
			}
			case "rate": {
				// 与 footer 同源的整段平均输出速率（agent_end 时定格）；tokenSpeed 存在时数字按四档色。
				if (data.tokensPerSec > 0) {
					const speed = options.tokenSpeed;
					const paint = speed
						? (value: string) => `${tokenSpeedRateAnsi(data.tokensPerSec, speed)}${value}\x1b[0m`
						: undefined;
					parts.push(formatTokenRate(data.tokensPerSec, 0, "average", false, paint));
				}
				break;
			}
			case "model":
				if (data.model) parts.push(icons ? `🤖 ${data.model}` : data.model);
				break;
		}
	}
	return parts;
}

const DEFAULT_SUMMARY_KEYS = ["duration", "tokens", "rate", "cache-hit", "turns", "tools", "done"];

export function summaryMarkdown(
	data: AgentSummaryData,
	colors: { success: string; failed: string } = { success: "", failed: "" },
	options: AgentSummaryViewConfig = {},
): string {
	const parts = summaryParts(data, options);
	if (parts.length === 0) return "";
	// 数字/计数用 success 色，失败段用 failed 色；已自带档色的段（rate）不再二次补色。
	// /g：段内所有数字都要上色（tokens 段的 ↓、tools 各计数、done 的日期时间等）。
	const paintPart = (part: string) => {
		if (part.includes("\x1b[")) return part;
		const code = part.startsWith("✗") ? colors.failed : colors.success;
		if (!code) return part;
		return part.replace(/(\d+(?:\.\d+)?k?)/g, `${code}$1\x1b[0m`);
	};
	const line = parts.map(paintPart).join(options.sep ?? " · ");
	return options.italic ? `> *${line}*` : `> ${line}`;
}

/**
 * 绑定 pi 事件到摘要统计：
 * - agent_start 重置
 * - tool_execution_start / end 累计
 * - turn_end 累加该轮 assistant 消息的 usage（token/缓存/成本）与轮数、模型
 * - agent_end 回调（minTools=0 时无工具但有输出也显示）；速率由 getRate 注入定格
 */
export function bindAgentSummary(
	pi: ExtensionAPI,
	onSummary: (data: AgentSummaryData) => void,
	options: { minTools?: number; getRate?: () => number } = {},
): void {
	const minTools = options.minTools ?? 0;
	let summary = new AgentRunSummary();
	pi.on("agent_start", async () => {
		summary = new AgentRunSummary();
	});
	pi.on("tool_execution_start", async (event) => {
		summary.recordToolStart(event.toolName, event.args);
	});
	pi.on("tool_execution_end", async (event) => {
		summary.recordToolResult(event.isError === true);
	});
	pi.on("turn_end", async (event) => {
		const message = event.message as
			| { role?: string; usage?: UsageLike; model?: string }
			| undefined;
		if (message?.role === "assistant") summary.recordUsage(message.usage, message.model);
	});
	pi.on("agent_end", async () => {
		const meetsMin = summary.toolCount >= minTools;
		const hasContent = minTools > 0 || summary.toolCount > 0 || summary.outputTokens > 0;
		if (meetsMin && hasContent) {
			const snap = summary.snapshot();
			// 定格速率存进条目：持久化条目重渲染时不依赖全局状态。
			snap.tokensPerSec = options.getRate?.() ?? 0;
			onSummary(snap);
		}
	});
}
