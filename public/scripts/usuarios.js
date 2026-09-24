import { requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { renderSidebar, openInviteModal, openUserSummaryModal } from './layout.js';
import { escapeHtml, getInitials } from './utils.js';

const currentUser = requireSession();
let state;

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
    activePage: 'usuarios',
    onRefresh: refresh
  });

  document.querySelector('#invite-user-btn').onclick = () =>
    openInviteModal({ onRefresh: refresh });

  renderUsers();
}

function renderUsers() {
  const grid = document.querySelector('#users-grid');
  if (!state.users.length) {
    grid.innerHTML = '<p style="color: var(--text-muted);">No hay usuarios registrados.</p>';
    return;
  }

  grid.innerHTML = state.users.map((user) => {
    const clientCount = state.clients.filter((c) => c.ownerId === user.id).length;
    return `
      <div class="user-card" data-user-id="${escapeHtml(user.id)}">
        <div class="user-card-avatar">${getInitials(user.name)}</div>
        <h3 class="user-card-name">${escapeHtml(user.name)}</h3>
        <p class="user-card-email">${escapeHtml(user.email)}</p>
        <div class="user-card-meta">
          <span>${clientCount} cliente${clientCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-user-id]').forEach((card) => {
    card.addEventListener('click', () => {
      openUserSummaryModal({ state, userId: card.dataset.userId });
    });
  });
}

boot();
