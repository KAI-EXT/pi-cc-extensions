/**
 * 输入框 `❯` 提示符（issue #68）。
 *
 * `PromptEditor` 继承 `CustomEditor`：pi 的 setCustomEditorComponent 会自动接线
 * onSubmit/onChange/actionHandlers/autocomplete/工作状态指示器，本扩展只管渲染。
 *
 * `❯ ` 恒占左侧 2 列：渲染前把 paddingX 抬到「用户值 + 2」（直接改字段绕过
 * setter，避免每帧 requestRender 自激），渲染后恢复。首内容行前两列换成
 * `❯ `，其后仍保留用户 editorPaddingX 的空格。
 * `❯` 颜色直接用 `borderColor`，随 thinking 等级 / bash mode 自动联动。
 *
 * `userPaddingX` 记录渲染时读到的用户 editorPaddingX（pi 通过 setPaddingX
 * 同步进本编辑器），footer 用 `inputTextIndent()` 对齐输入文本起始列：
 * 前缀开 = userPaddingX + 2，关 = userPaddingX。
 */
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { config } from "../../config/config.ts";
import { bindHistoryEditor } from "../history/index.ts";

/** `❯ ` 固定 2 列：glyph + 尾随空格。 */
const PROMPT_GLYPH = "❯";
const PROMPT_COLS = 2;

/** 最近一次 render 读到的用户 editorPaddingX；未启用过提示符时为 0。 */
let userPaddingX = 0;

/** 输入文本起始列：footer 按它对齐。 */
export function inputTextIndent(): number {
	return config.enableEditorPrefix ? userPaddingX + PROMPT_COLS : userPaddingX;
}

// ── 会话名称：输入框顶边框右侧（Working 同行）──

/** 会话名来源：applyPromptEditor 时从 ctx 注入，渲染时实时读取。 */
let sessionNameSource: (() => string | undefined) | undefined;

/** app 主题（ctx.ui.theme）：会话名 dim 色用；编辑器自带 theme（EditorTheme）无 fg。 */
let appTheme: { fg?: (color: string, text: string) => string } | undefined;

export function setEditorTheme(
	theme: { fg?: (color: string, text: string) => string } | undefined,
): void {
	appTheme = theme;
}

export function setSessionNameSource(source: () => string | undefined): void {
	sessionNameSource = source;
}

function currentSessionName(): string | undefined {
	try {
		return sessionNameSource?.();
	} catch {
		// 会话替换/reload 后旧 ctx 失效会拖错；视作无名，回退纯边框。
		return undefined;
	}
}

/**
 * 顶边框组合：左侧 Working 块（原生样式）+ 填充 + 右侧 dim 会话名。
 * 放不下（填充 < 2 列）返回 undefined，调用方回退 super 的原生边框。
 * 纯函数：宽度与 ANSI 均由入参给定，可单测。
 */
export function sessionNameBorderLine(opts: {
	width: number;
	name: string;
	status?: string;
	borderColor: (text: string) => string;
	dim: (text: string) => string;
}): string | undefined {
	const { width, borderColor, dim } = opts;
	if (width < 20) return undefined;
	// 名字上限：min(40 列, 40% 宽度)；空名则放弃。
	const name =
		visibleWidth(opts.name) > 0
			? truncateName(opts.name, Math.min(40, Math.floor(width * 0.4)))
			: "";
	if (!name) return undefined;
	const status = opts.status ?? "";
	const statusWidth = visibleWidth(status);
	const left = statusWidth > 0 ? borderColor("── ") + status + borderColor(" ") : "";
	const leftWidth = statusWidth > 0 ? 3 + statusWidth + 1 : 0;
	const right = borderColor(" ") + dim(name) + borderColor(" ──");
	const rightWidth = visibleWidth(name) + 4;
	const fill = width - leftWidth - rightWidth;
	if (fill < 2) return undefined;
	return left + borderColor("─".repeat(fill)) + right;
}

/** 按显示宽度截断（不切 ANSI——名字应为纯文本，此处仅防御）。 */
function truncateName(name: string, maxWidth: number): string {
	if (visibleWidth(name) <= maxWidth) return name;
	let out = "";
	for (const char of name) {
		if (visibleWidth(out + char) > maxWidth) break;
		out += char;
	}
	return out.trimEnd();
}

export class PromptEditor extends CustomEditor {
	/** Ctrl+R 反向搜索钩子（history 模块经 bindHistoryEditor 注入回调；为空时不拦截）。 */
	onReverseSearch?: () => void;

	/**
	 * Ctrl+R 打开输入历史反向搜索；其余按键全部透传原生编辑器。
	 */
	override handleInput(data: string): void {
		// 功能关闭时不拦截 Ctrl+R（避免吞键导致原生行为失效）；
		// openReverseSearch 内部另有同条件守卫与重入保护。
		if (this.onReverseSearch && config.enableInputHistory && matchesKey(data, "ctrl+r")) {
			this.onReverseSearch();
			return;
		}
		super.handleInput(data);
	}

	/**
	 * 顶边框：左侧保留原生 Working 嵌入，右侧追加 dim 会话名（常驻，风格 A 极简）。
	 * 行数溢出提示（↑ N more 居中）、无会话名、宽度不足时回退原生边框。
	 */
	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (hiddenLineCount > 0 || !config.showSessionName || config.sessionNamePosition !== "border") {
			return super.renderTopBorder(width, hiddenLineCount);
		}
		const name = currentSessionName()?.trim();
		if (!name) return super.renderTopBorder(width, hiddenLineCount);

