import { api, requireSession } from './api.js';
import { getActiveBoard, loadAppState, setActiveBoard } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml, getDueDateStatus, getInitials, getTimeInColumn } from './utils.js';

const currentUser = requireSession();
let state;
let draggedCardId = null;
let draggedColumnId = null;
let boardWriteQueue = Promise.resolve();

async function boot() {
  state = await loadAppState();
  renderPage();
}

async function refresh() {
  const activeBoardId = state.activeBoardId;
  state = await loadAppState();
  if (state.boards.some((board) => board.id === activeBoardId)) setActiveBoard(state, activeBoardId);
  renderPage();
}

function renderPage() {
  renderSidebar({
    state,
    currentUser,
    activePage: 'kanban',
    onSelectBoard: (boardId) => {
      setActiveBoard(state, boardId);
      renderPage();
    },
    onRefresh: refresh
  });
  document.querySelector('[data-open-column]').onclick = openColumnModal;
  document.querySelector('[data-open-settings]').onclick = openBoardSettings;
  renderActiveBoard();
}

function renderActiveBoard() {
  const board = getActiveBoard(state);
  if (!board) return;
  document.querySelector('#current-board-title').textContent = board.name;
  document.querySelector('#current-board-color').style.backgroundColor = board.color;
  document.querySelector('#kanban-board').innerHTML = board.columns.map((column) => renderColumn(board, column)).join('');
  bindKanbanEvents();
}

function renderColumn(board, column) {
  const cards = board.cards.filter((card) => card.columnId === column.id);
  return `
    <section class="column ${column.showTimer ? 'timer-column' : ''}" draggable="true" data-column-id="${escapeHtml(column.id)}">
      <div class="column-header">
        <div class="column-title">
          <span class="drag-handle">::</span>
          <span>${escapeHtml(column.name)}</span>
          <span class="card-count">${cards.length}</span>
          ${column.showTimer ? '<span class="timer-column-badge">Controla tiempo</span>' : ''}
        </div>
        <button class="btn-icon" type="button" data-delete-column="${escapeHtml(column.id)}" title="Eliminar columna">Eliminar</button>
      </div>
      <div class="cards-container" data-card-drop="${escapeHtml(column.id)}">
        ${cards.map((card) => renderCard(card, column.showTimer)).join('')}
      </div>
      <button class="add-card-btn" type="button" data-add-card="${escapeHtml(column.id)}">+ Anadir tarjeta</button>
    </section>
  `;
}

function renderCard(card, showTimer) {
  const client = state.clients.find((item) => item.id === card.clientId);
  const assignee = state.users.find((item) => item.id === card.assignedTo);
  const dueStatus = getDueDateStatus(card.dueDate);
  return `
    <article class="card" draggable="true" id="${escapeHtml(card.id)}" data-card-id="${escapeHtml(card.id)}">
      ${client ? `<div class="client-badge">${escapeHtml(client.company)}</div>` : ''}
      <div class="card-title">${escapeHtml(card.title)}</div>
      ${card.description ? `<div class="card-description">${escapeHtml(card.description)}</div>` : ''}
      <div class="badges-container">
        ${dueStatus ? `<div class="due-date-badge ${dueStatus.status}">${escapeHtml(dueStatus.label)}</div>` : ''}
        ${showTimer ? `<div class="time-badge">${escapeHtml(getTimeInColumn(card.enteredColumnAt))}</div>` : ''}
      </div>
      <div class="card-meta">
        <span>Cliente: ${client ? escapeHtml(client.name) : 'Sin asignar'}</span>
        <div>${assignee ? `<div class="avatar">${getInitials(assignee.name)}</div>` : '<span style="opacity:0.5;">-</span>'}</div>
      </div>
    </article>
  `;
}

