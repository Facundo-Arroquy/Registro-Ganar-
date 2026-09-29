import { requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { renderSidebar } from './layout.js';
import { escapeHtml, getInitials } from './utils.js';

const currentUser = requireSession();
let state;
let searchTerm = '';
const selectedStatuses = new Set();

async function boot() {
  state = await loadAppState();
  renderSidebar({ state, currentUser, activePage: 'clientes', onRefresh: refresh });
  document.querySelector('#clients-search').addEventListener('input', (event) => {
    searchTerm = event.target.value.trim().toLocaleLowerCase('es');
    renderClients();
  });
  renderSummary();
  renderClients();
}

async function refresh() {
  state = await refreshAppState();
  renderSummary();
  renderClients();
}

function renderSummary() {
  const counts = new Map();
  state.clients.forEach((client) => counts.set(client.status || 'Sin estado', (counts.get(client.status || 'Sin estado') || 0) + 1));
  document.querySelector('#clients-summary').innerHTML = `
    <button type="button" class="client-summary-card ${selectedStatuses.size === 0 ? 'active' : ''}" data-status-filter="" aria-pressed="${selectedStatuses.size === 0}"><span>Total</span><strong>${state.clients.length}</strong></button>
    ${[...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'es')).map(([status, count]) => `
      <button type="button" class="client-summary-card ${selectedStatuses.has(status) ? 'active' : ''}" data-status-filter="${escapeHtml(status)}" aria-pressed="${selectedStatuses.has(status)}"><span>${escapeHtml(status)}</span><strong>${count}</strong></button>
    `).join('')}
  `;
  document.querySelectorAll('[data-status-filter]').forEach((button) => button.addEventListener('click', () => {
    const status = button.dataset.statusFilter;
    if (!status) selectedStatuses.clear();
    else if (selectedStatuses.has(status)) selectedStatuses.delete(status);
    else selectedStatuses.add(status);
    renderSummary();
    renderClients();
  }));
}

function renderClients() {
  const clients = state.clients.filter((client) => (
    (selectedStatuses.size === 0 || selectedStatuses.has(client.status || 'Sin estado'))
    && [client.company, client.name, client.consultor, client.status]
      .some((value) => String(value || '').toLocaleLowerCase('es').includes(searchTerm))
  ))
    .sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name, 'es'));
  const ownerById = new Map(state.users.map((user) => [user.id, user]));
  document.querySelector('#clients-directory').innerHTML = clients.length ? clients.map((client) => {
    const owner = ownerById.get(client.ownerId);
    return `
      <a class="client-directory-card" href="/cliente?id=${encodeURIComponent(client.id)}">
        <div class="client-card-avatar">${escapeHtml(getInitials(client.company || client.name))}</div>
        <div class="client-card-main">
          <div class="client-card-title"><h2>${escapeHtml(client.company || client.name)}</h2><span class="client-status-pill">${escapeHtml(client.status || 'Sin estado')}</span></div>
          <p>${escapeHtml(client.name || 'Sin contacto')}</p>
          <div class="client-card-meta">
            <span>${escapeHtml(client.consultor || 'Sin consultor')}</span>
            <span>${escapeHtml(owner?.name || 'Sin responsable')}</span>
            <span>${escapeHtml(client.email || 'Sin correo')}</span>
          </div>
        </div>
        <span class="client-card-arrow" aria-hidden="true">&rarr;</span>
      </a>`;
  }).join('') : '<div class="client-empty-state">No encontramos clientes con esa búsqueda.</div>';
}

boot().catch((error) => {
  document.querySelector('#clients-directory').innerHTML = `<div class="client-empty-state">${escapeHtml(error.message)}</div>`;
});
