/**
 * 输入历史存储层（方案 003 §3.2）。
 *
 * 布局：`<agentDir>/pi-cc-extensions/input-history/<projectKey>.jsonl`，每项目一个文件。
 * 首行 meta（`{"type":"meta","project":cwd,"createdAt":n}`），其余为 append-only 历史行
 * （`{display, sessionId?, timestamp}`）。分片维度 = 项目（主查询即「当前项目跨会话时间序」），
 * 会话维度不切（transcript 已承载）。projectKey 为 cwd 的确定性 slug 编码（与 pi 会话目录
 * 同构），免独立索引。
 *
 * 性能契约：写入为 fire-and-forget 异步追加（promise 链串行化，主线程零阻塞）；
 * 读取为尾部 64KB 起步、按需向前扩读的窗口解析，成本与文件总大小基本无关。
 * 容错：坏行/残行跳过，任何异常不影响 pi 主流程。
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** 单条历史记录。 */
export interface HistoryEntry {
	/** 用户输入原文（bash 命令保留 `!` 前缀），写入时截断。 */
	display: string;
	/** 所属会话文件名（可选，便于溯源）。 */
	sessionId?: string;
	/** 毫秒时间戳。 */
	timestamp: number;
}

interface MetaLine {
	type: "meta";
	project: string;
	createdAt: number;
}

/** agentDir 下插件命名空间目录。 */
const DIR_SEGMENTS = ["pi-cc-extensions", "input-history"] as const;
/** 读取窗口：尾部起步 64KB，向前扩读步长相同。 */
const TAIL_CHUNK = 64 * 1024;
/** 扩读轮数上限：64KB × 8 = 512KB，覆盖单项目 250 条历史的宽裕余量。 */
const MAX_EXPAND_ROUNDS = 8;
/** display 截断：防超长粘贴膨胀单行。 */
export const MAX_DISPLAY_CHARS = 8 * 1024;
/** 读取默认上限（注入编辑器时再收敛到 100，见 index.ts）。 */
export const DEFAULT_READ_LIMIT = 250;
/** projectKey 超过该字节数时截断并追加短 hash（文件名 255 字节上限的宽裕余量）。 */
const MAX_KEY_BYTES = 160;

/**
 * cwd → 确定性文件名 key，与 pi 会话目录编码同构：
 * 去掉开头的 `/`/`\`，`/`、`\`、`:` 替换为 `-`，前后包 `--`。
 * 超长时截断并追加 sha256 前 8 位，避免文件系统文件名上限。
 */
export function projectKey(cwd: string): string {
	const resolved = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
	const slug = `--${resolved}--`;
	if (Buffer.byteLength(slug, "utf-8") <= MAX_KEY_BYTES) return slug;
	const hash = createHash("sha256").update(cwd, "utf-8").digest("hex").slice(0, 8);
	// 按字节安全截断：utf-8 下逐字节回退不会劈开多字节字符的编码前缀判断，直接按字符迭代。
	let cut = resolved;
	while (Buffer.byteLength(`--${cut}--${hash}`, "utf-8") > MAX_KEY_BYTES && cut.length > 0) {
		cut = cut.slice(0, -1);
	}
	return `--${cut}--${hash}`;
}

/** 当前项目的历史文件绝对路径。 */
export function historyFilePath(cwd: string): string {
	return join(getAgentDir(), ...DIR_SEGMENTS, `${projectKey(cwd)}.jsonl`);
}

/** 跨调用串行化：同一文件的追加按调用顺序落盘，防同进程乱序。 */
const writeChains = new Map<string, Promise<void>>();

/**
 * 追加一条历史。fire-and-forget：调用方（index.ts）不 await；返回的 promise 已自吞
 * 错误（永不 reject），测试可 await 它同步落盘。首次创建文件时写入 meta 首行
 * （`wx` 标志防多窗口竞态双写，EEXIST 视为已初始化）。
 */
/** 追加执行体（不走链）：seed 的链上下文中直接调用，避免链内再排队造成死锁。 */
async function appendEntryInner(cwd: string, entry: HistoryEntry): Promise<void> {
	const file = historyFilePath(cwd);
	await mkdir(dirname(file), { recursive: true });
	let needsMeta = false;
	try {
		await stat(file);
	} catch {
		needsMeta = true;
	}
	if (needsMeta) {
		const meta: MetaLine = { type: "meta", project: cwd, createdAt: Date.now() };
		try {
			await writeFile(file, `${JSON.stringify(meta)}\n`, { flag: "wx" });
		} catch {
			// EEXIST：另一窗口先写好了 meta，直接落历史行即可。
		}
	}
	const line = `${JSON.stringify({
		display: entry.display.slice(0, MAX_DISPLAY_CHARS),
		sessionId: entry.sessionId,
		timestamp: entry.timestamp,
	})}\n`;
	await appendFile(file, line, "utf-8");
}

/**
 * 追加一条历史。fire-and-forget：调用方（index.ts）不 await；返回的 promise 已自吞
 * 错误（永不 reject），测试可 await 它同步落盘。首次创建文件时写入 meta 首行
 * （`wx` 标志防多窗口竞态双写，EEXIST 视为已初始化）。
 */
export function appendEntry(cwd: string, entry: HistoryEntry): Promise<void> {
	const file = historyFilePath(cwd);
	const previous = writeChains.get(file) ?? Promise.resolve();
	const next = previous
		.then(() => appendEntryInner(cwd, entry))
		.catch(() => {
			// 存储层任何异常静默吞掉：历史功能不干扰 pi 主流程。
		});
	writeChains.set(file, next);
	return next;
}

