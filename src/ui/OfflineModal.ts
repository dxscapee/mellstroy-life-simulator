/**
 * Переиспользуемая модалка (офлайн-доход и прочие системные сообщения).
 * Показывается поверх HUD (z-index 20). Пока скрыта — полностью выведена
 * из hit-testing (visibility + pointer-events), тапы проходят на холст.
 * В открытом состоянии блокирует фон; закрывается только кнопкой.
 */
export class Modal {
  private backdrop: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private okBtn: HTMLButtonElement;
  private onCloseCb: (() => void) | null = null;

  constructor(uiRoot: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';

    const box = document.createElement('div');
    box.className = 'modal';

    this.titleEl = document.createElement('h2');
    this.bodyEl = document.createElement('p');

    this.okBtn = document.createElement('button');
    this.okBtn.textContent = 'Забрать';
    this.okBtn.addEventListener('click', () => {
      this.hide();
      this.onCloseCb?.();
    });

    box.append(this.titleEl, this.bodyEl, this.okBtn);
    this.backdrop.appendChild(box);
    uiRoot.appendChild(this.backdrop);
  }

  show(title: string, body: string, buttonText = 'Забрать', onClose?: () => void): void {
    this.titleEl.textContent = title;
    this.bodyEl.textContent = body;
    this.okBtn.textContent = buttonText;
    this.onCloseCb = onClose ?? null;
    this.backdrop.classList.add('show');
  }

  hide(): void {
    this.backdrop.classList.remove('show');
  }
}
