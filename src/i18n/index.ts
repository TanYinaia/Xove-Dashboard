/**
 * 极简 i18n 基础设施（无第三方依赖，全量内置、无需网络）。
 *
 * 设计要点：
 * - 仅两种模式：'zh'（现状中英结合 mix，默认）、'en'（纯英文）。
 * - 品牌锚点词（SECOND BRAIN / XOVE DASHBOARD）按产品决策恒定英文，不进字典。
 * - t(path, params?) 按点路径取词；当前语言缺失时回退 zh；zh 也缺失时返回 key（永不空白）。
 * - 农历在英文模式下由调用方主动隐藏（决策2），字典只负责文案本身。
 */

export type Lang = 'zh' | 'en';

// 字典是嵌套对象，key 用点路径访问，如 t('home.toolbar.newDiary')
// 值可为字符串或字符串数组（如星期名/月份名），t() 取字符串、tArr() 取数组。
export type Dict = { [k: string]: string | string[] | Dict };

import { zh } from './zh.ts';
import { en } from './en.ts';

const dicts: Record<Lang, Dict> = { zh, en };
let current: Lang = 'zh';

export function getLang(): Lang {
	return current;
}

export function setLang(l: Lang): void {
	current = l;
}

/** 当前语言是否英文模式（供"隐藏农历"等条件分支使用） */
export function isEnglish(): boolean {
	return current === 'en';
}

function walk(dict: Dict, path: string): string | string[] | undefined {
	let v: string | string[] | Dict | undefined = dict;
	for (const k of path.split('.')) {
		if (v === undefined || typeof v === 'string' || Array.isArray(v)) return undefined;
		v = (v as Dict)[k];
	}
	return typeof v === 'string' || Array.isArray(v) ? v : undefined;
}

/**
 * 取词。params 用于 {name} 占位替换。
 * 回退链：当前语言 → zh → 返回 key。
 */
export function t(path: string, params?: Record<string, string | number>): string {
	let v = walk(dicts[current], path);
	if (typeof v !== 'string') v = walk(dicts.zh, path);
	if (typeof v !== 'string') return path;
	if (params) {
		for (const [k, val] of Object.entries(params)) {
			v = v.replace(new RegExp('\\{' + k + '\\}', 'g'), String(val));
		}
	}
	return v;
}

/** 取字符串数组（星期名/月份名等）。回退链：当前语言 → zh → 空数组。 */
export function tArr(path: string): string[] {
	let v = walk(dicts[current], path);
	if (!Array.isArray(v)) v = walk(dicts.zh, path);
	return Array.isArray(v) ? v : [];
}
