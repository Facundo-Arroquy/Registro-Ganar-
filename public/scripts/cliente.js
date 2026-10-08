import { api, requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { closeModal, openModal, renderSidebar } from './layout.js';
import { escapeHtml, formatBankDuration, getInitials, setButtonLoading } from './utils.js';

const currentUser = requireSession();
const clientId = new URLSearchParams(window.location.search).get('id');
if (!clientId) window.location.href = '/clientes';

const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const metricConfig = {
  revenue: { label: 'Facturación', color: '#58a6ff', money: true },
  units: { label: 'Unidades', color: '#3fb950', money: false },
  asp: { label: 'ASP', color: '#d29922', money: true }
};
let state;
let detail;
let selectedYear;
let selectedAdvertisingYear;
let selectedAdvertisingMonth;
let metricsChart;

async function boot() {
  [state, detail] = await Promise.all([loadAppState(), api(`/api/clients/${encodeURIComponent(clientId)}/detail`)]);
  selectedYear = availableYears()[0] || new Date().getFullYear();
  selectedAdvertisingYear = advertisingYears()[0] || new Date().getFullYear();
  selectedAdvertisingMonth = detail.advertisingMetrics?.length
    ? Number(detail.advertisingMetrics[0].month)
    : (detail.currentPeriodSummary?.month || new Date().getMonth() + 1);
  renderSidebar({ state, currentUser, activePage: 'clientes', onRefresh: refresh });
  renderPage();
}

async function refresh() {
  [state, detail] = await Promise.all([refreshAppState(), api(`/api/clients/${encodeURIComponent(clientId)}/detail`)]);
  renderPage();
}

function availableYears() {
  return [...new Set([new Date().getFullYear(), ...(detail?.metrics || []).map((item) => Number(item.year))])].sort((a, b) => b - a);
}

function advertisingYears() {
  return [...new Set([new Date().getFullYear(), ...(detail?.advertisingMetrics || []).map((item) => Number(item.year))])].sort((a, b) => b - a);
}

function renderPage() {
  const client = detail.client;
  const owner = state.users.find((user) => user.id === client.ownerId);
  document.title = `${client.company || client.name} | WIM`;
  document.querySelector('#client-detail').innerHTML = `
    <a class="client-detail-back" href="/clientes">&larr; Todos los clientes</a>
    <header class="client-profile-header">
      <div class="client-profile-avatar">${escapeHtml(getInitials(client.company || client.name))}</div>
      <div class="client-profile-identity">
        <div class="client-profile-title"><h1>${escapeHtml(client.company || client.name)}</h1>${renderConfiguredBadge('clientStatuses', client.status || 'Sin estado')}</div>
        <p>${escapeHtml(client.name || 'Sin contacto principal')}</p>
      </div>
      <button class="btn btn-secondary" type="button" id="edit-client">Editar cliente</button>
    </header>
    <section class="client-info-grid">
      ${infoItem('Contacto', client.name || '-')}
      ${infoItem('Correo', client.email || '-')}
      ${infoItem('Responsable', owner?.name || 'Sin asignar')}
      ${infoHtmlItem('Consultores', renderConsultorBadges(client.consultors || (client.consultor ? [client.consultor] : [])))}
      ${client.complexity ? infoHtmlItem('Complejidad', renderConfiguredBadge('complexities', client.complexity)) : infoItem('Complejidad', 'Sin definir')}
      ${client.adStatus ? infoHtmlItem('Publicidad', renderConfiguredBadge('adStatuses', client.adStatus)) : infoItem('Publicidad', 'Sin definir')}
      ${infoItem('Usuario de Mercado Libre', client.meliUser || 'Sin definir')}
      ${credentialItem('Contraseña de Mercado Libre', client.meliPassword)}
      ${infoItem('Categoría de VS', client.vsCategory || 'Sin definir')}
      ${infoItem('Reunión habitual', formatRecurringMeeting(client))}
      ${infoItem('Banco de tiempo', formatBankDuration(client.timeBankSeconds))}
    </section>
    ${renderLinks(client.links || [])}
    <section class="client-detail-section">
      <div class="client-section-heading"><div><p class="eyebrow">Resultados</p><h2>Métricas históricas</h2></div><div class="metrics-heading-actions"><div class="metrics-year-tabs" id="metrics-year-tabs"></div><label class="metric-month-editor"><span>Mes</span><select class="form-control" id="edit-month-select">${monthNames.map((name, index) => `<option value="${index + 1}" ${index + 1 === (detail.currentPeriodSummary?.month || new Date().getMonth() + 1) ? 'selected' : ''}>${name}</option>`).join('')}</select></label><button class="btn btn-sm" type="button" id="edit-selected-month">Editar mes</button></div></div>
      <div id="metrics-content"></div>
    </section>
    <section class="client-detail-section">
      <div class="client-section-heading"><div><p class="eyebrow">Publicidad</p><h2>Rendimiento semanal</h2></div><div class="metrics-heading-actions"><div class="metrics-year-tabs" id="advertising-year-tabs"></div><label class="metric-month-editor"><span>Mes</span><select class="form-control" id="advertising-month-select">${monthNames.map((name, index) => `<option value="${index + 1}" ${index + 1 === selectedAdvertisingMonth ? 'selected' : ''}>${name}</option>`).join('')}</select></label><button class="btn btn-sm" type="button" id="edit-advertising-month">Editar publicidad</button></div></div>
      <div id="advertising-content"></div>
    </section>
    <div class="client-detail-columns">
      <section class="client-detail-section"><div class="client-section-heading"><div><p class="eyebrow">Seguimiento</p><h2>Comentarios de reuniones</h2></div></div>${renderCommentComposer()}${renderComments()}</section>
      <section class="client-detail-section"><div class="client-section-heading"><div><p class="eyebrow">Agenda</p><h2>Reuniones</h2></div></div>${renderMeetings()}</section>
    </div>
    <section class="client-detail-section"><div class="client-section-heading"><div><p class="eyebrow">Trabajo</p><h2>Tarjetas relacionadas</h2></div><span class="section-count">${detail.cards.length}</span></div>${renderCards()}</section>
  `;
  renderMetricYearTabs();
  renderMetrics();
  renderAdvertisingYearTabs();
  renderAdvertising();
  setupCommentActions();
  setupCredentialToggle();
  document.querySelector('#edit-client')?.addEventListener('click', openClientEditor);
  document.querySelector('#edit-selected-month')?.addEventListener('click', openMonthEditor);
  document.querySelector('#advertising-month-select')?.addEventListener('change', (event) => {
    selectedAdvertisingMonth = Number(event.target.value);
    renderAdvertising();
  });
  document.querySelector('#edit-advertising-month')?.addEventListener('click', openAdvertisingEditor);
}

function renderAdvertisingYearTabs() {
  const container = document.querySelector('#advertising-year-tabs');
  container.innerHTML = advertisingYears().map((year) => `<button type="button" class="metric-year-btn ${year === selectedAdvertisingYear ? 'active' : ''}" data-advertising-year="${year}">${year}</button>`).join('');
  container.querySelectorAll('[data-advertising-year]').forEach((button) => button.addEventListener('click', () => {
    selectedAdvertisingYear = Number(button.dataset.advertisingYear);
    renderAdvertisingYearTabs();
    renderAdvertising();
  }));
}

function advertisingWeeks() {
  return Array.from({ length: 5 }, (_, index) => detail.advertisingMetrics?.find((item) => item.year === selectedAdvertisingYear && item.month === selectedAdvertisingMonth && item.week === index + 1)
    || { week: index + 1, roas: null, tacos: null, dailyBudget: null, consumedBudget: null, targetTacos: null });
}

function averageFilled(weeks, key) {
  const values = weeks.map((week) => week[key]).filter((value) => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
}

function renderAdvertising() {
  const container = document.querySelector('#advertising-content');
  const weeks = advertisingWeeks();
  const hasData = weeks.some((week) => ['roas', 'tacos', 'dailyBudget', 'consumedBudget', 'targetTacos'].some((key) => week[key] !== null));
  if (!hasData) {
    container.innerHTML = '<div class="client-empty-state">Todavía no hay publicidad cargada para este mes. Usá “Editar publicidad” para comenzar.</div>';
    return;
  }
  const totalDays = new Date(Date.UTC(selectedAdvertisingYear, selectedAdvertisingMonth, 0)).getUTCDate();
  const realBudget = weeks.reduce((sum, week) => sum + Number(week.consumedBudget || 0), 0);
  const dailyBudget = averageFilled(weeks, 'dailyBudget');
  const projectedBudget = dailyBudget === null ? null : dailyBudget * totalDays;
  const rows = [
    { label: 'ROAS', key: 'roas', close: averageFilled(weeks, 'roas'), type: 'number' },
    { label: 'TACOS', key: 'tacos', close: averageFilled(weeks, 'tacos'), type: 'percent', compareWithTarget: true },
    { label: 'Presupuesto diario', key: 'dailyBudget', close: dailyBudget, type: 'money' },
    { label: 'Presupuesto consumido', key: 'consumedBudget', close: realBudget, type: 'money' },
    { label: 'TACOS objetivo', key: 'targetTacos', close: averageFilled(weeks, 'targetTacos'), type: 'percent' }
  ];
  const formatter = (value, type) => type === 'money' ? formatMetric(value, true) : type === 'percent' ? formatPercent(value) : formatDecimal(value);
  const targetTacos = averageFilled(weeks, 'targetTacos');
  const tacosCellClass = (tacos, target) => tacos !== null && tacos !== undefined && target !== null && target !== undefined && Number(tacos) > Number(target) ? ' tacos-over-target' : '';
  container.innerHTML = `
    <div class="advertising-summary"><div class="metric-kpi"><span>Presupuesto real</span><strong>${formatMetric(realBudget, true)}</strong><small>Consumido en las 5 semanas</small></div><div class="metric-kpi"><span>Presupuesto proyectado</span><strong>${formatMetric(projectedBudget, true)}</strong><small>Presupuesto diario promedio × ${totalDays} días</small></div><div class="metric-kpi"><span>TACOS objetivo</span><strong>${formatPercent(targetTacos)}</strong><small>Promedio objetivo mensual</small></div></div>
    <div class="metrics-table-wrap"><table class="table metrics-table advertising-table"><thead><tr><th>Métrica</th>${weeks.map((week) => `<th>Semana ${week.week}</th>`).join('')}<th class="monthly-close-column">Cierre mensual</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${row.label}</strong></td>${weeks.map((week) => `<td class="${row.compareWithTarget ? tacosCellClass(week[row.key], week.targetTacos) : ''}">${formatter(week[row.key], row.type)}</td>`).join('')}<td class="monthly-close-column${row.compareWithTarget ? tacosCellClass(row.close, targetTacos) : ''}">${formatter(row.close, row.type)}</td></tr>`).join('')}<tr><td><strong>Presupuesto proyectado</strong></td>${weeks.map((week, index) => `<td>${formatMetric(week.dailyBudget === null ? null : Number(week.dailyBudget) * Math.max(0, Math.min(7, totalDays - index * 7)), true)}</td>`).join('')}<td class="monthly-close-column">${formatMetric(projectedBudget, true)}</td></tr></tbody></table></div>
    <p class="projection-note">El cierre mensual es la sexta columna: suma el consumo real y proyecta el presupuesto diario promedio sobre los ${totalDays} días del mes.</p>`;
}

async function openAdvertisingEditor() {
  const year = selectedAdvertisingYear;
  const month = selectedAdvertisingMonth;
  try {
    const data = await api(`/api/clients/${encodeURIComponent(clientId)}/advertising/${year}/${month}`);
    const fields = [
      ['roas', 'ROAS', '0.01', ''], ['tacos', 'TACOS', '0.01', '%'],
      ['dailyBudget', 'Presupuesto diario', '0.01', '$'], ['consumedBudget', 'Presupuesto consumido', '0.01', '$'],
      ['targetTacos', 'TACOS objetivo', '0.01', '%']
    ];
    const overlay = openModal(`<div class="modal-overlay"><form class="modal advertising-editor-modal"><div class="modal-header">Publicidad · ${monthNames[month - 1]} ${year}</div><p class="form-hint">Dejá una celda vacía si esa semana todavía no tiene información.</p><div class="advertising-editor-wrap"><table class="advertising-editor-table"><thead><tr><th>Métrica</th>${data.weeks.map((week) => `<th>Semana ${week.week}</th>`).join('')}</tr></thead><tbody>${fields.map(([key, label, step, suffix]) => `<tr><td><strong>${label}</strong></td>${data.weeks.map((week) => `<td><div class="ad-input-wrap">${suffix === '$' ? '<span>$</span>' : ''}<input class="form-control" type="number" min="0" ${suffix === '%' ? 'max="100"' : ''} step="${step}" data-ad-field="${key}" data-week="${week.week}" value="${week[key] ?? ''}">${suffix === '%' ? '<span>%</span>' : ''}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Guardar</button></div></form></div>`);
    overlay.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = overlay.querySelector('button[type="submit"]');
      setButtonLoading(submit, true, 'Guardando...');
      const weeks = data.weeks.map((week) => Object.fromEntries(fields.map(([key]) => {
        const value = overlay.querySelector(`[data-ad-field="${key}"][data-week="${week.week}"]`).value;
        return [key, value === '' ? null : Number(value)];
      })));
      try {
        await api(`/api/clients/${encodeURIComponent(clientId)}/advertising/${year}/${month}`, { method: 'PUT', body: JSON.stringify({ weeks }) });
        closeModal();
        await reloadDetail();
      } catch (error) { alert(error.message); setButtonLoading(submit, false); }
    });
  } catch (error) { alert(error.message); }
}

function settingOptions(collection, selected, emptyLabel = '') {
  const options = (state.settings?.[collection] || []).map((item) => typeof item === 'string' ? item : item?.name || '').filter(Boolean);
  return `${emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : ''}${options.map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;
}

function ownerOptions(selected) {
  return `<option value="">Sin responsable</option>${state.users.map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === selected ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('')}`;
}

function openClientEditor() {
  const client = detail.client;
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal">
        <div class="modal-header">Editar cliente</div>
        <div class="form-group"><label for="detail-client-name">Nombre del contacto</label><input class="form-control" id="detail-client-name" value="${escapeHtml(client.name || '')}" required></div>
        <div class="form-group"><label for="detail-client-company">Empresa</label><input class="form-control" id="detail-client-company" value="${escapeHtml(client.company || '')}" required></div>
        <div class="form-group"><label for="detail-client-email">Correos electrónicos <span class="optional-label">(uno por línea)</span></label><textarea class="form-control" id="detail-client-email" rows="2">${escapeHtml(client.email || '')}</textarea></div>
        <div class="form-group"><label for="detail-client-owner">Responsable</label><select class="form-control" id="detail-client-owner">${ownerOptions(client.ownerId || '')}</select></div>
        <div class="form-group"><label>Consultores <span class="optional-label">(podés elegir más de uno)</span></label><div class="multi-tag-options" id="detail-client-consultors">${consultorCheckboxes(client.consultors || (client.consultor ? [client.consultor] : []))}</div></div>
        <div class="form-group"><label for="detail-client-status">Estado</label><select class="form-control" id="detail-client-status">${settingOptions('clientStatuses', client.status)}</select></div>
        <div class="form-group"><label for="detail-client-complexity">Complejidad</label><select class="form-control" id="detail-client-complexity">${settingOptions('complexities', client.complexity, 'Sin definir')}</select></div>
        <div class="form-group"><label for="detail-client-ad-status">Publicidad</label><select class="form-control" id="detail-client-ad-status">${settingOptions('adStatuses', client.adStatus, 'Sin definir')}</select></div>
        <div class="form-group"><label for="detail-client-meli-user">Usuario de Mercado Libre</label><input class="form-control" id="detail-client-meli-user" autocomplete="off" value="${escapeHtml(client.meliUser || '')}"></div>
        <div class="form-group"><label for="detail-client-meli-password">Contraseña de Mercado Libre</label><input class="form-control" id="detail-client-meli-password" type="password" autocomplete="off" value="${escapeHtml(client.meliPassword || '')}"></div>
        <div class="form-group"><label for="detail-client-vs-category">Categoría de VS</label><input class="form-control" id="detail-client-vs-category" value="${escapeHtml(client.vsCategory || '')}"></div>
        <div class="form-group"><label>Reunión habitual</label><div class="client-meeting-editor"><select class="form-control" id="detail-client-meeting-day"><option value="">Sin reunión</option>${[['1','Lunes'],['2','Martes'],['3','Miércoles'],['4','Jueves'],['5','Viernes'],['6','Sábado'],['0','Domingo']].map(([value, label]) => `<option value="${value}" ${client.meetingDay !== null && String(client.meetingDay) === value ? 'selected' : ''}>${label}</option>`).join('')}</select><input class="form-control" id="detail-client-meeting-time" type="time" value="${escapeHtml(String(client.meetingTime || '').slice(0, 5))}"><select class="form-control" id="detail-client-meeting-frequency"><option value="">Frecuencia</option><option value="7" ${client.meetingFrequency === 7 ? 'selected' : ''}>Cada 7 días</option><option value="15" ${client.meetingFrequency === 15 ? 'selected' : ''}>Cada 15 días</option></select></div></div>
        <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Guardar cambios</button></div>
      </form>
    </div>`);

  let submitting = false;
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const payload = {
      name: overlay.querySelector('#detail-client-name').value.trim(),
      company: overlay.querySelector('#detail-client-company').value.trim(),
      email: overlay.querySelector('#detail-client-email').value.trim(),
      ownerId: overlay.querySelector('#detail-client-owner').value,
      consultors: [...overlay.querySelectorAll('#detail-client-consultors input:checked')].map((input) => input.value),
      status: overlay.querySelector('#detail-client-status').value,
      complexity: overlay.querySelector('#detail-client-complexity').value,
      adStatus: overlay.querySelector('#detail-client-ad-status').value,
      meliUser: overlay.querySelector('#detail-client-meli-user').value.trim(),
      meliPassword: overlay.querySelector('#detail-client-meli-password').value.trim(),
      vsCategory: overlay.querySelector('#detail-client-vs-category').value.trim(),
      meetingDay: overlay.querySelector('#detail-client-meeting-day').value === '' ? null : Number(overlay.querySelector('#detail-client-meeting-day').value),
      meetingTime: overlay.querySelector('#detail-client-meeting-time').value || null,
      meetingFrequency: overlay.querySelector('#detail-client-meeting-frequency').value ? Number(overlay.querySelector('#detail-client-meeting-frequency').value) : null,
      userId: currentUser.id,
      userName: currentUser.name
    };
    if (!payload.name || !payload.company) return;
    const submit = overlay.querySelector('button[type="submit"]');
    submitting = true;
    setButtonLoading(submit, true, 'Guardando...');
    try {
      await api(`/api/clients/${encodeURIComponent(clientId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      closeModal();
      await refresh();
    } catch (error) {
      submitting = false;
      setButtonLoading(submit, false);
      alert(error.message);
    }
  });
}

function infoItem(label, value) {
  return `<div class="client-info-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function infoHtmlItem(label, value) {
  return `<div class="client-info-item"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function credentialItem(label, value) {
  if (!value) return infoItem(label, 'Sin definir');
  return `<div class="client-info-item"><span>${escapeHtml(label)}</span><div class="client-credential"><strong data-credential-value data-hidden-value="${escapeHtml(value)}">••••••••</strong><button type="button" data-toggle-credential aria-label="Mostrar ${escapeHtml(label)}" aria-pressed="false">Mostrar</button></div></div>`;
}

function setupCredentialToggle() {
  document.querySelectorAll('[data-toggle-credential]').forEach((button) => button.addEventListener('click', () => {
    const value = button.parentElement.querySelector('[data-credential-value]');
    const showing = button.getAttribute('aria-pressed') === 'true';
    value.textContent = showing ? '••••••••' : value.dataset.hiddenValue;
    button.textContent = showing ? 'Mostrar' : 'Ocultar';
    button.setAttribute('aria-pressed', String(!showing));
  }));
}

function getSettingColor(collection, name) {
  const item = (state.settings?.[collection] || []).find((entry) => (typeof entry === 'string' ? entry : entry?.name) === name);
  return typeof item === 'object' && /^#[0-9a-fA-F]{6}$/.test(item?.color || '') ? item.color : '#388bfd';
}

function renderConfiguredBadge(collection, name) {
  return `<span class="status-badge custom-status" style="--status-color: ${escapeHtml(getSettingColor(collection, name))}">${escapeHtml(name)}</span>`;
}

function renderConsultorBadges(names) {
  if (!names.length) return '<span class="muted-value">Sin asignar</span>';
  return `<span class="inline-tags">${names.map((name) => renderConfiguredBadge('clientConsultors', name)).join('')}</span>`;
}

function consultorCheckboxes(selected = []) {
  const selectedNames = new Set(selected);
  return (state.settings?.clientConsultors || []).map((item) => {
    const name = typeof item === 'string' ? item : item?.name || '';
    return `<label><input type="checkbox" value="${escapeHtml(name)}" ${selectedNames.has(name) ? 'checked' : ''}><span>${renderConfiguredBadge('clientConsultors', name)}</span></label>`;
  }).join('');
}

function renderLinks(links) {
  if (!links.length) return '';
  return `<div class="client-profile-links">${links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)} &nearr;</a>`).join('')}</div>`;
}

function renderMetricYearTabs() {
  const years = availableYears();
  document.querySelector('#metrics-year-tabs').innerHTML = years.length ? years.map((year) => `<button type="button" class="metric-year-btn ${year === selectedYear ? 'active' : ''}" data-year="${year}">${year}</button>`).join('') : '';
  document.querySelectorAll('[data-year]').forEach((button) => button.addEventListener('click', () => {
    selectedYear = Number(button.dataset.year);
    renderMetricYearTabs();
    renderMetrics();
  }));
}

function metricValue(type, month) {
  return detail.metrics.find((item) => Number(item.year) === selectedYear && item.metricType === type && Number(item.month) === month)?.value ?? null;
}

function previousPeriodValue(type, year, month) {
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return detail.metrics.find((item) => Number(item.year) === previousYear && item.metricType === type && Number(item.month) === previousMonth)?.value ?? null;
}

function projectionComparisonClass(estimated, previous) {
  if (estimated === null || estimated === undefined || previous === null || previous === undefined) return '';
  const difference = Number(estimated) - Number(previous);
  const tolerance = Math.max(Math.abs(Number(previous)) * 0.001, 0.01);
  if (Math.abs(difference) <= tolerance) return '';
  return difference > 0 ? ' projection-better' : ' projection-worse';
}

function renderMetrics() {
  const container = document.querySelector('#metrics-content');
  if (!detail.metrics.length) {
    container.innerHTML = '<div class="client-empty-state">Todavía no hay métricas cargadas. Usá “Editar mes” para comenzar.</div>';
    return;
  }
  const projection = detail.currentPeriodSummary;
  const showProjection = projection && selectedYear === projection.year;
  const projectedValue = (type) => type === 'revenue' ? projection.estimatedRevenue : type === 'units' ? projection.estimatedUnits : projection.estimatedAsp;
  container.innerHTML = `
    <div class="metrics-kpis">${Object.entries(metricConfig).map(([type, config]) => {
      const values = monthNames.map((_, index) => metricValue(type, index + 1)).filter((value) => value !== null);
      const latest = values.at(-1);
      const total = type === 'asp' ? latest : values.reduce((sum, value) => sum + Number(value), 0);
      return `<div class="metric-kpi"><span>${escapeHtml(config.label)} ${selectedYear}</span><strong>${formatMetric(total, config.money)}</strong><small>${values.length} ${values.length === 1 ? 'mes cargado' : 'meses cargados'}</small></div>`;
    }).join('')}</div>
    <div class="metrics-chart-wrap"><canvas id="client-metrics-chart"></canvas></div>
    <div class="metrics-table-wrap"><table class="table metrics-table"><thead><tr><th>Métrica</th>${monthNames.map((month) => `<th>${month}</th>`).join('')}${showProjection ? `<th class="projection-column">Estimado ${monthNames[projection.month - 1]}</th>` : ''}</tr></thead><tbody>${Object.entries(metricConfig).map(([type, config]) => `<tr><td><strong>${escapeHtml(config.label)}</strong></td>${monthNames.map((_, index) => `<td>${formatMetric(metricValue(type, index + 1), config.money)}</td>`).join('')}${showProjection ? `<td class="projection-column${projectionComparisonClass(projectedValue(type), previousPeriodValue(type, projection.year, projection.month))}">${formatMetric(projectedValue(type), config.money)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    ${showProjection ? `<p class="projection-note">Proyección sobre ${projection.daysCovered} de ${projection.totalDays} días contemplados.</p>` : ''}
  `;
  drawMetricsChart();
}

async function openMonthEditor() {
  const year = selectedYear || new Date().getFullYear();
  const month = Number(document.querySelector('#edit-month-select')?.value || new Date().getMonth() + 1);
  try {
    const data = await api(`/api/clients/${encodeURIComponent(clientId)}/months/${year}/${month}`);
    const weeks = data.weeks.map((week) => ({ ...week }));
    if (!data.hasWeeklyDetail && data.existingMonthly.revenue + data.existingMonthly.units > 0) {
      weeks[0].revenue = data.existingMonthly.revenue;
      weeks[0].units = data.existingMonthly.units;
    }
    const overlay = openModal(`<div class="modal-overlay"><form class="modal month-editor-modal"><div class="modal-header">Editar ${monthNames[month - 1]} ${year}</div>
      ${!data.hasWeeklyDetail && data.existingMonthly.revenue + data.existingMonthly.units > 0 ? '<div class="month-editor-notice">El total mensual existente se colocó en Semana 1 para conservarlo. Podés redistribuirlo entre las semanas.</div>' : ''}
      <div class="form-group"><label>Días contemplados</label><input class="form-control" id="days-covered" type="number" min="0" max="${data.totalDays}" value="${data.daysCovered}"><small>El mes tiene ${data.totalDays} días.</small></div>
      <div class="weekly-metrics-editor"><div class="weekly-metrics-head"><span>Semana</span><span>Facturación</span><span>Unidades</span><span>ASP automático</span></div>${weeks.map((week) => `<div class="weekly-metrics-row"><strong>Semana ${week.week}</strong><input class="form-control" type="number" min="0" step="any" data-week-revenue value="${week.revenue}"><input class="form-control" type="number" min="0" step="1" data-week-units value="${week.units}"><span data-week-asp>$ 0</span></div>`).join('')}</div>
      <div class="month-editor-totals"><div><span>Facturación acumulada</span><strong data-total-revenue></strong></div><div><span>Unidades acumuladas</span><strong data-total-units></strong></div><div><span>ASP mensual</span><strong data-total-asp></strong></div></div>
      <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Guardar</button></div></form></div>`);
    const updateTotals = () => {
      let revenue = 0; let units = 0;
      overlay.querySelectorAll('.weekly-metrics-row').forEach((row) => {
        const rowRevenue = Number(row.querySelector('[data-week-revenue]').value || 0);
        const rowUnits = Number(row.querySelector('[data-week-units]').value || 0);
        revenue += rowRevenue; units += rowUnits;
        row.querySelector('[data-week-asp]').textContent = formatPlainMetric(rowUnits > 0 ? rowRevenue / rowUnits : 0, true);
      });
      overlay.querySelector('[data-total-revenue]').textContent = formatPlainMetric(revenue, true);
      overlay.querySelector('[data-total-units]').textContent = formatPlainMetric(units, false);
      overlay.querySelector('[data-total-asp]').textContent = formatPlainMetric(units > 0 ? revenue / units : 0, true);
    };
    overlay.querySelectorAll('input').forEach((input) => input.addEventListener('input', updateTotals));
    updateTotals();
    overlay.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = overlay.querySelector('button[type="submit"]');
      submit.disabled = true; submit.textContent = 'Guardando...';
      const payloadWeeks = [...overlay.querySelectorAll('.weekly-metrics-row')].map((row) => ({ revenue: Number(row.querySelector('[data-week-revenue]').value || 0), units: Number(row.querySelector('[data-week-units]').value || 0) }));
      try {
        await api(`/api/clients/${encodeURIComponent(clientId)}/months/${year}/${month}`, { method: 'PUT', body: JSON.stringify({ daysCovered: Number(overlay.querySelector('#days-covered').value), weeks: payloadWeeks }) });
        closeModal();
        await reloadDetail();
      } catch (error) { alert(error.message); submit.disabled = false; submit.textContent = 'Guardar'; }
    });
  } catch (error) { alert(error.message); }
}

function drawMetricsChart() {
  if (metricsChart) metricsChart.destroy();
  const canvas = document.querySelector('#client-metrics-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  metricsChart = new Chart(canvas, {
    type: 'line',
    data: { labels: monthNames, datasets: Object.entries(metricConfig).map(([type, config]) => ({ label: config.label, data: monthNames.map((_, index) => metricValue(type, index + 1)), borderColor: config.color, backgroundColor: `${config.color}22`, tension: 0.3, spanGaps: true, pointRadius: 3, yAxisID: type === 'units' ? 'units' : 'money' })) },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#c9d1d9' } } }, scales: { x: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }, money: { position: 'left', ticks: { color: '#8b949e', callback: (value) => compactNumber(value) }, grid: { color: '#30363d' } }, units: { position: 'right', ticks: { color: '#8b949e' }, grid: { display: false } } } }
  });
}

function renderComments() {
  const comments = [...detail.comments].sort((a, b) => new Date(b.date) - new Date(a.date));
  const manual = detail.manualComments || [];
  if (!comments.length && !manual.length) return '<div class="client-empty-state compact">Todavía no hay comentarios de reuniones.</div>';
  return `<div class="client-timeline">
    ${manual.map((comment) => `<article class="timeline-item manual-comment" data-manual-comment="${escapeHtml(comment.id)}"><div class="timeline-dot"></div><div><div class="timeline-meta"><span>${escapeHtml(comment.authorName)} · ${formatDateTime(comment.createdAt)}${comment.updatedAt !== comment.createdAt ? ' · editado' : ''}</span><div class="comment-actions"><button type="button" data-edit-comment="${escapeHtml(comment.id)}">Editar</button><button type="button" class="danger" data-delete-comment="${escapeHtml(comment.id)}">Eliminar</button></div></div><p class="manual-comment-content">${escapeHtml(comment.content)}</p></div></article>`).join('')}
    ${comments.map((comment) => `<article class="timeline-item"><div class="timeline-dot"></div><div><div class="timeline-meta"><span>${escapeHtml(comment.weekLabel || formatDate(comment.date))}</span><a href="/weekly?id=${encodeURIComponent(comment.reportId)}">Ver reporte</a></div><h3>${escapeHtml(comment.title)}</h3>${comment.description ? `<p>${escapeHtml(comment.description)}</p>` : ''}</div></article>`).join('')}
  </div>`;
}

function renderCommentComposer() {
  return `<form class="comment-composer" id="comment-composer"><textarea class="form-control" rows="3" maxlength="10000" placeholder="Escribir un comentario de la reunión..." aria-label="Nuevo comentario"></textarea><div><span>Texto libre · máximo 10.000 caracteres</span><button class="btn btn-sm" type="submit">Agregar comentario</button></div></form>`;
}

function setupCommentActions() {
  const form = document.querySelector('#comment-composer');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const textarea = form.querySelector('textarea');
    const button = form.querySelector('button[type="submit"]');
    const content = textarea.value.trim();
    if (!content) return;
    button.disabled = true;
    button.textContent = 'Guardando...';
    try {
      await api(`/api/clients/${encodeURIComponent(clientId)}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
      await reloadDetail();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
      button.textContent = 'Agregar comentario';
    }
  });
  document.querySelectorAll('[data-edit-comment]').forEach((button) => button.addEventListener('click', () => startEditingComment(button.dataset.editComment)));
  document.querySelectorAll('[data-delete-comment]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este comentario?')) return;
    button.disabled = true;
    try {
      await api(`/api/clients/${encodeURIComponent(clientId)}/comments/${encodeURIComponent(button.dataset.deleteComment)}`, { method: 'DELETE' });
      await reloadDetail();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  }));
}

