'use strict';
// ====== НАСТРОЙКИ ======
// REPO определяется сам, если сайт открыт на https://ЛОГИН.github.io/РЕПОЗИТОРИЙ/ .
// API — адрес вашего Worker (см. README), например: 'https://eco-map.ivan.workers.dev'
// Для локального запуска впишите REPO вручную, например: 'ivan/eco-map'
const CFG = { REPO: 'Kamenskiy25042001/EcoMap', BRANCH: 'main', API: 'https://raspy-cell-36cd.kamenskiy2001.workers.dev', HEATING: [10, 11, 12, 1, 2, 3, 4], BASIN: 1.2, WIND: { dir: 315, speed: 3 } };
if (!CFG.REPO && /\.github\.io$/.test(location.hostname)) { const o = location.hostname.split('.')[0], r = location.pathname.split('/')[1]; CFG.REPO = o + '/' + (r || o + '.github.io'); }

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LV = { high: ['Высокий', '#ef4444'], mid: ['Умеренный', '#f59e0b'], low: ['Низкий', '#10b981'], minimal: ['Фоновый', '#64748b'] };
const SRC = { weather: 'по данным метеосервиса', fallback: 'справочное значение, метеосервис недоступен' };
const DIRN = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'], windTxt = w => `${DIRN[Math.round(w.dir / 45) % 8]} ${(+w.speed).toFixed(1)} м/с`;
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } } };
function showToast(m) { const t = $('toast'); $('toast-message').textContent = m; t.classList.remove('opacity-0', 'pointer-events-none'); clearTimeout(showToast.t); showToast.t = setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none'), 5000); }

// ---------- карта ----------
const map = L.map('map', { zoomControl: false, center: [49.728, 84.262], zoom: 13 });
L.control.zoom({ position: 'bottomright' }).addTo(map);
const esri = (n, z) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${n}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: z, attribution: 'Tiles &copy; Esri' });
const street = esri('World_Street_Map', 19); street.addTo(map);
L.control.layers({ 'Карта улиц (Esri)': street, 'Топографическая': esri('World_Topo_Map', 19), 'Спутник': esri('World_Imagery', 18) }, null, { position: 'topright' }).addTo(map);
const G = { ind: L.layerGroup().addTo(map), dom: L.layerGroup().addTo(map), eco: L.layerGroup().addTo(map), risk: L.layerGroup().addTo(map), reports: L.layerGroup().addTo(map) };
const NB = { bubblingMouseEvents: false };
function toggleLayer(n) { const m = { industry: 'ind', domestic: 'dom', infrastructure: 'eco', risks: 'risk', reports: 'reports' }; $('layer-' + n).checked ? map.addLayer(G[m[n]]) : map.removeLayer(G[m[n]]); }

const OBJ = window.OBJECTS || [];
function renderObjects() {
  for (const o of OBJ) {
    const m = o.meta || {};
    if (o.kind === 'industrial') {
      const html = `<div class="space-y-1.5"><div class="text-xs font-bold text-amber-400 uppercase tracking-wide">${esc(m.type || 'Промышленный объект')}</div><div class="font-bold text-sm text-slate-100">${esc(o.name)}</div><div class="text-xs text-slate-300"><b>Факторы влияния:</b> ${esc(m.emissions)}</div><div class="text-[11px] text-slate-400 bg-slate-800 p-1.5 rounded-lg border border-slate-700">${esc(m.status)}</div></div>`;
      if (o.geom_type === 'Point') { L.circle(o.coords, { radius: o.radius || 300, color: '#f59e0b', weight: 1, dashArray: '4 4', fillOpacity: .06, interactive: false }).addTo(G.ind); L.circleMarker(o.coords, { radius: 10, fillColor: '#f59e0b', color: '#1e293b', weight: 2, fillOpacity: .9, ...NB }).bindPopup(html).addTo(G.ind); }
      else L.polygon(o.coords, { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: .3, weight: 2, ...NB }).bindPopup(html).addTo(G.ind);
    } else if (o.kind === 'residential')
      L.polygon(o.coords, { color: '#f97316', dashArray: '5, 5', fillColor: '#f97316', fillOpacity: .25, weight: 2, ...NB }).bindPopup(`<div class="space-y-1"><div class="text-xs font-bold text-orange-400">Бытовой сектор</div><div class="font-bold text-sm text-slate-100">${esc(o.name)}</div><div class="text-xs text-slate-300">${esc(o.description)}</div></div>`).addTo(G.dom);
    else if (o.kind === 'container')
      L.circleMarker(o.coords, { radius: 7, fillColor: '#10b981', color: '#064e3b', weight: 2, fillOpacity: .9, ...NB }).bindPopup(`<div class="space-y-1"><div class="text-xs font-bold text-emerald-400">Раздельный сбор отходов</div><div class="font-bold text-sm text-slate-100">${esc(o.name)}</div><div class="text-xs text-slate-300"><b>Принимаемые фракции:</b> ${esc(m.fractions)}</div></div>`).addTo(G.eco);
  }
}

