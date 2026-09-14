export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo completar la operacion');
  }
  return data;
}

export function getSessionUser() {
  const raw = sessionStorage.getItem('currentUser');
  return raw ? JSON.parse(raw) : null;
}

export function requireSession() {
  const user = getSessionUser();
  if (!user) window.location.href = '/login';
  return user;
}

export function setSessionUser(user) {
  sessionStorage.setItem('currentUser', JSON.stringify(user));
}

export function clearSession() {
  sessionStorage.removeItem('currentUser');
}
