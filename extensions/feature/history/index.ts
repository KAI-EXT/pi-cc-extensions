/**
 * 持久化输入历史（方案 003）。
 *
 * 捕获：`input`（interactive 常规指令）+ `user_bash`（`!`/`!!` 命令，保留前缀语义）。
 * 注入：`session_start`（任意 reason，覆盖全新/-c/--resume/运行中 /resume/reload）
 * 读取最近 250 条，把最近 100 条按旧→新灌进编辑器 ring——pi 的 addToHistory 为
 * unshift 语义，最后注入的最新条正好落在 ↑ 首按位置。
 *
 * 开关语义：
 * - `enableInputHistory=false`：本模块整体不安装，不捕获不注入（方案 §8.5）；
 * - `enableEditorPrefix=false`（插槽未由本仓库占据）：捕获照常，注入因无编辑器
 *   引用而跳过——「仅写不读」降级，插槽恢复后下次 session_start 自动补上。
 *
 * 失败静默：存储层任何异常不影响 pi 主流程。
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import { config } from "../../config/config.ts";
import { isDuplicateOfLast, isRecallableBash, isRecallableInput } from "./filter.ts";
import { appendEntry, readAllProjects, readRecent, type HistoryEntry } from "./store.ts";
import { ReverseSearch } from "./reverse-search.ts";
import type { ReverseSearchTexts } from "./reverse-search-texts.ts";
import { t } from "../../config/i18n/index.ts";
import { seedIfNeeded } from "./seed.ts";

/** 编辑器需要的最小能力面（PromptEditor 继承 CustomEditor 天然满足）。 */
export interface HistoryEditorLike {
	addToHistory(text: string): void;
	/** Ctrl+R 钩子：history 模块在绑定时注入回调；可选，缺省则编辑器不拦截 ctrl+r。 */
	onReverseSearch?: () => void;
}

/** 注入编辑器的条数：pi Editor 的 history ring 容量即 100，多注无益。 */
const INJECT_LIMIT = 100;
/** 读取条数：注入用最近 100 条，其余留给二期 Ctrl+R 直接读文件（不占内存）。 */
const READ_LIMIT = 250;

let boundEditor: HistoryEditorLike | undefined;
/** 待注入批次（旧→新）：session_start 计算，新编辑器实例绑定时自动回放。 */
let pendingInject: string[] = [];
/** 注入轮次：同实例同轮只灌一次（防 resume/reload 交替时的 ring 堆积）。 */
let injectRound = 0;
const injectedRounds = new WeakMap<object, number>();
/** 相邻去重记忆（同 display 连续提交只记一条；多窗口各自持有，跨窗口由读取侧兜底）。 */
let lastCaptured = "";
/** 二期 Ctrl+R 可直接复用的最近一次读取结果（最新在前）。 */
let cachedEntries: HistoryEntry[] = [];

/**
 * prompt-editor.ts 工厂创建编辑器实例后注册引用；
 * `/reload`、`/resume` 等重建实例时覆盖，并把待注入批次回放到新实例——
 * 修复注入批次落在被重建替换掉的旧实例上的时序问题（T7 实测发现）。
 */
export function bindHistoryEditor(editor: HistoryEditorLike | undefined): void {
	boundEditor = editor;
	if (editor) {
		editor.onReverseSearch = () => {
			void openReverseSearch();
		};
	}
	flushPendingInject();
}

/** 把待注入批次灌进当前绑定实例；同实例同轮只灌一次。 */
function flushPendingInject(): void {
	const editor = boundEditor;
	if (!editor || pendingInject.length === 0) return;
	if (injectedRounds.get(editor) === injectRound) return;
	for (const text of pendingInject) editor.addToHistory(text);
	injectedRounds.set(editor, injectRound);
}

/** 会话文件名（溯源用）；未持久化会话返回 undefined。 */
function sessionIdOf(ctx: ExtensionContext): string | undefined {
	try {
		const file = ctx.sessionManager.getSessionFile();
		return file ? basename(file) : undefined;
	} catch {
		return undefined;
	}
}

/** 最近一次 session_start 的 ctx：Ctrl+R 打开反搜时使用（每次 session_start 刷新，不跨会话滞留）。 */
let lastSessionCtx: ExtensionContext | undefined;

/** 重入守卫：对话框打开或读取历史期间忽略再次 Ctrl+R（编辑器仍收键，防叠加对话框）。 */
let reverseSearchOpen = false;

