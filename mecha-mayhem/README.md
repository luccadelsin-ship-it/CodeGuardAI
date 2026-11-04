# Mecha Mayhem — Fase 4 · Peças modulares e equipes

Jogo 3D de batalha de robôs no navegador, feito com **Babylon.js**, **TypeScript**, **Vite** e **Havok Physics**, agora com **modo online** em servidor autoritativo. O mapa Frozen Outpost foi modelado no Blender; cinco objetos de ambiente vieram do Sketchfab (atribuição no menu e em [`public/assets/sketchfab/ATTRIBUTION.md`](public/assets/sketchfab/ATTRIBUTION.md)).

## Fase 4 (esta entrega)

- **Peças modulares com atributos reais** (`src/shared/parts.ts`): 10 famílias × cabeça / tronco+braços / pernas, com peso, sustentação, integridade, blindagem, energia e velocidade vindos de `public/assets/modular/catalog.json`. Oficina com abas por peça, prévia da imagem (17/30 prontas; as demais mostram "REF. PENDENTE") e painel de estatísticas fora das imagens.
- **Carga e sobrepeso**: pernas sustentam cabeça + tronco + arma; o tronco sustenta cabeça + arma. Até 100% sem penalidade; 100–135% = sobrecarga (velocidade, pulo e jato menores, energia mais cara); acima de 135% a oficina bloqueia a partida e o servidor troca o chassi pelo Striker. Os atributos são aplicados na simulação compartilhada (cliente e servidor), e o servidor recalcula tudo a partir dos ids das peças.
- **Correções**: laser não carrega com braço da arma destruído; dano localizado agora existe no treino (perda de membros, aviso de arma desativada); reparo entre ondas e caixas de suprimento restauram membros; resultado online dá vitória a todos da equipe vencedora e reconhece empate.
- **Espada e martelo sincronizados**: o dano (treino e servidor) e o impacto acontecem no instante em que a animação acerta (`MELEE_CONTACT`), não no clique.
- **Bots e equipes** (`server/bots.ts`): navegação por grafo de waypoints, flanco, recuo com pouca vida, detecção de travamento (pula e recalcula a rota), mira com reação e erro. Salas públicas completam vagas com bots (FFA 4, duelo 2, 2v2, 5v5, Core 8) com equipes equilibradas; humanos substituem bots.
- **Core Control**: zona visível no centro (neutro/azul/laranja/disputado), captura em 3 s sem disputa, pontuação contínua do dono, validação de altura (jato ou caixas não pontuam) e objetivo legível no HUD.
- **Mapas com identidade** (`MAP_COVER` em `src/shared/arena.ts`): Refinaria com coluna central e dutos; Doca Neon com plataforma elevada e paredes de luz; Cânion com blocos de minério em degraus; Frozen mantém as barricadas. A mesma geometria serve para colisão, chão, linha de visão e navegação no cliente e no servidor.
- Protocolo online **v8**.

### Verificado nesta entrega
- `npm run build` passou. `npm run smoke`: **63 checks passaram, 0 falhas, sem erros de console** (registro em `artifacts/smoke-latest.log`, capturas em `artifacts/smoke/`), incluindo desktop e 390×844 com toque, oficina, mapas e online com duas abas.
- Os testes de espada, bot solo e Core Control foram ajustados ao novo comportamento (contato atrasado, preenchimento com vários bots, captura de 3 s) mantendo os mesmos critérios.

### Pendências reais
- **13 imagens de referência** (cabeças Vanguard/Ronin/Warden/Tempest, troncos Vanguard/Ronin/Warden/Tempest, pernas Spectre/Vanguard/Ronin/Warden/Tempest) não foram geradas: o usuário recusou o gasto de créditos. Prompts prontos em `docs/PENDING_REFERENCE_PROMPTS.json`.
- **30 GLBs no Triverse** não foram gerados: não há `TRIVERSE_API_KEY` nem acesso à conta neste ambiente. Plano e comandos em `docs/TRIVERSE_30_PARTS_PLAN.json`. O robô em jogo usa as peças procedurais (silhueta + cores + detalhes de cada família).
- Gráficos: revisados por capturas (sem erros); não houve nova passada de materiais/iluminação além das peças de mapa. FPS em GPU real e jogo pela internet não foram testados.

## Executar

Requer Node.js 22.18 ou mais novo (o servidor roda TypeScript direto pelo Node).

```powershell
npm install
npm run dev        # jogo + servidor online em http://localhost:5173/
```

Produção (um único processo serve o jogo e o online):

```powershell
npm run build
npm start          # http://localhost:8080/  ·  online em ws://localhost:8080/online  (PORT muda a porta)
```

