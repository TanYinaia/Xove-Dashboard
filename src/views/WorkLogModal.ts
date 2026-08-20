import { App, Modal } from 'obsidian';
import { WorkLogEntry, WorkLogEntryInput, WorkLogStore } from '../data/workLogParser';

interface WorkLogModalOptions {
	app: App;
	/** 'YYYY-MM-DD'，新增态必填 */
	date: string;
	/** 编辑态传入已有条目 */
	entry?: WorkLogEntry;
	store: WorkLogStore;
	/** 保存/删除后刷新日历 */
	onSaved: () => void;
	/** 轻提示 */
	onToast: (msg: string, kind?: 'success' | 'error') => void;
}

export class WorkLogModal extends Modal {
	private opts: WorkLogModalOptions;

	constructor(opts: WorkLogModalOptions) {
		super(opts.app);
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		const entry = this.opts.entry;
		const isEdit = !!entry;
		contentEl.addClass('ad-task-modal');

		contentEl.createEl('h3', {
			cls: 'ad-modal-title',
			text: isEdit ? '编辑工作日志' : '新增工作日志',
		});
		contentEl.createEl('p', {
			cls: 'ad-modal-sub',
			text: `${this.opts.date}${isEdit ? '' : ' · 新条目'}`,
		});

		// ---- 开始时间 ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '开始时间 *' });
		const startInput = contentEl.createEl('input', { cls: 'ad-modal-input', attr: { type: 'time' } });
		if (entry?.startTime) startInput.value = entry.startTime;

		// ---- 结束时间 ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '结束时间（可选）' });
		const endInput = contentEl.createEl('input', { cls: 'ad-modal-input', attr: { type: 'time' } });
		if (entry?.endTime) endInput.value = entry.endTime;

		// ---- 标题 ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '标题 *' });
		const titleInput = contentEl.createEl('input', {
			cls: 'ad-modal-input',
			attr: { type: 'text', placeholder: '如 系统组会议' },
		});
		if (entry?.title) titleInput.value = entry.title;

		// ---- 标签 ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '标签（空格或逗号分隔）' });
		const tagsInput = contentEl.createEl('input', {
			cls: 'ad-modal-input',
			attr: { type: 'text', placeholder: '#项目X #会议' },
		});
		if (entry?.tags.length) tagsInput.value = entry.tags.join(' ');

		// ---- 关联项目 ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '关联项目（可选）' });
		const projectInput = contentEl.createEl('input', {
			cls: 'ad-modal-input',
			attr: { type: 'text', placeholder: '如 Dashboard插件（将写为 [[Dashboard插件]]）' },
		});
		if (entry?.project) projectInput.value = entry.project;

		// ---- 按钮 ----
		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		if (isEdit) {
			const delBtn = btns.createEl('button', { cls: 'ad-modal-btn wl-del-btn', text: '删除' });
			delBtn.addEventListener('click', () => void this.deleteEntry());
		}
		btns.createEl('button', { cls: 'ad-modal-btn', text: '取消' })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: '保存' })
			.addEventListener('click', () => void this.save(startInput.value, endInput.value, titleInput.value, tagsInput.value, projectInput.value));
	}

	private parseTags(raw: string): string[] {
		return raw
			.split(/[\s,，]+/)
			.map((t) => t.trim())
			.filter(Boolean)
			.map((t) => (t.startsWith('#') ? t : '#' + t));
	}

	private async save(startTime: string, endTime: string, title: string, tagsRaw: string, projectRaw: string): Promise<void> {
		const start = startTime.trim();
		const titleTrim = title.trim();
		if (!start) {
			this.opts.onToast('请填写开始时间', 'error');
			return;
		}
		if (!/^\d{1,2}:\d{2}$/.test(start)) {
			this.opts.onToast('开始时间格式不正确', 'error');
			return;
		}
		if (!titleTrim) {
			this.opts.onToast('请填写标题', 'error');
			return;
		}
		const end = endTime.trim();
		if (end && !/^\d{1,2}:\d{2}$/.test(end)) {
			this.opts.onToast('结束时间格式不正确', 'error');
			return;
		}
		const project = projectRaw.trim() || undefined;
		const input: WorkLogEntryInput = {
			date: this.opts.date,
			startTime: start,
			endTime: end || undefined,
			title: titleTrim,
			tags: this.parseTags(tagsRaw),
			project,
		};

		try {
			if (this.opts.entry) {
				await this.opts.store.updateEntry({ ...this.opts.entry, ...input });
				this.opts.onToast('✨ 工作日志已更新');
			} else {
				await this.opts.store.addEntry(this.opts.date, input);
				this.opts.onToast('✨ 工作日志已添加');
			}
			this.opts.onSaved();
			this.close();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.opts.onToast('保存失败：' + msg, 'error');
		}
	}

	private async deleteEntry(): Promise<void> {
		const entry = this.opts.entry;
		if (!entry) return;
		try {
			await this.opts.store.deleteEntry(entry);
			this.opts.onToast('🗑 工作日志已删除');
			this.opts.onSaved();
			this.close();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.opts.onToast('删除失败：' + msg, 'error');
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
