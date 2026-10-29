/**
 * /ccstyle 配置面板 UI。
 *
 * 渲染副作用（applyStyleMode / refreshCurrentTranscript）由 renderer 经
 * CcstylePanelHooks 注入，避免 config → renderer 循环依赖。
 */
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Input, SettingsList, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { CompactThinkingController } from "../feature/compact-thinking.ts";
import {
	applyCustomFooter,
	clearCustomFooter,
	getFooterStatusSnapshot,
	refreshFooterGitStats,
} from "../feature/shell/footer.ts";
import {
	FOOTER_CURRENCY_PRESETS,
	presetFooterCurrencyRate,
} from "../feature/shell/footer-currency.ts";
import {
	footerLineOfKey,
	formatFooterChipSummary,
	orderedFooterKeys,
	reorderFooterKey,
	resolveFooterChipLayout,
	shiftFooterKeyLine,
	toggleFooterKeyHidden,
	type FooterChipLayout,
} from "../feature/shell/footer-layout.ts";
import { applyPromptEditor, clearPromptEditor } from "../feature/shell/prompt-editor.ts";
import { applyStartupHeader, clearStartupHeader } from "../feature/shell/startup-header.ts";
import { setTokenSpeedOptions } from "../feature/shell/token-rate.ts";
import {
	resolveTokenSpeed,
	TOKEN_SPEED_DISPLAYS,
	type TokenSpeedConfig,
	type TokenSpeedCountStrategy,
	type TokenSpeedDisplay,
	type TokenSpeedEndTpsBehavior,
	type TokenSpeedTier,
} from "../feature/shell/token-speed-config.ts";
import type { ToolGroupingHooks } from "../renderer/tool/grouping.ts";
import {
	AGENT_SUMMARY_KEY_VALUES,
	config,
	DEFAULT_CONFIG,
	DIFF_COLLAPSED_LINES_VALUES,
	DIFF_INDICATOR_MODES,
	DIFF_SPLIT_MIN_WIDTH_VALUES,
	DIFF_VIEW_MODES,
	EXPANDED_INPUT_MAX_LINES_VALUES,
	EXPANDED_OUTPUT_MAX_LINES_VALUES,
	EXPANDED_PREVIEW_MAX_LINES_VALUES,
	FOOTER_GIT_STATS_MODES,
	FOOTER_TOKEN_RATE_MODES,
	formatExcludeRenderers,
	getCompactThinkingConfig,
	PANEL_LANGUAGES,
	SESSION_NAME_POSITIONS,
	pickPositiveInt,
	pickPositiveNumber,
	pickToolLabelClip,
	SCROLL_BUTTON_MODES,
	THINKING_ANIMATION_INTERVAL_VALUES,
	THINKING_PREVIEW_LINES_VALUES,
	INPUT_HISTORY_ROWS_VALUES,
	TOOL_LABEL_CLIP_VALUES,
	WRITE_DIFF_COLLAPSED_LINES_VALUES,
	updateConfig,
	type CompactStyleMode,
	type Config,
	type DiffIndicatorMode,
	type DiffViewMode,
	type FooterGitStatsMode,
	type FooterTokenRateMode,
	type PanelLanguage,
	type ScrollButtonMode,
	type SessionNamePosition,
	isExcludedRenderer,
	mergeExcludeRendererCandidates,
	withExcludeRendererToggle,
} from "./config.ts";
import { t, type LocaleKey } from "./i18n/index.ts";
import { PI_USAGE_KEY, footerChipSource } from "../feature/shell/footer-layout.ts";

/** renderer 注入的渲染副作用，面板自身不触碰渲染状态。 */
export type CcstylePanelHooks = {
	applyStyleMode: (mode: CompactStyleMode, ctx: any, toolGrouping?: ToolGroupingHooks) => void;
	refreshCurrentTranscript: (ctx?: any, toolGrouping?: ToolGroupingHooks) => void;
};

function modeSettingDescription(mode: CompactStyleMode): string {
	if (mode === "compact") return t("mode.desc.compact");
	if (mode === "off") return t("mode.desc.off");
	return t("mode.desc.on");
}

function excludeRenderersDescription(names: readonly string[]): string {
	return names.length === 0
		? t("excludeRenderers.desc.none")
		: t("excludeRenderers.desc.some", { names: names.join(", ") });
}

function customFooterDescription(enabled: boolean): string {
	return enabled ? t("enableCustomFooter.desc.on") : t("enableCustomFooter.desc.off");
}

function footerTokenRateDescription(enabled: boolean): string {
	return enabled ? t("footerTokenRate.desc.on") : t("footerTokenRate.desc.off");
}

function footerTokenRateModeDescription(mode: FooterTokenRateMode): string {
	return mode === "live"
		? t("footerTokenRateMode.desc.live")
		: t("footerTokenRateMode.desc.average");
}

function footerTokenRateTtftDescription(enabled: boolean): string {
	return enabled ? t("footerTokenRateTtft.desc.on") : t("footerTokenRateTtft.desc.off");
}

function footerGitStatsDescription(mode: FooterGitStatsMode): string {
	return mode === "branch"
		? t("footerGitStatsMode.desc.branch")
		: t("footerGitStatsMode.desc.working");
}

/** Footer chips 子面板描述：内置芯片标签走 i18n，其余用来源 key 模板（避免 footer-layout → i18n 循环依赖）。 */
const FOOTER_CHIP_LABEL_KEYS: Record<string, LocaleKey> = {
	model: "footerChip.model",
	context: "footerChip.context",
	cache: "footerChip.cache",
	rate: "footerChip.rate",
	cost: "footerChip.cost",
	cwd: "footerChip.cwd",
	git: "footerChip.git",
	"total-tokens": "footerChip.totalTokens",
};

function footerChipDescriptionLocalized(key: string, liveText: string): string {
	const labelKey = FOOTER_CHIP_LABEL_KEYS[key];
	const builtin = labelKey ? t(labelKey) : undefined;
	if (builtin) {
		const live = liveText.trim();
		return live ? `${builtin} · ${live}` : builtin;
	}
	const source = footerChipSource(key);
	const live = liveText.trim();
	if (live) return t("footerChip.from", { live, source });
	if (key === PI_USAGE_KEY) return t("footerChip.piUsageNoText", { source });
	return t("footerChip.fromInactive", { source });
}

function pluginChipsDescription(): string {
	return t("footerPluginChips.desc", { summary: formatFooterChipSummary(config) });
}

function footerLayoutFromConfig(): FooterChipLayout {
	return {
		footerHiddenKeys: config.footerHiddenKeys,
		footerLine1Keys: config.footerLine1Keys,
		footerLine2Keys: config.footerLine2Keys,
		footerLine3Keys: config.footerLine3Keys,
	};
}

function persistFooterLayout(layout: FooterChipLayout): void {
	updateConfig({
		footerHiddenKeys: layout.footerHiddenKeys,
		footerLine1Keys: layout.footerLine1Keys,
		footerLine2Keys: layout.footerLine2Keys,
		footerLine3Keys: layout.footerLine3Keys,
	});
}

function footerChipItem(
	key: string,
	layout: FooterChipLayout,
	snapshot: ReadonlyMap<string, string>,
) {
	const line = footerLineOfKey(layout, key) ?? 2;
	const hidden = layout.footerHiddenKeys.includes(key);
	const live = snapshot.get(key)?.trim() ?? "";
	return {
		id: key,
		label: key,
		description: footerChipDescriptionLocalized(key, live),
		currentValue: hidden
			? t("footerChips.item.value.hidden", { n: line })
			: t("footerChips.item.value.line", { n: line }),
	};
}

function buildFooterChipsSubmenu(
	onClose: () => void,
	onLiveChange: () => void,
): {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
} {
	const snapshot = () => getFooterStatusSnapshot();
	const resolved = () => resolveFooterChipLayout(footerLayoutFromConfig(), [...snapshot().keys()]);
	const items: ReturnType<typeof footerChipItem>[] = [];
	const rebuildItems = (layout: FooterChipLayout, selectedKey?: string) => {
		const next = orderedFooterKeys(layout).map((key) => footerChipItem(key, layout, snapshot()));
		items.length = 0;
		items.push(...next);
		if (!selectedKey) return 0;
		const index = items.findIndex((item) => item.id === selectedKey);
		return index >= 0 ? index : 0;
	};
	rebuildItems(resolved());
	const list = new SettingsList(
		items,
		Math.min(8, Math.max(4, items.length)),
		getSettingsListTheme(),
		() => {},
		() => onClose(),
		{ enableSearch: false },
	);
	const listState = list as unknown as { selectedIndex: number; items: typeof items };

	const mutate = (transform: (layout: FooterChipLayout, key: string) => FooterChipLayout) => {
		const key = listState.items[listState.selectedIndex]?.id;
		if (!key) return;
		const next = transform(resolved(), key);
		persistFooterLayout(next);
		listState.selectedIndex = rebuildItems(
			resolveFooterChipLayout(next, [...snapshot().keys()]),
			key,
		);
		onLiveChange();
	};

	return {
		// 过滤 SettingsList 内置英文 hint，与主面板口径一致（底部提示由嵌套方渲染）。
		render: (width: number) => stripSettingsListHint(list.render(width)),
		invalidate: () => list.invalidate(),
		handleInput: (data: string) => {
			if (matchesKey(data, "left")) {
				mutate((layout, key) => shiftFooterKeyLine(layout, key, -1));
				return;
			}
			if (matchesKey(data, "right")) {
				mutate((layout, key) => shiftFooterKeyLine(layout, key, 1));
				return;
			}
			if (data === "[") {
				mutate((layout, key) => reorderFooterKey(layout, key, -1));
				return;
			}
			if (data === "]") {
				mutate((layout, key) => reorderFooterKey(layout, key, 1));
				return;
			}
			if (data === " " || matchesKey(data, "space")) {
				mutate((layout, key) => toggleFooterKeyHidden(layout, key));
				return;
			}
			list.handleInput(data);
		},
	};
}

