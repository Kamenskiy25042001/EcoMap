'use strict';
// Чистая логика без DOM: расчёт риска и разбор заявок из GitHub Issues.
const CAT = { dump: 'Несанкционированная свалка', air: 'Выбросы дыма / Неприятный запах', water: 'Загрязнение водоема / Реки', waste: 'Загромождение контейнерной площадки', other: 'Другая проблема' };
const BB = { w: 84.05, e: 84.55, s: 49.58, n: 49.88 };           // район г. Алтай (для поиска адресов)
const LAT0 = 49.73, LNG0 = 84.27, KY = 111320, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const GRID = { s: 49.665, n: 49.80, w: 84.12, e: 84.44, dLat: .002, dLng: .003 }, TH = { high: 55, mid: 28, low: 12 };
const level = s => s >= TH.high ? 'high' : s >= TH.mid ? 'mid' : s >= TH.low ? 'low' : 'minimal';
const centroid = p => [p.reduce((s, a) => s + a[0], 0) / p.length, p.reduce((s, a) => s + a[1], 0) / p.length];
const polyR = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += (p[i][1] * KX) * (q[0] * KY) - (q[1] * KX) * (p[i][0] * KY); } return Math.sqrt(Math.abs(a / 2) / Math.PI); };
function inPoly(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][0] > pt[0]) !== (poly[j][0] > pt[0]) && pt[1] < (poly[j][1] - poly[i][1]) * (pt[0] - poly[i][0]) / (poly[j][0] - poly[i][0]) + poly[i][1]) c = !c; return c; }

function buildCtx(objects, w, reports, heating, basin) {
  const src = [], zones = [], containers = [];
  for (const o of objects) {
    if (o.kind === 'container') { containers.push(o); continue; }
    if (o.kind === 'risk_zone') { zones.push(o); continue; }
    const c = o.geom_type === 'Point' ? o.coords : centroid(o.coords), R = o.geom_type === 'Point' ? (o.radius || 300) : polyR(o.coords), pw = o.power ?? 1;
    src.push({ name: o.name, kind: o.kind, R, P: o.kind === 'industrial' ? pw : (heating ? .45 : .05) * pw, x: (c[1] - LNG0) * KX, y: (c[0] - LAT0) * KY });
  }
  const reps = reports.filter(r => r.lat != null && Date.now() - r.t < 90 * 864e5).map(r => ({ x: (r.lng - LNG0) * KX, y: (r.lat - LAT0) * KY }));
  const b = ((w.dir + 180) % 360) * Math.PI / 180;
  return { w, heating, src, zones, containers, reps, sb: Math.sin(b), cb: Math.cos(b), basin, stag: 1 + .15 * Math.max(0, 3 - w.speed) };
}
function intensity(s, ex, ny, c) {
  const d = Math.hypot(ex, ny), dd = Math.max(0, d - s.R), dx = ex * c.sb + ny * c.cb, dy = ex * c.cb - ny * c.sb, sp = c.w.speed; let wi;
  if (dx > 0) { const dxe = Math.max(0, dx - s.R), dye = Math.max(0, Math.abs(dy) - s.R * .8), sy = .25 * dxe + 150, L = 1800 * (1 + sp / 4); wi = s.P * Math.exp(-dxe / L) * Math.exp(-dye * dye / (2 * sy * sy)) * (150 / sy); }
  else wi = s.P * (.6 + .4 * Math.exp(-dd / 150)) * Math.exp(-dd * dd / (2 * 300 * 300));
  const calm = Math.min(1, Math.max(0, (2 - sp) / 2)); return (1 - calm) * wi + calm * s.P * Math.exp(-dd / 700);
}
function scoreAt(c, lat, lng, detail) {
  const x = (lng - LNG0) * KX, y = (lat - LAT0) * KY; let sum = 0; const f = [];
  for (const s of c.src) { const ex = x - s.x, ny = y - s.y, i = intensity(s, ex, ny, c); sum += i; if (detail) f.push({ name: s.name, i, dist: Math.round(Math.hypot(ex, ny)), down: (ex * c.sb + ny * c.cb) > 0 }); }
  sum *= c.basin * c.stag; let sc = 100 * (1 - Math.exp(-1.1 * sum)), rb = 0, near = 0;
  for (const r of c.reps) { const d2 = (x - r.x) ** 2 + (y - r.y) ** 2; rb += 6 * Math.exp(-d2 / (2 * 300 * 300)); if (d2 < 250000) near++; }
  sc += Math.min(18, rb) * (1 - sc / 100); let zone = null;
  for (const z of c.zones) if (inPoly([lat, lng], z.coords)) { const fl = { high: 75, mid: 45, low: 20 }[z.level] || 0; if (fl > sc) { sc = fl; zone = z.name; } }
  sc = Math.round(Math.min(100, sc)); if (!detail) return sc;
  const tot = f.reduce((a, b) => a + b.i, 0) || 1;
  const factors = f.map(a => ({ name: a.name, share: Math.round(100 * a.i / tot), dist: a.dist, down: a.down })).filter(a => a.share >= 5).sort((a, b) => b.share - a.share).slice(0, 3);
  let cont = null; for (const o of c.containers) { const d = Math.round(Math.hypot((o.coords[1] - LNG0) * KX - x, (o.coords[0] - LAT0) * KY - y)); if (!cont || d < cont.dist) cont = { name: o.name, dist: d }; }
  return { score: sc, level: level(sc), factors, reports: near, zone, container: cont, wind: c.w, heating: c.heating };
}
function computeGrid(c) {
  const rows = Math.ceil((GRID.n - GRID.s) / GRID.dLat), cols = Math.ceil((GRID.e - GRID.w) / GRID.dLng), values = [];
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) values.push(scoreAt(c, GRID.n - (r + .5) * GRID.dLat, GRID.w + (q + .5) * GRID.dLng, false));
  return { s: GRID.s, n: GRID.s + rows * GRID.dLat, w: GRID.w, e: GRID.w + cols * GRID.dLng, rows, cols, values };
}
// Запись из data/reports.json (её создаёт Worker). Проверяем всё, что пришло из репозитория.
function normalizeReport(r) {
  if (!r || typeof r !== 'object') return null;
  const lat = Number(r.lat), lng = Number(r.lng), ok = r.lat != null && r.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && lat > BB.s - .5 && lat < BB.n + .5 && lng > BB.w - .5 && lng < BB.e + .5;
  const photo = typeof r.photo === 'string' && /^data\/photos\/[\w-]+\.jpg$/.test(r.photo) ? r.photo : null;
  if (!r.address || !r.description) return null;
  return { id: String(r.id), category: CAT[r.category] ? r.category : 'other', address: String(r.address).slice(0, 200), description: String(r.description).slice(0, 1500), photo, lat: ok ? lat : null, lng: ok ? lng : null, t: Number(r.t) || Date.now() };
}
if (typeof module !== 'undefined') module.exports = { buildCtx, scoreAt, computeGrid, normalizeReport, level, CAT, TH };
