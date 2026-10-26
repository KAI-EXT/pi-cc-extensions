import { test } from "node:test";
import assert from "node:assert/strict";
import { initTheme } from "@earendil-works/pi-coding-agent";
import agentSummaryFeature, {
	AGENT_SUMMARY_ENTRY_TYPE,
} from "../extensions/feature/agent-summary/index.ts";
import {
	AgentRunSummary,
	bindAgentSummary,
	classifyTool,
	formatCost,
	formatTokens,
	summaryMarkdown,
	type AgentSummaryData,
} from "../extensions/feature/agent-summary/core.ts";

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

test("classifyTool：bash/read/edit/write/other", () => {
	assert.equal(classifyTool("bash"), "bash");
	assert.equal(classifyTool("powershell"), "bash");
	assert.equal(classifyTool("read"), "read");
	assert.equal(classifyTool("edit"), "edit");
	assert.equal(classifyTool("write"), "write");
	assert.equal(classifyTool("grep"), "other");
	// MCP 风格名不是精确工具名：归 other
	assert.equal(classifyTool("mcp__server__read"), "other");
});

test("formatTokens/formatCost 缩写", () => {
	assert.equal(formatTokens(980), "980");
	assert.equal(formatTokens(12400), "12.4k");
	assert.equal(formatTokens(210345), "210k");
	assert.equal(formatCost(0), "");
	assert.equal(formatCost(0.004), "$0.004");
	assert.equal(formatCost(0.05), "$0.05");
	assert.equal(formatCost(1.8), "$1.80");
});

test("AgentRunSummary：bash/powershell 计数；read/edit/write 按路径去重；other 计数；usage 累计", () => {
	const summary = new AgentRunSummary(1_000);
	summary.recordToolStart("bash", { command: "npm test" });
	summary.recordToolStart("powershell", { command: "Get-ChildItem" });
	summary.recordToolStart("bash", { command: "ls" });
	summary.recordToolStart("read", { path: "a.ts" });
	summary.recordToolStart("read", { path: "a.ts" }); // 去重
	summary.recordToolStart("read", { path: "b.ts" });
	summary.recordToolStart("edit", { file_path: "c.ts" }); // file_path 别名
	summary.recordToolStart("write", { path: "d.ts" });
	summary.recordToolStart("write", { path: "d.ts" }); // 去重
	summary.recordToolStart("grep", { pattern: "x" });
	summary.recordToolResult(true);
	summary.recordToolResult(false);
	summary.recordUsage({ input: 1200, output: 800, cost: { total: 0.004 } });
	summary.recordUsage({ input: 300, output: 200, cost: { total: 0.001 } });
	summary.recordUsage(null); // 缺 usage 时安全跳过
	summary.recordUsage({}); // 全可选字段

	assert.equal(summary.toolCount, 10);
	const data = summary.snapshot(61_000);
	assert.deepEqual(data, {
		commands: 3,
		reads: 2,
		edits: 1,
		writes: 1,
		others: 1,
		failed: 1,
		durationMs: 60_000,
		inputTokens: 1500,
		outputTokens: 1000,
		cost: 0.005,
	} satisfies AgentSummaryData);
});

test("summaryMarkdown：emoji 分段风", () => {
	const data: AgentSummaryData = {
		commands: 3,
		reads: 2,
		edits: 1,
		writes: 1,
		others: 0,
		failed: 0,
		durationMs: 42_000,
		inputTokens: 12400,
		outputTokens: 3100,
		cost: 0.05,
	};
	assert.equal(
		summaryMarkdown(data),
		"> *⚡ 42s · ↑12.4k ↓3.1k tok · 🔧 bash×3 edit×1 read×2 write×1 · 💰 $0.05*",
	);
	// 有失败：追加 ✗N
	assert.match(
		summaryMarkdown({ ...data, failed: 2 }),
		/· ✗2\*$/,
	);
	// 无工具无 token 无成本：只剩耗时
	assert.equal(
		summaryMarkdown({
			...data,
			commands: 0,
			reads: 0,
			edits: 0,
			writes: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
		}),
		"> *⚡ 42s*",
	);
	// 全空：不渲染
	assert.equal(
		summaryMarkdown({
			commands: 0,
			reads: 0,
			edits: 0,
			writes: 0,
			others: 0,
			failed: 0,
			durationMs: 0,
			inputTokens: 0,
			outputTokens: 0,
			cost: 0,
		}),
		"",
	);
});