function diffViewModeDescription(mode: DiffViewMode): string {
	if (mode === "split") return t("diffViewMode.desc.split");
	if (mode === "unified") return t("diffViewMode.desc.unified");
	return t("diffViewMode.desc.auto");
}

function diffIndicatorDescription(mode: DiffIndicatorMode): string {
	if (mode === "classic") return t("diffIndicatorMode.desc.classic");
	if (mode === "none") return t("diffIndicatorMode.desc.none");
	return t("diffIndicatorMode.desc.bars");
}

/** 额外功能开关项：on/off 二值，描述随状态切换；切换后需重启生效。 */
function featureToggleSetting(
	id: string,
	labelKey: LocaleKey,
	onKey: LocaleKey,
	offKey: LocaleKey,
	current: boolean,
) {
	const setting = {
		id,
		label: t(labelKey),
		description: t(current ? onKey : offKey),
		currentValue: current ? "on" : "off",
		values: ["on", "off"],
	};
	return {
		setting,
		apply(on: boolean): void {
			setting.currentValue = on ? "on" : "off";
			setting.description = t(on ? onKey : offKey);
		},
		/** 语言切换后重算本行文案（label + 随当前状态的描述）。 */
		retranslate(): void {
			setting.label = t(labelKey);
			setting.description = t(setting.currentValue === "on" ? onKey : offKey);
		},
	};
}

function buildExcludeRenderersSubmenu(
	onClose: () => void,
	onLiveChange: () => void,
): {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
} {
	// 候选与名单按大小写不敏感合并：存过 Agent 时不再多出一行 agent。
	const candidates = mergeExcludeRendererCandidates(config.excludeRenderers);
	const items = candidates.map((name) => ({
		id: name,
		label: name,
		description: t("excludeRenderers.item.desc", { name }),
		currentValue: isExcludedRenderer(name, config.excludeRenderers) ? "exclude" : "style",
		values: ["style", "exclude"],
	}));
	const list = new SettingsList(
		items,
		Math.min(8, Math.max(4, items.length)),
		getSettingsListTheme(),
		(id: string, value: string) => {
			updateConfig({
				excludeRenderers: withExcludeRendererToggle(
					config.excludeRenderers,
					id,
					value === "exclude",
				),
			});
			onLiveChange();
		},
		() => onClose(),
		{ enableSearch: candidates.length > 8 },
	);
	return {
		render: (width: number) => {
			const lines = stripSettingsListHint(list.render(width));
			lines.push("");
			lines.push(truncateToWidth(t("hint.excludeFooter"), width));
			return lines;
		},
		invalidate: () => list.invalidate(),
		handleInput: (data: string) => list.handleInput(data),
	};
}

function agentSummaryKeysDescription(keys: readonly string[]): string {
	return t("agentSummaryKeys.desc", {
		count: keys.length,
		total: AGENT_SUMMARY_KEY_VALUES.length,
	});
}

/** agentSummaryKeys 段开关子面板：按 canonical 顺序列出全部段，禁用即从数组移除，至少保留一段。 */
function buildAgentSummaryKeysSubmenu(
	onClose: () => void,
	onLiveChange: () => void,
): {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
} {
	const items = AGENT_SUMMARY_KEY_VALUES.map((key) => ({
		id: key,
		label: key,
		description: t("agentSummaryKeys.item.desc", { key }),
		currentValue: config.agentSummaryKeys.includes(key) ? "on" : "off",
		values: ["on", "off"],
	}));
	const list = new SettingsList(
		items,
		Math.min(8, Math.max(4, items.length)),
		getSettingsListTheme(),
		(key: string, value: string) => {
			const enabled = new Set(config.agentSummaryKeys);
			if (value === "on") {
				enabled.add(key);
			} else {
				// 至少保留一段：拒绝关闭最后一段，恢复该行显示。
				if (enabled.size <= 1) {
					const item = items.find((candidate) => candidate.id === key);
					if (item) item.currentValue = "on";
					return;
				}
				enabled.delete(key);
			}
			// 段顺序即渲染顺序：重排回 canonical 顺序，禁用的从数组移除。
			updateConfig({
				agentSummaryKeys: AGENT_SUMMARY_KEY_VALUES.filter((candidate) => enabled.has(candidate)),
			});
			onLiveChange();
		},
		() => onClose(),
		{ enableSearch: false },
	);
	return {
		render: (width: number) => {
			const lines = stripSettingsListHint(list.render(width));
			lines.push("");
			lines.push(truncateToWidth(t("hint.agentSummaryFooter"), width));
			return lines;
		},
		invalidate: () => list.invalidate(),
		handleInput: (data: string) => list.handleInput(data),
	};
}

function footerCurrencyRateLabel(rate: number | null): string {
	return rate === null ? "-" : String(rate);
}

/**
 * 手动输入子面板。accept 返回字符串则提交，undefined 取消，null 用 invalid 提示。
 */
function buildValueInputSubmenu(
	theme: any,
	options: {
		prompt: string;
		initial: string;
		hint: string;
		accept: (raw: string) => string | null | undefined;
		invalid?: (raw: string) => string;
	},
	closeSubmenu: (selected?: string) => void,
): {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
} {
	const input = new Input();
	let error = "";
	input.setValue(options.initial);
	input.onSubmit = (value: string) => {
		const raw = value.trim();
		const next = options.accept(raw);
		if (next === undefined) {
			closeSubmenu();
			return;
		}
		if (next === null) {
			error = options.invalid?.(raw) ?? "Invalid value";
			return;
		}
		closeSubmenu(next);
	};
	input.onEscape = () => closeSubmenu();
	return {
		render: (width: number) => {
			const safe = Math.max(0, Math.floor(width));
			const lines = [
				theme.fg("dim", options.prompt),
				...input.render(safe),
				truncateToWidth(theme.fg("dim", options.hint), safe),
			];
			if (error !== "") lines.push(theme.fg("dim", `  ${error}`));
			return lines;
		},
		invalidate: () => {},
		handleInput: (data: string) => input.handleInput(data),
	};
}
/** 数值项：预填当前值，空输入取消，非数字留下错误。 */
function buildNumberInputSubmenu(
	theme: any,
	setting: { label: string; currentValue: string },
	closeSubmenu: (selected?: string) => void,
) {
	return buildValueInputSubmenu(
		theme,
		{
			prompt: t("input.prompt.number", { label: setting.label }),
			initial: setting.currentValue,
			hint: t("input.hint.generic"),
			accept: (raw) => (raw === "" ? undefined : Number.isFinite(Number(raw)) ? raw : null),
			invalid: (raw) => t("input.error.number", { raw }),
		},
		closeSubmenu,
	);
}

/** tokenSpeed 面板行：setting 交给 SettingsList，refresh 在写回后从 config 重读 currentValue/description。 */
function tokenSpeedRow(
	id: string,
	label: string,
	readCurrent: () => string,
	describe: () => string,
	extra: {
		values?: string[];
		submenu?: (current: string, closeSubmenu: (selected?: string) => void) => unknown;
	} = {},
) {
	const setting = { id, label, description: describe(), currentValue: readCurrent(), ...extra };
	return {
		setting,
		refresh(): void {
			setting.currentValue = readCurrent();
			setting.description = describe();
		},
	};
}

// ── tokenSpeed（pi-token-speed 配置族）面板预设与文案 ─────────────────────

/** 图标预设循环首项：none 表示空串（无图标）。 */
const TOKEN_SPEED_ICON_PRESETS = ["none", "⚡", "🔥", "💨", "🚀"];
const TOKEN_SPEED_WINDOW_PRESETS = ["1000", "3000", "5000", "10000", "15000"];
/** 预设色循环：四档默认色 + 常见色（面板无颜色编辑先例，按预设循环交互）。 */
const TOKEN_SPEED_COLOR_PRESETS = [
	"#ff4444",
	"#ff8844",
	"#ffaa00",
	"#ffdd44",
	"#00ff88",
	"#44ddff",
	"#8888ff",
	"#ff66ff",
	"#ffffff",
	"#888888",
];
/** 四档阈值预设；写回时经 clampTokenSpeedThreshold 收敛，保持严格升序。 */
const TOKEN_SPEED_THRESHOLD_PRESETS: Record<TokenSpeedTier, string[]> = {
	slow: ["0", "5", "10", "15", "20"],
	medium: ["10", "15", "20", "25", "30"],
	fast: ["20", "30", "40", "50", "60"],
	blazing: ["40", "45", "60", "90", "120"],
};
const TOKEN_SPEED_TIERS: readonly TokenSpeedTier[] = ["slow", "medium", "fast", "blazing"];

