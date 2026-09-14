import { api, setSessionUser } from './api.js';

const form = document.querySelector('#login-form');
const error = document.querySelector('#login-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const email = document.querySelector('#login-email').value.trim();
  const password = document.querySelector('#login-password').value;

  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setSessionUser(user);
    window.location.href = '/dashboard';
  } catch (err) {
    error.textContent = err.message;
  }
});
