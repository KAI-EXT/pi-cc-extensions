/**
 * tokenSpeed 配置段（源自 pi-token-speed，MIT）。
 * P1 配置层：类型 + 默认值 + 校验；P3 起提供渲染侧取档/取色函数（tokenSpeedTier /
 * tokenSpeedRateAnsi），footer 速率芯片与摘要行 rate 段共用。
 * P4：display 显示模式族、displayColors 后缀分色、providerOverrides 按 provider 深合并
 * （resolveTokenSpeed），引擎口径按活动模型 provider 在入口刷新。
 */

export type TokenSpeedCountStrategy = "estimate" | "direct";
export type TokenSpeedEndTpsBehavior = "average" | "last";
/** 芯片形态：legacy 沿用 avg/live 标签，其余为 pi-token-speed 显示模式语义。 */
export type TokenSpeedDisplay = "legacy" | "tps" | "ttft" | "stats" | "full";
/** 非 legacy 显示模式，渲染层按此分支。 */
export type TokenSpeedNonLegacyDisplay = Exclude<TokenSpeedDisplay, "legacy">;

export interface TokenSpeedThresholds {
	slow: number;
	medium: number;
	fast: number;
	blazing: number;
}

export interface TokenSpeedColors {
	slow: string;
	medium: string;
	fast: string;
	blazing: string;
}

/** 非 legacy 显示模式的后缀分色：字段缺省/非法时不上色。 */
export interface TokenSpeedDisplayColors {
	/** 本指令累计 token 段（`150 tok`）。 */
	count?: string;
	/** 耗时段（`6.0s` / `1m 32s`）。 */
	elapsed?: string;
	/** TTFT 段（`TTFT: 450ms`）。 */
	ttft?: string;
}

export interface TokenSpeedConfig {
	thresholds: TokenSpeedThresholds;
	colors: TokenSpeedColors;
	/** 空串 = 跟随 footerNerdIcons 的默认图标。 */
	icon: string;
	countStrategy: TokenSpeedCountStrategy;
	endTpsBehavior: TokenSpeedEndTpsBehavior;
	/** live 滑动窗口毫秒，范围 100..30000（30s 硬顶）。 */
	slidingWindow: number;
	/** 保留键不再生效：已验证 pi TUI 渲染管线合帧（requestRender 去重 + 16ms 帧节流），恒为 0。 */
	updateInterval: number;
	formatDuration: boolean;
	/** 芯片显示形态，默认 legacy（零破坏）。 */
	display: TokenSpeedDisplay;
	/** 非 legacy 模式的后缀分色，缺省不上色。 */
	displayColors: TokenSpeedDisplayColors;
	/** 按 provider id（活动模型 `model.provider` 精确串）覆盖 tokenSpeed 子集。 */
	providerOverrides: Record<string, TokenSpeedOverrideInput>;
}

/** 用户配置里的 tokenSpeed 输入：全部字段可选，逐字段校验。 */
export type TokenSpeedInput = Partial<TokenSpeedConfig>;

/** providerOverrides 单块输入：可覆盖字段全部可选（colors 可只给部分色）；updateInterval 是失效保留键，不开放覆盖。 */
export type TokenSpeedOverrideInput = Partial<
	Omit<TokenSpeedConfig, "providerOverrides" | "updateInterval" | "colors">
> & { colors?: Partial<TokenSpeedColors> };

export const DEFAULT_TOKEN_SPEED: TokenSpeedConfig = {
	thresholds: { slow: 0, medium: 15, fast: 30, blazing: 45 },
	colors: {
		slow: "#ff4444",
		medium: "#ffaa00",
		fast: "#00ff88",
		blazing: "#44ddff",
	},
	icon: "",
	countStrategy: "estimate",
	endTpsBehavior: "average",
	slidingWindow: 1000,
	updateInterval: 0,
	formatDuration: false,
	display: "legacy",
	displayColors: {},
	providerOverrides: {},
};

const TOKEN_SPEED_COUNT_STRATEGIES: TokenSpeedCountStrategy[] = ["estimate", "direct"];
const TOKEN_SPEED_END_TPS_BEHAVIORS: TokenSpeedEndTpsBehavior[] = ["average", "last"];
const TOKEN_SPEED_DISPLAYS: TokenSpeedDisplay[] = ["legacy", "tps", "ttft", "stats", "full"];
const DISPLAY_COLOR_KEYS = ["count", "elapsed", "ttft"] as const;
const TIER_COLOR_KEYS = ["slow", "medium", "fast", "blazing"] as const;
const SLIDING_WINDOW_MIN = 100;
const SLIDING_WINDOW_MAX = 30_000;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/** 稀疏版枚举挑选：非法返回 undefined（覆盖块不能回填默认，否则会把 base 顶掉）。 */
function pickEnumOption<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: undefined;
}

