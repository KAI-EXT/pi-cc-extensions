// 一次性脚本：从 docs/i18n/*.json 生成 extensions/config/i18n/{en,zh}.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const en = JSON.parse(readFileSync(`${root}docs/i18n/ccstyle-panel-en.json`, "utf8"));
const zh = JSON.parse(readFileSync(`${root}docs/i18n/ccstyle-panel-zh.json`, "utf8"));
delete en._meta;
delete zh._meta;
mkdirSync(`${root}extensions/config/i18n`, { recursive: true });

const enKeys = Object.keys(en);
const zhKeys = Object.keys(zh);
if (enKeys.join("\n") !== zhKeys.join("\n")) {
	throw new Error("键集合不一致，请先校验 JSON");
}

const render = (dict, header, tail = "") =>
	`${header}
export const dict${tail} = {
${Object.entries(dict)
	.map(([k, v]) => `\t"${k}": ${JSON.stringify(v)},`)
	.join("\n")}\n} as const;\n`;

writeFileSync(
	`${root}extensions/config/i18n/en.ts`,
	render(
		en,
		"/**\n * /ccstyle 面板英文字典。\n * 生成自 docs/i18n/ccstyle-panel-en.json（键序一致）；键名 = 设置项 id + 文案槽位，{xxx} 为运行时占位符。\n */",
	).replaceAll(/\t/g, "\t"),
);
writeFileSync(
	`${root}extensions/config/i18n/zh.ts`,
	render(
		zh,
		'/**\n * /ccstyle 面板简体中文字典（默认语言）。\n * 键必须与 en.ts 完全一致（Record<LocaleKey, string> 编译期校验）；由 docs/i18n/ccstyle-panel-zh.json 生成。\n */\nimport type { dict as enDict } from "./en.ts";',
		": Record<keyof typeof enDict, string>",
	),
);
console.log("en:", enKeys.length, "zh:", zhKeys.length);
