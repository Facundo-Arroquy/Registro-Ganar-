import { api, requireSession } from './api.js';
import { loadAppState } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml } from './utils.js';

const currentUser = requireSession();
let state;
let isDeletingStatus = false;

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
    activePage: 'configuracion',
    onRefresh: refresh
  });
  document.querySelector('[data-add-status]').onclick = () => openStatusModal();
  renderStatuses();
  renderHistory();
}

function renderStatuses() {
  document.querySelector('[data-last-config-change]').textContent = formatLastConfigChange(state.settings?.lastConfigChange);
  document.querySelector('[data-status-list]').innerHTML = getClientStatuses().map((statusItem, index) => {
    const status = getStatusName(statusItem);
    const color = getStatusColor(statusItem);
    return `
    <div class="settings-row">
      ${statusBadge(status, color)}
      <div class="row-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-edit-status="${index}">Editar</button>
        <button class="btn btn-danger btn-sm" type="button" data-delete-status="${index}">Sacar</button>
      </div>
    </div>
  `;
  }).join('');

  document.querySelectorAll('[data-edit-status]').forEach((button) => {
    button.addEventListener('click', () => openStatusModal(Number(button.dataset.editStatus)));
  });
  document.querySelectorAll('[data-delete-status]').forEach((button) => {
    button.addEventListener('click', () => deleteStatus(Number(button.dataset.deleteStatus)));
  });
}

function renderHistory() {
  const changes = getConfigChanges();
  document.querySelector('[data-config-history]').innerHTML = changes.length ? changes.map((change) => `
    <div class="history-row">
      <div>
        <strong>${escapeHtml(change.action)}</strong>
        <span>${escapeHtml(change.userName || 'Usuario')}</span>
      </div>
      <time>${escapeHtml(formatDateTime(change.at))}</time>
    </div>
  `).join('') : `
    <div class="empty-state">Sin modificaciones registradas</div>
  `;
}

function openStatusModal(index = null) {
  const isEdit = index !== null;
  const currentStatus = isEdit ? getClientStatuses()[index] : null;
  const currentStatusName = currentStatus ? getStatusName(currentStatus) : '';
  const currentColor = currentStatus ? getStatusColor(currentStatus) : '#388bfd';
  let isSubmitting = false;
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Estado' : 'Agregar Estado'}</div>
        <div class="form-group">
          <label>Nombre del estado</label>
          <input type="text" id="status-name-input" class="form-control" value="${escapeHtml(currentStatusName)}" placeholder="Ej. Onboarding">
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker-row">
            <input type="color" id="status-color-input" value="${escapeHtml(currentColor)}" aria-label="Color del estado">
            <input type="text" id="status-color-text-input" class="form-control" value="${escapeHtml(currentColor)}" aria-label="Codigo de color">
          </div>
          <div class="color-swatches">
            ${['#3fb950', '#d29922', '#f85149', '#8b949e', '#388bfd', '#a371f7'].map((color) => `
              <button class="color-swatch" type="button" data-status-color="${color}" style="background-color: ${color};" aria-label="${color}"></button>
            `).join('')}
          </div>
          <div class="status-preview" data-status-preview>${statusBadge(currentStatusName || 'Estado', currentColor)}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Agregar'}</button>
        </div>
      </form>
    </div>
  `);

  const statusInput = overlay.querySelector('#status-name-input');
  const colorInput = overlay.querySelector('#status-color-input');
  const colorTextInput = overlay.querySelector('#status-color-text-input');
  const preview = overlay.querySelector('[data-status-preview]');

  function syncPreview() {
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    colorInput.value = color;
    preview.innerHTML = statusBadge(statusInput.value.trim() || 'Estado', color);
  }

  statusInput.addEventListener('input', syncPreview);
  colorInput.addEventListener('input', () => {
    colorTextInput.value = colorInput.value;
    syncPreview();
  });
  colorTextInput.addEventListener('input', syncPreview);
  overlay.querySelectorAll('[data-status-color]').forEach((button) => {
    button.addEventListener('click', () => {
      colorInput.value = button.dataset.statusColor;
      colorTextInput.value = button.dataset.statusColor;
      syncPreview();
    });
  });

  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    const status = statusInput.value.trim();
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    if (!status) return;
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    isSubmitting = true;
    form.querySelectorAll('input, button').forEach((control) => {
      control.disabled = true;
    });
    submitButton.textContent = 'Guardando...';

    try {
      await api(isEdit ? `/api/settings/client-statuses/${index}` : '/api/settings/client-statuses', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ status, color, userId: currentUser.id, userName: currentUser.name })
      });
      closeModal();
      await refresh();
    } catch (error) {
      isSubmitting = false;
      form.querySelectorAll('input, button').forEach((control) => {
        control.disabled = false;
      });
      submitButton.textContent = isEdit ? 'Guardar Cambios' : 'Agregar';
      alert(error.message);
    }
  });
}

async function deleteStatus(index) {
  if (isDeletingStatus) return;
  const status = getStatusName(getClientStatuses()[index]);
  if (!status || !confirm(`Seguro que queres sacar el estado "${status}"?`)) return;
  isDeletingStatus = true;
  try {
    await api(`/api/settings/client-statuses/${index}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
    });
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    isDeletingStatus = false;
  }
}

function getClientStatuses() {
  return state.settings?.clientStatuses?.length ? state.settings.clientStatuses : ['Activo'];
}

function getConfigChanges() {
  if (Array.isArray(state.settings?.configChanges)) return state.settings.configChanges;
  return state.settings?.lastConfigChange ? [state.settings.lastConfigChange] : [];
}

function getStatusName(status) {
  return typeof status === 'string' ? status : status?.name || '';
}

function getStatusColor(status) {
  if (typeof status === 'object' && isHexColor(status?.color)) return status.color;
  const defaults = {
    Activo: '#3fb950',
    'En pausa': '#d29922',
    Riesgo: '#f85149',
    Cerrado: '#8b949e'
  };
  return defaults[getStatusName(status)] || '#388bfd';
}

function statusBadge(status, color) {
  const safeColor = isHexColor(color) ? color : '#388bfd';
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(safeColor)};">${escapeHtml(status)}</span>`;
}

function isHexColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
}

function formatLastConfigChange(lastChange) {
  if (!lastChange) return 'Sin cambios registrados';
  return `Ultimo cambio: ${lastChange.action} por ${lastChange.userName} el ${formatDateTime(lastChange.at)}`;
}

function formatDateTime(value) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

boot();
