import { App, Modal } from 'obsidian';

/**
 * BannerModal — 弹窗预览封面图片，拖拽调整垂直位置。
 * 图片宽度自动铺满容器，仅允许上下拖拽，带上下限位。
 */
export class BannerModal extends Modal {
	private imageDataUrl: string;
	private offsetY: number;
	private onConfirm: (offsetY: number) => void;
	private cleanup: (() => void) | null = null;

	constructor(
		app: App,
		imageDataUrl: string,
		currentOffsetY: number,
		onConfirm: (offsetY: number) => void,
	) {
		super(app);
		this.imageDataUrl = imageDataUrl;
		this.offsetY = currentOffsetY;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-modal');
		contentEl.createEl('h3', { cls: 'ad-modal__title', text: '调整封面图片位置' });

		// ---- preview container (16:3) ----
		const preview = contentEl.createDiv({ cls: 'ad-modal__preview' });
		const img = preview.createEl('img', { cls: 'ad-modal__img' });
		img.src = this.imageDataUrl;
		img.alt = 'Banner preview';

		// ---- hint ----
		contentEl.createDiv({ cls: 'ad-modal__hint', text: '上下拖拽图片调整显示区域，图片宽度自动铺满' });

		// ---- buttons ----
		const btns = contentEl.createDiv({ cls: 'ad-modal__btns' });
		const cancelBtn = btns.createEl('button', { cls: 'ad-modal__btn', text: '取消' });
		const confirmBtn = btns.createEl('button', { cls: 'ad-modal__btn ad-modal__btn--primary', text: '确认' });

		cancelBtn.addEventListener('click', () => this.close());
		confirmBtn.addEventListener('click', () => {
			this.onConfirm(this.offsetY);
			this.close();
		});

		// ---- image load → setup drag ----
		let offsetMin = 0;
		let offsetMax = 0;

		img.onload = () => {
			const cw = preview.offsetWidth;
			const ch = preview.offsetHeight;
			if (!cw || !ch || !img.naturalWidth || !img.naturalHeight) return;

			// image rendered height when width = container width
			const renderedH = cw * (img.naturalHeight / img.naturalWidth);

			// limits: image must always cover the container
			offsetMax = 0;
			offsetMin = ch - renderedH; // negative when image is taller

			// clamp current offset
			this.offsetY = clamp(this.offsetY, offsetMin, offsetMax);
			applyY(img, this.offsetY);
		};

		// ---- mouse drag ----
		let dragging = false;
		let startY = 0;
		let startOffset = 0;

		img.addEventListener('mousedown', (e) => {
			dragging = true;
			startY = e.clientY;
			startOffset = this.offsetY;
			img.classList.add('is-grabbing');
			e.preventDefault();
		});

		const onMove = (e: MouseEvent) => {
			if (!dragging) return;
			this.offsetY = clamp(startOffset + (e.clientY - startY), offsetMin, offsetMax);
			applyY(img, this.offsetY);
		};

		const onUp = () => {
			if (!dragging) return;
			dragging = false;
			img.classList.remove('is-grabbing');
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);

		// cleanup reference
		this.cleanup = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};

		// ---- touch drag ----
		let touchStartY = 0;
		let touchStartOffset = 0;

		img.addEventListener('touchstart', (e) => {
			const t = e.touches.item(0);
			if (!t) return;
			touchStartY = t.clientY;
			touchStartOffset = this.offsetY;
			e.preventDefault();
		}, { passive: false });

		img.addEventListener('touchmove', (e) => {
			const t = e.touches.item(0);
			if (!t) return;
			this.offsetY = clamp(touchStartOffset + (t.clientY - touchStartY), offsetMin, offsetMax);
			applyY(img, this.offsetY);
		}, { passive: false });
	}

	onClose(): void {
		this.cleanup?.();
		this.contentEl.empty();
	}
}

/* ---- helpers ---- */
function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

function applyY(img: HTMLElement, y: number): void {
	img.style.transform = `translateY(${y}px)`;
}
