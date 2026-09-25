import { api, requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml, getDueDateStatus, setButtonLoading } from './utils.js';

const currentUser = requireSession();
let state;
let sortColumn = null;
let sortDirection = 'asc';
let selectedStatus = 'Plan Activo';

async function boot() {
  state = await loadAppState();
  renderPage();
}

async function refresh() {
  state = await refreshAppState();
  renderPage();
}

function renderPage() {
  renderSidebar({
    state,
    currentUser,
    activePage: 'dashboard',
    onRefresh: refresh
  });
  document.querySelector('[data-open-client]').onclick = () => openClientModal();
  document.querySelector('[data-add-general-link]').onclick = () => openGeneralLinkModal();
  renderClientStatusFilter();
  renderDashboard();
  renderGeneralLinks();
}

function renderDashboard() {
  document.querySelector('#stat-total-clients').textContent = state.clients.length;
  const cards = state.boards.flatMap((board) => board.cards);
  document.querySelector('#stat-active-cards').textContent = cards.length;
  document.querySelector('#stat-expired-cards').textContent = cards.filter((card) => getDueDateStatus(card.dueDate)?.status === 'expired').length;

  // Status counts
  const statusCounts = {};
  state.clients.forEach(c => {
    const s = c.status || 'Activo';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  const countsRow = document.querySelector('#status-counts-row');
  if (countsRow) {
    countsRow.innerHTML = Object.entries(statusCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `<div class="status-count-chip"><span class="status-count-label">${escapeHtml(status)}</span><span class="status-count-value">${count}</span></div>`)
      .join('');
  }

  const enriched = state.clients
    .filter((client) => !selectedStatus || (client.status || 'Activo') === selectedStatus)
    .map((client) => ({
      client,
      cards: getClientCards(client.id),
      timedCards: getTimedClientCards(client.id),
      timeBankSeconds: Number(client.timeBankSeconds || 0),
      owner: state.users.find((user) => user.id === client.ownerId),
      links: client.links || []
    }));

  if (sortColumn) {
    enriched.sort((a, b) => {
      const val = getSortValue(a, sortColumn) ?? '';
      const valB = getSortValue(b, sortColumn) ?? '';
      let result;
      if (typeof val === 'number' && typeof valB === 'number') {
        result = val - valB;
      } else {
        result = String(val).localeCompare(String(valB), 'es', { sensitivity: 'base' });
      }
      return sortDirection === 'desc' ? -result : result;
    });
  }

  document.querySelector('#clients-table-body').innerHTML = enriched.length ? enriched.map(({ client, cards: clientCards, timedCards, timeBankSeconds, owner, links }) => `
    <tr class="editable-row" data-edit-client="${escapeHtml(client.id)}">
      <td><strong>${escapeHtml(client.name)}</strong></td>
      <td>${escapeHtml(client.company)}</td>
      <td>${renderEmails(client.email)}</td>
      <td>${links.length ? links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="client-link" data-stop-row-click>${escapeHtml(link.label)}</a>`).join(' ') : '<span style="color: var(--text-muted);">-</span>'}</td>
      <td>${owner ? escapeHtml(owner.name) : '<span style="color: var(--text-muted);">Sin asignar</span>'}</td>
      <td>${client.consultor ? consultorBadge(client.consultor) : '<span style="color: var(--text-muted);">-</span>'}</td>
      <td>${statusBadge(client.status || 'Activo')}</td>
      <td>${client.complexity ? complexityBadge(client.complexity) : '<span style="color: var(--text-muted);">-</span>'}</td>
      <td>${client.adStatus ? adStatusBadge(client.adStatus) : '<span style="color: var(--text-muted);">-</span>'}</td>
      <td>${formatMeeting(client)}</td>
      <td><span class="card-count">${clientCards.length} tareas</span></td>
      <td><span class="card-count">${timedCards.length} tags</span></td>
      <td>${timeBankSeconds ? `<span class="time-badge">${escapeHtml(formatDuration(timeBankSeconds))}</span>` : '<span style="color: var(--text-muted);">0m</span>'}</td>
      <td><button class="btn btn-secondary btn-sm" type="button" data-edit-client-button="${escapeHtml(client.id)}">Editar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="14" class="empty-table-message">No hay clientes con este estado.</td></tr>';

  document.querySelectorAll('.sortable-th').forEach((th) => {
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.sort === sortColumn) {
      icon.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sort-active');
    } else {
      icon.textContent = '';
      th.classList.remove('sort-active');
    }
    th.onclick = () => {
      if (sortColumn === th.dataset.sort) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = th.dataset.sort;
        sortDirection = 'asc';
      }
      renderDashboard();
    };
  });

  document.querySelectorAll('[data-edit-client]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('[data-stop-row-click]')) return;
      openClientModal(getClientById(row.dataset.editClient));
    });
  });
  document.querySelectorAll('[data-edit-client-button]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openClientModal(getClientById(button.dataset.editClientButton));
    });
  });
}

