# ABRA PRIMEIRO — ENTREGA RÁPIDA PARA OPUS

Estado deste ZIP: jogo com lobby, quatro mapas, seis armas, oficina e melhorias gráficas novas. Build TypeScript/Vite passou após as mudanças gráficas. O smoke de 48 checks passou na versão imediatamente anterior aos gráficos; a nova rodada visual ainda precisa de smoke e inspeção. Não confunda os dois resultados.

Referências modulares: 17/30 imagens individuais incluídas em JPEG de boa qualidade para manter o ZIP abaixo de 30 MB. PNGs originais foram preservados no PC. Nenhum dos 30 novos GLBs foi gerado ainda. O Triverse está configurado para textura 1K e500.000 faces; a conta mostrava700 créditos e a opção exibida custava35 por geração. Confira saldo e custo atuais antes de enfileirar30. Não compre créditos automaticamente.

As estatísticas de todas as30 peças estão em public/assets/modular/catalog.json: peso, capacidade de sustentação, integridade, blindagem, energia ou velocidade conforme a categoria. São valores de balanceamento propostos; ainda não foram ligados à simulação autoritativa. Estatísticas não estão nas imagens.

Leia docs/PROMPT_CLAUDE_OPUS_5_5.md. Prioridades: (1) rodar install/build/smoke e inspecionar gráficos; (2) completar as13 referências pendentes com os prompts salvos; (3) gerar os30 GLBs no Triverse em1K/500K, registrar cada job e baixar/validar arquivos; (4) criar versões leves de runtime e integrar as peças à oficina; (5) aplicar peso/sustentação/atributos na simulação compartilhada e no servidor; (6) corrigir as inconsistências de dano localizado e resultados por equipe; (7) melhorar bots/Core Control/mapas e testes. Preserve o treino Recruta fácil e os controles J/K/L.

Modelos de500K são fontes de alta resolução. Preserve-os e produza LODs para o jogo, com conectores/escala/origem coerentes. Não carregue as30 fontes simultaneamente. Entregue ZIP de código menor que30 MB e relate apenas testes executados.
