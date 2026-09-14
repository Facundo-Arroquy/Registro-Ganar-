import { api, setSessionUser } from './api.js';

const form = document.querySelector('#login-form');
const error = document.querySelector('#login-error');
const passwordInput = document.querySelector('#login-password');
const passwordToggle = document.querySelector('[data-toggle-password]');

passwordToggle.addEventListener('click', () => {
  const isVisible = passwordInput.type === 'text';
  passwordInput.type = isVisible ? 'password' : 'text';
  passwordToggle.setAttribute('aria-pressed', String(!isVisible));
  passwordToggle.setAttribute('aria-label', isVisible ? 'Mostrar contrasena' : 'Ocultar contrasena');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const email = document.querySelector('#login-email').value.trim();
  const password = document.querySelector('#login-password').value;

  try {
    const { user, accessToken } = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setSessionUser(user, accessToken);
    window.location.href = '/dashboard';
  } catch (err) {
    error.textContent = err.message;
  }
});