function renderClientStatusFilter() {
  const select = document.querySelector('[data-client-status-filter]');
  const statuses = getClientStatuses().map(getStatusName).filter(Boolean);
  if (selectedStatus && !statuses.includes(selectedStatus)) selectedStatus = '';
  select.innerHTML = `
    <option value="">Todos</option>
    ${statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === selectedStatus ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
  `;
  select.onchange = () => {
    selectedStatus = select.value;
    renderDashboard();
  };
  select.onclick = (event) => event.stopPropagation();
}

function getSortValue(row, column) {
  switch (column) {
    case 'name': return row.client.name.toLowerCase();
    case 'company': return row.client.company.toLowerCase();
    case 'email': return (row.client.email || '').toLowerCase();
    case 'links': return row.links.length;
    case 'owner': return (row.owner?.name || '').toLowerCase();
    case 'consultor': return (row.client.consultor || '').toLowerCase();
    case 'status': return (row.client.status || 'Activo').toLowerCase();
    case 'complexity': return (row.client.complexity || '').toLowerCase();
    case 'adStatus': return (row.client.adStatus || '').toLowerCase();
    case 'meeting': return row.client.meetingDay ?? 99;
    case 'cards': return row.cards.length;
    case 'timedCards': return row.timedCards.length;
    case 'timeBank': return row.timeBankSeconds;
    default: return '';
  }
}

