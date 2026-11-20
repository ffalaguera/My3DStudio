// Comentarios de Hacker News (API oficial de Algolia) que opinan sobre Tripo como producto.
const ids = [40818016, 43492179, 43501797, 47158255, 49561336, 49897498];
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const rows = [];
for (const id of ids) {
  const h = await (await fetch(`https://hn.algolia.com/api/v1/items/${id}`)).json();
  const t = h.text.replace(/<p>/g, ' ').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  rows.push(['hacker-news', `https://news.ycombinator.com/item?id=${id}`, h.created_at.slice(0, 10), '', t].map(q).join(','));
}
process.stdout.write(rows.join('\n') + '\n');
