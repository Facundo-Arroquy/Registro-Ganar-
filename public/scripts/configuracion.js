import { api, requireSession } from './api.js';
import { loadAppState } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml, setButtonLoading } from './utils.js';

const currentUser = requireSession();
let state;
let isDeletingStatus = false;
let isDeletingAdStatus = false;
let isDeletingConsultor = false;
let isDeletingComplexity = false;


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
  document.querySelector('[data-add-ad-status]').onclick = () => openAdStatusModal();
  document.querySelector('[data-add-consultor]').onclick = () => openConsultorModal();
  renderStatuses();
  renderAdStatuses();
  renderConsultors();
  document.querySelector('[data-add-complexity]').onclick = () => openComplexityModal();
  document.querySelector('[data-add-ad-status]').onclick = () => openAdStatusModal();
  renderStatuses();
  renderComplexities();
  renderAdStatuses();
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
    button.addEventListener('click', () => deleteStatus(Number(button.dataset.deleteStatus), button));
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
    setButtonLoading(submitButton, true, 'Guardando...');

    try {
      await api(isEdit ? `/api/settings/client-statuses/${index}` : '/api/settings/client-statuses', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ status, color, userId: currentUser.id, userName: currentUser.name })
      });
      closeModal();
      await refresh();
    } catch (error) {
      isSubmitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

async function deleteStatus(index, button) {
  if (isDeletingStatus) return;
  const status = getStatusName(getClientStatuses()[index]);
  if (!status || !confirm(`Seguro que queres sacar el estado "${status}"?`)) return;
  isDeletingStatus = true;
  setButtonLoading(button, true, 'Sacando...');
  try {
    await api(`/api/settings/client-statuses/${index}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
    });
    await refresh();
  } catch (error) {
    setButtonLoading(button, false);
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

function getComplexities() {
  return state.settings?.complexities?.length ? state.settings.complexities : [];
}

function getComplexityName(c) {
  return typeof c === 'string' ? c : c?.name || '';
}

function getComplexityColor(c) {
  if (typeof c === 'object' && isHexColor(c?.color)) return c.color;
  return '#388bfd';
}

function renderComplexities() {
  document.querySelector('[data-complexity-list]').innerHTML = getComplexities().length ? getComplexities().map((item, index) => {
    const name = getComplexityName(item);
    const color = getComplexityColor(item);
    return `
    <div class="settings-row">
      ${statusBadge(name, color)}
      <div class="row-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-edit-complexity="${index}">Editar</button>
        <button class="btn btn-danger btn-sm" type="button" data-delete-complexity="${index}">Sacar</button>
      </div>
    </div>
  `;
  }).join('') : '<div class="empty-state">Sin complejidades configuradas</div>';

  document.querySelectorAll('[data-edit-complexity]').forEach((button) => {
    button.addEventListener('click', () => openComplexityModal(Number(button.dataset.editComplexity)));
  });
  document.querySelectorAll('[data-delete-complexity]').forEach((button) => {
    button.addEventListener('click', () => deleteComplexity(Number(button.dataset.deleteComplexity), button));
  });
}

function openComplexityModal(index = null) {
  const isEdit = index !== null;
  const current = isEdit ? getComplexities()[index] : null;
  const currentName = current ? getComplexityName(current) : '';
  const currentColor = current ? getComplexityColor(current) : '#388bfd';
  let isSubmitting = false;
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Complejidad' : 'Agregar Complejidad'}</div>
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="complexity-name-input" class="form-control" value="${escapeHtml(currentName)}" placeholder="Ej. Alta">
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker-row">
            <input type="color" id="complexity-color-input" value="${escapeHtml(currentColor)}" aria-label="Color de la complejidad">
            <input type="text" id="complexity-color-text-input" class="form-control" value="${escapeHtml(currentColor)}" aria-label="Codigo de color">
          </div>
          <div class="color-swatches">
            ${['#3fb950', '#d29922', '#f85149', '#8b949e', '#388bfd', '#a371f7'].map((color) => `
              <button class="color-swatch" type="button" data-complexity-color="${color}" style="background-color: ${color};" aria-label="${color}"></button>
            `).join('')}
          </div>
          <div class="status-preview" data-complexity-preview>${statusBadge(currentName || 'Complejidad', currentColor)}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Agregar'}</button>
        </div>
      </form>
    </div>
  `);

  const nameInput = overlay.querySelector('#complexity-name-input');
  const colorInput = overlay.querySelector('#complexity-color-input');
  const colorTextInput = overlay.querySelector('#complexity-color-text-input');
  const preview = overlay.querySelector('[data-complexity-preview]');

  function syncPreview() {
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    colorInput.value = color;
    preview.innerHTML = statusBadge(nameInput.value.trim() || 'Complejidad', color);
  }

  nameInput.addEventListener('input', syncPreview);
  colorInput.addEventListener('input', () => {
    colorTextInput.value = colorInput.value;
    syncPreview();
  });
  colorTextInput.addEventListener('input', syncPreview);
  overlay.querySelectorAll('[data-complexity-color]').forEach((button) => {
    button.addEventListener('click', () => {
      colorInput.value = button.dataset.complexityColor;
      colorTextInput.value = button.dataset.complexityColor;
      syncPreview();
    });
  });

  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    const status = nameInput.value.trim();
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    if (!status) return;
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    isSubmitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');

    try {
      await api(isEdit ? `/api/settings/complexities/${index}` : '/api/settings/complexities', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ status, color, userId: currentUser.id, userName: currentUser.name })
      });
      closeModal();
      await refresh();
    } catch (error) {
      isSubmitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

async function deleteComplexity(index, button) {
  if (isDeletingComplexity) return;
  const name = getComplexityName(getComplexities()[index]);
  if (!name || !confirm(`Seguro que queres sacar la complejidad "${name}"?`)) return;
  isDeletingComplexity = true;
  setButtonLoading(button, true, 'Sacando...');
  try {
    await api(`/api/settings/complexities/${index}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
    });
    await refresh();
  } catch (error) {
    setButtonLoading(button, false);
    alert(error.message);
  } finally {
    isDeletingComplexity = false;
  }
}

function getAdStatuses() {
  return state.settings?.adStatuses?.length ? state.settings.adStatuses : [];
}

function getAdStatusName(item) {
  return typeof item === 'string' ? item : item?.name || '';
}

function getAdStatusColor(item) {
  if (typeof item === 'object' && isHexColor(item?.color)) return item.color;
  return '#388bfd';
}

function renderAdStatuses() {
  document.querySelector('[data-ad-status-list]').innerHTML = getAdStatuses().length ? getAdStatuses().map((item, index) => {
    const name = getAdStatusName(item);
    const color = getAdStatusColor(item);
    return `
    <div class="settings-row">
      ${statusBadge(name, color)}
      <div class="row-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-edit-ad-status="${index}">Editar</button>
        <button class="btn btn-danger btn-sm" type="button" data-delete-ad-status="${index}">Sacar</button>
      </div>
    </div>
  `;
  }).join('') : '<div class="empty-state">Sin estados de publicidad configurados</div>';

  document.querySelectorAll('[data-edit-ad-status]').forEach((button) => {
    button.addEventListener('click', () => openAdStatusModal(Number(button.dataset.editAdStatus)));
  });
  document.querySelectorAll('[data-delete-ad-status]').forEach((button) => {
    button.addEventListener('click', () => deleteAdStatus(Number(button.dataset.deleteAdStatus), button));
  });
}

function openAdStatusModal(index = null) {
  const isEdit = index !== null;
  const current = isEdit ? getAdStatuses()[index] : null;
  const currentName = current ? getAdStatusName(current) : '';
  const currentColor = current ? getAdStatusColor(current) : '#388bfd';
  let isSubmitting = false;
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Publicidad' : 'Agregar Publicidad'}</div>
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="ad-status-name-input" class="form-control" value="${escapeHtml(currentName)}" placeholder="Ej. SI">
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker-row">
            <input type="color" id="ad-status-color-input" value="${escapeHtml(currentColor)}" aria-label="Color">
            <input type="text" id="ad-status-color-text-input" class="form-control" value="${escapeHtml(currentColor)}" aria-label="Codigo de color">
          </div>
          <div class="color-swatches">
            ${['#3fb950', '#d29922', '#f85149', '#8b949e', '#388bfd', '#a371f7'].map((color) => `
              <button class="color-swatch" type="button" data-ad-color="${color}" style="background-color: ${color};" aria-label="${color}"></button>
            `).join('')}
          </div>
          <div class="status-preview" data-ad-preview>${statusBadge(currentName || 'Publicidad', currentColor)}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Agregar'}</button>
        </div>
      </form>
    </div>
  `);

  const nameInput = overlay.querySelector('#ad-status-name-input');
  const colorInput = overlay.querySelector('#ad-status-color-input');
  const colorTextInput = overlay.querySelector('#ad-status-color-text-input');
  const preview = overlay.querySelector('[data-ad-preview]');

  function syncPreview() {
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    colorInput.value = color;
    preview.innerHTML = statusBadge(nameInput.value.trim() || 'Publicidad', color);
  }

  nameInput.addEventListener('input', syncPreview);
  colorInput.addEventListener('input', () => { colorTextInput.value = colorInput.value; syncPreview(); });
  colorTextInput.addEventListener('input', syncPreview);
  overlay.querySelectorAll('[data-ad-color]').forEach((button) => {
    button.addEventListener('click', () => {
      colorInput.value = button.dataset.adColor;
      colorTextInput.value = button.dataset.adColor;
      syncPreview();
    });
  });

  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    const status = nameInput.value.trim();
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    if (!status) return;
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    isSubmitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');
    try {
      await api(isEdit ? `/api/settings/ad-statuses/${index}` : '/api/settings/ad-statuses', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ status, color, userId: currentUser.id, userName: currentUser.name })
      });
      closeModal();
      await refresh();
    } catch (error) {
      isSubmitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

async function deleteAdStatus(index, button) {
  if (isDeletingAdStatus) return;
  const name = getAdStatusName(getAdStatuses()[index]);
  if (!name || !confirm(`Seguro que queres sacar el estado de publicidad "${name}"?`)) return;
  isDeletingAdStatus = true;
  setButtonLoading(button, true, 'Sacando...');
  try {
    await api(`/api/settings/ad-statuses/${index}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
    });
    await refresh();
  } catch (error) {
    setButtonLoading(button, false);
    alert(error.message);
  } finally {
    isDeletingAdStatus = false;
  }
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

// --- Advertising tags ---

function getAdStatuses() {
  return state.settings?.adStatuses?.length ? state.settings.adStatuses : [];
}

function getAdStatusName(item) {
  return typeof item === 'string' ? item : item?.name || '';
}

function getAdStatusColor(item) {
  if (typeof item === 'object' && isHexColor(item?.color)) return item.color;
  return '#388bfd';
}

function renderAdStatuses() {
  const list = document.querySelector('[data-ad-status-list]');
  const adStatuses = getAdStatuses();
  list.innerHTML = adStatuses.length ? adStatuses.map((item, index) => {
    const name = getAdStatusName(item);
    const color = getAdStatusColor(item);
    return `
      <div class="settings-row">
        ${statusBadge(name, color)}
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-edit-ad-status="${index}">Editar</button>
          <button class="btn btn-danger btn-sm" type="button" data-delete-ad-status="${index}">Sacar</button>
        </div>
      </div>
    `;
  }).join('') : '<div class="empty-state">Sin tags de publicidad configurados</div>';

  document.querySelectorAll('[data-edit-ad-status]').forEach((button) => {
    button.addEventListener('click', () => openAdStatusModal(Number(button.dataset.editAdStatus)));
  });
  document.querySelectorAll('[data-delete-ad-status]').forEach((button) => {
    button.addEventListener('click', () => deleteAdStatus(Number(button.dataset.deleteAdStatus), button));
  });
}

function openAdStatusModal(index = null) {
  const isEdit = index !== null;
  const current = isEdit ? getAdStatuses()[index] : null;
  const currentName = current ? getAdStatusName(current) : '';
  const currentColor = current ? getAdStatusColor(current) : '#388bfd';
  let isSubmitting = false;
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Tag de Publicidad' : 'Agregar Tag de Publicidad'}</div>
        <div class="form-group">
          <label>Nombre del tag</label>
          <input type="text" id="ad-status-name-input" class="form-control" value="${escapeHtml(currentName)}" placeholder="Ej. SI">
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker-row">
            <input type="color" id="ad-status-color-input" value="${escapeHtml(currentColor)}" aria-label="Color del tag">
            <input type="text" id="ad-status-color-text-input" class="form-control" value="${escapeHtml(currentColor)}" aria-label="Codigo de color">
          </div>
          <div class="color-swatches">
            ${['#3fb950', '#d29922', '#f85149', '#8b949e', '#388bfd', '#a371f7'].map((color) => `
              <button class="color-swatch" type="button" data-ad-status-color="${color}" style="background-color: ${color};" aria-label="${color}"></button>
            `).join('')}
          </div>
          <div class="status-preview" data-ad-status-preview>${statusBadge(currentName || 'Publicidad', currentColor)}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Agregar'}</button>
        </div>
      </form>
    </div>
  `);

  const nameInput = overlay.querySelector('#ad-status-name-input');
  const colorInput = overlay.querySelector('#ad-status-color-input');
  const colorTextInput = overlay.querySelector('#ad-status-color-text-input');
  const preview = overlay.querySelector('[data-ad-status-preview]');

  function syncPreview() {
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    colorInput.value = color;
    preview.innerHTML = statusBadge(nameInput.value.trim() || 'Publicidad', color);
  }

  nameInput.addEventListener('input', syncPreview);
  colorInput.addEventListener('input', () => {
    colorTextInput.value = colorInput.value;
    syncPreview();
  });
  colorTextInput.addEventListener('input', syncPreview);
  overlay.querySelectorAll('[data-ad-status-color]').forEach((button) => {
    button.addEventListener('click', () => {
      colorInput.value = button.dataset.adStatusColor;
      colorTextInput.value = button.dataset.adStatusColor;
      syncPreview();
    });
  });

  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    const status = nameInput.value.trim();
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    if (!status) return;
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    isSubmitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');
    try {
      await api(isEdit ? `/api/settings/ad-statuses/${index}` : '/api/settings/ad-statuses', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ status, color, userId: currentUser.id, userName: currentUser.name })
      });
      closeModal();
      await refresh();
    } catch (error) {
      isSubmitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

async function deleteAdStatus(index, button) {
  if (isDeletingAdStatus) return;
  const name = getAdStatusName(getAdStatuses()[index]);
  if (!name || !confirm(`Seguro que queres sacar el tag de publicidad "${name}"?`)) return;
  isDeletingAdStatus = true;
  setButtonLoading(button, true, 'Sacando...');
  try {
    await api(`/api/settings/ad-statuses/${index}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
    });
    await refresh();
  } catch (error) {
    setButtonLoading(button, false);
    alert(error.message);
  } finally {
    isDeletingAdStatus = false;
  }
}

// --- Consultors ---

function getClientConsultors() {
  return state.settings?.clientConsultors?.length ? state.settings.clientConsultors : [];
}

function getConsultorName(consultor) {
  return typeof consultor === 'string' ? consultor : consultor?.name || '';
}

function getConsultorColor(consultor) {
  if (typeof consultor === 'object' && isHexColor(consultor?.color)) return consultor.color;
  return '#388bfd';
}

function renderConsultors() {
  const list = document.querySelector('[data-consultor-list]');
  const consultors = getClientConsultors();
  list.innerHTML = consultors.length ? consultors.map((consultorItem, index) => {
    const name = getConsultorName(consultorItem);
    const color = getConsultorColor(consultorItem);
    return `
    <div class="settings-row">
      ${statusBadge(name, color)}
      <div class="row-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-edit-consultor="${index}">Editar</button>
        <button class="btn btn-danger btn-sm" type="button" data-delete-consultor="${index}">Sacar</button>
      </div>
    </div>
  `;
  }).join('') : '<div class="empty-state">Sin consultores configurados</div>';

  document.querySelectorAll('[data-edit-consultor]').forEach((button) => {
    button.addEventListener('click', () => openConsultorModal(Number(button.dataset.editConsultor)));
  });
  document.querySelectorAll('[data-delete-consultor]').forEach((button) => {
    button.addEventListener('click', () => deleteConsultor(Number(button.dataset.deleteConsultor), button));
  });
}

function openConsultorModal(index = null) {
  const isEdit = index !== null;
  const current = isEdit ? getClientConsultors()[index] : null;
  const currentName = current ? getConsultorName(current) : '';
  const currentColor = current ? getConsultorColor(current) : '#388bfd';
  let isSubmitting = false;
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">${isEdit ? 'Editar Consultor' : 'Agregar Consultor'}</div>
        <div class="form-group">
          <label>Nombre del consultor</label>
          <input type="text" id="consultor-name-input" class="form-control" value="${escapeHtml(currentName)}" placeholder="Ej. Interno">
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker-row">
            <input type="color" id="consultor-color-input" value="${escapeHtml(currentColor)}" aria-label="Color del consultor">
            <input type="text" id="consultor-color-text-input" class="form-control" value="${escapeHtml(currentColor)}" aria-label="Codigo de color">
          </div>
          <div class="color-swatches">
            ${['#3fb950', '#d29922', '#f85149', '#8b949e', '#388bfd', '#a371f7'].map((color) => `
              <button class="color-swatch" type="button" data-consultor-color="${color}" style="background-color: ${color};" aria-label="${color}"></button>
            `).join('')}
          </div>
          <div class="status-preview" data-consultor-preview>${statusBadge(currentName || 'Consultor', currentColor)}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button>
          <button class="btn" type="submit">${isEdit ? 'Guardar Cambios' : 'Agregar'}</button>
        </div>
      </form>
    </div>
  `);

  const nameInput = overlay.querySelector('#consultor-name-input');
  const colorInput = overlay.querySelector('#consultor-color-input');
  const colorTextInput = overlay.querySelector('#consultor-color-text-input');
  const preview = overlay.querySelector('[data-consultor-preview]');

  function syncPreview() {
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    colorInput.value = color;
    preview.innerHTML = statusBadge(nameInput.value.trim() || 'Consultor', color);
  }

  nameInput.addEventListener('input', syncPreview);
  colorInput.addEventListener('input', () => {
    colorTextInput.value = colorInput.value;
    syncPreview();
  });
  colorTextInput.addEventListener('input', syncPreview);
  overlay.querySelectorAll('[data-consultor-color]').forEach((button) => {
    button.addEventListener('click', () => {
      colorInput.value = button.dataset.consultorColor;
      colorTextInput.value = button.dataset.consultorColor;
      syncPreview();
    });
  });

  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    const status = nameInput.value.trim();
    const color = isHexColor(colorTextInput.value) ? colorTextInput.value : colorInput.value;
    if (!status) return;
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    isSubmitting = true;
    setButtonLoading(submitButton, true, 'Guardando...');

    try {
      await api(isEdit ? `/api/settings/client-consultors/${index}` : '/api/settings/client-consultors', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify({ status, color, userId: currentUser.id, userName: currentUser.name })
      });
      closeModal();
      await refresh();
    } catch (error) {
      isSubmitting = false;
      setButtonLoading(submitButton, false);
      alert(error.message);
    }
  });
}

async function deleteConsultor(index, button) {
  if (isDeletingConsultor) return;
  const name = getConsultorName(getClientConsultors()[index]);
  if (!name || !confirm(`Seguro que queres sacar el consultor "${name}"?`)) return;
  isDeletingConsultor = true;
  setButtonLoading(button, true, 'Sacando...');
  try {
    await api(`/api/settings/client-consultors/${index}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: currentUser.id, userName: currentUser.name })
    });
    await refresh();
  } catch (error) {
    setButtonLoading(button, false);
    alert(error.message);
  } finally {
    isDeletingConsultor = false;
  }
}

boot();