`npm run preview` também sobe o servidor online. Para jogar com amigos pela internet, rode `npm start` numa máquina acessível por eles (VPS, Render, Railway, Fly.io etc.) e abra o endereço público; o cliente se conecta ao mesmo host automaticamente. Em **Online → Servidor** dá para apontar para outro endereço WebSocket.

## Controles

| Teclado / mouse | Toque | Ação |
| --- | --- | --- |
| W A S D | Joystick (metade esquerda) | Mover |
| Mouse | Arrastar na metade direita ou no botão FOGO | Mirar |
| J ou clique esquerdo (segure e solte no laser) | FOGO | Atacar com a arma ativa |
| K (segure para combo) | ARMA → espada, depois FOGO | Equipar e atacar com espada |
| L (segure para combo) | ARMA → martelo, depois FOGO | Equipar e atacar com martelo |
| Shift | Joystick empurrado até o fim | Correr |
| Espaço (segure no ar = jato) | SALTO | Saltar / pairar |
| Q | DASH | Turbo dash na direção do movimento (reduz dano) |
| E | ESCUDO | Escudo de energia (absorve 75%) |
| F | SOCO | Impacto corpo a corpo com empurrão |
| 1-6, roda do mouse, R | ARMA | Trocar arma |
| Tab | — | Placar online |
| Esc | II | Pausar |

## O que há de novo

**Lobby e oficina**
- Abra **Lobby / Preparar missão** no menu para escolher mapa, dificuldade e arma inicial, personalizar o robô ou entrar no online.
- A oficina combina **cabeça**, **tronco e braços** e **pernas** nos estilos **Scout**, **Striker** e **Titan**, além da cor e das seis armas. As peças mudam o modelo procedural e ficam salvas neste navegador.
- A personalização de partes é cosmética e local. Ela não altera atributos nem hitboxes: o servidor continua usando as mesmas hitboxes e regras compartilhadas para todos os jogadores.

**IA dos drones** (`src/game/drones.ts`)
- Cinco inimigos com comportamentos diferentes: **Sentinela** (mantém distância, metralha de lado, busca cobertura e flanqueia), **Rompedor** (avança, carrega o ataque e investe com rajada + golpe), **Atirador** (mantém 24–40 m, mira laser visível que rastreia com atraso e trava antes do disparo, depois muda de posição), **Vespa** (drone voador que orbita o jogador e mergulha como kamikaze quando danificado) e o chefe **Colosso** (barragem de mísseis teleguiados, onda de choque no chão que precisa ser pulada, rajadas de escopeta, segunda fase com escudo e reforços).
- Máquina de estados com patrulha, combate, flanco, cobertura (escolhe pontos fora da linha de visão e se repara), recuo ao levar dano e atordoamento por impacto.
- Navegação por grafo de pontos do mapa + sensores para contornar coberturas; detecção de travamento; separação entre inimigos.
- Todo ataque tem aviso visual e sonoro (brilho, orbe crescente, mira laser, bipes). Os projéteis são reais e param na cobertura; ninguém atira através de paredes.

**Armas** (`src/shared/weapons.ts`) — trocáveis em combate, na garagem e no HUD; a escolha fica salva.
- **Metralhadora MK I**: hitscan rápido, calor e dispersão crescente.
- **Escopeta Breacher**: 10 projéteis em leque, queda de dano com a distância, empurra e atordoa.
- **Canhão laser Lance**: segure para carregar e solte; feixe perfurante de 140 m, gasta energia, deixa o mecha mais lento enquanto carrega.
- **Mísseis Hornet**: teleguiados (travam no alvo perto da mira), dano em área.
- **Espada de energia**: três etapas de combo e janela curta de defesa contra projéteis durante o golpe.
- **Martelo mecânico**: duas etapas de combo, golpe pesado e onda de choque no solo.
- Pontos críticos na cabeça (×1,5) e números de dano na tela.

**Ritmo de partida**
- Treino em 5 ondas, com o Colosso na última; três dificuldades (Recruta, Veterano, Elite). **Recruta** é a opção padrão para novos jogadores, com inimigos mais leves, dano reduzido e reparos mais generosos.
- Entre ondas, Recruta recupera 40 de vida e Veterano recupera 22; no Recruta, o reparo fora de combate começa mais cedo e recupera vida mais rápido.
- Intervalo entre ondas com bônus, **caixas de suprimento** que caem do céu (modelo `loot_crate`) e reparo fora de combate.
- **Barris explosivos** (modelo `energy_barrel`) com reação em cadeia.
- Combo de abates até ×5, recorde salvo por dificuldade, tela de resultado com estatísticas, reinício rápido.
- HUD com indicador de direção do dano, radar, barras de vida sobre os inimigos, feed de abates, anúncios de onda e cooldowns.