function startEditingComment(commentId) {
  const comment = (detail.manualComments || []).find((item) => item.id === commentId);
  const article = document.querySelector(`[data-manual-comment="${CSS.escape(commentId)}"]`);
  if (!comment || !article) return;
  const content = article.querySelector('.manual-comment-content');
  const actions = article.querySelector('.comment-actions');
  content.outerHTML = `<textarea class="form-control manual-comment-editor" rows="4" maxlength="10000">${escapeHtml(comment.content)}</textarea>`;
  actions.innerHTML = `<button type="button" data-save-comment>Guardar</button><button type="button" data-cancel-comment>Cancelar</button>`;
  const editor = article.querySelector('.manual-comment-editor');
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
  article.querySelector('[data-cancel-comment]').addEventListener('click', renderPage);
  article.querySelector('[data-save-comment]').addEventListener('click', async (event) => {
    const nextContent = editor.value.trim();
    if (!nextContent) return;
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Guardando...';
    try {
      await api(`/api/clients/${encodeURIComponent(clientId)}/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: JSON.stringify({ content: nextContent }) });
      await reloadDetail();
    } catch (error) {
      alert(error.message);
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = 'Guardar';
    }
  });
}

async function reloadDetail() {
  detail = await api(`/api/clients/${encodeURIComponent(clientId)}/detail`);
  renderPage();
}

function renderMeetings() {
  if (!detail.meetings.length) return '<div class="client-empty-state compact">No hay reuniones vinculadas en el calendario.</div>';
  return `<div class="client-meeting-list">${detail.meetings.slice(0, 10).map((meeting) => `<article class="client-meeting-item"><div class="meeting-date-box"><strong>${new Date(meeting.startsAt).toLocaleDateString('es-AR', { day: '2-digit' })}</strong><span>${new Date(meeting.startsAt).toLocaleDateString('es-AR', { month: 'short' })}</span></div><div><h3>${escapeHtml(meeting.title)}</h3><p>${formatDateTime(meeting.startsAt)} · ${meeting.durationMinutes} min</p>${meeting.notes ? `<small>${escapeHtml(meeting.notes)}</small>` : ''}</div></article>`).join('')}</div>`;
}

function renderCards() {
  if (!detail.cards.length) return '<div class="client-empty-state compact">No hay tarjetas relacionadas con este cliente.</div>';
  const boardById = new Map(state.boards.map((board) => [board.id, board]));
  return `<div class="client-task-list">${detail.cards.map((card) => { const board = boardById.get(card.boardId); const column = board?.columns.find((item) => item.id === card.columnId); return `<a href="/kanban?board=${encodeURIComponent(card.boardId)}" class="client-task-item"><div><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(board?.name || 'Tablero')} · ${escapeHtml(column?.name || 'Sin columna')}</p></div><span>${card.resolved ? 'Resuelta' : card.dueDate ? formatDate(card.dueDate) : 'Sin fecha'}</span></a>`; }).join('')}</div>`;
}

function formatMetric(value, money) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="metric-empty">—</span>';
  return `${money ? '$ ' : ''}${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

function formatDecimal(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="metric-empty">—</span>';
  return Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="metric-empty">—</span>';
  return `${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}

function formatPlainMetric(value, money) {
  const number = Number(value || 0);
  return `${money ? '$ ' : ''}${number.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}
function compactNumber(value) { return Number(value).toLocaleString('es-AR', { notation: 'compact', maximumFractionDigits: 1 }); }
function formatDate(value) { return new Date(value).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
function formatDateTime(value) { return new Date(value).toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function formatRecurringMeeting(client) { const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']; if (client.meetingDay === null || client.meetingDay === undefined) return 'Sin definir'; return `${days[client.meetingDay]} ${String(client.meetingTime || '').slice(0, 5)}${client.meetingFrequency ? ` · cada ${client.meetingFrequency} días` : ''}`; }

boot().catch((error) => {
  document.querySelector('#client-detail').innerHTML = `<div class="client-empty-state">${escapeHtml(error.message)}</div>`;
});
