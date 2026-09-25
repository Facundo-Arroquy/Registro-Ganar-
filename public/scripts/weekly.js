import { api, requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { renderSidebar } from './layout.js';
import { escapeHtml } from './utils.js';

const currentUser = requireSession();
const reportId = new URLSearchParams(window.location.search).get('id');
if (!reportId) window.location.href = '/templates';

let state;
let report = null;
let clientData = [];
let calendarEvents = [];
let selectedClientIds = new Set();
let charts = [];

async function boot() {
  state = await loadAppState();
  await loadReport();
  initSelectedClients();
  renderPage();
}

async function loadReport() {
  const data = await api(`/api/weekly-reports/${reportId}`);
  report = data.report;
  clientData = data.clientData || [];
  calendarEvents = data.calendarEvents || [];
}

function initSelectedClients() {
  // If saved in meetings, restore; otherwise default to Activo/Freetrial
  const saved = report.meetings?.selectedClients;
  if (Array.isArray(saved)) {
    selectedClientIds = new Set(saved);
  } else {
    const clients = state.clients || [];
    selectedClientIds = new Set(
      clients.filter(c => {
        const s = (c.status || '').toLowerCase();
        return s === 'activo' || s === 'freetrial' || s === 'free trial';
      }).map(c => c.id)
    );
  }
}

function getFilteredClients() {
  return (state.clients || []).filter(c => selectedClientIds.has(c.id));
}

function renderPage() {
  renderSidebar({ state, currentUser, activePage: 'templates', onRefresh: () => refreshAppState().then(s => { state = s; renderPage(); }) });
  renderToolbar();
  renderClientFilter();
  renderSlides();
}

function isEditable() {
  return report.status !== 'final';
}

// --- Toolbar ---

function renderToolbar() {
  const toolbar = document.querySelector('#weekly-toolbar');
  toolbar.innerHTML = `
    <a href="/templates" class="btn btn-secondary btn-sm">&larr; Templates</a>
    <span class="weekly-toolbar-title">Weekly ${escapeHtml(report.weekLabel)} ${report.status === 'final' ? '<span class="status-badge final">Final</span>' : '<span class="status-badge draft">Borrador</span>'}</span>
    <div class="weekly-toolbar-actions">
      <button class="btn btn-secondary" type="button" id="export-pdf-btn">Exportar PDF</button>
      ${isEditable() ? `
        <button class="btn btn-secondary" type="button" id="toggle-filter-btn">Filtrar Clientes</button>
        <button class="btn btn-secondary" type="button" id="save-draft-btn">Guardar Borrador</button>
        <button class="btn" type="button" id="finalize-btn">Guardado Final</button>
      ` : ''}
    </div>
  `;

  document.querySelector('#export-pdf-btn').addEventListener('click', () => {
    window.print();
  });

  if (isEditable()) {
    document.querySelector('#save-draft-btn').addEventListener('click', saveDraft);
    document.querySelector('#finalize-btn').addEventListener('click', finalize);
    document.querySelector('#toggle-filter-btn').addEventListener('click', () => {
      const panel = document.querySelector('#client-filter-panel');
      if (panel) panel.classList.toggle('hidden');
    });
  }
}

// --- Client Filter ---

function renderClientFilter() {
  let panel = document.querySelector('#client-filter-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'client-filter-panel';
    panel.className = 'weekly-client-filter hidden';
    const toolbar = document.querySelector('#weekly-toolbar');
    toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
  }

  if (!isEditable()) { panel.classList.add('hidden'); return; }

  const clients = state.clients || [];
  panel.innerHTML = `
    <div class="weekly-filter-header">
      <strong>Seleccionar clientes para el reporte</strong>
      <div class="weekly-filter-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="filter-select-all">Todos</button>
        <button type="button" class="btn btn-secondary btn-sm" id="filter-select-none">Ninguno</button>
        <button type="button" class="btn btn-sm" id="filter-apply">Aplicar</button>
      </div>
    </div>
    <div class="weekly-filter-grid">
      ${clients.map(c => `
        <label class="weekly-filter-item">
          <input type="checkbox" data-filter-client="${c.id}" ${selectedClientIds.has(c.id) ? 'checked' : ''}>
          <span>${escapeHtml(c.company || c.name)}</span>
          <small>${escapeHtml(c.status || '')}</small>
        </label>
      `).join('')}
    </div>
  `;

  document.querySelector('#filter-select-all').addEventListener('click', () => {
    panel.querySelectorAll('[data-filter-client]').forEach(cb => cb.checked = true);
  });
  document.querySelector('#filter-select-none').addEventListener('click', () => {
    panel.querySelectorAll('[data-filter-client]').forEach(cb => cb.checked = false);
  });
  document.querySelector('#filter-apply').addEventListener('click', () => {
    selectedClientIds = new Set();
    panel.querySelectorAll('[data-filter-client]').forEach(cb => {
      if (cb.checked) selectedClientIds.add(cb.dataset.filterClient);
    });
    panel.classList.add('hidden');
    renderSlides();
  });
}

// --- Save / Finalize ---

function collectClientData() {
  const result = [];
  document.querySelectorAll('[data-client-metric]').forEach(input => {
    const clientId = input.dataset.clientId;
    const metricType = input.dataset.metricType;
    const field = input.dataset.field;
    const value = input.value.trim() === '' ? null : Number(input.value);
    let existing = result.find(d => d.clientId === clientId && d.metricType === metricType);
    if (!existing) {
      const saved = clientData.find(d => d.clientId === clientId && d.metricType === metricType);
      existing = { id: saved?.id || undefined, clientId, metricType, currentValue: null, previousValue: null, ytdValue: null };
      result.push(existing);
    }
    if (field === 'current') existing.currentValue = value;
    if (field === 'previous') existing.previousValue = value;
    if (field === 'ytd') existing.ytdValue = value;
  });
  return result;
}

function collectNotes() {
  const notes = [];
  document.querySelectorAll('.weekly-notes-item').forEach(el => {
    const titleEl = el.querySelector('[data-note-title]');
    const descEl = el.querySelector('[data-note-desc]');
    const title = titleEl ? titleEl.value?.trim() : (el.querySelector('h3')?.textContent?.trim() || '');
    const description = descEl ? descEl.value?.trim() : (el.querySelector('p')?.textContent?.trim() || '');
    if (title || description) notes.push({ title, description });
  });
  return notes;
}

function collectMeetings() {
  const meetings = {};
  document.querySelectorAll('[data-meeting-cell]').forEach(el => {
    const key = el.dataset.meetingCell;
    meetings[key] = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
  });
  return meetings;
}

function collectFreeTrial() {
  const rows = [];
  document.querySelectorAll('.free-trial-row').forEach(el => {
    const name = el.querySelector('[data-ft-name]')?.value?.trim() || '';
    const status = el.querySelector('[data-ft-status]')?.value?.trim() || '';
    const forms = el.querySelector('[data-ft-forms]')?.value?.trim() || '';
    const endWeek = el.querySelector('[data-ft-end]')?.value?.trim() || '';
    const costs = el.querySelector('[data-ft-costs]')?.value?.trim() || '';
    if (name || status) rows.push({ name, status, forms, endWeek, costs });
  });
  return rows;
}

function collectClientNovedades() {
  const novedades = {};
  document.querySelectorAll('[data-client-novedades]').forEach(container => {
    const clientId = container.dataset.clientNovedades;
    const items = [];
    container.querySelectorAll('.weekly-novedad-item').forEach(el => {
      const titleEl = el.querySelector('[data-nov-title]');
      const descEl = el.querySelector('[data-nov-desc]');
      const title = titleEl ? titleEl.value?.trim() : (el.querySelector('h3')?.textContent?.trim() || '');
      const description = descEl ? descEl.value?.trim() : (el.querySelector('p')?.textContent?.trim() || '');
      if (title || description) items.push({ title, description });
    });
    if (items.length) novedades[clientId] = items;
  });
  return novedades;
}

async function saveDraft() {
  const btn = document.querySelector('#save-draft-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    const daysEl = document.querySelector('#days-elapsed');
    const daysElapsed = daysEl ? Number(daysEl.value) || 25 : report.daysElapsed;
    const meetings = collectMeetings();
    meetings.freeTrial = collectFreeTrial();
    meetings.clientNovedades = collectClientNovedades();
    meetings.selectedClients = [...selectedClientIds];
    await api(`/api/weekly-reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        daysElapsed,
        notes: collectNotes(),
        meetings,
        clientData: collectClientData()
      })
    });
    await loadReport();
    btn.textContent = 'Guardado!';
    setTimeout(() => { btn.textContent = 'Guardar Borrador'; btn.disabled = false; }, 1500);
  } catch (err) {
    btn.textContent = 'Guardar Borrador';
    btn.disabled = false;
    alert(err.message);
  }
}

async function finalize() {
  if (!confirm('Una vez finalizado no se podra editar. Continuar?')) return;
  await saveDraft();
  const btn = document.querySelector('#finalize-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Finalizando...'; }
  try {
    await api(`/api/weekly-reports/${reportId}/finalize`, { method: 'POST' });
    await loadReport();
    renderPage();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Guardado Final'; }
    alert(err.message);
  }
}

// --- Slides ---

function renderSlides() {
  destroyCharts();
  const container = document.querySelector('#weekly-container');
  const clients = getFilteredClients();
  const editable = isEditable();

  // Sort clients by consultor for the update slide
  const sortedClients = [...clients].sort((a, b) => (a.consultor || '').localeCompare(b.consultor || ''));

  container.innerHTML = `
    ${renderCoverSlide(editable)}
    ${renderClientUpdateSlide(sortedClients)}
    ${renderClientPlanSlide(clients, editable)}
    ${renderMeetingsSlide(editable)}
    ${renderClientStatusSlides(clients, editable)}
    ${renderFreeTrialSlide(editable)}
    ${renderNotesSlide(editable)}
    ${renderFinalSlide()}
  `;

  initCharts(clients);
  setupDynamicListeners();
}

// --- Slide: Cover ---

function renderCoverSlide(editable) {
  return `
    <div class="weekly-slide weekly-slide-cover">
      <div class="weekly-cover-logos">
        <img src="/images/logo-wim.jpeg" alt="WIM" class="weekly-cover-logo-img">
      </div>
      <h1 class="weekly-cover-title">weekly</h1>
      <div class="weekly-cover-date">
        <input type="text" class="date-input" value="${escapeHtml(report.weekLabel)}" ${editable ? '' : 'disabled'}>
      </div>
      <div class="weekly-cover-meta">
        <span>Dias del mes transcurridos:</span>
        <input type="number" id="days-elapsed" value="${report.daysElapsed}" ${editable ? '' : 'disabled'}>
        <span>/ 30</span>
      </div>
    </div>
  `;
}

// --- Slide: Client Update ---

function renderClientUpdateSlide(clients) {
  return `
    <div class="weekly-slide">
      <h2 class="weekly-slide-title">Update clientes - Seguimiento</h2>
      <div class="weekly-content-box">
        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Consultor / Area</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${clients.map(c => {
              const isWim = (c.consultor || '').toLowerCase().includes('wim');
              const tagClass = isWim ? 'tag-wim' : 'tag-klear';
              return `
                <tr>
                  <td><strong>${escapeHtml(c.company || c.name)}</strong></td>
                  <td><span class="tag ${tagClass}">${escapeHtml(c.consultor || '-')}</span></td>
                  <td>${escapeHtml(c.status || 'Activo')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --- Slide: Client Plan (editable metrics with rowspan) ---

function renderClientPlanSlide(clients, editable) {
  const metricLabels = { revenue: 'Real ($)', units: 'Real (u)', asp: 'Real (ASP)' };
  const metrics = ['revenue', 'units', 'asp'];

  return `
    <div class="weekly-slide">
      <h2 class="weekly-slide-title">Plan clientes Wim</h2>
      <div class="weekly-content-box" style="overflow-y:auto;max-height:75vh;">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Metrica</th>
              <th>Mes Anterior</th>
              <th>Mes Actual</th>
              <th>Estimado Mes</th>
              <th>YTD</th>
            </tr>
          </thead>
          <tbody>
            ${clients.map(c => metrics.map((metric, mi) => {
              const d = clientData.find(x => x.clientId === c.id && x.metricType === metric);
              const current = d?.currentValue ?? '';
              const previous = d?.previousValue ?? '';
              const ytd = d?.ytdValue ?? '';
              const days = report.daysElapsed || 25;
              const estimated = current !== '' && days > 0 ? Math.round((Number(current) / days) * 30) : '';
              const prefix = (metric === 'revenue' || metric === 'asp') ? '$' : '';
              return `
                <tr>
                  ${mi === 0 ? `<td rowspan="3"><strong>${escapeHtml(c.company || c.name)}</strong></td>` : ''}
                  <td>${metricLabels[metric]}</td>
                  <td>${editable
                    ? `<td class="editable-cell"><input data-client-metric data-client-id="${c.id}" data-metric-type="${metric}" data-field="previous" value="${previous}" step="any"></td>`
                    : `<td>${previous !== '' ? prefix + Number(previous).toLocaleString('es-AR') : '-'}</td>`}
                  <td class="editable-cell">${editable
                    ? `<input data-client-metric data-client-id="${c.id}" data-metric-type="${metric}" data-field="current" value="${current}" step="any">`
                    : `${current !== '' ? prefix + Number(current).toLocaleString('es-AR') : '-'}`}</td>
                  <td class="highlight-cell" data-estimated-for="${c.id}-${metric}">${estimated !== '' ? prefix + Number(estimated).toLocaleString('es-AR') : '-'}</td>
                  ${editable
                    ? `<td class="editable-cell"><input data-client-metric data-client-id="${c.id}" data-metric-type="${metric}" data-field="ytd" value="${ytd}" step="any"></td>`
                    : `<td>${ytd !== '' ? prefix + Number(ytd).toLocaleString('es-AR') : '-'}</td>`}
                </tr>
              `;
            }).join('')).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --- Slide: Meetings (time-based grid with real calendar events) ---

function renderMeetingsSlide(editable) {
  const meetings = report.meetings || {};
  const hours = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
  const days = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes'];
  const dayIndex = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 }; // ISO weekday to array index

  // Build a map of calendar events by day+hour
  const eventMap = {};
  const allClients = state.clients || [];
  calendarEvents.forEach(evt => {
    const d = new Date(evt.startsAt);
    const isoDay = d.getDay() === 0 ? 7 : d.getDay();
    const di = dayIndex[isoDay];
    if (di === undefined) return;
    const h = String(d.getHours()).padStart(2, '0') + ':00';
    const key = `${days[di].toLowerCase()}_${h.replace(':', '')}`;
    const client = allClients.find(c => c.id === evt.clientId);
    const label = evt.title + (client ? ` (${client.company || client.name})` : '');
    eventMap[key] = eventMap[key] ? eventMap[key] + '\n' + label : label;
  });

  return `
    <div class="weekly-slide">
      <h2 class="weekly-slide-title">Reuniones Agendadas</h2>
      <div class="weekly-content-box">
        <table class="weekly-meetings-table">
          <thead>
            <tr>
              <th>Horario</th>
              ${days.map(d => `<th>${d}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${hours.map(hour => `
              <tr>
                <td><strong>${hour}</strong></td>
                ${days.map(day => {
                  const key = `${day.toLowerCase()}_${hour.replace(':', '')}`;
                  const saved = meetings[key] || '';
                  const fromCalendar = eventMap[key] || '';
                  const val = saved || fromCalendar;
                  return `<td>${editable
                    ? `<textarea data-meeting-cell="${key}" rows="2">${escapeHtml(val)}</textarea>`
                    : `${val ? escapeHtml(val) : ''}`}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --- Slides: Client Status (grouped by consultor) ---

function renderClientStatusSlides(clients, editable) {
  // Group clients by consultor
  const groups = {};
  clients.forEach(c => {
    const key = c.consultor || 'Sin consultor';
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });

  const consultorNames = Object.keys(groups).sort();
  let html = '';
  let groupNum = 1;

  consultorNames.forEach(consultor => {
    const group = groups[consultor];
    // One separator per consultor group
    html += `
      <div class="weekly-slide weekly-slide-separator">
        <h1>${groupNum} ${escapeHtml(consultor)}</h1>
      </div>
    `;
    // One status slide per client within the group
    group.forEach(c => {
      const novedades = report.meetings?.clientNovedades?.[c.id] || [];
      html += `
        <div class="weekly-slide">
          <h2 class="weekly-slide-title">Estado Cliente | ${escapeHtml(c.company || c.name)} | ${escapeHtml(consultor)}</h2>
          <div class="weekly-content-box weekly-client-status-grid">
            <div class="weekly-client-novedades">
              ${editable ? `<button class="btn-slide btn-slide-add" type="button" data-add-novedad="${c.id}">+ Agregar Novedad</button>` : ''}
              <div data-client-novedades="${c.id}">
                ${novedades.map(n => renderNovedadItem(n, editable)).join('')}
              </div>
            </div>
            <div class="weekly-chart-container">
              <canvas id="chart-${c.id}"></canvas>
            </div>
          </div>
        </div>
      `;
    });
    groupNum++;
  });

  return html;
}

function renderNovedadItem(novedad, editable) {
  if (!editable) {
    return `<div class="weekly-novedad-item">
      <h3>${escapeHtml(novedad.title || '')}</h3>
      <p>${escapeHtml(novedad.description || '')}</p>
    </div>`;
  }
  return `<div class="weekly-novedad-item">
    <input type="text" data-nov-title placeholder="Titulo" value="${escapeHtml(novedad.title || '')}">
    <textarea data-nov-desc placeholder="Descripcion..." rows="3">${escapeHtml(novedad.description || '')}</textarea>
    <button class="btn-slide btn-slide-delete" type="button" data-remove-novedad>Eliminar</button>
  </div>`;
}

// --- Slide: Free Trial ---

function renderFreeTrialSlide(editable) {
  const freeTrial = report.meetings?.freeTrial || [];

  return `
    <div class="weekly-slide">
      <h2 class="weekly-slide-title">Estados Free Trial</h2>
      <div class="weekly-content-box">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Forms</th>
              <th>Semana fin</th>
              <th>Costos cargados</th>
              ${editable ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody id="free-trial-body">
            ${freeTrial.map((ft, i) => renderFreeTrialRow(ft, editable)).join('')}
            ${!freeTrial.length && !editable ? '<tr><td colspan="5" style="color:#999;">Sin datos</td></tr>' : ''}
          </tbody>
        </table>
        ${editable ? '<button class="btn-slide btn-slide-add" type="button" id="add-ft-row" style="margin-top:10px;">+ Agregar fila</button>' : ''}
      </div>
    </div>
  `;
}

function renderFreeTrialRow(ft, editable) {
  if (!editable) {
    return `<tr>
      <td>${escapeHtml(ft.name || '-')}</td>
      <td>${escapeHtml(ft.status || '-')}</td>
      <td>${escapeHtml(ft.forms || '-')}</td>
      <td>${escapeHtml(ft.endWeek || '-')}</td>
      <td>${escapeHtml(ft.costs || '-')}</td>
    </tr>`;
  }
  return `<tr class="free-trial-row">
    <td><input class="ft-input" data-ft-name value="${escapeHtml(ft.name || '')}"></td>
    <td><input class="ft-input" data-ft-status value="${escapeHtml(ft.status || '')}"></td>
    <td><input class="ft-input" data-ft-forms value="${escapeHtml(ft.forms || '')}"></td>
    <td><input class="ft-input" data-ft-end value="${escapeHtml(ft.endWeek || '')}"></td>
    <td><input class="ft-input" data-ft-costs value="${escapeHtml(ft.costs || '')}"></td>
    <td><button class="btn-slide btn-slide-delete" type="button" data-remove-ft>&times;</button></td>
  </tr>`;
}

// --- Slide: Notes ---

function renderNotesSlide(editable) {
  const notes = report.notes || [];

  return `
    <div class="weekly-slide">
      <h2 class="weekly-slide-title">Notas Adicionales</h2>
      <div class="weekly-content-box">
        ${editable ? '<button class="btn-slide btn-slide-add" type="button" id="add-note-btn">+ Agregar Seccion</button>' : ''}
        <div id="notes-container">
          ${notes.map(n => renderNoteItem(n, editable)).join('')}
          ${!notes.length && !editable ? '<p style="color:rgba(255,255,255,0.5);">Sin notas</p>' : ''}
        </div>
      </div>
    </div>
  `;
}

function renderNoteItem(note, editable) {
  if (!editable) {
    return `<div class="weekly-notes-item">
      <h3>${escapeHtml(note.title || 'Sin titulo')}</h3>
      <p>${escapeHtml(note.description || '')}</p>
    </div>`;
  }
  return `<div class="weekly-notes-item">
    <input type="text" data-note-title placeholder="Titulo" value="${escapeHtml(note.title || '')}">
    <textarea data-note-desc rows="3" placeholder="Descripcion...">${escapeHtml(note.description || '')}</textarea>
    <button class="btn-slide btn-slide-delete" type="button" data-remove-note>Eliminar</button>
  </div>`;
}

// --- Slide: Final ---

function renderFinalSlide() {
  return `
    <div class="weekly-slide weekly-slide-separator">
      <h1>Muchas gracias!</h1>
    </div>
  `;
}

// --- Charts (line charts like original) ---

function destroyCharts() {
  charts.forEach(c => c.destroy());
  charts = [];
}

function initCharts(clients) {
  clients.forEach(c => {
    const canvas = document.getElementById(`chart-${c.id}`);
    if (!canvas) return;

    const revenue = clientData.find(x => x.clientId === c.id && x.metricType === 'revenue');
    const units = clientData.find(x => x.clientId === c.id && x.metricType === 'units');

    // Generate mock weekly labels and trend data based on current values
    const weeks = Array.from({ length: 38 }, (_, i) => `Sem ${i + 1}`);
    const currentRev = Number(revenue?.currentValue || 0);
    const currentUnits = Number(units?.currentValue || 0);
    const baseRev = currentRev > 0 ? currentRev * 0.7 : 15000000;
    const baseUnits = currentUnits > 0 ? currentUnits * 0.7 : 100;

    const revenueData = weeks.map((_, i) => Math.floor(baseRev + Math.sin(i / 2) * baseRev * 0.3 + i * (baseRev * 0.01)));
    const unitsData = weeks.map((_, i) => Math.floor(baseUnits + Math.cos(i / 2) * baseUnits * 0.2 + i * 2));

    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [
          {
            label: 'Facturacion ($)',
            data: revenueData,
            borderColor: '#00d4ff',
            backgroundColor: 'rgba(0, 212, 255, 0.1)',
            borderWidth: 2,
            tension: 0.2,
            yAxisID: 'y'
          },
          {
            label: 'Unidades',
            data: unitsData,
            borderColor: '#ffcc00',
            borderWidth: 2,
            tension: 0.2,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#333', font: { size: 10 } } }
        },
        scales: {
          x: { ticks: { color: '#333', font: { size: 9 } } },
          y: { type: 'linear', display: true, position: 'left', ticks: { color: '#333', font: { size: 9 } } },
          y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#333', font: { size: 9 } } }
        }
      }
    });
    charts.push(chart);
  });
}

// --- Dynamic event listeners ---

function setupDynamicListeners() {
  const editable = isEditable();
  if (!editable) return;

  // Estimated cell recalculation
  document.querySelectorAll('[data-client-metric][data-field="current"]').forEach(input => {
    input.addEventListener('input', () => {
      const clientId = input.dataset.clientId;
      const metricType = input.dataset.metricType;
      const daysEl = document.querySelector('#days-elapsed');
      const days = daysEl ? Number(daysEl.value) || 25 : 25;
      const val = input.value.trim() === '' ? null : Number(input.value);
      const cell = document.querySelector(`[data-estimated-for="${clientId}-${metricType}"]`);
      if (!cell) return;
      if (val !== null && days > 0) {
        const est = Math.round((val / days) * 30);
        const prefix = (metricType === 'revenue' || metricType === 'asp') ? '$' : '';
        cell.textContent = prefix + est.toLocaleString('es-AR');
      } else {
        cell.textContent = '-';
      }
    });
  });

  // Recalculate estimates when days elapsed changes
  const daysEl = document.querySelector('#days-elapsed');
  if (daysEl) {
    daysEl.addEventListener('input', () => {
      document.querySelectorAll('[data-client-metric][data-field="current"]').forEach(input => {
        input.dispatchEvent(new Event('input'));
      });
    });
  }

  // Add free trial row
  const addFtBtn = document.querySelector('#add-ft-row');
  if (addFtBtn) {
    addFtBtn.addEventListener('click', () => {
      const tbody = document.querySelector('#free-trial-body');
      const tr = document.createElement('tr');
      tr.className = 'free-trial-row';
      tr.innerHTML = `
        <td><input class="ft-input" data-ft-name></td>
        <td><input class="ft-input" data-ft-status></td>
        <td><input class="ft-input" data-ft-forms></td>
        <td><input class="ft-input" data-ft-end></td>
        <td><input class="ft-input" data-ft-costs></td>
        <td><button class="btn-slide btn-slide-delete" type="button" data-remove-ft>&times;</button></td>
      `;
      tbody.appendChild(tr);
      tr.querySelector('[data-remove-ft]').addEventListener('click', () => tr.remove());
    });
  }

  // Remove free trial rows
  document.querySelectorAll('[data-remove-ft]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('tr').remove());
  });

  // Add novedad per client
  document.querySelectorAll('[data-add-novedad]').forEach(btn => {
    btn.addEventListener('click', () => {
      const clientId = btn.dataset.addNovedad;
      const container = document.querySelector(`[data-client-novedades="${clientId}"]`);
      const div = document.createElement('div');
      div.className = 'weekly-novedad-item';
      div.innerHTML = `
        <input type="text" data-nov-title placeholder="Titulo">
        <textarea data-nov-desc placeholder="Descripcion..." rows="3"></textarea>
        <button class="btn-slide btn-slide-delete" type="button" data-remove-novedad>Eliminar</button>
      `;
      container.appendChild(div);
      div.querySelector('[data-remove-novedad]').addEventListener('click', () => div.remove());
    });
  });

  // Remove novedad
  document.querySelectorAll('[data-remove-novedad]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.weekly-novedad-item').remove());
  });

  // Add note
  const addNoteBtn = document.querySelector('#add-note-btn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', () => {
      const container = document.querySelector('#notes-container');
      const div = document.createElement('div');
      div.className = 'weekly-notes-item';
      div.innerHTML = `
        <input type="text" data-note-title placeholder="Titulo">
        <textarea data-note-desc rows="3" placeholder="Descripcion..."></textarea>
        <button class="btn-slide btn-slide-delete" type="button" data-remove-note>Eliminar</button>
      `;
      container.appendChild(div);
      div.querySelector('[data-remove-note]').addEventListener('click', () => div.remove());
    });
  }

  // Remove notes
  document.querySelectorAll('[data-remove-note]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.weekly-notes-item').remove());
  });
}

boot();
