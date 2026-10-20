# PokeIdle Multiview

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/ryuuft/multiview-application?v=1.5.0)](../../releases)
[![CI](https://github.com/ryuuft/multiview-application/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

[English](README.md) | **Português (Brasil)**

Até **4 sessões isoladas do [pokeidle.io](https://pokeidle.io) em uma única janela**, feito para deixar várias contas em idle ao mesmo tempo no PC — com streams da Twitch e da Kick em segundo plano para o bônus de XP do jogo.

## Recursos

- **Até 4 slots** independentes, cada um com sessão própria e persistente (login permanece entre sessões).
- **Modos de layout**: Grade (2×2 com splitters arrastáveis) e Foco (um slot em destaque).
- **Twitch e Kick em segundo plano (multi-stream)**: cada aba pode assistir a **vários canais oficiais ao mesmo tempo**, escondidos e mudos, para somar o bônus de XP (+2,5% por stream adicional) — nas duas plataformas. A vinculação é feita pelo botão **Vincular Twitch/Kick** do jogo (autorização numa janela própria, na mesma sessão da aba, que se fecha sozinha ao concluir). Os links de canais oficiais dentro do jogo alimentam o segundo plano da aba sem abrir janelas extras — até **8 canais por plataforma em cada aba** (📺 Twitch / 🟩 Kick no chip). Ao reabrir o app, todas as streams retomam automaticamente.
- **Fechar para a bandeja**: com streams ativas, o **×** esconde o app para a bandeja e o farm continua (dica na primeira vez). "Mostrar" e "Encerrar" ficam no ícone da bandeja, perto do relógio. Comportamento configurável em **⚙** (sempre / só com streams / nunca).
- **PC acordado**: enquanto houver streams ativas, o app impede que o Windows suspenda (opcional em **⚙**).
- **Qualidade mínima automática**: ao entrar em segundo plano, o app tenta selecionar a menor qualidade do player (menos CPU/GPU). Opcional em **⚙** — desligue se quiser controlar a qualidade manualmente.
- **Saúde das streams**: stream que travar aparece com **⚠** no contador do chip e é religada automaticamente (rodadas com intervalo); a lista de canais com problema aparece no tooltip.
- **Voltar a uma stream**: com o painel aberto (📺/🟩), cada canal em segundo plano aparece como pílula — **clicar no nome traz a stream de volta ao painel** (ex.: resgatar pontos na Kick); quando terminar, **Segundo plano** a devolve ao fundo. **×** encerra de vez.
- **Login sem prompt de chave de acesso**: o app desliga WebAuthn (passkeys) nas páginas da Twitch, da Kick e do Google — a API é quebrada dentro do Electron ([electron#27355](https://github.com/electron/electron/issues/27355)) e o prompt "Segurança do Windows" travava o login. Com a API fora, o botão **Continuar com Google** funciona pela autenticação clássica (e-mail + senha) na Twitch e na Kick, que também aceitam usuário/senha. Verificações em duas etapas por código/push no celular funcionam normalmente.
- **Auto-recarga**: recarrega todas as páginas do jogo em intervalo configurável (Off, 15 min, 30 min, 1 h, 3 h, 6 h, 12 h ou 24 h) — útil para acompanhar as atualizações diárias do jogo.
- **Extensão /hunt**: se a extensão ["/hunt for PokeIdle"](https://chromewebstore.google.com/detail/hunt-for-pokeidle/mhnplloljgchpfpcpbhmcokmnefodjnh) estiver instalada em algum navegador Chromium da máquina (Chrome, Edge, Brave, Vivaldi, Comet, Opera…), o app carrega automaticamente a versão mais recente em todos os slots a cada abertura — basta atualizar no navegador que o app acompanha no próximo F5 do app.
- **Zoom por slot** de 50% a 200% (passos de 10%).
- **Mudo por slot** e recarga manual individual (⟳).
- **Renomear slots** com duplo clique no nome ou pelo menu **⋯** da aba (que concentra também recarregar e fechar, com confirmação).
- **Recuperação de crash**: se o jogo parar de responder, um botão "Recarregar" aparece sobre o slot.
- Configurações persistidas (slots, layout, zoom, som, auto-recarga, bandeja, suspensão, qualidade, tamanho da janela) — ajustes em **⚙** na barra superior.

## Como começar

**Requisitos:** Windows 10/11 (x64). Não requer instalação.

1. Baixe o `PokeIdleMultiview.exe` (portátil) na página de [Releases](../../releases).
2. Execute o arquivo.
3. Clique em **+ Slot** para abrir contas (até 4) e faça login em cada uma.

### Bônus de XP com streams em segundo plano

1. No jogo, abra o modal **Bônus Twitch** (ou **Bônus Kick**) e clique em **Vincular** — a autorização abre numa janela própria e se fecha sozinha ao concluir.
2. Clique nos canais oficiais dentro do próprio jogo: na primeira vez o painel aparece para você conferir o login — clique em **Segundo plano** para fixar o canal; nos próximos cliques, cada canal entra direto no segundo plano (o chip da aba mostra os contadores, ex.: `📺 3` e `🟩 2`).
3. Com o painel aberto, as streams ativas aparecem como pílulas no topo, com **×** para encerrar cada uma e **Fechar todas** para parar tudo.

### Atalhos

| Atalho | Ação |
| --- | --- |
| `Ctrl + 1` … `Ctrl + 4` | Seleciona o slot correspondente |

## Dados e configuração

As preferências ficam em `%APPDATA%\PokeIdleMultiview\config.json` (gravação atômica e normalizada a cada leitura/salvamento). Os cookies e o armazenamento de cada slot ficam em partições separadas (`persist:slot-1` … `persist:slot-4`).

## Privacidade e segurança

- As páginas embutidas só podem navegar para `pokeidle.io` e `www.pokeidle.io`. Os painéis de stream ficam restritos a `twitch.tv` e `kick.com` (com `accounts.google.com` liberado durante o login) e ocupam o lugar do jogo na própria aba enquanto estiverem visíveis.
- As webViews só recebem as permissões que pedirem, de uma lista permitida (câmera/microfone não estão entre elas).
- O app varre os perfis de navegadores Chromium da máquina **apenas** para localizar a extensão /hunt já instalada. Nada é enviado para fora: o app não faz requisições próprias além das páginas que você abre.
- O WebAuthn é desligado só dentro das janelas deste app — seus navegadores não são alterados.
- Limitação conhecida: janelas popup abertas de dentro das páginas embutidas não passam pelas mesmas restrições de navegação.

## Aviso

Esta é uma ferramenta não oficial, feita pela comunidade. **Não tem afiliação nem endosso do pokeidle.io, Twitch, Kick ou Google**. Manter streams abertas em segundo plano e usar várias contas podem ser regulados pelos termos de serviço do jogo e das plataformas de streaming — confira as regras vigentes e use por sua conta e risco.

## Desenvolvimento

Requisitos: Node.js (com npm) e Windows para gerar o executável.

```bash
npm install        # instala dependências (inclui o Electron)
npm start          # roda o app em modo desenvolvimento
npm test           # roda a suíte de testes (vitest)
npm run dist       # gera o executável portátil em release/
```

Estrutura principal:

```
src/
  main/          # processo principal (janela, guards de webview, IPC, protocolo app://, extensão /hunt)
  renderer/      # UI (toolbar, chips, slots, splitters)
  shared/        # config compartilhada (defaults, normalização, limites)
tests/           # testes de config, layout e extensões
scripts/         # geração do ícone
```

O arquivo `resources/icon.ico` é gerado pelo `npm run icon` (parte do `npm run dist`) e não é versionado. Releases são cortadas com o push de uma tag `vX.Y.Z` — um workflow do GitHub Actions compila o executável e o anexa à release automaticamente.

## Contribuir

Reportes de bug e pull requests são bem-vindos — veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE)