**Movimento e animação**
- Aceleração e frenagem com inércia, controle aéreo, jato para pairar e subir em coberturas, dash direcional, empurrões físicos.
- O Striker inclina no sprint e no strafe, passa a andar de lado, aponta a arma para a mira, tem recuo, soco animado, chamas de jato, pouso com impacto e passos com som. Robôs destruídos se desmontam em peças.
- Espada e martelo têm movimentos distintos, com preparação, golpe e recuperação; o combo muda a direção do corte e o golpe pesado movimenta o tronco. Passos, postura de espera e pousos foram refinados.

**Gráficos e mapa**
- Quatro arenas no lobby: **Frozen Outpost**, **Refinaria**, **Doca Neon** (anel externo e corredores luminosos) e **Fundição do Cânion** (passarelas largas e blocos de minério).
- Escolher outra arena recarrega a página. O mapa selecionado também é enviado ao servidor; salas online exigem o mesmo mapa em todos os clientes.
- As três arenas procedurais usam geometria em código e reutilizam os GLBs incluídos. Pátios de carga, torres, fundações, letreiros e paisagens ao fundo decoram as rotas sem acrescentar coberturas invisíveis.
- Glow, bloom, tone mapping ACES, FXAA, vinheta, tremor de câmera, flashes de luz, faíscas, fumaça, destroços e ondas de choque.
- Três condições do Frozen Outpost: **Dia polar**, **Alvorada glacial** e **Tempestade noturna** (nevasca e aurora boreal), com céu em gradiente e neve em partículas.
- Novas barricadas no anel central, blocos nas pontes e postes de sinalização dão rotas e coberturas ao meio do mapa.

**Celular**
- Controles de toque (joystick flutuante, mira por arrasto, botões de fogo, salto, dash, escudo, soco, arma e pausa), ativados automaticamente em telas de toque ou pelas Configurações.
- Garagem corrigida: no celular o painel vira uma folha na parte de baixo e a câmera enquadra o robô inteiro acima dele; título e botão ficam em uma linha.
- HUD reorganizado em retrato e paisagem.

**Online** (`server/`, `src/net/online.ts`, `src/shared/`)
- **Mata-mata** (até 6 pilotos, 15 abates, 6 min), **Duelo 1v1** (7 abates, 5 min) e **salas privadas** com código de 4 letras.
- Servidor autoritativo em Node + WebSocket: valida posição, velocidade, dano, disparos, habilidades, energia, calor, cooldowns, vida e mortes. A movimentação usa o mesmo código de simulação no cliente e no servidor.
- Predição no cliente com reconciliação, interpolação dos outros pilotos, compensação de latência para acertos, limite de tempo de input contra speed hack, origem de disparo validada, nomes saneados e proteção contra flood.
- Aquecimento enquanto se espera, contagem regressiva, renascimento com proteção, placar (Tab) e resultado com ranking.

## Verificações

- `npm run build`: verifica TypeScript (cliente e servidor) e gera o pacote Vite.
- `npm run smoke`: sobe o próprio servidor Vite + online e roda no Chromium/Edge headless. Preserva as verificações anteriores e acrescenta espada e martelo no treino, hitboxes e penalidades de membros, bot criado pelo servidor, equipes sem fogo amigo, pontuação de Core Control e carregamento visual da refinaria. Inclui tela de celular 390×844, partida online com duas abas e erros de console. Capturas em `artifacts/smoke/`.
- Como o Chromium headless renderiza por software (1–4 FPS), o teste avança a simulação em passos fixos (`debugStep`) e usa mira automática de depuração; esses ganchos só existem no modo dev ou com `?debug` na URL.
- Última execução local: **48 checks passaram**, sem erros de console/página. Inclui lobby em desktop e 390×844, configuração de peças salva, ataques diretos K/L causando dano, Recruta como padrão e início de missões na Doca Neon e Fundição do Cânion. Registro em `artifacts/smoke-latest.log`; capturas em `artifacts/smoke/`.

## Pendências (honestas)

- O online foi testado localmente (abas e clientes na mesma máquina), não pela internet. Hospedar exige rodar `npm start` num servidor público.
- O servidor usa WebSocket próprio, com validação de golpes, energia, cadência, dano, equipes e domínio do núcleo. Bots entram após 2,5 segundos em sala pública com um piloto; salas privadas aguardam o segundo jogador.
- Dano localizado distingue cabeça, tronco, braços e pernas. A perda do braço direito impede disparo, pernas destruídas reduzem a velocidade, e membros destacados se soltam do modelo procedural. A oficina oferece três estilos cosméticos; as seis famílias completas da especificação continuam para uma próxima fase.
- Efeitos de onda de choque usam pool de malhas; partículas e detritos já usam pools ou instâncias.
- O desempenho em GPU real não foi medido neste ambiente.
