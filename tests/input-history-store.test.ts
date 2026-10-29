import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	appendEntry,
	historyFilePath,
	projectKey,
	readRecent,
} from "../extensions/feature/history/store.ts";

/** 隔离 agent 目录（getAgentDir 每次调用读 env），返回还原函数。 */
function isolateAgentDir(): string {
	const dir = join(tmpdir(), `pi-cc-history-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = dir;
	return dir;
}

const CWD = "/Users/demo/work/demo-project";

test("projectKey: 与 pi 会话目录 slug 编码同构", () => {
	assert.equal(projectKey("/Users/demo/work/demo-project"), "--Users-demo-work-demo-project--");
	assert.equal(projectKey("/a/b.c"), "--a-b.c--"); // 点号保留（pi 编码只替换 / \ :）
	assert.equal(projectKey("C:\\repo"), "--C--repo--"); // 盘符冒号与反斜杠替换（pi 不去中间路径的开头字符）
	assert.equal(projectKey("/用户/项目"), "--用户-项目--"); // 中文保留
});

test("projectKey: 超长路径截断并追加 hash，字节长度有界", () => {
	const deep = `/${"very-long-segment/".repeat(30)}tail`;
	const key = projectKey(deep);
	assert.ok(Buffer.byteLength(key, "utf-8") <= 200, `key 字节过长: ${Buffer.byteLength(key)}`);
	assert.ok(key.startsWith("--") && /[0-9a-f]{8}$/.test(key), "截断后带短 hash 后缀");
	// 确定性
	assert.equal(projectKey(deep), key);
});

test("appendEntry + readRecent: 往返读出，最新在前", async () => {
	const dir = isolateAgentDir();
	try {
		appendEntry(CWD, { display: "第一条", timestamp: 1000 });
		appendEntry(CWD, { display: "第二条", sessionId: "s1.jsonl", timestamp: 2000 });
		appendEntry(CWD, { display: "第三条", timestamp: 3000 });
		await appendEntry(CWD, { display: "第四条", timestamp: 4000 });

		const entries = await readRecent(CWD);
		assert.deepEqual(
			entries.map((e) => e.display),
			["第四条", "第三条", "第二条", "第一条"],
		);
		assert.equal(entries[1].sessionId, undefined);
		// 首行 meta 已写入
		const first = readFileSync(historyFilePath(CWD), "utf-8").split("\n")[0];
		assert.equal(JSON.parse(first).type, "meta");
		assert.equal(JSON.parse(first).project, CWD);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readRecent: 文件不存在返回空数组", async () => {
	const dir = isolateAgentDir();
	try {
		assert.deepEqual(await readRecent(CWD), []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readRecent: meta 行与坏行跳过，残行不炸", async () => {
	const dir = isolateAgentDir();
	try {
		const file = historyFilePath(CWD);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(
			file,
			[
				JSON.stringify({ type: "meta", project: CWD, createdAt: 1 }),
				"not-a-json-line",
				JSON.stringify({ display: "好条目", timestamp: 1000 }),
				JSON.stringify({ type: "meta", project: "其他", createdAt: 2 }), // 中途插入的 meta 也跳过
				'{"display":"残缺条目", "time', // 尾部无换行的截断行
			].join("\n"),
		);
		const entries = await readRecent(CWD);
		assert.deepEqual(
			entries.map((e) => e.display),
			["好条目"],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readRecent: 同 display 全局去重保留最新位置", async () => {
	const dir = isolateAgentDir();
	try {
		appendEntry(CWD, { display: "npm test", timestamp: 1000 });
		appendEntry(CWD, { display: "ls", timestamp: 2000 });
		appendEntry(CWD, { display: "npm test", timestamp: 3000 });
		await appendEntry(CWD, { display: "git status", timestamp: 4000 });

		const entries = await readRecent(CWD);
		assert.deepEqual(
			entries.map((e) => e.display),
			["git status", "npm test", "ls"],
		);
		assert.equal(entries.find((e) => e.display === "npm test")?.timestamp, 3000);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readRecent: 超过 64KB 触发向前扩读，返回 250 条最新", async () => {
	const dir = isolateAgentDir();
	try {
		// 每条约 300B × 300 条 ≈ 90KB > 64KB，必须扩读才能凑齐 250
		for (let i = 0; i < 300; i++) {
			appendEntry(CWD, {
				display: `历史指令 ${String(i).padStart(4, "0")} ${"x".repeat(250)}`,
				timestamp: i,
			});
		}
		await appendEntry(CWD, { display: "垫底最新条", timestamp: 99999 });

		const entries = await readRecent(CWD, 250);
		assert.equal(entries.length, 250);
		assert.equal(entries[0].display, "垫底最新条");
		assert.ok(entries[249].display.startsWith("历史指令 005"), "最旧一条应是第 50 号附近");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("appendEntry: display 超 8KB 截断", async () => {
	const dir = isolateAgentDir();
	try {
		const huge = "长".repeat(20_000);
		await appendEntry(CWD, { display: huge, timestamp: 1000 });
		const entries = await readRecent(CWD);
		assert.ok(entries[0].display.length <= 8 * 1024);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("appendEntry: 并发调用按序落盘", async () => {
	const dir = isolateAgentDir();
	try {
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				appendEntry(CWD, { display: `并发 ${i}`, timestamp: i }),
			),
		);
		const entries = await readRecent(CWD);
		assert.equal(entries.length, 20);
		// 文件物理行数 = meta 1 + 历史 20 + 末尾空行
		const raw = readFileSync(historyFilePath(CWD), "utf-8");
		assert.equal(raw.split("\n").filter((l) => l.trim().length > 0).length, 21);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readAllProjects: 跨项目合并去重取最近", async () => {
	const dir = isolateAgentDir();
	try {
		// 两个项目文件，时间交错
		const cwdA = "/tmp/proj-alpha";
		const cwdB = "/tmp/proj-beta";
		appendEntry(cwdA, { display: "A1", timestamp: 1000 });
		appendEntry(cwdB, { display: "B1", timestamp: 2000 });
		appendEntry(cwdA, { display: "A2", timestamp: 3000 });
		await appendEntry(cwdB, { display: "B2", timestamp: 4000 });

		const { readAllProjects } = await import("../extensions/feature/history/store.ts");
		const entries = await readAllProjects(10);
		assert.deepEqual(
			entries.map((e) => e.display),
			["B2", "A2", "B1", "A1"],
		);
		// limit 生效
		const limited = await readAllProjects(2);
		assert.deepEqual(
			limited.map((e) => e.display),
			["B2", "A2"],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("竞态：seed 与 append 并发时 append 条目不被覆盖", async () => {
	const dir = isolateAgentDir();
	try {
		const cwd = "/private/tmp/pi-cc-race";
		// 模拟：seed（写 meta+存量）与用户首条 append 同时启动
		const seedPromise = (async () => {
			const { writeInitialEntries } = await import("../extensions/feature/history/store.ts");
			await writeInitialEntries(cwd, [{ display: "存量条目", timestamp: 1000 }]);
		})();
		appendEntry(cwd, { display: "用户首条输入", sessionId: "demo.jsonl", timestamp: 2000 });
		await seedPromise;
		await appendEntry(cwd, { display: "用户第二条", sessionId: "demo.jsonl", timestamp: 3000 });

		const entries = await readRecent(cwd, 250);
		const displays = entries.map((e) => e.display);
		assert.ok(displays.includes("用户首条输入"), "首条输入不被 seed 覆盖");
		assert.ok(displays.includes("用户第二条"), "第二条保留");
		assert.ok(displays.includes("存量条目"), "seed 存量保留");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
