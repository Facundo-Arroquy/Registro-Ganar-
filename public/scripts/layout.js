import { api, clearSession } from './api.js';
import { escapeHtml, getInitials } from './utils.js';

export function renderSidebar({ state, currentUser, activePage, onRefresh }) {
  const sidebar = document.querySelector('[data-sidebar]');
  sidebar.innerHTML = `
    <a class="logo" href="/dashboard">Gemini CRM</a>
    <a class="nav-btn ${activePage === 'dashboard' ? 'active' : ''}" href="/dashboard">Dashboard</a>

    <div class="section-title">Tableros</div>
    <ul class="board-list" id="board-list"></ul>
    <button class="btn btn-secondary" type="button" data-open-board style="width: 100%; margin-bottom: 20px;">Nuevo Tablero</button>

    <div class="section-title">Usuarios</div>
    <ul class="user-list" id="user-list"></ul>
    <button class="btn btn-secondary" type="button" data-open-invite style="width: 100%;">Invitar Usuario</button>

    <div class="sidebar-settings">
      <div class="section-title">Configuracion</div>
      <a class="nav-btn ${activePage === 'configuracion' ? 'active' : ''}" href="/configuracion">Configuracion</a>
    </div>

    <div class="user-profile">
      <div class="inline-user">
        <div class="avatar">${getInitials(currentUser.name)}</div>
        <span style="font-size: 0.85rem; font-weight: 500;">${escapeHtml(currentUser.name)}</span>
      </div>
      <button class="btn btn-secondary btn-sm" type="button" data-logout>Salir</button>
    </div>
  `;

  sidebar.querySelector('#board-list').innerHTML = state.boards.map((board) => `
    <li class="board-item ${board.id === state.activeBoardId ? 'active' : ''}" data-board-id="${escapeHtml(board.id)}">
      <div class="board-color-dot" style="background-color: ${escapeHtml(board.color)}"></div>
      <span>${escapeHtml(board.name)}</span>
      <button class="btn-icon board-delete-btn" type="button" data-delete-board="${escapeHtml(board.id)}" title="Eliminar tablero">Eliminar</button>
    </li>
  `).join('');

  sidebar.querySelector('#user-list').innerHTML = state.users.map((user) => `
    <li class="user-item" data-user-summary="${escapeHtml(user.id)}">
      <div class="avatar">${getInitials(user.name)}</div>
      <span>${escapeHtml(user.name)}</span>
    </li>
  `).join('');

  sidebar.querySelectorAll('[data-board-id]').forEach((item) => {
    item.addEventListener('click', () => {
      localStorage.setItem('activeBoardId', item.dataset.boardId);
      window.location.href = '/kanban';
    });
  });

  sidebar.querySelectorAll('[data-delete-board]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteBoard({ state, currentUser, boardId: button.dataset.deleteBoard, onRefresh });
    });
  });

  sidebar.querySelectorAll('[data-user-summary]').forEach((item) => {
    item.addEventListener('click', () => openUserSummaryModal({ state, userId: item.dataset.userSummary }));
  });

  sidebar.querySelector('[data-logout]').addEventListener('click', () => {
    clearSession();
    window.location.href = '/login';
  });

  sidebar.querySelector('[data-open-board]').addEventListener('click', () => openBoardModal({ state, currentUser, onRefresh }));
  sidebar.querySelector('[data-open-invite]').addEventListener('click', () => openInviteModal({ onRefresh }));
}

async function deleteBoard({ state, currentUser, boardId, onRefresh }) {
  if (state.boards.length <= 1) {
    alert('Debe conservarse al menos un tablero.');
    return;
  }

  const board = state.boards.find((item) => item.id === boardId);
  if (!board) return;
  if (!confirm(`Seguro que deseas eliminar el tablero "${board.name}"?`)) return;

  await api(`/api/boards/${boardId}`, {
    method: 'DELETE',
    body: JSON.stringify(auditUser(currentUser))
  });
  if (state.activeBoardId === boardId) {
    const nextBoard = state.boards.find((item) => item.id !== boardId);
    if (nextBoard) localStorage.setItem('activeBoardId', nextBoard.id);
  }
  await onRefresh();
}

function openUserSummaryModal({ state, userId }) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  const clients = state.clients.filter((client) => client.ownerId === user.id);

  openModal(`
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <span>${escapeHtml(user.name)}</span>
          <button class="btn-icon" type="button" data-close-modal>Cerrar</button>
        </div>
        <div class="stat-card" style="margin-bottom: 16px;">
          <h3>Clientes a cargo</h3>
          <div class="value">${clients.length}</div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Empresa</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${clients.length ? clients.map((client) => `
              <tr>
                <td><strong>${escapeHtml(client.name)}</strong></td>
                <td>${escapeHtml(client.company)}</td>
                <td>${statusBadge(state, client.status || 'Activo')}</td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="3" style="color: var(--text-muted);">Sin clientes asignados</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `);
}

function statusBadge(state, status) {
  const color = getStatusColor(state, status);
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(color)};">${escapeHtml(status)}</span>`;
}

function getStatusColor(state, status) {
  const statuses = state.settings?.clientStatuses || [];
  const statusItem = statuses.find((item) => getStatusName(item) === status);
  if (statusItem && typeof statusItem === 'object' && isHexColor(statusItem.color)) return statusItem.color;
  const defaults = {
    Activo: '#3fb950',
    'En pausa': '#d29922',
    Riesgo: '#f85149',
    Cerrado: '#8b949e'
  };
  return defaults[status] || '#388bfd';
}

function getStatusName(status) {
  return typeof status === 'string' ? status : status?.name || '';
}

function isHexColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
}

export function openModal(html) {
  const root = document.querySelector('#modal-root');
  root.innerHTML = html;
  const overlay = root.querySelector('.modal-overlay');
  requestAnimationFrame(() => overlay.classList.add('active'));
  overlay.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  return overlay;
}

export function closeModal() {
  const root = document.querySelector('#modal-root');
  const overlay = root.querySelector('.modal-overlay');
  if (overlay) overlay.classList.remove('active');
  setTimeout(() => {
    root.innerHTML = '';
  }, 160);
}

function openBoardModal({ state, currentUser, onRefresh }) {
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Crear Tablero</div>
        <div class="form-group">
          <label for="board-name-input">Nombre</label>
          <input type="text" id="board-name-input" class="form-control" placeholder="Ej. Tablero Sprint">
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">Crear</button>
        </div>
      </form>
    </div>
  `);

  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = overlay.querySelector('#board-name-input').value.trim();
    if (!name) return;
    const { board } = await api('/api/boards', { method: 'POST', body: JSON.stringify({ name, ...auditUser(currentUser) }) });
    state.activeBoardId = board.id;
    localStorage.setItem('activeBoardId', board.id);
    closeModal();
    await onRefresh();
    window.location.href = '/kanban';
  });
}

function auditUser(currentUser) {
  return { userId: currentUser.id, userName: currentUser.name };
}

function openInviteModal({ onRefresh }) {
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Enviar Invitacion</div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Ingresa el correo del nuevo usuario.</p>
        <div class="form-group">
          <label for="invite-email-input">Correo Electronico</label>
          <input type="email" id="invite-email-input" class="form-control" placeholder="usuario@correo.com">
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">Enviar</button>
        </div>
      </form>
    </div>
  `);

  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = overlay.querySelector('#invite-email-input').value.trim();
    if (!email) return;
    await api('/api/users/invitations', { method: 'POST', body: JSON.stringify({ email }) });
    closeModal();
    await onRefresh();
  });
}
