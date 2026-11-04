# Prompt para Claude Opus 5.5 — próxima evolução do Mecha Mayhem

Copie o texto abaixo junto com o ZIP ou a pasta completa do projeto.

---

Você vai continuar o **Mecha Mayhem**, um jogo 3D de combate de robôs no navegador. Implemente melhorias no projeto recebido e entregue uma versão jogável. Trabalhe somente no código, reutilizando os GLBs e as texturas incluídos. Você não precisa de Blender nem de serviços de geração 3D.

O objetivo é deixar o combate mais gostoso de jogar, o online mais completo e os mapas mais interessantes, preservando o treino acessível e os gráficos desta versão. Tome decisões de implementação rotineiras e avance até terminar cada etapa; registre limitações concretas quando não puder verificar algo.

## 1. Conheça e execute a versão recebida

1. Leia `README.md`, este documento e `docs/MECHA_MAYHEM_MASTER_PROMPT_V3.txt`. O antigo `docs/HANDOFF_PROXIMA_FASE.md` descreve uma versão anterior: várias tarefas dele já foram implementadas. Confirme o estado atual no código antes de refazer qualquer sistema.
2. Use Node.js **22.18 ou mais novo**. Rode `npm install`, `npm run build` e `npm run smoke` antes de alterar o jogo. Guarde o resultado inicial e as capturas.
3. Rode `npm run dev` e abra o endereço impresso pelo Vite. Veja menu, lobby, oficina e uma missão em cada mapa.
4. O baseline conhecido antes da rodada mais recente de gráficos tinha **48 checks passando**, sem erros de console/página. Confira o total e o resultado efetivos do pacote recebido; a rodada visual pode acrescentar verificações. Preserve os checks existentes e seus critérios.

Os gráficos estão recebendo melhorias nesta rodada. Inspecione os materiais, a iluminação e os efeitos que vieram no ZIP, compare capturas e continue a partir deles. Não atribua resultados de desempenho às mudanças visuais sem medir.

## Estado atual que deve ser preservado

- **Babylon.js + TypeScript + Vite + Havok**, com servidor **Node + WebSocket autoritativo**. O cliente envia entradas e intenções; o servidor decide dano, alcance, energia, cadência, cooldowns, mortes e pontuação.
- Seis armas: metralhadora, escopeta, laser carregável, mísseis, espada com combo/defesa e martelo com onda de choque. **J** ou clique usa a arma ativa; **K** equipa/ataca com espada; **L** equipa/ataca com martelo. **1–6** e o botão ARMA no toque continuam funcionando.
- Movimento WASD, corrida, salto/jato, Q dash, E escudo e F impacto. Preserve teclado, mouse e toque.
- Treino com cinco ondas, cinco tipos de inimigos e chefe Colosso. **Recruta** é o padrão, com inimigos mais fracos, reparo fora de combate e recuperação entre ondas. O usuário quer uma experiência mais fácil de vencer: mantenha essa opção acessível.
- Lobby de preparação com seleção de mapa, dificuldade e arma; oficina com cores e peças de **cabeça**, **tronco/braços** e **pernas** nos estilos **Scout, Striker e Titan**. As peças são cosméticas, salvas no navegador e transmitidas aos outros clientes pelo protocolo. Elas não mudam atributos nem hitboxes.
- Quatro mapas: `frozen`, `refinery`, `neon` e `canyon`. Trocar mapa atualmente recarrega a página; cliente e sala precisam usar o mesmo mapa.
- Dano por regiões, peças que se soltam, pernas destruídas mais lentas, braço da arma inutilizado e recomposição de membros no renascimento.
- Online com mata-mata, duelo, times 2v2/5v5, Core Control, salas privadas e bot criado pelo servidor em sala pública solo. Esses modos já existem; precisam de acabamento e testes de partida completa.

## Mapa do projeto

| Arquivo | Responsabilidade |
| --- | --- |
| `src/shared/sim.ts`, `weapons.ts`, `arena.ts` | Simulação, balanceamento, colisão, linha de visão e hitboxes comuns ao cliente e servidor |
| `src/shared/maps.ts`, `customization.ts`, `protocol.ts` | Mapas, peças cosméticas e mensagens online |
| `src/game/combat.ts`, `drones.ts` | Combate, ondas, jogador e IA do treino |
| `src/game/mech.ts`, `world.ts`, `fx.ts`, `audio.ts` | Robôs, animações, cenários, efeitos e sons |
| `src/main.ts`, `src/style.css`, `index.html` | Lobby, oficina, HUD e telas |
| `src/net/online.ts` | Predição, reconciliação, interpolação e apresentação do online |
| `server/room.ts`, `server/server.ts` | Regras de sala e servidor autoritativo |
| `scripts/smoke.mjs` | Verificações e capturas automatizadas |

Arquivos de `server/` e `src/shared/` rodam no Node por remoção de tipos. Use imports com extensão `.ts` nesses arquivos. Não introduza enums, namespaces nem propriedades de parâmetro no construtor. Ao mudar mensagens, aumente `PROTOCOL_VERSION` e adapte os dois lados.

