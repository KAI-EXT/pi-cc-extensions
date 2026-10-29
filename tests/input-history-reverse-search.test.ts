import assert from "node:assert/strict";
import test from "node:test";
import type { TUI } from "@earendil-works/pi-tui";
import type { HistoryEntry } from "../extensions/feature/history/store.ts";
import { ReverseSearch } from "../extensions/feature/history/reverse-search.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const tui = { requestRender: () => {} } as unknown as TUI;

/** 构造条目（minAgo：多少分钟前），sessionId 缺省为当前会话 s-current。 */
function entry(minAgo: number, display: string, sessionId = "s-current"): HistoryEntry {
	return { display, sessionId, timestamp: NOW - minAgo * 60_000 };
}

interface Setup {
	component: ReverseSearch;
	render: () => string;
	/** 仅 body 区（列表+预览框），排除提示行对 ↑/↓ 字样的污染。 */
	renderBody: () => string;
	done: () => string | null;
	loadEverywhereCalls: () => number;
}

function setup(
	entries: HistoryEntry[],
	initialQuery = "",
	currentSessionId = "s-current",
	initialScope: "session" | "project" | "everywhere" = "session",
): Setup {
	let result: string | null = null;
	let loadEverywhereCalls = 0;
	const component = new ReverseSearch({
		entries,
		currentSessionId,
		initialQuery,
		visibleRows: 8,
		initialScope,
		texts: {
			title: "Search prompts",
			scopeLabels: { session: "session", project: "project", everywhere: "everywhere" },
			hint: "↑/↓ to navigate · Enter to use · Esc to cancel · ctrl+s to scope",
			placeholder: "Filter history…",
			noMatch: "No matching prompts",
		},
		loadEverywhere: () => {
			loadEverywhereCalls++;
			return Promise.resolve([...entries, entry(1, "everywhere-only")]);
		},
		tui,
		accentColor: (t) => t,
		dimColor: (t) => t,
		toolColor: (t) => t,
		borderColor: (t) => t,
		done: (value) => {
			result = value;
		},
		now: NOW,
	});
	return {
		component,
		/** 全渲染（含标题/输入行/提示行）。 */
		render: () => component.render(120).join("\n"),
		/** 仅 body 区（列表+预览框），排除提示行对 ↑/↓ 字样的污染。 */
		renderBody: () => component.render(120).join("\n").split("\n").slice(1, 13).join("\n"),
		done: () => result,
		loadEverywhereCalls: () => loadEverywhereCalls,
	};
}

test("渲染：project scope 下标题/时间列/> 选中最新一条", () => {
	const s = setup(
		[entry(36, "最新指令"), entry(6 * 60, "六小时前"), entry(7 * 24 * 60, "一周前", "s-other")],
		"",
		"s-current",
		"project",
	);
	const out = s.render();
	assert.ok(out.includes("Search prompts · project"), "标题与 scope（project）");
	assert.ok(out.includes("36m ago"), "相对时间");
	assert.ok(out.includes("6h ago"), "6h ago");
	assert.ok(out.includes("1w ago"), "1w ago");
	assert.ok(out.includes("> 36m ago"), "选中行 > 前缀且默认选中最新");
	// 时间正序（最旧在上）：1w ago 行位于 36m ago 行之前
	assert.ok(out.indexOf("1w ago") < out.indexOf("36m ago"));
});

test("增量滚动：选中可离底上移；越出窗口边缘才滚动一行；↑/↓ 指示随窗口边界", () => {
	const entries = Array.from({ length: 12 }, (_, i) => entry(i + 1, `条目 ${i + 1}`));
	// 初始选中最新（窗口贴底）：首行上方有内容 → ↑；末行下方无内容 → 无 ↓
	const s = setup(entries);
	const body = s.renderBody();
	assert.ok(body.includes("↑ "), "首行 ↑（上方还有内容）");
	assert.ok(!body.includes("↓ "), "末行下方无内容时不显示 ↓");
	assert.ok(body.includes("> 1m ago"), "选中行 >（初始贴底）");
	// ↑×1：选中离底上移一行（窗口不动，选中仍在窗口内），↑ 仍在（上方还有内容）
	s.component.handleInput("\x1b[A");
	const after1 = s.renderBody();
	assert.ok(after1.includes("> 2m ago"), "选中离底上移");
	assert.ok(after1.includes("↑ "), "窗口上方仍有内容，↑ 保留");
	assert.ok(!after1.includes("↓ "), "窗口贴底，无 ↓");
	// ↑×11：选中到达列表第一行（最旧），窗口到顶 → 无 ↑；下方仍有条目 → ↓ 保留
	for (let i = 0; i < 11; i++) s.component.handleInput("\x1b[A");
	const top = s.renderBody();
	assert.ok(top.includes("> 12m ago"), "选中到达列表第一行（最旧）");
	assert.ok(!top.includes("↑ "), "窗口到顶后无 ↑");
	assert.ok(top.includes("↓ "), "下方仍有条目，↓ 保留");
	// ↓×1：窗口仍贴顶 → 末行下方有内容 → ↓ 出现，选中行 > 在条目 11
	s.component.handleInput("\x1b[B");
	const down = s.renderBody();
	assert.ok(down.includes("↓ "), "窗口贴顶时末行 ↓（下方还有内容）");
	assert.ok(down.includes("> 11m ago"), "选中下移一行");
	// 无滚动时（3 条全可见）不出现 ↑/↓
	const small = setup([entry(3, "a"), entry(2, "b"), entry(1, "c")]);
	assert.ok(!small.renderBody().includes("↑ "));
	assert.ok(!small.renderBody().includes("↓ "));
});

