import { api, requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { openModal, renderSidebar } from './layout.js';
import { escapeHtml } from './utils.js';

const currentUser = requireSession();
let state;
let reports = [];

async function boot() {
  state = await loadAppState();
  await loadReports();
  renderPage();
}

async function loadReports() {
  const data = await api('/api/weekly-reports');
  reports = data.reports || [];
}

async function refresh() {
  state = await refreshAppState();
  await loadReports();
  renderPage();
}

function renderPage() {
  renderSidebar({ state, currentUser, activePage: 'templates', onRefresh: refresh });
  renderTemplatesGrid();
  renderWeeklyList();
}

function renderTemplatesGrid() {
  const grid = document.querySelector('#templates-grid');
  grid.innerHTML = `
    <div class="template-card" id="weekly-template-card">
      <div class="template-card-icon">&#128202;</div>
      <h3 class="template-card-title">Weekly Report</h3>
      <p class="template-card-desc">Presentacion semanal con metricas de clientes, reuniones y graficos de estado.</p>
      <button class="btn" type="button" id="create-weekly-btn">Crear nueva weekly</button>
    </div>
    <div class="template-card">
      <div class="template-card-icon">&#128176;</div>
      <h3 class="template-card-title">Propuesta Comercial</h3>
      <p class="template-card-desc">Propuesta editable con productos, precios, moneda y exportacion a PDF.</p>
      <a class="btn" href="/propuesta">Crear propuesta</a>
    </div>
  `;

  document.querySelector('#create-weekly-btn').addEventListener('click', createNewWeekly);
}

async function createNewWeekly() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const weekLabel = `${day}/${month}`;

  const clients = [...(state.clients || [])].sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name, 'es'));
  const normalizeStatus = (value) => String(value || '').trim().toLowerCase().replaceAll(' ', '');
  const isActive = (client) => ['activo', 'planactivo'].includes(normalizeStatus(client.status));
  const isFreeTrial = (client) => ['freetrial'].includes(normalizeStatus(client.status));
  const overlay = openModal(`
    <div class="modal-overlay"><form class="modal weekly-create-modal">
      <div class="modal-header">Crear nueva Weekly</div>
      <div class="form-group"><label>Fecha / etiqueta</label><input class="form-control" id="weekly-label-input" value="${weekLabel}"></div>
      <div class="form-group"><label>Clientes incluidos</label><p class="form-hint">Las métricas y el último comentario se completan automáticamente desde Clientes.</p>
        <div class="weekly-selection-presets">
          <button class="btn btn-secondary btn-sm" type="button" data-client-preset="active">Todos los activos</button>
          <button class="btn btn-secondary btn-sm" type="button" data-client-preset="trial">Todos los FreeTrial</button>
          <button class="btn btn-secondary btn-sm" type="button" data-client-preset="active-trial">Activos + FreeTrial</button>
          <button class="btn btn-secondary btn-sm" type="button" data-client-preset="all">Todos</button>
          <button class="btn btn-secondary btn-sm" type="button" data-client-preset="none">Limpiar</button>
        </div>
        <p class="weekly-selection-count" data-selection-count>0 clientes seleccionados</p>
        <div class="weekly-create-clients">${clients.map((client) => `<label><input type="checkbox" data-weekly-client value="${escapeHtml(client.id)}"><span>${escapeHtml(client.company || client.name)}</span>${client.status ? `<small>${escapeHtml(client.status)}</small>` : ''}</label>`).join('')}</div>
      </div>
      <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Crear Weekly</button></div>
    </form></div>`);
  const checkboxes = [...overlay.querySelectorAll('[data-weekly-client]')];
  const updateCount = () => {
    const count = checkboxes.filter((input) => input.checked).length;
    overlay.querySelector('[data-selection-count]').textContent = `${count} ${count === 1 ? 'cliente seleccionado' : 'clientes seleccionados'}`;
  };
  checkboxes.forEach((input) => input.addEventListener('change', updateCount));
  overlay.querySelectorAll('[data-client-preset]').forEach((button) => button.addEventListener('click', () => {
    const preset = button.dataset.clientPreset;
    checkboxes.forEach((input) => {
      const client = clients.find((item) => item.id === input.value);
      input.checked = preset === 'all'
        || (preset === 'active' && isActive(client))
        || (preset === 'trial' && isFreeTrial(client))
        || (preset === 'active-trial' && (isActive(client) || isFreeTrial(client)));
    });
    updateCount();
  }));
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const clientIds = [...overlay.querySelectorAll('[data-weekly-client]:checked')].map((input) => input.value);
    if (!clientIds.length) return alert('Selecciona al menos un cliente');
    const submit = overlay.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Creando...';
    try {
      const { report } = await api('/api/weekly-reports', { method: 'POST', body: JSON.stringify({ weekLabel: overlay.querySelector('#weekly-label-input').value.trim(), clientIds }) });
      window.location.href = `/weekly?id=${report.id}`;
    } catch (err) {
      submit.disabled = false;
      submit.textContent = 'Crear Weekly';
      alert(err.message);
    }
  });
}

function renderWeeklyList() {
  const section = document.querySelector('#weekly-list-section');
  if (!reports.length) {
    section.innerHTML = '';
    return;
  }

  section.innerHTML = `
    <h2 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 12px;">Weeklys anteriores</h2>
    <div class="weekly-reports-list">
      ${reports.map(r => `
        <div class="weekly-report-item" data-report-id="${escapeHtml(r.id)}">
          <div class="weekly-report-info">
            <span class="weekly-report-label">Weekly ${escapeHtml(r.weekLabel)}</span>
            <span class="status-badge ${r.status === 'final' ? 'final' : 'draft'}">${r.status === 'final' ? 'Final' : 'Borrador'}</span>
          </div>
          <div class="weekly-report-actions">
            <span class="weekly-report-date">${new Date(r.createdAt).toLocaleDateString('es-AR')}</span>
            <button class="btn-icon btn-delete-report" type="button" data-delete-id="${escapeHtml(r.id)}" title="Eliminar">&times;</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  section.querySelectorAll('[data-report-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-id]')) return;
      window.location.href = `/weekly?id=${el.dataset.reportId}`;
    });
  });

  section.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteId;
      const label = reports.find(r => r.id === id)?.weekLabel || '';
      if (!confirm(`Eliminar Weekly ${label}? Esta accion no se puede deshacer.`)) return;
      btn.disabled = true;
      try {
        await api(`/api/weekly-reports/${id}`, { method: 'DELETE' });
        await loadReports();
        renderWeeklyList();
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    });
  });
}

boot();
