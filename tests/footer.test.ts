import assert from "node:assert/strict";
import test from "node:test";
import {
	config,
	formatConfigStatus,
	normalizeConfig,
	setConfig,
} from "../extensions/config/config.ts";
import {
	FOOTER_NERD_ICON_CACHE,
	FOOTER_NERD_ICON_GIT,
	FOOTER_NERD_ICON_MCP,
	applyCustomFooter,
	clearCustomFooter,
	colorGitStatus,
	footerGlyphs,
	formatXaiFooterChip,
	modelChip,
	parseGitStats,
} from "../extensions/feature/shell/footer.ts";
import {
	DEFAULT_FOOTER_CHIP_LAYOUT,
	DEFAULT_FOOTER_LINE1_KEYS,
	DEFAULT_FOOTER_LINE2_KEYS,
	FOOTER_CACHE_KEY,
	FOOTER_CONTEXT_KEY,
	FOOTER_COST_KEY,
	FOOTER_CWD_KEY,
	FOOTER_GIT_KEY,
	FOOTER_MODEL_KEY,
	FOOTER_RATE_KEY,
	FOOTER_TOKENS_KEY,
	ensureFooterTokensKey,
	isBuiltinFooterKey,
	PI_USAGE_KEY,
	PI_USAGE_SOURCE,
	defaultFooterLine,
	footerChipDescription,
	isSkippedFooterStatusKey,
	moveFooterKeyToLine,
	normalizeFooterChipLayout,
	reorderFooterKey,
	resolveFooterChipLayout,
	shiftFooterKeyLine,
	toggleFooterKeyHidden,
	visibleFooterPluginTexts,
} from "../extensions/feature/shell/footer-layout.ts";

test("normalizeConfig defaults enableCustomFooter on and honors explicit off", () => {
	assert.equal(normalizeConfig({}).enableCustomFooter, true);
	assert.equal(normalizeConfig({ enableCustomFooter: false }).enableCustomFooter, false);
	assert.match(formatConfigStatus(normalizeConfig({})), /footer=on/);
	assert.match(formatConfigStatus(normalizeConfig({ enableCustomFooter: false })), /footer=off/);
	assert.equal(normalizeConfig({}).footerNerdIcons, true);
	assert.equal(normalizeConfig({ footerNerdIcons: false }).footerNerdIcons, false);
	assert.match(formatConfigStatus(normalizeConfig({})), /footerIcons=nerd/);
	assert.match(
		formatConfigStatus(normalizeConfig({ footerNerdIcons: false })),
		/footerIcons=plain/,
	);
	assert.equal(normalizeConfig({}).footerTokenRate, true);
	assert.equal(normalizeConfig({ footerTokenRate: false }).footerTokenRate, false);
	assert.equal(normalizeConfig({}).footerTotalTokens, true);
	assert.equal(normalizeConfig({ footerTotalTokens: false }).footerTotalTokens, false);
	assert.equal(normalizeConfig({}).showSessionName, true);
	assert.equal(normalizeConfig({ showSessionName: false }).showSessionName, false);
	assert.equal(normalizeConfig({}).sessionNamePosition, "border");
	assert.equal(normalizeConfig({ sessionNamePosition: "cwd" }).sessionNamePosition, "cwd");
	assert.equal(normalizeConfig({ sessionNamePosition: "sidebar" }).sessionNamePosition, "border");
	assert.match(formatConfigStatus(normalizeConfig({})), /sessionName=on/);
	assert.match(formatConfigStatus(normalizeConfig({})), /sessionNameAt=border/);
	assert.match(formatConfigStatus(normalizeConfig({})), /footerTotalTokens=on/);
	assert.match(
		formatConfigStatus(normalizeConfig({ footerTotalTokens: false })),
		/footerTotalTokens=off/,
	);
	// tokens 内置芯片：默认 line1 收尾；旧配置补齐；用户已隐藏/已排布时不补。
	assert.ok((DEFAULT_FOOTER_LINE1_KEYS as readonly string[]).includes(FOOTER_TOKENS_KEY));
	assert.equal(isBuiltinFooterKey(FOOTER_TOKENS_KEY), true, "tokens 须按内置芯片渲染");
	const legacy = normalizeFooterChipLayout({
		footerLine1Keys: ["plugin-a"],
		footerLine2Keys: [],
		footerLine3Keys: [],
		footerHiddenKeys: [],
	});
	const ensured = ensureFooterTokensKey(legacy);
	assert.ok(
		[...ensured.footerLine1Keys, ...ensured.footerLine2Keys, ...ensured.footerLine3Keys].includes(
			FOOTER_TOKENS_KEY,
		),
		"旧配置缺 tokens 时应被补齐可见",
	);
	const managed = ensureFooterTokensKey(
		normalizeFooterChipLayout({
			footerLine1Keys: ["cwd", "git"],
			footerLine2Keys: [],
			footerLine3Keys: [],
			footerHiddenKeys: ["tokens"],
		}),
	);
	assert.ok(
		![...managed.footerLine1Keys, ...managed.footerLine2Keys, ...managed.footerLine3Keys].includes(
			FOOTER_TOKENS_KEY,
		),
		"用户已隐藏 tokens 时不应补回行列表",
	);
	assert.equal(normalizeConfig({}).footerTokenRateMode, "average");
	assert.equal(normalizeConfig({ footerTokenRateMode: "live" }).footerTokenRateMode, "live");
	assert.equal(normalizeConfig({ footerTokenRateMode: "instant" }).footerTokenRateMode, "average");
	assert.match(formatConfigStatus(normalizeConfig({})), /footerTokenRate=on/);
	assert.match(formatConfigStatus(normalizeConfig({})), /footerTokenRateMode=average/);
	assert.equal(normalizeConfig({}).footerTokenRateTtft, true);
	assert.equal(normalizeConfig({ footerTokenRateTtft: false }).footerTokenRateTtft, false);
	assert.match(formatConfigStatus(normalizeConfig({})), /footerTokenRateTtft=on/);
	assert.match(
		formatConfigStatus(normalizeConfig({ footerTokenRateTtft: false })),
		/footerTokenRateTtft=off/,
	);
});

