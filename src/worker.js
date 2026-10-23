// langlab.uk: pages come from site/ (assets); this worker takes access requests from the form and hands out the
// Mac app: /download is the DMG in R2 (bucket langlab-downloads, key Language-Lab.dmg; Workers assets stop at 25 MB).
// POST /api/request {name, email, lang, about, token} → Turnstile check → a letter to the owner through Resend,
// Reply-To the applicant. Nothing is stored here. Secrets: RESEND_KEY, OWNER_EMAIL, TURNSTILE_SECRET.
const LANGS = { en: 'английский', es: 'испанский', kk: 'казахский' };
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
  const lang = Object.hasOwn(LANGS, b.lang) ? b.lang : '';
  const about = clean(b.about, 1000);
  if (!name) return json(400, { error: 'Напишите, как к вам обращаться.', field: 'name' });
  if (!EMAIL.test(email)) return json(400, { error: 'Проверьте адрес почты.', field: 'email' });
  if (!lang) return json(400, { error: 'Выберите язык.', field: 'lang' });
  if (!b.token || !(await human(String(b.token), req.headers.get('cf-connecting-ip'), env.TURNSTILE_SECRET)))
    return json(403, { error: 'Проверка, что вы не робот, не прошла. Обновите страницу и попробуйте ещё раз.' });

  const text = `Заявка на доступ к Language Lab\n\nИмя: ${name}\nПочта: ${email}\nЯзык: ${LANGS[lang]}\n\n${about || '(о себе ничего не написал)'}\n\n` +
    `Ответить: просто ответьте на это письмо, оно уйдёт на ${email}.`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'Language Lab <access@mail.langlab.uk>', to: [env.OWNER_EMAIL], reply_to: email,
      subject: `Заявка: ${name}, ${LANGS[lang]}`, text }),
  });
  if (!r.ok) {
    console.error('resend', r.status, await r.text());
    return json(502, { error: 'Не получилось отправить. Попробуйте чуть позже.' });
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
  headers.set('content-disposition', 'attachment; filename="Language Lab.dmg"');
  headers.set('cache-control', 'no-cache');  // a new build replaces it under the same name
  headers.set('accept-ranges', 'bytes');
  if (!('body' in obj)) return new Response(null, { status: req.method === 'HEAD' ? 200 : 304, headers });
  if (obj.range) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
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
