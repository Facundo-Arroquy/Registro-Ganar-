import { api, requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { renderSidebar } from './layout.js';
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

  const btn = document.querySelector('#create-weekly-btn');
  btn.disabled = true;
  btn.textContent = 'Creando...';

  try {
    const { report } = await api('/api/weekly-reports', {
      method: 'POST',
      body: JSON.stringify({ weekLabel })
    });
    window.location.href = `/weekly?id=${report.id}`;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Crear nueva weekly';
    alert(err.message);
  }
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
