import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { config } from "../extensions/config/config.ts";
import { bindHistoryEditor, installInputHistory } from "../extensions/feature/history/index.ts";
import { readRecent } from "../extensions/feature/history/store.ts";

const CWD = "/tmp/pi-cc-wiring-project";

interface Recorder {
	events: Map<string, Function>;
}

function mockPi(): Recorder & { pi: any } {
	const events = new Map<string, Function>();
	const pi = {
		on(name: string, handler: Function) {
			events.set(name, handler);
			return () => events.delete(name);
		},
	};
	return { events, pi };
}

function mockCtx(overrides: Record<string, unknown> = {}): any {
	return {
		mode: "tui",
		cwd: CWD,
		sessionManager: {
			getSessionDir: () => join(tmpdir(), "pi-cc-wiring-sessions"),
			getSessionFile: () => join(tmpdir(), "pi-cc-wiring-sessions", "demo-session.jsonl"),
		},
		...overrides,
	};
}

function setup() {
	const dir = join(tmpdir(), `pi-cc-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	process.env.PI_CODING_AGENT_DIR = dir;
	mkdirSync(dir, { recursive: true });
	return dir;
}

test("wiring: input 事件捕获常规指令并落盘", async () => {
	const dir = setup();
	try {
		const { events, pi } = mockPi();
		installInputHistory(pi);
		const input = events.get("input");
		assert.ok(input, "input 监听已注册");

		input({ type: "input", text: "写个快排", source: "interactive" }, mockCtx());
		input({ type: "input", text: "  再优化下边界  ", source: "interactive" }, mockCtx());
		// 非 interactive（rpc 等）不捕获
		input({ type: "input", text: "rpc 来源不应入历史", source: "rpc" }, mockCtx());
		// 斜杠与空文本不捕获
		input({ type: "input", text: "/model", source: "interactive" }, mockCtx());
		input({ type: "input", text: "   ", source: "interactive" }, mockCtx());
		// 等待 fire-and-forget 写入串行链排空
		await new Promise((r) => setTimeout(r, 50));

		const entries = await readRecent(CWD);
		assert.deepEqual(
			entries.map((e) => e.display),
			["再优化下边界", "写个快排"],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("wiring: 相邻重复只记一条", async () => {
	const dir = setup();
	try {
		const { events, pi } = mockPi();
		installInputHistory(pi);
		const input = events.get("input");
		assert.ok(input, "input 监听已注册");
		input({ type: "input", text: "npm test", source: "interactive" }, mockCtx());
		input({ type: "input", text: "npm test", source: "interactive" }, mockCtx());
		input({ type: "input", text: "ls", source: "interactive" }, mockCtx());
		input({ type: "input", text: "npm test", source: "interactive" }, mockCtx());
		await new Promise((r) => setTimeout(r, 50));

		const entries = await readRecent(CWD);
		assert.deepEqual(
			entries.map((e) => e.display),
			["npm test", "ls"],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("wiring: user_bash 保留 ! 与 !! 前缀语义", async () => {
	const dir = setup();
	try {
		const { events, pi } = mockPi();
		installInputHistory(pi);
		const bash = events.get("user_bash");
		assert.ok(bash, "user_bash 监听已注册");

		bash({ type: "user_bash", command: "pwd", excludeFromContext: false }, mockCtx());
		bash({ type: "user_bash", command: "make build", excludeFromContext: true }, mockCtx());
		bash({ type: "user_bash", command: "  ", excludeFromContext: false }, mockCtx());
		await new Promise((r) => setTimeout(r, 50));

		const entries = await readRecent(CWD);
		assert.deepEqual(
			entries.map((e) => e.display),
			["!!make build", "!pwd"],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("wiring: session_start 注入最近历史，旧→新灌入（最新落在 ↑ 首按）", async () => {
	const dir = setup();
	try {
		const { events, pi } = mockPi();
		installInputHistory(pi);
		const input = events.get("input");
		assert.ok(input, "input 监听已注册");
		input({ type: "input", text: "第一条", source: "interactive" }, mockCtx());
		input({ type: "input", text: "第二条", source: "interactive" }, mockCtx());
		input({ type: "input", text: "第三条", source: "interactive" }, mockCtx());
		await new Promise((r) => setTimeout(r, 50));

		const injected: string[] = [];
		bindHistoryEditor({ addToHistory: (text: string) => injected.push(text) });
		const start = events.get("session_start");
		assert.ok(start, "session_start 监听已注册");
		await start?.({ type: "session_start", reason: "resume" }, mockCtx());

		// 旧→新：最后注入的最新条是 ↑ 首按
		assert.deepEqual(injected, ["第一条", "第二条", "第三条"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		bindHistoryEditor(undefined);
	}
});

test("wiring: enableInputHistory=false 时完全不捕获", async () => {
	const dir = setup();
	const previous = config.enableInputHistory;
	config.enableInputHistory = false;
	try {
		const { events, pi } = mockPi();
		installInputHistory(pi);
		events.get("input")?.({ type: "input", text: "不应落盘", source: "interactive" }, mockCtx());
		events.get("user_bash")?.(
			{ type: "user_bash", command: "pwd", excludeFromContext: false },
			mockCtx(),
		);
		await new Promise((r) => setTimeout(r, 50));
		assert.deepEqual(await readRecent(CWD), []);
	} finally {
		config.enableInputHistory = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("wiring: 编辑器引用缺失时注入静默跳过（仅写不读降级）", async () => {
	const dir = setup();
	try {
		const { events, pi } = mockPi();
		installInputHistory(pi);
		bindHistoryEditor(undefined); // 模拟 enableEditorPrefix=false：插槽不在本仓库手上
		const input = events.get("input");
		assert.ok(input, "input 监听已注册");
		input({ type: "input", text: "只写不读的输入", source: "interactive" }, mockCtx());
		await new Promise((r) => setTimeout(r, 50));

		// 落盘成功
		assert.deepEqual(
			(await readRecent(CWD)).map((e) => e.display),
			["只写不读的输入"],
		);
		// 注入不抛错（session_start 正常走完）
		await events.get("session_start")?.({ type: "session_start", reason: "startup" }, mockCtx());
	} finally {
		rmSync(dir, { recursive: true, force: true });
		bindHistoryEditor(undefined);
	}
});
