/**
 * Forla — relais de synchronisation (Cloudflare Worker + D1).
 *
 * Le relais ne voit JAMAIS les données en clair : chaque appareil chiffre ses
 * enregistrements (AES-256-GCM) avec une clé issue du code d'invitation, et les
 * identifie par une empreinte HMAC opaque. Le serveur ne stocke que :
 *   h  identifiant opaque du foyer          k  empreinte opaque de l'enregistrement
 *   u  horodatage de modification (LWW)     p  contenu chiffré
 * L'accès à un foyer exige un jeton dont seul le hachage SHA-256 est conservé.
 */

const PULL_LIMIT = 200;
const PUSH_LIMIT = 40; // reste sous la limite de 50 requêtes D1 par appel (offre gratuite)
const MAX_PAYLOAD = 64 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparaison à temps constant de deux chaînes hexadécimales. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'forla-sync', version: 1 });
    if (request.method !== 'POST' || (url.pathname !== '/v1/pull' && url.pathname !== '/v1/push')) return json({ error: 'not_found' }, 404);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad_json' }, 400);
    }
    const { h, t } = body ?? {};
    if (!ID_RE.test(h ?? '') || !ID_RE.test(t ?? '')) return json({ error: 'bad_credentials' }, 400);

    const tokenHash = await sha256Hex(t);
    const household = await env.DB.prepare('SELECT token_hash FROM households WHERE id = ?').bind(h).first();
    if (household && !safeEqual(household.token_hash, tokenHash)) return json({ error: 'forbidden' }, 403);

    /* ----------------------------- PULL ----------------------------- */
    if (url.pathname === '/v1/pull') {
      const since = Number.isSafeInteger(body.since) && body.since > 0 ? body.since : 0;
      if (!household) return json({ items: [], more: false });
      const { results } = await env.DB.prepare('SELECT seq AS s, k, u, p FROM changes WHERE h = ? AND seq > ? ORDER BY seq LIMIT ?')
        .bind(h, since, PULL_LIMIT + 1)
        .all();
      const more = results.length > PULL_LIMIT;
      return json({ items: more ? results.slice(0, PULL_LIMIT) : results, more });
    }

    /* ----------------------------- PUSH ----------------------------- */
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > PUSH_LIMIT) return json({ error: 'bad_items' }, 400);
    for (const it of items) {
      if (!it || !ID_RE.test(it.k ?? '') || !Number.isSafeInteger(it.u) || it.u < 0 || typeof it.p !== 'string' || it.p.length > MAX_PAYLOAD) {
        return json({ error: 'bad_item' }, 400);
      }
    }
    if (!household) {
      // Premier envoi : création du foyer (l'identifiant est un secret aléatoire de 128 bits).
      await env.DB.prepare('INSERT OR IGNORE INTO households (id, token_hash, created_at) VALUES (?, ?, ?)').bind(h, tokenHash, Date.now()).run();
      const check = await env.DB.prepare('SELECT token_hash FROM households WHERE id = ?').bind(h).first();
      if (!check || !safeEqual(check.token_hash, tokenHash)) return json({ error: 'forbidden' }, 403);
    }
    // "Dernière écriture gagne" : on n'écrase une version que par une version plus récente.
    // Chaque écriture reçoit un nouveau numéro de séquence pour être récupérée par les autres appareils.
    const stmt = env.DB.prepare(
      `INSERT INTO changes (h, k, u, p, seq) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes))
       ON CONFLICT (h, k) DO UPDATE SET u = excluded.u, p = excluded.p, seq = excluded.seq WHERE excluded.u > changes.u`,
    );
    const results = await env.DB.batch(items.map((it) => stmt.bind(h, it.k, it.u, it.p)));
    const rejected = [];
    results.forEach((r, i) => {
      if (!r.meta?.changes) rejected.push(items[i].k);
    });
    return json({ accepted: items.length - rejected.length, rejected });
  },
};