/** 档位行的面板 id：tokenSpeedThresholdSlow / tokenSpeedColorBlazing 等。 */
const tokenSpeedTierId = (prefix: string, tier: TokenSpeedTier): string =>
	`${prefix}${tier[0].toUpperCase()}${tier.slice(1)}`;

function tokenSpeedDisplayDescription(display: TokenSpeedDisplay): string {
	if (display === "legacy") return t("tokenSpeedDisplay.desc.legacy");
	if (display === "tps") return t("tokenSpeedDisplay.desc.tps");
	if (display === "ttft") return t("tokenSpeedDisplay.desc.ttft");
	if (display === "stats") return t("tokenSpeedDisplay.desc.stats");
	return t("tokenSpeedDisplay.desc.full");
}

function tokenSpeedCountStrategyDescription(strategy: TokenSpeedCountStrategy): string {
	return strategy === "direct"
		? t("tokenSpeedCountStrategy.desc.direct")
		: t("tokenSpeedCountStrategy.desc.estimate");
}

function tokenSpeedEndTpsDescription(behavior: TokenSpeedEndTpsBehavior): string {
	return behavior === "last"
		? t("tokenSpeedEndTpsBehavior.desc.last")
		: t("tokenSpeedEndTpsBehavior.desc.average");
}

/**
 * 单档阈值写回：阈值必须严格升序（normalizeThresholds 整块校验，非法整块回落默认），
 * 编辑单档时向相邻档收敛，保证写回永远合法。
 */
function clampTokenSpeedThreshold(
	speed: TokenSpeedConfig,
	tier: TokenSpeedTier,
	raw: string,
): TokenSpeedConfig["thresholds"] {
	const value = Math.max(0, Math.floor(Number(raw) || 0));
	const t = speed.thresholds;
	switch (tier) {
		case "slow":
			return { ...t, slow: Math.min(value, t.medium - 1) };
		case "medium":
			return { ...t, medium: Math.min(Math.max(value, t.slow + 1), t.fast - 1) };
		case "fast":
			return { ...t, fast: Math.min(Math.max(value, t.medium + 1), t.blazing - 1) };
		case "blazing":
			return { ...t, blazing: Math.max(value, t.fast + 1) };
	}
}

/** tokenSpeed 面板行 id → 配置字段补丁；非编辑行返回 undefined。 */
function tokenSpeedPatch(
	speed: TokenSpeedConfig,
	id: string,
	value: string,
): Partial<TokenSpeedConfig> | undefined {
	const thresholdTier = TOKEN_SPEED_TIERS.find(
		(tier) => tokenSpeedTierId("tokenSpeedThreshold", tier) === id,
	);
	if (thresholdTier) return { thresholds: clampTokenSpeedThreshold(speed, thresholdTier, value) };
	const colorTier = TOKEN_SPEED_TIERS.find(
		(tier) => tokenSpeedTierId("tokenSpeedColor", tier) === id,
	);
	if (colorTier) return { colors: { ...speed.colors, [colorTier]: value } };
	switch (id) {
		case "tokenSpeedDisplay":
			return { display: value as TokenSpeedDisplay };
		case "tokenSpeedIcon":
			return { icon: value === "none" ? "" : value };
		case "tokenSpeedCountStrategy":
			return { countStrategy: value as TokenSpeedCountStrategy };
		case "tokenSpeedEndTpsBehavior":
			return { endTpsBehavior: value as TokenSpeedEndTpsBehavior };
		case "tokenSpeedSlidingWindow":
			return { slidingWindow: Number(value) };
		default:
			return undefined;
	}
}

/** Section tabs for /ccstyle — matches Zentui-style "A / B / C" headers. */
type CcstyleSection = {
	id: "style" | "diff" | "thinking" | "ui" | "feature" | "footer" | "tokenSpeed";
	/** 页签名存键、渲染时 t() 取词：切语言后当帧即新语言。 */
	labelKey: LocaleKey;
	items: any[];
};

function isForwardTabKey(data: string): boolean {
	return data === "\t" || matchesKey(data, "tab");
}

function isBackTabKey(data: string): boolean {
	// CSI Z is the common terminal encoding for Shift+Tab.
	return data === "\x1b[Z" || matchesKey(data, "shift+tab");
}

function renderPanelRule(theme: any, width: number): string {
	return theme.fg("dim", "─".repeat(Math.max(0, width)));
}

/** 去掉 SettingsList 自带的英文提示行；面板统一在底部渲染自己的 i18n hint。 */
function stripSettingsListHint(body: string[]): string[] {
	while (body.length > 0 && body[body.length - 1] === "") body.pop();
	const hintIndex = body.findIndex(
		(line) =>
			typeof line === "string" &&
			(line.includes("Type to search") ||
				line.includes("Enter/Space to change") ||
				line.includes("Esc to cancel")),
	);
	return hintIndex >= 0 ? body.slice(0, hintIndex) : body;
}

function renderSectionTabBar(
	theme: any,
	sections: readonly { labelKey: LocaleKey }[],
	activeIndex: number,
	width: number,
): string {
	const pieces: string[] = [];
	for (let i = 0; i < sections.length; i++) {
		if (i > 0) pieces.push(theme.fg("dim", " / "));
		const label = t(sections[i]?.labelKey ?? "tab.style");
		pieces.push(
			i === activeIndex
				? theme.fg("text", typeof theme.bold === "function" ? theme.bold(label) : label)
				: theme.fg("dim", label),
		);
	}
	return truncateToWidth(pieces.join(""), Math.max(0, width));
}

