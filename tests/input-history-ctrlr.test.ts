import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ReverseSearch } from "../extensions/feature/history/reverse-search.ts";
import { bindHistoryEditor, installInputHistory } from "../extensions/feature/history/index.ts";
import { config } from "../extensions/config/config.ts";

const CWD = "/tmp/pi-cc-ctrlr-project";

function setup() {
	const dir = mkdtempSync(join(tmpdir(), `pi-cc-ctrlr-${Date.now()}`));
	process.env.PI_CODING_AGENT_DIR = dir;
	return dir;
}

function mockPi() {
	const events = new Map<string, Function>();
	return {
		events,
		pi: {
			on(name: string, handler: Function) {
				events.set(name, handler);
				return () => events.delete(name);
			},
		},
	};
}

function mockCtx(uiOverrides: Record<string, unknown> = {}): any {
	return {
		mode: "tui",
		cwd: CWD,
		hasUI: true,
		sessionManager: {
			getSessionDir: () => join(tmpdir(), "pi-cc-ctrlr-sessions"),
			getSessionFile: () => undefined,
		},
		ui: {
			getEditorText: () => "",
			setEditorText: () => {},
			custom: () => new Promise(() => {}), // 默认挂起
			notify: () => {},
			...uiOverrides,
		},
	};
}

interface HistoryEditorSpy {
	addToHistory(text: string): void;
	onReverseSearch?: () => void;
}

interface EditorSpy extends HistoryEditorSpy {
	addToHistoryCalls: string[];
}

function spyEditor(): EditorSpy {
	const calls: string[] = [];
	return {
		addToHistoryCalls: calls,
		addToHistory: (t: string) => {
			calls.push(t);
		},
	};
}

test("ctrl+r: bind 时注入回调；触发后打开反搜并把选择载入编辑器", async (t) => {
	const dir = setup();
	const previous = config.enableInputHistory;
	config.enableInputHistory = true;
	t.after(() => {
		config.enableInputHistory = previous;
		rmSync(dir, { recursive: true, force: true });
	});

	const { events, pi } = mockPi();
	installInputHistory(pi as unknown as Parameters<typeof installInputHistory>[0]);

	// 先落两条历史（供反搜列表）
	events.get("input")?.({ type: "input", text: "alpha command", source: "interactive" }, mockCtx());
	events.get("input")?.({ type: "input", text: "beta command", source: "interactive" }, mockCtx());
	await new Promise((r) => setTimeout(r, 50));

	// 触发 ctrl+r：mock custom 捕获 factory，手动驱动组件。
	// 注意：session_start 传同一个带 custom 桩的 ctx（openReverseSearch 用 lastSessionCtx.ui）。
	let customCalls = 0;
	let editorText: string | undefined;
	const ctx = mockCtx({
		getEditorText: () => "beta", // 编辑器已有文本 → 作为初始过滤词
		setEditorText: (text: string) => {
			editorText = text;
		},
		custom: (factory: Function) =>
			new Promise<string | null>((resolve) => {
				customCalls++;
				const component = factory(
					{ requestRender: () => {} },
					{ fg: (_c: string, t: string) => t },
					{},
					(value: string | null) => resolve(value),
				) as ReverseSearch;
				// 编辑器已有 "beta" 作为初始过滤词 → 列表只剩 beta
				component.handleInput("\r");
			}),
	});

	const editor = spyEditor();
	events.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
	bindHistoryEditor(editor);
	await new Promise((r) => setTimeout(r, 30));
	assert.ok(typeof editor.onReverseSearch === "function", "bind 时注入 onReverseSearch 回调");
	// 注入批次也落在了编辑器（bind 回放）
	assert.ok(editor.addToHistoryCalls.includes("beta command"));

	editor.onReverseSearch?.();
	await new Promise((r) => setTimeout(r, 30));

	assert.equal(customCalls, 1, "ctx.ui.custom 打开一次");
	assert.equal(editorText, "beta command", "选择结果写回编辑器");
});

test("ctrl+r: enableInputHistory=false 时不打开反搜", async (t) => {
	const dir = setup();
	const previous = config.enableInputHistory;
	config.enableInputHistory = false;
	t.after(() => {
		config.enableInputHistory = previous;
		rmSync(dir, { recursive: true, force: true });
	});

	const { pi } = mockPi();
	installInputHistory(pi as unknown as Parameters<typeof installInputHistory>[0]);
	const editor = spyEditor();
	bindHistoryEditor(editor);

	let customCalls = 0;
	const ctx = mockCtx({
		custom: (factory: Function) =>
			new Promise<string | null>((resolve) => {
				customCalls++;
				factory({ requestRender: () => {} }, { fg: (_c: string, t: string) => t }, {}, () =>
					resolve(null),
				);
			}),
	});
	editor.onReverseSearch?.();
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(customCalls, 0, "关闭时 ctx.ui.custom 不被调用");
	void ctx;
});
