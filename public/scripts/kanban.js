import { api, requireSession } from './api.js';
import { getActiveBoard, loadAppState, refreshAppState, setActiveBoard } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml, formatTimerDuration, getDueDateStatus, getInitials, setButtonLoading } from './utils.js';

const currentUser = requireSession();
let state;
let draggedCardId = null;
let draggedColumnId = null;
let boardWriteQueue = Promise.resolve();
let timerInterval = null;
let selectedClientId = '';

async function boot() {
  state = await loadAppState();
  renderPage();
}

async function refresh() {
  const activeBoardId = state.activeBoardId;
  state = await refreshAppState();
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
      selectedClientId = '';
      renderPage();
    },
    onRefresh: refresh
  });
  document.querySelector('[data-open-recurring]').onclick = openRecurringTasksPanel;
  document.querySelector('[data-open-column]').onclick = openColumnModal;
  document.querySelector('[data-open-settings]').onclick = openBoardSettings;
  renderActiveBoard();
}

function renderActiveBoard() {
  const board = getActiveBoard(state);
  if (!board) return;
  document.querySelector('#current-board-title').textContent = board.name;
  document.querySelector('#current-board-color').style.backgroundColor = board.color;
  renderClientFilter(board);
  document.querySelector('#kanban-board').innerHTML = board.columns.map((column) => renderColumn(board, column)).join('');
  bindKanbanEvents();
  startTimerRefresh();
}

function renderColumn(board, column) {
  const cards = board.cards.filter((card) => (
    card.columnId === column.id
    && (!selectedClientId || (card.clientIds || []).includes(selectedClientId) || card.clientId === selectedClientId)
  ));
  return `
    <section class="column" draggable="true" data-column-id="${escapeHtml(column.id)}">
      <div class="column-header">
        <div class="column-title">
          <span class="drag-handle">::</span>
          <span>${escapeHtml(column.name)}</span>
          <span class="card-count">${cards.length}</span>
        </div>
        <button class="btn-icon" type="button" data-delete-column="${escapeHtml(column.id)}" title="Eliminar columna">Eliminar</button>
      </div>
      <div class="cards-container" data-card-drop="${escapeHtml(column.id)}">
        ${cards.map((card) => renderCard(card)).join('')}
      </div>
      <button class="add-card-btn" type="button" data-add-card="${escapeHtml(column.id)}">+ Anadir tarjeta</button>
    </section>
  `;
}

function renderClientFilter(board) {
  const select = document.querySelector('#board-client-filter');
  const clientIdsWithCards = new Set(board.cards.flatMap((card) => card.clientIds || (card.clientId ? [card.clientId] : [])));
  const clients = state.clients
    .filter((client) => clientIdsWithCards.has(client.id))
    .sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name, 'es'));

  if (selectedClientId && !clientIdsWithCards.has(selectedClientId)) selectedClientId = '';
  select.innerHTML = `
    <option value="">Todos los clientes (${clients.length})</option>
    ${clients.map((client) => {
      const cardCount = board.cards.filter((card) => (card.clientIds || []).includes(client.id) || card.clientId === client.id).length;
      return `<option value="${escapeHtml(client.id)}" ${client.id === selectedClientId ? 'selected' : ''}>${escapeHtml(client.company || client.name)} (${cardCount})</option>`;
    }).join('')}
  `;
  select.onchange = () => {
    selectedClientId = select.value;
    renderActiveBoard();
  };
}

