import { App, Modal } from 'obsidian';
import { UI_TEXT, MODAL_TEXT } from '../constants';

/* ============================================================
   Task Creation Modal — Full form with all fields
   ============================================================ */

interface ProjectInfo { name: string; path: string }
interface TaskInfo { id: string; title: string; projectId: string }

export interface TaskFormData {
	title: string;
	project: string;
	parent: string;
	startDate: string;
	endDate: string;
	priority: string;
	status: string;
	type: string;
	// Structured repeat settings (replaces free-text 重复详情)
	repeatFreq: string;            // 'daily' | 'weekly' | 'monthly' | ''
	repeatInterval: number;        // daily: every N days (>=1)
	repeatWorkdaysOnly: boolean;   // daily: workdays only
	repeatWeekdays: number[];      // weekly: 1=Mon .. 7=Sun
	repeatMonthDay: number;        // monthly: day of month 1..31
	noEndDate: boolean;            // recurring: no end bound
	reminders: string[];
	tags: string[];
	notes: string;
}

interface TaskModalOptions {
	app: App;
	projects: ProjectInfo[];
	allTasks?: TaskInfo[];
	defaultProject?: string;
	defaultParent?: string;
	onSave: (data: TaskFormData) => void;
}

const PRIORITIES = (): { value: string; label: string }[] => [
	{ value: '重要且紧急', label: UI_TEXT.prioText('重要且紧急') },
	{ value: '重要不紧急', label: UI_TEXT.prioText('重要不紧急') },
	{ value: '紧急不重要', label: UI_TEXT.prioText('紧急不重要') },
	{ value: '不重要不紧急', label: UI_TEXT.prioText('不重要不紧急') },
	{ value: '', label: UI_TEXT.notSet },
];

const STATUSES = (): { value: string; label: string }[] => [
	{ value: 'todo', label: MODAL_TEXT.stTodo },
	{ value: 'in-progress', label: MODAL_TEXT.stInProgress },
	{ value: 'blocked', label: MODAL_TEXT.stBlocked },
	{ value: 'done', label: MODAL_TEXT.stDone },
	{ value: 'cancelled', label: MODAL_TEXT.stCancelled },
];

const TYPES = (): { value: string; label: string }[] => [
	{ value: 'task', label: MODAL_TEXT.typeNormal },
	{ value: 'recurring', label: MODAL_TEXT.typeRecurring },
];

// Repeat frequency — "每年" removed per product decision.
const REPEAT_FREQS = (): { value: string; label: string }[] => [
	{ value: '', label: MODAL_TEXT.freqChoose },
	{ value: 'daily', label: MODAL_TEXT.freqDaily },
	{ value: 'weekly', label: MODAL_TEXT.freqWeekly },
	{ value: 'monthly', label: MODAL_TEXT.freqMonthly },
];

// 周一..周日 with internal value 1..7 (1=Mon, 7=Sun)
const WEEKDAYS = (): { value: number; label: string }[] => {
	const names = MODAL_TEXT.weekdays;
	return [1, 2, 3, 4, 5, 6, 7].map((v, i) => ({ value: v, label: names[i] ?? String(v) }));
};

const REMINDER_OPTIONS = (): string[] => [
	MODAL_TEXT.remOnDay, MODAL_TEXT.rem1Day, MODAL_TEXT.rem3Day, MODAL_TEXT.rem1Week,
];

const getToday = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Convert a YYYY-MM-DD to a weekday number 1..7 (1=Mon, 7=Sun). */
const dateToDow = (s: string): number => {
	const d = s ? new Date(s + 'T00:00:00') : new Date();
	if (isNaN(d.getTime())) return 1;
	return ((d.getDay() + 6) % 7) + 1;
};

export class TaskModal extends Modal {
	private opts: TaskModalOptions;
	private tags: string[] = ['\u4EFB\u52A1'];
	private selectedReminders: string[] = [];

