/**
 * 输入历史过滤卫生（方案 003 §3.3）。
 *
 * 语义与 shell 历史一致：只记「发给模型的指令」与「用户显式执行的 bash 命令」。
 * 排除空输入、斜杠命令（含 pi 展开后的 /skill: 块）。bash 命令由 user_bash 事件
 * 单独捕获（评审决策①），input 事件里的 `!` 前缀文本属防御性排除。
 */

/** pi 把 /skill 调用展开成以 `<skill name="...">` 开头的文本块。 */
export function isSkillBlock(text: string): boolean {
	return text.trimStart().startsWith('<skill name="');
}

/**
 * input 事件文本是否值得入历史。
 * 排除：空白、斜杠命令、`!`/`!!` bash 内联（防御性；bash 走 user_bash 事件）、skill 展开块。
 */
export function isRecallableInput(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.startsWith("/")) return false;
	if (trimmed.startsWith("!")) return false;
	return !isSkillBlock(trimmed);
}

/** user_bash 命令是否值得入历史（command 为不含 `!` 前缀的原文）。 */
export function isRecallableBash(command: string): boolean {
	return command.trim().length > 0;
}

/**
 * 相邻去重：与上一条 display 完全相同则跳过（同文件即同项目，对齐 Claude 写侧去重）。
 * 多窗口各自持有一份 last，跨窗口重复由读取侧全局去重兜底。
 */
export function isDuplicateOfLast(text: string, last: string | undefined): boolean {
	return last !== undefined && text === last;
}
