import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_CONFIG,
	formatConfigStatus,
	normalizeConfig,
} from "../extensions/config/config.ts";
import {
	DEFAULT_TOKEN_SPEED,
	formatTokenSpeedSummary,
	hexToTruecolor,
	normalizeTokenSpeed,
	normalizeTokenSpeedOverride,
	resolveTokenSpeed,
	tokenSpeedRateAnsi,
	tokenSpeedTier,
} from "../extensions/feature/shell/token-speed-config.ts";

test("tokenSpeed falls back to the default block when missing or not an object", () => {
	assert.deepEqual(normalizeTokenSpeed(undefined), DEFAULT_TOKEN_SPEED);
	assert.deepEqual(normalizeTokenSpeed("nope"), DEFAULT_TOKEN_SPEED);
	assert.deepEqual(normalizeTokenSpeed(42), DEFAULT_TOKEN_SPEED);
	assert.deepEqual(normalizeConfig({}).tokenSpeed, DEFAULT_TOKEN_SPEED);
	assert.deepEqual(normalizeConfig({ tokenSpeed: 42 }).tokenSpeed, DEFAULT_TOKEN_SPEED);
	assert.deepEqual(normalizeConfig({ tokenSpeed: null }).tokenSpeed, DEFAULT_TOKEN_SPEED);
});

test("valid thresholds pass through, invalid ones fall back as a whole block", () => {
	assert.deepEqual(
		normalizeTokenSpeed({ thresholds: { slow: 0, medium: 10, fast: 20, blazing: 40 } }).thresholds,
		{ slow: 0, medium: 10, fast: 20, blazing: 40 },
	);
	// 非升序（含相等）整块回落
	assert.deepEqual(
		normalizeTokenSpeed({ thresholds: { slow: 30, medium: 15, fast: 20, blazing: 40 } }).thresholds,
		DEFAULT_TOKEN_SPEED.thresholds,
	);
	assert.deepEqual(
		normalizeTokenSpeed({ thresholds: { slow: 10, medium: 10, fast: 20, blazing: 40 } }).thresholds,
		DEFAULT_TOKEN_SPEED.thresholds,
	);
	// 负数、非整数、缺失字段
	assert.deepEqual(
		normalizeTokenSpeed({ thresholds: { slow: -1, medium: 15, fast: 30, blazing: 45 } }).thresholds,
		DEFAULT_TOKEN_SPEED.thresholds,
	);
	assert.deepEqual(
		normalizeTokenSpeed({ thresholds: { slow: 0.5, medium: 15, fast: 30, blazing: 45 } })
			.thresholds,
		DEFAULT_TOKEN_SPEED.thresholds,
	);
	assert.deepEqual(
		normalizeTokenSpeed({ thresholds: { medium: 15, fast: 30, blazing: 45 } }).thresholds,
		DEFAULT_TOKEN_SPEED.thresholds,
	);
	// thresholds 整块回落不影响其他字段
	const mixed = normalizeTokenSpeed({
		thresholds: { slow: 45, medium: 15, fast: 30, blazing: 40 },
		countStrategy: "direct",
	});
	assert.deepEqual(mixed.thresholds, DEFAULT_TOKEN_SPEED.thresholds);
	assert.equal(mixed.countStrategy, "direct");
});

test("invalid colors fall back per color", () => {
	const colors = normalizeTokenSpeed({
		colors: { slow: "red", medium: "#FFAA00", fast: "#00ff8888", blazing: "#44ddff" },
	}).colors;
	assert.equal(colors.slow, DEFAULT_TOKEN_SPEED.colors.slow);
	assert.equal(colors.medium, "#FFAA00");
	assert.equal(colors.fast, DEFAULT_TOKEN_SPEED.colors.fast);
	assert.equal(colors.blazing, "#44ddff");
	assert.deepEqual(normalizeTokenSpeed({ colors: "red" }).colors, DEFAULT_TOKEN_SPEED.colors);
});

test("enum fields fall back when invalid", () => {
	assert.equal(normalizeTokenSpeed({ countStrategy: "direct" }).countStrategy, "direct");
	assert.equal(normalizeTokenSpeed({ countStrategy: "bogus" }).countStrategy, "estimate");
	assert.equal(normalizeTokenSpeed({ endTpsBehavior: "last" }).endTpsBehavior, "last");
	assert.equal(normalizeTokenSpeed({ endTpsBehavior: 7 }).endTpsBehavior, "last");
});

test("rate label strings pass through; empty keeps, junk falls back", () => {
	assert.equal(normalizeTokenSpeed({ liveLabel: "LIVE" }).liveLabel, "LIVE");
	assert.equal(normalizeTokenSpeed({ avgLabel: "avg" }).avgLabel, "avg");
	// 空串合法（隐藏前缀）
	assert.equal(normalizeTokenSpeed({ liveLabel: "" }).liveLabel, "");
	// 非法类型回落默认（live 默认 "live"，avg 默认 "avg"）
	assert.equal(normalizeTokenSpeed({ liveLabel: 7 }).liveLabel, DEFAULT_TOKEN_SPEED.liveLabel);
	assert.equal(normalizeTokenSpeed({ avgLabel: 7 }).avgLabel, DEFAULT_TOKEN_SPEED.avgLabel);
});

