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

export function getDueDateStatus(dueDateStr) {
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

export function getTimeInColumn(enteredTimestamp) {
  if (!enteredTimestamp) return 'Reciente';
  const diffMs = Date.now() - Number(enteredTimestamp);
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffMins < 60) return `${Math.max(diffMins, 0)}m en col.`;
  if (diffHours < 24) return `${diffHours}h en col.`;
  return `${diffDays}d en col.`;
}
