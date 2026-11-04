# Mecha Mayhem — Fase 1

Jogo 3D de treino solo no navegador, feito com **Babylon.js**, **TypeScript**, **Vite** e **Havok Physics**. O mapa Frozen Outpost foi modelado no Blender e exportado para GLB. Cinco objetos de ambiente vieram do Sketchfab e foram ajustados no Blender; a atribuição está no menu e em [`public/assets/sketchfab/ATTRIBUTION.md`](public/assets/sketchfab/ATTRIBUTION.md).

## Executar

```powershell
npm install
npm run dev
```

Abra `http://localhost:5173/`. Para verificar a compilação de produção:

```powershell
npm run build
npm run preview
```

`npm run smoke` faz um teste no Microsoft Edge instalado em `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`. Ele passa pelo menu, oficina, configurações, créditos, treino, disparos e pausa; grava capturas em `artifacts/smoke/`.

## Controles

| Tecla | Ação |
| --- | --- |
| W A S D | Movimento |
| Mouse | Mira e câmera em terceira pessoa |
| Clique esquerdo | Metralhadora |
| Shift | Correr |
| Espaço | Saltar |
| Q | Turbo Dash |
| E | Energy Shield |
| Esc | Pausar / liberar o mouse |

Na oficina, arraste para girar o Striker e use a roda do mouse para aproximar. As quatro cores de blindagem e as configurações ficam salvas no navegador.

## O que está implementado

- Menu principal, carregamento com progresso por etapa, oficina de cores, configurações, créditos, HUD, pausa e resultado.
- Mapa Frozen Outpost com plataforma central, quatro acessos, torres, coberturas e colisores Havok estáticos. O movimento do personagem usa limites e colisão cinemática para impedir quedas e atravessar coberturas.
- Striker de geometria 3D real, animação de caminhada, câmera em terceira pessoa, movimento, corrida, salto e dash.
- Treino solo com três drones, metralhadora com mira por raio, calor, dano, eliminação, pontuação, energia, escudo, vitória e derrota.
- Cinco modelos Sketchfab CC BY 4.0 carregados como objetos de ambiente. Fontes e modificações em [`manifest.json`](public/assets/sketchfab/manifest.json).
- Recortes de 30 partes da imagem de referência (cabeças, torsos com braços, pernas, armas e robôs completos), com manifesto e arquivos prontos para upload em [`assets/reference`](assets/reference).
- Um Striker modular foi modelado no Blender: [`striker_full.glb`](public/assets/models/striker/striker_full.glb), GLBs separados de cabeça, torso e braços integrados, pernas e arma, além do [`striker.blend`](assets/blender/striker.blend). O GLB completo aparece no menu e na oficina com troca de cor; a versão de combate usa geometria Babylon.js articulada. Os GLBs de peças são fontes para a próxima integração modular.

## Verificações realizadas

- `npm run build`: TypeScript e Vite concluídos.
- `npm run smoke`: fluxo de desktop e viewport móvel, início de combate, eliminação de um drone (objetivo 1/3 e pontuação), e pausa, sem erros de console. Capturas em `artifacts/smoke/`.
- GLB do mapa reimportado e inspecionado no Blender. Cinco GLBs do Sketchfab renderizados e inspecionados no Blender.

## Triverse e próximas fases

Foi gerado no Triverse um Striker a partir do recorte `assets/reference/triverse-input/full_robots/striker.png`. O GLB original sem textura está em `assets/triverse/striker_untextured_original.glb`; a versão colorida ajustada localmente está em `public/assets/triverse/striker_full_colored.glb` e é usada no menu e na garagem. A textura nativa criada na conta Triverse ainda não foi exportada. O [briefing para Opus 5.5](docs/OPUS_5_5_HANDOFF.md) prioriza melhorar o jogo em código, sem precisar de Blender. O pipeline alternativo por API está documentado em [`scripts/TRIVERSE.md`](scripts/TRIVERSE.md).

Também ficam para desenvolvimento posterior as seis famílias modulares (216 combinações), outras cinco armas, dano localizado e destruição parcial, mapas e modos adicionais, e servidor Colyseus 1v1/5v5. Esta entrega é o treino jogável inicial da Fase 1, não o jogo completo descrito no prompt mestre.
