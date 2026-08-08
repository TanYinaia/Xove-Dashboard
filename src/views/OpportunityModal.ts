import { App, Modal, TFile } from 'obsidian';
import {
	OPPORTUNITY_STATUS_LIST,
	OpportunityItem,
	OpportunityStatus,
	OpportunityFormData,
} from '../data/opportunityParser';

interface OpportunityModalOptions {
	app: App;
	onSave: (data: OpportunityFormData) => void;
	editData?: OpportunityItem;
}

export class OpportunityModal extends Modal {
	private opts: OpportunityModalOptions;
	private isEdit: boolean;
	private selectedStatus: OpportunityStatus = '未沟通';
	private toRoadmap: boolean = false;

	constructor(opts: OpportunityModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.isEdit = !!opts.editData;
		if (opts.editData) {
			this.selectedStatus = opts.editData.status;
			this.toRoadmap = opts.editData.toRoadmap;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		const ed = this.opts.editData;
		contentEl.addClass('ad-task-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: this.isEdit ? '编辑机会点' : '新建机会点' });

		// 机会点名称
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '机会点名称 *' });
		const nameInput = contentEl.createEl('input', {
			cls: 'ad-modal-input', attr: { type: 'text', placeholder: '输入机会点名称' },
		});
		if (ed) nameInput.value = ed.title;
		nameInput.focus?.();

		// 状态
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '状态' });
		const statusSelect = contentEl.createEl('select', { cls: 'ad-modal-input' });
		for (const s of OPPORTUNITY_STATUS_LIST) statusSelect.createEl('option', { value: s, text: s });
		statusSelect.value = this.selectedStatus;
		statusSelect.addEventListener('change', () => {
			this.selectedStatus = statusSelect.value as OpportunityStatus;
			const cb = contentEl.querySelector('.ad-modal-checkbox') as HTMLInputElement | null;
			if (this.selectedStatus !== '已完成') {
				this.toRoadmap = false;
				if (cb) { cb.checked = false; cb.disabled = true; }
			} else if (cb) {
				cb.disabled = false;
			}
		});

		// 标签
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '标签（逗号分隔）' });
		const tagInput = contentEl.createEl('input', {
			cls: 'ad-modal-input', attr: { type: 'text', placeholder: '如：增长, 渠道' },
		});
		if (ed) tagInput.value = (ed.tags || []).join(', ');

		// 背景 / 描述
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '背景 / 描述' });
		const bgArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input', attr: { rows: '3', placeholder: '这个想法是怎么来的、要解决什么…' },
		});
		if (ed) bgArea.value = ed.background;

		// 沟通结论
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '沟通结论' });
		const commArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input', attr: { rows: '2', placeholder: '沟通后的判断…' },
		});
		if (ed) commArea.value = ed.commConclusion;

		// 调研结论
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '调研结论' });
		const researchArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input', attr: { rows: '2', placeholder: '调研发现…' },
		});
		if (ed) researchArea.value = ed.researchConclusion;

		// 上会结论
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '上会结论' });
		const meetingArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input', attr: { rows: '2', placeholder: '上会讨论结果…' },
		});
		if (ed) meetingArea.value = ed.meetingConclusion;

		// 转路标
		const roadmapRow = contentEl.createDiv({ cls: 'ad-modal-check' });
		const roadmapCheck = roadmapRow.createEl('input', { cls: 'ad-modal-checkbox', attr: { type: 'checkbox' } });
		roadmapRow.createEl('label', { cls: 'ad-modal-check-label', text: '已上会通过将转为路标（年底规划时真正转）' });
		roadmapCheck.checked = this.toRoadmap;
		roadmapCheck.disabled = this.selectedStatus !== '已完成';
		roadmapCheck.addEventListener('change', () => { this.toRoadmap = roadmapCheck.checked; });

		// 详情双链
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '详情双链（展开内容用）' });
		const detailInput = contentEl.createEl('input', {
			cls: 'ad-modal-input', attr: { type: 'text', placeholder: '[[机会点-xxx-详情]] 或留空' },
		});
		if (ed) detailInput.value = ed.detail;
		const detailBtn = contentEl.createEl('button', {
			cls: 'ad-modal-btn ad-modal-btn--ghost', text: '生成并打开详情笔记',
		});
		detailBtn.addEventListener('click', async () => {
			const title = String(nameInput.value || '').trim();
			if (!title) { nameInput.focus(); return; }
			const rawLink = (detailInput.value ?? '').toString().trim();
			const finalLink = rawLink.length ? rawLink : `[[机会点-${title}-详情]]`;
			detailInput.value = finalLink;
			const cleaned = finalLink.replace(/^\[\[/, '').replace(/\]\]$/, '');
			const noteName = (cleaned.split('|')[0] ?? '').trim();
			await this.ensureAndOpenNote(noteName);
		});

		// 按钮
		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		btns.createEl('button', { cls: 'ad-modal-btn', text: '取消' })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: this.isEdit ? '保存' : '创建机会点' })
			.addEventListener('click', () => {
				const title = String(nameInput.value || '').trim();
				if (!title) { nameInput.focus(); return; }
				const tags = String(tagInput.value || '').split(',').map((s) => s.trim()).filter(Boolean);
				this.opts.onSave({
					title,
					status: this.selectedStatus,
					tags,
					background: String(bgArea.value || '').trim(),
					commConclusion: String(commArea.value || '').trim(),
					researchConclusion: String(researchArea.value || '').trim(),
					meetingConclusion: String(meetingArea.value || '').trim(),
					toRoadmap: this.toRoadmap,
					detail: String(detailInput.value || '').trim(),
				});
				this.close();
			});
	}

	private async ensureAndOpenNote(name: string): Promise<void> {
		const path = name.endsWith('.md') ? name : name + '.md';
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			file = await this.app.vault.create(path, `# ${name}\n\n`);
		}
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
