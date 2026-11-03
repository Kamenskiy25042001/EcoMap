// Cloudflare Worker: принимает заявку с сайта и сохраняет её в GitHub-репозиторий.
// Токен хранится ТОЛЬКО здесь (секрет GITHUB_TOKEN), в код сайта он не попадает.
// Переменные: GITHUB_TOKEN (secret), REPO ("логин/репозиторий"), BRANCH ("main"), ALLOWED_ORIGIN ("https://логин.github.io")
const CATS = ['dump', 'air', 'water', 'waste', 'other'];
const BB = { w: 84.05, e: 84.55, s: 49.58, n: 49.88 };
const DATA = 'data/reports.json';
const hits = new Map(); // простой лимит на IP (в пределах одного экземпляра Worker)

const json = (o, status, h) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...h } });
const b64e = s => { const u = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < u.length; i += 8192) t += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(t); };
const b64d = s => { const t = atob(s.replace(/\s/g, '')), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return new TextDecoder().decode(u); };

async function gh(env, method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}/contents/${path}${method === 'GET' ? '?ref=' + (env.BRANCH || 'main') : ''}`, {
    method, headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'eco-map-worker', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ ...body, branch: env.BRANCH || 'main' }) : undefined });
  return r;
}
const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });

async function save(env, rep, photoB64) {
  if (photoB64) {
    const r = await gh(env, 'PUT', `data/photos/${rep.id}.jpg`, { message: `Фото заявки ${rep.id}`, content: photoB64 });
    if (!r.ok) throw bad('Не удалось сохранить фото', 502);
    rep.photo = `data/photos/${rep.id}.jpg`;
  }
  for (let attempt = 0; attempt < 4; attempt++) {                  // повтор при одновременной записи
    const g = await gh(env, 'GET', DATA); let list = [], sha;
    if (g.ok) { const f = await g.json(); sha = f.sha; list = JSON.parse(b64d(f.content)); } else if (g.status !== 404) throw bad('Репозиторий недоступен', 502);
    if (list.length >= 3000) throw bad('Слишком много заявок', 507);
    list.push(rep);
    const p = await gh(env, 'PUT', DATA, { message: `Новая заявка ${rep.id}`, content: b64e(JSON.stringify(list, null, 1)), ...(sha ? { sha } : {}) });
    if (p.ok) return;
    if (p.status !== 409 && p.status !== 422) throw bad('Не удалось сохранить заявку', 502);
  }
  throw bad('Сервер занят, повторите', 503);
}

export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (req.method !== 'POST') throw bad('Только POST', 405);
      if (env.ALLOWED_ORIGIN && req.headers.get('Origin') !== env.ALLOWED_ORIGIN) throw bad('Запрещено', 403);
      if (!env.GITHUB_TOKEN || !env.REPO) throw bad('Сервис не настроен', 500);
      const ip = req.headers.get('CF-Connecting-IP') || 'x', now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
      if (h.length >= 10) throw bad('Слишком много заявок, попробуйте позже', 429);
      const raw = await req.text(); if (raw.length > 900000) throw bad('Слишком большой запрос', 413);
      let b; try { b = JSON.parse(raw); } catch (e) { throw bad('Некорректный JSON'); }
      const address = String(b.address || '').trim(), description = String(b.description || '').trim();
      if (!CATS.includes(b.category)) throw bad('Выберите тип нарушения');
      if (address.length < 3 || address.length > 200) throw bad('Введите адрес');
      if (description.length < 3 || description.length > 1500) throw bad('Опишите проблему');
      let lat = null, lng = null;
      if (b.lat != null && b.lng != null) { lat = +b.lat; lng = +b.lng; if (!(lng > BB.w - .5 && lng < BB.e + .5 && lat > BB.s - .5 && lat < BB.n + .5)) { lat = lng = null; } }
      let photoB64 = null;
      if (b.photo) { const m = /^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/.exec(b.photo); if (!m || m[1].length > 700000) throw bad('Фото должно быть JPEG до ~500 КБ'); photoB64 = m[1]; }
      const rep = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), category: b.category, address, description, lat, lng, photo: null, t: now };
      await save(env, rep, photoB64);
      h.push(now); hits.set(ip, h);
      return json({ ok: true, id: rep.id }, 201, cors);
    } catch (e) { return json({ error: e.status ? e.message : 'Ошибка сервера' }, e.status || 500, cors); }
  }
};
