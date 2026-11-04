# Mecha Mayhem — Fase 2

Jogo 3D de batalha de robôs no navegador, feito com **Babylon.js**, **TypeScript**, **Vite** e **Havok Physics**, agora com **modo online** em servidor autoritativo. O mapa Frozen Outpost foi modelado no Blender; cinco objetos de ambiente vieram do Sketchfab (atribuição no menu e em [`public/assets/sketchfab/ATTRIBUTION.md`](public/assets/sketchfab/ATTRIBUTION.md)).

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
| Clique esquerdo (segure e solte no laser) | FOGO | Atirar |
| Shift | Joystick empurrado até o fim | Correr |
| Espaço (segure no ar = jato) | SALTO | Saltar / pairar |
| Q | DASH | Turbo dash na direção do movimento (reduz dano) |
| E | ESCUDO | Escudo de energia (absorve 75%) |
| F | SOCO | Impacto corpo a corpo com empurrão |
| 1-4, roda do mouse, R | ARMA | Trocar arma |
| Tab | — | Placar online |
| Esc | II | Pausar |

## O que há de novo

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
- Pontos críticos na cabeça (×1,5) e números de dano na tela.

**Ritmo de partida**
- Treino em 5 ondas, com o Colosso na última; três dificuldades (Recruta, Veterano, Elite).
- Intervalo entre ondas com bônus, **caixas de suprimento** que caem do céu (modelo `loot_crate`) e reparo fora de combate.
- **Barris explosivos** (modelo `energy_barrel`) com reação em cadeia.
- Combo de abates até ×5, recorde salvo por dificuldade, tela de resultado com estatísticas, reinício rápido.
- HUD com indicador de direção do dano, radar, barras de vida sobre os inimigos, feed de abates, anúncios de onda e cooldowns.

**Movimento e animação**
- Aceleração e frenagem com inércia, controle aéreo, jato para pairar e subir em coberturas, dash direcional, empurrões físicos.
- O Striker inclina no sprint e no strafe, passa a andar de lado, aponta a arma para a mira, tem recuo, soco animado, chamas de jato, pouso com impacto e passos com som. Robôs destruídos se desmontam em peças.

**Gráficos e mapa**
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

- `npm run build`: TypeScript (cliente e servidor) e Vite concluídos.
- `npm run smoke`: sobe o próprio servidor Vite + online e roda no Chromium/Edge headless. Cobre menu, climas, dificuldade, garagem (cor e arma salva), configurações, créditos, movimento, dash, escudo, jato, as 4 armas trocadas pelo teclado causando dano, abates, pausa, as 5 ondas até o Colosso e a vitória, reinício; no celular (390×844): menu cabendo na tela, garagem com o robô visível e título/botão em uma linha, controles de toque sem sobreposição com o HUD, joystick, botões ARMA, DASH e FOGO; e uma partida online com duas abas em sala privada com dano validado pelo servidor. Também falha se houver erro de console. Capturas em `artifacts/smoke/`.
- Como o Chromium headless renderiza por software (1–4 FPS), o teste avança a simulação em passos fixos (`debugStep`) e usa mira automática de depuração; esses ganchos só existem no modo dev ou com `?debug` na URL.

## Pendências (honestas)

- O online foi testado localmente (abas e clientes na mesma máquina), não pela internet. Hospedar exige rodar `npm start` num servidor público.
- O servidor usa WebSocket próprio em vez de Colyseus; segue o mesmo modelo autoritativo. Times 5v5, Core Control e bots no online ainda não existem.
- Espada de energia e martelo mecânico da especificação não foram feitos; o corpo a corpo é a habilidade Impacto.
- Dano localizado e destruição parcial durante a luta ainda não existem (só a desmontagem ao morrer). As seis famílias modulares continuam para uma próxima fase.
- O desempenho em GPU real não foi medido neste ambiente.
