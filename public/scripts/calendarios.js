import { api, requireSession } from './api.js';
import { loadAppState } from './app-state.js';
import { renderSidebar, openModal, closeModal } from './layout.js';
import { escapeHtml, setButtonLoading } from './utils.js';

const currentUser = requireSession();
const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];
const userColors = ['#388bfd', '#a371f7', '#3fb950', '#f0883e', '#db61a2', '#39c5cf', '#d29922', '#f85149'];
const startHour = 0;
const endHour = 24;
const hourHeight = 64;

let state;
let calendarData = { availability: [], availabilityExceptions: [], events: [] };
let weekStart = mondayOf(new Date());
let selectedUsers = new Set();
let calendarScrollInitialized = false;

async function boot() {
  state = await loadAppState();
  const stored = JSON.parse(localStorage.getItem('calendarUserFilter') || '[]');
  selectedUsers = new Set(stored.filter((id) => state.users.some((user) => user.id === id)));
  if (!selectedUsers.size) state.users.forEach((user) => selectedUsers.add(user.id));
  renderSidebar({ state, currentUser, activePage: 'calendarios', onRefresh: refresh });
  bindPageActions();
  await refresh();
}

async function refresh() {
  const from = dateString(weekStart);
  const to = dateString(addDateDays(weekStart, 6));
  calendarData = await api(`/api/calendar?from=${from}&to=${to}`);
  renderFilters();
  renderCalendar();
}

function bindPageActions() {
  document.querySelector('#previous-week').onclick = async () => { weekStart = addDateDays(weekStart, -7); await refresh(); };
  document.querySelector('#next-week').onclick = async () => { weekStart = addDateDays(weekStart, 7); await refresh(); };
  document.querySelector('#today-week').onclick = async () => { weekStart = mondayOf(new Date()); await refresh(); };
  document.querySelector('#new-event-btn').onclick = () => openEventModal();
  document.querySelector('#availability-btn').onclick = () => openAvailabilityModal();
}

function renderFilters() {
  const menu = document.querySelector('#user-filter-menu');
  menu.innerHTML = `
    <div class="calendar-filter-actions">
      <button type="button" data-filter-all>Todos</button>
      <button type="button" data-filter-me>Solo yo</button>
    </div>
    ${state.users.map((user) => `
      <label class="calendar-filter-option">
        <input type="checkbox" value="${escapeHtml(user.id)}" ${selectedUsers.has(user.id) ? 'checked' : ''}>
        <span class="calendar-user-dot" style="--user-color:${userColor(user.id)}"></span>
        ${escapeHtml(user.name)}
      </label>
    `).join('')}
  `;
  menu.querySelectorAll('input').forEach((input) => {
    input.onchange = () => {
      input.checked ? selectedUsers.add(input.value) : selectedUsers.delete(input.value);
      saveFilter();
      renderFilters();
      renderCalendar();
    };
  });
  menu.querySelector('[data-filter-all]').onclick = () => {
    selectedUsers = new Set(state.users.map((user) => user.id));
    saveFilter(); renderFilters(); renderCalendar();
  };
  menu.querySelector('[data-filter-me]').onclick = () => {
    selectedUsers = new Set([currentUser.id]);
    saveFilter(); renderFilters(); renderCalendar();
  };
  const count = selectedUsers.size;
  document.querySelector('#user-filter-label').textContent = count === state.users.length ? 'Todos los usuarios' : `${count} usuario${count === 1 ? '' : 's'}`;
  document.querySelector('#calendar-legend').innerHTML = state.users
    .filter((user) => selectedUsers.has(user.id))
    .map((user) => `<span><i style="--user-color:${userColor(user.id)}"></i>${escapeHtml(user.name)}</span>`).join('');
}

function saveFilter() {
  localStorage.setItem('calendarUserFilter', JSON.stringify([...selectedUsers]));
}

