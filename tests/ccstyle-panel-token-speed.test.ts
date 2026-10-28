import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// 必须在导入 config 之前隔离 agent 目录：updateConfig 会把配置写回磁盘。
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "ccstyle-panel-speed-"));

const { CONFIG_PATH, config, DEFAULT_CONFIG } = await import("../extensions/config/config.ts");
const { initTheme } = await import("@earendil-works/pi-coding-agent");
const { showCcstylePanel } = await import("../extensions/config/panel.ts");
const { AGENT_SUMMARY_KEY_VALUES } = await import("../extensions/config/config.ts");
const { normalizeTokenSpeed } = await import("../extensions/feature/shell/token-speed-config.ts");

// 面板构造 SettingsList 时要取主题；测试不渲染整幅画面，只要求主题已初始化。
initTheme("dark");

type Panel = { handleInput(data: string): void };

const DOWN = "\x1b[B";

/** 页签切换须逐次发键：面板 handleInput 按单键处理，多键串不会循环切换。 */
function sendTabs(panel: Panel, count: number): void {
	for (let i = 0; i < count; i++) panel.handleInput("\t");
}

function fakePanelUi() {
	let panel: Panel | undefined;
	const notices: string[] = [];
	const ui = {
		notify: (message: string) => notices.push(message),
		custom: (
			build: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => Panel,
		) =>
			new Promise<void>((resolve) => {
				const done = () => resolve();
				panel = build({ requestRender: () => {} }, {}, {}, done);
			}),
	};
	return {
		ctx: { mode: "tui", hasUI: true, ui },
		notices,
		get panel(): Panel {
			assert.ok(panel, "panel was never built");
			return panel;
		},
	};
}

const hooks = { applyStyleMode: () => {}, refreshCurrentTranscript: () => {} };

async function openPanel() {
	const slot = fakePanelUi();
	const close = showCcstylePanel(slot.ctx, hooks);
	return { notices: slot.notices, panel: slot.panel, close };
}

/** 页签内行导航：记录当前行，按需发 DOWN（SettingsList 会回绕）。 */
function rowNav(panel: Panel, total: number) {
	let index = 0;
	return (target: number) => {
		const delta = (target - index + total) % total;
		for (let i = 0; i < delta; i++) panel.handleInput(DOWN);
		index = target;
	};
}

/** Token Speed 页签行数（tokenSpeed 配置族 14 行）。 */
const TOKEN_SPEED_ROWS = 14;
/** Features 页签行数：7 条原有 + 3 条 agentSummary。 */
const FEATURE_ROWS = 10;

function resetTokenSpeed(): void {
	config.tokenSpeed = normalizeTokenSpeed(undefined);
}

test("Token Speed 页签 display 行循环写回 config 并持久化", async () => {
	resetTokenSpeed();
	assert.equal(config.tokenSpeed.display, "legacy");
	const { panel, notices, close } = await openPanel();
	sendTabs(panel, 6);
	rowNav(panel, TOKEN_SPEED_ROWS)(0); // Token speed display
	panel.handleInput("\r");
	assert.equal(config.tokenSpeed.display, "tps");
	assert.equal(
		JSON.parse(readFileSync(CONFIG_PATH, "utf8")).tokenSpeed.display,
		"tps",
		"updateConfig 必须落盘",
	);
	// Space 继续循环并回绕到 legacy
	for (const expected of ["ttft", "stats", "full", "legacy"]) {
		panel.handleInput(" ");
		assert.equal(config.tokenSpeed.display, expected);
	}
	panel.handleInput("\x1b");
	await close;
	assert.ok(notices.includes("已更新 tokenSpeedDisplay：tps"));
});

test("Token speed icon 行 none 与图标互转（none ↔ 空串）", async () => {
	resetTokenSpeed();
	const { panel, close } = await openPanel();
	sendTabs(panel, 6);
	rowNav(panel, TOKEN_SPEED_ROWS)(1); // Token speed icon
	panel.handleInput(" ");
	assert.equal(config.tokenSpeed.icon, "🔥");
	// 循环完 🚀 回到 none，配置回空串
	for (let i = 0; i < 3; i++) panel.handleInput(" ");
	assert.equal(config.tokenSpeed.icon, "");
	panel.handleInput("\x1b");
	await close;
});

test("countStrategy / endTpsBehavior / slidingWindow 行循环写回", async () => {
	resetTokenSpeed();
	const { panel, close } = await openPanel();
	sendTabs(panel, 6);
	const nav = rowNav(panel, TOKEN_SPEED_ROWS);
	nav(2); // Token count strategy
	panel.handleInput(" ");
	assert.equal(config.tokenSpeed.countStrategy, "direct");
	nav(3); // End-of-stream TPS
	panel.handleInput(" ");
	assert.equal(config.tokenSpeed.endTpsBehavior, "last");
	nav(4); // Sliding window ms
	panel.handleInput(" ");
	assert.equal(config.tokenSpeed.slidingWindow, 3000);
	panel.handleInput("\x1b");
	await close;
});

