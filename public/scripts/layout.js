import { api, clearSession, setSessionUser, getSessionToken } from './api.js';
import { escapeHtml, getInitials, setButtonLoading } from './utils.js';

export function renderSidebar({ state, currentUser, activePage, onRefresh }) {
  const sidebar = document.querySelector('[data-sidebar]');
  sidebar.innerHTML = `
    <a class="logo" href="/dashboard">WIM</a>
    <a class="nav-btn ${activePage === 'dashboard' ? 'active' : ''}" href="/dashboard">Dashboard</a>

    <a class="nav-btn ${activePage === 'tableros' ? 'active' : ''}" href="/tableros">Tableros</a>
    <a class="nav-btn ${activePage === 'calendarios' ? 'active' : ''}" href="/calendarios">Calendarios</a>
    <a class="nav-btn ${activePage === 'usuarios' ? 'active' : ''}" href="/usuarios">Usuarios</a>

    <div class="sidebar-settings">
      <div class="section-title">Configuracion</div>
      <a class="nav-btn ${activePage === 'configuracion' ? 'active' : ''}" href="/configuracion">Configuracion</a>
    </div>

    <div class="user-profile">
      <div class="inline-user" data-open-profile style="cursor: pointer;" title="Editar perfil">
        <div class="avatar">${getInitials(currentUser.name)}</div>
        <span style="font-size: 0.85rem; font-weight: 500;">${escapeHtml(currentUser.name)}</span>
      </div>
      <button class="btn btn-secondary btn-sm" type="button" data-logout>Salir</button>
    </div>
  `;

  sidebar.querySelector('[data-logout]').addEventListener('click', () => {
    clearSession();
    window.location.href = '/login';
  });

  sidebar.querySelector('[data-open-profile]').addEventListener('click', () => openProfileModal({ currentUser, onRefresh }));

  initSidebarToggle();
}

function initSidebarToggle() {
  const toggle = document.querySelector('.sidebar-toggle');
  const overlay = document.querySelector('.sidebar-overlay');
  const sidebar = document.querySelector('[data-sidebar]');
  if (!toggle || !overlay || !sidebar) return;

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    toggle.innerHTML = '&#10005;';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    toggle.innerHTML = '&#9776;';
  }

  toggle.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  overlay.addEventListener('click', closeSidebar);

  // Close sidebar when navigating via board click on mobile
  sidebar.addEventListener('click', (e) => {
    const link = e.target.closest('a.nav-btn, [data-board-id]');
    if (link && window.innerWidth <= 780) closeSidebar();
  });
}

async function deleteBoard({ state, currentUser, boardId, onRefresh, button }) {
  if (state.boards.length <= 1) {
    alert('Debe conservarse al menos un tablero.');
    return;
  }

  const board = state.boards.find((item) => item.id === boardId);
  if (!board) return;
  if (!confirm(`Seguro que deseas eliminar el tablero "${board.name}"?`)) return;

  if (button) setButtonLoading(button, true, '...');
  try {
    await api(`/api/boards/${boardId}`, {
      method: 'DELETE',
      body: JSON.stringify(auditUser(currentUser))
    });
    if (state.activeBoardId === boardId) {
      const nextBoard = state.boards.find((item) => item.id !== boardId);
      if (nextBoard) localStorage.setItem('activeBoardId', nextBoard.id);
    }
    await onRefresh();
  } catch (error) {
    if (button) setButtonLoading(button, false);
    alert(error.message);
  }
}