		const self = this as unknown as {
			workingStatusIndicator?: { renderInBorder(width: number): string } | undefined;
		};
		// dim 取 app 主题（ctx.ui.theme 注入）；编辑器 theme（EditorTheme）只有 borderColor。
		const dim = (text: string): string => (appTheme?.fg ? appTheme.fg("dim", text) : text);
		let status: string | undefined;
		if (this.embedWorkingStatus && self.workingStatusIndicator) {
			try {
				const raw = self.workingStatusIndicator.renderInBorder(Math.max(1, width - 5));
				if (visibleWidth(raw) > 0) status = raw;
			} catch {
				// 指示器会话失效等异常：按空闲态渲染。
			}
		}
		const line = sessionNameBorderLine({
			width,
			name,
			status,
			borderColor: (text) => this.borderColor(text),
			dim,
		});
		return line ?? super.renderTopBorder(width, hiddenLineCount);
	}

	render(width: number): string[] {
		// ❯ + 用户 padding：文本从 userPaddingX+2 列开始。
		const self = this as unknown as { paddingX: number };
		const saved = self.paddingX;
		userPaddingX = saved;
		self.paddingX = saved + PROMPT_COLS;
		try {
			const lines = super.render(width);
			// 布局：lines[0] 顶边框，lines[1..n-2] 内容，lines[n-1] 底边框（autocomplete 在底边框后追加，
			// 首内容行恒为 index 1）。开头是 paddingX 个纯空格，前两列换成 ❯+空格，剩余 padding 保留；
			// 续行不动——Claude Code 行为。
			if (lines.length > 2 && lines[1].startsWith("  ")) {
				lines[1] = this.borderColor(PROMPT_GLYPH) + " " + lines[1].slice(2);
			}
			return lines;
		} finally {
			self.paddingX = saved;
		}
	}
}

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];

const promptEditorFactory: EditorFactory = (tui, theme, keybindings) => {
	const editor = new PromptEditor(tui, theme, keybindings, { embedWorkingStatus: true });
	// 持久化输入历史（方案 003）：实例创建即注册引用，session_start 注入经此落到本实例。
	bindHistoryEditor(editor);
	return editor;
};

/** 是否正占着插槽；占据前的工厂用于原样还回去。 */
let active = false;
let previousEditorFactory: EditorFactory | undefined;

/**
 * 撤销本扩展占据的插槽；从未占用就不碰插槽。
 *
 * 插槽可能已经被其他扩展包在外层（pi-inline-skills 会把当前工厂再包一层），
 * 那种结构里无法只拆内层，直接还回占据前的工厂；外层扩展会在下次终端输入时
 * 自己重新包装，前缀不会因此复活。
 *
 * 例外：插槽被 pi 重置回占据前的工厂时（/new、/reload 走 resetExtensionUI），
 * 我们已经不在槽里，再写一次会把 pi 刚重置的结果又覆盖掉；此时只清状态。
 */
function releasePromptEditor(ctx: ExtensionContext): void {
	if (!active) return;
	const previous = previousEditorFactory;
	active = false;
	previousEditorFactory = undefined;
	if (ctx.ui.getEditorComponent?.() === previous) return;
	ctx.ui.setEditorComponent(previous);
}

/**
 * 应用输入框前缀；enableEditorPrefix=false 时只撤自己装的那层。
 *
 * 只在没有扩展对话框开着时调用：pi 的 setEditorComponent 会清空 editorContainer 并
 * 抢走焦点，把正在设置面板里的对话框踢出渲染树，对话框的 done() 再也走不到，
 * `ctx.ui.custom()` 的 Promise 永不落定，后续输入全部卡死。设置面板自己不做替换，
 * 等 `ctx.ui.custom()` 返回后再调本函数。
 *
 * 插槽已经装着本扩展的编辑器时直接返回：重复安装只会重建实例，丢掉撤销栈、
 * 历史等编辑器状态，还会打断其他扩展包在外层的编辑器。
 */
export function applyPromptEditor(ctx: ExtensionContext): void {
	if (!ctx?.hasUI || typeof ctx.ui?.setEditorComponent !== "function") return;
	// 会话名渲染需要 app 主题（dim 色）与实时会话名；此处注入，渲染时读取。
	setSessionNameSource(() => ctx.sessionManager?.getSessionName?.());
	const editorTheme = (
		ctx.ui as unknown as { theme?: { fg?: (color: string, text: string) => string } }
	).theme;
	setEditorTheme(editorTheme);
	if (!config.enableEditorPrefix) {
		releasePromptEditor(ctx);
		return;
	}
	const current = ctx.ui.getEditorComponent?.();
	if (current === promptEditorFactory) return;
	try {
		// pi 的插槽是硬替换、没有栈，先记住是谁占着，撤销时还回去。
		previousEditorFactory = current;
		active = true;
		ctx.ui.setEditorComponent(promptEditorFactory);
	} catch (err) {
		ctx.ui.notify(
			`prompt editor error: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
	}
}

/** 恢复本扩展占据前的编辑器；未占用时不动作。 */
export function clearPromptEditor(ctx: ExtensionContext): void {
	if (!ctx?.hasUI || typeof ctx.ui?.setEditorComponent !== "function") return;
	releasePromptEditor(ctx);
}
