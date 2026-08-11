import { App, Modal, TFile } from 'obsidian';
import { TaskItem, TaskStatus, TaskPriority, STATUS_LIST, PRIORITY_LIST, NodeState, DailyNode, serializeDailyNodesBlock } from '../data/taskParser';
import { UI_TEXT } from '../constants';

interface TaskEditModalOptions {
	app: App;
	task: TaskItem;
	onSave: () => void;
	presetTodayNode?: NodeState;
}

export class TaskEditModal extends Modal {
	private opts: TaskEditModalOptions;
	private presetTodayNode?: NodeState;
	private activeState?: NodeState;

	constructor(opts: TaskEditModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.presetTodayNode = opts.presetTodayNode;
	}

	onOpen(): void {
		const { contentEl } = this;
		const task = this.opts.task;
		contentEl.addClass('ad-task-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: UI_TEXT.taskDetail });

		// ---- Title (editable name) ----
		this.field('任务名称 *', (wrap) => {
			wrap.createEl('input', { cls: 'ad-modal-input ad-edit-title', attr: { type: 'text', value: task.content } });
		});

		// ---- Status ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '状态' });
		const statusSel = contentEl.createEl('select', { cls: 'ad-modal-input' });
		for (const s of STATUS_LIST) {
			const opt = statusSel.createEl('option', { text: s, attr: { value: s } });
			if (s === task.status) opt.selected = true;
		}

		// ---- Priority ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '优先级' });
		const prioSel = contentEl.createEl('select', { cls: 'ad-modal-input' });
		prioSel.createEl('option', { text: UI_TEXT.notSet, attr: { value: '' } });
		for (const p of PRIORITY_LIST) {
			if (!p) continue;
			const opt = prioSel.createEl('option', { text: p, attr: { value: p } });
			if (p === task.priority) opt.selected = true;
		}

		// ---- Dates ----
		const row = contentEl.createDiv({ cls: 'ad-modal-row' });
		const startCol = row.createDiv({ cls: 'ad-modal-col' });
		startCol.createEl('label', { cls: 'ad-modal-label', text: '开始日期' });
		const startInput = startCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date' } });
		if (task.startDate) startInput.value = task.startDate;

		const endCol = row.createDiv({ cls: 'ad-modal-col' });
		endCol.createEl('label', { cls: 'ad-modal-label', text: '截止日期' });
		const endInput = endCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date' } });
		if (task.dueDate) endInput.value = task.dueDate;

		// ---- Notes ----
		contentEl.createEl('label', { cls: 'ad-modal-label', text: '备注' });
		const notesArea = contentEl.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '3' } });
		if (task.notes) notesArea.value = task.notes;

		// ---- Daily node axis (multi-day tasks only) ----
		const isMultiDay = !!(task.startDate && task.dueDate && task.startDate !== task.dueDate);
		if (isMultiDay) this.renderNodeAxis(contentEl, task);

		// ---- Buttons ----
		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		btns.createEl('button', { cls: 'ad-modal-btn', text: UI_TEXT.cancel })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: UI_TEXT.save })
			.addEventListener('click', () => {
				const titleEl = contentEl.querySelector('.ad-edit-title') as HTMLInputElement;
				const nodeNoteEl = contentEl.querySelector('.ad-node-note') as HTMLTextAreaElement;
				void this.saveTask(titleEl?.value?.trim() || task.content, statusSel.value, prioSel.value, startInput.value, endInput.value, notesArea.value, nodeNoteEl?.value ?? '');
			});
	}

	private async saveTask(title: string, status: string, priority: string, startDate: string, endDate: string, notes: string, nodeNote: string): Promise<void> {
		const task = this.opts.task;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		// ---- Rename file if title changed ----
		const newTitle = title.trim();
		if (newTitle && newTitle !== task.content) {
			const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
			const newPath = dir ? `${dir}/${newTitle}.md` : `${newTitle}.md`;
			if (!this.app.vault.getAbstractFileByPath(newPath)) {
				await this.app.fileManager.renameFile(file, newPath);
				task.content = newTitle;
				task.id = newPath;
				task.sourceFile = newPath;
			}
		}

		const content = await this.app.vault.read(file);
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		let inFM = false;

		// Track whether priority already exists in frontmatter (frontmatter-scoped,
		// avoids false positives from body content containing "优先级:").
		let hasPriority = false;
		let statusLineIdx = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.trim() === '---') { inFM = !inFM; continue; }
			if (!inFM) continue;

			if (line.startsWith('状态:')) {
				lines[i] = `状态: ${status}`;
				statusLineIdx = i;
			} else if (line.startsWith('优先级:')) {
				lines[i] = `优先级: ${priority}`;
				hasPriority = true;
			} else if (line.startsWith('开始日期:')) {
				lines[i] = `开始日期: ${startDate}`;
			} else if (line.startsWith('截止日期:')) {
				lines[i] = `截止日期: ${endDate}`;
			} else if (line.startsWith('备注:')) {
				lines[i] = `备注: ${notes}`;
			}
		}

		// If priority was set but missing from frontmatter, insert after 状态 line.
		// (statusLineIdx is frontmatter-scoped, so we never insert into the body.)
		if (priority && !hasPriority && statusLineIdx >= 0) {
			lines.splice(statusLineIdx + 1, 0, `优先级: ${priority}`);
		}

		// ---- Daily nodes (multi-day check-in) ----
		const today = todayStr();
		const nodes: Record<string, DailyNode> = { ...task.dailyNodes };
		const noteTrim = nodeNote.trim();
		if (this.activeState || noteTrim) {
			nodes[today] = { s: this.activeState ?? 'todo', n: noteTrim };
		} else {
			delete nodes[today];
		}
		// Remove any legacy frontmatter "每日节点:" line (migrated to body block).
		{
			const ni = lines.findIndex((l) => l?.startsWith('每日节点:'));
			if (ni >= 0) lines.splice(ni, 1);
		}

		// ---- 完成时间 (record when whole task status changes) ----
		const wasDone = task.status === '已完成';
		const willDone = status === '已完成';
		if (willDone && !wasDone) {
			// 未完成 → 已完成：写入当前时间
			inFM = false; // reset for a fresh frontmatter scan
			let found = false;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line) continue;
				if (line.trim() === '---') { inFM = !inFM; continue; }
				if (!inFM) continue;
				if (line.startsWith('完成时间:')) { lines[i] = `完成时间: ${nowFmt()}`; found = true; break; }
			}
			if (!found) {
				const si = lines.findIndex((l, idx) => {
					// frontmatter-scoped: only consider lines before the closing ---
					return l?.startsWith('状态:') && idx <= (statusLineIdx >= 0 ? statusLineIdx + 2 : lines.length);
				});
				if (si >= 0) lines.splice(si + 1, 0, `完成时间: ${nowFmt()}`);
			}
		} else if (!willDone && wasDone) {
			// 已完成 → 未完成：移除完成时间
			const ci = lines.findIndex((l) => l?.startsWith('完成时间:'));
			if (ci >= 0) lines.splice(ci, 1);
		}

		// ---- Rewrite "## 每日节点" body block ----
		{
			// End of frontmatter
			let fmEnd = 0;
			if (lines[0]?.trim() === '---') {
				for (let i = 1; i < lines.length; i++) {
					if (lines[i]?.trim() === '---') { fmEnd = i; break; }
				}
			}
			// Remove existing block (heading + its node list items / blanks)
			const headIdx = lines.findIndex((l, idx) => idx > fmEnd && /^#{1,6}\s+每日节点\s*$/.test(l ?? ''));
			if (headIdx >= 0) {
				let end = headIdx + 1;
				for (; end < lines.length; end++) {
					const l = (lines[end] ?? '').trim();
					if (l === '') continue;
					if (/^-\s*\d{4}-\d{2}-\d{2}/.test(l)) continue;
					break;
				}
				lines.splice(headIdx, end - headIdx);
			}
			// Append a fresh block at end of file
			const block = serializeDailyNodesBlock(nodes);
			if (block) {
				while (lines.length && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
				lines.push('', block, '');
			}
		}

		await this.app.vault.modify(file, lines.join(eol));

		// Update task object — only refresh completeTime when the file was actually
		// changed, so memory stays consistent with disk (fixes stale-time bug).
		task.status = status as TaskStatus;
		task.priority = (priority as TaskPriority) || null;
		task.startDate = startDate || null;
		task.dueDate = endDate || null;
		task.notes = notes;
		task.dailyNodes = nodes;
		if (willDone && !wasDone) {
			task.completeTime = nowFmt();
		} else if (!willDone && wasDone) {
			task.completeTime = null;
		}
		// else: status unchanged → keep original completeTime untouched (memory == disk)

		this.opts.onSave();
		this.close();
	}

	private renderNodeAxis(parent: HTMLElement, task: TaskItem): void {
		const today = todayStr();
		const due = task.dueDate!;
		// Axis end depends on completion:
		//  - completed → completion date only: stop at the day it was done.
		//                (early completion ⇒ no cells after; on-time ⇒ at due; late ⇒ extends to the late day)
		//  - pending   → max(due, today): keep overdue pending days visible so they can still be checked in
		const isDone = task.status === '已完成';
		const completeDate = task.completeTime ? task.completeTime.slice(0, 10) : due;
		const axisEnd = isDone ? completeDate : (today > due ? today : due);
		const dates = eachDate(task.startDate!, axisEnd);

		// Side-by-side layout: axis + buttons on the left, today's note on the right
		const row = parent.createDiv({ cls: 'ad-node-row' });
		const left = row.createDiv({ cls: 'ad-node-col' });
		const right = row.createDiv({ cls: 'ad-node-col' });

		left.createEl('label', { cls: 'ad-modal-label', text: '每日节点' });
		const axis = left.createDiv({ cls: 'ad-node-axis' });

		// Weekday header (Mon=一 .. Sun=日)
		const head = axis.createDiv({ cls: 'ad-node-axis__head' });
		for (const w of ['一', '二', '三', '四', '五', '六', '日']) head.createSpan({ text: w });

		// Cells aligned to weekday columns
		const grid = axis.createDiv({ cls: 'ad-node-axis__grid' });
		const firstDow = (new Date(task.startDate! + 'T00:00:00').getDay() + 6) % 7;
		for (let i = 0; i < firstDow; i++) grid.createSpan({ cls: 'ad-node-cell ad-node-cell--empty' });
		for (const date of dates) {
			let node = task.dailyNodes[date];
			// For a completed task, the completion day itself counts as done
			// (whole-task completion, even if that day was never checked in individually).
			if (isDone && date === completeDate && node?.s !== 'done') {
				node = { s: 'done', n: node?.n ?? '' };
			}
			const isOverdue = date > due;
			const isCompleteDay = isDone && date === completeDate;
			const cell = grid.createSpan({ cls: 'ad-node-cell' + this.cellClass(date, today, node, isOverdue, isCompleteDay) });
			cell.setAttribute('data-date', date);
			const note = node?.n ? node.n : '（无备注）';
			const tag = isOverdue ? '（延期）' : '';
			cell.setAttribute('title', `${date} ${weekdayLabel(date)}${tag}\n${note}`);
		}

		// Today controls (left column, under the axis)
		const ctrl = left.createDiv({ cls: 'ad-node-ctrl' });
		const doneBtn = ctrl.createEl('button', { cls: 'ad-node-btn', text: '今日完成' });
		const skipBtn = ctrl.createEl('button', { cls: 'ad-node-btn', text: '今日不做' });

		// Today's note (right column)
		right.createEl('label', { cls: 'ad-modal-label', text: `今日备注（${fmtMD(today)}）` });
		const noteArea = right.createEl('textarea', { cls: 'ad-modal-input ad-node-note', attr: { rows: '4' } });

		const existing = task.dailyNodes[today];
		this.activeState = this.presetTodayNode ?? (existing ? existing.s : undefined);
		if (existing) noteArea.value = existing.n;
		if (this.presetTodayNode) window.setTimeout(() => noteArea.focus(), 50);

		const refresh = () => {
			doneBtn.toggleClass('is-active', this.activeState === 'done');
			skipBtn.toggleClass('is-active', this.activeState === 'skip');
			const todayCell = grid.querySelector(`.ad-node-cell[data-date="${today}"]`) as HTMLElement;
			if (todayCell) {
				const synth = this.activeState ? { s: this.activeState, n: noteArea.value } : undefined;
				todayCell.className = 'ad-node-cell' + this.cellClass(today, today, synth, today > due, isDone && today === completeDate);
				const tag = today > due ? '（延期）' : '';
				todayCell.setAttribute('title', `${today} ${weekdayLabel(today)}${tag}\n${noteArea.value ? noteArea.value : '（无备注）'}`);
			}
		};
		doneBtn.addEventListener('click', () => { this.activeState = this.activeState === 'done' ? undefined : 'done'; refresh(); });
		skipBtn.addEventListener('click', () => { this.activeState = this.activeState === 'skip' ? undefined : 'skip'; refresh(); });
		refresh();
	}

	private cellClass(date: string, today: string, node: DailyNode | undefined, isOverdue: boolean, isCompleteDay: boolean): string {
		// Completion day is always rendered as "done" (已打卡效果), regardless of individual daily node state.
		const s = isCompleteDay ? 'done' : node?.s;
		let c = '';
		if (s === 'done') {
			c = isOverdue ? ' is-done-overdue' : ' is-done';
		} else if (s === 'skip') {
			c = isOverdue ? ' is-skip-overdue' : ' is-skip';
		} else {
			c = isOverdue ? ' is-pending-overdue' : ' is-pending';
		}
		if (date === today) c += ' is-today';
		if (isCompleteDay) c += ' is-complete-day';
		return c;
	}

	private field(labelText: string, build: (wrap: HTMLElement) => void): void {
		const wrap = this.contentEl.createDiv({ cls: 'ad-modal-field' });
		this.label(wrap, labelText);
		build(wrap);
	}

	private label(parent: HTMLElement, text: string): void {
		parent.createEl('label', { cls: 'ad-modal-label', text });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/* ---- Module helpers ---- */
function todayStr(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowFmt(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtMD(s: string): string {
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	return m ? `${parseInt(m[2] ?? '0', 10)}/${parseInt(m[3] ?? '0', 10)}` : s;
}
function eachDate(start: string, end: string): string[] {
	const out: string[] = [];
	const s = new Date(start + 'T00:00:00');
	const e = new Date(end + 'T00:00:00');
	for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(fmtDate(d));
	return out;
}
function weekdayLabel(date: string): string {
	const d = new Date(date + 'T00:00:00').getDay();
	return ['日', '一', '二', '三', '四', '五', '六'][d] ?? '日';
}