test("bindAgentSummary：agent_start 重置、turn_end 累计 usage、agent_end 回调", async () => {
	const handlers = new Map<string, Function>();
	const fakePi = {
		on: (event: string, handler: Function) => handlers.set(event, handler),
	} as any;

	const calls: AgentSummaryData[] = [];
	bindAgentSummary(fakePi, (data) => calls.push(data));

	// 无工具且无输出：跳过
	await handlers.get("agent_start")!();
	await handlers.get("agent_end")!();
	assert.equal(calls.length, 0);

	// 纯对话轮：无工具但有 token → 回调
	await handlers.get("agent_start")!();
	await handlers.get("turn_end")!({
		message: { role: "assistant", usage: { input: 1200, output: 800, cost: { total: 0.004 } } },
	});
	await handlers.get("agent_end")!();
	assert.equal(calls.length, 1);
	assert.equal(calls[0].inputTokens, 1200);
	assert.equal(calls[0].outputTokens, 800);
	assert.equal(calls[0].cost, 0.004);
	assert.equal(calls[0].commands, 0);

	// 工具轮：非 assistant 消息忽略；usage 跨轮累计；失败计数
	await handlers.get("agent_start")!();
	await handlers.get("turn_end")!({ message: { role: "user" } });
	await handlers.get("turn_end")!({
		message: { role: "assistant", usage: { input: 100, output: 50 } },
	});
	await handlers.get("tool_execution_start")!({ toolName: "bash", args: { command: "ls" } });
	await handlers.get("tool_execution_end")!({ isError: true });
	await handlers.get("turn_end")!({
		message: { role: "assistant", usage: { input: 200, output: 150, cost: { total: 0.001 } } },
	});
	await handlers.get("agent_end")!();
	assert.equal(calls.length, 2);
	assert.deepEqual(calls[1], {
		commands: 1,
		reads: 0,
		edits: 0,
		writes: 0,
		others: 0,
		failed: 1,
		durationMs: calls[1].durationMs,
		inputTokens: 300,
		outputTokens: 200,
		cost: 0.001,
	});
});

test("agent-summary 注册 renderer，agent_end 输出引用块", async () => {
	initTheme("dark");
	const renderers = new Map<string, Function>();
	const appended: unknown[] = [];
	const events = new Map<string, Function>();
	const fakePi = {
		on: (event: string, handler: Function) => events.set(event, handler),
		registerEntryRenderer: (type: string, renderer: Function) => renderers.set(type, renderer),
		appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
	} as any;

	agentSummaryFeature(fakePi);
	assert.ok(renderers.has(AGENT_SUMMARY_ENTRY_TYPE));

	await events.get("agent_start")!();
	await events.get("turn_end")!({
		message: { role: "assistant", usage: { input: 500, output: 300 } },
	});
	await events.get("tool_execution_start")!({ toolName: "read", args: { path: "a.ts" } });
	await events.get("tool_execution_end")!({ isError: false });
	await events.get("tool_execution_start")!({ toolName: "bash", args: { command: "ls" } });
	await events.get("tool_execution_end")!({ isError: false });
	await events.get("agent_end")!();

	assert.equal(appended.length, 1);
	const renderer = renderers.get(AGENT_SUMMARY_ENTRY_TYPE)!;
	const component = renderer(
		{ data: (appended[0] as any).data },
		{ expanded: false },
		{ getFgAnsi: (color: string) => (color === "success" ? "\x1b[32m" : "\x1b[31m") },
	);
	const plain = stripAnsi((component as any).render(120).map(String).join("\n"));
	assert.doesNotMatch(plain, /[┌├└]/);
	assert.doesNotMatch(plain, /TIP/);
	assert.match(plain, /bash×1/);
	assert.match(plain, /read×1/);
	assert.match(plain, /↑500 ↓300 tok/);
	assert.equal(
		renderer(
			{
				data: {
					commands: 0,
					reads: 0,
					edits: 0,
					writes: 0,
					others: 0,
					failed: 0,
					durationMs: 0,
					inputTokens: 0,
					outputTokens: 0,
					cost: 0,
				},
			},
			{ expanded: false },
			{ getFgAnsi: () => "" },
		),
		undefined,
	);
});
