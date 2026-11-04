"""Export a source ZIP under 30 MB; original reference PNGs stay in workspace."""
from pathlib import Path
from io import BytesIO
import json, zipfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
families = [
 ('scout','Scout',180,780,620,2400,900,80,12,135,8.2),
 ('striker','Striker',260,1150,950,3600,1250,100,20,120,6.6),
 ('titan','Titan',580,2450,1800,6500,2000,165,36,90,4.5),
 ('phantom','Phantom',210,860,690,2600,1000,85,14,145,7.8),
 ('industrial','Industrial',460,2150,1650,7200,2300,150,32,105,4.8),
 ('spectre','Spectre',290,1080,880,3400,1400,105,18,170,6.8),
 ('vanguard','Vanguard',340,1560,1190,4600,1700,125,27,125,5.9),
 ('ronin','Ronin',300,1240,1020,3800,1450,110,22,130,7.1),
 ('warden','Warden',520,2300,1720,6100,2100,155,35,110,4.9),
 ('tempest','Tempest',250,980,790,3000,1100,95,17,155,8.0),
]
parts=[]
for fid,name,hw,tw,lw,load,torso_load,hp,armor,energy,speed in families:
 for category,weight,support,durability in [('heads',hw,round(hw*.4),hp),('torsos',tw,torso_load,round(hp*2.4)),('legs',lw,load,round(hp*1.9))]:
  png = root/'public/assets/modular'/category/(fid+'.png')
  parts.append({'id':category+'-'+fid,'name':name,'category':category,'image':f'/assets/modular/{category}/{fid}.jpg' if png.exists() else None,'imageStatus':'ready' if png.exists() else 'pending','modelStatus':'pendingTriverse','model':None,'weightKg':weight,'supportCapacityKg':support,'durabilityHp':durability,'armorPercent':armor,'energyCapacity':energy if category=='torsos' else None,'speedMps':speed if category=='legs' else None,'textureSize':1024,'targetFaces':500000})
catalog={'version':1,'balanceStatus':'proposed-not-applied-to-authoritative-simulation','units':{'weightKg':'kg','supportCapacityKg':'kg of attached load; excludes this part own weight','durabilityHp':'HP','armorPercent':'percent','speedMps':'m/s'},'supportMeaning':{'heads':'extra sensors and head-mounted equipment','torsos':'head plus equipped weapons and upper-body equipment','legs':'head, torso, weapons and all carried equipment'},'parts':parts}
(root/'public/assets/modular').mkdir(parents=True,exist_ok=True)
(root/'public/assets/modular/catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
ready=sum(p['imageStatus']=='ready' for p in parts)
note=f'''# ABRA PRIMEIRO — ENTREGA RÁPIDA PARA OPUS

Estado deste ZIP: jogo com lobby, quatro mapas, seis armas, oficina e melhorias gráficas novas. Build TypeScript/Vite passou após as mudanças gráficas. O smoke de 48 checks passou na versão imediatamente anterior aos gráficos; a nova rodada visual ainda precisa de smoke e inspeção. Não confunda os dois resultados.

Referências modulares: {ready}/30 imagens individuais incluídas em JPEG de boa qualidade para manter o ZIP abaixo de 30 MB. PNGs originais foram preservados no PC. Nenhum dos 30 novos GLBs foi gerado ainda. O Triverse está configurado para textura 1K e500.000 faces; a conta mostrava700 créditos e a opção exibida custava35 por geração. Confira saldo e custo atuais antes de enfileirar30. Não compre créditos automaticamente.

As estatísticas de todas as30 peças estão em public/assets/modular/catalog.json: peso, capacidade de sustentação, integridade, blindagem, energia ou velocidade conforme a categoria. São valores de balanceamento propostos; ainda não foram ligados à simulação autoritativa. Estatísticas não estão nas imagens.

Leia docs/PROMPT_CLAUDE_OPUS_5_5.md. Prioridades: (1) rodar install/build/smoke e inspecionar gráficos; (2) completar as13 referências pendentes com os prompts salvos; (3) gerar os30 GLBs no Triverse em1K/500K, registrar cada job e baixar/validar arquivos; (4) criar versões leves de runtime e integrar as peças à oficina; (5) aplicar peso/sustentação/atributos na simulação compartilhada e no servidor; (6) corrigir as inconsistências de dano localizado e resultados por equipe; (7) melhorar bots/Core Control/mapas e testes. Preserve o treino Recruta fácil e os controles J/K/L.

Modelos de500K são fontes de alta resolução. Preserve-os e produza LODs para o jogo, com conectores/escala/origem coerentes. Não carregue as30 fontes simultaneamente. Entregue ZIP de código menor que30 MB e relate apenas testes executados.
'''
(root/'docs/ABRA_PRIMEIRO_OPUS.md').write_text(note,encoding='utf-8')
out=Path('C:/Users/lucca/Downloads/Mecha_Mayhem_Opus_Novo_menor30MB.zip')
top={'src','server','scripts','docs','public'}
files=[p for p in root.rglob('*') if p.is_file() and (p.relative_to(root).parts[0] in top or len(p.relative_to(root).parts)==1) and not any(x in p.relative_to(root).parts for x in ['node_modules','.git','dist','artifacts']) and p.suffix.lower()!='.zip']
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in files:
  rel=p.relative_to(root).as_posix()
  if '/modular/' in rel and p.suffix.lower()=='.png':
   im=Image.open(p).convert('RGB'); buf=BytesIO(); im.save(buf,'JPEG',quality=91,optimize=True); z.writestr(rel[:-4]+'.jpg',buf.getvalue())
  else: z.write(p,rel)
assert out.stat().st_size < 30_000_000, out.stat().st_size
print(json.dumps({'zip':str(out),'bytes':out.stat().st_size,'referenceImages':ready,'newGLBs':0},ensure_ascii=False))
