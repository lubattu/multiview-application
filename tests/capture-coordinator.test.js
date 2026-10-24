import { describe, it, expect, vi } from 'vitest';
import { createCaptureCoordinator } from '../src/main/capture-coordinator.js';

function make() {
  const events = { fallback: [], recovery: [] };
  const coord = createCaptureCoordinator({
    maxAttempts: 2,
    onFallback: (id) => events.fallback.push(id),
    onRecovery: (id) => events.recovery.push(id),
  });
  return { coord, events };
}

const HAS = { hasCredential: false, hasChannels: true };

describe('createCaptureCoordinator', () => {
  it('não captura sem canais ou com credencial vigente', () => {
    const { coord } = make();
    expect(coord.shouldCapture(1, { hasCredential: false, hasChannels: false })).toBe(false);
    expect(coord.shouldCapture(1, { hasCredential: true, hasChannels: true })).toBe(false);
  });

  it('duas capturas sem resultado → fallback', () => {
    const { coord, events } = make();
    expect(coord.shouldCapture(1, HAS)).toBe(true);
    coord.begin(1);
    coord.end(1, { ok: false });
    expect(coord.isFallback(1)).toBe(false);
    expect(coord.shouldCapture(1, HAS)).toBe(true);
    coord.begin(1);
    coord.end(1, { ok: false });
    expect(coord.isFallback(1)).toBe(true);
    expect(events.fallback).toEqual([1]);
    expect(coord.shouldCapture(1, HAS)).toBe(false);
  });

  it('token recusado conta rodada: captura ok → recusa → recaptura → recusa → fallback', () => {
    const { coord, events } = make();
    coord.begin(1);
    coord.end(1, { ok: true });
    expect(coord.isFallback(1)).toBe(false);
    coord.reportAuthRefused(1);
    expect(coord.isFallback(1)).toBe(false);
    coord.begin(1);
    coord.end(1, { ok: true });
    coord.reportAuthRefused(1);
    expect(coord.isFallback(1)).toBe(true);
    expect(events.fallback).toEqual([1]);
    // E depois de esgotado, shouldCapture não recomeça.
    expect(coord.shouldCapture(1, HAS)).toBe(false);
  });

  it('captura em voo bloqueia segunda captura; finally (end) libera', () => {
    const { coord } = make();
    coord.begin(1);
    expect(coord.shouldCapture(1, HAS)).toBe(false);
    coord.end(1, { ok: true });
    expect(coord.shouldCapture(1, { hasCredential: true, hasChannels: true })).toBe(false);
    coord.end(1, { ok: true }); // segunda end não reativa inFlight
    expect(coord.capturingSlots()).toEqual([]);
  });

  it('credencial externa (webview aberto) recupera aba em fallback', () => {
    const { coord, events } = make();
    coord.begin(1);
    coord.end(1, { ok: false });
    coord.begin(1);
    coord.end(1, { ok: false });
    expect(coord.isFallback(1)).toBe(true);
    const recovered = coord.reportExternalCredential(1);
    expect(recovered).toBe(true);
    expect(events.recovery).toEqual([1]);
    expect(coord.isFallback(1)).toBe(false);
    expect(coord.shouldCapture(1, HAS)).toBe(true);
  });

  it('credencial externa em aba sem fallback não avisa recovery', () => {
    const { coord, events } = make();
    coord.reportExternalCredential(1);
    expect(events.recovery).toEqual([]);
  });

  it('capturingSlots lista só as em voo', () => {
    const { coord } = make();
    coord.begin(1);
    coord.begin(2);
    coord.end(2, { ok: true });
    expect(coord.capturingSlots()).toEqual([1]);
  });

  it('resetAll limpa fallback e tentativas', () => {
    const { coord } = make();
    coord.begin(1);
    coord.end(1, { ok: false });
    coord.begin(1);
    coord.end(1, { ok: false });
    expect(coord.isFallback(1)).toBe(true);
    coord.resetAll();
    expect(coord.isFallback(1)).toBe(false);
    expect(coord.shouldCapture(1, HAS)).toBe(true);
  });
});