test("渲染：右侧预览框显示选中条目完整文本", () => {
	const long = "很长的一条指令".repeat(20); // 远超单行截断宽
	const s = setup([entry(5, long), entry(2, "短指令")]);
	const out = s.render();
	assert.ok(out.includes("┌"), "预览框上边框");
	assert.ok(out.includes("└"), "预览框下边框");
	assert.ok(out.includes("很长的一条指令"), "完整文本（不受列表单行截断限制）");
});

test("渲染：底部输入行含初始查询与光标，提示行含 ctrl+s", () => {
	const s = setup([entry(1, "x")], "skil");
	const out = s.render();
	assert.ok(out.includes("skil▌"), "查询词 + 手工光标");
	assert.ok(out.includes("ctrl+s to scope"));
	assert.ok(out.includes("Enter to use"));
});

test("过滤：输入字符增量过滤，保持时间正序", () => {
	const s = setup([entry(10, "git status"), entry(5, "git push origin"), entry(2, "npm test")]);
	s.component.handleInput("git");
	const out = s.render();
	assert.ok(out.includes("git status"));
	assert.ok(!out.includes("npm test"));
	// 正序：status(10min) 在 push(5min) 之前
	assert.ok(out.indexOf("git status") < out.indexOf("git push"));
});

test("↑↓：选中移动，Enter 返回选中条目", () => {
	const s = setup([entry(30, "oldest"), entry(10, "middle"), entry(1, "newest")]);
	// 初始选中最新（最后一行）
	s.component.handleInput("\r");
	assert.equal(s.done(), "newest");
	const s2 = setup([entry(30, "oldest"), entry(10, "middle"), entry(1, "newest")]);
	s2.component.handleInput("\x1b[A"); // ↑ → middle
	s2.component.handleInput("\r");
	assert.equal(s2.done(), "middle");
});

test("默认 scope = session；ctrl+s 循环 session→project→everywhere，惰性加载一次", async () => {
	const s = setup([entry(10, "cur-session", "s-current"), entry(5, "other-session", "s-other")]);
	// session（默认）：只剩当前会话
	let out = s.render();
	assert.ok(out.includes("Search prompts · session"), "默认 session");
	assert.ok(out.includes("cur-session"));
	assert.ok(!out.includes("other-session"));
	// → project：两条都有
	s.component.handleInput("\x13"); // ctrl+s
	out = s.render();
	assert.ok(out.includes("Search prompts · project"));
	assert.ok(out.includes("other-session"));
	// → everywhere：惰性加载
	s.component.handleInput("\x13");
	await new Promise((r) => setTimeout(r, 10));
	out = s.render();
	assert.ok(out.includes("everywhere-only"));
	assert.equal(s.loadEverywhereCalls(), 1);
	// → session：不重复加载
	s.component.handleInput("\x13");
	await new Promise((r) => setTimeout(r, 10));
	assert.equal(s.loadEverywhereCalls(), 1);
});

test("Esc：返回 null", () => {
	const s = setup([entry(1, "x")]);
	s.component.handleInput("\x1b");
	assert.equal(s.done(), null);
});

