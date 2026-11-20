// Fuente oficial de Apple (RSS de reseñas), páginas 1-10 de US y GB.
const rows = [];
for (const cc of ['us', 'gb']) for (let p = 1; p <= 10; p++) {
  const r = await fetch(`https://itunes.apple.com/${cc}/rss/customerreviews/page=${p}/id=6748596826/sortBy=mostRecent/json`);
  if (!r.ok) break;
  const e = (await r.json()).feed?.entry; if (!e?.length) break;
  for (const x of e) if (x['im:rating']) rows.push({ source: 'app-store', url: `https://apps.apple.com/${cc}/app/id6748596826?see-all=reviews#${x.id.label}`, date: x.updated.label.slice(0, 10), rating: x['im:rating'].label, text: `${x.title.label}. ${x.content.label}` });
}
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
process.stdout.write('source,url,date,rating,text\n' + rows.map(r => [r.source, r.url, r.date, r.rating, r.text].map(q).join(',')).join('\n') + '\n');
console.error('filas', rows.length, 'por estrellas', JSON.stringify(rows.reduce((a, r) => (a[r.rating] = (a[r.rating] || 0) + 1, a), {})));