function renderCard(card) {
  const cardClients = (card.clientIds || []).map((id) => state.clients.find((item) => item.id === id)).filter(Boolean);
  if (!cardClients.length && card.clientId) { const fallback = state.clients.find((item) => item.id === card.clientId); if (fallback) cardClients.push(fallback); }
  const assignee = state.users.find((item) => item.id === card.assignedTo);
  const dueStatus = getDueDateStatus(card.dueDate, card.resolved);
  return `
    <article class="card" draggable="true" id="${escapeHtml(card.id)}" data-card-id="${escapeHtml(card.id)}">
      ${cardClients.length ? `<div class="client-badges">${cardClients.map((c) => `<div class="client-badge">${escapeHtml(c.company)}</div>`).join('')}</div>` : ''}
      <div class="card-title">${escapeHtml(card.title)}</div>
      ${card.description ? `<div class="card-description">${escapeHtml(card.description)}</div>` : ''}
      <div class="badges-container">
        ${card.recurringTaskId ? '<div class="recurring-badge" title="Tarea recurrente">↻ Recurrente</div>' : ''}
        ${card.resolved ? '<div class="due-date-badge resolved">Resuelta</div>' : dueStatus ? `<div class="due-date-badge ${dueStatus.status}">${escapeHtml(dueStatus.label)}</div>` : ''}
        <button class="quick-resolve-btn ${card.resolved ? 'reopen' : ''}" type="button" data-toggle-resolved="${escapeHtml(card.id)}">${card.resolved ? 'Reabrir' : 'Resolver'}</button>
        ${renderCardTimer(card)}
      </div>
      <div class="card-meta">
        <span>${cardClients.length ? cardClients.map((c) => escapeHtml(c.name)).join(', ') : 'Sin cliente'}</span>
        <div>${assignee ? `<div class="avatar">${getInitials(assignee.name)}</div>` : '<span style="opacity:0.5;">-</span>'}</div>
      </div>
    </article>
  `;
}

function currentTimerSeconds(card) {
  const runningSeconds = card.timerStatus === 'running' && card.timerStartedAt
    ? Math.max(0, Math.floor((Date.now() - card.timerStartedAt) / 1000))
    : 0;
  return Number(card.timerElapsedSeconds || 0) + runningSeconds;
}

function renderCardTimer(card) {
  const action = card.timerStatus === 'idle' ? 'start' : card.timerStatus === 'running' ? 'pause' : card.timerStatus === 'paused' ? 'resume' : '';
  const label = action === 'start' ? 'Iniciar' : action === 'pause' ? 'Pausar' : action === 'resume' ? 'Continuar' : '';
  return `<div class="card-timer ${escapeHtml(card.timerStatus)}">
    <span class="time-badge" data-timer-value="${escapeHtml(card.id)}">${formatTimerDuration(currentTimerSeconds(card))}</span>
    ${action ? `<button class="timer-action" type="button" data-timer-action="${action}" data-timer-card="${escapeHtml(card.id)}">${label}</button>` : '<span class="timer-finished">Terminado</span>'}
    ${card.timerStatus === 'running' || card.timerStatus === 'paused' ? `<button class="timer-action timer-finish" type="button" data-timer-action="finish" data-timer-card="${escapeHtml(card.id)}">Terminar</button>` : ''}
  </div>`;
}

function startTimerRefresh() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const board = getActiveBoard(state);
    if (!board) return;
    board.cards.filter((card) => card.timerStatus === 'running').forEach((card) => {
      const value = document.querySelector(`[data-timer-value="${CSS.escape(card.id)}"]`);
      if (value) value.textContent = formatTimerDuration(currentTimerSeconds(card));
    });
  }, 1000);
}

