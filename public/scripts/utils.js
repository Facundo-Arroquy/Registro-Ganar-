export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function getInitials(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || '--';
}

export function getDueDateStatus(dueDateStr, resolved = false) {
  if (resolved) return null;
  if (!dueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, month, day] = dueDateStr.split('-');
  const dueDate = new Date(year, month - 1, day);
  const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { status: 'expired', label: 'Vencida' };
  if (diffDays === 0) return { status: 'warning', label: 'Vence Hoy' };
  if (diffDays <= 2) return { status: 'warning', label: `Vence en ${diffDays}d` };
  return { status: 'normal', label: `${day}/${month}/${year}` };
}

export function formatTimerDuration(durationSeconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationSeconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatBankDuration(durationSeconds) {
  const minutes = Math.floor(Math.max(0, Number(durationSeconds) || 0) / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function setButtonLoading(button, loading, originalText = null) {
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add('btn-loading');
    button.innerHTML = `<span class="btn-spinner"></span> ${escapeHtml(originalText || 'Cargando...')}`;
  } else {
    button.disabled = false;
    button.classList.remove('btn-loading');
    button.textContent = button.dataset.originalText || originalText || '';
  }
}
