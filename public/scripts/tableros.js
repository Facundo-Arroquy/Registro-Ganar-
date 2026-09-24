import { requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { renderSidebar, openBoardModal } from './layout.js';
import { escapeHtml } from './utils.js';

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
    activePage: 'tableros',
    onRefresh: refresh
  });

  document.querySelector('#new-board-btn').onclick = () =>
    openBoardModal({ state, currentUser, onRefresh: refresh });

  renderBoards();
}

function renderBoards() {
  const grid = document.querySelector('#boards-grid');
  if (!state.boards.length) {
    grid.innerHTML = '<p style="color: var(--text-muted);">No hay tableros creados.</p>';
    return;
  }

  grid.innerHTML = state.boards.map((board) => {
    const columnCount = board.columns?.length || 0;
    const cardCount = board.cards?.length || 0;
    return `
      <div class="board-card" data-board-id="${escapeHtml(board.id)}">
        <div class="board-card-color" style="background-color: ${escapeHtml(board.color)}"></div>
        <h3 class="board-card-name">${escapeHtml(board.name)}</h3>
        <div class="board-card-meta">
          <span>${columnCount} columna${columnCount !== 1 ? 's' : ''}</span>
          <span>${cardCount} tarjeta${cardCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-board-id]').forEach((card) => {
    card.addEventListener('click', () => {
      localStorage.setItem('activeBoardId', card.dataset.boardId);
      window.location.href = '/kanban';
    });
  });
}

boot();
