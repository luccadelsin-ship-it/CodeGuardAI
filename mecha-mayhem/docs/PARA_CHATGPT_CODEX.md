# PARA CHATGPT/CODEX — gerar as 13 imagens de referência

**Problema:** faltam 13 das 30 referências modulares. Na oficina elas aparecem como "REF. PENDENTE".

**Gerar (sem texto, estatísticas ou logos nas imagens, fundo cinza-claro liso, quadrado):**
- Cabeças: vanguard, ronin, warden, tempest → `public/assets/modular/heads/<id>.jpg`
- Tronco + braços: vanguard, ronin, warden, tempest → `public/assets/modular/torsos/<id>.jpg`
- Pernas: spectre, vanguard, ronin, warden, tempest → `public/assets/modular/legs/<id>.jpg`

Os prompts prontos, na mesma ordem, estão em `docs/PENDING_REFERENCE_PROMPTS.json`. Siga o estilo das 17 imagens que já existem.

**Integração (sem mexer no código):**
1. Salve como JPEG (~1024 px, qualidade ~85) com o nome exato acima.
2. Em `public/assets/modular/catalog.json`, troque `"imageStatus": "pending"` por `"ready"` nas 13 peças. O caminho em `image` já está certo.
3. Opcional: marque `status: "generated"` em `legs/manifest.json` e mova os ids de `pending` para `completed` em `torsos/prompts.manifest.json`.

**Resultado esperado:** a oficina mostra as 30 imagens; `npm run build` e `npm run smoke` continuam passando (63 checks); o ZIP final fica abaixo de 30 MB.

Os 30 GLBs do Triverse continuam bloqueados por falta de chave/conta; o plano está em `docs/TRIVERSE_30_PARTS_PLAN.json`.