test("sliding window clamps into range, junk falls back; updateInterval keeps the key but is ignored", () => {
	assert.equal(normalizeTokenSpeed({ slidingWindow: 50 }).slidingWindow, 100);
	assert.equal(normalizeTokenSpeed({ slidingWindow: 60_000 }).slidingWindow, 30_000);
	assert.equal(normalizeTokenSpeed({ slidingWindow: 15_000 }).slidingWindow, 15_000);
	assert.equal(
		normalizeTokenSpeed({ slidingWindow: "abc" }).slidingWindow,
		DEFAULT_TOKEN_SPEED.slidingWindow,
	);
	// 已验证 pi TUI 渲染管线合帧（requestRender 去重 + 16ms 帧节流），节流不再需要：键位保留、取值恒 0。
	assert.equal(normalizeTokenSpeed({}).updateInterval, 0);
	assert.equal(normalizeTokenSpeed({ updateInterval: 2_000 }).updateInterval, 0);
	assert.equal(normalizeTokenSpeed({ updateInterval: 120 }).updateInterval, 0);
	assert.equal(normalizeTokenSpeed({ updateInterval: -5 }).updateInterval, 0);
	assert.equal(normalizeTokenSpeed({ formatDuration: true }).formatDuration, true);
	assert.equal(normalizeTokenSpeed({ formatDuration: "yes" }).formatDuration, false);
	assert.equal(normalizeTokenSpeed({ icon: "⚡" }).icon, "⚡");
	assert.equal(normalizeTokenSpeed({ icon: 3 }).icon, "⚡");
});

test("display mode falls back to legacy on invalid values", () => {
	assert.equal(DEFAULT_TOKEN_SPEED.display, "legacy");
	assert.equal(normalizeTokenSpeed({ display: "stats" }).display, "stats");
	assert.equal(normalizeTokenSpeed({ display: "full" }).display, "full");
	assert.equal(normalizeTokenSpeed({ display: "bogus" }).display, "legacy");
	assert.equal(normalizeTokenSpeed({ display: 7 }).display, "legacy");
	assert.equal(normalizeTokenSpeed({}).display, "legacy");
});

test("displayColors keeps only valid hex keys, missing keys mean no paint", () => {
	assert.deepEqual(normalizeTokenSpeed({}).displayColors, {});
	assert.deepEqual(normalizeTokenSpeed({ displayColors: "red" }).displayColors, {});
	assert.deepEqual(
		normalizeTokenSpeed({
			displayColors: { count: "#00ff88", elapsed: "nope", ttft: "#44ddffff", junk: "#123456" },
		}).displayColors,
		{ count: "#00ff88" },
	);
});

test("providerOverrides keep sparse valid blocks and drop junk entries", () => {
	// 空段/非对象值丢弃；字段级非法不回填默认（回填会把 base 顶掉）。
	assert.deepEqual(normalizeTokenSpeed({ providerOverrides: "x" }).providerOverrides, {});
	assert.deepEqual(
		normalizeTokenSpeed({ providerOverrides: { anthropic: "x" } }).providerOverrides,
		{},
	);
	assert.deepEqual(
		normalizeTokenSpeed({ providerOverrides: { anthropic: { display: "bogus", icon: 3 } } })
			.providerOverrides,
		{},
	);
	// 阈值部分块（非升序/缺字段）整块丢弃；合法整块保留。
	assert.deepEqual(
		normalizeTokenSpeed({ providerOverrides: { p: { thresholds: { slow: 30, medium: 15 } } } })
			.providerOverrides,
		{},
	);
	const kept = normalizeTokenSpeed({
		providerOverrides: {
			anthropic: {
				thresholds: { slow: 5, medium: 25, fast: 50, blazing: 80 },
				slidingWindow: 99,
				colors: { fast: "#123456" },
				displayColors: { ttft: "#abcdef" },
				formatDuration: false,
				updateInterval: 500,
			},
		},
	}).providerOverrides.anthropic;
	assert.deepEqual(kept, {
		thresholds: { slow: 5, medium: 25, fast: 50, blazing: 80 },
		slidingWindow: 100,
		colors: { fast: "#123456" },
		displayColors: { ttft: "#abcdef" },
		formatDuration: false,
	});
});

test("normalizeTokenSpeedOverride stays sparse for direct reuse", () => {
	assert.deepEqual(normalizeTokenSpeedOverride("x"), {});
	assert.deepEqual(normalizeTokenSpeedOverride({ countStrategy: "direct", icon: "⚡" }), {
		countStrategy: "direct",
		icon: "⚡",
	});
});

