# Mecha Mayhem — melhorias de jogo para o Opus 5.5

O usuário quer que você melhore o **jogo**, sem depender de Blender. Trabalhe no código Babylon.js/TypeScript e use os modelos e sons já disponíveis ou efeitos criados em código. `MECHA_MAYHEM_MASTER_PROMPT_V3.txt` é a especificação de produto fornecida pelo usuário; implemente melhorias reais em etapas, sem apresentar itens futuros como prontos.

## Comece aqui

1. Execute `npm install`, `npm run build`, `npm run dev` e abra `http://localhost:5173/`.
2. Leia `README.md`, o código em `src/` e as atribuições em `public/assets/sketchfab/ATTRIBUTION.md`.
3. Rode `npm run smoke` e confira as capturas em `artifacts/smoke/`.

## Estado comprovado

- Há um treino solo 3D jogável em Babylon.js/TypeScript/Vite: menu, carregamento, garagem, mapa Frozen Outpost, Striker, câmera, movimento, colisões, arma, drones, HUD e pausa.
- O mapa, o Striker e os objetos Sketchfab já estão no ZIP. O Striker colorido `public/assets/triverse/striker_full_colored.glb` aparece no menu e na garagem. O combate usa um Striker procedural animado.
- Há três drones que se aproximam e disparam, uma metralhadora com calor, dash, escudo, vitória e derrota. Veja `src/game/combat.ts` para os limites atuais.
- O menu e o carregamento estão prontos. O teste em `scripts/smoke.mjs` cobre os fluxos principais. Na garagem móvel, o título cobre parte do robô e o botão quebra em duas linhas.

## Faça estas melhorias, nesta ordem

1. **Combate mais divertido:** melhore a IA dos três drones com patrulha, aproximação, movimento lateral, recuo quando recebem dano e uso de coberturas. Acrescente sinais visuais antes dos tiros, impacto legível e equilíbrio de dano. Preserve o movimento e a colisão atuais.
2. **Mais armas jogáveis:** adicione primeiro escopeta e canhão laser, com alcance, cadência, dano, calor/energia e efeitos realmente diferentes da metralhadora. Permita trocar armas por teclado e na garagem, mostre a arma ativa no HUD e salve a escolha. Use geometria/efeitos Babylon.js existentes ou criados em código; nenhum modelo novo é necessário. Se estas duas armas estiverem completas e testadas, avance para mísseis e armas corpo a corpo da especificação.
3. **Acesso pelo celular:** implemente controles de toque para mover, mirar, disparar, dash, escudo e trocar arma. Corrija a sobreposição do título e a quebra do botão na garagem móvel. Confirme que o menu, a oficina e o treino cabem em 390×844 sem controles sobrepostos.
4. **Ritmo de partida:** acrescente ondas ou níveis de dificuldade, pontuação clara, indicação de dano recebido e uma opção de reinício após vitória/derrota. A partida deve continuar jogável do início ao fim.
5. **Verificação:** execute `npm run build` e `npm run smoke`; atualize o smoke test para as novas armas e para uma interação de toque. Confira capturas desktop/celular e corrija erros de console. Atualize o README com o que foi implementado.

## Critérios de entrega

- O treino continua jogável e cada arma nova tem um comportamento distinto que o jogador consegue perceber.
- Os drones desafiam o jogador sem atravessar coberturas e sem disparar através delas.
- Teclado/mouse e toque funcionam; HUD, menu e garagem são legíveis no desktop e no celular.
- Compilação e smoke test passam; capturas comprovam os resultados. Relate qualquer item ainda pendente com honestidade.

## Mensagem curta para colar no Opus

> Melhore o jogo Mecha Mayhem deste ZIP **somente no código; você não precisa de Blender**. Leia `docs/OPUS_5_5_HANDOFF.md`, execute o projeto e implemente as melhorias na ordem indicada: IA e combate, escopeta e laser, controles móveis, ritmo de partida e testes. Use os GLBs já incluídos. Faça alterações reais, rode `npm run build` e `npm run smoke`, confira desktop/celular e relate apenas funcionalidades verificadas.
