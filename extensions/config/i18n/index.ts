/**
 * /ccstyle 面板 i18n 入口。
 *
 * - `t(key, params?)` 按当前 `config.language` 取词；缺键回退英文字典，再回退键名本身。
 * - `{xxx}` 占位符按 params 逐个替换，未提供的占位符原样保留（便于发现漏传）。
 * - 仅 panel 链路读取语言；配置键名与枚举值不参与翻译，配置文件格式不受影响。
 */
import { config, type PanelLanguage } from "../config.ts";
import { dict as en } from "./en.ts";
import { dict as zh } from "./zh.ts";

export type LocaleKey = keyof typeof en;

const DICTS: Record<PanelLanguage, Record<LocaleKey, string>> = { en, zh };

export function t(key: LocaleKey, params?: Record<string, string | number>): string {
	const language: PanelLanguage = config.language ?? "en";
	const dict = DICTS[language] ?? en;
	let text: string = dict[key] ?? en[key] ?? key;
	if (params) {
		for (const [name, value] of Object.entries(params)) {
			text = text.split(`{${name}}`).join(String(value));
		}
	}
	return text;
}
