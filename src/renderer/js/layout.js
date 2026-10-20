const rect = (x, y, w, h) => ({ x, y, w, h });
const splitter = (key, axis, left, top, width, height) => ({ key, axis, left, top, width, height });

export function computeLayout(ids, mode, focusSlotId, gridSplit, focusSplit) {
  const sorted = [...ids].sort((a, b) => a - b);
  const map = new Map();
  if (sorted.length === 0) return map;
  if (sorted.length === 1) {
    map.set(sorted[0], rect(0, 0, 100, 100));
    return map;
  }
  if (mode === 'focus') {
    const focused = sorted.includes(focusSlotId) ? focusSlotId : sorted[0];
    const rest = sorted.filter((id) => id !== focused);
    const rowH = 100 / rest.length;
    rest.forEach((id, i) => map.set(id, rect(focusSplit, i * rowH, 100 - focusSplit, rowH)));
    map.set(focused, rect(0, 0, focusSplit, 100));
    return map;
  }
  const { v, h } = gridSplit;
  if (sorted.length === 2) {
    map.set(sorted[0], rect(0, 0, v, 100));
    map.set(sorted[1], rect(v, 0, 100 - v, 100));
    return map;
  }
  if (sorted.length === 3) {
    const [a, b, c] = sorted;
    map.set(a, rect(0, 0, v, h));
    map.set(b, rect(v, 0, 100 - v, h));
    map.set(c, rect(0, h, 100, 100 - h));
    return map;
  }
  const [a, b, c, d] = sorted;
  map.set(a, rect(0, 0, v, h));
  map.set(b, rect(v, 0, 100 - v, h));
  map.set(c, rect(0, h, v, 100 - h));
  map.set(d, rect(v, h, 100 - v, 100 - h));
  return map;
}

export function computeSplitters(ids, mode, focusSlotId, gridSplit, focusSplit) {
  const n = ids.length;
  if (n <= 1) return [];
  if (mode === 'focus') return [splitter('focusSplit', 'x', focusSplit, 0, 0, 100)];
  const { v, h } = gridSplit;
  if (n === 2) return [splitter('gridSplit.v', 'x', v, 0, 0, 100)];
  if (n === 3) {
    return [
      splitter('gridSplit.v', 'x', v, 0, 0, h),
      splitter('gridSplit.h', 'y', 0, h, 100, 0),
    ];
  }
  return [
    splitter('gridSplit.v', 'x', v, 0, 0, 100),
    splitter('gridSplit.h', 'y', 0, h, 100, 0),
  ];
}
