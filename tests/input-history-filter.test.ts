import assert from "node:assert/strict";
import test from "node:test";
import {
	isDuplicateOfLast,
	isRecallableBash,
	isRecallableInput,
	isSkillBlock,
} from "../extensions/feature/history/filter.ts";

test("isRecallableInput: 空白与空串不入历史", () => {
	assert.equal(isRecallableInput(""), false);
	assert.equal(isRecallableInput("   "), false);
	assert.equal(isRecallableInput("\n\t"), false);
});

test("isRecallableInput: 斜杠命令不入历史", () => {
	assert.equal(isRecallableInput("/model"), false);
	assert.equal(isRecallableInput("/ccstyle"), false);
	assert.equal(isRecallableInput("  /compact now"), false);
});

test("isRecallableInput: bash 内联防御性排除（bash 走 user_bash 事件）", () => {
	assert.equal(isRecallableInput("!ls"), false);
	assert.equal(isRecallableInput("!!make all"), false);
});

test("isRecallableInput: skill 展开块不入历史", () => {
	assert.equal(isSkillBlock('<skill name="commit">body</skill>'), true);
	assert.equal(isRecallableInput('<skill name="commit">body</skill>'), false);
	assert.equal(isSkillBlock("普通文本"), false);
});

test("isRecallableInput: 普通指令通过（含中文与首尾空白）", () => {
	assert.equal(isRecallableInput("帮我改一下配置"), true);
	assert.equal(isRecallableInput("  fix the bug  "), true);
	assert.equal(isRecallableInput("多行\n输入"), true);
});

test("isRecallableBash: 命令非空即入历史", () => {
	assert.equal(isRecallableBash("echo hi"), true);
	assert.equal(isRecallableBash(""), false);
	assert.equal(isRecallableBash("   "), false);
});

test("isDuplicateOfLast: 仅与上一条完全相同才去重", () => {
	assert.equal(isDuplicateOfLast("npm test", "npm test"), true);
	assert.equal(isDuplicateOfLast("npm test", "npm run build"), false);
	assert.equal(isDuplicateOfLast("npm test", undefined), false);
});