function renderCalendar() {
  const days = Array.from({ length: 7 }, (_, index) => addDateDays(weekStart, index));
  const end = days[6];
  document.querySelector('#week-label').textContent = `${formatShortDate(weekStart)} — ${formatShortDate(end)}`;
  const calendar = document.querySelector('#week-calendar');
  calendar.style.setProperty('--calendar-hours', endHour - startHour);
  calendar.innerHTML = `
    <div class="calendar-corner"></div>
    ${days.map((day, index) => `<div class="calendar-day-header ${dateString(day) === dateString(new Date()) ? 'today' : ''}"><span>${dayNames[index]}</span><strong>${day.getDate()}</strong></div>`).join('')}
    <div class="calendar-hours">
      ${Array.from({ length: endHour - startHour + 1 }, (_, index) => `<span style="top:${index * hourHeight}px">${String(startHour + index).padStart(2, '0')}:00</span>`).join('')}
    </div>
    ${days.map((day, index) => renderDayColumn(day, index + 1)).join('')}
  `;
  calendar.querySelectorAll('[data-calendar-slot]').forEach((slot) => {
    slot.addEventListener('dblclick', () => openEventModal({ date: slot.dataset.date, time: slot.dataset.time }));
  });
  calendar.querySelectorAll('[data-event-key]').forEach((eventEl) => {
    eventEl.addEventListener('click', (event) => {
      event.stopPropagation();
      const item = calendarData.events.find((entry) => entry.occurrenceKey === eventEl.dataset.eventKey);
      if (item) openEventDetails(item);
    });
  });
  if (!calendarScrollInitialized) {
    document.querySelector('.calendar-scroll').scrollTop = 8 * hourHeight;
    calendarScrollInitialized = true;
  }
}

function renderDayColumn(day, column) {
  const date = dateString(day);
  const weekday = column;
  const availabilities = effectiveAvailability(date, weekday).filter((item) => selectedUsers.has(item.userId));
  const positionedAvailability = positionOverlappingAvailability(availabilities);
  const events = calendarData.events.filter((item) => argentinaDate(item.startsAt) === date && item.userIds.some((id) => selectedUsers.has(id)));
  const positionedEvents = positionOverlappingEvents(events);
  return `
    <div class="calendar-day-column" style="grid-column:${column + 1}">
      ${Array.from({ length: endHour - startHour }, (_, index) => `<div class="calendar-slot" data-calendar-slot data-date="${date}" data-time="${String(startHour + index).padStart(2, '0')}:00" style="top:${index * hourHeight}px"></div>`).join('')}
      ${positionedAvailability.map((item) => {
        const user = userById(item.userId);
        return `<div class="availability-block" style="${blockStyle(item.startTime, minutesBetween(item.startTime, item.endTime))};${overlapStyle(item)};--user-color:${userColor(item.userId)}" title="${escapeHtml(user?.name || '')}: ${item.startTime}–${item.endTime}"><span>${escapeHtml(user?.name || '')}</span></div>`;
      }).join('')}
      ${positionedEvents.map((item) => renderEvent(item)).join('')}
    </div>
  `;
}

function effectiveAvailability(date, weekday) {
  const output = [];
  state.users.forEach((user) => {
    const exception = calendarData.availabilityExceptions.find((item) => item.userId === user.id && item.date === date);
    if (exception) {
      if (!exception.unavailable) output.push({ userId: user.id, startTime: exception.startTime, endTime: exception.endTime });
      return;
    }
    calendarData.availability
      .filter((item) => item.userId === user.id && item.weekday === weekday && item.validFrom <= date && (!item.validTo || item.validTo >= date))
      .forEach((item) => output.push(item));
  });
  return output;
}