test("footerGitStatsMode defaults to working and accepts only known modes", () => {
	assert.equal(normalizeConfig({}).footerGitStatsMode, "working");
	assert.equal(normalizeConfig({ footerGitStatsMode: "working" }).footerGitStatsMode, "working");
	assert.equal(normalizeConfig({ footerGitStatsMode: "branch" }).footerGitStatsMode, "branch");
	for (const value of ["invalid", "", true, 42, null]) {
		assert.equal(normalizeConfig({ footerGitStatsMode: value }).footerGitStatsMode, "working");
	}
	assert.match(formatConfigStatus(normalizeConfig({})), /footerGitStats=working/);
	assert.match(
		formatConfigStatus(normalizeConfig({ footerGitStatsMode: "branch" })),
		/footerGitStats=branch/,
	);
});

test("model chip joins effort with a circle instead of a separator dot", () => {
	const theme = {
		fg: (color: string, text: string) => `{${color}}${text}{/}`,
	};
	const color = (text: string) => `{think}${text}{/}`;
	assert.equal(
		modelChip(theme, "claude-sonnet", "high", color),
		"{accent}claude-sonnet{/} {think}\u25d5 high{/}",
	);
	assert.equal(modelChip(theme, "claude-sonnet", "off", color), "{accent}claude-sonnet{/}");
});

test("git status symbols take a color by role", () => {
	const theme = {
		fg: (color: string, text: string) => `{${color}}${text}{/}`,
	};
	assert.equal(
		colorGitStatus(theme, "=!\u21e12\u21e33"),
		"{error}={/}{warning}!{/}{success}\u21e1{/}{success}2{/}{error}\u21e3{/}{error}3{/}",
	);
	assert.equal(colorGitStatus(theme, "?"), "{muted}?{/}");
});

test("footerGlyphs drops Nerd Font icons when disabled", () => {
	assert.deepEqual(footerGlyphs(true), {
		git: FOOTER_NERD_ICON_GIT,
		cache: FOOTER_NERD_ICON_CACHE,
		mcp: FOOTER_NERD_ICON_MCP,
	});
	assert.deepEqual(footerGlyphs(false), { git: "", cache: "", mcp: "" });
});

test("normalizeConfig defaults builtin chips on their original lines", () => {
	const next = normalizeConfig({});
	assert.deepEqual(next.footerHiddenKeys, []);
	assert.deepEqual(next.footerLine1Keys, [...DEFAULT_FOOTER_LINE1_KEYS]);
	assert.deepEqual(next.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS]);
	assert.deepEqual(next.footerLine3Keys, []);
	assert.match(formatConfigStatus(next), /hidden=0/);
});

