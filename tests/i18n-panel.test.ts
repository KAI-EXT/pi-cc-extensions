import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// 必须在导入 config 之前隔离 agent 目录：updateConfig 会把配置写回磁盘。
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "ccstyle-i18n-"));

const { CONFIG_PATH, config, DEFAULT_CONFIG, normalizeConfig } = await import(
	"../extensions/config/config.ts"
);
const { initTheme } = await import("@earendil-works/pi-coding-agent");
const { showCcstylePanel } = await import("../extensions/config/panel.ts");
const { t } = await import("../extensions/config/i18n/index.ts");
const { dict: en } = await import("../extensions/config/i18n/en.ts");
const { dict: zh } = await import("../extensions/config/i18n/zh.ts");

// 面板构造 SettingsList 时要取主题；测试不渲染整幅画面，只要求主题已初始化。
initTheme("dark");

type PanelComponent = {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
};

function fakePanelUi() {
	let panel: PanelComponent | undefined;
	const notices: string[] = [];
	// 面板 render 需要 theme.fg/bold；stub 直接透传文本。
	const themeStub = {
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
	};
	const ui = {
		notify: (message: string) => notices.push(message),
		custom: (
			build: (
				tui: unknown,
				theme: unknown,
				keybindings: unknown,
				done: () => void,
			) => PanelComponent,
		) =>
			new Promise<void>((resolve) => {
				const done = () => resolve();
				panel = build({ requestRender: () => {} }, themeStub, {}, done);
			}),
	};
	return {
		ctx: { mode: "tui", hasUI: true, ui },
		notices,
		get panel(): PanelComponent {
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

const renderText = (panel: PanelComponent): string => panel.render(120).join("\n");

test("字典键完整性：zh 与 en 键集合完全一致且无空值", () => {
	const enKeys = Object.keys(en).sort();
	const zhKeys = Object.keys(zh).sort();
	assert.deepEqual(zhKeys, enKeys, "zh 字典必须与 en 键集合一致");
	for (const key of enKeys) {
		assert.ok(String(zh[key as keyof typeof zh]).trim(), `zh 空值: ${key}`);
		assert.ok(String(en[key as keyof typeof en]).trim(), `en 空值: ${key}`);
	}
});

test("t() 默认中文、占位符替换、切语言后取词随之变化", () => {
	assert.equal(DEFAULT_CONFIG.language, "zh");
	assert.equal(config.language, "zh");
	assert.equal(t("tab.style"), "样式");
	assert.equal(
		t("excludeRenderers.desc.some", { names: "bash, read" }),
		"以下工具使用原生渲染器：bash, read。按 Enter 可切换。",
	);
	// 未提供的占位符原样保留，便于发现漏传。
	assert.ok(t("agentSummaryKeys.desc", {}).includes("{count}"));

	config.language = "en";
	assert.equal(t("tab.style"), "Style");
	config.language = "zh";
});

test("normalizeConfig：language 非法值回落默认 zh，合法值保留", () => {
	assert.equal(normalizeConfig({}).language, "zh");
	assert.equal(normalizeConfig({ language: "en" }).language, "en");
	assert.equal(normalizeConfig({ language: "fr" }).language, "zh");
	assert.equal(normalizeConfig({ language: 42 }).language, "zh");
});

test("面板默认渲染中文，且不带 SettingsList 内置英文提示", async () => {
	const { panel } = await openPanel();
	// 初始在 Style 页签：页签栏与底部提示应已为中文。
	let text = renderText(panel);
	assert.ok(text.includes("样式"), "页签应为中文");
	assert.ok(text.includes("Enter/Space 更改"), "底部提示应为中文");
	assert.ok(!text.includes("Enter/Space to change"), "不应残留 SettingsList 英文提示");

	// Tab ×2 到 UI 页签：首行是双语语言项。
	panel.handleInput("\t");
	panel.handleInput("\t");
	text = renderText(panel);
	assert.ok(text.includes("界面语言 / Language"), "UI 页签应包含双语语言项");
	await panel.handleInput("\x1b");
});

test("语言行循环切换到 en：即时生效、写回配置文件、面板转为英文", async () => {
	const slot = fakePanelUi();
	const close = showCcstylePanel(slot.ctx, hooks);
	const panel = slot.panel;

	// 初始页签 Style；Tab ×2 到 UI 页签，语言行在首行（默认选中）。
	panel.handleInput("\t");
	panel.handleInput("\t");
	assert.ok(renderText(panel).includes("界面语言 / Language"));

	// Space 循环 zh → en。
	panel.handleInput(" ");
	assert.equal(config.language, "en");
	assert.ok(slot.notices.includes("Updated language: en"));

	// 行刷新后设置项文案为英文；页签渲染时取词，同样即时。语言项 label 固定双语，不算残留。
	const text = renderText(panel);
	assert.ok(text.includes("Style"), "页签应为英文");
	assert.ok(text.includes("Expanded input lines"), "设置项 label 应为英文");
	assert.ok(!text.includes("展开时 Input 行数"), "不应残留中文行文案");
	assert.ok(!text.includes("Enter/Space 更改"), "底部提示应为英文");

	// 持久化：配置文件写回 language: "en"。
	const persisted = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { language?: string };
	assert.equal(persisted.language, "en");

	panel.handleInput("\x1b");
	await close;
	assert.equal(config.language, "en");
});