function renderEvent(item) {
  const local = argentinaParts(item.startsAt);
  const visibleUsers = item.userIds.filter((id) => selectedUsers.has(id));
  const firstUser = visibleUsers[0] || item.userIds[0];
  const names = item.userIds.map((id) => userById(id)?.name).filter(Boolean).join(', ');
  const client = state.clients.find((entry) => entry.id === item.clientId);
  return `
    <button class="calendar-event" type="button" data-event-key="${escapeHtml(item.occurrenceKey)}" title="${escapeHtml(`${item.title} · ${local.time} · ${names}`)}" style="${blockStyle(local.time, item.durationMinutes)};${overlapStyle(item)};--user-color:${userColor(firstUser)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${local.time} · ${item.durationMinutes} min</span>
      <small>${escapeHtml(names)}${client ? ` · ${escapeHtml(client.name)}` : ''}</small>
      ${item.recurrenceUnit ? '<i aria-label="Evento recurrente">↻</i>' : ''}
    </button>
  `;
}

function positionOverlappingEvents(events) {
  const sorted = [...events].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt) || b.durationMinutes - a.durationMinutes);
  const positioned = [];
  let cluster = [];
  let clusterEnd = 0;

  const finishCluster = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    const clusterItems = cluster.map((item) => {
      const start = new Date(item.startsAt).getTime();
      const end = start + item.durationMinutes * 60000;
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { ...item, overlapLane: lane };
    });
    clusterItems.forEach((item) => positioned.push({ ...item, overlapLanes: laneEnds.length }));
    cluster = [];
    clusterEnd = 0;
  };

  sorted.forEach((item) => {
    const start = new Date(item.startsAt).getTime();
    const end = start + item.durationMinutes * 60000;
    if (cluster.length && start >= clusterEnd) finishCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, end);
  });
  finishCluster();
  return positioned;
}

function positionOverlappingAvailability(items) {
  const sorted = [...items].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const positioned = [];
  let cluster = [];
  let clusterEnd = -1;

  const finishCluster = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    const clusterItems = cluster.map((item) => {
      const start = timeToMinutes(item.startTime);
      const end = timeToMinutes(item.endTime);
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = end;
      return { ...item, overlapLane: lane };
    });
    clusterItems.forEach((item) => positioned.push({ ...item, overlapLanes: laneEnds.length }));
    cluster = [];
    clusterEnd = -1;
  };

  sorted.forEach((item) => {
    const start = timeToMinutes(item.startTime);
    const end = timeToMinutes(item.endTime);
    if (cluster.length && start >= clusterEnd) finishCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, end);
  });
  finishCluster();
  return positioned;
}

function overlapStyle(item) {
  const lanes = item.overlapLanes || 1;
  const lane = item.overlapLane || 0;
  if (lanes === 1) return '';
  const width = 100 / lanes;
  return `left:calc(${lane * width}% + 3px);right:auto;width:calc(${width}% - 5px)`;
}

