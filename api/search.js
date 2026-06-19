export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) return res.status(500).json({ error: 'Google Search not configured' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10&lr=lang_fr`;
    const response = await fetch(url);
    const data = await response.json();

    const results = (data.items || []).map(item => ({
      titre: item.title,
      url: item.link,
      description: item.snippet,
      source: item.displayLink,
    }));

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
