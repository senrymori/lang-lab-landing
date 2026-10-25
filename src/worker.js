// langlab.uk: pages come from site/ (assets); this worker takes access requests from the form and hands out the
// Mac app: /download is the DMG in R2 (bucket langlab-downloads, key Language-Lab.dmg; Workers assets stop at 25 MB).
// POST /api/request {name, email, token} → Turnstile check → the server keeps it for the admin («Заявки»):
// API_URL/intake/access-request with X-Intake-Key. Nothing is stored or mailed here. Secrets: INTAKE_KEY,
// TURNSTILE_SECRET; API_URL is a var.
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

async function human(token, ip, secret) {
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: new URLSearchParams({ secret, response: token, remoteip: ip || '' }),
  });
  const d = await r.json();
  return d.success === true;
}

async function request(req, env) {
  let b;
  try { b = await req.json(); } catch { return json(400, { error: 'Не получилось прочитать заявку.' }); }
  const name = clean(b.name, 80).replace(/\s+/g, ' ');
  const email = clean(b.email, 254).replace(/[\r\n]/g, '');
  if (!name) return json(400, { error: 'Напиши, как к тебе обращаться.', field: 'name' });
  if (!EMAIL.test(email)) return json(400, { error: 'Проверь адрес почты.', field: 'email' });
  if (!b.token || !(await human(String(b.token), req.headers.get('cf-connecting-ip'), env.TURNSTILE_SECRET)))
    return json(403, { error: 'Проверка, что ты не робот, не прошла. Обнови страницу и попробуй ещё раз.' });

  const r = await fetch(`${env.API_URL}/intake/access-request`, {
    method: 'POST',
    headers: { 'x-intake-key': env.INTAKE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
  if (!r.ok) {
    console.error('intake', r.status, await r.text());
    return json(502, { error: 'Не получилось отправить. Попробуй чуть позже.' });
  }
  return json(200, { ok: true });
}

const DMG = 'Language-Lab.dmg';

async function download(req, env) {
  const obj = req.method === 'HEAD' ? await env.DOWNLOADS.head(DMG)
    : await env.DOWNLOADS.get(DMG, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response('Приложение скоро будет здесь', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('content-type', 'application/x-apple-diskimage');
  headers.set('content-disposition', 'attachment; filename="LangLab.dmg"');
  headers.set('cache-control', 'no-cache');  // a new build replaces it under the same name
  headers.set('accept-ranges', 'bytes');
  if (!('body' in obj)) return new Response(null, { status: req.method === 'HEAD' ? 200 : 304, headers });
  if (obj.range && req.headers.has('range')) {  // R2 reports a range even for a whole-file read: that one is a 200
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
}

// the app's updates (electron-updater, desktop/main.js): latest-mac.yml says the newest version, its zip is beside it —
// both in R2 under updates/, put there by lang-lab-platform/scripts/publish-app.sh
const UPDATE_FILE = /^\/updates\/([\w.-]+\.(?:yml|zip|blockmap))$/;
async function update(req, env, name) {
  const obj = req.method === 'HEAD' ? await env.DOWNLOADS.head(`updates/${name}`)
    : await env.DOWNLOADS.get(`updates/${name}`, { range: req.headers });
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers({ etag: obj.httpEtag, 'accept-ranges': 'bytes',
    'content-type': name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream',
    'cache-control': name.endsWith('.yml') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  if (!('body' in obj)) return new Response(null, { headers });
  if (obj.range && req.headers.has('range')) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const upd = UPDATE_FILE.exec(url.pathname);
    if (upd) return req.method === 'GET' || req.method === 'HEAD' ? update(req, env, upd[1]) : new Response(null, { status: 405 });
    if (url.pathname === '/download') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405 });
      return download(req, env);
    }
    if (url.pathname === '/api/request') {
      if (req.method !== 'POST') return json(405, { error: 'POST only' });
      return request(req, env);
    }
    return env.ASSETS.fetch(req);
  },
};