function bindKanbanEvents() {
  document.querySelectorAll('[data-add-card]').forEach((button) => {
    button.addEventListener('click', () => openCardModal(button.dataset.addCard));
  });
  document.querySelectorAll('[data-delete-column]').forEach((button) => {
    button.addEventListener('click', () => deleteColumn(button.dataset.deleteColumn));
  });
  document.querySelectorAll('[data-card-id]').forEach((card) => {
    card.addEventListener('click', () => openCardDetail(card.dataset.cardId));
    card.addEventListener('dragstart', (event) => {
      event.stopPropagation();
      draggedCardId = card.dataset.cardId;
      draggedColumnId = null;
      event.dataTransfer.setData('type', 'card');
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.cards-container').forEach((item) => item.classList.remove('card-drag-over'));
      draggedCardId = null;
    });
  });
  document.querySelectorAll('[data-card-drop]').forEach((drop) => {
    drop.addEventListener('dragover', (event) => {
      if (draggedCardId) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        drop.classList.add('card-drag-over');
      }
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('card-drag-over'));
    drop.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!draggedCardId) return;
      drop.classList.remove('card-drag-over');
      await moveCard(draggedCardId, drop.dataset.cardDrop);
      draggedCardId = null;
    });
  });
  document.querySelectorAll('[data-column-id]').forEach((column) => {
    column.addEventListener('dragstart', (event) => {
      if (draggedCardId) return;
      draggedColumnId = column.dataset.columnId;
      event.dataTransfer.setData('type', 'column');
      column.classList.add('dragging');
    });
    column.addEventListener('dragend', () => {
      column.classList.remove('dragging');
      document.querySelectorAll('.column').forEach((item) => item.classList.remove('drag-over'));
      draggedColumnId = null;
    });
    column.addEventListener('dragover', (event) => {
      if (draggedColumnId) {
        event.preventDefault();
        column.classList.add('drag-over');
      }
    });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', async (event) => {
      if (!draggedColumnId || draggedColumnId === column.dataset.columnId) return;
      event.preventDefault();
      await moveColumn(draggedColumnId, column.dataset.columnId);
    });
  });
}

async function openColumnModal() {
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Nueva Columna</div>
        <div class="form-group">
          <label for="column-name-input">Nombre de la columna</label>
          <input type="text" id="column-name-input" class="form-control" placeholder="Ej. En Revision">
        </div>
        <div class="form-group">
          <label class="checkbox-group"><input type="checkbox" id="column-timer-toggle" checked><span>Mostrar tiempo en esta columna</span></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">Crear Columna</button>
        </div>
      </form>
    </div>
  `);
  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const board = getActiveBoard(state);
    const name = overlay.querySelector('#column-name-input').value.trim();
    if (!name || !board) return;
    submitting = true;
    await api(`/api/boards/${board.id}/columns`, {
      method: 'POST',
      body: JSON.stringify({ name, showTimer: overlay.querySelector('#column-timer-toggle').checked, ...auditUser() })
    });
    closeModal();
    await refresh();
  });
}

function openCardModal(columnId, card = null) {
  const isEdit = Boolean(card);
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Detalle de la Tarjeta' : 'Nueva Tarjeta'}</div>
        <div class="form-group"><label>Titulo</label><input type="text" id="card-title-input" class="form-control" value="${escapeHtml(card?.title || '')}"></div>
        <div class="form-group"><label>Cliente</label><select id="card-client-select" class="form-control">${clientOptions(card?.clientId)}</select></div>
        <div class="form-group"><label>Descripcion</label><textarea id="card-desc-input" class="form-control" rows="3">${escapeHtml(card?.description || '')}</textarea></div>
        <div class="form-group"><label>Fecha de Vencimiento</label><input type="date" id="card-due-input" class="form-control" value="${escapeHtml(card?.dueDate || '')}"></div>
        <div class="form-group"><label>Asignar a</label><select id="card-assignee-select" class="form-control">${userOptions(card?.assignedTo)}</select></div>
        <div class="modal-actions" style="justify-content: ${isEdit ? 'space-between' : 'flex-end'};">
          ${isEdit ? '<button class="btn btn-danger" type="button" data-delete-card>Eliminar Tarjeta</button>' : ''}
          <div>
            <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
            <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Crear Tarjeta'}</button>
          </div>
        </div>
      </form>
    </div>
  `);
  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    await saveCard(columnId, card);
  });
  overlay.querySelector('[data-delete-card]')?.addEventListener('click', async () => {
    await deleteCard(card.id);
  });
}

function openCardDetail(cardId) {
  const board = getActiveBoard(state);
  const card = board.cards.find((item) => item.id === cardId);
  if (card) openCardModal(card.columnId, card);
}