function bindKanbanEvents() {
  document.querySelectorAll('[data-add-card]').forEach((button) => {
    button.addEventListener('click', () => openCardModal(button.dataset.addCard));
  });
  document.querySelectorAll('[data-delete-column]').forEach((button) => {
    button.addEventListener('click', () => deleteColumn(button.dataset.deleteColumn, button));
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
  document.querySelectorAll('[data-timer-action]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await controlTimer(button.dataset.timerCard, button.dataset.timerAction, button);
    });
  });
  document.querySelectorAll('[data-toggle-resolved]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleCardResolved(button.dataset.toggleResolved, button);
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
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Creando...');
    try {
      await api(`/api/boards/${board.id}/columns`, {
        method: 'POST',
        body: JSON.stringify({ name, ...auditUser() })
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

function openCardModal(columnId, card = null) {
  const isEdit = Boolean(card);
  const board = getActiveBoard(state);
  const recurringTask = card?.recurringTaskId ? state.recurringTasks?.find((task) => task.id === card.recurringTaskId) : null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const currentWeekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Detalle de la Tarjeta' : 'Nueva Tarjeta'}</div>
        <div class="form-group"><label>Titulo</label><input type="text" id="card-title-input" class="form-control" value="${escapeHtml(card?.title || '')}"></div>
        <div class="form-group searchable-client-field">
          <label for="card-client-search">Clientes <span class="optional-label">(podés elegir más de uno)</span></label>
          <div class="selected-clients-list" data-selected-clients></div>
          <input type="search" id="card-client-search" class="form-control" autocomplete="off" placeholder="Escribí para buscar cliente...">
          <div class="client-search-results" data-client-results hidden></div>
        </div>
        <div class="form-group"><label>Descripcion</label><textarea id="card-desc-input" class="form-control" rows="3">${escapeHtml(card?.description || '')}</textarea></div>
        <div class="form-group" data-due-date><label>Fecha de Vencimiento</label><input type="date" id="card-due-input" class="form-control" value="${escapeHtml(card?.dueDate || '')}"></div>
        <div class="form-group"><label>Asignar a</label><select id="card-assignee-select" class="form-control">${userOptions(card?.assignedTo)}</select></div>
        <div class="form-group"><label class="checkbox-group"><input type="checkbox" id="card-resolved-input" ${card?.resolved ? 'checked' : ''}><span>Resuelta (no aparecerá como vencida)</span></label></div>
        ${!isEdit ? `
          <div class="form-group recurrence-toggle">
            <label class="checkbox-group"><input type="checkbox" id="card-recurring-toggle"><span>Repetir esta tarea</span></label>
          </div>
          <div class="recurrence-settings" data-recurrence-settings hidden>
            <div class="recurrence-date-grid">
              <div class="form-group"><label>Fecha de inicio</label><input type="date" id="recurrence-start-input" class="form-control" value="${today}" min="${today}"></div>
              <div class="form-group"><label>Fecha de fin <span class="optional-label">(opcional)</span></label><input type="date" id="recurrence-end-input" class="form-control" min="${today}"></div>
            </div>
            <div class="form-group">
              <label>Dias y columna inicial</label>
              <div class="recurrence-days">
                ${recurrenceDayRows(board, columnId, currentWeekday)}
              </div>
            </div>
          </div>
        ` : recurringTask ? `<div class="recurrence-summary">↻ Ocurrencia de una serie semanal${recurringTask.endDate ? ` hasta el ${escapeHtml(recurringTask.endDate)}` : ' sin fecha de fin'}.</div>` : ''}
        <div class="modal-actions" style="justify-content: ${isEdit ? 'space-between' : 'flex-end'};">
          ${isEdit ? '<button class="btn btn-danger" type="button" data-delete-card>Eliminar Tarjeta</button>' : ''}
          <div>
            ${recurringTask?.active ? '<button class="btn btn-secondary" type="button" data-stop-recurrence>Detener recurrencia</button>' : ''}
            <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
            <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Crear Tarjeta'}</button>
          </div>
        </div>
      </form>
    </div>
  `);
  setupMultiClientSearch(overlay, card?.clientIds || (card?.clientId ? [card.clientId] : []));
  const recurrenceToggle = overlay.querySelector('#card-recurring-toggle');
  recurrenceToggle?.addEventListener('change', () => {
    overlay.querySelector('[data-recurrence-settings]').hidden = !recurrenceToggle.checked;
    overlay.querySelector('[data-due-date]').hidden = recurrenceToggle.checked;
  });
  overlay.querySelector('#recurrence-start-input')?.addEventListener('change', (event) => {
    const endInput = overlay.querySelector('#recurrence-end-input');
    endInput.min = event.target.value;
    if (endInput.value && endInput.value < event.target.value) endInput.value = event.target.value;
  });
  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');
    try {
      await saveCard(columnId, card);
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
  overlay.querySelector('[data-delete-card]')?.addEventListener('click', async function () {
    if (this.classList.contains('btn-loading')) return;
    setButtonLoading(this, true, 'Eliminando...');
    try {
      await deleteCard(card.id);
    } catch (error) {
      setButtonLoading(this, false);
      alert(error.message);
    }
  });
  overlay.querySelector('[data-stop-recurrence]')?.addEventListener('click', async function () {
    if (!confirm('Se detendran las ocurrencias futuras. Las tarjetas ya creadas se conservaran.')) return;
    setButtonLoading(this, true, 'Deteniendo...');
    try {
      await api(`/api/boards/${board.id}/recurring-tasks/${recurringTask.id}`, {
        method: 'DELETE',
        body: JSON.stringify(auditUser())
      });
      closeModal();
      await refresh();
    } catch (error) {
      setButtonLoading(this, false);
      alert(error.message);
    }
  });
}

function recurrenceDayRows(board, defaultColumnId, currentWeekday) {
  const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
  const columnOptions = board.columns.map((column) => `<option value="${escapeHtml(column.id)}" ${column.id === defaultColumnId ? 'selected' : ''}>${escapeHtml(column.name)}</option>`).join('');
  return dayNames.map((name, index) => `
    <div class="recurrence-day-row">
      <label class="checkbox-group">
        <input type="checkbox" data-recurrence-day="${index + 1}" ${currentWeekday === index + 1 ? 'checked' : ''}>
        <span>${name}</span>
      </label>
      <select class="form-control" data-recurrence-column="${index + 1}">${columnOptions}</select>
    </div>
  `).join('');
}

function openCardDetail(cardId) {
  const board = getActiveBoard(state);
  const card = board.cards.find((item) => item.id === cardId);
  if (card) openCardModal(card.columnId, card);
}

async function saveCard(columnId, card) {
  const board = getActiveBoard(state);
  const isRecurring = !card && document.querySelector('#card-recurring-toggle')?.checked;
  const payload = {
    columnId,
    title: document.querySelector('#card-title-input').value.trim(),
    clientIds: getSelectedClientIds(),
    description: document.querySelector('#card-desc-input').value.trim(),
    dueDate: document.querySelector('#card-due-input').value,
    assignedTo: document.querySelector('#card-assignee-select').value,
    resolved: document.querySelector('#card-resolved-input').checked,
    createdBy: currentUser.id,
    ...auditUser()
  };
  if (!payload.title) return;
  if (isRecurring) {
    payload.startDate = document.querySelector('#recurrence-start-input').value;
    payload.endDate = document.querySelector('#recurrence-end-input').value;
    payload.days = [...document.querySelectorAll('[data-recurrence-day]:checked')].map((input) => ({
      weekday: Number(input.dataset.recurrenceDay),
      columnId: document.querySelector(`[data-recurrence-column="${input.dataset.recurrenceDay}"]`).value
    }));
    if (!payload.startDate || !payload.days.length) throw new Error('Selecciona una fecha de inicio y al menos un dia.');
    if (payload.endDate && payload.endDate < payload.startDate) throw new Error('La fecha de fin no puede ser anterior al inicio.');
    await api(`/api/boards/${board.id}/recurring-tasks`, { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    await refresh();
    return;
  }
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

async function toggleCardResolved(cardId, button) {
  if (button.disabled) return;
  const board = getActiveBoard(state);
  const card = board.cards.find((item) => item.id === cardId);
  if (!card) return;
  button.disabled = true;
  try {
    const response = await api(`/api/boards/${board.id}/cards/${card.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved: !card.resolved, ...auditUser() })
    });
    if (typeof response.card?.resolved !== 'boolean') {
      throw new Error('El servidor está desactualizado. Reinicialo después de aplicar las migraciones.');
    }
    card.resolved = response.card.resolved;
    renderActiveBoard();
  } catch (error) {
    button.disabled = false;
    alert(error.message);
  }
}

