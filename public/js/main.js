document.querySelectorAll('[data-slider]').forEach((slider) => {
  const track = slider.querySelector('.slider-track');
  const prev = slider.querySelector('[data-prev]');
  const next = slider.querySelector('[data-next]');
  const step = 360;
  prev?.addEventListener('click', () => track.scrollBy({ left: -step, behavior: 'smooth' }));
  next?.addEventListener('click', () => track.scrollBy({ left: step, behavior: 'smooth' }));
});

const registerToggle = document.querySelector('[data-toggle-register]');
const registerForm = document.querySelector('[data-register-form]');
registerToggle?.addEventListener('click', () => {
  registerForm?.classList.toggle('hidden');
});

const loginTabs = document.querySelectorAll('[data-login-tab]');
const loginForms = document.querySelectorAll('[data-login-form]');
loginTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.loginTab;
    loginTabs.forEach((item) => item.classList.toggle('active', item === tab));
    loginForms.forEach((form) => form.classList.toggle('hidden', form.dataset.loginForm !== target));
    registerForm?.classList.add('hidden');
  });
});

document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.classList.add('is-loading');
  });
});
