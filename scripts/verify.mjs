// 本地一键校验：类型检查 → 规范检查 → 打包 → 单测。
// 用法：npm run verify   （或 node scripts/verify.mjs）
// 任何一步失败立即中止并返回非零退出码，用于固化“改动必须过校验”的纪律。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ROOT = process.cwd();
const steps = [
	{ name: '类型检查 (tsc)', cmd: process.execPath, args: ['node_modules/typescript/bin/tsc', '-noEmit', '-skipLibCheck'] },
	{ name: '规范检查 (eslint)', cmd: process.execPath, args: ['node_modules/eslint/bin/eslint.js', '.'] },
	{ name: '打包 (rollup → main.js)', cmd: process.execPath, args: ['node_modules/rollup/dist/bin/rollup', '-c', 'rollup.config.mjs'] },
	{ name: '单元测试 (node --test)', cmd: process.execPath, args: ['--test', 'src/data/*.test.ts'] },
];

console.log('\n=== 本地一键校验 ===\n');
const started = Date.now();
for (const step of steps) {
	process.stdout.write('▶ ' + step.name + ' ... ');
	const res = spawnSync(step.cmd, step.args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
	if (res.status !== 0) {
		process.stdout.write('✗ 失败\n');
		console.error('\n校验中止于「' + step.name + '」（退出码 ' + res.status + '），请先修复再继续。\n');
		process.exit(1);
	}
	process.stdout.write('✓ 通过\n');
}

// 产物完整性
const artifacts = ['main.js', 'manifest.json', 'styles.css'];
const missing = artifacts.filter((a) => !existsSync(ROOT + '/' + a));
if (missing.length > 0) {
	console.error('\n缺少构建产物：' + missing.join(', ') + '\n');
	process.exit(1);
}

console.log('\n=== 全部通过 ✓ （' + ((Date.now() - started) / 1000).toFixed(1) + 's）===\n');