export function openUserSummaryModal({ state, userId }) {
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
              <th>Complejidad</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${clients.length ? clients.map((client) => `
              <tr>
                <td><strong>${escapeHtml(client.name)}</strong></td>
                <td>${escapeHtml(client.company)}</td>
                <td>${client.complexity ? complexityBadge(state, client.complexity) : '<span style="color: var(--text-muted);">-</span>'}</td>
                <td>${statusBadge(state, client.status || 'Activo')}</td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="4" style="color: var(--text-muted);">Sin clientes asignados</td>
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

function complexityBadge(state, name) {
  const complexities = state.settings?.complexities || [];
  const item = complexities.find((c) => (typeof c === 'string' ? c : c?.name) === name);
  const color = (item && typeof item === 'object' && isHexColor(item.color)) ? item.color : '#388bfd';
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(color)};">${escapeHtml(name)}</span>`;
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

export function openBoardModal({ state, currentUser, onRefresh }) {
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

  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const name = overlay.querySelector('#board-name-input').value.trim();
    if (!name) return;
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Creando...');
    try {
      const { board } = await api('/api/boards', { method: 'POST', body: JSON.stringify({ name, ...auditUser(currentUser) }) });
      state.activeBoardId = board.id;
      localStorage.setItem('activeBoardId', board.id);
      closeModal();
      await onRefresh();
      window.location.href = '/kanban';
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

function auditUser(currentUser) {
  return { userId: currentUser.id, userName: currentUser.name };
}

function openProfileModal({ currentUser, onRefresh }) {
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Editar Perfil</div>
        <div class="form-group">
          <label for="profile-name-input">Nombre</label>
          <input type="text" id="profile-name-input" class="form-control" value="${escapeHtml(currentUser.name)}" required>
        </div>
        <div class="form-group">
          <label for="profile-password-input">Nueva contrasena</label>
          <input type="password" id="profile-password-input" class="form-control" autocomplete="new-password" minlength="6" placeholder="Dejar vacio para no cambiar">
          <small style="color: var(--text-muted); font-size: 0.75rem;">Minimo 6 caracteres.</small>
        </div>
        <div id="profile-error" style="display: none; color: var(--error); font-size: 0.8rem; margin-bottom: 8px;"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">Guardar</button>
        </div>
      </form>
    </div>
  `);

  const errorEl = overlay.querySelector('#profile-error');
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }

  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    errorEl.style.display = 'none';
    const name = overlay.querySelector('#profile-name-input').value.trim();
    const password = overlay.querySelector('#profile-password-input').value;
    if (!name) return showError('El nombre es obligatorio');
    if (password && password.length < 6) return showError('La contrasena debe tener al menos 6 caracteres');
    const noChanges = name === currentUser.name && !password;
    if (noChanges) { closeModal(); return; }
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');
    try {
      const payload = {};
      if (name !== currentUser.name) payload.name = name;
      if (password) payload.password = password;
      const { user } = await api('/api/users/me', { method: 'PATCH', body: JSON.stringify(payload) });
      setSessionUser(user, getSessionToken());
      closeModal();
      await onRefresh();
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      showError(error.message);
    }
  });
}

export function openInviteModal({ onRefresh }) {
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Invitar Usuario</div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">Crea una cuenta para que el usuario pueda iniciar sesion.</p>
        <div class="form-group">
          <label for="invite-name-input">Nombre completo</label>
          <input type="text" id="invite-name-input" class="form-control" placeholder="Ej. Ana Gomez" required>
        </div>
        <div class="form-group">
          <label for="invite-email-input">Correo electronico</label>
          <input type="email" id="invite-email-input" class="form-control" placeholder="usuario@correo.com" required>
        </div>
        <div class="form-group">
          <label for="invite-password-input">Contrasena inicial</label>
          <input type="password" id="invite-password-input" class="form-control" autocomplete="new-password" minlength="6" required>
          <small style="color: var(--text-muted); font-size: 0.75rem;">Minimo 6 caracteres. El usuario podra cambiarla despues.</small>
        </div>
        <div id="invite-error" style="display: none; color: var(--error); font-size: 0.8rem; margin-bottom: 8px;"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">Crear Usuario</button>
        </div>
      </form>
    </div>
  `);

  const errorEl = overlay.querySelector('#invite-error');
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }

  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    errorEl.style.display = 'none';
    const name = overlay.querySelector('#invite-name-input').value.trim();
    const email = overlay.querySelector('#invite-email-input').value.trim();
    const password = overlay.querySelector('#invite-password-input').value;
    if (!name) return showError('El nombre es obligatorio');
    if (!email) return showError('El correo es obligatorio');
    if (password.length < 6) return showError('La contrasena debe tener al menos 6 caracteres');
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Creando...');
    try {
      const result = await api('/api/users/invitations', { method: 'POST', body: JSON.stringify({ name, email, password }) });
      closeModal();
      if (result.invited === false) {
        alert(`El usuario ${email} ya existe en el sistema.`);
      }
      await onRefresh();
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      showError(error.message);
    }
  });
}