## 2. Corrija primeiro as inconsistências verificáveis

Estas são pistas da leitura do código, não resultados de testes de reprodução. Confira o comportamento e cubra as correções com testes úteis:

- Em `stepTrigger`, confira se o laser também respeita o braço destruído: a lógica de carga ocorre antes da guarda usada pelas outras armas.
- Confira a equivalência do dano localizado no treino e no online. O servidor aplica integridade de partes; `damagePlayer` do treino precisa ser revisado para preservar a região atingida, as penalidades e o reparo correspondente.
- Em `src/net/online.ts`, a tela de resultado usa o primeiro jogador do ranking para decidir vitória. Em times e Core Control, todos os membros da equipe vencedora devem receber o resultado correto, inclusive ao acabar o tempo ou empatar.
- Confira o ciclo de bots, entrada/saída de humanos, troca de partida, renascimento e limpeza de salas. Um bot não deve ocupar permanentemente a vaga de um humano nem deixar uma equipe sem adversários.

## 3. Refine o combate sem mudar os controles

Alinhe a preparação, o contato e a recuperação das animações com o instante real do acerto. Espada deve parecer rápida e permitir combos claros; martelo deve parecer pesado e ter um impacto legível. Mantenha alcance, custo e janela de defesa no servidor, sem depender do FPS ou de uma confirmação de dano enviada pelo cliente.

Melhore o feedback de acerto, bloqueio, arma desativada e membro perdido com som, efeito curto e informação legível. Evite excesso de bloom, tremor e painéis sobre a mira. Permita reduzir tremor e efeitos visuais nas configurações. Preserve o treino Recruta fácil e ofereça instruções curtas para quem está começando.

## 4. Complete a IA online e os modos de equipe

O bot online atual segue diretamente o alvo. Adicione navegação baseada nas passagens e coberturas do layout, prevenção de travamento e decisões simples de flanco/recuo. A lógica deve rodar no servidor e respeitar as mesmas regras de movimento e ataque dos humanos. Não dê mira perfeita nem vantagens ocultas.

Preencha as vagas necessárias ao modo com bots, mantendo equipes equilibradas e substituindo bots por humanos de forma previsível. Para Core Control, bots devem disputar o núcleo. Mostre área, estado neutro/domínio/contestado e pontuação por equipe; valide também altura e posição de captura para não pontuar de um piso que não pertence ao núcleo. Centralize os valores das regras compartilhadas.

Transforme o lobby online em preparação clara de partida: mapa e modo visíveis, jogadores/equipes, vagas e botão de prontidão quando fizer sentido. Preserve salas por código e o fluxo rápido para jogar sozinho.

## 5. Dê identidade de jogo aos quatro mapas

Melhore rotas e pontos de interesse dos mapas existentes antes de acrescentar arenas parecidas. Crie alternativas de aproximação para armas curtas, posições de cobertura e referências visuais fáceis de reconhecer. Se adicionar plataformas elevadas ou rampas, mantenha geometria visível, colisão, chão, linha de visão e navegação do servidor coerentes.

Reutilize os GLBs incluídos e mantenha os créditos. Decoração deve ter função visual clara e não bloquear caminhos sem colisão correspondente. Não altere a dificuldade adicionando perigos inevitáveis ao Recruta.

## 6. Meça desempenho e feche a entrega

- Use instâncias, materiais compartilhados e pools nos efeitos que ainda criam e descartam malhas em cada ataque. Evite aumentar draw calls e pós-processamento sem comparar custo e imagem.
- Teste Alta/Média/Baixa. Se houver GPU real disponível, registre navegador, GPU, resolução, qualidade, cenário, tempo de amostragem e tempos de quadro. Metas: 60 FPS desktop Alta e 30 FPS celular Média. São metas, não resultados garantidos.
- O smoke headless usa renderização por software e avanço fixo de simulação. Ele verifica comportamento e regressões; não comprova FPS em GPU real. Não anuncie teste pela internet se só usou abas locais.
- Amplie o smoke com casos determinísticos para as correções, partida completa por equipe/Core Control, bot sem travar e renascimento restaurando partes. Preserve os checks antigos; não remova falhas nem reduza critérios para obter verde.
- Capture lobby, oficina, combate e objetivo em desktop e em **390×844**; verifique também paisagem. Revise as imagens para detectar sobreposição, alvos ilegíveis e efeitos exagerados.
- Termine com `npm run build` e `npm run smoke` passando, sem erros de console. Atualize `README.md` e um handoff curto com o que mudou, comandos executados, resultados e pendências reais. Deixe `npm run dev` rodando e informe o endereço.
- Entregue um ZIP de código-fonte com assets e documentação, sem `node_modules` nem arquivos temporários; inclua o relatório dos testes. Relate somente o que foi efetivamente verificado.

Comece pela execução inicial e implemente as etapas na ordem acima. Corrija regressões antes de avançar para novos sistemas. Entregue mudanças concretas e jogáveis.