test("normalizeConfig keeps explicit empty hiddenKeys and inserts builtins around pi-usage", () => {
	const next = normalizeConfig({
		footerHiddenKeys: [],
		footerLine1Keys: [PI_USAGE_KEY],
	});
	assert.deepEqual(next.footerHiddenKeys, []);
	assert.deepEqual(next.footerLine1Keys, [
		FOOTER_CWD_KEY,
		FOOTER_GIT_KEY,
		FOOTER_MODEL_KEY,
		FOOTER_CONTEXT_KEY,
		FOOTER_CACHE_KEY,
		FOOTER_RATE_KEY,
		FOOTER_TOKENS_KEY,
		PI_USAGE_KEY,
	]);
	assert.deepEqual(next.footerLine2Keys, []);
});

test("normalizeFooterChipLayout migrates old plugin-only lines and keeps an explicit model slot", () => {
	const migrated = normalizeFooterChipLayout({
		footerHiddenKeys: ["ponytail", "ponytail"],
		footerLine1Keys: ["usage", "ponytail"],
		footerLine2Keys: ["ponytail", "lsp"],
	});
	assert.deepEqual(migrated.footerLine1Keys, [
		FOOTER_CWD_KEY,
		FOOTER_GIT_KEY,
		FOOTER_MODEL_KEY,
		FOOTER_CONTEXT_KEY,
		FOOTER_CACHE_KEY,
		FOOTER_RATE_KEY,
		FOOTER_TOKENS_KEY,
		"usage",
		"ponytail",
	]);
	assert.deepEqual(migrated.footerLine2Keys, ["lsp"]);
	assert.deepEqual(migrated.footerHiddenKeys, ["ponytail"]);

	const explicit = normalizeFooterChipLayout({
		footerLine1Keys: ["usage"],
		footerLine3Keys: ["model", "git"],
	});
	assert.deepEqual(explicit.footerLine1Keys, ["usage"]);
	assert.deepEqual(explicit.footerLine2Keys, []);
	assert.deepEqual(explicit.footerLine3Keys, ["model", "git"]);
});

test("normalizeFooterChipLayout rewrites legacy localUsage and piUsage keys to pi-usage", () => {
	const fromLocal = normalizeFooterChipLayout({
		footerHiddenKeys: ["localUsage"],
		footerLine1Keys: ["localUsage", "usage"],
		footerLine2Keys: ["localUsage"],
	});
	assert.deepEqual(fromLocal.footerLine1Keys, [
		FOOTER_CWD_KEY,
		FOOTER_GIT_KEY,
		FOOTER_MODEL_KEY,
		FOOTER_CONTEXT_KEY,
		FOOTER_CACHE_KEY,
		FOOTER_RATE_KEY,
		FOOTER_TOKENS_KEY,
		PI_USAGE_KEY,
		"usage",
	]);
	assert.deepEqual(fromLocal.footerLine2Keys, []);
	assert.deepEqual(fromLocal.footerHiddenKeys, [PI_USAGE_KEY]);
	const fromCamel = normalizeFooterChipLayout({
		footerLine1Keys: ["piUsage"],
	});
	assert.deepEqual(fromCamel.footerLine1Keys, [
		FOOTER_CWD_KEY,
		FOOTER_GIT_KEY,
		FOOTER_MODEL_KEY,
		FOOTER_CONTEXT_KEY,
		FOOTER_CACHE_KEY,
		FOOTER_RATE_KEY,
		FOOTER_TOKENS_KEY,
		PI_USAGE_KEY,
	]);
	assert.deepEqual(fromCamel.footerLine2Keys, []);
});

test("disabled custom footer leaves another extension's footer untouched", () => {
	const previous = { ...config };
	const calls: unknown[] = [];
	const ctx = {
		hasUI: true,
		ui: {
			setFooter: (factory: unknown) => calls.push(factory),
		},
	};

	try {
		setConfig(normalizeConfig({ enableCustomFooter: false }));
		applyCustomFooter(ctx as never);
		assert.deepEqual(calls, []);

		clearCustomFooter(ctx as never);
		assert.deepEqual(calls, [undefined]);
	} finally {
		setConfig(previous);
	}
});

