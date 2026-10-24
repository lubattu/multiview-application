import { describe, it, expect, vi } from 'vitest';
import { HeadlessStreamManager } from '../src/main/headless-streams.js';

class FakeKickRunner {
  started = false;
  stopped = false;
  snapshotPhase = 'playing';
  constructor(slug, opts) {
    this.slug = slug;
    this.opts = opts;
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  snapshot() {
    return { phase: this.snapshotPhase, active: true, errors: 0, lastError: null };
  }
}

class FakeTwitchRunner {
  started = false;
  stopped = false;
  constructor(channels, opts) {
    this.channels = channels;
    this.opts = opts;
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  snapshot() {
    return { phase: 'joined', joined: this.channels.length, desired: this.channels.length, messages: 10, errors: 0, lastError: null };
  }
}

function makeManager() {
  const calls = { kick: [], twitch: [] };
  const manager = new HeadlessStreamManager({
    kickRunnerFactory: (slug, opts) => {
      const runner = new FakeKickRunner(slug, opts);
      calls.kick.push(runner);
      return runner;
    },
    twitchRunnerFactory: (channels, opts) => {
      const runner = new FakeTwitchRunner(channels, opts);
      calls.twitch.push(runner);
      return runner;
    },
    onStatus: vi.fn(),
    onTwitchAuthFailed: vi.fn(),
    log: vi.fn(),
  });
  return { manager, calls };
}

const STATE_A = [{
  slotId: 1,
  kick: [{ login: 'guaxilol1', cookie: 'c1' }, { login: 'faturetosl' }],
  twitch: ['guaxilol1', 'faturetosl'],
  twitchCredentials: { nick: 'guaxilol1', token: 'tok1234567890' },
}];

describe('HeadlessStreamManager', () => {
  it('cria runners por canal (kick) e por aba (twitch) no primeiro reconcile', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    expect(calls.kick).toHaveLength(2);
    expect(calls.kick.map((r) => r.slug).sort()).toEqual(['faturetosl', 'guaxilol1']);
    expect(calls.kick.find((r) => r.slug === 'guaxilol1').opts.cookie).toBe('c1');
    expect(calls.twitch).toHaveLength(1);
    expect(calls.twitch[0].channels).toEqual(['guaxilol1', 'faturetosl']);
    expect(calls.twitch[0].opts.credentials).toEqual({ nick: 'guaxilol1', token: 'tok1234567890' });
    expect(calls.kick.every((r) => r.started)).toBe(true);
    expect(calls.twitch[0].started).toBe(true);
  });

  it('reconcile idêntico não recria runners', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    const total = calls.kick.length + calls.twitch.length;
    manager.reconcile(STATE_A.map((s) => ({ ...s })));
    expect(calls.kick.length + calls.twitch.length).toBe(total);
  });

  it('canal removido tem o runner parado; mantido continua vivo', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    manager.reconcile([{ slotId: 1, kick: [{ login: 'guaxilol1', cookie: 'c1' }], twitch: ['guaxilol1'], twitchCredentials: { nick: 'guaxilol1', token: 'tok1234567890' } }]);
    const faturetosl = calls.kick.find((r) => r.slug === 'faturetosl');
    expect(faturetosl.stopped).toBe(true);
    const guaxilol = calls.kick.find((r) => r.slug === 'guaxilol1');
    expect(guaxilol.stopped).toBe(false);
    // Twitch: lista mudou → runner recriado (1 socket novo com 1 canal).
    expect(calls.twitch).toHaveLength(2);
    expect(calls.twitch[0].stopped).toBe(true);
    expect(calls.twitch[1].channels).toEqual(['guaxilol1']);
  });

