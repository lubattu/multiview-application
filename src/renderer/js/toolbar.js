function iconButton(text, title, onClick) {
  const b = document.createElement('button');
  b.className = 'chip-btn';
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', () => onClick());
  return b;
}

function streamButton({ icon, count, broken = [], panelOpen, title, capturing = false, onClick }) {
  const lines = [panelOpen ? `Fechar painel da ${title}` : `Abrir painel da ${title} (login / escolher canal)`];
  if (count > 0) lines.push(`${title}: ${count} stream${count > 1 ? 's' : ''} em segundo plano`);
  if (capturing) lines.push('Autenticando a sessão da Twitch automaticamente (aguarde alguns segundos)...');
  if (broken.length > 0) lines.push(`⚠ Com falha: ${broken.join(', ')} (recuperando sozinho; se persistir, a aba volta ao modo normal)`);
  const b = iconButton(
    panelOpen ? '📥' : `${icon} ${count}${broken.length > 0 ? ' ⚠' : ''}${capturing ? ' …' : ''}`,
    lines.join('\n'),
    onClick,
  );
  b.classList.add('chip-btn-stream');
  b.classList.toggle('active', count > 0);
  b.classList.toggle('stream-broken', broken.length > 0);
  return b;
}

function toggleChipMenu(chipEl, chip, handlers, nameEl) {
  const existing = chipEl.querySelector('.chip-menu');
  if (existing) {
    existing.remove();
    return;
  }
  document.querySelectorAll('.chip-menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'chip-menu';
  // position:fixed com coordenadas calculadas — position:absolute dentro de #chips
  // (overflow-x: auto) seria cortado pelo scroll container.
  const rect = chipEl.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 190)}px`;
  const item = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => {
      menu.remove();
      fn();
    });
    return b;
  };
  menu.append(
    item('⟳ Recarregar jogo', 'Recarregar a página do jogo desta aba', () => handlers.onReload(chip.id)),
    item('✏️ Renomear', 'Renomear esta aba', () => startRename(chip, nameEl, handlers)),
    item('🗑️ Fechar slot', 'Encerrar esta aba (os logins da conta permanecem salvos)', () => {
      if (window.confirm(`Fechar a aba "${chip.name}"?\n\nO login da conta fica salvo — você pode reabrir depois com "+ Slot".`)) {
        handlers.onClose(chip.id);
      }
    }),
  );
  document.body.appendChild(menu);
  setTimeout(() => {
    const closeOnOutside = (ev) => {
      if (!menu.contains(ev.target) && !chipEl.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
  }, 0);
}

export function renderChips(container, chips, handlers) {
  container.replaceChildren();
  for (const chip of chips) {
    const el = document.createElement('div');
    el.className = 'chip' + (chip.selected ? ' selected' : '') + (chip.loading ? ' loading' : '');
    el.classList.toggle('twitch-bg', chip.twitchStreams + chip.kickStreams > 0);
    el.dataset.slotId = String(chip.id);

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = chip.name;
    name.title = 'Clique para selecionar; duplo clique para renomear';
    name.addEventListener('click', () => handlers.onSelect(chip.id));
    name.addEventListener('dblclick', () => startRename(chip, name, handlers));

    const menuBtn = iconButton('⋯', 'Mais ações (recarregar, renomear, fechar)', () => toggleChipMenu(el, chip, handlers, name));
    menuBtn.classList.add('chip-btn-menu');

    el.append(
      name,
      streamButton({
        icon: '📺', count: chip.twitchStreams, broken: chip.twitchBroken ?? [],
        panelOpen: chip.twitchPanel, title: 'Twitch', capturing: chip.lightCapturing === true,
        onClick: () => handlers.onToggleTwitch(chip.id),
      }),
      streamButton({
        icon: '🟩', count: chip.kickStreams, broken: chip.kickBroken ?? [],
        panelOpen: chip.kickPanel, title: 'Kick',
        onClick: () => handlers.onToggleKick(chip.id),
      }),
      iconButton(chip.muted ? '🔇' : '🔊', 'Som do jogo desta aba', () => handlers.onToggleMute(chip.id)),
      menuBtn,
    );
    container.appendChild(el);
  }
}

function startRename(chip, nameEl, handlers) {
  const input = document.createElement('input');
  input.className = 'chip-rename';
  input.maxLength = 40;
  input.value = chip.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  let cancelled = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    input.replaceWith(nameEl);
    handlers.onRename(chip.id, commit ? input.value : chip.name);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') {
      cancelled = true;
      finish(false);
    }
  });
  input.addEventListener('blur', () => {
    if (!cancelled) finish(true);
  });
}
