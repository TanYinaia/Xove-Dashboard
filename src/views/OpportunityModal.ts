import { AbstractInputSuggest, App, Modal, TFile } from 'obsidian';
import {
	BoardItem,
	BoardFormData,
	BoardStage,
} from '../data/opportunityParser';
import { UI_TEXT } from '../constants';

/** 清理双链文件名中的非法字符（[ ] # ^ | /），避免破坏 [[wikilink]] 解析 */
function sanitizeWikiName(name: string): string {
	return name.replace(/[\[\]#^|/]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 从 [[name|alias]] / [[name#heading]] 中提取纯文件名 */
function extractWikiName(link: string): string {
	const cleaned = link.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
	const name = (cleaned.split('|')[0] ?? '').split('#')[0] ?? '';
	return name.trim();
}

/**
 * 链接输入框的 Obsidian 原生补全：输入 `[` 时弹出库内笔记列表，选择后回填 [[笔记名]]。
 * 与编辑器里的 [[ 补全体验一致（基于 AbstractInputSuggest / 文件搜索）。
 */
class FileSuggest extends AbstractInputSuggest<TFile> {
	getSuggestions(query: string): TFile[] {
		// 仅在输入含 `[` 时触发，避免普通文字输入也弹文件列表
		if (!query.includes('[')) return [];
		const q = query.replace(/^\[+/, '').trim().toLowerCase();
		const files = this.app.vault.getMarkdownFiles();
		if (!q) return files.slice(0, 30);
		return files
			.filter((f) => f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
			.slice(0, 30);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createSpan({ text: file.basename });
		el.createDiv({ cls: 'ad-suggest-note', text: file.path });
	}

	selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(`[[${file.basename}]]`);
		this.close();
	}
}

interface OpportunityModalOptions {
	app: App;
	stages: BoardStage[];
	title: string;
	/** 看板数据文件名（用于在新建详情笔记时写回链，形成双向链接；可选） */
	boardFile?: string;
	onSave: (data: BoardFormData) => void;
	editData?: BoardItem;
}

export class OpportunityModal extends Modal {
	private opts: OpportunityModalOptions;
	private isEdit: boolean;
	private selectedStatus: string = '';
	private starred: boolean = false;
	private stageNotes: Record<string, string> = {};
	private linkSuggest: FileSuggest | null = null;

	constructor(opts: OpportunityModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.isEdit = !!opts.editData;
		if (opts.editData) {
			this.selectedStatus = opts.editData.status;
			this.starred = opts.editData.starred;
			this.stageNotes = { ...(opts.editData.stageNotes || {}) };
		}
		if (!this.selectedStatus && opts.stages.length) this.selectedStatus = opts.stages[0]?.label ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		const ed = this.opts.editData;
		const title = this.opts.title;
		contentEl.addClass('ad-task-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: this.isEdit ? ('编辑' + title) : ('新建' + title) });

		// 名称
		contentEl.createEl('label', { cls: 'ad-modal-label', text: title + '名称 *' });
		const nameInput = contentEl.createEl('input', {
			cls: 'ad-modal-input', attr: { type: 'text', placeholder: '输入' + title + '名称' },
		});
		if (ed) nameInput.value = ed.title;
		nameInput.focus?.();

		// 状态
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '状态' });
		const statusSelect = contentEl.createEl('select', { cls: 'ad-modal-input' });
		for (const s of this.opts.stages) statusSelect.createEl('option', { value: s.label, text: s.label });
		statusSelect.value = this.selectedStatus;
		statusSelect.addEventListener('change', () => {
			this.selectedStatus = statusSelect.value;
		});

		// 标签
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '标签（逗号分隔）' });
		const tagInput = contentEl.createEl('input', {
			cls: 'ad-modal-input', attr: { type: 'text', placeholder: '如：增长, 渠道' },
		});
		if (ed) tagInput.value = (ed.tags || []).join(', ');

		// 背景 / 备注（机会级，始终显示）
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '背景 / 备注' });
		const notesArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input', attr: { rows: '3', placeholder: '这个想法是怎么来的、要解决什么…' },
		});
		if (ed) notesArea.value = ed.notes;

		// 阶段输入框：仅渲染「启用输入框」的阶段，输入框标题与该阶段名一致联动
		const stageInputs: Array<{ label: string; area: HTMLTextAreaElement }> = [];
		for (const s of this.opts.stages) {
			if (!s.hasInput) continue;
			contentEl.createEl('label', { cls: 'ad-modal-label', text: s.label });
			const area = contentEl.createEl('textarea', {
				cls: 'ad-modal-input', attr: { rows: '2', placeholder: '填写该阶段相关记录…' },
			});
			area.value = this.stageNotes[s.label] || '';
			stageInputs.push({ label: s.label, area });
		}

		// 链接
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '链接（展开内容用）' });
		const linkInput = contentEl.createEl('input', {
			cls: 'ad-modal-input', attr: { type: 'text', placeholder: '[[xxx-详情]] 或留空（输入 [ 自动搜索笔记）' },
		});
		if (ed) linkInput.value = ed.link;
		// 绑定 Obsidian 原生文件补全：输入 `[` 时弹库内笔记列表
		this.linkSuggest?.close();
		this.linkSuggest = new FileSuggest(this.app, linkInput);
		const linkBtn = contentEl.createEl('button', {
			cls: 'ad-modal-btn ad-modal-btn--ghost', text: '生成并打开链接笔记',
		});
		linkBtn.addEventListener('click', () => {
			void (async () => {
				const t = String(nameInput.value || '').trim();
				if (!t) { nameInput.focus(); return; }
				const rawLink = (linkInput.value ?? '').toString().trim();
				// 无手动链接时，用清理后的名称生成双链，避免特殊字符破坏 wikilink
				const finalLink = rawLink.length ? rawLink : `[[${sanitizeWikiName(t)}-详情]]`;
				linkInput.value = finalLink;
				await this.ensureAndOpenNote(extractWikiName(finalLink));
			})();
		});

		// 星标（重要 / 待跟进）：独立标记，与阶段终态解耦，任何时候都可勾选
		const starRow = contentEl.createDiv({ cls: 'ad-modal-check' });
		const starCheck = starRow.createEl('input', { cls: 'ad-modal-checkbox', attr: { type: 'checkbox' } });
		starRow.createEl('label', { cls: 'ad-modal-check-label', text: '星标（重要 / 待跟进）' });
		starCheck.checked = this.starred;
		starCheck.addEventListener('change', () => { this.starred = starCheck.checked; });

		// 按钮
		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		btns.createEl('button', { cls: 'ad-modal-btn', text: UI_TEXT.cancel })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: this.isEdit ? UI_TEXT.save : ('创建' + title) })
			.addEventListener('click', () => {
				const t = String(nameInput.value || '').trim();
				if (!t) { nameInput.focus(); return; }
				const tags = String(tagInput.value || '').split(',').map((s) => s.trim()).filter(Boolean);
				// 汇总阶段输入框：保留「当前不可见阶段」的历史内容，覆盖可见阶段（留空=清空）
				const visibleLabels = new Set(this.opts.stages.filter((s) => s.hasInput).map((s) => s.label));
				const sn: Record<string, string> = {};
				for (const [k, v] of Object.entries(this.stageNotes)) {
					if (!visibleLabels.has(k)) sn[k] = v;
				}
				for (const si of stageInputs) {
					const v = si.area.value.trim();
					if (v) sn[si.label] = v;
				}
				this.opts.onSave({
					title: t,
					status: this.selectedStatus,
					tags,
					notes: String(notesArea.value || '').trim(),
					stageNotes: sn,
					link: String(linkInput.value || '').trim(),
					starred: this.starred,
				});
				this.close();
			});
	}

	private async ensureAndOpenNote(name: string): Promise<void> {
		const path = name.endsWith('.md') ? name : name + '.md';
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			// 新建详情笔记时写入指向看板文件的回链，形成真正的双向链接
			let backlink = '';
			if (this.opts.boardFile) {
				const boardName = this.opts.boardFile.replace(/\.md$/i, '').replace(/^.*\//, '');
				if (boardName) backlink = `\n> 关联看板：[[${boardName}]]\n`;
			}
			file = await this.app.vault.create(path, `# ${name}\n${backlink}\n`);
		}
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
		}
	}

	onClose(): void {
		this.linkSuggest?.close();
		this.linkSuggest = null;
		this.contentEl.empty();
	}
}