  it('cookie diferente recria o runner do canal', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    manager.reconcile([{ slotId: 1, kick: [{ login: 'guaxilol1', cookie: 'c2' }, { login: 'faturetosl' }], twitch: ['guaxilol1', 'faturetosl'], twitchCredentials: { nick: 'guaxilol1', token: 'tok1234567890' } }]);
    const guaxilolRunners = calls.kick.filter((r) => r.slug === 'guaxilol1');
    expect(guaxilolRunners).toHaveLength(2);
    expect(guaxilolRunners[0].stopped).toBe(true);
    expect(guaxilolRunners[1].opts.cookie).toBe('c2');
    // faturetosl (sem cookie antes e agora) não é recriado.
    expect(calls.kick.filter((r) => r.slug === 'faturetosl')).toHaveLength(1);
  });

  it('credenciais novas recriam o runner IRC da aba', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    manager.reconcile([{ slotId: 1, kick: [{ login: 'guaxilol1', cookie: 'c1' }, { login: 'faturetosl' }], twitch: ['guaxilol1', 'faturetosl'], twitchCredentials: { nick: 'guaxilol1', token: 'novotoken12345' } }]);
    expect(calls.twitch).toHaveLength(2);
    expect(calls.twitch[0].stopped).toBe(true);
    expect(calls.twitch[1].opts.credentials.token).toBe('novotoken12345');
    // Kick não é afetado.
    expect(calls.kick).toHaveLength(2);
  });

  it('aba removida da config encerra todas as presenças dela', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    manager.reconcile([{ slotId: 2, kick: [], twitch: [] }]);
    expect(calls.kick.every((r) => r.stopped)).toBe(true);
    expect(calls.twitch.every((r) => r.stopped)).toBe(true);
    expect(manager.statusSnapshot()[1]).toBeUndefined();
  });

  it('stopAll encerra tudo', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    manager.stopAll();
    expect(calls.kick.every((r) => r.stopped)).toBe(true);
    expect(calls.twitch[0].stopped).toBe(true);
    expect(manager.statusSnapshot()).toEqual({});
  });

  it('statusSnapshot reflete a saúde por canal', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    calls.kick.find((r) => r.slug === 'faturetosl').snapshotPhase = 'error';
    const snap = manager.statusSnapshot();
    expect(snap[1].kick.guaxilol1.ok).toBe(true);
    expect(snap[1].kick.faturetosl.ok).toBe(false);
    expect(snap[1].twitch.ok).toBe(true);
  });

  it('auth recusada para o runner, marca estado e avisa o main', () => {
    const { manager, calls } = makeManager();
    const onAuthFailed = vi.fn();
    manager.onTwitchAuthFailed = onAuthFailed;
    manager.reconcile(STATE_A);
    const twitchRunner = calls.twitch[0];
    twitchRunner.opts.onAuthFailed();
    expect(twitchRunner.stopped).toBe(true);
    expect(manager.hasTwitchAuthFailed(1)).toBe(true);
    expect(onAuthFailed).toHaveBeenCalledWith(1);
    const snap = manager.statusSnapshot();
    expect(snap[1].twitch.ok).toBe(false);
    expect(snap[1].twitch.phase).toBe('auth-failed');
  });

  it('credenciais novas após auth-failed limpam o estado e recriam o runner', () => {
    const { manager, calls } = makeManager();
    manager.reconcile(STATE_A);
    calls.twitch[0].opts.onAuthFailed();
    manager.reconcile([{ slotId: 1, kick: [{ login: 'guaxilol1', cookie: 'c1' }, { login: 'faturetosl' }], twitch: ['guaxilol1', 'faturetosl'], twitchCredentials: { nick: 'guaxilol1', token: 'novotoken12345' } }]);
    expect(manager.hasTwitchAuthFailed(1)).toBe(false);
    const snap = manager.statusSnapshot();
    expect(snap[1].twitch.ok).toBe(true);
    expect(calls.twitch[1].started).toBe(true);
  });

  it('credencial inválida não derruba o reconcile (vira anônimo)', () => {
    const { manager, calls } = makeManager();
    manager.reconcile([{ slotId: 1, kick: [], twitch: ['guaxilol1'], twitchCredentials: { nick: 'guaxilol1', token: 'tem espaço' } }]);
    expect(calls.twitch).toHaveLength(1);
    expect(calls.twitch[0].opts.credentials).toBeNull();
  });

  it('onStatus dispara nos reconciles', () => {
    const onStatus = vi.fn();
    const manager = new HeadlessStreamManager({
      kickRunnerFactory: (slug, opts) => new FakeKickRunner(slug, opts),
      twitchRunnerFactory: (channels, opts) => new FakeTwitchRunner(channels, opts),
      onStatus,
    });
    manager.reconcile(STATE_A);
    expect(onStatus).toHaveBeenCalled();
  });
});
