# Ferro-Velho Tita — cena detalhada do Blender

Abra `Ferro_Velho_Tita_Detalhado.blend` no Blender 5.1. O projeto tem uma camera geral e uma camera proxima da sucata principal. As imagens `preview_detalhado.png` e `vista_imersiva.png` sao renderizacoes da propria geometria.

## Elementos

- Carcaca de robo com reator, pistoes, cabos, capacete e mao desmontada.
- Conteineres corrugados com portas, travas, dobradicas e tinta lascada.
- Torres octogonais com trelicas, escadas continuas e corrimaos.
- Guindaste trelicado com cabine, roldana, cabo e garra.
- Tanques, tubulacoes, bobinas, pneus, engrenagens e chapas irregulares.
- Concreto com juntas e fissuras, oleo, terra, cascalho e ervas nas bordas.
- Bases de equipe e plataforma circular do objetivo com balizas luminosas.

## Fisica

A pasta `fisica_do_jogo` contem os volumes simples em JSON, instrucoes de eixos e o resultado da verificacao. A colecao `09_COLISORES` fica oculta no Blender e pode ser ativada no Outliner para revisao. Os identificadores dos volumes sao unicos.

Esta cena ainda nao foi integrada ao cliente, servidor, navegacao ou simulacao do jogo. As colisoes sao uma base de autoria conservadora e precisam de playtest antes da integracao.

## Materiais e exportacao

O desgaste usa materiais procedurais do Blender. Para exportar ao navegador mantendo essa aparencia, e necessario assar as texturas, otimizar a geometria e validar o GLB no motor. O arquivo `.blend` preserva os materiais editaveis completos.

## Recriar

Execute `scripts/create_scrapyard_detailed.py` com o Blender. Ele importa `scrapyard_props.py` e `finalize_scrapyard.py`, salva o projeto, verifica os volumes e renderiza as duas cameras. A versao anterior permanece em `maps/ferro_velho_tita`.
