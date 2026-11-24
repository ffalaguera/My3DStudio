/** Color de tapa de cada producto: el mismo en la portada y en /precios (identidad fija, no por posición). */
export type Lid = 'red' | 'mustard' | 'blue' | 'green';

const LIDS: Record<string, Lid> = {
  free: 'red',
  pack_150: 'red',
  pack_800: 'mustard',
  pro: 'blue',
  pack_2600: 'blue',
  max: 'green',
  pack_9000: 'green',
};

export const lidOf = (id: string): Lid => LIDS[id] ?? 'mustard';
