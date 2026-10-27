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
	assert.equal(normalizeTokenSpeed({ endTpsBehavior: 7 }).endTpsBehavior, "average");
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
	assert.equal(normalizeTokenSpeed({ icon: 3 }).icon, "");
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
		"tokenSpeed=[0/15/30/45] estimate avg w1000",
	);
	assert.match(
		formatConfigStatus({ ...DEFAULT_CONFIG }),
		/tokenSpeed=\[0\/15\/30\/45\] estimate avg w1000/,
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