export async function showCcstylePanel(
	ctx: any,
	hooks: CcstylePanelHooks,
	toolGrouping?: ToolGroupingHooks,
	compactThinking?: CompactThinkingController,
): Promise<void> {
	if (ctx?.mode !== "tui" || !ctx?.hasUI || typeof ctx.ui?.custom !== "function") {
		ctx.ui?.notify?.(t("notify.requiresTui"), "warning");
		return;
	}

	// 编辑器插槽只能在面板关闭后替换：面板自己就挂在 editorContainer 上，面板开着时调
	// setEditorComponent 会把面板踢出渲染树、done() 再也走不到，`ctx.ui.custom()` 永不落定，
	// 整个输入管线随之卡死。
	let editorPrefixChanged = false;

	await ctx.ui.custom((tui: any, theme: any, _keybindings: any, done: () => void) => {
		const modeSetting = {
			id: "mode",
			label: t("mode.label"),
			description: modeSettingDescription(config.mode),
			currentValue: config.mode,
			values: ["on", "compact", "off"],
		};
		// Tracks whether a nested submenu is open so Tab switches sections
		// only at the top level (mirrors Zentui settings: Tab = switch sections).
		let nestedSubmenuOpen = false;
		// 子面板提示只存键，渲染时 t() 取词：切语言后当帧即新语言。
		let nestedHintKey: LocaleKey | "" = "";
		const excludeSetting = {
			id: "excludeRenderers",
			label: t("excludeRenderers.label"),
			description: excludeRenderersDescription(config.excludeRenderers),
			currentValue: formatExcludeRenderers(config.excludeRenderers),
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) => {
				nestedSubmenuOpen = true;
				nestedHintKey = "hint.excludeSubmenu";
				return buildExcludeRenderersSubmenu(
					() => {
						nestedSubmenuOpen = false;
						nestedHintKey = "";
						excludeSetting.currentValue = formatExcludeRenderers(config.excludeRenderers);
						excludeSetting.description = excludeRenderersDescription(config.excludeRenderers);
						closeSubmenu();
					},
					() => {
						excludeSetting.currentValue = formatExcludeRenderers(config.excludeRenderers);
						excludeSetting.description = excludeRenderersDescription(config.excludeRenderers);
						hooks.refreshCurrentTranscript(ctx);
					},
				);
			},
		};
		const toolLabelClipSetting = {
			id: "toolLabelClip",
			label: t("toolLabelClip.label"),
			description: t("toolLabelClip.desc"),
			currentValue: String(config.toolLabelClip),
			values: [...TOOL_LABEL_CLIP_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, toolLabelClipSetting, closeSubmenu),
		};
		const diffViewSetting = {
			id: "diffViewMode",
			label: t("diffViewMode.label"),
			description: diffViewModeDescription(config.diffViewMode),
			currentValue: config.diffViewMode,
			values: [...DIFF_VIEW_MODES],
		};
		const diffIndicatorSetting = {
			id: "diffIndicatorMode",
			label: t("diffIndicatorMode.label"),
			description: diffIndicatorDescription(config.diffIndicatorMode),
			currentValue: config.diffIndicatorMode,
			values: [...DIFF_INDICATOR_MODES],
		};
		const diffSplitSetting = {
			id: "diffSplitMinWidth",
			label: t("diffSplitMinWidth.label"),
			description: t("diffSplitMinWidth.desc"),
			currentValue: String(config.diffSplitMinWidth),
			values: [...DIFF_SPLIT_MIN_WIDTH_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, diffSplitSetting, closeSubmenu),
		};
		const diffCollapsedSetting = {
			id: "editDiffCollapsedLines",
			label: t("editDiffCollapsedLines.label"),
			description: t("editDiffCollapsedLines.desc"),
			currentValue: String(config.editDiffCollapsedLines),
			values: [...DIFF_COLLAPSED_LINES_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, diffCollapsedSetting, closeSubmenu),
		};
		const writeDiffCollapsedSetting = {
			id: "writeDiffCollapsedLines",
			label: t("writeDiffCollapsedLines.label"),
			description: t("writeDiffCollapsedLines.desc"),
			currentValue: String(config.writeDiffCollapsedLines),
			values: [...WRITE_DIFF_COLLAPSED_LINES_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, writeDiffCollapsedSetting, closeSubmenu),
		};
		const diffWordWrapSetting = {
			id: "diffWordWrap",
			label: t("diffWordWrap.label"),
			description: config.diffWordWrap ? t("diffWordWrap.desc.on") : t("diffWordWrap.desc.off"),
			currentValue: config.diffWordWrap ? "on" : "off",
			values: ["on", "off"],
		};
		const expandedInputSetting = {
			id: "expandedInputMaxLines",
			label: t("expandedInputMaxLines.label"),
			description: t("expandedInputMaxLines.desc"),
			currentValue: String(config.expandedInputMaxLines),
			values: [...EXPANDED_INPUT_MAX_LINES_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, expandedInputSetting, closeSubmenu),
		};
		const expandedOutputSetting = {
			id: "expandedOutputMaxLines",
			label: t("expandedOutputMaxLines.label"),
			description: t("expandedOutputMaxLines.desc"),
			currentValue: String(config.expandedOutputMaxLines),
			values: [...EXPANDED_OUTPUT_MAX_LINES_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, expandedOutputSetting, closeSubmenu),
		};
		const expandedMaxSetting = {
			id: "expandedPreviewMaxLines",
			label: t("expandedPreviewMaxLines.label"),
			description: t("expandedPreviewMaxLines.desc"),
			currentValue: String(config.expandedPreviewMaxLines),
			values: [...EXPANDED_PREVIEW_MAX_LINES_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, expandedMaxSetting, closeSubmenu),
		};
		const thinkingTitleSetting = {
			id: "useSummaryTitlesAsThinkingTitle",
			label: t("useSummaryTitlesAsThinkingTitle.label"),
			description: t("useSummaryTitlesAsThinkingTitle.desc"),
			currentValue: config.useSummaryTitlesAsThinkingTitle ? "on" : "off",
			values: ["on", "off"],
		};
		const thinkingPreviewSetting = {
			id: "previewLines",
			label: t("previewLines.label"),
			description: t("previewLines.desc"),
			currentValue: String(config.previewLines),
			values: [...THINKING_PREVIEW_LINES_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, thinkingPreviewSetting, closeSubmenu),
		};
		const thinkingAnimationSetting = {
			id: "animationIntervalMs",
			label: t("animationIntervalMs.label"),
			description: t("animationIntervalMs.desc"),
			currentValue: String(config.animationIntervalMs),
			values: [...THINKING_ANIMATION_INTERVAL_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, thinkingAnimationSetting, closeSubmenu),
		};
		const startupHeaderSetting = {
			id: "showStartupHeader",
			label: t("showStartupHeader.label"),
			description: config.showStartupHeader
				? t("showStartupHeader.desc.on")
				: t("showStartupHeader.desc.off"),
			currentValue: config.showStartupHeader ? "on" : "off",
			values: ["on", "off"],
		};
		const stickyUserMessageSetting = {
			id: "stickyUserMessage",
			label: t("stickyUserMessage.label"),
			description: config.stickyUserMessage
				? t("stickyUserMessage.desc.on")
				: t("stickyUserMessage.desc.off"),
			currentValue: config.stickyUserMessage ? "on" : "off",
			values: ["on", "off"],
		};
		const scrollButtonSetting = {
			id: "scrollButtonMode",
			label: t("scrollButtonMode.label"),
			description:
				config.scrollButtonMode === "dock"
					? t("scrollButtonMode.desc.dock")
					: t("scrollButtonMode.desc.native"),
			currentValue: config.scrollButtonMode,
			values: [...SCROLL_BUTTON_MODES],
		};
		const sessionNameSetting = {
			id: "showSessionName",
			label: t("showSessionName.label"),
			description: config.showSessionName
				? t("showSessionName.desc.on")
				: t("showSessionName.desc.off"),
			currentValue: config.showSessionName ? "on" : "off",
			values: ["on", "off"],
		};
		const sessionNamePositionSetting = {
			id: "sessionNamePosition",
			label: t("sessionNamePosition.label"),
			description:
				config.sessionNamePosition === "border"
					? t("sessionNamePosition.desc.border")
					: t("sessionNamePosition.desc.cwd"),
			currentValue: config.sessionNamePosition,
			values: [...SESSION_NAME_POSITIONS],
		};

		// 额外功能开关：注册于扩展加载期，切换后需重启（/reload）生效。
		const sessionReferenceToggle = featureToggleSetting(
			"enableSessionReference",
			"enableSessionReference.label",
			"enableSessionReference.desc.on",
			"enableSessionReference.desc.off",
			config.enableSessionReference,
		);
		const subagentAutocompleteToggle = featureToggleSetting(
			"enableSubagentAutocomplete",
			"enableSubagentAutocomplete.label",
			"enableSubagentAutocomplete.desc.on",
			"enableSubagentAutocomplete.desc.off",
			config.enableSubagentAutocomplete,
		);
		const contextCommandToggle = featureToggleSetting(
			"enableContextCommand",
			"enableContextCommand.label",
			"enableContextCommand.desc.on",
			"enableContextCommand.desc.off",
			config.enableContextCommand,
		);
		const agentSummaryToggle = featureToggleSetting(
			"enableAgentSummary",
			"enableAgentSummary.label",
			"enableAgentSummary.desc.on",
			"enableAgentSummary.desc.off",
			config.enableAgentSummary,
		);
		const agentSummaryKeysSetting = {
			id: "agentSummaryKeys",
			label: t("agentSummaryKeys.label"),
			description: agentSummaryKeysDescription(config.agentSummaryKeys),
			currentValue: config.agentSummaryKeys.join(", "),
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) => {
				nestedSubmenuOpen = true;
				nestedHintKey = "hint.agentSummarySubmenu";
				return buildAgentSummaryKeysSubmenu(
					() => {
						nestedSubmenuOpen = false;
						nestedHintKey = "";
						agentSummaryKeysSetting.currentValue = config.agentSummaryKeys.join(", ");
						agentSummaryKeysSetting.description = agentSummaryKeysDescription(
							config.agentSummaryKeys,
						);
						closeSubmenu();
					},
					() => {
						agentSummaryKeysSetting.currentValue = config.agentSummaryKeys.join(", ");
						agentSummaryKeysSetting.description = agentSummaryKeysDescription(
							config.agentSummaryKeys,
						);
						// 摘要行渲染期读 config，刷新 transcript 让段落增减立即上屏。
						hooks.refreshCurrentTranscript(ctx);
					},
				);
			},
		};
		const agentSummaryDoneDateSetting = {
			id: "agentSummaryDoneDate",
			label: t("agentSummaryDoneDate.label"),
			description: config.agentSummaryDoneDate
				? t("agentSummaryDoneDate.desc.on")
				: t("agentSummaryDoneDate.desc.off"),
			currentValue: config.agentSummaryDoneDate ? "on" : "off",
			values: ["on", "off"],
		};
		const agentSummaryItalicSetting = {
			id: "agentSummaryItalic",
			label: t("agentSummaryItalic.label"),
			description: config.agentSummaryItalic
				? t("agentSummaryItalic.desc.on")
				: t("agentSummaryItalic.desc.off"),
			currentValue: config.agentSummaryItalic ? "on" : "off",
			values: ["on", "off"],
		};
		const workingMessageToggle = featureToggleSetting(
			"enableWorkingMessage",
			"enableWorkingMessage.label",
			"enableWorkingMessage.desc.on",
			"enableWorkingMessage.desc.off",
			config.enableWorkingMessage,
		);
		const aliasesToggle = featureToggleSetting(
			"enableAliases",
			"enableAliases.label",
			"enableAliases.desc.on",
			"enableAliases.desc.off",
			config.enableAliases,
		);
		const markdownEnhanceToggle = featureToggleSetting(
			"enableMarkdownEnhance",
			"enableMarkdownEnhance.label",
			"enableMarkdownEnhance.desc.on",
			"enableMarkdownEnhance.desc.off",
			config.enableMarkdownEnhance,
		);
		const footerCurrencySetting = {
			id: "footerCurrency",
			label: t("footerCurrency.label"),
			description: t("footerCurrency.desc"),
			currentValue: config.footerCurrency,
			values: [...FOOTER_CURRENCY_PRESETS],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) => {
				nestedSubmenuOpen = true;
				nestedHintKey = "hint.currencySubmenu";
				return buildValueInputSubmenu(
					theme,
					{
						prompt: t("input.prompt.currency"),
						initial: footerCurrencySetting.currentValue,
						hint: t("input.hint.generic"),
						accept: (raw) => (raw === "" ? undefined : raw),
					},
					(selected) => {
						nestedSubmenuOpen = false;
						nestedHintKey = "";
						closeSubmenu(selected);
					},
				);
			},
		};
		const footerCurrencyRateSetting = {
			id: "footerCurrencyRate",
			label: t("footerCurrencyRate.label"),
			description: t("footerCurrencyRate.desc"),
			currentValue: footerCurrencyRateLabel(config.footerCurrencyRate),
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) => {
				nestedSubmenuOpen = true;
				nestedHintKey = "hint.rateSubmenu";
				return buildValueInputSubmenu(
					theme,
					{
						prompt: t("input.prompt.rate"),
						initial:
							footerCurrencyRateSetting.currentValue === "-"
								? ""
								: footerCurrencyRateSetting.currentValue,
						hint: t("input.hint.rate"),
						accept: (raw) => {
							if (raw === "" || raw === "-") return "-";
							const n = Number(raw);
							return Number.isFinite(n) && n > 0 ? raw : null;
						},
						invalid: () => t("input.error.rate"),
					},
					(selected) => {
						nestedSubmenuOpen = false;
						nestedHintKey = "";
						closeSubmenu(selected);
					},
				);
			},
		};
		const footerNerdIconsSetting = {
			id: "footerNerdIcons",
			label: t("footerNerdIcons.label"),
			description: config.footerNerdIcons
				? t("footerNerdIcons.desc.on")
				: t("footerNerdIcons.desc.off"),
			currentValue: config.footerNerdIcons ? "on" : "off",
			values: ["on", "off"],
		};
		const editorPrefixSetting = {
			id: "enableEditorPrefix",
			label: t("enableEditorPrefix.label"),
			description: config.enableEditorPrefix
				? t("enableEditorPrefix.desc.on")
				: t("enableEditorPrefix.desc.off"),
			currentValue: config.enableEditorPrefix ? "on" : "off",
			values: ["on", "off"],
		};
		const inputHistorySetting = {
			id: "enableInputHistory",
			label: t("enableInputHistory.label"),
			description: config.enableInputHistory
				? t("enableInputHistory.desc.on")
				: t("enableInputHistory.desc.off"),
			currentValue: config.enableInputHistory ? "on" : "off",
			values: ["on", "off"],
		};
		const inputHistoryRowsSetting = {
			id: "inputHistoryRows",
			label: t("inputHistoryRows.label"),
			description: t("inputHistoryRows.desc"),
			currentValue: String(config.inputHistoryVisibleRows),
			values: [...INPUT_HISTORY_ROWS_VALUES],
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, inputHistoryRowsSetting, closeSubmenu),
		};
		const customFooterSetting = {
			id: "enableCustomFooter",
			label: t("enableCustomFooter.label"),
			description: customFooterDescription(config.enableCustomFooter),
			currentValue: config.enableCustomFooter ? "on" : "off",
			values: ["on", "off"],
		};
		const footerGitStatsSetting = {
			id: "footerGitStatsMode",
			label: t("footerGitStatsMode.label"),
			description: footerGitStatsDescription(config.footerGitStatsMode),
			currentValue: config.footerGitStatsMode,
			values: FOOTER_GIT_STATS_MODES,
		};
		const footerTokenRateSetting = {
			id: "footerTokenRate",
			label: t("footerTokenRate.label"),
			description: footerTokenRateDescription(config.footerTokenRate),
			currentValue: config.footerTokenRate ? "on" : "off",
			values: ["on", "off"],
		};
		const footerTokenRateModeSetting = {
			id: "footerTokenRateMode",
			label: t("footerTokenRateMode.label"),
			description: footerTokenRateModeDescription(config.footerTokenRateMode),
			currentValue: config.footerTokenRateMode,
			values: FOOTER_TOKEN_RATE_MODES,
		};
		const footerTokenRateTtftSetting = {
			id: "footerTokenRateTtft",
			label: t("footerTokenRateTtft.label"),
			description: footerTokenRateTtftDescription(config.footerTokenRateTtft),
			currentValue: config.footerTokenRateTtft ? "on" : "off",
			values: ["on", "off"],
		};
		const footerTotalTokensSetting = {
			id: "footerTotalTokens",
			label: t("footerTotalTokens.label"),
			description: config.footerTotalTokens
				? t("footerTotalTokens.desc.on")
				: t("footerTotalTokens.desc.off"),
			currentValue: config.footerTotalTokens ? "on" : "off",
			values: ["on", "off"],
		};
		// tokenSpeed 编辑行：display/colors/icon 走渲染期读 config 的现有机制即时生效；
		// countStrategy/endTpsBehavior/slidingWindow 由 onSettingChange 里 setTokenSpeedOptions
		// 重注入引擎，同样即时（providerOverrides 命中时按活动模型 provider 解析）。
		const tokenSpeedDisplayRow = tokenSpeedRow(
			"tokenSpeedDisplay",
			t("tokenSpeedDisplay.label"),
			() => config.tokenSpeed.display,
			() => tokenSpeedDisplayDescription(config.tokenSpeed.display),
			{ values: [...TOKEN_SPEED_DISPLAYS] },
		);
		const tokenSpeedIconRow = tokenSpeedRow(
			"tokenSpeedIcon",
			t("tokenSpeedIcon.label"),
			() => config.tokenSpeed.icon || "none",
			() =>
				config.tokenSpeed.icon
					? t("tokenSpeedIcon.desc.set", { icon: config.tokenSpeed.icon })
					: t("tokenSpeedIcon.desc.none"),
			{ values: [...TOKEN_SPEED_ICON_PRESETS] },
		);
		const tokenSpeedCountRow = tokenSpeedRow(
			"tokenSpeedCountStrategy",
			t("tokenSpeedCountStrategy.label"),
			() => config.tokenSpeed.countStrategy,
			() => tokenSpeedCountStrategyDescription(config.tokenSpeed.countStrategy),
			{ values: ["estimate", "direct"] },
		);
		const tokenSpeedEndTpsRow = tokenSpeedRow(
			"tokenSpeedEndTpsBehavior",
			t("tokenSpeedEndTpsBehavior.label"),
			() => config.tokenSpeed.endTpsBehavior,
			() => tokenSpeedEndTpsDescription(config.tokenSpeed.endTpsBehavior),
			{ values: ["average", "last"] },
		);
		const tokenSpeedWindowRow = tokenSpeedRow(
			"tokenSpeedSlidingWindow",
			t("tokenSpeedSlidingWindow.label"),
			() => String(config.tokenSpeed.slidingWindow),
			() => t("tokenSpeedSlidingWindow.desc"),
			{ values: [...TOKEN_SPEED_WINDOW_PRESETS] },
		);
		// 阈值行同 Diff 页签数值交互：Space 循环预设，Enter 进数字输入子面板（写回时自动收敛升序）。
		const tokenSpeedThresholdRows = TOKEN_SPEED_TIERS.map((tier) => {
			const row = tokenSpeedRow(
				tokenSpeedTierId("tokenSpeedThreshold", tier),
				t("tokenSpeedThreshold.label", { tier }),
				() => String(config.tokenSpeed.thresholds[tier]),
				() => t("tokenSpeedThreshold.desc"),
				{ values: [...TOKEN_SPEED_THRESHOLD_PRESETS[tier]] },
			);
			row.setting.submenu = (_current: string, closeSubmenu: (selected?: string) => void) =>
				buildNumberInputSubmenu(theme, row.setting, closeSubmenu);
			return row;
		});
		const tokenSpeedColorRows = TOKEN_SPEED_TIERS.map((tier) =>
			tokenSpeedRow(
				tokenSpeedTierId("tokenSpeedColor", tier),
				t("tokenSpeedColor.label", { tier: `${tier[0].toUpperCase()}${tier.slice(1)}` }),
				() => config.tokenSpeed.colors[tier],
				() => t("tokenSpeedColor.desc"),
				{ values: [...TOKEN_SPEED_COLOR_PRESETS] },
			),
		);
		const tokenSpeedOverridesRow = tokenSpeedRow(
			"tokenSpeedProviderOverrides",
			t("tokenSpeedProviderOverrides.label"),
			() => {
				const providers = Object.keys(config.tokenSpeed.providerOverrides);
				return providers.length === 0 ? "none" : `${providers.length}: ${providers.join(", ")}`;
			},
			() => {
				const entries = Object.entries(config.tokenSpeed.providerOverrides);
				return entries.length === 0
					? t("tokenSpeedProviderOverrides.desc.none")
					: t("tokenSpeedProviderOverrides.desc.some", {
							entries: entries
								.map(([provider, override]) => `${provider} (${Object.keys(override).length} keys)`)
								.join(", "),
						});
			},
		);
		const tokenSpeedRows = [
			tokenSpeedDisplayRow,
			tokenSpeedIconRow,
			tokenSpeedCountRow,
			tokenSpeedEndTpsRow,
			tokenSpeedWindowRow,
			...tokenSpeedThresholdRows,
			...tokenSpeedColorRows,
			tokenSpeedOverridesRow,
		];
		// 语言设置项：label 固定双语，任何语言下都能找到这个开关；值保留枚举原样（zh/en）。
		const languageSetting = {
			id: "language",
			label: "界面语言 / Language",
			description: "面板显示语言 · Panel display language",
			currentValue: config.language,
			values: [...PANEL_LANGUAGES],
		};
		const pluginChipsSetting = {
			id: "footerPluginChips",
			label: t("footerPluginChips.label"),
			description: pluginChipsDescription(),
			currentValue: formatFooterChipSummary(config),
			submenu: (_current: string, closeSubmenu: (selected?: string) => void) => {
				nestedSubmenuOpen = true;
				nestedHintKey = "hint.footerChipsSubmenu";
				return buildFooterChipsSubmenu(
					() => {
						nestedSubmenuOpen = false;
						nestedHintKey = "";
						pluginChipsSetting.currentValue = formatFooterChipSummary(config);
						pluginChipsSetting.description = pluginChipsDescription();
						closeSubmenu();
					},
					() => {
						pluginChipsSetting.currentValue = formatFooterChipSummary(config);
						pluginChipsSetting.description = pluginChipsDescription();
					},
				);
			},
		};
		const featureToggles: Record<string, ReturnType<typeof featureToggleSetting>> = {
			enableSessionReference: sessionReferenceToggle,
			enableSubagentAutocomplete: subagentAutocompleteToggle,
			enableContextCommand: contextCommandToggle,
			enableAgentSummary: agentSummaryToggle,
			enableWorkingMessage: workingMessageToggle,
			enableAliases: aliasesToggle,
			enableMarkdownEnhance: markdownEnhanceToggle,
		};

		// ── 多语言：所有行文案集中重算。构建时执行一次；切换语言后全体重执行（方案 C 行刷新）。 ──
		const retranslateFns: Array<() => void> = [];
		const retranslate = (fn: () => void): void => {
			fn();
			retranslateFns.push(fn);
		};
		const retranslatePanel = (): void => {
			for (const fn of retranslateFns) fn();
			for (const toggle of Object.values(featureToggles)) toggle.retranslate();
			// tokenSpeed 行已有 refresh 机制（从 config 重读 currentValue/description）。
			for (const row of tokenSpeedRows) row.refresh();
		};
		retranslate(() => {
			modeSetting.label = t("mode.label");
			modeSetting.description = modeSettingDescription(config.mode);
		});
		retranslate(() => {
			excludeSetting.label = t("excludeRenderers.label");
			excludeSetting.description = excludeRenderersDescription(config.excludeRenderers);
		});
		retranslate(() => {
			toolLabelClipSetting.label = t("toolLabelClip.label");
			toolLabelClipSetting.description = t("toolLabelClip.desc");
		});
		retranslate(() => {
			diffViewSetting.label = t("diffViewMode.label");
			diffViewSetting.description = diffViewModeDescription(config.diffViewMode);
		});
		retranslate(() => {
			diffIndicatorSetting.label = t("diffIndicatorMode.label");
			diffIndicatorSetting.description = diffIndicatorDescription(config.diffIndicatorMode);
		});
		retranslate(() => {
			diffSplitSetting.label = t("diffSplitMinWidth.label");
			diffSplitSetting.description = t("diffSplitMinWidth.desc");
		});
		retranslate(() => {
			diffCollapsedSetting.label = t("editDiffCollapsedLines.label");
			diffCollapsedSetting.description = t("editDiffCollapsedLines.desc");
		});
		retranslate(() => {
			writeDiffCollapsedSetting.label = t("writeDiffCollapsedLines.label");
			writeDiffCollapsedSetting.description = t("writeDiffCollapsedLines.desc");
		});
		retranslate(() => {
			diffWordWrapSetting.label = t("diffWordWrap.label");
			diffWordWrapSetting.description = config.diffWordWrap
				? t("diffWordWrap.desc.on")
				: t("diffWordWrap.desc.off");
		});
		retranslate(() => {
			expandedInputSetting.label = t("expandedInputMaxLines.label");
			expandedInputSetting.description = t("expandedInputMaxLines.desc");
		});
		retranslate(() => {
			expandedOutputSetting.label = t("expandedOutputMaxLines.label");
			expandedOutputSetting.description = t("expandedOutputMaxLines.desc");
		});
		retranslate(() => {
			expandedMaxSetting.label = t("expandedPreviewMaxLines.label");
			expandedMaxSetting.description = t("expandedPreviewMaxLines.desc");
		});
		retranslate(() => {
			thinkingTitleSetting.label = t("useSummaryTitlesAsThinkingTitle.label");
			thinkingTitleSetting.description = t("useSummaryTitlesAsThinkingTitle.desc");
		});
		retranslate(() => {
			thinkingPreviewSetting.label = t("previewLines.label");
			thinkingPreviewSetting.description = t("previewLines.desc");
		});
		retranslate(() => {
			thinkingAnimationSetting.label = t("animationIntervalMs.label");
			thinkingAnimationSetting.description = t("animationIntervalMs.desc");
		});
		retranslate(() => {
			sessionNameSetting.label = t("showSessionName.label");
			sessionNameSetting.description = config.showSessionName
				? t("showSessionName.desc.on")
				: t("showSessionName.desc.off");
		});
		retranslate(() => {
			sessionNamePositionSetting.label = t("sessionNamePosition.label");
			sessionNamePositionSetting.description =
				config.sessionNamePosition === "border"
					? t("sessionNamePosition.desc.border")
					: t("sessionNamePosition.desc.cwd");
		});
		retranslate(() => {
			startupHeaderSetting.label = t("showStartupHeader.label");
			startupHeaderSetting.description = config.showStartupHeader
				? t("showStartupHeader.desc.on")
				: t("showStartupHeader.desc.off");
		});
		retranslate(() => {
			stickyUserMessageSetting.label = t("stickyUserMessage.label");
			stickyUserMessageSetting.description = config.stickyUserMessage
				? t("stickyUserMessage.desc.on")
				: t("stickyUserMessage.desc.off");
		});
		retranslate(() => {
			scrollButtonSetting.label = t("scrollButtonMode.label");
			scrollButtonSetting.description =
				config.scrollButtonMode === "dock"
					? t("scrollButtonMode.desc.dock")
					: t("scrollButtonMode.desc.native");
		});
		retranslate(() => {
			agentSummaryKeysSetting.label = t("agentSummaryKeys.label");
			agentSummaryKeysSetting.description = agentSummaryKeysDescription(config.agentSummaryKeys);
		});
		retranslate(() => {
			agentSummaryDoneDateSetting.label = t("agentSummaryDoneDate.label");
			agentSummaryDoneDateSetting.description = config.agentSummaryDoneDate
				? t("agentSummaryDoneDate.desc.on")
				: t("agentSummaryDoneDate.desc.off");
		});
		retranslate(() => {
			agentSummaryItalicSetting.label = t("agentSummaryItalic.label");
			agentSummaryItalicSetting.description = config.agentSummaryItalic
				? t("agentSummaryItalic.desc.on")
				: t("agentSummaryItalic.desc.off");
		});
		retranslate(() => {
			footerCurrencySetting.label = t("footerCurrency.label");
			footerCurrencySetting.description = t("footerCurrency.desc");
		});
		retranslate(() => {
			footerCurrencyRateSetting.label = t("footerCurrencyRate.label");
			footerCurrencyRateSetting.description = t("footerCurrencyRate.desc");
		});
		retranslate(() => {
			footerNerdIconsSetting.label = t("footerNerdIcons.label");
			footerNerdIconsSetting.description = config.footerNerdIcons
				? t("footerNerdIcons.desc.on")
				: t("footerNerdIcons.desc.off");
		});
		retranslate(() => {
			editorPrefixSetting.label = t("enableEditorPrefix.label");
			editorPrefixSetting.description = config.enableEditorPrefix
				? t("enableEditorPrefix.desc.on")
				: t("enableEditorPrefix.desc.off");
		});
		retranslate(() => {
			inputHistorySetting.label = t("enableInputHistory.label");
			inputHistorySetting.description = config.enableInputHistory
				? t("enableInputHistory.desc.on")
				: t("enableInputHistory.desc.off");
		});
		retranslate(() => {
			customFooterSetting.label = t("enableCustomFooter.label");
			customFooterSetting.description = customFooterDescription(config.enableCustomFooter);
		});
		retranslate(() => {
			footerGitStatsSetting.label = t("footerGitStatsMode.label");
			footerGitStatsSetting.description = footerGitStatsDescription(config.footerGitStatsMode);
		});
		retranslate(() => {
			footerTokenRateSetting.label = t("footerTokenRate.label");
			footerTokenRateSetting.description = footerTokenRateDescription(config.footerTokenRate);
		});
		retranslate(() => {
			footerTokenRateModeSetting.label = t("footerTokenRateMode.label");
			footerTokenRateModeSetting.description = footerTokenRateModeDescription(
				config.footerTokenRateMode,
			);
		});
		retranslate(() => {
			footerTokenRateTtftSetting.label = t("footerTokenRateTtft.label");
			footerTokenRateTtftSetting.description = footerTokenRateTtftDescription(
				config.footerTokenRateTtft,
			);
		});
		retranslate(() => {
			footerTotalTokensSetting.label = t("footerTotalTokens.label");
			footerTotalTokensSetting.description = config.footerTotalTokens
				? t("footerTotalTokens.desc.on")
				: t("footerTotalTokens.desc.off");
		});
		retranslate(() => {
			pluginChipsSetting.label = t("footerPluginChips.label");
			pluginChipsSetting.description = pluginChipsDescription();
		});

		const onSettingChange = (id: string, value: string) => {
			if (id === "language") {
				// 语言切换：写回后全面板行文案重算（方案 C），当帧即新语言；页签与 hint 在 render 时取词，天然即时。
				updateConfig({ language: value as PanelLanguage });
				retranslatePanel();
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "enableCustomFooter") {
				const enabled = value === "on";
				updateConfig({ enableCustomFooter: enabled });
				customFooterSetting.currentValue = enabled ? "on" : "off";
				customFooterSetting.description = customFooterDescription(enabled);
				if (enabled) applyCustomFooter(ctx);
				else clearCustomFooter(ctx);
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "footerCurrency") {
				updateConfig({
					footerCurrency: value,
					footerCurrencyRate: presetFooterCurrencyRate(value),
				});
				footerCurrencySetting.currentValue = config.footerCurrency;
				footerCurrencyRateSetting.currentValue = footerCurrencyRateLabel(config.footerCurrencyRate);
				if (config.enableCustomFooter) applyCustomFooter(ctx);
				ctx.ui.notify(
					`${t("notify.updated", { id, value: config.footerCurrency })} · ${footerCurrencyRateSetting.currentValue}`,
					"info",
				);
				return;
			}
			if (id === "footerCurrencyRate") {
				updateConfig({ footerCurrencyRate: value === "-" ? null : Number(value) });
				footerCurrencyRateSetting.currentValue = footerCurrencyRateLabel(config.footerCurrencyRate);
				if (config.enableCustomFooter) applyCustomFooter(ctx);
				ctx.ui.notify(
					t("notify.updated", { id, value: footerCurrencyRateSetting.currentValue }),
					"info",
				);
				return;
			}
			if (id === "footerGitStatsMode") {
				updateConfig({ footerGitStatsMode: value as FooterGitStatsMode });
				footerGitStatsSetting.currentValue = config.footerGitStatsMode;
				footerGitStatsSetting.description = footerGitStatsDescription(config.footerGitStatsMode);
				refreshFooterGitStats();
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "footerTokenRate") {
				const enabled = value === "on";
				updateConfig({ footerTokenRate: enabled });
				footerTokenRateSetting.currentValue = enabled ? "on" : "off";
				footerTokenRateSetting.description = footerTokenRateDescription(enabled);
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "footerTokenRateMode") {
				updateConfig({ footerTokenRateMode: value as FooterTokenRateMode });
				footerTokenRateModeSetting.currentValue = config.footerTokenRateMode;
				footerTokenRateModeSetting.description = footerTokenRateModeDescription(
					config.footerTokenRateMode,
				);
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "footerTokenRateTtft") {
				const enabled = value === "on";
				updateConfig({ footerTokenRateTtft: enabled });
				footerTokenRateTtftSetting.currentValue = enabled ? "on" : "off";
				footerTokenRateTtftSetting.description = footerTokenRateTtftDescription(enabled);
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "footerTotalTokens") {
				const enabled = value === "on";
				updateConfig({ footerTotalTokens: enabled });
				footerTotalTokensSetting.currentValue = enabled ? "on" : "off";
				footerTotalTokensSetting.description = enabled
					? t("footerTotalTokens.desc.on")
					: t("footerTotalTokens.desc.off");
				refreshFooterGitStats();
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			// tokenSpeed 配置族：整段深拷贝写回（updateConfig 会整体 normalize），行显示从 config 重读；
			// 引擎口径（countStrategy/endTpsBehavior/slidingWindow）同步重注入，providerOverrides 命中时
			// 按活动模型 provider 解析（同 session_start/model_select 的刷新口径）。
			const speedRow = tokenSpeedRows.find((row) => row.setting.id === id);
			if (speedRow) {
				const patch = tokenSpeedPatch(config.tokenSpeed, id, value);
				if (patch) {
					updateConfig({ tokenSpeed: { ...config.tokenSpeed, ...patch } });
					setTokenSpeedOptions(resolveTokenSpeed(config.tokenSpeed, ctx?.model?.provider));
					for (const row of tokenSpeedRows) row.refresh();
					hooks.refreshCurrentTranscript(ctx);
					ctx.ui.notify(t("notify.updated", { id, value: speedRow.setting.currentValue }), "info");
				}
				return;
			}
			if (id === "showSessionName") {
				const enabled = value === "on";
				updateConfig({ showSessionName: enabled });
				sessionNameSetting.currentValue = enabled ? "on" : "off";
				sessionNameSetting.description = enabled
					? t("showSessionName.desc.on")
					: t("showSessionName.desc.off");
				refreshFooterGitStats();
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "sessionNamePosition") {
				updateConfig({ sessionNamePosition: value as SessionNamePosition });
				sessionNamePositionSetting.currentValue = config.sessionNamePosition;
				sessionNamePositionSetting.description =
					config.sessionNamePosition === "border"
						? t("sessionNamePosition.desc.border")
						: t("sessionNamePosition.desc.cwd");
				refreshFooterGitStats();
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "enableEditorPrefix") {
				const enabled = value === "on";
				updateConfig({ enableEditorPrefix: enabled });
				editorPrefixSetting.currentValue = enabled ? "on" : "off";
				editorPrefixSetting.description = enabled
					? t("enableEditorPrefix.desc.on")
					: t("enableEditorPrefix.desc.off");
				editorPrefixChanged = true;
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "enableInputHistory") {
				const enabled = value === "on";
				updateConfig({ enableInputHistory: enabled });
				inputHistorySetting.currentValue = enabled ? "on" : "off";
				inputHistorySetting.description = enabled
					? t("enableInputHistory.desc.on")
					: t("enableInputHistory.desc.off");
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "inputHistoryRows") {
				updateConfig({
					inputHistoryVisibleRows: pickPositiveInt(
						value,
						DEFAULT_CONFIG.inputHistoryVisibleRows,
						4,
						20,
					),
				});
				inputHistoryRowsSetting.currentValue = String(config.inputHistoryVisibleRows);
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			if (id === "footerNerdIcons") {
				const enabled = value === "on";
				updateConfig({ footerNerdIcons: enabled });
				footerNerdIconsSetting.currentValue = enabled ? "on" : "off";
				footerNerdIconsSetting.description = enabled
					? t("footerNerdIcons.desc.on")
					: t("footerNerdIcons.desc.off");
				ctx.ui.notify(t("notify.updated", { id, value }), "info");
				return;
			}
			// 额外功能开关：字段名与配置布尔字段一一对应，切换后重启生效。
			const featureToggle = featureToggles[id];
			if (featureToggle) {
				updateConfig({ [id]: value === "on" } as Partial<Config>);
				featureToggle.apply(value === "on");
				ctx.ui.notify(t("notify.updatedRestart", { id, value }), "info");
				return;
			}
			switch (id) {
				case "toolLabelClip":
					updateConfig({
						toolLabelClip: pickToolLabelClip(value),
					});
					toolLabelClipSetting.currentValue = String(config.toolLabelClip);
					break;
				case "mode": {
					const mode = value as CompactStyleMode;
					modeSetting.description = modeSettingDescription(mode);
					hooks.applyStyleMode(mode, ctx, toolGrouping);
					return;
				}
				case "excludeRenderers":
					excludeSetting.currentValue = formatExcludeRenderers(config.excludeRenderers);
					excludeSetting.description = excludeRenderersDescription(config.excludeRenderers);
					return;
				case "diffViewMode":
					updateConfig({ diffViewMode: value as DiffViewMode });
					diffViewSetting.description = diffViewModeDescription(config.diffViewMode);
					break;
				case "diffIndicatorMode":
					updateConfig({ diffIndicatorMode: value as DiffIndicatorMode });
					diffIndicatorSetting.description = diffIndicatorDescription(config.diffIndicatorMode);
					break;
				case "diffSplitMinWidth":
					updateConfig({
						diffSplitMinWidth: pickPositiveInt(value, DEFAULT_CONFIG.diffSplitMinWidth, 40, 300),
					});
					diffSplitSetting.currentValue = String(config.diffSplitMinWidth);
					break;
				case "editDiffCollapsedLines":
					updateConfig({
						editDiffCollapsedLines: pickPositiveInt(
							value,
							DEFAULT_CONFIG.editDiffCollapsedLines,
							0,
							500,
						),
					});
					diffCollapsedSetting.currentValue = String(config.editDiffCollapsedLines);
					break;
				case "writeDiffCollapsedLines":
					updateConfig({
						writeDiffCollapsedLines: pickPositiveInt(
							value,
							DEFAULT_CONFIG.writeDiffCollapsedLines,
							0,
							500,
						),
					});
					writeDiffCollapsedSetting.currentValue = String(config.writeDiffCollapsedLines);
					break;
				case "diffWordWrap":
					updateConfig({ diffWordWrap: value === "on" });
					diffWordWrapSetting.description = config.diffWordWrap
						? t("diffWordWrap.desc.on")
						: t("diffWordWrap.desc.off");
					break;
				case "expandedInputMaxLines":
					updateConfig({
						expandedInputMaxLines: pickPositiveInt(
							value,
							DEFAULT_CONFIG.expandedInputMaxLines,
							1,
							5_000,
						),
					});
					expandedInputSetting.currentValue = String(config.expandedInputMaxLines);
					break;
				case "expandedOutputMaxLines":
					updateConfig({
						expandedOutputMaxLines: pickPositiveInt(
							value,
							DEFAULT_CONFIG.expandedOutputMaxLines,
							1,
							5_000,
						),
					});
					expandedOutputSetting.currentValue = String(config.expandedOutputMaxLines);
					break;
				case "expandedPreviewMaxLines":
					updateConfig({
						expandedPreviewMaxLines: pickPositiveInt(
							value,
							DEFAULT_CONFIG.expandedPreviewMaxLines,
							10,
							50_000,
						),
					});
					expandedMaxSetting.currentValue = String(config.expandedPreviewMaxLines);
					break;
				case "useSummaryTitlesAsThinkingTitle":
					updateConfig({ useSummaryTitlesAsThinkingTitle: value === "on" });
					break;
				case "agentSummaryDoneDate":
					updateConfig({ agentSummaryDoneDate: value === "on" });
					agentSummaryDoneDateSetting.description = config.agentSummaryDoneDate
						? t("agentSummaryDoneDate.desc.on")
						: t("agentSummaryDoneDate.desc.off");
					break;
				case "agentSummaryItalic":
					updateConfig({ agentSummaryItalic: value === "on" });
					agentSummaryItalicSetting.description = config.agentSummaryItalic
						? t("agentSummaryItalic.desc.on")
						: t("agentSummaryItalic.desc.off");
					break;
				case "previewLines":
					updateConfig({ previewLines: pickPositiveInt(value, DEFAULT_CONFIG.previewLines, 0) });
					thinkingPreviewSetting.currentValue = String(config.previewLines);
					break;
				case "animationIntervalMs":
					updateConfig({
						animationIntervalMs: pickPositiveNumber(value, DEFAULT_CONFIG.animationIntervalMs),
					});
					thinkingAnimationSetting.currentValue = String(config.animationIntervalMs);
					break;
				case "stickyUserMessage": {
					updateConfig({ stickyUserMessage: value === "on" });
					stickyUserMessageSetting.description = config.stickyUserMessage
						? t("stickyUserMessage.desc.on")
						: t("stickyUserMessage.desc.off");
					break;
				}
				case "scrollButtonMode": {
					updateConfig({ scrollButtonMode: value as ScrollButtonMode });
					scrollButtonSetting.description =
						config.scrollButtonMode === "dock"
							? t("scrollButtonMode.desc.dock")
							: t("scrollButtonMode.desc.native");
					break;
				}
				case "showStartupHeader": {
					const enabled = value === "on";
					updateConfig({ showStartupHeader: enabled });
					startupHeaderSetting.description = config.showStartupHeader
						? t("showStartupHeader.desc.on")
						: t("showStartupHeader.desc.off");
					if (enabled) applyStartupHeader(ctx);
					else clearStartupHeader(ctx);
					break;
				}
				default:
					return;
			}
			compactThinking?.updateConfig(getCompactThinkingConfig());
			hooks.refreshCurrentTranscript(ctx);
			ctx.ui.notify(t("notify.updated", { id, value }), "info");
		};

		const sections: CcstyleSection[] = [
			{
				id: "style",
				labelKey: "tab.style",
				items: [modeSetting, excludeSetting],
			},
			{
				id: "feature",
				labelKey: "tab.features",
				items: [
					sessionReferenceToggle.setting,
					subagentAutocompleteToggle.setting,
					contextCommandToggle.setting,
					agentSummaryToggle.setting,
					agentSummaryKeysSetting,
					agentSummaryDoneDateSetting,
					agentSummaryItalicSetting,
					workingMessageToggle.setting,
					aliasesToggle.setting,
					markdownEnhanceToggle.setting,
				],
			},
			{
				id: "ui",
				labelKey: "tab.ui",
				items: [
					languageSetting,
					sessionNameSetting,
					sessionNamePositionSetting,
					expandedInputSetting,
					expandedOutputSetting,
					expandedMaxSetting,
					toolLabelClipSetting,
					stickyUserMessageSetting,
					scrollButtonSetting,
					startupHeaderSetting,
					editorPrefixSetting,
					inputHistorySetting,
					inputHistoryRowsSetting,
				],
			},
			{
				id: "diff",
				labelKey: "tab.diff",
				items: [
					diffViewSetting,
					diffIndicatorSetting,
					diffSplitSetting,
					diffCollapsedSetting,
					writeDiffCollapsedSetting,
					diffWordWrapSetting,
				],
			},
			{
				id: "thinking",
				labelKey: "tab.thinking",
				items: [thinkingTitleSetting, thinkingPreviewSetting, thinkingAnimationSetting],
			},
			{
				id: "footer",
				labelKey: "tab.footer",
				items: [
					customFooterSetting,
					footerTokenRateSetting,
					footerTokenRateModeSetting,
					footerTokenRateTtftSetting,
					footerTotalTokensSetting,
					footerCurrencySetting,
					footerCurrencyRateSetting,
					footerNerdIconsSetting,
					footerGitStatsSetting,
					pluginChipsSetting,
				],
			},
			{
				// tokenSpeed 配置族独立页签：与状态栏开关/布局解耦，保持速率展示配置的独立性。
				id: "tokenSpeed",
				labelKey: "tab.tokenSpeed",
				items: tokenSpeedRows.map((row) => row.setting),
			},
		];

		let activeSection = 0;
		const settingsTheme = getSettingsListTheme();
		const lists = sections.map(
			(section) =>
				new SettingsList(
					section.items,
					Math.min(8, Math.max(section.items.length, 1)),
					settingsTheme,
					onSettingChange,
					() => done(),
					{ enableSearch: false },
				),
		);

		const activeList = () => lists[activeSection]!;

		const switchSection = (delta: number) => {
			if (nestedSubmenuOpen) return;
			activeSection = (activeSection + delta + sections.length) % sections.length;
		};

		/** 数值项：当前选中项有 submenu + values 时，Space 仅循环预设，不打开子面板。 */
		const cyclePresetInList = (list: InstanceType<typeof SettingsList>): boolean => {
			const internal = list as unknown as {
				submenuComponent: unknown;
				items: {
					id: string;
					currentValue: string;
					submenu?: unknown;
					values?: readonly string[];
				}[];
				selectedIndex: number;
			};
			if (internal.submenuComponent) return false;
			const item = internal.items[internal.selectedIndex];
			if (!item?.submenu || !item.values?.length) return false;
			const i = item.values.indexOf(item.currentValue);
			item.currentValue = item.values[i === -1 ? 0 : (i + 1) % item.values.length]!;
			onSettingChange(item.id, item.currentValue);
			return true;
		};

		return {
			render(width: number): string[] {
				const safeWidth = Math.max(0, Math.floor(width));
				const rule = renderPanelRule(theme, safeWidth);
				// Drop SettingsList's built-in hint — the panel footer below is the single source.
				const listBody = stripSettingsListHint(activeList().render(safeWidth));

				// Frame: top rule · tabs · mid rule · settings · mid rule · footer · bottom rule
				return [
					rule,
					renderSectionTabBar(theme, sections, activeSection, safeWidth),
					rule,
					...listBody,
					rule,
					truncateToWidth(
						theme.fg("dim", nestedHintKey ? t(nestedHintKey) : t("hint.main")),
						safeWidth,
					),
					rule,
				];
			},
			invalidate() {
				for (const list of lists) list.invalidate();
			},
			handleInput(data: string) {
				if (!nestedSubmenuOpen && isForwardTabKey(data)) {
					switchSection(1);
					tui.requestRender();
					return;
				}
				if (!nestedSubmenuOpen && isBackTabKey(data)) {
					switchSection(-1);
					tui.requestRender();
					return;
				}
				const list = activeList();
				// Space 循环预设（数值项不进子面板）；Enter 打开子面板输入自定义值。
				if (data === " " && cyclePresetInList(list)) {
					tui.requestRender();
					return;
				}
				list.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
	// 面板已经卸下，插槽此时替换才不会踢掉对话框。
	if (editorPrefixChanged) {
		if (config.enableEditorPrefix) applyPromptEditor(ctx);
		else clearPromptEditor(ctx);
	}
	// 面板卸下后主 transcript 重新挂载；再刷一次，吃掉打开期间扫树失败的切换。
	hooks.refreshCurrentTranscript(ctx, toolGrouping);
}
