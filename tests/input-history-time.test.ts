import assert from "node:assert/strict";
import test from "node:test";
import {
	formatRelativeTime,
	padEndVisible,
	truncateVisible,
	wrapVisible,
} from "../extensions/feature/history/time.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

test("formatRelativeTime: 各档位", () => {
	const at = (iso: string) => Date.parse(iso);
	assert.equal(formatRelativeTime(at("2026-10-29T11:59:40Z"), NOW), "now");
	assert.equal(formatRelativeTime(at("2026-10-29T11:24:00Z"), NOW), "36m ago");
	assert.equal(formatRelativeTime(at("2026-10-29T04:00:00Z"), NOW), "8h ago");
	assert.equal(formatRelativeTime(at("2026-10-23T12:00:00Z"), NOW), "6d ago");
	assert.equal(formatRelativeTime(at("2026-10-22T12:00:00Z"), NOW), "1w ago");
	assert.equal(formatRelativeTime(at("2026-10-01T12:00:00Z"), NOW), "4w ago");
	assert.equal(formatRelativeTime(at("2026-08-15T12:00:00Z"), NOW), "2mo ago");
	assert.equal(formatRelativeTime(at("2024-11-01T12:00:00Z"), NOW), "1y ago");
});

test("formatRelativeTime: 非法时间戳回退 now", () => {
	assert.equal(formatRelativeTime(0, NOW), "now");
	assert.equal(formatRelativeTime(Number.NaN, NOW), "now");
});

test("truncateVisible: 超宽截断加省略号，中文按显示宽", () => {
	assert.equal(truncateVisible("hello", 10), "hello");
	assert.equal(truncateVisible("hello world", 8), "hello w…");
	assert.equal(truncateVisible("帮我检查一下这个", 8), "帮我检…"); // 3×2 + 1 = 7 ≤ 8
	assert.equal(truncateVisible("ab", 1), "…");
	assert.equal(truncateVisible("", 5), "");
});

test("padEndVisible: 补位；超宽原样返回（不截 ANSI 行）", () => {
	assert.equal(padEndVisible("ab", 5), "ab   ");
	assert.equal(padEndVisible("中文", 6), "中文  ");
	assert.equal(padEndVisible("toolong", 4), "toolong");
});

test("wrapVisible: 宽度硬换行与行数上限", () => {
	assert.deepEqual(wrapVisible("aaaa", 2, 10), ["aa", "aa"]);
	assert.deepEqual(wrapVisible("a\n\nb", 4, 10), ["a", "", "b"]);
	const clipped = wrapVisible("a".repeat(10), 3, 2);
	assert.equal(clipped.length, 2);
	assert.ok(clipped[1].endsWith("…"));
});
