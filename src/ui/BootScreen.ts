/**
 * ЗАГРУЗОЧНЫЙ ЭКРАН — HTML-оверлей из index.html (#boot-screen), стили в
 * styles.css. Показывается, пока грузится стартовый набор текстур, и
 * скрывается ПЕРЕД LoadingAPI.ready(): платформа должна считать готовой уже
 * одетую игру, а не пустую сцену.
 *
 * Если разметки нет (кто-то убрал элементы из index.html) — все методы тихо
 * ничего не делают: загрузка игры не должна зависеть от косметики.
 */
export class BootScreen {
  private root: HTMLElement | null;
  private status: HTMLElement | null;
  private fill: HTMLElement | null;

  constructor() {
    this.root = document.getElementById('boot-screen');
    this.status = document.getElementById('boot-status');
    this.fill = document.getElementById('boot-bar-fill');
  }

  setStatus(text: string): void {
    if (this.status) this.status.textContent = text;
  }

  /** Прогресс по числу ассетов; total = 0 — полоса сразу полная. */
  setProgress(done: number, total: number): void {
    if (this.fill) {
      this.fill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '100%';
    }
    if (total > 0) this.setStatus(`Текстуры: ${done} / ${total}`);
  }

  hide(): void {
    const root = this.root;
    if (!root) return;
    this.root = null;
    root.classList.add('boot-screen--hidden');
    root.addEventListener('transitionend', () => root.remove(), { once: true });
    // Страховка, если transition не случится (вкладка скрыта и т.п.).
    window.setTimeout(() => root.remove(), 700);
  }
}
