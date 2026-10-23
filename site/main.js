// The landing's motion: the lesson demo plays while it's on screen, sections rise as they enter,
// lesson steps light up as they cross the middle, bento cells follow the pointer. Reduced motion: everything static.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

const seen = (els, fn, opts) => {
  const io = new IntersectionObserver(es => es.forEach(e => fn(e, io)), opts);
  els.forEach(el => io.observe(el));
};

seen(document.querySelectorAll('[data-reveal]'), (e, io) => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: .15 });

const steps = document.querySelectorAll('.steps li');
seen(steps, e => e.target.classList.toggle('on', e.isIntersecting), { rootMargin: '-40% 0px -45% 0px' });
if (still) steps.forEach(li => li.classList.add('on'));

document.querySelectorAll('.cell').forEach(c => c.addEventListener('pointermove', e => {
  const r = c.getBoundingClientRect();
  c.style.setProperty('--x', `${e.clientX - r.left}px`);
  c.style.setProperty('--y', `${e.clientY - r.top}px`);
}));

// the demo: tutor asks, the learner answers by voice, words come in as heard, the error is marked, the tutor corrects
const demo = document.querySelector('.demo');
const wave = demo.querySelector('.wave');
wave.innerHTML = Array.from({ length: 28 }, (_, i) =>
  `<i style="--i:${i};--h:${Math.round(30 + 70 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * .45)))}"></i>`).join('');
const said = demo.querySelector('.said');
said.innerHTML = said.innerHTML.replace(/(<span class="err">[^<]*<\/span>)|([^\s<]+)/g,
  (m, err) => err ? err.replace('class="err"', 'class="err w"') : `<span class="w">${m}</span>`);
const words = [...said.querySelectorAll('.w')];
const step = n => demo.querySelector(`[data-s="${n}"]`);

if (!still) {
  demo.classList.add('play');
  let timers = [], running = false;
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const reset = () => {
    timers.forEach(clearTimeout); timers = [];
    demo.querySelectorAll('.on').forEach(el => el.classList.remove('on'));
    said.classList.remove('marked'); demo.querySelector('.me').classList.remove('rec');
  };
  const play = () => {
    reset();
    at(300, () => step(1).classList.add('on'));
    at(1300, () => { step(2).classList.add('on', 'rec'); });
    words.forEach((w, i) => at(2100 + i * 150, () => w.classList.add('on')));
    const heard = 2100 + words.length * 150;
    at(heard, () => step(2).classList.remove('rec'));
    at(heard + 500, () => said.classList.add('marked'));
    at(heard + 1300, () => step(3).classList.add('on'));
    at(heard + 2300, () => step(4).classList.add('on'));
    at(heard + 8000, () => { demo.querySelectorAll('[data-s]').forEach(el => el.classList.remove('on')); });
    at(heard + 8800, play);
  };
  seen([demo], e => {
    if (e.isIntersecting && !running) { running = true; play(); }
    else if (!e.isIntersecting && running) { running = false; reset(); }
  }, { threshold: .3 });
} else {
  said.classList.add('marked');
}

// access request: a dialog with a form; Turnstile loads only when it opens, the letter goes out from the worker
const SITEKEY = '0x4AAAAAAFizPrUSuOFANadt';
const ask = document.getElementById('access');
const form = ask.querySelector('form');
const err = ask.querySelector('.ask-err');
let widget = null, loading = null;

const captcha = () => loading ??= new Promise(done => {
  window.onTurnstile = () => {
    widget = turnstile.render(ask.querySelector('.ask-captcha'), { sitekey: SITEKEY, theme: 'dark', language: 'ru', size: 'flexible' });
    done();
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstile&render=explicit';
  s.async = true;
  document.head.append(s);
});

const open = () => {
  form.hidden = false; ask.querySelector('.ask-done').hidden = true;
  if (!ask.open) ask.showModal();
  captcha();
};
document.querySelectorAll('[data-access]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); open(); }));
if (location.hash === '#access') open();
ask.addEventListener('click', e => {
  if (e.target === ask || e.target.closest('[value="close"]')) ask.close();
});

const fail = (msg, field) => {
  err.textContent = msg; err.hidden = false;
  const el = field && (field === 'lang' ? form.querySelector('fieldset') : form.elements[field]);
  if (el) { el.classList.add('bad'); (el.focus ? el : el.querySelector('input')).focus(); }
};
form.addEventListener('input', e => {
  e.target.closest('.bad')?.classList.remove('bad'); e.target.classList.remove('bad'); err.hidden = true;
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.hidden = true;
  const f = Object.fromEntries(new FormData(form));
  if (!f.name?.trim()) return fail('Напишите, как к вам обращаться.', 'name');
  if (!form.elements.email.checkValidity() || !f.email) return fail('Проверьте адрес почты.', 'email');
  if (!f.lang) return fail('Выберите язык.', 'lang');
  const token = widget !== null && turnstile.getResponse(widget);
  if (!token) return fail('Подождите секунду: идёт проверка, что вы не робот.');
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = 'Отправляем…';
  try {
    const r = await fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, token }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { turnstile.reset(widget); return fail(d.error || 'Не получилось отправить. Попробуйте чуть позже.', d.field); }
    form.reset(); turnstile.reset(widget);
    form.hidden = true; ask.querySelector('.ask-done').hidden = false;
  } catch {
    turnstile.reset(widget); fail('Нет связи. Проверьте интернет и попробуйте ещё раз.');
  } finally {
    btn.disabled = false; btn.textContent = 'Отправить заявку';
  }
});
