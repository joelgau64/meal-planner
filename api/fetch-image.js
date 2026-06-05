export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
    });
    const html = await response.text();
    
    // Extract og:image
    const match = html.match(/<meta[^>]+(?:property|name)="og:image"[^>]+content="([^"]+)"/i)
      || html.match(/<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:image"/i);
    
    if (match) {
      return res.status(200).json({ imageUrl: match[1] });
    }
    return res.status(200).json({ imageUrl: null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