test("defaultFooterLine sends usage-like and builtin keys to line1, unknown plugins to line2, and skips extension model status", () => {
	assert.equal(isSkippedFooterStatusKey("model"), true);
	assert.equal(defaultFooterLine("usage"), 1);
	assert.equal(defaultFooterLine("pi-grok-usage"), 1);
	assert.equal(defaultFooterLine("cloud-quota"), 1);
	assert.equal(defaultFooterLine(PI_USAGE_KEY), 1);
	assert.equal(defaultFooterLine(FOOTER_GIT_KEY), 1);
	assert.equal(defaultFooterLine("ponytail"), 2);
	assert.equal(defaultFooterLine("lsp"), 2);
});

test("resolveFooterChipLayout appends unknown live keys to default lines in alpha order", () => {
	const resolved = resolveFooterChipLayout(DEFAULT_FOOTER_CHIP_LAYOUT, [
		"ponytail",
		"usage",
		"model",
		"lsp",
		"cloud-quota",
	]);
	assert.deepEqual(resolved.footerLine1Keys, [
		...DEFAULT_FOOTER_LINE1_KEYS,
		"cloud-quota",
		"usage",
	]);
	assert.deepEqual(resolved.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS, "lsp", "ponytail"]);
	assert.deepEqual(resolved.footerLine3Keys, []);
	assert.deepEqual(resolved.footerHiddenKeys, []);
});

test("hidden keys stay on their line and unhide restores the slot", () => {
	let layout = resolveFooterChipLayout(DEFAULT_FOOTER_CHIP_LAYOUT, ["ponytail", "lsp"]);
	layout = toggleFooterKeyHidden(layout, "ponytail");
	assert.ok(layout.footerHiddenKeys.includes("ponytail"));
	assert.deepEqual(layout.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS, "lsp", "ponytail"]);
	layout = toggleFooterKeyHidden(layout, "ponytail");
	assert.equal(layout.footerHiddenKeys.includes("ponytail"), false);
	assert.deepEqual(layout.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS, "lsp", "ponytail"]);
});

test("moveFooterKeyToLine appends to the target line and clamps shift at the ends", () => {
	let layout = resolveFooterChipLayout(DEFAULT_FOOTER_CHIP_LAYOUT, ["ponytail", "lsp"]);
	layout = moveFooterKeyToLine(layout, "ponytail", 3);
	assert.deepEqual(layout.footerLine3Keys, ["ponytail"]);
	assert.deepEqual(layout.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS, "lsp"]);
	layout = shiftFooterKeyLine(layout, "ponytail", 1);
	assert.deepEqual(layout.footerLine3Keys, ["ponytail"]);
	// model 已在 line1：shift -1（上一行）被夹住，位置不变
	layout = shiftFooterKeyLine(layout, "model", -1);
	assert.equal(layout.footerLine1Keys.indexOf(FOOTER_MODEL_KEY), 3);
});

test("reorderFooterKey swaps within a line only", () => {
	let layout = resolveFooterChipLayout(DEFAULT_FOOTER_CHIP_LAYOUT, ["ponytail", "lsp"]);
	assert.deepEqual(layout.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS, "lsp", "ponytail"]);
	layout = reorderFooterKey(layout, "lsp", 1);
	assert.deepEqual(layout.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS, "ponytail", "lsp"]);
	layout = reorderFooterKey(layout, "lsp", 1);
	assert.deepEqual(layout.footerLine2Keys, [...DEFAULT_FOOTER_LINE2_KEYS, "ponytail", "lsp"]);
});

test("visibleFooterPluginTexts skips hidden and empty, keeps configured order", () => {
	const texts = new Map([
		["usage", "codex 5%"],
		[PI_USAGE_KEY, "xAI 14%"],
		["ponytail", "⚡ FULL"],
		["lsp", ""],
	]);
	assert.deepEqual(
		visibleFooterPluginTexts([PI_USAGE_KEY, "usage", "ghost"], [PI_USAGE_KEY], texts),
		["codex 5%"],
	);
	assert.deepEqual(visibleFooterPluginTexts(["ponytail", "lsp"], [], texts), ["⚡ FULL"]);
	assert.deepEqual(visibleFooterPluginTexts(["usage"], [], texts), ["codex 5%"]);
});

