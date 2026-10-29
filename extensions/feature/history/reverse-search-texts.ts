/**
 * 反搜组件文案（方案 003 M5 本地化）。
 * 由 history/index.ts 在打开反搜时按当前语言组装传入，组件保持纯渲染。
 */
export interface ReverseSearchTexts {
	/** 标题（不含 scope 后缀）。 */
	title: string;
	/** 三档 scope 的显示名（键序 = 循环顺序）。 */
	scopeLabels: Record<"session" | "project" | "everywhere", string>;
	/** 底部提示行。 */
	hint: string;
	/** 输入框占位符（空查询时显示）。 */
	placeholder: string;
	/** 无匹配提示。 */
	noMatch: string;
}
