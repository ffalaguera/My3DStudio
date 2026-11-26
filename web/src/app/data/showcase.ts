/** Modelos de ejemplo reales, generados con My3DStudio (public/showcase/provenance.json). Los usan la portada y la galería. */
export const SHOWCASE = [
  { slug: 'dragon', name: 'Dragón de miniatura', prompt: 'Un dragón pequeño posado sobre una roca, figura de miniatura para juego de rol de mesa' },
  { slug: 'caballo', name: 'Caballo de ajedrez', prompt: 'La pieza de ajedrez del caballo con armadura medieval, sobre peana redonda' },
  { slug: 'estacion', name: 'Estación de maqueta', prompt: 'Una pequeña estación de tren rural de piedra y madera para maqueta de tren de jardín' },
  { slug: 'buho', name: 'Búho de cerámica', prompt: 'Un búho decorativo de cerámica sentado, con plumas talladas' },
  { slug: 'maceta', name: 'Maceta facetada', prompt: 'Una maceta geométrica facetada con una suculenta dentro' },
] as const;

export type ShowcaseModel = (typeof SHOWCASE)[number];
