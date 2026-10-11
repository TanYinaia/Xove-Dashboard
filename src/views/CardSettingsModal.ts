import { App, Modal, Setting } from 'obsidian';
import type Dashboard from '../main';
import { addFolderDropdown } from '../settings';
import { t } from '../i18n';

/**
 * 卡片设置弹窗：右键某张首页卡片 →「设置」打开。
 * 仅聚合该卡片专属的设置项；通用/全局配置仍在插件设置页。
 * 修改后即时保存并通过 onSaved 回调触发对应卡片刷新。
 */
export class CardSettingsModal extends Modal {
	private plugin: Dashboard;
	private moduleId: string;
	private cardName: string;
	private onSaved: (moduleId: string) => void;

	constructor(app: App, plugin: Dashboard, moduleId: string, cardName: string, onSaved: (moduleId: string) => void) {
		super(app);
		this.plugin = plugin;
		this.moduleId = moduleId;
		this.cardName = cardName;
		this.onSaved = onSaved;
	}

	onOpen(): void {
		this.contentEl.addClass('ad-card-settings');
		this.titleEl.setText(t('cardSettings.title', { name: this.cardName }));
		this.buildForModule();
	}

	/** 保存并通知视图刷新对应卡片 */
	private commit(): void {
		void this.plugin.saveSettings().then(() => this.onSaved(this.moduleId));
	}

	private buildForModule(): void {
		const s = this.plugin.settings;
		const root = this.contentEl;

		switch (this.moduleId) {
			case 'todo': {
				addFolderDropdown(
					new Setting(root).setName(t('cardSettings.todoFolder')).setDesc(t('cardSettings.todoFolderDesc')),
					this.app,
					s.todoSourceFolder,
					async (v) => { s.todoSourceFolder = v; this.commit(); },
				);
				new Setting(root).setName(t('cardSettings.todoKeepDone')).setDesc(t('cardSettings.todoKeepDoneDesc'))
					.addToggle((tg) => tg.setValue(!!s.todoShowCompleted).onChange((v) => {
						s.todoShowCompleted = v; this.commit();
					}));
				break;
			}
			case 'weekly': {
				new Setting(root).setName(t('cardSettings.todoKeepDone')).setDesc(t('cardSettings.todoKeepDoneDesc'))
					.addToggle((tg) => tg.setValue(!!s.todoShowCompleted).onChange((v) => {
						s.todoShowCompleted = v; this.commit();
					}));
				break;
			}
			case 'projects': {
				new Setting(root).setName(t('cardSettings.projectFilter')).setDesc(t('cardSettings.projectFilterDesc'))
					.addDropdown((dd) => {
						const stages = s.npdpStages ?? [];
						stages.forEach((label, i) => { dd.addOption(String(i), `≤ ${label}`); });
						dd.addOption(String(stages.length), t('settings.pipelineShowAll'));
						dd.setValue(String(s.npdpProgressFilter ?? stages.length));
						dd.onChange((v) => { s.npdpProgressFilter = parseInt(v, 10); this.commit(); });
					});
				new Setting(root).setName(t('cardSettings.stageLabelMode')).setDesc(t('cardSettings.stageLabelModeDesc'))
					.addDropdown((dd) => {
						dd.addOption('current', t('cardSettings.labelCurrent'));
						dd.addOption('all', t('cardSettings.labelAll'));
						dd.setValue(s.npdpStageLabelMode ?? 'current');
						dd.onChange((v) => {
							s.npdpStageLabelMode = v === 'all' ? 'all' : 'current';
							this.commit();
						});
					});
				break;
			}
			case 'pomodoro': {
				new Setting(root).setName(t('cardSettings.pomoWork'))
					.addText((tc) => tc.setValue(String(s.pomodoro?.workMin ?? 25)).onChange((v) => {
						const n = parseInt(v, 10);
						if (Number.isFinite(n) && n > 0) { s.pomodoro = { ...s.pomodoro, workMin: Math.min(180, n) }; this.commit(); }
					}));
				new Setting(root).setName(t('cardSettings.pomoBreak'))
					.addText((tc) => tc.setValue(String(s.pomodoro?.breakMin ?? 5)).onChange((v) => {
						const n = parseInt(v, 10);
						if (Number.isFinite(n) && n > 0) { s.pomodoro = { ...s.pomodoro, breakMin: Math.min(60, n) }; this.commit(); }
					}));
				break;
			}
			case 'heatmap': {
				new Setting(root).setName(t('cardSettings.hmFocus')).setDesc(t('cardSettings.hmFocusDesc'))
					.addToggle((tg) => tg.setValue(!!s.heatmapFocus).onChange((v) => {
						s.heatmapFocus = v; this.commit();
					}));
				new Setting(root).setName(t('cardSettings.hmRange'))
					.addDropdown((dd) => {
						dd.addOption('rolling', t('cardSettings.hmRolling'));
						dd.addOption('year', t('cardSettings.hmYear'));
						dd.setValue(s.heatmapRange === 'year' ? 'year' : 'rolling');
						dd.onChange((v) => { s.heatmapRange = v === 'year' ? 'year' : 'rolling'; this.commit(); });
					});
				break;
			}
			default: {
				root.createDiv({ cls: 'ad-card-settings__empty', text: t('cardSettings.noOptions') });
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
