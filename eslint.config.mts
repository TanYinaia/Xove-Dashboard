import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'prototype',
		'参考项目',
		'插件图标',
		'V0.2',
		'.workbuddy',
		'tools',
		'dashboard v0.2.9',
		'i18n-language-switch-spec.md',
		'*.js',
		'esbuild.config.mjs',
		'rollup.config.mjs',
		'version-bump.mjs',
		'scripts/verify.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['**/*.test.ts'],
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
);