function getClientById(clientId) {
  return state.clients.find((client) => String(client.id) === String(clientId));
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

function formatDuration(durationSeconds) {
  const minutes = Math.floor(durationSeconds / 60);
  const hours = Math.floor(durationSeconds / (60 * 60));
  const days = Math.floor(durationSeconds / (60 * 60 * 24));

  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function openClientModal(client = null) {
  const isEdit = Boolean(client);
  const existingLinks = isEdit ? (client.links || []) : [];
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Cliente' : 'Nuevo Cliente'}</div>
        <div class="form-group"><label>Nombre del Contacto</label><input type="text" id="client-name-input" class="form-control" placeholder="Ej. Laura Martinez" value="${escapeHtml(client?.name || '')}"></div>
        <div class="form-group"><label>Empresa</label><input type="text" id="client-company-input" class="form-control" placeholder="Ej. TechCorp" value="${escapeHtml(client?.company || '')}"></div>
        <div class="form-group"><label>Correos Electronicos <span style="color: var(--text-muted); font-weight: 400;">(uno por linea)</span></label><textarea id="client-email-input" class="form-control" rows="2" placeholder="cliente@techcorp.com&#10;otro@empresa.com">${escapeHtml(client?.email || '')}</textarea></div>
        <div class="form-group"><label>Personal a cargo</label><select id="client-owner-input" class="form-control">${userOptions(client?.ownerId || '')}</select></div>
        <div class="form-group">
          <label>Consultor</label>
          <select id="client-consultor-input" class="form-control">
            ${consultorOptions(client?.consultor || '')}
          </select>
        </div>
        <div class="form-group">
          <label>Estado del cliente</label>
          <select id="client-status-input" class="form-control">
            ${statusOptions(client?.status || 'Activo')}
          </select>
        </div>
        <div class="form-group">
          <label>Complejidad</label>
          <select id="client-complexity-input" class="form-control">
            <option value="">Sin complejidad</option>
            ${complexityOptions(client?.complexity || '')}
          </select>
        </div>
        <div class="form-group">
          <label>Publicidad</label>
          <select id="client-ad-status-input" class="form-control">
            <option value="">Sin definir</option>
            ${adStatusOptions(client?.adStatus || '')}
          </select>
        </div>
        <div class="form-group">
          <label>Usuario Meli</label>
          <input type="text" id="client-meli-user-input" class="form-control" placeholder="Ej. email@gmail.com | clave" value="${escapeHtml(client?.meliUser || '')}">
        </div>
        <div class="form-group">
          <label>Dia de reunion</label>
          <div style="display: flex; gap: 8px;">
            <select id="client-meeting-day" class="form-control" style="flex: 1;">
              <option value="">Sin reunion</option>
              ${[['1','Lunes'],['2','Martes'],['3','Miercoles'],['4','Jueves'],['5','Viernes'],['6','Sabado'],['0','Domingo']].map(([v,l]) =>
                `<option value="${v}" ${client?.meetingDay !== null && String(client?.meetingDay) === v ? 'selected' : ''}>${l}</option>`
              ).join('')}
            </select>
            <input type="time" id="client-meeting-time" class="form-control" style="flex: 1;" value="${escapeHtml((client?.meetingTime || '').slice(0, 5))}">
            <select id="client-meeting-freq" class="form-control" style="flex: 1;">
              <option value="">Frecuencia</option>
              <option value="7" ${client?.meetingFrequency === 7 ? 'selected' : ''}>Cada 7 dias</option>
              <option value="15" ${client?.meetingFrequency === 15 ? 'selected' : ''}>Cada 15 dias</option>
            </select>
          </div>
        </div>
        ${isEdit ? `
        <div class="form-group time-bank-panel">
          <label>Banco de tiempo acumulado</label>
          <div class="time-bank-reset-row">
            <span class="time-badge">${escapeHtml(formatDuration(Number(client.timeBankSeconds || 0)))}</span>
            <button class="btn btn-secondary btn-sm" type="button" data-reset-time-bank>Reiniciar banco</button>
          </div>
        </div>
        <div class="form-group">
          <label>Links</label>
          <div id="client-links-list">
            ${existingLinks.map((link) => `
              <div class="link-row" data-link-id="${escapeHtml(link.id)}">
                <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="client-link">${escapeHtml(link.label)}</a>
                <button class="btn btn-danger btn-sm" type="button" data-remove-link="${escapeHtml(link.id)}">Sacar</button>
              </div>
            `).join('')}
          </div>
          <div class="link-add-row">
            <input type="text" id="link-label-input" class="form-control" placeholder="Descripcion" style="flex: 1;">
            <input type="url" id="link-url-input" class="form-control" placeholder="https://..." style="flex: 1;">
            <button class="btn btn-secondary btn-sm" type="button" data-add-link>Agregar</button>
          </div>
        </div>
        ` : ''}
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Guardar Cliente'}</button>
        </div>
      </form>
    </div>
  `);

  if (isEdit) {
    overlay.querySelector('[data-reset-time-bank]').addEventListener('click', async function () {
      if (!confirm(`Reiniciar el banco de tiempo de ${client.name}? Esta accion no se puede deshacer.`)) return;
      setButtonLoading(this, true, 'Reiniciando...');
      try {
        await api(`/api/clients/${client.id}/time-bank/reset`, {
          method: 'POST',
          body: JSON.stringify(auditUser())
        });
        closeModal();
        await refresh();
      } catch (error) {
        setButtonLoading(this, false);
        alert(error.message);
      }
    });
    overlay.querySelector('[data-add-link]').addEventListener('click', async function () {
      const labelInput = overlay.querySelector('#link-label-input');
      const urlInput = overlay.querySelector('#link-url-input');
      const label = labelInput.value.trim();
      const url = urlInput.value.trim();
      if (!label || !url) return;
      setButtonLoading(this, true, 'Agregando...');
      try {
        const { link } = await api(`/api/clients/${client.id}/links`, {
          method: 'POST',
          body: JSON.stringify({ label, url })
        });
        const list = overlay.querySelector('#client-links-list');
        const row = document.createElement('div');
        row.className = 'link-row';
        row.dataset.linkId = link.id;
        row.innerHTML = `
          <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="client-link">${escapeHtml(link.label)}</a>
          <button class="btn btn-danger btn-sm" type="button" data-remove-link="${escapeHtml(link.id)}">Sacar</button>
        `;
        row.querySelector('[data-remove-link]').addEventListener('click', function () {
          removeLinkHandler(this, client.id);
        });
        list.appendChild(row);
        labelInput.value = '';
        urlInput.value = '';
      } catch (error) {
        alert(error.message);
      } finally {
        setButtonLoading(this, false);
      }
    });

    overlay.querySelectorAll('[data-remove-link]').forEach((button) => {
      button.addEventListener('click', function () {
        removeLinkHandler(this, client.id);
      });
    });
  }

  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const meetingDayVal = overlay.querySelector('#client-meeting-day').value;
    const payload = {
      name: overlay.querySelector('#client-name-input').value.trim(),
      company: overlay.querySelector('#client-company-input').value.trim(),
      email: overlay.querySelector('#client-email-input').value.trim(),
      ownerId: overlay.querySelector('#client-owner-input').value,
      consultor: overlay.querySelector('#client-consultor-input').value,
      status: overlay.querySelector('#client-status-input').value,
      complexity: overlay.querySelector('#client-complexity-input').value,
      adStatus: overlay.querySelector('#client-ad-status-input').value,
      meliUser: overlay.querySelector('#client-meli-user-input').value.trim(),
      meetingDay: meetingDayVal !== '' ? Number(meetingDayVal) : null,
      meetingTime: overlay.querySelector('#client-meeting-time').value || null,
      meetingFrequency: overlay.querySelector('#client-meeting-freq').value ? Number(overlay.querySelector('#client-meeting-freq').value) : null
    };
    if (!payload.name || !payload.company) return;
    if (isEdit && !client.id) {
      alert('No se pudo identificar el cliente. Actualiza la pagina e intenta de nuevo.');
      return;
    }
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');
    try {
      await api(isEdit ? `/api/clients/${client.id}` : '/api/clients', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...payload, ...auditUser() })
      });
      closeModal();
      await refresh();
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

async function removeLinkHandler(button, clientId) {
  const linkId = button.dataset.removeLink;
  if (button.classList.contains('btn-loading')) return;
  setButtonLoading(button, true, '...');
  try {
    await api(`/api/clients/${clientId}/links/${linkId}`, { method: 'DELETE' });
    button.closest('.link-row').remove();
  } catch (error) {
    setButtonLoading(button, false);
    alert(error.message);
  }
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

function adStatusOptions(selected) {
  const items = state.settings?.adStatuses || [];
  return items.map((item) => {
    const name = typeof item === 'string' ? item : item?.name || '';
    return `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
}

function complexityOptions(selected) {
  const complexities = state.settings?.complexities || [];
  return complexities.map((item) => {
    const name = typeof item === 'string' ? item : item?.name || '';
    return `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('');
}

function getClientConsultors() {
  return state.settings?.clientConsultors?.length ? state.settings.clientConsultors : [];
}

function consultorOptions(selected) {
  return `<option value="">Sin asignar</option>${getClientConsultors().map((item) => {
    const name = typeof item === 'string' ? item : item?.name || '';
    return `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  }).join('')}`;
}

function consultorBadge(name) {
  const item = getClientConsultors().find((entry) => (typeof entry === 'string' ? entry : entry?.name) === name);
  const color = item && typeof item === 'object' && isHexColor(item.color) ? item.color : '#388bfd';
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(color)};">${escapeHtml(name)}</span>`;
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

function adStatusBadge(name) {
  const items = state.settings?.adStatuses || [];
  const item = items.find((a) => (typeof a === 'string' ? a : a?.name) === name);
  const color = (item && typeof item === 'object' && isHexColor(item.color)) ? item.color : '#388bfd';
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(color)};">${escapeHtml(name)}</span>`;
}

function complexityBadge(name) {
  const complexities = state.settings?.complexities || [];
  const item = complexities.find((c) => (typeof c === 'string' ? c : c?.name) === name);
  const color = (item && typeof item === 'object' && isHexColor(item.color)) ? item.color : '#388bfd';
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(color)};">${escapeHtml(name)}</span>`;
}

function isHexColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
}

function formatMeeting(client) {
  if (client.meetingDay === null || client.meetingDay === undefined) return '<span style="color: var(--text-muted);">-</span>';
  const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const day = days[client.meetingDay];
  if (!day) return '<span style="color: var(--text-muted);">-</span>';
  const time = (client.meetingTime || '').slice(0, 5);
  const freq = client.meetingFrequency === 7 ? 'c/7d' : client.meetingFrequency === 15 ? 'c/15d' : '';
  const parts = [day, time, freq].filter(Boolean);
  return parts.length ? `<span class="meeting-badge">${escapeHtml(parts.join(' '))}</span>` : '<span style="color: var(--text-muted);">-</span>';
}

function renderGeneralLinks() {
  const links = state.generalLinks || [];
  const container = document.querySelector('#general-links-list');
  container.innerHTML = links.length ? links.map((link) => `
    <div class="general-link-card">
      <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="general-link-anchor">${escapeHtml(link.label)}</a>
      <button class="btn btn-danger btn-sm" type="button" data-remove-general-link="${escapeHtml(link.id)}">Sacar</button>
    </div>
  `).join('') : '<div class="empty-state">Sin links generales</div>';

  container.querySelectorAll('[data-remove-general-link]').forEach((button) => {
    button.addEventListener('click', async function () {
      if (this.classList.contains('btn-loading')) return;
      if (!confirm('Seguro que queres sacar este link?')) return;
      setButtonLoading(this, true, '...');
      try {
        await api(`/api/general-links/${this.dataset.removeGeneralLink}`, { method: 'DELETE' });
        await refresh();
      } catch (error) {
        setButtonLoading(this, false);
        alert(error.message);
      }
    });
  });
}

function openGeneralLinkModal() {
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Agregar Link General</div>
        <div class="form-group">
          <label>Descripcion</label>
          <input type="text" id="gl-label-input" class="form-control" placeholder="Ej. Drive del equipo">
        </div>
        <div class="form-group">
          <label>URL</label>
          <input type="url" id="gl-url-input" class="form-control" placeholder="https://...">
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">Agregar</button>
        </div>
      </form>
    </div>
  `);

  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const label = overlay.querySelector('#gl-label-input').value.trim();
    const url = overlay.querySelector('#gl-url-input').value.trim();
    if (!label || !url) return;
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Agregando...');
    try {
      await api('/api/general-links', { method: 'POST', body: JSON.stringify({ label, url }) });
      closeModal();
      await refresh();
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

function renderEmails(emailStr) {
  if (!emailStr) return '<span style="color: var(--text-muted);">N/A</span>';
  const emails = emailStr.split('\n').map((e) => e.trim()).filter(Boolean);
  if (!emails.length) return '<span style="color: var(--text-muted);">N/A</span>';
  return emails.map((email) => escapeHtml(email)).join('<br>');
}

function auditUser() {
  return { userId: currentUser.id, userName: currentUser.name };
}

boot();
