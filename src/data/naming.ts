/**
 * 文件名命名工具：把命名占位符（YYYY/MM/DD/…）替换为日期字符串。
 * 从 DashboardView.applyNamingPattern 抽出，作为日记与工作日志共用的单一真相源。
 */

export function applyNamingPattern(pattern: string, d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	const WK_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
	const WK_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
	const meridiem = d.getHours() < 12 ? '上午' : '下午';
	const h12 = d.getHours() % 12 || 12;
	// 支持的命名占位符（一次性正则替换，避免 DD 与 ddd/dddd 互相串扰）。
	// YYYY 年 / MM 月(2位) / MMM 月缩写(如 8月) / DD 日(2位)
	// ddd 星期短(周日) / dddd 星期全(星期日)
	// HH 24小时 / hh 12小时 / mm 分 / ss|SS 秒 / A 上午·下午
	const map: Record<string, string> = {
		YYYY: String(d.getFullYear()),
		MMM: `${d.getMonth() + 1}月`,
		MM: pad(d.getMonth() + 1),
		dddd: WK_FULL[d.getDay()]!,
		ddd: WK_SHORT[d.getDay()]!,
		DD: pad(d.getDate()),
		HH: pad(d.getHours()),
		hh: pad(h12),
		mm: pad(d.getMinutes()),
		ss: pad(d.getSeconds()),
		SS: pad(d.getSeconds()),
		A: meridiem,
	};
	const name = pattern.replace(/(dddd|ddd|YYYY|MMM|MM|DD|HH|hh|mm|ss|SS|A)/g, (m) => map[m] ?? m);
	// Remove characters not allowed in filenames (Windows/Mac/Linux)
	return name.replace(/[*"/<>:|?\\]/g, '-');
}
