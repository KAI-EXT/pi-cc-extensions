/**
 * 存量 Seed（方案 003 §3.5）。
 *
 * 触发条件：当前项目的历史文件不存在（首次在该项目使用）。一次性把既有会话
 * transcript 里的 user 指令与 bash 命令聚合成初始历史——聚合逻辑只在此处使用，
 * 常规路径（捕获/注入）不做任何 transcript 扫描。
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { isRecallableInput } from "./filter.ts";
import {
	DEFAULT_READ_LIMIT,
	hasHistoryFile,
	writeInitialEntries,
	type HistoryEntry,
} from "./store.ts";

/** 会话 transcript 行的宽松形状（解析失败逐行跳过）。 */
interface RawSessionLine {
	type?: string;
	timestamp?: string;
	message?: {
		role?: string;
		content?: unknown;
		command?: unknown;
		excludeFromContext?: unknown;
		timestamp?: unknown;
	};
}

/** 从 message content 提取纯文本（string 直返；数组拼接 text 块）。 */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join("\n");
}

/** 行时间戳：优先内层毫秒数字，回退外层 ISO 字符串，再回退文件 mtime。 */
function lineTimestamp(line: RawSessionLine, fallback: number): number {
	const inner = line.message?.timestamp;
	if (typeof inner === "number") return inner;
	const parsed = Date.parse(line.timestamp ?? "");
	return Number.isNaN(parsed) ? fallback : parsed;
}

/** 单文件提取：user 指令 + bash 命令（保留 `!` / `!!` 前缀语义）。 */
async function extractFromFile(filePath: string, fallbackTime: number): Promise<HistoryEntry[]> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf-8");
	} catch {
		return [];
	}
	const entries: HistoryEntry[] = [];
	const sessionId = basename(filePath);
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		let parsed: RawSessionLine;
		try {
			parsed = JSON.parse(trimmed) as RawSessionLine;
		} catch {
			continue;
		}
		if (parsed.type !== "message" || !parsed.message) continue;
		const time = lineTimestamp(parsed, fallbackTime);
		const { role } = parsed.message;
		if (role === "user") {
			const text = extractText(parsed.message.content).trim();
			if (isRecallableInput(text)) entries.push({ display: text, sessionId, timestamp: time });
			continue;
		}
		if (role === "bashExecution") {
			const command =
				typeof parsed.message.command === "string" ? parsed.message.command.trim() : "";
			if (command.length === 0) continue;
			const prefix = parsed.message.excludeFromContext === true ? "!!" : "!";
			entries.push({ display: `${prefix}${command}`, sessionId, timestamp: time });
		}
	}
	return entries;
}

/**
 * 历史文件缺失时执行 seed；已存在则跳过。返回是否实际执行了 seed。
 * 任何异常静默吞掉（返回 false），不影响 session_start 主流程。
 */
export async function seedIfNeeded(cwd: string, sessionDir?: string): Promise<boolean> {
	try {
		if (await hasHistoryFile(cwd)) return false;
		let sessions: Awaited<ReturnType<typeof SessionManager.list>>;
		try {
			sessions = await SessionManager.list(cwd, sessionDir);
		} catch {
			return false;
		}
		// 旧→新遍历：同 display 的旧行会被读取侧「保留最新位置」语义自然淘汰，
		// 这里先按文件序追加，落盘前统一倒序去重。
		const collected: HistoryEntry[] = [];
		const ordered = [...sessions].sort((a, b) => a.modified.getTime() - b.modified.getTime());
		for (const session of ordered) {
			collected.push(...(await extractFromFile(session.path, session.modified.getTime())));
		}
		// 全局去重（保留最新位置）→ 取最近 limit → 回正序落盘（读取侧按「最新在前」返回）
		const seen = new Set<string>();
		const newestFirst: HistoryEntry[] = [];
		for (let i = collected.length - 1; i >= 0; i--) {
			const entry = collected[i];
			if (seen.has(entry.display)) continue;
			seen.add(entry.display);
			newestFirst.push(entry);
			if (newestFirst.length >= DEFAULT_READ_LIMIT) break;
		}
		await writeInitialEntries(cwd, newestFirst.slice(0, DEFAULT_READ_LIMIT).reverse());
		return true;
	} catch {
		return false;
	}
}
