// The landing is still frames. Scrolling glides by inertia (Lenis), unless the system asks for less motion. The rest
// is the access request: a dialog with a form; Turnstile loads only when it opens, the letter goes out from the
// worker (POST /api/request).
import Lenis from '/vendor/lenis.mjs';

const glide = matchMedia('(prefers-reduced-motion: reduce)').matches ? null
  : new Lenis({ autoRaf: true, lerp: 0.08, anchors: true });
const SITEKEY = '0x4AAAAAAFizPrUSuOFANadt';
const ask = document.getElementById('access');
const form = ask.querySelector('form');
const err = ask.querySelector('.ask-err');
let widget = null, loading = null;

const captcha = () => loading ??= new Promise(done => {
  window.onTurnstile = () => {
    widget = turnstile.render(ask.querySelector('.ask-captcha'), { sitekey: SITEKEY, theme: 'light', language: 'ru', size: 'flexible' });
    done();
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstile&render=explicit';
  s.async = true;
  document.head.append(s);
});

const open = () => {
  form.hidden = false; ask.querySelector('.ask-done').hidden = true;
  if (!ask.open) { ask.showModal(); glide?.stop(); }
  captcha();
};
document.querySelectorAll('[data-access]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); open(); }));
if (location.hash === '#access') open();
ask.addEventListener('close', () => glide?.start());
ask.addEventListener('click', e => {
  if (e.target === ask || e.target.closest('[value="close"]')) ask.close();
});

const fail = (msg, field) => {
  err.textContent = msg; err.hidden = false;
  const el = field && form.elements[field];
  if (el) { el.classList.add('bad'); el.focus(); }
};
form.addEventListener('input', e => {
  e.target.classList.remove('bad'); err.hidden = true;
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.hidden = true;
  const f = Object.fromEntries(new FormData(form));
  if (!f.name?.trim()) return fail('Напиши, как к тебе обращаться.', 'name');
  if (!form.elements.email.checkValidity() || !f.email) return fail('Проверь адрес почты.', 'email');
  const token = widget !== null && turnstile.getResponse(widget);
  if (!token) return fail('Подожди секунду: идёт проверка, что ты не робот.');
  const btn = form.querySelector('[type="submit"]');
  const label = btn.querySelector('.ask-send');
  btn.disabled = true; label.textContent = 'Отправляем…';
  try {
    const r = await fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, token }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { turnstile.reset(widget); return fail(d.error || 'Не получилось отправить. Попробуй чуть позже.', d.field); }
    form.reset(); turnstile.reset(widget);
    form.hidden = true; ask.querySelector('.ask-done').hidden = false;
  } catch {
    turnstile.reset(widget); fail('Нет связи. Проверь интернет и попробуй ещё раз.');
  } finally {
    btn.disabled = false; label.textContent = 'Отправить заявку';
  }
});
