import { api, requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml, setButtonLoading } from './utils.js';

const currentUser = requireSession();
const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const currentDate = new Date();
let state;
let selectedYear = currentDate.getFullYear();
let selectedMonth = currentDate.getMonth() + 1;
let selectedClientIds = new Set();
const details = new Map();

async function boot() {
  state = await loadAppState();
  const requestedClients = new URLSearchParams(window.location.search).getAll('client');
  const validRequested = requestedClients.filter((id) => state.clients.some((client) => client.id === id));
  selectedClientIds = new Set(validRequested.length ? validRequested : sortedClients().slice(0, 1).map((client) => client.id));
  renderSidebar({ state, currentUser, activePage: 'publicidad', onRefresh: refresh });
  setupPeriodControls();
  renderClientPicker();
  await loadSelectedClients();
}

async function refresh() {
  state = await refreshAppState();
  selectedClientIds = new Set([...selectedClientIds].filter((id) => state.clients.some((client) => client.id === id)));
  details.clear();
  renderClientPicker();
  await loadSelectedClients();
}

function sortedClients() {
  return [...state.clients].sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name, 'es'));
}

function setupPeriodControls() {
  document.querySelector('#advertising-month').innerHTML = monthNames.map((name, index) => `<option value="${index + 1}" ${index + 1 === selectedMonth ? 'selected' : ''}>${name}</option>`).join('');
  renderYearOptions();
  document.querySelector('#advertising-year').onchange = (event) => { selectedYear = Number(event.target.value); renderAdvertisingGrids(); };
  document.querySelector('#advertising-month').onchange = (event) => { selectedMonth = Number(event.target.value); renderAdvertisingGrids(); };
  document.querySelector('#select-all-advertising').onclick = async () => {
    selectedClientIds = new Set(sortedClients().map((client) => client.id));
    renderClientPicker();
    await loadSelectedClients();
  };
  document.querySelector('#clear-advertising-selection').onclick = () => {
    selectedClientIds.clear();
    renderClientPicker();
    renderAdvertisingGrids();
  };
}

function renderYearOptions() {
  const metricYears = [...details.values()].flatMap((detail) => (detail.advertisingMetrics || []).map((item) => Number(item.year)));
  const years = [...new Set([currentDate.getFullYear(), selectedYear, ...metricYears])].sort((a, b) => b - a);
  document.querySelector('#advertising-year').innerHTML = years.map((year) => `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`).join('');
}

function renderClientPicker() {
  const clients = sortedClients();
  document.querySelector('#advertising-client-options').innerHTML = clients.length ? clients.map((client) => `<label class="advertising-client-option"><input type="checkbox" value="${escapeHtml(client.id)}" ${selectedClientIds.has(client.id) ? 'checked' : ''}><span><strong>${escapeHtml(client.company || client.name)}</strong><small>${escapeHtml(client.name || 'Sin contacto')}</small></span></label>`).join('') : '<span class="muted-value">No hay clientes.</span>';
  document.querySelector('#advertising-selection-count').textContent = `${selectedClientIds.size} seleccionados`;
  document.querySelectorAll('#advertising-client-options input').forEach((input) => input.addEventListener('change', async () => {
    if (input.checked) selectedClientIds.add(input.value);
    else selectedClientIds.delete(input.value);
    document.querySelector('#advertising-selection-count').textContent = `${selectedClientIds.size} seleccionados`;
    await loadSelectedClients();
  }));
}

async function loadSelectedClients() {
  if (!selectedClientIds.size) return renderAdvertisingGrids();
  renderLoading();
  const missingIds = [...selectedClientIds].filter((id) => !details.has(id));
  const loaded = await Promise.all(missingIds.map(async (id) => [id, await api(`/api/clients/${encodeURIComponent(id)}/detail`)]));
  loaded.forEach(([id, detail]) => details.set(id, detail));
  const latest = [...selectedClientIds].map((id) => details.get(id)?.advertisingMetrics?.[0]).filter(Boolean).sort((a, b) => b.year - a.year || b.month - a.month)[0];
  const selectedPeriodExists = [...selectedClientIds].some((id) => (details.get(id)?.advertisingMetrics || []).some((item) => item.year === selectedYear && item.month === selectedMonth));
  if (latest && !selectedPeriodExists) {
    selectedYear = Number(latest.year);
    selectedMonth = Number(latest.month);
    document.querySelector('#advertising-month').value = String(selectedMonth);
  }
  renderYearOptions();
  renderAdvertisingGrids();
}

