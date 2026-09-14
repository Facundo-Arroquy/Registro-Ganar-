export async function api(path, options = {}) {
  const token = getSessionToken();
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearSession();
    throw new Error(data.error || 'No se pudo completar la operacion');
  }
  return data;
}

export function getSessionUser() {
  const raw = sessionStorage.getItem('currentUser');
  return raw ? JSON.parse(raw) : null;
}

export function getSessionToken() {
  return sessionStorage.getItem('accessToken');
}

export function requireSession() {
  const user = getSessionUser();
  const token = getSessionToken();
  if (!user || !token) window.location.href = '/login';
  return user;
}

export function setSessionUser(user, accessToken) {
  sessionStorage.setItem('currentUser', JSON.stringify(user));
  sessionStorage.setItem('accessToken', accessToken);
}

export function clearSession() {
  sessionStorage.removeItem('currentUser');
  sessionStorage.removeItem('accessToken');
}
