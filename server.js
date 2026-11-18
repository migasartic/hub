// Hub — page d'accueil de tes applis (aucune dépendance externe)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PIN = String(process.env.HUB_PIN || '');
const ADMIN_PASSWORD = String(process.env.HUB_ADMIN_PASSWORD || '');
const SECRET = String(process.env.HUB_SECRET || '');
const PUBLIC_DIR = path.join(__dirname, 'public');
const FILE = path.join(DATA_DIR, 'hub.json');

if (!/^\d{4}$/.test(PIN)) { console.error('⚠️  HUB_PIN doit contenir exactement 4 chiffres.'); process.exit(1); }
if (ADMIN_PASSWORD.length < 8) { console.error('⚠️  HUB_ADMIN_PASSWORD doit faire au moins 8 caractères.'); process.exit(1); }
if (SECRET.length < 16) { console.error('⚠️  HUB_SECRET doit faire au moins 16 caractères (openssl rand -hex 32).'); process.exit(1); }
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Données ----------
const DEFAULT = {
  title: 'Mon NUC', subtitle: 'HUB',
  sections: [{ id: 'apps', name: 'Applications' }, { id: 'maison', name: 'Maison' }, { id: 'admin', name: 'Administration' }],
  tiles: [
    { id: 't1', name: 'Armurerie', url: 'https://armurerie.exemple.ts.net', section: 'apps', private: false, icon: { type: 'emoji', value: '🎯' } },
    { id: 't2', name: 'Home Assistant', url: 'http://100.64.0.1:8123', section: 'maison', private: true, icon: { type: 'emoji', value: '🏠' } },
    { id: 't3', name: 'Coolify', url: 'http://100.64.0.1:8000', section: 'admin', private: true, icon: { type: 'auto' } },
  ],
};
let hub = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : structuredClone(DEFAULT);
function save() {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(hub));
  fs.renameSync(FILE + '.tmp', FILE);
}
if (!fs.existsSync(FILE)) save();

// ---------- Jetons ----------
// Changer HUB_PIN ou HUB_ADMIN_PASSWORD invalide automatiquement les appareils déjà déverrouillés
const fp = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
function sign(kind) {
  const body = Buffer.from(JSON.stringify({ k: kind, f: kind === 'a' ? fp(ADMIN_PASSWORD) : fp(PIN), exp: Date.now() + 30 * 864e5 })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function level(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const [body, mac] = t.split('.');
  if (!body || !mac) return 0;
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return 0;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp < Date.now()) return 0;
    if (p.k === 'a' && p.f === fp(ADMIN_PASSWORD)) return 2;
    if (p.k === 'u' && p.f === fp(PIN)) return 1;
  } catch {}
  return 0;
}
const eq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };

// ---------- Anti force brute (un code à 4 chiffres, ça se devine vite sans ça) ----------
const perIp = new Map();           // ip -> { n, until }
let globalFails = [];              // horodatages des échecs (toutes IP confondues)
function blocked(ip) {
  const now = Date.now();
  globalFails = globalFails.filter(t => t > now - 3600_000);
  if (globalFails.length >= 30) return 'Trop de tentatives, déverrouillage suspendu pendant une heure.';
  const f = perIp.get(ip);
  if (f && f.until > now) return `Trop de tentatives, réessaie dans ${Math.ceil((f.until - now) / 60000)} min.`;
  return null;
}
function failed(ip) {
  globalFails.push(Date.now());
  const f = perIp.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) { f.until = Date.now() + 15 * 60_000 * Math.min(4, f.n - 4); }
  perIp.set(ip, f);
  return Math.max(0, 5 - f.n);
}

// ---------- État des applis ----------
const statusCache = new Map(); // id -> { ok, at }
async function check(tile) {
  const c = statusCache.get(tile.id);
  if (c && c.at > Date.now() - 60_000) return c.ok;
  if (tile.check === 'off') return null;
  const target = tile.check || tile.url;
  let ok = null;
  if (/^https?:\/\//.test(target)) {
    try {
      const r = await fetch(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(4000) });
      ok = r.status < 500;
    } catch { ok = false; }
  }
  statusCache.set(tile.id, { ok, at: Date.now() });
  return ok;
}

// ---------- Validation ----------
const str = (v, max) => String(v ?? '').slice(0, max);
function clean(input) {
  const sections = (Array.isArray(input.sections) ? input.sections : []).slice(0, 30).map(s => ({ id: str(s.id, 40) || crypto.randomUUID(), name: str(s.name, 40) || 'Section' }));
  const ids = new Set(sections.map(s => s.id));
  const tiles = (Array.isArray(input.tiles) ? input.tiles : []).slice(0, 200).map(t => {
    const icon = t.icon || {};
    const type = ['auto', 'emoji', 'image'].includes(icon.type) ? icon.type : 'auto';
    let value = str(icon.value, type === 'image' ? 300_000 : 16);
    if (type === 'image' && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(value)) value = '';
    return {
      id: str(t.id, 40) || crypto.randomUUID(), name: str(t.name, 40) || 'Appli', url: str(t.url, 500), check: str(t.check, 500),
      section: ids.has(t.section) ? t.section : sections[0]?.id, private: !!t.private, color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '',
      icon: { type, value },
    };
  });
  return { title: str(input.title, 40) || 'Hub', subtitle: str(input.subtitle, 40), sections, tiles };
}
function view(lvl) {
  const tiles = hub.tiles.filter(t => lvl > 0 || !t.private);
  const used = new Set(tiles.map(t => t.section));
  return { title: hub.title, subtitle: hub.subtitle, sections: hub.sections.filter(s => lvl === 2 || used.has(s.id)), tiles, unlocked: lvl > 0, admin: lvl === 2 };
}

// ---------- HTTP ----------
function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function body(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const P = url.pathname, M = req.method;
  try {
    if (P === '/api/hub' && M === 'GET') return send(res, 200, view(level(req)));
    if (P === '/api/status' && M === 'GET') {
      const lvl = level(req);
      const tiles = hub.tiles.filter(t => lvl > 0 || !t.private);
      const out = {};
      await Promise.all(tiles.map(async t => { out[t.id] = await check(t); }));
      return send(res, 200, out);
    }
    if (P === '/api/unlock' && M === 'POST') {
      const b = blocked(ip); if (b) return send(res, 429, { error: b });
      const { pin } = await body(req, 1000);
      if (!eq(pin, PIN)) { const left = failed(ip); return send(res, 401, { error: left ? `Code incorrect (${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''})` : 'Code incorrect, bloqué 15 min.' }); }
      perIp.delete(ip);
      return send(res, 200, { token: sign('u'), ...view(1) });
    }
    if (P === '/api/admin' && M === 'POST') {
      const b = blocked(ip); if (b) return send(res, 429, { error: b });
      const { password } = await body(req, 1000);
      if (!eq(password, ADMIN_PASSWORD)) { failed(ip); return send(res, 401, { error: 'Mot de passe incorrect' }); }
      perIp.delete(ip);
      return send(res, 200, { token: sign('a'), ...view(2) });
    }
    if (P === '/api/hub' && M === 'PUT') {
      if (level(req) !== 2) return send(res, 403, { error: 'Modification réservée à l\'administrateur' });
      hub = clean(await body(req));
      statusCache.clear();
      save();
      return send(res, 200, view(2));
    }
    if (P.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    let file = path.join(PUBLIC_DIR, path.normalize(decodeURIComponent(P)));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 400, { error: 'Requête invalide' });
  }
}).listen(PORT, () => console.log(`Hub prêt sur http://localhost:${PORT}`));
