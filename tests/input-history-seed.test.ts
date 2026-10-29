import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { seedIfNeeded } from "../extensions/feature/history/seed.ts";
import { hasHistoryFile, projectKey, readRecent } from "../extensions/feature/history/store.ts";

// SessionManager.list 显式 sessionDir 时会按 header.cwd 与 resolvePath(cwd) 严格匹配，
// 且 macOS /tmp 是符号链接，必须用真实存在且 realpath 后的目录。
const CWD_DIR = mkdtempSync(join(tmpdir(), "pi-cc-seed-proj-"));
const CWD = realpathSync(CWD_DIR);

/** 在「项目会话目录」平铺 transcript：SessionManager.list(cwd, sessionDir) 的 sessionDir 即项目目录本身，不递归子目录。 */
function setup(
	sessionsRoot: string,
	files: Array<{ name: string; lines: string[]; mtime?: Date }>,
) {
	mkdirSync(sessionsRoot, { recursive: true });
	for (const file of files) {
		const filePath = join(sessionsRoot, file.name);
		writeFileSync(filePath, file.lines.map((l) => `${l}\n`).join(""));
		if (file.mtime) {
			// 旧→新遍历依赖 modified：显式错开
			utimesSync(filePath, file.mtime, file.mtime);
		}
	}
	return sessionsRoot;
}

function sessionHeader(cwd: string): string {
	return JSON.stringify({
		type: "session",
		version: 3,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		cwd,
	});
}

test("seedIfNeeded: 文件已存在时跳过", async () => {
	const dir = join(tmpdir(), `pi-cc-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	process.env.PI_CODING_AGENT_DIR = dir;
	mkdirSync(dir, { recursive: true });
	try {
		// 先制造一次写入让历史文件存在
		const projectDir = setup(join(dir, "sessions"), [
			{ name: "a.jsonl", lines: [sessionHeader(CWD)] },
		]);
		assert.equal(hasHistoryFile(CWD) instanceof Promise, true);
		// 预置历史文件
		const { writeInitialEntries } = await import("../extensions/feature/history/store.ts");
		await writeInitialEntries(CWD, [{ display: "已有历史", timestamp: 1 }]);
		const seeded = await seedIfNeeded(CWD, join(dir, "sessions"));
		assert.equal(seeded, false);
		const entries = await readRecent(CWD);
		assert.deepEqual(
			entries.map((e) => e.display),
			["已有历史"],
		);
		assert.ok(projectDir.length > 0); // 防 TS 未用告警
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("seedIfNeeded: 聚合 user 指令与 bash 命令，过滤斜杠/空行/skill 块", async () => {
	const dir = join(tmpdir(), `pi-cc-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	process.env.PI_CODING_AGENT_DIR = dir;
	const sessionsRoot = join(dir, "sessions");
	mkdirSync(dir, { recursive: true });
	try {
		setup(sessionsRoot, [
			{
				name: "old.jsonl",
				mtime: new Date("2026-01-01T00:00:00Z"),
				lines: [
					sessionHeader(CWD),
					JSON.stringify({
						type: "message",
						timestamp: "2026-01-01T00:01:00Z",
						message: { role: "user", content: [{ type: "text", text: "旧的普通指令" }] },
					}),
					JSON.stringify({
						type: "message",
						timestamp: "2026-01-01T00:02:00Z",
						message: { role: "user", content: [{ type: "text", text: "/ccstyle" }] },
					}),
					JSON.stringify({
						type: "message",
						timestamp: "2026-01-01T00:03:00Z",
						message: {
							role: "bashExecution",
							command: "pwd",
							excludeFromContext: false,
							timestamp: 1,
						},
					}),
					JSON.stringify({
						type: "message",
						timestamp: "2026-01-01T00:04:00Z",
						message: { role: "assistant", content: [{ type: "text", text: "回复不应入历史" }] },
					}),
				],
			},
			{
				name: "new.jsonl",
				mtime: new Date("2026-01-02T00:00:00Z"),
				lines: [
					sessionHeader(CWD),
					JSON.stringify({
						type: "message",
						timestamp: "2026-01-02T00:01:00Z",
						message: { role: "user", content: [{ type: "text", text: "新的普通指令" }] },
					}),
					JSON.stringify({
						type: "message",
						timestamp: "2026-01-02T00:02:00Z",
						message: {
							role: "bashExecution",
							command: "make build",
							excludeFromContext: true,
							timestamp: 2,
						},
					}),
				],
			},
		]);

		const seeded = await seedIfNeeded(CWD, sessionsRoot);
		assert.equal(seeded, true);

		const entries = await readRecent(CWD);
		// 最新在前；bash 保留前缀语义（!! = excludeFromContext）
		assert.deepEqual(
			entries.map((e) => e.display),
			["!!make build", "新的普通指令", "!pwd", "旧的普通指令"],
		);
		// 全部落在同一项目文件，首行 meta
		const raw = readFileSync(
			join(sessionsRoot, "..", "pi-cc-extensions", "input-history", `${projectKey(CWD)}.jsonl`),
			"utf-8",
		);
		assert.equal(JSON.parse(raw.split("\n")[0]).project, CWD);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("seedIfNeeded: 空会话目录也能完成 seed（空历史文件）", async () => {
	const dir = join(tmpdir(), `pi-cc-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	process.env.PI_CODING_AGENT_DIR = dir;
	const sessionsRoot = join(dir, "sessions");
	mkdirSync(sessionsRoot, { recursive: true });
	try {
		const seeded = await seedIfNeeded(CWD, sessionsRoot);
		assert.equal(seeded, true);
		assert.deepEqual(await readRecent(CWD), []);
		assert.equal(await hasHistoryFile(CWD), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// 防 SessionManager.list 签名漂移的冒烟断言
test("SessionManager.list 可用且返回 SessionInfo 数组", async () => {
	const dir = join(tmpdir(), `pi-cc-seed-smoke-${Date.now()}`);
	process.env.PI_CODING_AGENT_DIR = dir;
	const sessionsRoot = join(dir, "sessions");
	setup(sessionsRoot, [{ name: "a.jsonl", lines: [sessionHeader(CWD)] }]);
	try {
		const sessions = await SessionManager.list(CWD, sessionsRoot);
		assert.ok(Array.isArray(sessions));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
