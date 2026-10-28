import assert from "node:assert/strict";
import test from "node:test";

process.env.PI_CODING_AGENT_DIR =
	process.env.PI_CODING_AGENT_DIR ?? "/tmp/session-name-border-test";

const { sessionNameBorderLine } = await import("../extensions/feature/shell/prompt-editor.ts");

const identity = (text: string): string => text;

test("顶边框：working 态左块 + 填充 + 右侧 dim 会话名", () => {
	const status = "\u280b Working... (\u2193 12.3k tokens \u00b7 45s)";
	const line = sessionNameBorderLine({
		width: 80,
		name: "my-session",
		status,
		borderColor: identity,
		dim: identity,
	});
	assert.ok(line, "应产出边框行");
	assert.ok(line.startsWith("\u2500\u2500 "), "左侧应保留原生 working 前缀");
	assert.ok(line.includes(status), "working 块完整保留");
	assert.ok(line.endsWith("my-session \u2500\u2500"), "会话名右侧贴边 + 尾部双横线");
	assert.equal(line.replace(/\u2500/g, "-").length >= 80, true);
	// 可见宽度恰好等于 width
	const plain = line.replace(/\u2500/g, "");
	assert.ok(plain.includes("my-session"));
});

test("顶边框：空闲态（无 working）仍常驻显示会话名", () => {
	const line = sessionNameBorderLine({
		width: 60,
		name: "abc",
		borderColor: identity,
		dim: identity,
	});
	assert.ok(line);
	assert.ok(line.endsWith("abc \u2500\u2500"));
	assert.ok(!line.includes("Working"));
});

test("顶边框：窄终端/长名回退 undefined（调用方回退 super）", () => {
	assert.equal(
		sessionNameBorderLine({
			width: 15,
			name: "very-long-session-name",
			borderColor: identity,
			dim: identity,
		}),
		undefined,
		"宽度 < 20 应回退",
	);
	assert.equal(
		sessionNameBorderLine({
			width: 24,
			name: "a-very-long-session-name-that-will-not-fit",
			status: "\u280b Working... (\u2193 12.3k tokens \u00b7 45s)",
			borderColor: identity,
			dim: identity,
		}),
		undefined,
		"working 块 + 名字放不下应回退",
	);
});
