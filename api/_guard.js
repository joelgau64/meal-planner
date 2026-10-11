// Garde commune des routes /api/* (fichier préfixé "_" → pas exposé comme route par Vercel).
// - Plus de CORS "*" : seul le front servi par ce même domaine peut appeler les routes depuis un navigateur.
// - Si la variable d'env APP_TOKEN est définie sur Vercel, chaque appel doit porter le header
//   x-app-token correspondant (le front le stocke en localStorage, saisi une fois par appareil).
//   Si APP_TOKEN n'est pas défini, la garde laisse passer → déploiement sans casse.
export function guard(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  const expected = process.env.APP_TOKEN;
  if (expected && req.headers['x-app-token'] !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
