/**
 * tokenSpeed 配置段（源自 pi-token-speed，MIT）。P1 仅配置层：类型 + 默认值 + 校验；
 * 渲染与引擎行为在 P2/P3 接入，本模块不碰 footer 现状。
 */

export type TokenSpeedCountStrategy = "estimate" | "direct";
export type TokenSpeedEndTpsBehavior = "average" | "last";

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

export interface TokenSpeedConfig {
	thresholds: TokenSpeedThresholds;
	colors: TokenSpeedColors;
	/** 空串 = 跟随 footerNerdIcons 的默认图标。 */
	icon: string;
	countStrategy: TokenSpeedCountStrategy;
	endTpsBehavior: TokenSpeedEndTpsBehavior;
	/** live 滑动窗口毫秒，范围 100..30000（30s 硬顶）。 */
	slidingWindow: number;
	/** 渲染节流毫秒，范围 0..1000；0 = 每次增量都刷新。 */
	updateInterval: number;
	formatDuration: boolean;
}

/** 用户配置里的 tokenSpeed 输入：全部字段可选，逐字段校验。 */
export type TokenSpeedInput = Partial<TokenSpeedConfig>;

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
};

const TOKEN_SPEED_COUNT_STRATEGIES: TokenSpeedCountStrategy[] = ["estimate", "direct"];
const TOKEN_SPEED_END_TPS_BEHAVIORS: TokenSpeedEndTpsBehavior[] = ["average", "last"];
const SLIDING_WINDOW_MIN = 100;
const SLIDING_WINDOW_MAX = 30_000;
const UPDATE_INTERVAL_MAX = 1000;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
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

/** 四档阈值必须是非负整数且严格升序，否则整块回落默认。 */
function normalizeThresholds(value: unknown): TokenSpeedThresholds {
	const source = asRecord(value);
	const isNonNegInt = (n: unknown): n is number =>
		typeof n === "number" && Number.isInteger(n) && n >= 0;
	const slow = source.slow;
	const medium = source.medium;
	const fast = source.fast;
	const blazing = source.blazing;
	if (!isNonNegInt(slow) || !isNonNegInt(medium) || !isNonNegInt(fast) || !isNonNegInt(blazing)) {
		return { ...DEFAULT_TOKEN_SPEED.thresholds };
	}
	if (!(slow < medium && medium < fast && fast < blazing)) {
		return { ...DEFAULT_TOKEN_SPEED.thresholds };
	}
	return { slow, medium, fast, blazing };
}

/** 单个颜色非法只回落该色，其余保留。 */
function normalizeColors(value: unknown): TokenSpeedColors {
	const source = asRecord(value);
	const pick = (key: keyof TokenSpeedColors): string =>
		typeof source[key] === "string" && HEX_COLOR_RE.test(source[key] as string)
			? (source[key] as string)
			: DEFAULT_TOKEN_SPEED.colors[key];
	return {
		slow: pick("slow"),
		medium: pick("medium"),
		fast: pick("fast"),
		blazing: pick("blazing"),
	};
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
		updateInterval: pickIntInRange(
			source.updateInterval,
			DEFAULT_TOKEN_SPEED.updateInterval,
			0,
			UPDATE_INTERVAL_MAX,
		),
		formatDuration: source.formatDuration === true,
	};
}

/** 状态摘要：`tokenSpeed=[0/15/30/45] estimate avg w1000`。 */
export function formatTokenSpeedSummary(config: TokenSpeedConfig): string {
	const { thresholds, countStrategy, endTpsBehavior, slidingWindow } = config;
	return `tokenSpeed=[${thresholds.slow}/${thresholds.medium}/${thresholds.fast}/${thresholds.blazing}] ${countStrategy} ${endTpsBehavior === "last" ? "last" : "avg"} w${slidingWindow}`;
}