/** 非数字回落默认，合法值夹进范围。 */
function pickIntInRange(value: unknown, fallback: number, min: number, max: number): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const isHexColor = (value: unknown): value is string =>
	typeof value === "string" && HEX_COLOR_RE.test(value);

/** 从记录里挑出合法 hex 的键子集；一个都没有时返回 undefined（调用方省略该键）。 */
function pickHexSubset<K extends string>(
	value: unknown,
	keys: readonly K[],
): Partial<Record<K, string>> | undefined {
	const source = asRecord(value);
	const out: Partial<Record<K, string>> = {};
	for (const key of keys) {
		if (isHexColor(source[key])) out[key] = source[key];
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** 四档阈值合法时返回数值块，否则 null（normalize 整块回落与 override 稀疏丢弃共用）。 */
function parseThresholds(value: unknown): TokenSpeedThresholds | null {
	const source = asRecord(value);
	const isNonNegInt = (n: unknown): n is number =>
		typeof n === "number" && Number.isInteger(n) && n >= 0;
	const slow = source.slow;
	const medium = source.medium;
	const fast = source.fast;
	const blazing = source.blazing;
	if (!isNonNegInt(slow) || !isNonNegInt(medium) || !isNonNegInt(fast) || !isNonNegInt(blazing)) {
		return null;
	}
	if (!(slow < medium && medium < fast && fast < blazing)) {
		return null;
	}
	return { slow, medium, fast, blazing };
}

/** 四档阈值必须是非负整数且严格升序，否则整块回落默认。 */
function normalizeThresholds(value: unknown): TokenSpeedThresholds {
	return parseThresholds(value) ?? { ...DEFAULT_TOKEN_SPEED.thresholds };
}

/** 单个颜色非法只回落该色，其余保留。 */
function normalizeColors(value: unknown): TokenSpeedColors {
	const source = asRecord(value);
	const pick = (key: keyof TokenSpeedColors): string =>
		isHexColor(source[key]) ? source[key] : DEFAULT_TOKEN_SPEED.colors[key];
	return {
		slow: pick("slow"),
		medium: pick("medium"),
		fast: pick("fast"),
		blazing: pick("blazing"),
	};
}

/** displayColors：合法 hex 保留，非法/缺失丢弃（不上色）。 */
function normalizeDisplayColors(value: unknown): TokenSpeedDisplayColors {
	return pickHexSubset(value, DISPLAY_COLOR_KEYS) ?? {};
}

/** 覆盖块稀疏归一化：仅保留合法字段，非法/缺失不回填默认（回填会把 base 覆盖成默认值）。 */
export function normalizeTokenSpeedOverride(input: unknown): TokenSpeedOverrideInput {
	const source = asRecord(input);
	const override: TokenSpeedOverrideInput = {};
	const thresholds = parseThresholds(source.thresholds);
	if (thresholds) override.thresholds = thresholds;
	const colors = pickHexSubset(source.colors, TIER_COLOR_KEYS);
	if (colors) override.colors = colors;
	const displayColors = pickHexSubset(source.displayColors, DISPLAY_COLOR_KEYS);
	if (displayColors) override.displayColors = displayColors;
	if (typeof source.icon === "string") override.icon = source.icon;
	const display = pickEnumOption(source.display, TOKEN_SPEED_DISPLAYS);
	if (display) override.display = display;
	const countStrategy = pickEnumOption(source.countStrategy, TOKEN_SPEED_COUNT_STRATEGIES);
	if (countStrategy) override.countStrategy = countStrategy;
	const endTpsBehavior = pickEnumOption(source.endTpsBehavior, TOKEN_SPEED_END_TPS_BEHAVIORS);
	if (endTpsBehavior) override.endTpsBehavior = endTpsBehavior;
	if (typeof source.slidingWindow === "number" && Number.isFinite(source.slidingWindow)) {
		override.slidingWindow = Math.min(
			SLIDING_WINDOW_MAX,
			Math.max(SLIDING_WINDOW_MIN, Math.floor(source.slidingWindow)),
		);
	}
	if (typeof source.formatDuration === "boolean") override.formatDuration = source.formatDuration;
	return override;
}

/** providerOverrides：键为 provider id，值稀疏归一化；无有效字段的条目丢弃。 */
function normalizeProviderOverrides(value: unknown): Record<string, TokenSpeedOverrideInput> {
	const source = asRecord(value);
	const out: Record<string, TokenSpeedOverrideInput> = {};
	for (const [provider, block] of Object.entries(source)) {
		const override = normalizeTokenSpeedOverride(block);
		if (Object.keys(override).length > 0) out[provider] = override;
	}
	return out;
}

/** tokenSpeed 段归一化：整段缺省/非法回落默认块，字段级非法逐项回落。 */
export function normalizeTokenSpeed(input: unknown): TokenSpeedConfig {
	const source = asRecord(input);
	return {
		thresholds: normalizeThresholds(source.thresholds),
		colors: normalizeColors(source.colors),
		icon: typeof source.icon === "string" ? source.icon : DEFAULT_TOKEN_SPEED.icon,
		countStrategy: pickEnumValue(
			source.countStrategy,
			TOKEN_SPEED_COUNT_STRATEGIES,
			DEFAULT_TOKEN_SPEED.countStrategy,
		),
		endTpsBehavior: pickEnumValue(
			source.endTpsBehavior,
			TOKEN_SPEED_END_TPS_BEHAVIORS,
			DEFAULT_TOKEN_SPEED.endTpsBehavior,
		),
		slidingWindow: pickIntInRange(
			source.slidingWindow,
			DEFAULT_TOKEN_SPEED.slidingWindow,
			SLIDING_WINDOW_MIN,
			SLIDING_WINDOW_MAX,
		),
		// updateInterval 保留键位但忽略取值：已验证 pi TUI requestRender 自带合帧
		//（renderRequested 去重 + MIN_RENDER_INTERVAL_MS=16ms 节流），渲染节流不再需要。
		updateInterval: DEFAULT_TOKEN_SPEED.updateInterval,
		formatDuration: source.formatDuration === true,
		display: pickEnumValue(source.display, TOKEN_SPEED_DISPLAYS, DEFAULT_TOKEN_SPEED.display),
		displayColors: normalizeDisplayColors(source.displayColors),
		providerOverrides: normalizeProviderOverrides(source.providerOverrides),
	};
}

/**
 * 活动模型 provider 命中 providerOverrides 时与 base 深合并出生效配置；未命中原样返回 base。
 * thresholds 整块覆盖（与 normalize 同口径的 all-or-nothing），colors/displayColors 逐色合并。
 */
export function resolveTokenSpeed(
	base: TokenSpeedConfig,
	providerId: string | undefined,
): TokenSpeedConfig {
	const override = providerId ? base.providerOverrides[providerId] : undefined;
	if (!override) return base;
	return {
		thresholds: override.thresholds ?? base.thresholds,
		colors: { ...base.colors, ...override.colors },
		displayColors: { ...base.displayColors, ...override.displayColors },
		icon: override.icon ?? base.icon,
		countStrategy: override.countStrategy ?? base.countStrategy,
		endTpsBehavior: override.endTpsBehavior ?? base.endTpsBehavior,
		slidingWindow: override.slidingWindow ?? base.slidingWindow,
		updateInterval: base.updateInterval,
		formatDuration: override.formatDuration ?? base.formatDuration,
		display: override.display ?? base.display,
		providerOverrides: base.providerOverrides,
	};
}

/** 状态摘要：`tokenSpeed=[0/15/30/45] estimate avg w1000`。 */
export function formatTokenSpeedSummary(config: TokenSpeedConfig): string {
	const { thresholds, countStrategy, endTpsBehavior, slidingWindow } = config;
	return `tokenSpeed=[${thresholds.slow}/${thresholds.medium}/${thresholds.fast}/${thresholds.blazing}] ${countStrategy} ${endTpsBehavior === "last" ? "last" : "avg"} w${slidingWindow}`;
}

/** 四档档位。 */
export type TokenSpeedTier = keyof TokenSpeedThresholds;

/** 速率定档：低于 medium 阈值 slow，低于 fast 为 medium，低于 blazing 为 fast，其余 blazing。 */
export function tokenSpeedTier(rate: number, thresholds: TokenSpeedThresholds): TokenSpeedTier {
	if (rate < thresholds.medium) return "slow";
	if (rate < thresholds.fast) return "medium";
	if (rate < thresholds.blazing) return "fast";
	return "blazing";
}

/** #rrggbb → ANSI truecolor 前景开码；合法性由 normalizeTokenSpeed 保证。 */
export function hexToTruecolor(hex: string): string {
	const n = Number.parseInt(hex.slice(1), 16);
	return `\x1b[38;2;${(n >> 16) & 0xff};${(n >> 8) & 0xff};${n & 0xff}m`;
}

/**
 * 速率数值的 ANSI truecolor 开码：footer 速率芯片与摘要行 rate 段共用的取色函数。
 * 只返回开码，收尾序列由调用方按上下文选择（footer 恢复主题 dim，摘要行 \x1b[0m）。
 */
export function tokenSpeedRateAnsi(rate: number, speed: TokenSpeedConfig): string {
	return hexToTruecolor(speed.colors[tokenSpeedTier(rate, speed.thresholds)]);
}
