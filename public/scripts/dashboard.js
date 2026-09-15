import { api, requireSession } from './api.js';
import { loadAppState } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml, getDueDateStatus } from './utils.js';

const currentUser = requireSession();
let state;

async function boot() {
  state = await loadAppState();
  renderPage();
}

async function refresh() {
  state = await loadAppState();
  renderPage();
}

function renderPage() {
  renderSidebar({
    state,
    currentUser,
    activePage: 'dashboard',
    onRefresh: refresh
  });
  document.querySelector('[data-open-client]').onclick = openClientModal;
  renderDashboard();
}

function renderDashboard() {
  document.querySelector('#stat-total-clients').textContent = state.clients.length;
  const cards = state.boards.flatMap((board) => board.cards);
  document.querySelector('#stat-active-cards').textContent = cards.length;
  document.querySelector('#stat-expired-cards').textContent = cards.filter((card) => getDueDateStatus(card.dueDate)?.status === 'expired').length;
  document.querySelector('#clients-table-body').innerHTML = state.clients.map((client) => {
    const clientCards = getClientCards(client.id);
    const timedCards = getTimedClientCards(client.id);
    const averageMs = getAverageTimedMs(timedCards);
    const owner = state.users.find((user) => user.id === client.ownerId);
    return `
      <tr class="editable-row" data-edit-client="${escapeHtml(client.id)}">
        <td><strong>${escapeHtml(client.name)}</strong></td>
        <td>${escapeHtml(client.company)}</td>
        <td>${escapeHtml(client.email || 'N/A')}</td>
        <td>${owner ? escapeHtml(owner.name) : '<span style="color: var(--text-muted);">Sin asignar</span>'}</td>
        <td>${statusBadge(client.status || 'Activo')}</td>
        <td><span class="card-count">${clientCards.length} tareas</span></td>
        <td><span class="card-count">${timedCards.length} tags</span></td>
        <td>${averageMs ? `<span class="time-badge">${escapeHtml(formatDuration(averageMs))}</span>` : '<span style="color: var(--text-muted);">Sin datos</span>'}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-edit-client-button="${escapeHtml(client.id)}">Editar</button></td>
      </tr>
    `;
  }).join('');
  document.querySelectorAll('[data-edit-client]').forEach((row) => {
    row.addEventListener('click', () => openClientModal(state.clients.find((client) => client.id === row.dataset.editClient)));
  });
  document.querySelectorAll('[data-edit-client-button]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openClientModal(state.clients.find((client) => client.id === button.dataset.editClientButton));
    });
  });
}

function getClientCards(clientId) {
  return state.boards.flatMap((board) => board.cards.filter((card) => card.clientId === clientId));
}

function getTimedClientCards(clientId) {
  return state.boards.flatMap((board) => {
    const timedColumnIds = new Set(board.columns.filter((column) => column.showTimer).map((column) => column.id));
    return board.cards.filter((card) => card.clientId === clientId && timedColumnIds.has(card.columnId) && card.enteredColumnAt);
  });
}

function getAverageTimedMs(cards) {
  if (!cards.length) return 0;
  const totalMs = cards.reduce((sum, card) => sum + Math.max(Date.now() - Number(card.enteredColumnAt), 0), 0);
  return totalMs / cards.length;
}

function formatDuration(durationMs) {
  const minutes = Math.floor(durationMs / (1000 * 60));
  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const days = Math.floor(durationMs / (1000 * 60 * 60 * 24));

  if (minutes < 60) return `${minutes}m promedio`;
  if (hours < 24) return `${hours}h promedio`;
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h promedio` : `${days}d promedio`;
}

function openClientModal(client = null) {
  const isEdit = Boolean(client);
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Cliente' : 'Nuevo Cliente'}</div>
        <div class="form-group"><label>Nombre del Contacto</label><input type="text" id="client-name-input" class="form-control" placeholder="Ej. Laura Martinez" value="${escapeHtml(client?.name || '')}"></div>
        <div class="form-group"><label>Empresa</label><input type="text" id="client-company-input" class="form-control" placeholder="Ej. TechCorp" value="${escapeHtml(client?.company || '')}"></div>
        <div class="form-group"><label>Correo Electronico</label><input type="email" id="client-email-input" class="form-control" placeholder="cliente@techcorp.com" value="${escapeHtml(client?.email || '')}"></div>
        <div class="form-group"><label>Personal a cargo</label><select id="client-owner-input" class="form-control">${userOptions(client?.ownerId || '')}</select></div>
        <div class="form-group">
          <label>Estado del cliente</label>
          <select id="client-status-input" class="form-control">
            ${statusOptions(client?.status || 'Activo')}
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Guardar Cliente'}</button>
        </div>
      </form>
    </div>
  `);
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: overlay.querySelector('#client-name-input').value.trim(),
      company: overlay.querySelector('#client-company-input').value.trim(),
      email: overlay.querySelector('#client-email-input').value.trim(),
      ownerId: overlay.querySelector('#client-owner-input').value,
      status: overlay.querySelector('#client-status-input').value
    };
    if (!payload.name || !payload.company) return;
    await api(isEdit ? `/api/clients/${client.id}` : '/api/clients', {
      method: isEdit ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...payload, ...auditUser() })
    });
    closeModal();
    await refresh();
  });
}

function userOptions(selectedId = '') {
  return `<option value="">Sin asignar</option>${state.users.map((user) => `
    <option value="${escapeHtml(user.id)}" ${user.id === selectedId ? 'selected' : ''}>${escapeHtml(user.name)}</option>
  `).join('')}`;
}

function statusOptions(selectedStatus) {
  return getClientStatuses().map((statusItem) => {
    const status = getStatusName(statusItem);
    return `<option value="${escapeHtml(status)}" ${status === selectedStatus ? 'selected' : ''}>${escapeHtml(status)}</option>`;
  }).join('');
}

function getClientStatuses() {
  return state.settings?.clientStatuses?.length ? state.settings.clientStatuses : ['Activo'];
}

function getStatusName(status) {
  return typeof status === 'string' ? status : status?.name || '';
}

function getStatusColor(status) {
  if (typeof status === 'object' && isHexColor(status?.color)) return status.color;
  const statusItem = getClientStatuses().find((item) => getStatusName(item) === status);
  if (statusItem && typeof statusItem === 'object' && isHexColor(statusItem.color)) return statusItem.color;
  const defaults = {
    Activo: '#3fb950',
    'En pausa': '#d29922',
    Riesgo: '#f85149',
    Cerrado: '#8b949e'
  };
  return defaults[status] || '#388bfd';
}

function statusBadge(status) {
  const color = getStatusColor(status);
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(color)};">${escapeHtml(status)}</span>`;
}

function isHexColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
}

function auditUser() {
  return { userId: currentUser.id, userName: currentUser.name };
}

boot();
