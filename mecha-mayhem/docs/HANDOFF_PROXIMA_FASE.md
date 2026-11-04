# Mecha Mayhem — briefing para a próxima IA (Fase 3)

Você vai continuar o **Mecha Mayhem**, um jogo 3D de batalha de robôs no navegador (Babylon.js + TypeScript + Vite + Havok, servidor online em Node + WebSocket). Trabalhe **só no código**, sem Blender e sem modelos novos: use os GLBs já incluídos e efeitos criados em código.

## Comece aqui

1. Node.js 22.18 ou mais novo. Rode `npm install`, `npm run build` e `npm run dev`; abra `http://localhost:5173/`.
2. Leia `README.md` (o que já existe e as pendências) e `docs/MECHA_MAYHEM_MASTER_PROMPT_V3.txt` (especificação completa do produto).
3. Rode `npm run smoke`. Hoje ele tem 24 verificações e todas passam; as capturas ficam em `artifacts/smoke/`. Não quebre nenhuma.

## Mapa do código

| Arquivo | Papel |
| --- | --- |
| `src/shared/sim.ts` | Movimento, energia, calor, dash, escudo, jato. **Mesmo código no cliente e no servidor**: qualquer mudança vale para os dois. |
| `src/shared/weapons.ts` | Tabela das 4 armas (dano, cadência, alcance, calor, energia, recuo). Valores de balanceamento ficam aqui. |
| `src/shared/arena.ts` | Colisão do mapa, coberturas, linha de visão, hitbox dos mechs (corpo + cabeça crítica). |
| `src/shared/protocol.ts` | Mensagens do online. Ao mudar, aumente `PROTOCOL_VERSION`. |
| `src/game/combat.ts` | Jogador, câmera, disparos, projéteis, ondas, suprimentos, barris, HUD e ganchos de teste (`debugStep`, `debugSkipWave`, `debugApproach`). |
| `src/game/drones.ts` | IA dos 5 inimigos (máquina de estados, grafo de navegação, cobertura, sinais de ataque). |
| `src/game/mech.ts` | Striker procedural, 4 modelos de arma, animações, desmontagem ao morrer. |
| `src/game/world.ts` | Mapa, climas, neve, aurora, barricadas, barris e caixas. |
| `src/game/fx.ts`, `audio.ts`, `touch.ts` | Efeitos, sons sintetizados, controles de toque. |
| `src/net/online.ts` | Predição, reconciliação e interpolação no cliente. |
| `server/room.ts`, `server/server.ts`, `server/index.ts` | Servidor autoritativo, salas e servidor de produção (`npm start`). |

Regra importante: arquivos em `server/` e `src/shared/` rodam no Node por remoção de tipos. **Não use** enums, namespaces nem propriedades de parâmetro no construtor (`constructor(private x: T)`), e importe com a extensão `.ts`.

## Tarefas, nesta ordem

1. **Armas corpo a corpo.** Implemente a **espada de energia** e o **martelo mecânico** da especificação como armas 5 e 6: golpes em arco com hitbox real, combos, defesa contra projéteis (espada) e onda de choque no chão (martelo). Modelos feitos em código no `mech.ts`, valores em `weapons.ts`, validação no `server/room.ts`, cartões na garagem e botões de toque.
2. **Dano localizado.** Divida a hitbox em braços, pernas, tronco e cabeça. Perder um braço desativa a arma daquele lado; pernas danificadas reduzem a velocidade. Mostre peças soltando durante a luta (já existe `breakApart` para a morte).
3. **Bots no online.** Quando uma sala tiver um só jogador, preencha com bots rodando **no servidor** (reaproveite a lógica de `drones.ts` adaptada a `MechState`), para a partida nunca ficar vazia.
4. **Modo por times.** Times 2v2 e depois 5v5, com cores por time, fogo amigo desligado e placar por equipe. Depois, o modo **Core Control** (dominar o núcleo central).
5. **Segundo mapa** feito em código a partir dos GLBs existentes (caixas, barris, torres): por exemplo, uma refinaria em plataformas com níveis de altura e pontes.
6. **Desempenho.** Meça em GPU real (Chrome DevTools). Meta: 60 FPS no desktop na qualidade Alta e 30 FPS num celular médio na Média. Use instâncias e pools onde ainda se cria malha por efeito (`fx.shockwave`, `fx.muzzleFlash`, `fx.pillar`).
7. **Testes.** Para cada item acima, acrescente verificações ao `scripts/smoke.mjs` e mantenha as 24 atuais passando. Atualize o `README.md`.

## Critérios de entrega

- `npm run build` e `npm run smoke` passam sem erros de console.
- Cada arma nova tem comportamento claramente diferente e funciona com teclado, mouse e toque.
- O servidor continua validando tudo (dano, cadência, alcance, energia, cooldowns); nada de confiar no cliente.
- O layout continua cabendo em 390×844 sem botões sobre o HUD.
- Relate com honestidade o que foi testado e o que ficou pendente.

## Mensagem curta para colar

> Continue o jogo Mecha Mayhem deste ZIP somente no código. Leia `docs/HANDOFF_PROXIMA_FASE.md` e o `README.md`, rode `npm install`, `npm run build` e `npm run smoke`, e implemente as tarefas na ordem indicada: espada e martelo, dano localizado, bots no online, times, segundo mapa, desempenho e testes. Mantenha o servidor autoritativo, não quebre os 24 checks atuais e relate só o que foi verificado.