/** Ctrl+R 反向搜索：当前项目预取 + 全项目惰性；选择后 setEditorText 载入编辑器。 */
async function openReverseSearch(): Promise<void> {
	const ctx = lastSessionCtx;
	if (!ctx?.hasUI || !config.enableInputHistory || reverseSearchOpen) return;
	reverseSearchOpen = true;
	try {
		// 每次打开都重读最新：cachedEntries 只是 session_start 快照，会话内新捕获的
		// 条目不会进入其中，复用旧快照会让反搜列表缺少本会话新输入（尾部 64KB 读取很快）。
		const currentEntries = await readRecent(ctx.cwd, READ_LIMIT);
		cachedEntries = currentEntries;
		const initialQuery = ctx.ui.getEditorText().trim();
		const texts: ReverseSearchTexts = {
			title: t("reverseSearch.title"),
			scopeLabels: {
				session: t("reverseSearch.scope.session"),
				project: t("reverseSearch.scope.project"),
				everywhere: t("reverseSearch.scope.everywhere"),
			},
			hint: t("reverseSearch.hint"),
			placeholder: t("reverseSearch.placeholder"),
			noMatch: t("reverseSearch.noMatch"),
		};
		const result = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
			const fg = (color: "accent" | "dim" | "toolOutput" | "border", text: string): string => {
				try {
					return theme.fg(color, text);
				} catch {
					return text;
				}
			};
			return new ReverseSearch({
				entries: currentEntries,
				currentSessionId: sessionIdOf(ctx),
				initialQuery,
				texts,
				loadEverywhere: async () => await readAllProjects(500),
				visibleRows: config.inputHistoryVisibleRows,
				tui,
				accentColor: (text) => fg("accent", text),
				dimColor: (text) => fg("dim", text),
				toolColor: (text) => fg("toolOutput", text),
				borderColor: (text) => fg("border", text),
				done,
			});
		});
		if (result) ctx.ui.setEditorText(result);
	} catch {
		// 反搜失败静默（编辑器保持原文本）
	} finally {
		reverseSearchOpen = false;
	}
}

/** session_start 注入：seed（首次）→ 读最近 → 旧→新灌进编辑器 ring。 */
async function injectHistory(ctx: ExtensionContext): Promise<void> {
	if (!config.enableInputHistory) return;
	if (ctx.mode !== "tui") return;
	// 注入不再直接依赖 boundEditor：批次挂在模块上，当前实例立即灌，
	// 之后任何重建的新实例由 bindHistoryEditor 回放（插槽未占据时批次保留，等恢复后补灌）。
	try {
		await seedIfNeeded(ctx.cwd, ctx.sessionManager.getSessionDir());
		const entries = await readRecent(ctx.cwd, READ_LIMIT);
		cachedEntries = entries;
		// 旧→新批次挂到模块上；当前实例立即灌，之后任何重建的新实例由 bind 回放。
		pendingInject = entries
			.slice(0, INJECT_LIMIT)
			.map((e) => e.display)
			.reverse();
		injectRound++;
		flushPendingInject();
	} catch {
		// 历史注入失败不影响会话启动
	}
}

/** 安装捕获与注入监听（extensions/index.ts 顶层调用一次）。 */
export function installInputHistory(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => {
		if (!config.enableInputHistory) return;
		if (event.source !== "interactive") return;
		const text = event.text.trim();
		if (!isRecallableInput(text)) return;
		if (isDuplicateOfLast(text, lastCaptured)) return;
		lastCaptured = text;
		appendQuietly(ctx, text);
	});

	pi.on("user_bash", (event, ctx) => {
		if (!config.enableInputHistory) return;
		const command = event.command.trim();
		if (!isRecallableBash(command)) return;
		const display = `${event.excludeFromContext === true ? "!!" : "!"}${command}`;
		if (isDuplicateOfLast(display, lastCaptured)) return;
		lastCaptured = display;
		appendQuietly(ctx, display);
	});

	// 返回注入 promise：pi 侧无需 await，测试侧可等待同步；injectHistory 内部已全静默
	pi.on("session_start", (_event, ctx) => {
		lastSessionCtx = ctx;
		// 返回 promise：pi 侧可不 await（injectHistory 内部全静默），测试侧可等待同步。
		return injectHistory(ctx);
	});
}

/** 落盘（fire-and-forget）；appendEntry 内部串行化且永不 reject。 */
function appendQuietly(ctx: ExtensionContext, display: string): void {
	try {
		void appendEntry(ctx.cwd, {
			display,
			sessionId: sessionIdOf(ctx),
			timestamp: Date.now(),
		});
	} catch {
		// 捕获失败静默
	}
}

/** 仅供二期 Ctrl+R 与测试观察；常规路径不消费。 */
export function getCachedEntries(): HistoryEntry[] {
	return cachedEntries;
}
