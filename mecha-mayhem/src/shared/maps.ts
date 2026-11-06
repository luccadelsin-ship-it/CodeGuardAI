/** Map selection is shared by the lobby, renderer and authoritative server. */
export type MapId = 'frozen' | 'refinery' | 'neon' | 'canyon' | 'scrapyard';

export const MAPS: Record<MapId, { name: string; label: string; detail: string; layoutFile: string; color: string }> = {
  frozen: { name: 'Frozen Outpost', label: 'FROZEN OUTPOST', detail: 'Base polar · arena clássica e pontes estreitas', layoutFile: 'frozen_outpost.layout.json', color: '#70d8ff' },
  refinery: { name: 'Refinaria', label: 'REFINARIA', detail: 'Plataformas industriais · cobertura e rotas de flanco', layoutFile: 'refinery.layout.json', color: '#ff9a4b' },
  neon: { name: 'Doca Neon', label: 'DOCA NEON', detail: 'Porto noturno · anel externo e corredores luminosos', layoutFile: 'neon.layout.json', color: '#fa74ff' },
  canyon: { name: 'Fundição do Cânion', label: 'FUNDIÇÃO DO CÂNION', detail: 'Deserto industrial · passarelas amplas e blocos de minério', layoutFile: 'canyon.layout.json', color: '#efc47c' },
  scrapyard: { name: 'Ferro-Velho Titã', label: 'FERRO-VELHO TITÃ', detail: 'Pátio de sucata · torres com escada, guindaste e reator central', layoutFile: 'scrapyard.layout.json', color: '#f0a43c' },
};

export const MAP_ORDER: MapId[] = ['frozen', 'refinery', 'neon', 'canyon', 'scrapyard'];

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && Object.hasOwn(MAPS, value);
}

export function mapFromSearch(search: string): MapId {
  const value = new URLSearchParams(search).get('map');
  return isMapId(value) ? value : 'frozen';
}
