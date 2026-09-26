/**
 * Игровой цикл с дельта-таймом: доход капает по dt, а не по кадрам.
 * dt зажат сверху, чтобы после лагов/свёрнутой вкладки не было гигантских скачков
 * (за «потерянное» время отвечает отдельная система офлайн-дохода).
 */
export class GameLoop {
  /** Множитель скорости (дебаг: x1/x5/x10). В проде всегда 1. */
  speedScale = 1;

  private rafId = 0;
  private lastTime = 0;
  private running = false;

  constructor(
    private readonly tick: (dt: number) => void,
    private readonly maxDt = 1.0,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const dt = Math.min(rawDt, this.maxDt) * this.speedScale;
    if (dt > 0) this.tick(dt);

    this.rafId = requestAnimationFrame(this.frame);
  };
}