test("阈值行预设循环写回并自动收敛保持严格升序", async () => {
	resetTokenSpeed();
	config.tokenSpeed.thresholds = { slow: 10, medium: 20, fast: 30, blazing: 40 };
	const { panel, close } = await openPanel();
	sendTabs(panel, 6);
	const nav = rowNav(panel, TOKEN_SPEED_ROWS);
	nav(8); // Threshold blazing
	panel.handleInput(" "); // 40 → 45
	assert.deepEqual(config.tokenSpeed.thresholds, {
		slow: 10,
		medium: 20,
		fast: 30,
		blazing: 45,
	});
	nav(7); // Threshold fast
	panel.handleInput(" "); // 30 → 40
	panel.handleInput(" "); // → 50
	panel.handleInput(" "); // → 60
	panel.handleInput(" "); // → 20，低于 medium 收敛为 21
	assert.equal(config.tokenSpeed.thresholds.fast, 21);
	nav(5); // Threshold slow
	panel.handleInput(" "); // 10 → 15
	panel.handleInput(" "); // 15 → 20，超过 medium-1 收敛为 19
	assert.equal(config.tokenSpeed.thresholds.slow, 19);
	assert.deepEqual(config.tokenSpeed.thresholds, { slow: 19, medium: 20, fast: 21, blazing: 45 });
	panel.handleInput("\x1b");
	await close;
});

test("颜色行预设循环写回，预设外自定义色从首个预设继续", async () => {
	resetTokenSpeed();
	config.tokenSpeed.colors.medium = "#123abc";
	const { panel, close } = await openPanel();
	sendTabs(panel, 6);
	const nav = rowNav(panel, TOKEN_SPEED_ROWS);
	nav(9); // Slow tier color，默认 #ff4444
	panel.handleInput(" ");
	assert.equal(config.tokenSpeed.colors.slow, "#ff8844");
	nav(10); // Medium tier color，自定义色不在预设里
	panel.handleInput(" ");
	assert.equal(config.tokenSpeed.colors.medium, "#ff4444");
	panel.handleInput("\x1b");
	await close;
});

test("Provider overrides 行只读：Enter/Space 不改配置", async () => {
	resetTokenSpeed();
	config.tokenSpeed.providerOverrides = { openai: { display: "tps", slidingWindow: 2000 } };
	const { panel, close } = await openPanel();
	sendTabs(panel, 6);
	rowNav(panel, TOKEN_SPEED_ROWS)(13); // Provider overrides
	const before = JSON.stringify(config.tokenSpeed.providerOverrides);
	panel.handleInput("\r");
	panel.handleInput(" ");
	assert.equal(JSON.stringify(config.tokenSpeed.providerOverrides), before);
	panel.handleInput("\x1b");
	await close;
});

test("Summary segments 子面板：段开关增删数组并保持顺序", async () => {
	config.agentSummaryKeys = [...DEFAULT_CONFIG.agentSummaryKeys];
	const { panel, close } = await openPanel();
	sendTabs(panel, 1);
	rowNav(panel, FEATURE_ROWS)(4); // Summary segments
	panel.handleInput("\r"); // 开子面板，12 段按 canonical 顺序，选中 0 duration
	panel.handleInput(DOWN); // → tokens
	panel.handleInput("\r"); // 关闭 tokens
	assert.deepEqual(config.agentSummaryKeys, [
		"duration",
		"rate",
		"cache-hit",
		"turns",
		"tools",
		"done",
	]);
	panel.handleInput("\x1b"); // 回 Features
	panel.handleInput("\r"); // 重开子面板（每次新建，选中 0 duration）
	panel.handleInput(DOWN); // → tokens
	panel.handleInput("\r"); // 重新打开 tokens，回到 canonical 位置
	assert.deepEqual(config.agentSummaryKeys, [...DEFAULT_CONFIG.agentSummaryKeys]);
	panel.handleInput("\x1b");
	panel.handleInput("\x1b");
	await close;
	assert.equal(AGENT_SUMMARY_KEY_VALUES.length, 12);
});

test("Summary segments：最后一段拒绝关闭", async () => {
	config.agentSummaryKeys = [...DEFAULT_CONFIG.agentSummaryKeys];
	const { panel, close } = await openPanel();
	sendTabs(panel, 1);
	rowNav(panel, FEATURE_ROWS)(4);
	panel.handleInput("\r"); // 子面板，选中 0 duration
	// 依次关闭 duration(0) rate(2) cache-hit(3) turns(4) tools(5) done(6)，保留 tokens(1)
	const keysOff = [0, 2, 3, 4, 5, 6];
	let current = 0;
	for (const target of keysOff) {
		for (let i = 0; i < target - current; i++) panel.handleInput(DOWN);
		current = target;
		panel.handleInput("\r");
	}
	assert.deepEqual(config.agentSummaryKeys, ["tokens"]);
	// 试图关闭最后一段 tokens（6 → 1 需 7 次 DOWN 回绕）：拒绝，配置不变
	for (let i = 0; i < 7; i++) panel.handleInput(DOWN);
	panel.handleInput("\r");
	assert.deepEqual(config.agentSummaryKeys, ["tokens"]);
	panel.handleInput("\x1b");
	panel.handleInput("\x1b");
	await close;
});

test("Summary done date / italic 行切换写回 config", async () => {
	config.agentSummaryDoneDate = true;
	config.agentSummaryItalic = false;
	const { panel, notices, close } = await openPanel();
	sendTabs(panel, 1);
	const nav = rowNav(panel, FEATURE_ROWS);
	nav(5); // Summary done date
	panel.handleInput("\r");
	assert.equal(config.agentSummaryDoneDate, false);
	nav(6); // Summary italic
	panel.handleInput("\r");
	assert.equal(config.agentSummaryItalic, true);
	assert.ok(notices.includes("已更新 agentSummaryItalic：on"));
	panel.handleInput("\x1b");
	await close;
});
