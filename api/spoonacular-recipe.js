export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  const key = process.env.SPOONACULAR_API_KEY;
  if (!key) return res.status(500).json({ error: 'SPOONACULAR_API_KEY not configured' });

  try {
    const r = await fetch(`https://api.spoonacular.com/recipes/${id}/information?apiKey=${key}&includeNutrition=false`);
    const d = await r.json();
    if (d.status === 'failure') throw new Error(d.message);

    // Formater les ingrédients en liste française
    const ingredients = (d.extendedIngredients || [])
      .map(ing => {
        const qty = ing.measures?.metric?.amount
          ? `${Math.round(ing.measures.metric.amount * 10) / 10}${ing.measures.metric.unitShort || ''}`
          : ing.amount ? `${ing.amount} ${ing.unit}`.trim() : '';
        return qty ? `${qty} ${ing.nameClean || ing.name}` : (ing.nameClean || ing.name);
      })
      .join('\n');

    // Formater les instructions
    const instructions = d.analyzedInstructions?.[0]?.steps
      ? d.analyzedInstructions[0].steps
          .map((s, i) => `${i + 1}. ${s.step}`)
          .join('\n')
      : (d.instructions || '').replace(/<[^>]+>/g, '').trim();

    const categorie = d.dishTypes?.includes('dessert') ? 'Dessert'
                    : d.dishTypes?.includes('lunch') || d.dishTypes?.includes('salad') ? 'Déjeuner'
                    : 'Dîner';

    return res.status(200).json({
      nom: d.title,
      categorie,
      temps: d.readyInMinutes || 30,
      portions: d.servings || 4,
      ingredients,
      instructions,
      note: '***',
      source: d.sourceUrl || '',
      photo: d.image || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
