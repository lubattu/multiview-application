import { LIMITS } from '../../shared/config.js';

export function makeDraggable(el, { axis, getBounds, onMove, onEnd }) {
  el.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    const handleMove = (ev) => {
      if (!(ev.buttons & 1)) return;
      const b = getBounds();
      const pct = axis === 'x'
        ? ((ev.clientX - b.left) / b.width) * 100
        : ((ev.clientY - b.top) / b.height) * 100;
      onMove(Math.min(LIMITS.maxSplit, Math.max(LIMITS.minSplit, pct)));
    };
    const handleUp = () => {
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerup', handleUp);
      el.removeEventListener('pointercancel', handleUp);
      onEnd?.();
    };
    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerup', handleUp);
    el.addEventListener('pointercancel', handleUp);
  });
}
