import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUNT_EXTENSION_ID, latestVersionDir, resolveHuntExtensionDir } from '../src/main/extensions.js';

describe('latestVersionDir', () => {
  it('escolhe a maior versão numericamente, não lexicograficamente', () => {
    expect(latestVersionDir(['1.0.1_0', '1.0.2_0', '0.9.0_0'])).toBe('1.0.2_0');
    expect(latestVersionDir(['0.10.0_0', '0.9.0_0'])).toBe('0.10.0_0');
    expect(latestVersionDir(['2_0', '1.9.9_0'])).toBe('2_0');
  });

  it('desempata pelo contador de reinstalação', () => {
    expect(latestVersionDir(['1.0.1_0', '1.0.1_1'])).toBe('1.0.1_1');
    expect(latestVersionDir(['1.0.1_2', '1.0.1_10'])).toBe('1.0.1_10');
  });

  it('ignora lixo e lista vazia', () => {
    expect(latestVersionDir(['_metadata', 'notas.txt'])).toBeNull();
    expect(latestVersionDir([])).toBeNull();
  });
});

describe('resolveHuntExtensionDir', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-ext-test-'));
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const writeExtension = (localAppData, browserPath, profile, version, withManifest = true) => {
    const dir = path.join(localAppData, browserPath, profile, 'Extensions', HUNT_EXTENSION_ID, version);
    fs.mkdirSync(dir, { recursive: true });
    if (withManifest) fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
    return dir;
  };

  it('encontra a versão mais recente no perfil de um navegador suportado', () => {
    const local = path.join(tmpRoot, 'case1');
    const oldDir = writeExtension(local, path.join('Perplexity', 'Comet', 'User Data'), 'Default', '1.0.0_0');
    const newDir = writeExtension(local, path.join('Perplexity', 'Comet', 'User Data'), 'Default', '1.0.1_0');
    expect(resolveHuntExtensionDir({ LOCALAPPDATA: local })).toBe(newDir);
    expect(fs.existsSync(oldDir)).toBe(true);
  });

  it('varre perfis "Profile N" além do Default', () => {
    const local = path.join(tmpRoot, 'case2');
    const dir = writeExtension(local, path.join('Google', 'Chrome', 'User Data'), 'Profile 3', '1.0.1_0');
    expect(resolveHuntExtensionDir({ LOCALAPPDATA: local })).toBe(dir);
  });

  it('pula pasta de versão pega no meio de atualização (sem manifest)', () => {
    const local = path.join(tmpRoot, 'case3');
    writeExtension(local, path.join('Microsoft', 'Edge', 'User Data'), 'Default', '1.0.1_0', false);
    const dir = writeExtension(local, path.join('Microsoft', 'Edge', 'User Data'), 'Default', '1.0.0_0');
    expect(resolveHuntExtensionDir({ LOCALAPPDATA: local })).toBe(dir);
  });

  it('retorna null quando nada foi encontrado', () => {
    const local = path.join(tmpRoot, 'case4');
    fs.mkdirSync(local, { recursive: true });
    expect(resolveHuntExtensionDir({ LOCALAPPDATA: local })).toBeNull();
  });
});
