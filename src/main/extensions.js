import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Extensão "/hunt for PokeIdle" (Chrome Web Store, id abaixo). O app não a distribui: procura
// a cópia já instalada por algum navegador Chromium da máquina e carrega a versão mais
// recente a cada boot — assim as atualizações do navegador valem para o app no próximo F5.
export const HUNT_EXTENSION_ID = 'mhnplloljgchpfpcpbhmcokmnefodjnh';

// Chromium-family guarda perfis em "<User Data>/<perfil>/Extensions"; o Opera instala o
// perfil direto na pasta do navegador ("Opera Stable"), sem a camada "User Data".
function browserRoots(localAppData) {
  return [
    path.join(localAppData, 'Google', 'Chrome', 'User Data'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    path.join(localAppData, 'Vivaldi', 'User Data'),
    path.join(localAppData, 'Perplexity', 'Comet', 'User Data'),
    path.join(localAppData, 'Chromium', 'User Data'),
    path.join(localAppData, 'Google', 'Chrome SxS', 'User Data'),
    path.join(localAppData, 'Google', 'Chrome Beta', 'User Data'),
    path.join(localAppData, 'Google', 'Chrome Dev', 'User Data'),
    path.join(localAppData, 'Opera Software', 'Opera Stable'),
    path.join(localAppData, 'Opera Software', 'Opera GX Stable'),
  ];
}

function candidateProfileDirs(root, fsMod) {
  const dirs = [root, path.join(root, 'Default')];
  try {
    for (const entry of fsMod.readdirSync(root)) {
      if (/^Profile \d+$/.test(entry)) dirs.push(path.join(root, entry));
    }
  } catch {
    // raiz inacessível; os candidatos básicos ainda são tentados
  }
  return dirs;
}

// As versões instaladas ficam em pastas "1.2.3_0" (o sufixo é o contador de reinstalação do
// Chromium). Compara os segmentos numericamente — "0.10.0" > "0.9.0" — e desempata pelo contador.
export function sortVersionDirs(names) {
  const parsed = [];
  for (const name of names) {
    const [version, counter] = name.split('_');
    if (!/^\d+(\.\d+)*$/.test(version)) continue;
    parsed.push({ segments: version.split('.').map(Number), counter: Number(counter ?? 0), name });
  }
  return parsed.sort((a, b) => {
    const len = Math.max(a.segments.length, b.segments.length);
    for (let i = 0; i < len; i++) {
      const diff = (b.segments[i] ?? 0) - (a.segments[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return b.counter - a.counter;
  }).map((p) => p.name);
}

export function latestVersionDir(names) {
  return sortVersionDirs(names)[0] ?? null;
}

export function resolveHuntExtensionDir(env = process.env, fsMod = fs) {
  const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  for (const root of browserRoots(localAppData)) {
    for (const profileDir of candidateProfileDirs(root, fsMod)) {
      const idDir = path.join(profileDir, 'Extensions', HUNT_EXTENSION_ID);
      let entries;
      try {
        entries = fsMod.readdirSync(idDir);
      } catch {
        continue;
      }
      // Da mais nova para a mais velha: pula pastas pegas no meio de uma atualização do
      // navegador (ainda sem manifest) sem perder versões válidas anteriores.
      for (const version of sortVersionDirs(entries)) {
        const dir = path.join(idDir, version);
        try {
          if (!fsMod.statSync(path.join(dir, 'manifest.json')).isFile()) continue;
        } catch {
          continue;
        }
        return dir;
      }
    }
  }
  return null;
}