test("visibleRows: 预览框总高与列表行数对应", () => {
	const entries = Array.from({ length: 12 }, (_, i) => entry(i + 1, `条目 ${i + 1}`));
	const s = setup(entries);
	const lines = s.component.render(150).join("\n").split("\n");
	// 结构：divider 1 + header 1 + body 8 + input 3 + hint 1 = 14
	assert.equal(lines.length, 14);
	// 预览框顶线在 header 行（标题右侧），底线在 body 末行；内容行数 = 可见行数 - 1
	assert.ok(lines[1].includes("┌"), "header 行含预览框顶线");
	const body = lines.slice(2, 10);
	assert.ok(body[7].includes("└"), "body 末行 = 预览框底边框");
	for (let i = 0; i < 7; i++) assert.ok(body[i].includes("│"), `body[${i}] 含框竖线`);
});

test("鼠标：wheel 滚动选中、press 点击选中、click 确认使用", () => {
	const entries = [
		entry(50, "oldest"),
		entry(20, "middle"),
		entry(1, "newest"),
	];
	const s = setup(entries);
	const ev = (type: string, y: number, extra: Record<string, unknown> = {}) =>
		({
			type,
			button: "left",
			x: 0,
			y,
			screenX: 0,
			screenY: 0,
			width: 150,
			height: 20,
			shift: false,
			alt: false,
			ctrl: false,
			...extra,
		}) as Parameters<ReverseSearch["handleMouse"]>[0];
	const renderBody = () => s.renderBody();

	// 初始选中最新（index 2，条目 newest）
	s.component.handleMouse(ev("wheel", 0, { wheelDelta: -3 })); // 向上滚 → 选中上移
	assert.ok(renderBody().includes("> 20m ago"), "wheel 上滚选中 middle");

	// press：点击 body 第一数据行（y = BODY_OFFSET 2 → index 0 oldest）
	s.component.handleMouse(ev("press", 2));
	assert.ok(renderBody().includes("> 50m ago"), "press 选中 oldest");
	// click 同位置 → 确认使用
	s.component.handleMouse(ev("click", 2));
	assert.equal(s.done(), "oldest");
});

test("鼠标：click 列表区域外（body 偏移之上）不触发", () => {
	const s = setup([entry(1, "only")]);
	s.component.handleMouse({ type: "click", button: "left", x: 0, y: 0, screenX: 0, screenY: 0, width: 150, height: 20, shift: false, alt: false, ctrl: false } as Parameters<ReverseSearch["handleMouse"]>[0]);
	assert.equal(s.done(), null);
});

test("hover：move 高亮行 + 预览跟随；不改键盘选中；出界清除", () => {
	const entries = [
		entry(30, "oldest-entry"),
		entry(20, "hover-target"),
		entry(1, "newest-entry"),
	];
	const s = setup(entries);
	const ev = (type: string, y: number, button = "none") =>
		({ type, button, x: 0, y, screenX: 0, screenY: 0, width: 150, height: 20, shift: false, alt: false, ctrl: false }) as Parameters<ReverseSearch["handleMouse"]>[0];
	const renderBody = () => s.renderBody();

	// 初始选中最新（newest），预览显示选中条目
	assert.ok(renderBody().includes("newest-entry"));

	// move 到列表第一数据行（y = BODY_OFFSET 2 → index 0 oldest）：背景色出现 + 预览跟随
	s.component.handleMouse(ev("move", 2));
	const out = s.renderBody();
	assert.ok(out.includes("\x1b[48;2;"), "hover 行背景色");
	assert.ok(out.includes("oldest-entry"), "预览跟随 hover 行（显示 oldest 全文）");
	// 键盘选中未被 hover 改变（> 仍在 newest）
	assert.ok(out.includes("> 1m ago"), "选中不变");

	// move 出列表区（y=0 标题行）→ 清除高亮，预览回选中条目
	s.component.handleMouse(ev("move", 0));
	const cleared = s.renderBody();
	assert.ok(!cleared.includes("\x1b[48;2;"), "出界清除背景");
	assert.ok(cleared.includes("newest-entry"), "预览回选中条目");

	// move 到越界的 body 行（超出条目数）→ 不高亮
	s.component.handleMouse(ev("move", 9));
	assert.ok(!s.renderBody().includes("\x1b[48;2;"), "空行不触发 hover");
});

test("hover：查询变化时清除 hover", () => {
	const s = setup([entry(10, "abc"), entry(5, "abd")]);
	s.component.handleMouse({ type: "move", button: "none", x: 0, y: 2, screenX: 0, screenY: 0, width: 150, height: 20, shift: false, alt: false, ctrl: false } as Parameters<ReverseSearch["handleMouse"]>[0]);
	s.component.handleInput("e");
	const out = s.renderBody();
	assert.ok(!out.includes("\x1b[48;2;"), "查询变化后 hover 清除");
});