async function controlTimer(cardId, action, button) {
  if (button.disabled) return;
  if (action === 'finish' && !confirm('¿Terminar el registro de tiempo de esta tag? Esta accion no se puede deshacer.')) return;
  button.disabled = true;
  try {
    const board = getActiveBoard(state);
    await api(`/api/boards/${board.id}/cards/${cardId}/timer`, {
      method: 'POST',
      body: JSON.stringify({ action, ...auditUser() })
    });
    await refresh();
  } catch (error) {
    button.disabled = false;
    alert(error.message);
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

async function deleteColumn(columnId, button) {
  const board = getActiveBoard(state);
  const cardsInColumn = board.cards.filter((card) => card.columnId === columnId);
  if (board.columns.length <= 1) return alert('El tablero debe conservar al menos una columna.');
  if (cardsInColumn.length > 0) return alert('No puedes eliminar una columna que contiene tarjetas.');
  if (!confirm('Seguro que deseas eliminar esta columna?')) return;
  setButtonLoading(button, true, 'Eliminando...');
  try {
    await api(`/api/boards/${board.id}/columns/${columnId}`, { method: 'DELETE', body: JSON.stringify(auditUser()) });
    await refresh();
  } catch (error) {
    setButtonLoading(button, false);
    alert(error.message);
  }
}

function openRecurringTasksPanel() {
  const board = getActiveBoard(state);
  const dayLabels = ['', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
  const tasks = (state.recurringTasks || []).filter((t) => t.boardId === board.id);
  const rows = tasks.map((task) => {
    const client = task.clientId ? state.clients.find((c) => c.id === task.clientId) : null;
    const assignee = task.assignedTo ? state.users.find((u) => u.id === task.assignedTo) : null;
    const daysStr = task.days.map((d) => dayLabels[d.weekday] || '?').join(', ') || '-';
    const statusLabel = task.active ? 'Activa' : 'Detenida';
    const statusClass = task.active ? 'status-active' : 'status-stopped';
    return `
      <tr>
        <td>${escapeHtml(task.title)}</td>
        <td>${daysStr}</td>
        <td>${client ? escapeHtml(client.company || client.name) : '-'}</td>
        <td>${assignee ? escapeHtml(assignee.name) : '-'}</td>
        <td><span class="${statusClass}">${statusLabel}</span></td>
        <td class="recurring-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-edit-recurring="${escapeHtml(task.id)}">Editar</button>
          ${task.active ? `<button class="btn btn-danger btn-sm" type="button" data-stop-recurring="${escapeHtml(task.id)}">Detener</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  const overlay = openModal(`
    <div class="modal-overlay">
      <div class="modal" style="max-width:780px;">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
          <span>Tareas Recurrentes — ${escapeHtml(board.name)}</span>
          <button class="btn btn-sm" type="button" data-new-recurring>+ Nueva</button>
        </div>
        ${tasks.length ? `
          <div style="overflow-x:auto;">
            <table class="recurring-table">
              <thead><tr><th>Titulo</th><th>Dias</th><th>Cliente</th><th>Responsable</th><th>Estado</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        ` : '<p style="padding:16px;color:var(--text-muted);">No hay tareas recurrentes en este tablero.</p>'}
        <div class="modal-actions" style="justify-content:flex-end;">
          <button class="btn btn-secondary" type="button" data-close-modal>Cerrar</button>
        </div>
      </div>
    </div>
  `);

  overlay.querySelector('[data-new-recurring]')?.addEventListener('click', () => {
    document.querySelector('#modal-root').innerHTML = '';
    openRecurringTaskForm(null);
  });

  overlay.querySelectorAll('[data-edit-recurring]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = tasks.find((t) => t.id === btn.dataset.editRecurring);
      if (!task) return;
      document.querySelector('#modal-root').innerHTML = '';
      openRecurringTaskForm(task);
    });
  });

  overlay.querySelectorAll('[data-stop-recurring]').forEach((btn) => {
    btn.addEventListener('click', async function () {
      const task = tasks.find((t) => t.id === btn.dataset.stopRecurring);
      if (!task) return;
      if (!confirm(`Detener la tarea recurrente "${task.title}"? Las tarjetas ya creadas se conservaran.`)) return;
      setButtonLoading(this, true, 'Deteniendo...');
      try {
        await api(`/api/boards/${board.id}/recurring-tasks/${task.id}`, { method: 'DELETE', body: JSON.stringify(auditUser()) });
        document.querySelector('#modal-root').innerHTML = '';
        await refresh();
        openRecurringTasksPanel();
      } catch (error) {
        setButtonLoading(this, false);
        alert(error.message);
      }
    });
  });
}

function openRecurringTaskForm(task) {
  const board = getActiveBoard(state);
  const isEdit = Boolean(task);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
  const checkedDays = isEdit ? new Set(task.days.map((d) => d.weekday)) : new Set();
  const dayColumnMap = isEdit ? new Map(task.days.map((d) => [d.weekday, d.columnId])) : new Map();

  const dayRows = dayNames.map((name, index) => {
    const weekday = index + 1;
    const checked = checkedDays.has(weekday) ? 'checked' : '';
    const columnOptions = board.columns.map((col) => `<option value="${escapeHtml(col.id)}" ${dayColumnMap.get(weekday) === col.id ? 'selected' : ''}>${escapeHtml(col.name)}</option>`).join('');
    return `
      <div class="recurrence-day-row">
        <label class="checkbox-group">
          <input type="checkbox" data-recurrence-day="${weekday}" ${checked}>
          <span>${name}</span>
        </label>
        <select class="form-control" data-recurrence-column="${weekday}">${columnOptions}</select>
      </div>`;
  }).join('');

  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Tarea Recurrente' : 'Nueva Tarea Recurrente'}</div>
        <div class="form-group"><label>Titulo</label><input type="text" id="rt-title" class="form-control" value="${escapeHtml(task?.title || '')}"></div>
        <div class="form-group searchable-client-field">
          <label for="card-client-search">Clientes <span class="optional-label">(opcional)</span></label>
          <div class="selected-clients-list" data-selected-clients></div>
          <input type="search" id="card-client-search" class="form-control" autocomplete="off" placeholder="Escribi para buscar cliente...">
          <div class="client-search-results" data-client-results hidden></div>
        </div>
        <div class="form-group"><label>Descripcion</label><textarea id="rt-desc" class="form-control" rows="2">${escapeHtml(task?.description || '')}</textarea></div>
        <div class="form-group"><label>Asignar a</label><select id="rt-assignee" class="form-control">${userOptions(task?.assignedTo)}</select></div>
        <div class="recurrence-settings">
          <div class="recurrence-date-grid">
            <div class="form-group"><label>Fecha de inicio</label><input type="date" id="rt-start" class="form-control" value="${escapeHtml(task?.startDate || today)}" ${isEdit ? '' : `min="${today}"`}></div>
            <div class="form-group"><label>Fecha de fin <span class="optional-label">(opcional)</span></label><input type="date" id="rt-end" class="form-control" value="${escapeHtml(task?.endDate || '')}"></div>
          </div>
          <div class="form-group">
            <label>Dias y columna inicial</label>
            <div class="recurrence-days">${dayRows}</div>
          </div>
        </div>
        <div class="modal-actions" style="justify-content:flex-end;">
          <button class="btn btn-secondary" type="button" data-back-to-list>Volver</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Crear'}</button>
        </div>
      </form>
    </div>
  `);

  setupMultiClientSearch(overlay, task?.clientId ? [task.clientId] : []);

  overlay.querySelector('#rt-start')?.addEventListener('change', (event) => {
    const endInput = overlay.querySelector('#rt-end');
    endInput.min = event.target.value;
    if (endInput.value && endInput.value < event.target.value) endInput.value = event.target.value;
  });

  overlay.querySelector('[data-back-to-list]').addEventListener('click', () => {
    document.querySelector('#modal-root').innerHTML = '';
    openRecurringTasksPanel();
  });

  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const title = overlay.querySelector('#rt-title').value.trim();
    if (!title) return alert('El titulo es obligatorio.');
    const days = [...overlay.querySelectorAll('[data-recurrence-day]:checked')].map((input) => ({
      weekday: Number(input.dataset.recurrenceDay),
      columnId: overlay.querySelector(`[data-recurrence-column="${input.dataset.recurrenceDay}"]`).value
    }));
    if (!days.length) return alert('Selecciona al menos un dia.');
    const startDate = overlay.querySelector('#rt-start').value;
    const endDate = overlay.querySelector('#rt-end').value;
    if (!startDate) return alert('La fecha de inicio es obligatoria.');
    if (endDate && endDate < startDate) return alert('La fecha de fin no puede ser anterior al inicio.');
    const payload = {
      title,
      description: overlay.querySelector('#rt-desc').value.trim(),
      clientIds: getSelectedClientIds(),
      assignedTo: overlay.querySelector('#rt-assignee').value,
      startDate,
      endDate,
      days,
      ...auditUser()
    };
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');
    try {
      if (isEdit) {
        await api(`/api/boards/${board.id}/recurring-tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api(`/api/boards/${board.id}/recurring-tasks`, { method: 'POST', body: JSON.stringify(payload) });
      }
      document.querySelector('#modal-root').innerHTML = '';
      await refresh();
      openRecurringTasksPanel();
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
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
    const submitButton = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');
    try {
      await api(`/api/boards/${board.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, ...auditUser() })
      });
      closeModal();
      await refresh();
    } catch (error) {
      submitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
  overlay.querySelector('[data-delete-board]').addEventListener('click', async function () {
    if (state.boards.length <= 1) return alert('Debes conservar al menos un tablero.');
    if (this.classList.contains('btn-loading')) return;
    setButtonLoading(this, true, 'Eliminando...');
    try {
      await api(`/api/boards/${board.id}`, { method: 'DELETE', body: JSON.stringify(auditUser()) });
      closeModal();
      state = await refreshAppState();
      localStorage.setItem('activeBoardId', state.activeBoardId);
      renderPage();
    } catch (error) {
      setButtonLoading(this, false);
      alert(error.message);
    }
  });
}

let _selectedClientIds = [];

function getSelectedClientIds() {
  return [..._selectedClientIds];
}

function setupMultiClientSearch(overlay, initialIds = []) {
  _selectedClientIds = [...initialIds];
  const search = overlay.querySelector('#card-client-search');
  const results = overlay.querySelector('[data-client-results]');
  const listEl = overlay.querySelector('[data-selected-clients]');

  const renderSelected = () => {
    listEl.innerHTML = _selectedClientIds.map((id) => {
      const client = state.clients.find((item) => item.id === id);
      if (!client) return '';
      return `<span class="selected-client-tag">${escapeHtml(client.company || client.name)} <button type="button" data-remove-client="${escapeHtml(id)}">&times;</button></span>`;
    }).join('');
    listEl.querySelectorAll('[data-remove-client]').forEach((btn) => btn.addEventListener('click', () => {
      _selectedClientIds = _selectedClientIds.filter((id) => id !== btn.dataset.removeClient);
      renderSelected();
    }));
  };

  const renderResults = () => {
    const term = search.value.trim().toLocaleLowerCase('es');
    const matches = state.clients
      .filter((client) => !_selectedClientIds.includes(client.id))
      .filter((client) => !term || `${client.company} ${client.name}`.toLocaleLowerCase('es').includes(term))
      .slice(0, 10);
    results.innerHTML = matches.map((client) => `<button type="button" data-client-id="${escapeHtml(client.id)}"><strong>${escapeHtml(client.company || client.name)}</strong><span>${escapeHtml(client.name)}</span></button>`).join('') || '<span style="padding:8px;color:var(--text-muted);font-size:0.8rem;">Sin resultados</span>';
    results.hidden = false;
    results.querySelectorAll('[data-client-id]').forEach((button) => button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      _selectedClientIds.push(button.dataset.clientId);
      search.value = '';
      results.hidden = true;
      renderSelected();
    }));
  };

  search.addEventListener('focus', renderResults);
  search.addEventListener('input', renderResults);
  search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 100));
  renderSelected();
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
