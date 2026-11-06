# PARA CHATGPT/CODEX — Portar o Mecha Mayhem para Unreal Engine

Pedido do Lucca: levar o jogo para a Unreal Engine. O Claude roda num contêiner Linux na nuvem, sem
Unreal Editor nem GPU, e não consegue abrir, compilar ou testar um projeto Unreal. Quem tem o
computador com a Unreal instalada (Codex, controlando a máquina do Lucca) cria e compila o projeto.
O Claude mantém a versão web e prepara dados e regras exportáveis.

## Problema

A versão atual é Babylon.js + TypeScript (navegador, artefato do claude.ai e `npm run dev`). A Unreal
usa C++/Blueprints, não roda dentro do artefato e não reaproveita o código TypeScript. Portanto, o
port é uma reescrita do código; os assets e as regras são reaproveitados.

## O que dá para reaproveitar direto

| Item | Arquivo | Uso na Unreal |
|---|---|---|
| Mapa Ferro-Velho Titã (cena detalhada) | `docs/maps/ferro_velho_tita/Ferro_Velho_Tita_Detalhado.blend` | Abrir no Blender e exportar FBX/GLB para a Unreal (escala 1 m = 100 uu, Z para cima: sem conversão de eixo) |
| Colisões do mapa (93 volumes) | `docs/maps/ferro_velho_tita/colisoes_mapa.json` | Gerar Blocking Volumes ou colisão simples (UCX_) nas mesmas posições |
| Outros mapas e modelos | `public/assets/models/*.glb`, `public/assets/sketchfab/*.glb` (ver `ATTRIBUTION.md`) | Importar com o importador glTF da Unreal 5 |
| Mech jogador (rigged) | `public/assets/models/striker/*.glb`, `public/assets/triverse/` | Skeletal Mesh |
| Regras de movimento, energia, calor | `src/shared/sim.ts` (`MOVE`, `stepMech`) | Character Movement + atributos |
| Armas (dano, alcance, cadência, laser, mísseis, espada, martelo) | `src/shared/weapons.ts` | Data Table de armas |
| Peças modulares (10 famílias, sobrecarga 100–135%) | `src/shared/parts.ts` | Data Table + validação no servidor |
| Modos online (FFA, duelo, 2v2, 5v5, Core Control) e regras | `src/shared/protocol.ts` (`MODE_RULES`, `CORE_RULES`, `BOT_FILL`) | GameMode/GameState |
| Bots (estados, navegação, mira) | `server/bots.ts` | Behavior Tree + NavMesh |
| Modo história (5 capítulos) | `src/game/story.ts` | Data Assets |
| Progressão, passe, loja (sem dinheiro real) | `src/game/progression.ts` | SaveGame |

## Resultado esperado (primeira entrega do Codex)

1. Projeto UE5 (C++ + Blueprints) com o Ferro-Velho Titã importado e as colisões do JSON aplicadas.
2. Mech jogável em terceira pessoa com metralhadora, dash, escudo e jato, usando os números de `sim.ts`.
3. Multiplayer com servidor dedicado da própria Unreal (replicação nativa), FFA com bots.
4. Controles: J arma ativa, K espada, L martelo, mouse; toque fica para depois.
5. Recruta fácil de vencer; servidor autoritativo (dano e acertos só no servidor).
6. Relatar o que foi compilado e testado de verdade, e as pendências.

## Combinado

- Sem compras de assets e sem gerações pagas sem aprovação do Lucca.
- O Claude continua mantendo a versão web/artefato no branch `claude/mecha-mayhem-improvements-7ouqch`.
- Troca de código por ZIP/handoff; cada lado deixa notas "PARA CLAUDE" / "PARA CHATGPT/CODEX".