test("resolveTokenSpeed deep-merges only the matched provider's override", () => {
	const base = normalizeTokenSpeed({
		display: "tps",
		icon: "⚡",
		providerOverrides: {
			anthropic: {
				display: "full",
				slidingWindow: 2_000,
				countStrategy: "direct",
				colors: { fast: "#123456" },
				displayColors: { ttft: "#abcdef" },
				thresholds: { slow: 5, medium: 25, fast: 50, blazing: 80 },
				formatDuration: true,
			},
		},
	});
	// 未命中/无 provider：原样返回 base。
	assert.equal(resolveTokenSpeed(base, "openai"), base);
	assert.equal(resolveTokenSpeed(base, undefined), base);
	assert.equal(resolveTokenSpeed(base, ""), base);

	const effective = resolveTokenSpeed(base, "anthropic");
	// 覆盖字段生效。
	assert.equal(effective.display, "full");
	assert.equal(effective.slidingWindow, 2_000);
	assert.equal(effective.countStrategy, "direct");
	assert.equal(effective.formatDuration, true);
	assert.deepEqual(effective.thresholds, { slow: 5, medium: 25, fast: 50, blazing: 80 });
	// colors/displayColors 逐色深合并：覆盖色生效，其余沿用 base。
	assert.equal(effective.colors.fast, "#123456");
	assert.equal(effective.colors.slow, base.colors.slow);
	assert.deepEqual(effective.displayColors, { ttft: "#abcdef" });
	// base 独有的字段不被覆盖块顶掉。
	assert.equal(effective.icon, "⚡");
	assert.equal(effective.endTpsBehavior, base.endTpsBehavior);
	// 摘要行等按 tokenSpeedTier 取档时用生效阈值（rate 20：base 落 medium，覆盖后落 slow）。
	assert.equal(tokenSpeedTier(20, effective.thresholds), "slow");
	assert.equal(tokenSpeedTier(20, base.thresholds), "medium");
});

test("tokenSpeedTier maps rates onto four tiers and tokenSpeedRateAnsi emits truecolor codes", () => {
	const t = DEFAULT_TOKEN_SPEED.thresholds;
	assert.equal(tokenSpeedTier(0, t), "slow");
	assert.equal(tokenSpeedTier(14.9, t), "slow");
	assert.equal(tokenSpeedTier(15, t), "medium");
	assert.equal(tokenSpeedTier(29, t), "medium");
	assert.equal(tokenSpeedTier(30, t), "fast");
	assert.equal(tokenSpeedTier(44.9, t), "fast");
	assert.equal(tokenSpeedTier(45, t), "blazing");
	assert.equal(tokenSpeedTier(999, t), "blazing");
	// 自定义阈值按序取档
	assert.equal(tokenSpeedTier(24, { slow: 0, medium: 10, fast: 20, blazing: 80 }), "fast");
	assert.equal(tokenSpeedTier(5, { slow: 0, medium: 10, fast: 20, blazing: 80 }), "slow");
	// 档位 → ANSI truecolor 开码
	assert.equal(hexToTruecolor("#00ff88"), "\x1b[38;2;0;255;136m");
	assert.equal(tokenSpeedRateAnsi(5, DEFAULT_TOKEN_SPEED), "\x1b[38;2;255;68;68m");
	assert.equal(tokenSpeedRateAnsi(16, DEFAULT_TOKEN_SPEED), "\x1b[38;2;255;170;0m");
	assert.equal(tokenSpeedRateAnsi(42, DEFAULT_TOKEN_SPEED), "\x1b[38;2;0;255;136m");
	assert.equal(tokenSpeedRateAnsi(60, DEFAULT_TOKEN_SPEED), "\x1b[38;2;68;221;255m");
});

test("tokenSpeed normalization keeps other config keys untouched", () => {
	const merged = normalizeConfig({
		footerCurrency: "CNY",
		footerTokenRateMode: "live",
		tokenSpeed: { countStrategy: "direct", endTpsBehavior: "last", slidingWindow: 5_000 },
	});
	assert.equal(merged.footerCurrency, "CNY");
	assert.equal(merged.footerTokenRateMode, "live");
	assert.deepEqual(merged.tokenSpeed, {
		...DEFAULT_TOKEN_SPEED,
		countStrategy: "direct",
		endTpsBehavior: "last",
		slidingWindow: 5_000,
	});
});

test("config status carries a tokenSpeed summary", () => {
	assert.equal(
		formatTokenSpeedSummary(DEFAULT_TOKEN_SPEED),
		"tokenSpeed=[0/15/30/45] estimate last w1000",
	);
	assert.match(
		formatConfigStatus({ ...DEFAULT_CONFIG }),
		/tokenSpeed=\[0\/15\/30\/45\] estimate last w1000/,
	);
	assert.match(
		formatConfigStatus(
			normalizeConfig({
				tokenSpeed: {
					thresholds: { slow: 5, medium: 25, fast: 50, blazing: 80 },
					endTpsBehavior: "last",
				},
			}),
		),
		/tokenSpeed=\[5\/25\/50\/80\] estimate last w1000/,
	);
});