/** 当前项目的历史文件是否已存在（seed 触发条件）。 */ export async function hasHistoryFile(
	cwd: string,
): Promise<boolean> {
	try {
		await stat(historyFilePath(cwd));
		return true;
	} catch {
		return false;
	}
}

/**
 * seed 专用：一次性写入初始历史（旧→新顺序），meta 首行 + `.tmp` 原子 rename，
 * 防两窗口同时首启交错；并发 seed 产生的重复行由读取侧去重兑底。
 */
export async function writeInitialEntries(cwd: string, entries: HistoryEntry[]): Promise<void> {
	const file = historyFilePath(cwd);
	// 同步注册写入链：保证与 appendEntry 同队列串行（否则 append 会抢在 seed 之前，
	// 随后 seed 的 rename 覆盖丢条目——实测竞态）。
	const previous = writeChains.get(file) ?? Promise.resolve();
	const next = previous
		.then(async () => {
			// 链上轮到时双检：文件可能已被 append 先行创建，跳过则不覆盖用户条目
			if (await hasHistoryFile(cwd)) {
				for (const entry of entries) await appendEntryInner(cwd, entry);
				return;
			}
			await mkdir(dirname(file), { recursive: true });
			// meta 首行（空 seed 也要建文件，标记已聚合过）
			await writeFile(
				file,
				`${JSON.stringify({ type: "meta", project: cwd, createdAt: Date.now() })}\n`,
				"utf-8",
			);
			for (const entry of entries) await appendEntryInner(cwd, entry);
		})
		.catch(() => {
			// 存储层异常静默
		});
	writeChains.set(file, next);
	return next;
}

/** 读取当前项目最近的历史，**最新在前**、按 display 全局去重，至多 limit 条。 */
export async function readRecent(cwd: string, limit = DEFAULT_READ_LIMIT): Promise<HistoryEntry[]> {
	return readRecentFromFile(historyFilePath(cwd), limit);
}

/**
 * 跨项目读取（二期 Ctrl+R "All folders" scope）：遍历历史目录全部项目文件，
 * 每个文件只读尾部 16KB，合并后按时间去重取最近 limit 条。惰性调用（用户主动切到全项目时才读）。
 */
export async function readAllProjects(limit = DEFAULT_READ_LIMIT): Promise<HistoryEntry[]> {
	const dir = join(getAgentDir(), ...DIR_SEGMENTS);
	let names: string[];
	try {
		names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
	} catch {
		return [];
	}
	const merged: HistoryEntry[] = [];
	for (const name of names) {
		merged.push(...(await readRecentFromFile(join(dir, name), 32, 16 * 1024)));
	}
	merged.sort((a, b) => a.timestamp - b.timestamp);
	return dedupeNewest(merged).slice(0, limit);
}

/** 单文件尾读：从尾部 64KB 窗口起步，攒不够 limit 向前扩读（有轮数上限），最新在前。 */
async function readRecentFromFile(
	file: string,
	limit: number,
	chunk = TAIL_CHUNK,
): Promise<HistoryEntry[]> {
	let size: number;
	try {
		size = (await stat(file)).size;
	} catch {
		return [];
	}
	if (size === 0) return [];
	// 从尾部窗口起，攒不够 limit 就向前扩读；每轮重新解析 [start, size) 全量窗口，
	// 单调扩大无重复解析行，且窗口 ≤512KB，O(轮数×窗口) 可忽略。
	let start = Math.max(0, size - chunk);
	let newestFirst: HistoryEntry[] = [];
	for (let round = 0; ; round++) {
		const buffer = await readFileRange(file, start, size);
		const lines = buffer.toString("utf-8").split("\n");
		// start > 0 时窗口首行大概率被截断，丢弃；start = 0 时含 meta 在内全部完整。
		const body = start > 0 ? lines.slice(1) : lines;
		newestFirst = dedupeNewest(parseLines(body));
		if (newestFirst.length >= limit || start === 0 || round >= MAX_EXPAND_ROUNDS) break;
		start = Math.max(0, start - chunk);
	}
	return newestFirst.slice(0, limit);
}

/** 解析行数组：跳过空行、meta 行、坏行与非文本条目。 */
function parseLines(lines: string[]): HistoryEntry[] {
	const entries: HistoryEntry[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch {
			continue; // 坏行：交错/损坏，丢一条不炸全局
		}
		if (typeof raw !== "object" || raw === null) continue;
		const record = raw as {
			type?: unknown;
			display?: unknown;
			sessionId?: unknown;
			timestamp?: unknown;
		};
		if (record.type === "meta") continue;
		if (typeof record.display !== "string" || record.display.length === 0) continue;
		const timestamp = typeof record.timestamp === "number" ? record.timestamp : 0;
		entries.push({
			display: record.display,
			sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
			timestamp,
		});
	}
	return entries;
}

/** 文件序（时间正序）→ 最新在前，同 display 保留最新位置。 */
function dedupeNewest(entries: HistoryEntry[]): HistoryEntry[] {
	const seen = new Set<string>();
	const result: HistoryEntry[] = [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (seen.has(entry.display)) continue;
		seen.add(entry.display);
		result.push(entry);
	}
	return result;
}

/** 读文件 [start, end) 区间。 */
async function readFileRange(file: string, start: number, end: number): Promise<Buffer> {
	const handle = await open(file, "r");
	try {
		const length = end - start;
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, start);
		return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}