function clientWeeks(detail) {
  return Array.from({ length: 5 }, (_, index) => detail?.advertisingMetrics?.find((item) => item.year === selectedYear && item.month === selectedMonth && item.week === index + 1)
    || { week: index + 1, roas: null, tacos: null, dailyBudget: null, consumedBudget: null, targetTacos: null });
}

function averageFilled(weeks, key) {
  const values = weeks.map((week) => week[key]).filter((value) => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
}

function renderAdvertisingGrids() {
  const container = document.querySelector('#advertising-global-content');
  if (!selectedClientIds.size) {
    container.innerHTML = '<div class="client-empty-state">Seleccioná uno o más clientes para ver sus cuadrículas.</div>';
    return;
  }
  container.innerHTML = [...selectedClientIds].map((clientId) => renderClientGrid(clientId, details.get(clientId))).join('');
  container.querySelectorAll('[data-edit-client-advertising]').forEach((button) => button.addEventListener('click', () => openAdvertisingEditor(button.dataset.editClientAdvertising)));
}

function renderClientGrid(clientId, detail) {
  if (!detail) return '';
  const weeks = clientWeeks(detail);
  const hasData = weeks.some((week) => ['roas', 'tacos', 'dailyBudget', 'consumedBudget', 'targetTacos'].some((key) => week[key] !== null));
  const title = escapeHtml(detail.client.company || detail.client.name);
  const heading = `<div class="advertising-client-heading"><div><p class="eyebrow">Cuenta</p><h2>${title}</h2></div><div class="advertising-grid-actions"><a class="btn btn-secondary btn-sm" href="/cliente?id=${encodeURIComponent(clientId)}">Ver cliente</a><button class="btn btn-sm" type="button" data-edit-client-advertising="${escapeHtml(clientId)}">Editar</button></div></div>`;
  if (!hasData) return `<article class="advertising-client-grid">${heading}<div class="client-empty-state compact">Sin publicidad cargada para ${monthNames[selectedMonth - 1]} ${selectedYear}.</div></article>`;
  const totalDays = new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate();
  const realBudget = weeks.reduce((sum, week) => sum + Number(week.consumedBudget || 0), 0);
  const dailyBudget = averageFilled(weeks, 'dailyBudget');
  const projectedBudget = dailyBudget === null ? null : dailyBudget * totalDays;
  const targetTacos = averageFilled(weeks, 'targetTacos');
  const rows = [
    { label: 'ROAS', key: 'roas', close: averageFilled(weeks, 'roas'), type: 'number' },
    { label: 'TACOS', key: 'tacos', close: averageFilled(weeks, 'tacos'), type: 'percent', compare: true },
    { label: 'Presupuesto diario', key: 'dailyBudget', close: dailyBudget, type: 'money' },
    { label: 'Presupuesto consumido', key: 'consumedBudget', close: realBudget, type: 'money' },
    { label: 'TACOS objetivo', key: 'targetTacos', close: targetTacos, type: 'percent' }
  ];
  const formatter = (value, type) => type === 'money' ? formatMetric(value, true) : type === 'percent' ? formatPercent(value) : formatMetric(value, false);
  const alertClass = (actual, target) => actual !== null && actual !== undefined && target !== null && target !== undefined && Number(actual) > Number(target) ? ' tacos-over-target' : '';
  return `<article class="advertising-client-grid">${heading}
    <div class="advertising-summary"><div class="metric-kpi"><span>Presupuesto real</span><strong>${formatMetric(realBudget, true)}</strong></div><div class="metric-kpi"><span>Presupuesto proyectado</span><strong>${formatMetric(projectedBudget, true)}</strong></div><div class="metric-kpi"><span>TACOS objetivo</span><strong>${formatPercent(targetTacos)}</strong></div></div>
    <div class="metrics-table-wrap"><table class="table metrics-table advertising-table"><thead><tr><th>Métrica</th>${weeks.map((week) => `<th>Semana ${week.week}</th>`).join('')}<th class="monthly-close-column">Cierre mensual</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${row.label}</strong></td>${weeks.map((week) => `<td class="${row.compare ? alertClass(week[row.key], week.targetTacos) : ''}">${formatter(week[row.key], row.type)}</td>`).join('')}<td class="monthly-close-column${row.compare ? alertClass(row.close, targetTacos) : ''}">${formatter(row.close, row.type)}</td></tr>`).join('')}<tr><td><strong>Presupuesto proyectado</strong></td>${weeks.map((week, index) => `<td>${formatMetric(week.dailyBudget === null ? null : Number(week.dailyBudget) * Math.max(0, Math.min(7, totalDays - index * 7)), true)}</td>`).join('')}<td class="monthly-close-column">${formatMetric(projectedBudget, true)}</td></tr></tbody></table></div></article>`;
}

function renderLoading() {
  document.querySelector('#advertising-global-content').innerHTML = '<div class="client-empty-state">Cargando clientes seleccionados...</div>';
}

async function openAdvertisingEditor(clientId) {
  const detail = details.get(clientId);
  if (!detail) return;
  try {
    const data = await api(`/api/clients/${encodeURIComponent(clientId)}/advertising/${selectedYear}/${selectedMonth}`);
    const fields = [['roas', 'ROAS', ''], ['tacos', 'TACOS', '%'], ['dailyBudget', 'Presupuesto diario', '$'], ['consumedBudget', 'Presupuesto consumido', '$'], ['targetTacos', 'TACOS objetivo', '%']];
    const overlay = openModal(`<div class="modal-overlay"><form class="modal advertising-editor-modal"><div class="modal-header">${escapeHtml(detail.client.company || detail.client.name)} · ${monthNames[selectedMonth - 1]} ${selectedYear}</div><p class="form-hint">Dejá una celda vacía si esa semana todavía no tiene información.</p><div class="advertising-editor-wrap"><table class="advertising-editor-table"><thead><tr><th>Métrica</th>${data.weeks.map((week) => `<th>Semana ${week.week}</th>`).join('')}</tr></thead><tbody>${fields.map(([key, label, suffix]) => `<tr><td><strong>${label}</strong></td>${data.weeks.map((week) => `<td><div class="ad-input-wrap">${suffix === '$' ? '<span>$</span>' : ''}<input class="form-control" type="number" min="0" ${suffix === '%' ? 'max="100"' : ''} step="0.01" data-ad-field="${key}" data-week="${week.week}" value="${week[key] ?? ''}">${suffix === '%' ? '<span>%</span>' : ''}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Guardar</button></div></form></div>`);
    overlay.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = overlay.querySelector('button[type="submit"]');
      setButtonLoading(submit, true, 'Guardando...');
      const weeks = data.weeks.map((week) => Object.fromEntries(fields.map(([key]) => {
        const value = overlay.querySelector(`[data-ad-field="${key}"][data-week="${week.week}"]`).value;
        return [key, value === '' ? null : Number(value)];
      })));
      try {
        await api(`/api/clients/${encodeURIComponent(clientId)}/advertising/${selectedYear}/${selectedMonth}`, { method: 'PUT', body: JSON.stringify({ weeks }) });
        closeModal();
        details.set(clientId, await api(`/api/clients/${encodeURIComponent(clientId)}/detail`));
        renderAdvertisingGrids();
      } catch (error) { alert(error.message); setButtonLoading(submit, false); }
    });
  } catch (error) { alert(error.message); }
}

function formatMetric(value, money) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="metric-empty">—</span>';
  return `${money ? '$ ' : ''}${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="metric-empty">—</span>';
  return `${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}

boot().catch((error) => {
  document.querySelector('#advertising-global-content').innerHTML = `<div class="client-empty-state">${escapeHtml(error.message)}</div>`;
});
