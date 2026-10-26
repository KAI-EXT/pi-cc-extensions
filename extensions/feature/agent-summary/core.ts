/**
 * Agent 回合摘要：统计一次 agent 运行的工具使用并格式化成摘要文本。
 *
 * 分类：bash / read / edit / write / other（精确工具名；MCP 风格名归 other）。
 * 计数：bash/powershell 按调用次数；read/edit/write 按非空 path/file_path 去重；other 按调用次数。
 * 失败单独累计；另记回合耗时。
 *
 * 呈现：`summaryLine` 纯文本，`summaryMarkdown` Markdown（可 box 引用块）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
	/** 本回合累计成本；模型未配置单价时为 0。 */
	cost: number;
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
	cost?: { total?: number };
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
	cost = 0;

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

	/** turn_end 时调用；累加该轮 assistant 消息的 usage。 */
	recordUsage(usage?: UsageLike | null): void {
		if (!usage) return;
		this.inputTokens += usage.input ?? 0;
		this.outputTokens += usage.output ?? 0;
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
			cost: this.cost,
		};
	}
}

const plural = (count: number) => (count === 1 ? "" : "s");

/** token 数缩写：980 → "980"，12.4k → "12.4k"，210345 → "210k"。 */
export function formatTokens(count: number): string {
	if (count >= 100_000) return `${Math.round(count / 1000)}k`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}

/** 成本缩写：<0.01 保留有效数字（去尾零），其余 2 位小数。 */
export function formatCost(cost: number): string {
	if (cost <= 0) return "";
	if (cost < 0.01) return `$${parseFloat(cost.toFixed(4))}`;
	return `$${cost.toFixed(2)}`;
}

/** emoji 分段风输出：⚡ 耗时 · ↑输入 ↓输出 tok · 🔧 工具 · 💰 成本 · ✗ 失败。 */
function summaryParts(data: AgentSummaryData): string[] {
	const parts: string[] = [];
	const duration = formatDuration(data.durationMs);
	if (duration) parts.push(`⚡ ${duration}`);
	if (data.inputTokens || data.outputTokens) {
		parts.push(`↑${formatTokens(data.inputTokens)} ↓${formatTokens(data.outputTokens)} tok`);
	}
	const tools: string[] = [];
	if (data.commands) tools.push(`bash×${data.commands}`);
	if (data.edits) tools.push(`edit×${data.edits}`);
	if (data.reads) tools.push(`read×${data.reads}`);
	if (data.writes) tools.push(`write×${data.writes}`);
	if (data.others) tools.push(`other×${data.others}`);
	if (tools.length) parts.push(`🔧 ${tools.join(" ")}`);
	const cost = formatCost(data.cost);
	if (cost) parts.push(`💰 ${cost}`);
	if (data.failed) parts.push(`✗${data.failed}`);
	return parts;
}

export function summaryMarkdown(
	data: AgentSummaryData,
	colors: { success: string; failed: string } = { success: "", failed: "" },
): string {
	const parts = summaryParts(data);
	if (parts.length === 0) return "";
	// 数字/计数用 success 色，失败段用 failed 色。
	const paintPart = (part: string) => {
		const code = part.startsWith("✗") ? colors.failed : colors.success;
		if (!code) return part;
		return part.replace(/(\d+(?:\.\d+)?k?)/, `${code}$1\x1b[0m`);
	};
	const line = parts.map(paintPart).join(" · ");
	return `> *${line}*`;
}

/**
 * 绑定 pi 事件到摘要统计：
 * - agent_start 重置
 * - tool_execution_start / end 累计
 * - turn_end 累加该轮 assistant 消息的 usage（token 与成本）
 * - agent_end 回调（无工具且无输出时跳过）
 */
export function bindAgentSummary(
	pi: ExtensionAPI,
	onSummary: (data: AgentSummaryData) => void,
): void {
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
		const message = event.message as { role?: string; usage?: UsageLike } | undefined;
		if (message?.role === "assistant") summary.recordUsage(message.usage);
	});
	pi.on("agent_end", async () => {
		if (summary.toolCount > 0 || summary.outputTokens > 0) onSummary(summary.snapshot());
	});
}
