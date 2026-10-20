import { describe, it, expect } from 'vitest';
import { computeLayout, computeSplitters } from '../src/renderer/js/layout.js';

const GS = { v: 50, h: 50 };

describe('computeLayout — modo grade', () => {
  it('1 slot ocupa tudo', () => {
    const m = computeLayout([1], 'grid', 1, GS, 70);
    expect(m.get(1)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('2 slots lado a lado com v=50', () => {
    const m = computeLayout([1, 2], 'grid', 1, GS, 70);
    expect(m.get(1)).toEqual({ x: 0, y: 0, w: 50, h: 100 });
    expect(m.get(2)).toEqual({ x: 50, y: 0, w: 50, h: 100 });
  });

  it('2 slots com v=70', () => {
    const m = computeLayout([1, 2], 'grid', 1, { v: 70, h: 50 }, 70);
    expect(m.get(1).w).toBe(70);
    expect(m.get(2)).toEqual({ x: 70, y: 0, w: 30, h: 100 });
  });

  it('3 slots: dois em cima, um embaixo ocupando a largura', () => {
    const m = computeLayout([1, 2, 3], 'grid', 1, GS, 70);
    expect(m.get(1)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(m.get(2)).toEqual({ x: 50, y: 0, w: 50, h: 50 });
    expect(m.get(3)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
  });

  it('4 slots em 2x2, mesmo com ids fora de ordem', () => {
    const m = computeLayout([4, 3, 2, 1], 'grid', 1, { v: 60, h: 40 }, 70);
    expect(m.get(1)).toEqual({ x: 0, y: 0, w: 60, h: 40 });
    expect(m.get(2)).toEqual({ x: 60, y: 0, w: 40, h: 40 });
    expect(m.get(3)).toEqual({ x: 0, y: 40, w: 60, h: 60 });
    expect(m.get(4)).toEqual({ x: 60, y: 40, w: 40, h: 60 });
  });
});

describe('computeLayout — modo foco', () => {
  it('1 slot em modo foco ocupa tudo', () => {
    const m = computeLayout([2], 'focus', 2, GS, 70);
    expect(m.get(2)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('focado à esquerda com focusSplit=70; demais empilhados à direita em alturas iguais', () => {
    const m = computeLayout([1, 2, 3, 4], 'focus', 3, GS, 70);
    expect(m.get(3)).toEqual({ x: 0, y: 0, w: 70, h: 100 });
    [1, 2, 4].forEach((id, i) => {
      const r = m.get(id);
      expect(r.x).toBe(70);
      expect(r.w).toBe(30);
      expect(r.y).toBeCloseTo(i * (100 / 3), 6);
      expect(r.h).toBeCloseTo(100 / 3, 6);
    });
  });

  it('focusSlotId ausente: primeiro id vira o foco', () => {
    const m = computeLayout([2, 5], 'focus', 9, GS, 70);
    expect(m.get(2)).toEqual({ x: 0, y: 0, w: 70, h: 100 });
  });

  it('2 slots em foco', () => {
    const m = computeLayout([1, 2], 'focus', 2, GS, 70);
    expect(m.get(2)).toEqual({ x: 0, y: 0, w: 70, h: 100 });
    expect(m.get(1)).toEqual({ x: 70, y: 0, w: 30, h: 100 });
  });
});

describe('computeSplitters', () => {
  it('1 slot: nenhum splitter', () => {
    expect(computeSplitters([1], 'grid', 1, GS, 70)).toEqual([]);
  });

  it('grade com 2 slots: um splitter vertical', () => {
    expect(computeSplitters([1, 2], 'grid', 1, { v: 50, h: 50 }, 70))
      .toEqual([{ key: 'gridSplit.v', axis: 'x', left: 50, top: 0, width: 0, height: 100 }]);
  });

  it('grade com 3 slots: vertical restrito à linha de cima + horizontal', () => {
    const s = computeSplitters([1, 2, 3], 'grid', 1, GS, 70);
    expect(s).toContainEqual({ key: 'gridSplit.v', axis: 'x', left: 50, top: 0, width: 0, height: 50 });
    expect(s).toContainEqual({ key: 'gridSplit.h', axis: 'y', left: 0, top: 50, width: 100, height: 0 });
  });

  it('grade com 4 slots: cruz completa', () => {
    const s = computeSplitters([1, 2, 3, 4], 'grid', 1, { v: 60, h: 40 }, 70);
    expect(s).toContainEqual({ key: 'gridSplit.v', axis: 'x', left: 60, top: 0, width: 0, height: 100 });
    expect(s).toContainEqual({ key: 'gridSplit.h', axis: 'y', left: 0, top: 40, width: 100, height: 0 });
  });

  it('foco: splitter vertical na posição focusSplit', () => {
    expect(computeSplitters([1, 2], 'focus', 2, GS, 70))
      .toEqual([{ key: 'focusSplit', axis: 'x', left: 70, top: 0, width: 0, height: 100 }]);
  });
});
