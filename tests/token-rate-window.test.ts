import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
	carryTokenRate,
	displayTokenRate,
	getTokenSpeedOptions,
	resetTokenRate,
	sampleTokenDelta,
	setTokenSpeedOptions,
	totalTokens,
} from "../extensions/feature/shell/token-rate.ts";

// 模块级状态，必须串行；并行会互相清掉速率与口径。
describe("token rate sliding window", { concurrency: false }, () => {
	test("setTokenSpeedOptions defaults to estimate/last/1000 and clamps the window", () => {
		setTokenSpeedOptions();
		assert.deepEqual(getTokenSpeedOptions(), {
			countStrategy: "estimate",
			endTpsBehavior: "last",
			slidingWindow: 1_000,
		});
		setTokenSpeedOptions({
			countStrategy: "direct",
			endTpsBehavior: "last",
			slidingWindow: 60_000,
		});
		assert.equal(getTokenSpeedOptions().slidingWindow, 30_000, "30s 硬顶");
		setTokenSpeedOptions();
	});

	test("live rate follows the trailing window and prunes beyond slidingWindow", () => {
		resetTokenRate(1_000);
		sampleTokenDelta("a".repeat(400), 2_000); // 100 tok
		sampleTokenDelta("a".repeat(400), 2_500); // +100 tok / 0.5s
		assert.equal(displayTokenRate("live"), 200);
		// 4.9s 停顿后旧样本全部裁出窗口，速率只看新窗口。
		sampleTokenDelta("a".repeat(400), 7_400);
		sampleTokenDelta("a".repeat(400), 7_800); // 窗口内 100 tok / 0.4s
		assert.equal(displayTokenRate("live"), 250);
		assert.equal(totalTokens(), 400, "裁剪只影响窗口，不影响累计");
		setTokenSpeedOptions();
	});

	test("slidingWindow is configurable and widens the pruning horizon", () => {
		setTokenSpeedOptions({ slidingWindow: 2_000 });
		resetTokenRate(1_000);
		sampleTokenDelta("a".repeat(400), 2_000); // 100 tok
		sampleTokenDelta("a".repeat(400), 3_000); // +100 tok / 1s
		assert.equal(displayTokenRate("live"), 100);
		sampleTokenDelta("a".repeat(400), 3_500); // 2s 窗口装得下：200 tok / 1.5s（默认 1s 窗口会裁掉首样本）
		assert.ok(Math.abs(displayTokenRate("live") - 400 / 3) < 1e-9);
		setTokenSpeedOptions();
	});

	test("stall flush extends the span instead of faking a burst rate", () => {
		resetTokenRate(1_000);
		for (let i = 0; i < 10; i++) {
			sampleTokenDelta("a".repeat(8), 1_000 + i * 100); // 20 tok 铺满首秒
		}
		sampleTokenDelta("a".repeat(2_000), 7_000); // 5s 停顿后 500 tok 同刻 flush
		// 500 tok / 5.1s ≈ 98 tok/s，而不是 500 tok / 0.1s clamp = 5000。
		assert.ok(Math.abs(displayTokenRate("live") - 100) < 5, `got ${displayTokenRate("live")}`);
	});

	test("spans below 100ms are clamped to the minimum", () => {
		resetTokenRate(1_000);
		sampleTokenDelta("a".repeat(400), 2_000); // 100 tok
		sampleTokenDelta("a".repeat(400), 2_050); // 跨度 50ms → clamp 100ms → 1000 tok/s
		assert.equal(displayTokenRate("live"), 1_000);
	});

	test("countStrategy direct counts one token per delta", () => {
		setTokenSpeedOptions({ countStrategy: "direct" });
		resetTokenRate(1_000);
		sampleTokenDelta("你好世界，测试文本", 2_000); // estimate 会算 8+，direct 只计 1
		sampleTokenDelta("", 2_050); // 空 delta 不计
		sampleTokenDelta("x".repeat(40), 2_100);
		sampleTokenDelta("y".repeat(40), 2_200);
		assert.equal(totalTokens(), 3, "3 个非空 delta = 3 token");
		setTokenSpeedOptions();
	});

	test("endTpsBehavior last holds the final window value after the stream ends", () => {
		setTokenSpeedOptions({ endTpsBehavior: "last" });
		resetTokenRate(1_000);
		sampleTokenDelta("a".repeat(400), 2_000); // 100 tok
		sampleTokenDelta("a".repeat(400), 2_500); // 窗口 200 tok/s
		assert.equal(displayTokenRate("live"), 200);
		carryTokenRate(); // 流结束：清窗
		assert.equal(displayTokenRate("live"), 200, "last 定格最后窗口值");
		setTokenSpeedOptions({ endTpsBehavior: "average" });
		assert.equal(displayTokenRate("live"), 200 / 1.5, "average 回落整段平均");
		setTokenSpeedOptions();
	});
});