function openEventModal(prefill = {}) {
  const today = dateString(new Date());
  const overlay = openModal(`
    <div class="modal-overlay">
      <form class="modal calendar-modal">
        <div class="modal-header">Nuevo evento</div>
        <div class="form-group"><label for="event-title">Titulo</label><input class="form-control" id="event-title" required></div>
        <div class="calendar-form-grid">
          <div class="form-group"><label for="event-date">Fecha</label><input type="date" class="form-control" id="event-date" value="${prefill.date || today}" required></div>
          <div class="form-group"><label for="event-time">Hora</label><input type="time" class="form-control" id="event-time" value="${prefill.time || '10:00'}" required></div>
          <div class="form-group"><label for="event-duration">Duracion (minutos)</label><input type="number" min="5" max="1440" step="5" class="form-control" id="event-duration" value="60" required></div>
          <div class="form-group"><label for="event-client">Cliente (opcional)</label><select class="form-control" id="event-client"><option value="">Sin cliente</option>${state.clients.map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join('')}</select></div>
        </div>
        <fieldset class="calendar-users-field"><legend>Usuarios</legend>${state.users.map((user) => `<label><input type="checkbox" name="event-user" value="${escapeHtml(user.id)}" ${selectedUsers.has(user.id) ? 'checked' : ''}><span class="calendar-user-dot" style="--user-color:${userColor(user.id)}"></span>${escapeHtml(user.name)}</label>`).join('')}</fieldset>
        <div class="form-group"><label for="event-notes">Notas (opcional)</label><textarea class="form-control" id="event-notes" rows="3"></textarea></div>
        <div class="calendar-form-grid recurrence-fields">
          <div class="form-group"><label for="event-recurrence">Repeticion</label><select class="form-control" id="event-recurrence"><option value="">No se repite</option><option value="day">Cada X dias</option><option value="week">Cada X semanas</option></select></div>
          <div class="form-group" data-recurrence-detail hidden><label for="event-interval">Cada</label><input type="number" min="1" max="365" class="form-control" id="event-interval" value="1"></div>
          <div class="form-group" data-recurrence-detail hidden><label for="event-until">Repetir hasta (opcional)</label><input type="date" class="form-control" id="event-until"></div>
        </div>
        <div class="error-message" data-form-error></div>
        <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Crear evento</button></div>
      </form>
    </div>
  `);
  const recurrence = overlay.querySelector('#event-recurrence');
  recurrence.onchange = () => overlay.querySelectorAll('[data-recurrence-detail]').forEach((element) => { element.hidden = !recurrence.value; });
  overlay.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const userIds = [...overlay.querySelectorAll('[name="event-user"]:checked')].map((input) => input.value);
    const error = overlay.querySelector('[data-form-error]');
    if (!userIds.length) { error.textContent = 'Selecciona al menos un usuario.'; return; }
    const button = overlay.querySelector('[type="submit"]');
    setButtonLoading(button, true, 'Creando...');
    try {
      await api('/api/calendar/events', { method: 'POST', body: JSON.stringify({
        title: overlay.querySelector('#event-title').value,
        date: overlay.querySelector('#event-date').value,
        time: overlay.querySelector('#event-time').value,
        durationMinutes: Number(overlay.querySelector('#event-duration').value),
        clientId: overlay.querySelector('#event-client').value,
        userIds,
        notes: overlay.querySelector('#event-notes').value,
        recurrenceUnit: recurrence.value,
        recurrenceInterval: recurrence.value ? Number(overlay.querySelector('#event-interval').value) : null,
        recurrenceUntil: recurrence.value ? overlay.querySelector('#event-until').value : ''
      }) });
      closeModal(); await refresh();
    } catch (caught) { error.textContent = caught.message; setButtonLoading(button, false); }
  };
}

