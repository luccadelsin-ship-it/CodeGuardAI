/** Story mode: five chapters across the four arenas, unlocked in order. */
import type { EnemyType } from './drones';
import type { MapId } from '../shared/maps';
import type { ThemeId } from './world';

export interface StoryChapter {
  id: number;
  title: string;
  subtitle: string;
  map: MapId;
  theme: ThemeId;
  briefing: string[];
  debrief: string;
  waves: Array<{ title: string; subtitle: string; spawns: EnemyType[] }>;
  rewardCredits: number;
}

export const STORY: StoryChapter[] = [
  {
    id: 1, title: 'CAPÍTULO 1', subtitle: 'DESPERTAR', map: 'frozen', theme: 'day', rewardCredits: 150,
    briefing: [
      'COMANDANTE ILSA: Piloto, o posto avançado Frozen perdeu contato com a base.',
      'Drones da Corporação Vértice tomaram as pontes. Limpe a área e reative o farol.',
      'Use a cobertura das barricadas. Ninguém espera que você vença sozinho... prove o contrário.',
    ],
    debrief: 'O farol voltou a piscar. Os registros mostram rotas de carga indo para a Refinaria.',
    waves: [
      { title: 'CONTATO', subtitle: 'PATRULHA DA VÉRTICE', spawns: ['sentinel', 'sentinel'] },
      { title: 'REFORÇOS', subtitle: 'ELES VIRAM VOCÊ', spawns: ['sentinel', 'wasp', 'sentinel'] },
    ],
  },
  {
    id: 2, title: 'CAPÍTULO 2', subtitle: 'FUMAÇA NA REFINARIA', map: 'refinery', theme: 'dusk', rewardCredits: 200,
    briefing: [
      'COMANDANTE ILSA: A Vértice está enchendo tanques com combustível de mecha.',
      'Eles trouxeram MORTEIROS. Quando aparecer um círculo vermelho no chão, saia dele!',
      'Os barris explodem: use-os contra eles.',
    ],
    debrief: 'Tanques destruídos. Um sinal criptografado vem da Doca Neon.',
    waves: [
      { title: 'PERÍMETRO', subtitle: 'ARTILHARIA À VISTA', spawns: ['sentinel', 'mortar'] },
      { title: 'LINHA DE TANQUES', subtitle: 'O ROMPEDOR AVANÇA', spawns: ['brute', 'sentinel', 'wasp'] },
      { title: 'BOMBARDEIO', subtitle: 'DOIS MORTEIROS', spawns: ['mortar', 'mortar', 'sentinel'] },
    ],
  },
  {
    id: 3, title: 'CAPÍTULO 3', subtitle: 'NEON PROIBIDO', map: 'neon', theme: 'storm', rewardCredits: 250,
    briefing: [
      'COMANDANTE ILSA: A Doca Neon é o porto de contrabando da Vértice.',
      'Cuidado com o BASTIÃO: o escudo da frente bloqueia seus tiros. Flanqueie ou ataque quando ele atirar.',
      'Drones REPARADORES (cruz verde) consertam os outros. Derrube-os primeiro.',
    ],
    debrief: 'Os contêineres levavam peças de um robô gigante. O destino: a Fundição do Cânion.',
    waves: [
      { title: 'DOCA 7', subtitle: 'ENXAME COM SUPORTE', spawns: ['wasp', 'wasp', 'medic'] },
      { title: 'ESCOLTA', subtitle: 'MURALHA DE ESCUDOS', spawns: ['bulwark', 'sentinel', 'medic'] },
      { title: 'FUGA DO CARGUEIRO', subtitle: 'ATIRADORES NO TELHADO', spawns: ['sniper', 'bulwark', 'wasp', 'wasp'] },
    ],
  },
  {
    id: 4, title: 'CAPÍTULO 4', subtitle: 'FORNALHA', map: 'canyon', theme: 'day', rewardCredits: 300,
    briefing: [
      'COMANDANTE ILSA: A Fundição está montando o COLOSSO. Precisamos atrasar a linha de produção.',
      'Os blocos de minério servem de degraus: use a altura a seu favor.',
      'Vai ser a batalha mais dura até agora. Repare entre as ondas.',
    ],
    debrief: 'A fundição está em chamas, mas o Colosso já foi enviado... de volta ao Frozen Outpost.',
    waves: [
      { title: 'PORTÕES', subtitle: 'DOIS ROMPEDORES', spawns: ['brute', 'brute'] },
      { title: 'LINHA DE MONTAGEM', subtitle: 'DEFESA COMPLETA', spawns: ['mortar', 'bulwark', 'medic', 'sentinel'] },
      { title: 'FORNO CENTRAL', subtitle: 'ÚLTIMA RESISTÊNCIA', spawns: ['sniper', 'sniper', 'brute', 'wasp'] },
    ],
  },
  {
    id: 5, title: 'CAPÍTULO 5', subtitle: 'O COLOSSO DESPERTA', map: 'frozen', theme: 'storm', rewardCredits: 500,
    briefing: [
      'COMANDANTE ILSA: O Colosso chegou ao posto onde tudo começou, no meio da tempestade.',
      'Pule a onda de choque, cuide dos mísseis e derrube os reparadores que o protegem.',
      'Boa sorte, piloto. O Frozen Outpost conta com você.',
    ],
    debrief: 'O Colosso caiu. A Vértice recuou do setor ártico. Você é uma lenda, piloto.',
    waves: [
      { title: 'VANGUARDA', subtitle: 'A ESCOLTA DO GIGANTE', spawns: ['bulwark', 'mortar', 'medic', 'sentinel'] },
      { title: 'BATALHA FINAL', subtitle: 'O COLOSSO', spawns: ['boss', 'medic', 'wasp'] },
    ],
  },
];

const KEY = 'mecha-mayhem:story';

export function storyProgress(): number {
  try { return Math.max(0, Math.min(STORY.length, Number(localStorage.getItem(KEY) ?? '0') || 0)); } catch { return 0; }
}

export function completeChapter(id: number): boolean {
  const done = storyProgress();
  if (id <= done) return false;
  try { localStorage.setItem(KEY, String(Math.max(done, id))); } catch { /* private mode */ }
  return true;
}

export function chapterFromSearch(search: string): StoryChapter | null {
  const n = Number(new URLSearchParams(search).get('story'));
  return STORY.find((c) => c.id === n) ?? null;
}
