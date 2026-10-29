/**
 * 输入历史反搜界面的时间与布局工具（方案 003 M3）。
 * 纯函数、无 ANSI 依赖；可视宽计算依赖 pi-tui 的 visibleWidth（含 ANSI 剥离）。
 */
import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * 相对时间（对齐 Claude 反搜列表口径）：now / Xm ago / Xh ago / Xd ago / Xw ago / Xmo ago / Xy ago。
 * @param timestamp 毫秒时间戳
 * @param now 当前时间（测试注入用，默认 Date.now()）
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "now";
	const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (diffSeconds < 60) return "now";
	const minutes = Math.floor(diffSeconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (days < 30) return `${weeks}w ago`;
	const months = Math.floor(days / 30);
	if (days < 365) return `${months}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

/** 按可视宽截断单行文本；超出时以 `…` 结尾。ANSI 序列不计宽（依赖 visibleWidth）。 */
export function truncateVisible(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(text) <= maxWidth) return text;
	if (maxWidth === 1) return "…";
	let out = "";
	for (const char of text) {
		if (visibleWidth(out + char) > maxWidth - 1) break;
		out += char;
	}
	return `${out}…`;
}

/**
 * 按可视宽右侧补空格到指定宽度。
 * 已超宽时不截断、原样返回——调用方传入的行可能携带 ANSI 着色标记，
 * 盲目截断会把颜色序列切成裸文本（宽度计算只计可见部分，正常不会走到这里）。
 */
export function padEndVisible(text: string, width: number): string {
	const w = visibleWidth(text);
	return w >= width ? text : text + " ".repeat(width - w);
}

/** 多行文本按可视宽硬换行（超宽截断，不折词——终端列表场景足够）。 */
export function wrapVisible(text: string, width: number, maxLines: number): string[] {
	const source = text.split("\n");
	const lines: string[] = [];
	for (const paragraph of source) {
		if (lines.length >= maxLines) break;
		if (paragraph.length === 0) {
			lines.push("");
			continue;
		}
		let current = "";
		for (const char of paragraph) {
			if (visibleWidth(current + char) > width) {
				lines.push(current);
				if (lines.length >= maxLines) break;
				current = char;
			} else {
				current += char;
			}
		}
		if (lines.length < maxLines && current.length > 0) lines.push(current);
	}
	if (lines.length === 0) lines.push("");
	// 截断标记：被裁掉的内容以 … 提示
	if (lines.length === maxLines) {
		const total = visibleWidth(text.replace(/\n/g, ""));
		const kept = lines.reduce((sum, l) => sum + visibleWidth(l), 0);
		if (kept < total) {
			const last = lines[maxLines - 1];
			lines[maxLines - 1] = truncateVisible(last, Math.max(1, visibleWidth(last) - 1)) + "…";
		}
	}
	return lines;
}