async function saveCard(columnId, card) {
  const board = getActiveBoard(state);
  const payload = {
    columnId,
    title: document.querySelector('#card-title-input').value.trim(),
    clientId: document.querySelector('#card-client-select').value,
    description: document.querySelector('#card-desc-input').value.trim(),
    dueDate: document.querySelector('#card-due-input').value,
    assignedTo: document.querySelector('#card-assignee-select').value,
    createdBy: currentUser.id,
    ...auditUser()
  };
  if (!payload.title) return;
  const path = card ? `/api/boards/${board.id}/cards/${card.id}` : `/api/boards/${board.id}/cards`;
  await api(path, { method: card ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
  closeModal();
  await refresh();
}

async function deleteCard(cardId) {
  const board = getActiveBoard(state);
  await api(`/api/boards/${board.id}/cards/${cardId}`, { method: 'DELETE', body: JSON.stringify(auditUser()) });
  closeModal();
  await refresh();
}

async function moveCard(cardId, columnId) {
  const board = getActiveBoard(state);
  const card = board.cards.find((item) => item.id === cardId);
  if (!card || card.columnId === columnId) return;
  const payload = { ...card, columnId, ...auditUser() };
  card.columnId = columnId;
  card.enteredColumnAt = Date.now();
  renderActiveBoard();
  try {
    await enqueueBoardWrite(() => api(`/api/boards/${board.id}/cards/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }));
  } catch (error) {
    alert(error.message);
    await refresh();
  }
}

async function moveColumn(originId, targetId) {
  const board = getActiveBoard(state);
  const columns = [...board.columns];
  const originIndex = columns.findIndex((column) => column.id === originId);
  const targetIndex = columns.findIndex((column) => column.id === targetId);
  const [movedColumn] = columns.splice(originIndex, 1);
  columns.splice(targetIndex, 0, movedColumn);
  board.columns = columns;
  renderActiveBoard();
  try {
    await enqueueBoardWrite(() => api(`/api/boards/${board.id}/columns/order`, {
      method: 'PATCH',
      body: JSON.stringify({ columnIds: columns.map((column) => column.id), ...auditUser() })
    }));
  } catch (error) {
    alert(error.message);
    await refresh();
  }
}

async function deleteColumn(columnId) {
  const board = getActiveBoard(state);
  const cardsInColumn = board.cards.filter((card) => card.columnId === columnId);
  if (board.columns.length <= 1) return alert('El tablero debe conservar al menos una columna.');
  if (cardsInColumn.length > 0) return alert('No puedes eliminar una columna que contiene tarjetas.');
  if (!confirm('Seguro que deseas eliminar esta columna?')) return;
  await api(`/api/boards/${board.id}/columns/${columnId}`, { method: 'DELETE', body: JSON.stringify(auditUser()) });
  await refresh();
}

function openBoardSettings() {
  const board = getActiveBoard(state);
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Configuracion del Tablero</div>
        <div class="form-group">
          <label>Nombre del tablero</label>
          <input type="text" id="setting-board-name" class="form-control" value="${escapeHtml(board.name)}">
        </div>
        <div class="modal-actions" style="justify-content: space-between;">
          <button class="btn btn-danger" type="button" data-delete-board>Eliminar Tablero</button>
          <div>
            <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
            <button class="btn" type="submit">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const name = overlay.querySelector('#setting-board-name').value.trim();
    if (!name) return;
    submitting = true;
    await api(`/api/boards/${board.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, ...auditUser() })
    });
    closeModal();
    await refresh();
  });
  overlay.querySelector('[data-delete-board]').addEventListener('click', async () => {
    if (state.boards.length <= 1) return alert('Debes conservar al menos un tablero.');
    await api(`/api/boards/${board.id}`, { method: 'DELETE', body: JSON.stringify(auditUser()) });
    closeModal();
    state = await loadAppState();
    localStorage.setItem('activeBoardId', state.activeBoardId);
    renderPage();
  });
}

function clientOptions(selectedId = '') {
  return `<option value="">Sin Cliente</option>${state.clients.map((client) => `
    <option value="${escapeHtml(client.id)}" ${client.id === selectedId ? 'selected' : ''}>${escapeHtml(client.name)} (${escapeHtml(client.company)})</option>
  `).join('')}`;
}

function userOptions(selectedId = '') {
  return `<option value="">Sin Asignar</option>${state.users.map((user) => `
    <option value="${escapeHtml(user.id)}" ${user.id === selectedId ? 'selected' : ''}>${escapeHtml(user.name)}</option>
  `).join('')}`;
}

function enqueueBoardWrite(operation) {
  const result = boardWriteQueue.then(operation, operation);
  boardWriteQueue = result.catch(() => {});
  return result;
}

function auditUser() {
  return { userId: currentUser.id, userName: currentUser.name };
}

boot();