	constructor(opts: TaskModalOptions) {
		super(opts.app);
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-task-modal');
		this.containerEl.closest('.modal-container')?.addClass('dashboard-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: MODAL_TEXT.taskTitle });

		// ---- Title ----
		this.field(MODAL_TEXT.taskName, (wrap) => {
			wrap.createEl('input', { cls: 'ad-modal-input ad-input-title', attr: { type: 'text', placeholder: MODAL_TEXT.taskNamePlaceholder } });
		});

		// ---- Project + Parent (side by side) ----
		const row1 = contentEl.createDiv({ cls: 'ad-modal-row' });

		const projCol = row1.createDiv({ cls: 'ad-modal-col' });
		this.label(projCol, MODAL_TEXT.project);
		const projSel = projCol.createEl('select', { cls: 'ad-modal-input' });
		for (const p of this.opts.projects) {
			projSel.createEl('option', { text: p.name, attr: { value: p.name } });
		}
		const initialProject = this.opts.defaultProject ?? this.opts.projects[0]?.name;
		if (initialProject) {
			const match = Array.from(projSel.options).find((o) => o.value === initialProject);
			if (match) match.selected = true;
			else projSel.value = initialProject;
		}

		const parentCol = row1.createDiv({ cls: 'ad-modal-col' });
		this.label(parentCol, MODAL_TEXT.parent);
		const parentSel = parentCol.createEl('select', { cls: 'ad-modal-input' });
		parentSel.createEl('option', { text: MODAL_TEXT.noParent, attr: { value: '' } });

		const populateParents = (projectName: string): void => {
			const filtered = (this.opts.allTasks || []).filter((t) => t.projectId === projectName);
			while (parentSel.options.length > 1) parentSel.remove(1);
			for (const t of filtered) {
				parentSel.createEl('option', { text: t.title, attr: { value: t.title } });
			}
		};

		populateParents(projSel.value);
		if (this.opts.defaultParent) parentSel.value = this.opts.defaultParent;

		projSel.addEventListener('change', () => {
			populateParents(projSel.value);
		});

		// ---- Dates (side by side) ----
		const row2 = contentEl.createDiv({ cls: 'ad-modal-row' });

		const startCol = row2.createDiv({ cls: 'ad-modal-col' });
		const startLabel = startCol.createEl('label', { cls: 'ad-modal-label', text: MODAL_TEXT.startDate });
		const startInput = startCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date' } });
		startInput.value = getToday();

		const endCol = row2.createDiv({ cls: 'ad-modal-col' });
		const endLabel = endCol.createEl('label', { cls: 'ad-modal-label', text: MODAL_TEXT.endDate });
		const endInput = endCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date' } });
		endInput.value = getToday();

		// "No end date" — only relevant for recurring tasks
		const noEndWrap = contentEl.createDiv({ cls: 'ad-modal-row ad-hidden' });
		const noEndCol = noEndWrap.createDiv({ cls: 'ad-modal-col' });
		const noEndLbl = noEndCol.createEl('label', { cls: 'ad-rem-item' });
		const noEndCb = noEndLbl.createEl('input', { attr: { type: 'checkbox' } });
		noEndLbl.createSpan({ text: MODAL_TEXT.noEndDate });
		noEndCb.addEventListener('change', () => {
			endInput.disabled = noEndCb.checked;
			if (noEndCb.checked) endInput.value = '';
		});

		// ---- Priority + Status + Type (side by side) ----
		const row3 = contentEl.createDiv({ cls: 'ad-modal-row' });

		const prioCol = row3.createDiv({ cls: 'ad-modal-col' });
		this.label(prioCol, MODAL_TEXT.priority);
		const prioSel = prioCol.createEl('select', { cls: 'ad-modal-input' });
		for (const p of PRIORITIES()) prioSel.createEl('option', { text: p.label, attr: { value: p.value } });

		const statusCol = row3.createDiv({ cls: 'ad-modal-col' });
		this.label(statusCol, MODAL_TEXT.status);
		const statusSel = statusCol.createEl('select', { cls: 'ad-modal-input' });
		for (const s of STATUSES()) statusSel.createEl('option', { text: s.label, attr: { value: s.value } });

		const typeCol = row3.createDiv({ cls: 'ad-modal-col' });
		this.label(typeCol, MODAL_TEXT.type);
		const typeSel = typeCol.createEl('select', { cls: 'ad-modal-input' });
		for (const t of TYPES()) typeSel.createEl('option', { text: t.label, attr: { value: t.value } });

		// ---- Repeat (conditional, structured) ----
		const repeatWrap = contentEl.createDiv({ cls: 'ad-modal-row ad-repeat-section ad-hidden' });

		const freqCol = repeatWrap.createDiv({ cls: 'ad-modal-col' });
		this.label(freqCol, MODAL_TEXT.repeatFreq);
		const freqSel = freqCol.createEl('select', { cls: 'ad-modal-input' });
		for (const f of REPEAT_FREQS()) freqSel.createEl('option', { text: f.label, attr: { value: f.value } });

		// Dynamic options container (re-rendered on frequency change)
		const repeatOptsWrap = contentEl.createDiv({ cls: 'ad-repeat-opts ad-hidden' });

		const renderRepeatOpts = (): void => {
			repeatOptsWrap.empty();
			const f = freqSel.value;
			if (!f) { repeatOptsWrap.addClass('ad-hidden'); return; }
			repeatOptsWrap.removeClass('ad-hidden');

			if (f === 'daily') {
				const row = repeatOptsWrap.createDiv({ cls: 'ad-modal-row' });
				const c1 = row.createDiv({ cls: 'ad-modal-col' });
				this.label(c1, MODAL_TEXT.everyNDays);
				const interval = c1.createEl('input', { cls: 'ad-modal-input ad-repeat-interval', attr: { type: 'number', min: '1', value: '1' } });
				const c2 = row.createDiv({ cls: 'ad-modal-col' });
				const wdLbl = c2.createEl('label', { cls: 'ad-rem-item' });
				const wd = wdLbl.createEl('input', { cls: 'ad-repeat-workdays', attr: { type: 'checkbox' } });
				wdLbl.createSpan({ text: MODAL_TEXT.workdaysOnly });
			} else if (f === 'weekly') {
				const row = repeatOptsWrap.createDiv({ cls: 'ad-modal-row' });
				const c = row.createDiv({ cls: 'ad-modal-col' });
				this.label(c, MODAL_TEXT.repeatWeekdays);
				const wdRow = c.createDiv({ cls: 'ad-repeat-weekdays' });
				const startDow = dateToDow(startInput.value);
				for (const wd of WEEKDAYS()) {
					const lbl = wdRow.createEl('label', { cls: 'ad-rem-item' });
					const cb = lbl.createEl('input', { cls: 'ad-repeat-weekday', attr: { type: 'checkbox', value: String(wd.value) } });
					if (wd.value === startDow) cb.checked = true;
					lbl.createSpan({ text: wd.label });
				}
			} else if (f === 'monthly') {
				const row = repeatOptsWrap.createDiv({ cls: 'ad-modal-row' });
				const c = row.createDiv({ cls: 'ad-modal-col' });
				this.label(c, MODAL_TEXT.monthDay);
				const mdVal = startInput.value ? new Date(startInput.value + 'T00:00:00').getDate() : 1;
				c.createEl('input', { cls: 'ad-modal-input ad-repeat-monthday', attr: { type: 'number', min: '1', max: '31', value: String(mdVal) } });
			}
		};

		freqSel.addEventListener('change', renderRepeatOpts);

		// Type change: show/hide repeat UI, status picker, no-end checkbox, relabel dates
		const applyType = (): void => {
			const isRecurring = typeSel.value === 'recurring';
			repeatWrap.toggleClass('ad-hidden', !isRecurring);
			noEndWrap.toggleClass('ad-hidden', !isRecurring);
			statusCol.toggleClass('ad-hidden', isRecurring); // recurring is always 进行中
			if (isRecurring) {
			startLabel.textContent = MODAL_TEXT.firstDate;
			endLabel.textContent = MODAL_TEXT.endDateBound;
				renderRepeatOpts();
			} else {
			startLabel.textContent = MODAL_TEXT.startDate;
			endLabel.textContent = MODAL_TEXT.endDate;
			}
		};
		typeSel.addEventListener('change', applyType);

		// ---- Reminders ----
		this.label(contentEl, MODAL_TEXT.reminder);
		const remWrap = contentEl.createDiv({ cls: 'ad-rem-group' });
		for (const opt of REMINDER_OPTIONS()) {
			const lbl = remWrap.createEl('label', { cls: 'ad-rem-item' });
			const cb = lbl.createEl('input', { attr: { type: 'checkbox' } });
			cb.addEventListener('change', () => {
				if (cb.checked) this.selectedReminders.push(opt);
				else this.selectedReminders = this.selectedReminders.filter((r) => r !== opt);
			});
			lbl.createSpan({ text: opt });
		}

		// ---- Tags ----
		this.label(contentEl, MODAL_TEXT.tags);
		const tagWrap = contentEl.createDiv({ cls: 'ad-tag-wrap' });
		const tagChips = tagWrap.createDiv({ cls: 'ad-tag-chips' });
		const tagInput = tagWrap.createEl('input', {
			cls: 'ad-modal-input ad-tag-input',
			attr: { type: 'text', placeholder: MODAL_TEXT.tagPlaceholder },
		});
		tagInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const val = tagInput.value.trim();
				if (val && !this.tags.includes(val)) {
					this.tags.push(val);
					this.renderTagChip(tagChips, val);
				}
				tagInput.value = '';
			}
		});
		this.tags.forEach((tag) => this.renderTagChip(tagChips, tag));

		// ---- Notes ----
		this.label(contentEl, MODAL_TEXT.notes);
		const notesArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input',
			attr: { rows: '5', placeholder: MODAL_TEXT.notesPlaceholder },
		});

		// ---- Buttons ----
		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		btns.createEl('button', { cls: 'ad-modal-btn', text: UI_TEXT.cancel })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: MODAL_TEXT.createTask })
			.addEventListener('click', () => {
				contentEl.querySelectorAll('.ad-input-error').forEach((el) => el.removeClass('ad-input-error'));

				const titleEl = contentEl.querySelector('.ad-input-title') as HTMLInputElement;
				const title = titleEl?.value?.trim();

				const fields: [HTMLElement | null, string][] = [
					[titleEl, title || ''],
					[projSel, projSel.value],
					[startInput, startInput.value],
					[typeSel, typeSel.value],
				];
				// For normal tasks, status is required; for recurring it's fixed to 进行中.
				if (typeSel.value !== 'recurring') fields.push([statusSel, statusSel.value]);

				let firstError: HTMLElement | null = null;
				for (const [el, val] of fields) {
					if (!val && el) {
						el.addClass('ad-input-error');
						if (!firstError) firstError = el;
					}
				}
				if (firstError) { firstError.focus(); return; }

				const isRecurring = typeSel.value === 'recurring';
				const noEnd = isRecurring && noEndCb.checked;
				const intervalEl = repeatOptsWrap.querySelector('.ad-repeat-interval');
				const workdayEl = repeatOptsWrap.querySelector('.ad-repeat-workdays');
				const weekdayEls = repeatOptsWrap.querySelectorAll('.ad-repeat-weekday');
				const monthDayEl = repeatOptsWrap.querySelector('.ad-repeat-monthday');

				const data: TaskFormData = {
					title,
					project: projSel.value,
					parent: (parentSel).value,
					startDate: startInput.value || getToday(),
					endDate: noEnd ? '' : (endInput.value || startInput.value || getToday()),
					priority: (prioSel).value,
					status: (statusSel).value || 'todo',
					type: (typeSel).value || 'task',
					repeatFreq: isRecurring ? freqSel.value : '',
					repeatInterval: intervalEl instanceof HTMLInputElement ? (parseInt(intervalEl.value, 10) || 1) : 1,
					repeatWorkdaysOnly: !!(workdayEl instanceof HTMLInputElement && workdayEl.checked),
					repeatWeekdays: Array.from(weekdayEls).filter((cb): cb is HTMLInputElement => cb instanceof HTMLInputElement).map((cb) => parseInt(cb.value, 10)),
					repeatMonthDay: monthDayEl instanceof HTMLInputElement ? (parseInt(monthDayEl.value, 10) || 1) : 1,
					noEndDate: noEnd,
					reminders: [...this.selectedReminders],
					tags: [...this.tags],
					notes: (notesArea).value.trim(),
				};
				this.opts.onSave(data);
				this.close();
			});

		(contentEl.querySelector('.ad-input-title') as HTMLInputElement)?.focus();
	}

	private label(parent: HTMLElement, text: string): void {
		parent.createEl('label', { cls: 'ad-modal-label', text });
	}

	private field(labelText: string, build: (wrap: HTMLElement) => void): void {
		const wrap = this.contentEl.createDiv({ cls: 'ad-modal-field' });
		this.label(wrap, labelText);
		build(wrap);
	}

	private renderTagChip(container: HTMLElement, tag: string): void {
		const chip = container.createSpan({ cls: 'ad-tag-chip' });
		chip.createSpan({ text: tag });
		const x = chip.createSpan({ cls: 'ad-tag-x', text: '\u00D7' });
		x.addEventListener('click', () => {
			this.tags = this.tags.filter((t) => t !== tag);
			chip.remove();
		});
	}

	onClose(): void {
		this.containerEl.closest('.modal-container')?.removeClass('dashboard-modal');
		this.contentEl.empty();
	}
}
