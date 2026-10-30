/**
 * Ctrl+R 反向搜索组件（方案 003 §3.6，M3 视觉对齐 Claude）。
 *
 * 布局（自上而下）：
 *   Search prompts · <scope>               ← 标题（scope 内联，ctrl+s 循环三档）
 *   ↑ 1w ago …        ┌ 预览框 ┐           ← 时间两列列表（时间正序）+ 右侧选中条目全文预览
 *   > 36m ago …       └────────┘
 *   ┌ > query▌ ┐                            ← 底部边框输入行（手工光标）
 *   ↑/↓ to navigate · Enter to use · …      ← 提示行
 *
 * scope 三档（对齐 Claude）：session（当前会话）/ project（当前项目）/ everywhere（全项目，惰性读）。
 * 数据约定：entries 为当前项目全量（**最新在前**，含 timestamp/sessionId）；
 * 列表显示为时间正序（最旧在上、最新在下），默认选中最后一行（最新）。
 *
 * 说明：不使用 pi-tui SelectList——其选中前缀硬编码为 `→` 且两列模型与「时间列+文本列」不匹配，
 * 自渲染行可精准对齐 Claude 的 `>` 前缀与 ↑ 当前会话标记。
 */
import {
	decodeKittyPrintable,
	fuzzyFilter,
	matchesKey,
	visibleWidth,
	Text,
	type Component,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { formatRelativeTime, padEndVisible, truncateVisible, wrapVisible } from "./time.ts";
import type { HistoryEntry } from "./store.ts";
import type { ReverseSearchTexts } from "./reverse-search-texts.ts";

export type HistoryScope = "session" | "project" | "everywhere";

const SCOPE_ORDER: HistoryScope[] = ["session", "project", "everywhere"];
/** 相对时间列宽（右对齐；"36m ago" 最长 7 列）。 */
const TIME_COLUMN_WIDTH = 7;
/** 标记列宽（↑ / > / 空格）。 */
const MARK_COLUMN_WIDTH = 2;
/** 预览框宽度下限。 */
const PREVIEW_MIN_WIDTH = 28;
/** body 区在组件渲染行中的起始偏移（divider 1 行 + header 1 行）。 */
const BODY_OFFSET = 2;

export interface ReverseSearchOptions {
	/** 当前项目全量条目，**最新在前**（含 timestamp/sessionId）。 */
	entries: HistoryEntry[];
	/** 当前会话文件名（session scope 过滤 + ↑ 标记）；未持久化会传 undefined。 */
	currentSessionId?: string;
	/** 打开时编辑器已有文本作为初始过滤词。 */
	initialQuery: string;
	/** everywhere scope 的惰性加载器（第一次切到才调用）。 */
	loadEverywhere: () => Promise<HistoryEntry[]>;
	/** 界面文案（按当前语言组装）。 */
	texts: ReverseSearchTexts;
	/** 初始 scope（默认 session）。 */
	initialScope?: HistoryScope;
	/** 列表可见行数（预览框总高 = 该值，含上下边框）。 */
	visibleRows: number;
	tui: TUI;
	accentColor: (text: string) => string;
	dimColor: (text: string) => string;
	toolColor: (text: string) => string;
	borderColor: (text: string) => string;
	done: (value: string | null) => void;
	/** 当前时间（测试注入）。 */
	now?: number;
}

export class ReverseSearch implements Component {
	private readonly options: ReverseSearchOptions;
	private readonly visibleRows: number;
	private query: string;
	private scope: HistoryScope;
	private everywhereEntries: HistoryEntry[] | undefined;
	private loadingEverywhere = false;
	private selectedIndex = 0;
	/** 最近一次 press 是否改变了选中：pi-tui 同一物理单击会连发 press+click，
	 *  首击的 click 只负责确认选中，同项再击（press 未改选中）才确认使用。 */
	private pressChangedSelection = false;
	/** 鼠标悬停行（displayEntries 索引）；预览框跟随 hover，离开列表区清除。 */
	private hoverIndex: number | undefined;
	private readonly header: Text;
	private readonly hint: Text;
	private renderWidth = 80;

	constructor(options: ReverseSearchOptions) {
		this.options = options;
		this.visibleRows = Math.max(3, Math.min(20, Math.round(options.visibleRows)));
		this.scope = options.initialScope ?? "session";
		this.query = options.initialQuery.trim();
		this.header = new Text("", 1, 0);
		this.hint = new Text("", 1, 0);
		// 默认选中最后一行（最新）；displayEntries 为时间正序，窗口贴底使最新行首屏可见
		this.selectedIndex = Math.max(0, this.displayEntries().length - 1);
		this.resetWindow(this.displayEntries().length);
		this.refreshHeader();
		this.refreshHint();
	}

	/** scope 过滤后的条目（最新在前）。 */
	private scopedEntries(): HistoryEntry[] {
		if (this.scope === "session") {
			return this.options.entries.filter((e) => e.sessionId === this.options.currentSessionId);
		}
		if (this.scope === "everywhere") return this.everywhereEntries ?? [];
		return this.options.entries;
	}

	/** 查询过滤 + 时间正序（最旧在上，Claude 口径）。 */
	private displayEntries(): HistoryEntry[] {
		const list = this.scopedEntries();
		const filtered =
			this.query.trim().length === 0
				? list
				: fuzzyFilter(list, this.query.trim(), (e) => e.display);
		return [...filtered].sort((a, b) => a.timestamp - b.timestamp);
	}

	/**
	 * 滚动窗口起点（增量滚动，对齐 Claude）：选中行在窗口内自由移动（可到中间），
	 * 只有越出窗口边缘时窗口才滚动一行；过滤/scope 变化时重置为贴底（选中最新）。
	 */
	private windowStart = 0;

	private clampWindow(len: number): void {
		const vis = this.visibleRows;
		this.windowStart = Math.max(0, Math.min(this.windowStart, Math.max(0, len - vis)));
		if (this.selectedIndex < this.windowStart) this.windowStart = this.selectedIndex;
		if (this.selectedIndex >= this.windowStart + vis)
			this.windowStart = this.selectedIndex - vis + 1;
	}

	private resetWindow(len: number): void {
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, len - 1));
		this.windowStart = Math.max(0, len - this.visibleRows);
	}

	/**
	 * 列表行标记列（对齐 Claude 滚动指示语义）：
	 * 选中行 `>`（优先）；窗口首行且上方还有内容 `↑`；窗口末行且下方还有内容 `↓`；其余空格。
	 */
	private rowMark(
		index: number,
		start: number,
		end: number,
		total: number,
		isSelected: boolean,
	): string {
		if (isSelected) return ">";
		if (index === start && start > 0) return "↑";
		if (index === end - 1 && end < total) return "↓";
		return " ";
	}

	/** 列表行：`<mark> <time>  <text>`；选中行原色，非选中 dim。 */
	private formatRow(
		entry: HistoryEntry,
		index: number,
		start: number,
		end: number,
		total: number,
		width: number,
	): string {
		const now = this.options.now ?? Date.now();
		const time = padEndVisible(formatRelativeTime(entry.timestamp, now), TIME_COLUMN_WIDTH);
		const isSelected = index === this.selectedIndex;
		const mark = this.rowMark(index, start, end, total, isSelected);
		const textWidth = Math.max(8, width - TIME_COLUMN_WIDTH - MARK_COLUMN_WIDTH - 2);
		const color = isSelected ? this.options.toolColor : this.options.dimColor;
		const plain = truncateVisible(entry.display.replace(/\s+/g, " ").trim(), textWidth);
		// 选中行加粗（真实终端增强高亮；纯文本 stub 下无视觉差）
		const text = isSelected ? `\x1b[1m${plain}\x1b[22m` : color(plain);
		return `${mark} ${time}  ${text}`;
	}

	/**
	 * 预览框行（含上下边框）。顶线与标题行同行（上移一行利用空闲行），
	 * 总高 = height（调用方传 visibleRows + 1）：1 顶线 + (height-2) 内容 + 1 底线。
	 */
	private previewLines(height: number, previewWidth: number): string[] {
		const inner = Math.max(4, previewWidth - 4);
		const border = this.options.borderColor;
		const lines: string[] = [border(`┌${"─".repeat(previewWidth - 2)}┐`)];
		const hovered =
			this.hoverIndex !== undefined ? this.displayEntries()[this.hoverIndex] : undefined;
		const content = (hovered ?? this.displayEntries()[this.selectedIndex])?.display ?? "";
		const wrapped = wrapVisible(content, inner, Math.max(1, height - 2));
		for (let i = 0; i < height - 2; i++) {
			lines.push(border(`│`) + " " + padEndVisible(wrapped[i] ?? "", inner) + " " + border(`│`));
		}
		lines.push(border(`└${"─".repeat(previewWidth - 2)}┘`));
		return lines;
	}

	private layout(): { listWidth: number; previewWidth: number } {
		const previewWidth = Math.min(
			Math.max(PREVIEW_MIN_WIDTH, Math.floor(this.renderWidth * 0.42)),
			Math.max(0, this.renderWidth - 26),
		);
		const listWidth = Math.max(20, this.renderWidth - previewWidth - 1);
		return { listWidth, previewWidth };
	}

	private refreshHeader(): void {
		this.header.setText(
			`${this.options.accentColor(this.options.texts.title)} ${this.options.dimColor("·")} ${this.options.toolColor(this.options.texts.scopeLabels[this.scope])}`,
		);
	}

	private refreshHint(): void {
		this.hint.setText(this.options.dimColor(this.options.texts.hint));
	}

	render(width: number): string[] {
		this.renderWidth = width;
		this.refreshHeader();
		const { listWidth, previewWidth } = this.layout();

		const entries = this.displayEntries();
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, entries.length - 1));
		this.clampWindow(entries.length);
		const start = this.windowStart;
		const end = Math.min(entries.length, start + this.visibleRows);
		const listLines: string[] = [];
		const HOVER_BG = "\x1b[48;2;58;63;75m"; // hover 行背景（暗灰蓝）
		for (let i = start; i < end; i++) {
			const row = this.formatRow(entries[i], i, start, end, entries.length, listWidth);
			// hover 背景覆盖整行宽（含文本后的空白），行尾恢复默认背景
			listLines.push(
				this.hoverIndex === i ? `${HOVER_BG}${padEndVisible(row, listWidth)}\x1b[49m` : row,
			);
		}
		if (entries.length === 0) {
			listLines.push(this.options.dimColor(`  ${this.options.texts.noMatch}`));
		}
		while (listLines.length < this.visibleRows) listLines.push("");
		const preview = this.previewLines(this.visibleRows + 1, previewWidth);

		// 并排拼行：左列表 + 右预览框；预览框顶线在 header 行（preview[0]），内容从 preview[1] 起
		const body: string[] = [];
		const pad = " ".repeat(Math.max(0, width - listWidth - previewWidth));
		for (let i = 0; i < this.visibleRows; i++) {
			const left = padEndVisible(listLines[i] ?? "", listWidth);
			body.push(left + pad + (preview[i + 1] ?? ""));
		}
		const headerLines = this.header.render(width);
		// Text.render 会把行 pad 到全宽：先 trimEnd 恢复真实长度再补空，
		// 否则行超宽被 pi-tui 截断、行尾的预览框顶线整条丢失（实测）。
		const headerText =
			headerLines.length > 0 ? truncateVisible(headerLines[0].trimEnd(), listWidth) : "";
		const headerRow = padEndVisible(headerText, listWidth) + pad + (preview[0] ?? "");

		// 输入行：全宽边框盒，❯ 提示符 + 查询词（空时显示 Filter history… 占位）+ 手工光标 ▌
		const bodyWidth = Math.max(10, width - 2); // 两侧竖线之间
		const placeholder = this.options.dimColor(this.options.texts.placeholder);
		const queryCapped = truncateVisible(this.query, Math.max(4, bodyWidth - 6));
		const bodyText =
			queryCapped.length > 0 ? `${this.options.toolColor(queryCapped)}▌` : `▌${placeholder}`;
		const content = `${this.options.accentColor("❯")} ${bodyText}`;
		const contentPadded = padEndVisible(content, bodyWidth - 2); // 两侧各留 1 空格
		const inputLines = [
			this.options.borderColor(`┌${"─".repeat(bodyWidth)}┐`),
			`${this.options.borderColor("│")} ${contentPadded} ${this.options.borderColor("│")}`,
			this.options.borderColor(`└${"─".repeat(bodyWidth)}┘`),
		];

		this.refreshHint();
		// 顶部全宽隔离横线：反搜区与上方聊天区分隔（对齐 Claude）
		const divider = this.options.borderColor("─".repeat(width));
		return [divider, headerRow, ...body, ...inputLines, ...this.hint.render(width)];
	}

	/**
	 * 鼠标（对齐 pi-tui SelectList 语义；仅 fullscreen 等启用鼠标上报的模式会产生事件）：
	 * wheel 滚动选中；press 点击选中；同项再击（新一次 press+click 且选中未变）才确认使用（done）。
	 * pi-tui 对同一次单击先发 press 再发 click，故首击的 click 不得触发 done。hover 不改选中。
	 * 列表数据行的组件局部行号 = event.y - BODY_OFFSET。
	 */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const entries = this.displayEntries();
		if (entries.length === 0) return undefined;
		if (event.type === "wheel" && event.wheelDelta) {
			const delta = event.wheelDelta < 0 ? -1 : 1;
			const previous = this.selectedIndex;
			this.selectedIndex = Math.max(0, Math.min(entries.length - 1, previous + delta));
			this.clampWindow(entries.length);
			const changed = this.selectedIndex !== previous;
			if (changed) this.options.tui.requestRender();
			return { handled: true, render: changed };
		}
		// hover（move/drag）：行背景高亮 + 预览跟随；不改键盘选中（对齐 Claude）
		const hoverStart = this.windowStart;
		if (event.type === "move" || event.type === "drag") {
			const hoverRow = event.y - BODY_OFFSET;
			const valid =
				hoverRow >= 0 && hoverRow < this.visibleRows && hoverStart + hoverRow < entries.length;
			const idx = valid ? hoverStart + hoverRow : undefined;
			if (this.hoverIndex !== idx) {
				this.hoverIndex = idx;
				this.options.tui.requestRender();
			}
			return { handled: true, render: true };
		}
		const localRow = event.y - BODY_OFFSET;
		if (localRow < 0 || localRow >= this.visibleRows) return undefined;
		const itemIndex = this.windowStart + localRow;
		if (itemIndex >= entries.length) return undefined;
		if (event.button !== "left" || (event.type !== "press" && event.type !== "click"))
			return undefined;
		if (event.type === "press") {
			this.pressChangedSelection = this.selectedIndex !== itemIndex;
			if (this.pressChangedSelection) {
				this.selectedIndex = itemIndex;
				this.clampWindow(entries.length);
				this.options.tui.requestRender();
			}
			this.hoverIndex = itemIndex;
			return { handled: true, focus: true };
		}
		// 同一次单击的 click（press 刚改过选中）：只确认选中，不触发 done
		if (this.pressChangedSelection) {
			this.pressChangedSelection = false;
			this.selectedIndex = itemIndex;
			return { handled: true, focus: true };
		}
		this.selectedIndex = itemIndex;
		const entry = entries[itemIndex];
		if (entry) this.options.done(entry.display);
		return { handled: true };
	}

	handleInput(data: string): void {
		// 括号粘贴：整段并入查询词
		if (data.startsWith("\x1b[200~")) {
			this.query += data.replace("\x1b[200~", "").replace("\x1b[201~", "").replace(/\s+/g, " ");
			this.selectedIndex = Math.max(0, this.displayEntries().length - 1);
			return;
		}
		if (matchesKey(data, "escape")) {
			this.options.done(null);
			return;
		}
		if (matchesKey(data, "return") || matchesKey(data, "enter")) {
			const entries = this.displayEntries();
			const entry = entries[Math.min(this.selectedIndex, entries.length - 1)];
			this.options.done(entry ? entry.display : null);
			return;
		}
		if (matchesKey(data, "ctrl+s")) {
			this.switchScope(SCOPE_ORDER[(SCOPE_ORDER.indexOf(this.scope) + 1) % SCOPE_ORDER.length]);
			return;
		}
		if (matchesKey(data, "tab")) {
			this.switchScope(
				SCOPE_ORDER[
					(SCOPE_ORDER.indexOf(this.scope) + SCOPE_ORDER.length - 1) % SCOPE_ORDER.length
				],
			);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "down")) {
			const len = this.displayEntries().length;
			const delta = matchesKey(data, "up") ? -1 : 1;
			this.selectedIndex = Math.max(0, Math.min(len - 1, this.selectedIndex + delta));
			this.clampWindow(len);
			this.options.tui.requestRender();
			return;
		}
		if (matchesKey(data, "backspace")) {
			if (this.query.length > 0) {
				this.query = Array.from(this.query).slice(0, -1).join("");
				this.resetWindow(this.displayEntries().length);
			}
			return;
		}
		const typed = decodeKittyPrintable(data) ?? data;
		if (typed && !/\p{Cc}/u.test(typed)) {
			this.query += typed;
			this.resetWindow(this.displayEntries().length);
			this.hoverIndex = undefined;
		}
	}

	invalidate(): void {}

	/** scope 变化/惰性数据到位后：定位最新一条并贴底（与打开时一致）。 */
	private jumpToLatest(): void {
		this.selectedIndex = Math.max(0, this.displayEntries().length - 1);
		this.resetWindow(this.displayEntries().length);
	}

	private switchScope(next: HistoryScope): void {
		if (this.scope === next) return;
		this.scope = next;
		this.hoverIndex = undefined;
		if (next === "everywhere" && !this.everywhereEntries && !this.loadingEverywhere) {
			this.loadingEverywhere = true;
			void this.options
				.loadEverywhere()
				.then((entries) => {
					this.everywhereEntries = entries;
				})
				.catch(() => {
					this.everywhereEntries = [];
				})
				.finally(() => {
					this.loadingEverywhere = false;
					this.jumpToLatest();
					this.options.tui.requestRender();
				});
		}
		this.jumpToLatest();
		this.options.tui.requestRender();
	}
}