function openEventDetails(item) {
  const local = argentinaParts(item.startsAt);
  const client = state.clients.find((entry) => entry.id === item.clientId);
  const users = item.userIds.map((id) => userById(id)?.name).filter(Boolean).join(', ');
  const overlay = openModal(`
    <div class="modal-overlay"><div class="modal">
      <div class="modal-header"><span>${escapeHtml(item.title)}</span><button class="btn-icon" type="button" data-close-modal>Cerrar</button></div>
      <div class="event-detail-list">
        <p><strong>Fecha y hora</strong><span>${formatLongDate(local.date)}, ${local.time}</span></p>
        <p><strong>Duracion</strong><span>${item.durationMinutes} minutos</span></p>
        <p><strong>Usuarios</strong><span>${escapeHtml(users)}</span></p>
        <p><strong>Cliente</strong><span>${escapeHtml(client?.name || 'Sin cliente')}</span></p>
        ${item.notes ? `<p><strong>Notas</strong><span>${escapeHtml(item.notes)}</span></p>` : ''}
        ${item.recurrenceUnit ? `<p><strong>Repeticion</strong><span>Cada ${item.recurrenceInterval} ${item.recurrenceUnit === 'day' ? 'dia(s)' : 'semana(s)'}${item.recurrenceUntil ? ` hasta ${formatLongDate(item.recurrenceUntil)}` : ''}</span></p>` : ''}
      </div>
      <div class="error-message" data-form-error></div>
      <div class="modal-actions">
        ${item.recurrenceUnit ? '<button class="btn btn-secondary" type="button" data-delete-occurrence>Cancelar esta fecha</button>' : ''}
        <button class="btn btn-danger" type="button" data-delete-event>${item.recurrenceUnit ? 'Eliminar serie' : 'Eliminar evento'}</button>
      </div>
    </div></div>
  `);
  const remove = async (scope) => {
    if (!confirm(scope === 'occurrence' ? 'Cancelar solamente esta ocurrencia?' : 'Eliminar este evento?')) return;
    try {
      await api(`/api/calendar/events/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: JSON.stringify({ scope, originalStartsAt: item.originalStartsAt }) });
      closeModal(); await refresh();
    } catch (error) { overlay.querySelector('[data-form-error]').textContent = error.message; }
  };
  overlay.querySelector('[data-delete-event]').onclick = () => remove('series');
  overlay.querySelector('[data-delete-occurrence]')?.addEventListener('click', () => remove('occurrence'));
}

function openAvailabilityModal() {
  const defaultUser = selectedUsers.size === 1 ? [...selectedUsers][0] : currentUser.id;
  const overlay = openModal(`
    <div class="modal-overlay"><form class="modal calendar-modal availability-modal">
      <div class="modal-header">Disponibilidad laboral</div>
      <div class="calendar-form-grid">
        <div class="form-group"><label for="availability-user">Usuario</label><select class="form-control" id="availability-user">${state.users.map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === defaultUser ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label for="availability-from">Vigente desde</label><input type="date" class="form-control" id="availability-from" value="${dateString(new Date())}" required></div>
      </div>
      <p class="form-help">El cambio conserva el historial anterior y se aplica desde la fecha elegida.</p>
      <div class="availability-editor" id="availability-editor"></div>
      <div class="error-message" data-form-error></div>
      <div class="modal-actions"><button class="btn btn-secondary" type="button" data-open-exception>Excepcion puntual</button><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Guardar horario</button></div>
    </form></div>
  `);
  const editor = overlay.querySelector('#availability-editor');
  const renderEditor = () => {
    const userId = overlay.querySelector('#availability-user').value;
    const effective = overlay.querySelector('#availability-from').value;
    editor.innerHTML = dayNames.map((name, index) => {
      const rule = calendarData.availability.find((item) => item.userId === userId && item.weekday === index + 1 && item.validFrom <= effective && (!item.validTo || item.validTo >= effective));
      return `<div class="availability-row"><label><input type="checkbox" data-day-enabled="${index + 1}" ${rule ? 'checked' : ''}>${name}</label><input type="time" class="form-control" data-day-start="${index + 1}" value="${rule?.startTime || '09:00'}" ${rule ? '' : 'disabled'}><span>a</span><input type="time" class="form-control" data-day-end="${index + 1}" value="${rule?.endTime || '18:00'}" ${rule ? '' : 'disabled'}></div>`;
    }).join('');
    editor.querySelectorAll('[data-day-enabled]').forEach((checkbox) => {
      checkbox.onchange = () => editor.querySelectorAll(`[data-day-start="${checkbox.dataset.dayEnabled}"], [data-day-end="${checkbox.dataset.dayEnabled}"]`).forEach((input) => { input.disabled = !checkbox.checked; });
    });
  };
  overlay.querySelector('#availability-user').onchange = renderEditor;
  overlay.querySelector('#availability-from').onchange = renderEditor;
  overlay.querySelector('[data-open-exception]').onclick = () => {
    const userId = overlay.querySelector('#availability-user').value;
    closeModal();
    setTimeout(() => openAvailabilityExceptionModal(userId), 180);
  };
  renderEditor();
  overlay.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const schedule = [...editor.querySelectorAll('[data-day-enabled]:checked')].map((checkbox) => ({
      weekday: Number(checkbox.dataset.dayEnabled),
      startTime: editor.querySelector(`[data-day-start="${checkbox.dataset.dayEnabled}"]`).value,
      endTime: editor.querySelector(`[data-day-end="${checkbox.dataset.dayEnabled}"]`).value
    }));
    const button = overlay.querySelector('[type="submit"]');
    setButtonLoading(button, true, 'Guardando...');
    try {
      await api('/api/calendar/availability', { method: 'POST', body: JSON.stringify({ userId: overlay.querySelector('#availability-user').value, effectiveFrom: overlay.querySelector('#availability-from').value, schedule }) });
      closeModal(); await refresh();
    } catch (error) { overlay.querySelector('[data-form-error]').textContent = error.message; setButtonLoading(button, false); }
  };
}

function openAvailabilityExceptionModal(userId) {
  const overlay = openModal(`
    <div class="modal-overlay"><form class="modal">
      <div class="modal-header">Excepcion de disponibilidad</div>
      <div class="form-group"><label for="exception-user">Usuario</label><select class="form-control" id="exception-user">${state.users.map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === userId ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label for="exception-date">Solo para la fecha</label><input type="date" class="form-control" id="exception-date" value="${dateString(new Date())}" required></div>
      <label class="calendar-checkbox-row"><input type="checkbox" id="exception-unavailable"> No disponible durante todo el dia</label>
      <div class="calendar-form-grid" data-exception-times>
        <div class="form-group"><label for="exception-start">Disponible desde</label><input type="time" class="form-control" id="exception-start" value="10:00"></div>
        <div class="form-group"><label for="exception-end">Disponible hasta</label><input type="time" class="form-control" id="exception-end" value="14:00"></div>
      </div>
      <div class="form-group"><label for="exception-note">Motivo o nota (opcional)</label><input class="form-control" id="exception-note" placeholder="Ej. Vacaciones o cambio especial"></div>
      <div class="error-message" data-form-error></div>
      <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button class="btn" type="submit">Guardar excepcion</button></div>
    </form></div>
  `);
  const unavailable = overlay.querySelector('#exception-unavailable');
  unavailable.onchange = () => overlay.querySelector('[data-exception-times]').hidden = unavailable.checked;
  overlay.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const button = overlay.querySelector('[type="submit"]');
    setButtonLoading(button, true, 'Guardando...');
    try {
      await api('/api/calendar/availability-exceptions', { method: 'POST', body: JSON.stringify({
        userId: overlay.querySelector('#exception-user').value,
        date: overlay.querySelector('#exception-date').value,
        unavailable: unavailable.checked,
        startTime: overlay.querySelector('#exception-start').value,
        endTime: overlay.querySelector('#exception-end').value,
        note: overlay.querySelector('#exception-note').value
      }) });
      closeModal(); await refresh();
    } catch (error) { overlay.querySelector('[data-form-error]').textContent = error.message; setButtonLoading(button, false); }
  };
}

function blockStyle(time, durationMinutes) {
  const [hours, minutes] = time.split(':').map(Number);
  const top = ((hours + minutes / 60) - startHour) * hourHeight;
  const height = Math.max(18, durationMinutes / 60 * hourHeight);
  return `top:${top}px;height:${height}px`;
}

function minutesBetween(start, end) {
  const [startHours, startMinutes] = start.split(':').map(Number);
  const [endHours, endMinutes] = end.split(':').map(Number);
  return endHours * 60 + endMinutes - startHours * 60 - startMinutes;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function userById(id) { return state.users.find((user) => user.id === id); }
function userColor(id) { return userColors[Math.max(0, state.users.findIndex((user) => user.id === id)) % userColors.length]; }
function mondayOf(value) { const date = new Date(value); date.setHours(12, 0, 0, 0); const weekday = date.getDay() || 7; date.setDate(date.getDate() - weekday + 1); return date; }
function addDateDays(value, amount) { const date = new Date(value); date.setDate(date.getDate() + amount); return date; }
function dateString(value) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function argentinaParts(value) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)); const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}` }; }
function argentinaDate(value) { return argentinaParts(value).date; }
function formatShortDate(value) { return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(new Date(value)); }
function formatLongDate(value) { return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)); }

boot().catch((error) => {
  document.querySelector('#week-calendar').innerHTML = `<p class="calendar-load-error">${escapeHtml(error.message)}</p>`;
});