// ---------- ветер, заявки (GitHub Issues), геокодер ----------
async function getWind() {
  try { const c = JSON.parse(sessionStorage.getItem('wind') || 'null'); if (c && Date.now() - c.t < 18e5) return c.v; } catch (e) { }
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=49.73&longitude=84.27&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms'), c = (await r.json()).current;
    if (!c || c.wind_speed_10m == null) throw 0;
    const v = { dir: Math.round(c.wind_direction_10m), speed: +c.wind_speed_10m, source: 'weather' }; try { sessionStorage.setItem('wind', JSON.stringify({ t: Date.now(), v })); } catch (e) { } return v;
  } catch (e) { return { ...CFG.WIND, source: 'fallback' }; }
}
async function loadReports() {
  if (!CFG.REPO) return [];
  try {
    const r = await fetch(`https://api.github.com/repos/${CFG.REPO}/contents/data/reports.json?ref=${CFG.BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-cache' });
    if (r.status === 404) return []; if (!r.ok) throw new Error(r.status);
    return (await r.json()).map(normalizeReport).filter(Boolean);
  } catch (e) { showToast('Не удалось загрузить заявки из репозитория (лимит запросов GitHub?)'); return []; }
}
async function nominatim(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ format: 'jsonv2', q, limit: '5', 'accept-language': 'ru', countrycodes: 'kz', viewbox: `${BB.w},${BB.n},${BB.e},${BB.s}`, bounded: '1' });
  const r = await fetch(u); if (!r.ok) throw new Error('geocoder'); return (await r.json()).map(x => ({ lat: +x.lat, lng: +x.lon, label: x.display_name }));
}
async function geo(addr) {
  const k = 'geo:' + addr.toLowerCase().trim(), c = ls.get(k); if (c) return JSON.parse(c);
  for (const q of [addr, addr + ', Алтай', addr + ', Зыряновск']) { const r = await nominatim(q); if (r.length) { ls.set(k, JSON.stringify(r)); return r; } await sleep(1100); }
  return [];
}

// ---------- отрисовка риска и заявок ----------
let reports = [], ctx = null;
function renderRisk() {
  G.risk.clearLayers(); if (!ctx) return;
  const g = computeGrid(ctx), c = document.createElement('canvas'); c.width = g.cols; c.height = g.rows;
  const x = c.getContext('2d'), im = x.createImageData(g.cols, g.rows);
  g.values.forEach((v, i) => im.data.set(v >= TH.high ? [239, 68, 68, 110] : v >= TH.mid ? [245, 158, 11, 92] : v >= TH.low ? [16, 185, 129, 70] : [0, 0, 0, 0], i * 4));
  x.putImageData(im, 0, 0);
  const big = document.createElement('canvas'); big.width = g.cols * 4; big.height = g.rows * 4;
  const bx = big.getContext('2d'); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high'; bx.drawImage(c, 0, 0, big.width, big.height);
  L.imageOverlay(big.toDataURL(), [[g.n, g.w], [g.s, g.e]], { interactive: false }).addTo(G.risk);
  for (const o of OBJ) if (o.kind === 'risk_zone') { const col = LV[o.level || 'mid'][1];
    L.polygon(o.coords, { color: col, fillColor: col, fillOpacity: .12, weight: 2, dashArray: '6 4', ...NB }).bindPopup(`<div class="space-y-1"><div class="text-xs font-bold" style="color:${col}">Зона риска (задана вручную): ${LV[o.level || 'mid'][0].toLowerCase()}</div><div class="font-bold text-sm text-slate-100">${esc(o.name)}</div><div class="text-xs text-slate-200">${esc(o.description)}</div></div>`).addTo(G.risk); }
  $('windInfo').textContent = windTxt(ctx.w) + ' · ' + SRC[ctx.w.source];
  $('seasonInfo').textContent = ctx.heating ? 'Отопительный сезон: печи учитываются' : 'Вне отопительного сезона';
}
function renderReports() {
  G.reports.clearLayers();
  for (const r of reports) { if (r.lat == null) continue;
    const img = r.photo ? `<img src="https://raw.githubusercontent.com/${CFG.REPO}/${CFG.BRANCH}/${esc(r.photo)}" class="w-full h-28 object-cover rounded-lg my-2 border border-slate-700" alt="Фото" onerror="this.style.display='none'">` : '';
    L.circleMarker([r.lat, r.lng], { radius: 9, fillColor: '#a855f7', color: '#3b0764', weight: 2, fillOpacity: .95, ...NB }).bindPopup(`<div class="space-y-1"><div class="text-xs font-bold text-purple-400">${esc(CAT[r.category])}</div><div class="text-xs text-slate-400">${esc(new Date(r.t).toISOString().slice(0, 10))}</div><div class="text-xs text-slate-300">📍 ${esc(r.address)}</div>${img}<div class="text-xs text-slate-200">${esc(r.description)}</div></div>`).addTo(G.reports); }
}
async function load() {
  const w = await getWind(); reports = await loadReports();
  const rebuild = () => { ctx = buildCtx(OBJ, w, reports, CFG.HEATING.includes(new Date().getMonth() + 1), CFG.BASIN); renderRisk(); renderReports(); };
  rebuild();
  // у заявок без координат ищем их по адресу (с кэшем в браузере)
  let changed = false;
  for (const r of reports) if (r.lat == null) { try { const c = (await geo(r.address))[0]; if (c) { r.lat = c.lat; r.lng = c.lng; changed = true; } } catch (e) { } }
  if (changed) rebuild();
}

// ---------- оценка риска по клику ----------
function riskHtml(r) {
  const [nm, col] = LV[r.level];
  return `<div class="space-y-1.5" style="min-width:220px"><div class="text-xs text-slate-400">Оценка риска в этой точке</div><div class="font-bold text-base" style="color:${col}">${nm} · ${r.score}/100</div><div class="h-1.5 rounded bg-slate-700"><div class="h-1.5 rounded" style="width:${r.score}%;background:${col}"></div></div>`
    + (r.factors.length ? `<div class="text-xs text-slate-300"><b>Основные факторы:</b><br>${r.factors.map(f => `• ${esc(f.name)} — ${f.share}% (${f.dist} м, ${f.down ? 'по ветру' : 'против ветра'})`).join('<br>')}</div>` : '<div class="text-xs text-slate-300">Значимых источников поблизости нет.</div>')
    + (r.reports ? `<div class="text-xs text-slate-300">Заявок жителей в радиусе 500 м (90 дней): <b>${r.reports}</b></div>` : '')
    + (r.zone ? `<div class="text-xs text-amber-300">Входит в зону риска: ${esc(r.zone)}</div>` : '')
    + (r.container ? `<div class="text-xs text-slate-400">Ближайшие контейнеры: ${esc(r.container.name)}, ${r.container.dist} м</div>` : '')
    + `<div class="text-[11px] text-slate-500">Ветер: ${windTxt(r.wind)}. Модельная оценка, не замер.</div></div>`;
}
map.on('click', e => { if (ctx) L.popup().setLatLng(e.latlng).setContent(riskHtml(scoreAt(ctx, e.latlng.lat, e.latlng.lng, true))).openOn(map); });

// ---------- форма: адрес -> готовая заявка на GitHub ----------
let hint = null, cands = [], preview = null;
function openReportModal() { $('reportModal').classList.remove('hidden'); }
function closeReportModal() { $('reportModal').classList.add('hidden'); if (preview) { map.removeLayer(preview); preview = null; } }
$('reportAddress').addEventListener('input', () => { hint = null; $('addrErr').textContent = ''; });
async function findAddress() {
  const q = $('reportAddress').value.trim(); if (q.length < 3) return; $('addrErr').textContent = ''; $('addrResults').innerHTML = '<span class="text-xs text-slate-400">Поиск…</span>';
  try { cands = await geo(q); } catch (e) { cands = []; $('addrErr').textContent = 'Сервис поиска адресов недоступен.'; }
  $('addrResults').innerHTML = cands.map((c, i) => `<button type="button" onclick="pickAddr(${i})" class="block w-full text-left text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2">📍 ${esc(c.label)}</button>`).join('');
  if (!cands.length && !$('addrErr').textContent) $('addrErr').textContent = 'Адрес не найден. Уточните улицу и номер дома.';
}
function pickAddr(i) { const c = cands[i]; hint = c; $('addrResults').innerHTML = `<div class="text-xs text-emerald-400">✓ Выбрано: ${esc(c.label)}</div>`; if (preview) map.removeLayer(preview); preview = L.marker([c.lat, c.lng]).addTo(map); map.setView([c.lat, c.lng], 16); }
function shrink(f) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = rej; fr.onload = () => { const im = new Image(); im.onerror = rej; im.onload = () => { let m = 1000, q = .78, o; do { const r = Math.min(1, m / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * r; c.height = im.height * r; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); o = c.toDataURL('image/jpeg', q); m *= .85; q -= .06; } while (o.length > 450000 && m > 200); res(o); }; im.src = fr.result; }; fr.readAsDataURL(f); }); }
$('reportPhotoFile').addEventListener('change', async e => { const f = e.target.files[0], p = $('reportPreview'); if (!f) return p.classList.add('hidden'); try { p.src = await shrink(f); p.classList.remove('hidden'); } catch (_) { } });
async function submitReport(e) {
  e.preventDefault(); if (!CFG.API) { $('addrErr').textContent = 'Не задан адрес сервиса приёма заявок (CFG.API в app.js, см. README).'; return; }
  const b = $('reportSubmit'); b.disabled = true; $('addrErr').textContent = '';
  try {
    const addr = $('reportAddress').value.trim(); let h = hint; if (!h) { try { h = (await geo(addr))[0]; } catch (x) { } }
    const f = $('reportPhotoFile').files[0], photo = f ? await shrink(f) : null;
    const r = await fetch(CFG.API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: $('reportType').value, address: addr, description: $('reportDesc').value.trim(), photo, lat: h ? h.lat : null, lng: h ? h.lng : null }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
    closeReportModal(); $('ecoReportForm').reset(); $('reportPreview').classList.add('hidden'); $('addrResults').innerHTML = ''; hint = null;
    if (h) map.setView([h.lat, h.lng], 16); showToast('Заявка сохранена в репозиторий'); await sleep(1500); load();
  } catch (x) { $('addrErr').textContent = x.message; } finally { b.disabled = false; }
}

// ---------- запуск ----------
if (CFG.REPO) $('modLink').href = `https://github.com/${CFG.REPO}/tree/${CFG.BRANCH}/data`; else $('modLink').classList.add('hidden');
renderObjects(); load(); setInterval(load, 180000);
