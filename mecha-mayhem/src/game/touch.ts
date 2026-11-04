/**
 * On-screen touch controls: floating move stick (left), drag-to-aim (right),
 * fire button that also aims while held, and ability / weapon buttons.
 */
export type TouchAction = 'jump' | 'dash' | 'shield' | 'impact' | 'swap' | 'pause';

export class TouchControls {
  readonly element: HTMLElement;
  moveX = 0;
  moveY = 0;
  fire = false;
  jump = false;
  private lookDX = 0;
  private lookDY = 0;
  private readonly pressed = new Set<TouchAction>();
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private readonly lookIds = new Map<number, { x: number; y: number }>();
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private visible = false;
  /** Called once per touch with the action, so the UI can react immediately (pause). */
  onAction?: (action: TouchAction) => void;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.className = 'touch-controls hidden';
    root.innerHTML = `
      <div class="touch-zone touch-move" data-zone="move"></div>
      <div class="touch-zone touch-look" data-zone="look"></div>
      <div class="touch-stick hidden"><div class="touch-stick-knob"></div></div>
      <button class="touch-btn touch-pause" data-action="pause" aria-label="Pausar">II</button>
      <div class="touch-cluster">
        <button class="touch-btn touch-fire" data-hold="fire" aria-label="Atirar"><span>FOGO</span></button>
        <button class="touch-btn touch-jump" data-hold="jump" aria-label="Saltar / jato"><span>SALTO</span></button>
        <button class="touch-btn touch-dash" data-action="dash" aria-label="Dash"><span>DASH</span></button>
        <button class="touch-btn touch-shield" data-action="shield" aria-label="Escudo"><span>ESCUDO</span></button>
        <button class="touch-btn touch-impact" data-action="impact" aria-label="Impacto"><span>SOCO</span></button>
        <button class="touch-btn touch-swap" data-action="swap" aria-label="Trocar arma"><span>ARMA</span></button>
      </div>`;
    parent.append(root);
    this.element = root;
    this.base = root.querySelector('.touch-stick') as HTMLElement;
    this.knob = root.querySelector('.touch-stick-knob') as HTMLElement;

    const moveZone = root.querySelector('[data-zone="move"]') as HTMLElement;
    moveZone.addEventListener('pointerdown', (event) => {
      if (this.stickId !== null) return;
      event.preventDefault();
      this.stickId = event.pointerId;
      this.stickOrigin = { x: event.clientX, y: event.clientY };
      this.base.style.left = `${event.clientX}px`;
      this.base.style.top = `${event.clientY}px`;
      this.base.classList.remove('hidden');
      this.knob.style.transform = 'translate(-50%, -50%)';
      moveZone.setPointerCapture?.(event.pointerId);
    });
    const moveUpdate = (event: PointerEvent) => {
      if (event.pointerId !== this.stickId) return;
      const max = 52;
      let dx = event.clientX - this.stickOrigin.x;
      let dy = event.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx *= max / len; dy *= max / len; }
      this.moveX = dx / max;
      this.moveY = -dy / max;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const moveEnd = (event: PointerEvent) => {
      if (event.pointerId !== this.stickId) return;
      this.stickId = null;
      this.moveX = this.moveY = 0;
      this.base.classList.add('hidden');
    };
    moveZone.addEventListener('pointermove', moveUpdate);
    moveZone.addEventListener('pointerup', moveEnd);
    moveZone.addEventListener('pointercancel', moveEnd);

    const lookZone = root.querySelector('[data-zone="look"]') as HTMLElement;
    const lookStart = (event: PointerEvent, target: HTMLElement) => {
      this.lookIds.set(event.pointerId, { x: event.clientX, y: event.clientY });
      target.setPointerCapture?.(event.pointerId);
    };
    const lookMove = (event: PointerEvent) => {
      const last = this.lookIds.get(event.pointerId);
      if (!last) return;
      this.lookDX += event.clientX - last.x;
      this.lookDY += event.clientY - last.y;
      last.x = event.clientX;
      last.y = event.clientY;
    };
    const lookEnd = (event: PointerEvent) => { this.lookIds.delete(event.pointerId); };
    lookZone.addEventListener('pointerdown', (event) => { event.preventDefault(); lookStart(event, lookZone); });
    lookZone.addEventListener('pointermove', lookMove);
    lookZone.addEventListener('pointerup', lookEnd);
    lookZone.addEventListener('pointercancel', lookEnd);

    root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((button) => {
      const key = button.dataset.hold as 'fire' | 'jump';
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this[key] = true;
        button.classList.add('active');
        // The fire button doubles as an aim pad while held.
        if (key === 'fire') lookStart(event, button);
        else button.setPointerCapture?.(event.pointerId);
      });
      const release = (event: PointerEvent) => {
        this[key] = false;
        button.classList.remove('active');
        lookEnd(event);
      };
      button.addEventListener('pointermove', lookMove);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      const action = button.dataset.action as TouchAction;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.pressed.add(action);
        button.classList.add('active');
        this.onAction?.(action);
      });
      const release = () => button.classList.remove('active');
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
  }

  get isVisible(): boolean { return this.visible; }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.classList.toggle('hidden', !visible);
    if (!visible) this.reset();
  }

  reset(): void {
    this.moveX = this.moveY = 0;
    this.fire = this.jump = false;
    this.lookDX = this.lookDY = 0;
    this.stickId = null;
    this.lookIds.clear();
    this.pressed.clear();
    this.base.classList.add('hidden');
    this.element.querySelectorAll('.active').forEach((node) => node.classList.remove('active'));
  }

  consumeLook(): { dx: number; dy: number } {
    const result = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return result;
  }

  consume(action: TouchAction): boolean {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  setCooldown(action: 'dash' | 'shield' | 'impact', seconds: number): void {
    const button = this.element.querySelector(`[data-action="${action}"]`);
    if (!button) return;
    button.classList.toggle('cooldown', seconds > 0);
    button.setAttribute('data-cd', seconds > 0 ? seconds.toFixed(1) : '');
  }
}

export function isTouchDevice(): boolean {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
}