test("footerChipDescription names builtin chips and the source extension", () => {
	assert.equal(footerChipDescription(FOOTER_GIT_KEY, ""), "Branch and change stats");
	assert.equal(
		footerChipDescription(FOOTER_GIT_KEY, "main (+1 −0)"),
		"Branch and change stats · main (+1 −0)",
	);
	assert.equal(footerChipDescription(PI_USAGE_KEY, "xAI 14%"), `xAI 14% · from ${PI_USAGE_SOURCE}`);
	assert.equal(
		footerChipDescription(PI_USAGE_KEY, ""),
		`From ${PI_USAGE_SOURCE}. No text right now.`,
	);
	assert.equal(footerChipDescription("ponytail", "⚡ FULL"), "⚡ FULL · from ponytail");
	assert.equal(footerChipDescription("lsp", ""), "inactive · from lsp");
});

test("pi-usage stays a plugin chip even though it is on the default line", () => {
	assert.equal(isBuiltinFooterKey(PI_USAGE_KEY), false);
	assert.equal(isBuiltinFooterKey(FOOTER_GIT_KEY), true);
});

test("pi-usage and plugin usage can both be visible with no fallback judgment", () => {
	const texts = new Map([
		[PI_USAGE_KEY, "xAI 14%"],
		["usage", "codex 5%"],
	]);
	assert.deepEqual(visibleFooterPluginTexts([PI_USAGE_KEY, "usage"], [], texts), [
		"xAI 14%",
		"codex 5%",
	]);
});

test("git can move to line1 and hide without leaving a fixed second-line slot", () => {
	// git 已在默认 line1：move 到 line1 是 no-op
	let layout = moveFooterKeyToLine(DEFAULT_FOOTER_CHIP_LAYOUT, FOOTER_GIT_KEY, 1);
	assert.deepEqual(layout.footerLine2Keys, []);
	// 从 line2 移入 line1 时追加到末尾
	const fromLine2 = {
		...DEFAULT_FOOTER_CHIP_LAYOUT,
		footerLine1Keys: DEFAULT_FOOTER_CHIP_LAYOUT.footerLine1Keys.filter(
			(key) => key !== FOOTER_GIT_KEY,
		),
		footerLine2Keys: [FOOTER_GIT_KEY],
	};
	layout = moveFooterKeyToLine(fromLine2, FOOTER_GIT_KEY, 1);
	assert.equal(layout.footerLine1Keys.at(-1), FOOTER_GIT_KEY);
	assert.deepEqual(layout.footerLine2Keys, []);
	layout = toggleFooterKeyHidden(layout, FOOTER_GIT_KEY);
	assert.deepEqual(
		visibleFooterPluginTexts(layout.footerLine1Keys, layout.footerHiddenKeys, new Map()),
		[],
	);
	assert.ok(layout.footerHiddenKeys.includes(FOOTER_GIT_KEY));
	assert.equal(layout.footerLine2Keys.includes(FOOTER_GIT_KEY), false);
});

test("line3 paints only when a visible plugin text exists", () => {
	const layout = moveFooterKeyToLine(
		resolveFooterChipLayout(DEFAULT_FOOTER_CHIP_LAYOUT, ["ponytail"]),
		"ponytail",
		3,
	);
	const hidden = visibleFooterPluginTexts(
		layout.footerLine3Keys,
		["ponytail"],
		new Map([["ponytail", "⚡ FULL"]]),
	);
	const shown = visibleFooterPluginTexts(
		layout.footerLine3Keys,
		[],
		new Map([["ponytail", "⚡ FULL"]]),
	);
	assert.deepEqual(hidden, []);
	assert.deepEqual(shown, ["⚡ FULL"]);
});

test("formatXaiFooterChip prefers included percent then prepaid dollars", () => {
	assert.equal(
		formatXaiFooterChip({
			buckets: [{ id: "included-allowance", unit: "percent", used: 14.4 }],
		}),
		"xAI 14%",
	);
	assert.equal(
		formatXaiFooterChip({
			metrics: [{ id: "prepaid-balance", value: 1.5 }],
		}),
		"xAI $1.50",
	);
});

test("parseGitStats sums numstat add/delete columns", () => {
	assert.deepEqual(parseGitStats("10\t2\ta.ts\n3\t1\tb.ts\n"), { add: 13, del: 3 });
	assert.deepEqual(parseGitStats(""), { add: 0, del: 0 });
	assert.deepEqual(parseGitStats("-\t-\timage.png\n15\t9\tsource.ts\n60\t0\tnew-test.ts\n"), {
		add: 75,
		del: 9,
	});
});
