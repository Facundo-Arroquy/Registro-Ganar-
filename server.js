import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
let statusWriteQueue = Promise.resolve();
let adStatusWriteQueue = Promise.resolve();
let consultorWriteQueue = Promise.resolve();
let complexityWriteQueue = Promise.resolve();
let recurringTaskWriteQueue = Promise.resolve();

let supportsStatusColor = true;
let supportsComplexityColor = true;
let supportsAdStatusColor = true;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  const lines = (await readFile(envPath, 'utf8')).split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmedLine.slice(0, separatorIndex);
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function localDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function isoWeekday(dateString) {
  const weekday = new Date(`${dateString}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isTimeString(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function argentinaDateTime(dateString, timeString) {
  return new Date(`${dateString}T${timeString}:00-03:00`).toISOString();
}

function argentinaParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function daysBetween(first, second) {
  return Math.round((new Date(`${second}T12:00:00Z`) - new Date(`${first}T12:00:00Z`)) / 86400000);
}

function expandCalendarEvent(event, rangeStart, rangeEnd, users, exceptions) {
  const start = argentinaParts(event.starts_at);
  const firstDate = start.date > rangeStart ? start.date : rangeStart;
  const results = [];
  let date = firstDate;
  while (date <= rangeEnd) {
    const elapsedDays = daysBetween(start.date, date);
    const occurs = elapsedDays >= 0 && (
      (!event.recurrence_unit && elapsedDays === 0)
      || (event.recurrence_unit === 'day' && elapsedDays % event.recurrence_interval === 0)
      || (event.recurrence_unit === 'week' && elapsedDays % (7 * event.recurrence_interval) === 0)
    );
    if (occurs && (!event.recurrence_until || date <= event.recurrence_until)) {
      const originalStartsAt = argentinaDateTime(date, start.time);
      const exception = exceptions.find((item) => item.event_id === event.id && new Date(item.occurrence_starts_at).getTime() === new Date(originalStartsAt).getTime());
      if (!exception?.cancelled) {
        results.push({
          id: event.id,
          occurrenceKey: `${event.id}|${originalStartsAt}`,
          title: event.title,
          clientId: event.client_id || '',
          startsAt: exception?.replacement_starts_at || originalStartsAt,
          originalStartsAt,
          durationMinutes: exception?.replacement_duration_minutes || event.duration_minutes,
          notes: event.notes || '',
          recurrenceUnit: event.recurrence_unit || '',
          recurrenceInterval: event.recurrence_interval || null,
          recurrenceUntil: event.recurrence_until || '',
          userIds: users.filter((item) => item.event_id === event.id).map((item) => item.user_id)
        });
      }
    }
    if (!event.recurrence_unit && date >= start.date) break;
    date = addDays(date, 1);
  }
  return results;
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
}

function getSupabaseServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function ensureSupabaseConfig() {
  if (!getSupabaseUrl() || !getSupabaseServiceRoleKey()) {
    throw new Error('Supabase no esta configurado. Se requieren SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env');
  }
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function supabaseHeaders() {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'
  };
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${getSupabaseUrl()}${pathname}`, {
    ...options,
    headers: {
      ...supabaseHeaders(),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || data.message || 'Supabase no pudo completar la operacion');
  }
  return data;
}

async function supabaseRest(pathname, options = {}) {
  const response = await fetch(`${getSupabaseUrl()}/rest/v1${pathname}`, {
    ...options,
    headers: {
      ...supabaseHeaders(),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || 'Supabase no pudo completar la operacion');
  }
  return data;
}

function enqueueRecurringTaskWrite(operation) {
  const result = recurringTaskWriteQueue.then(operation, operation);
  recurringTaskWriteQueue = result.catch(() => {});
  return result;
}

async function generateRecurringCardsThroughToday() {
  return enqueueRecurringTaskWrite(async () => {
    const today = localDateString();
    const [tasks, days] = await Promise.all([
      supabaseRest(`/recurring_tasks?select=id,board_id,client_id,title,description,assigned_to,created_by,start_date,end_date,generated_through&active=eq.true&start_date=lte.${today}`),
      supabaseRest('/recurring_task_days?select=recurring_task_id,weekday,column_id')
    ]);
    for (const task of tasks) {
      const rows = [];
      const schedule = new Map(days.filter((day) => day.recurring_task_id === task.id).map((day) => [day.weekday, day.column_id]));
      const lastDate = task.end_date && task.end_date < today ? task.end_date : today;
      let occurrenceDate = task.generated_through ? addDays(task.generated_through, 1) : task.start_date;
      while (occurrenceDate <= lastDate) {
        const columnId = schedule.get(isoWeekday(occurrenceDate));
        if (columnId) {
          rows.push({
            id: makeId('k'),
            board_id: task.board_id,
            column_id: columnId,
            client_id: task.client_id || null,
            title: task.title,
            description: task.description || '',
            due_date: occurrenceDate,
            created_by: task.created_by || null,
            assigned_to: task.assigned_to || null,
            recurring_task_id: task.id,
            occurrence_date: occurrenceDate,
            entered_column_at: new Date().toISOString()
          });
        }
        occurrenceDate = addDays(occurrenceDate, 1);
      }
      if (rows.length) {
        await supabaseRest('/cards?on_conflict=recurring_task_id,occurrence_date', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(rows)
        });
      }
      if (task.generated_through !== lastDate) {
        await supabaseRest(`/recurring_tasks?id=eq.${encodeURIComponent(task.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ generated_through: lastDate })
        });
      }
    }
  });
}

async function getSupabaseState() {
  const [users, statuses, consultors, complexities, adStatuses, auditRows, clients, boards, columns, cards, recurringTasks, recurringDays, clientLinks, generalLinks] = await Promise.all([
    supabaseRest('/app_users?select=id,email,name&order=name.asc'),
    getSupabaseStatuses(),
    getSupabaseConsultors(),
    getSupabaseComplexities(),
    getSupabaseAdStatuses(),
    supabaseRest('/settings_audit?select=action,user_id,user_name,created_at&order=created_at.desc&limit=50'),
    supabaseRest('/clients?select=id,name,company,email,owner_id,status_id,consultor_id,complexity_id,ad_status_id,meli_user,meeting_day,meeting_time,meeting_frequency,time_bank_seconds'),
    supabaseRest('/boards?select=id,name,color,position&order=position.asc'),
    supabaseRest('/board_columns?select=id,board_id,name,show_timer,position&order=position.asc'),
    supabaseRest('/cards?select=id,board_id,column_id,client_id,title,description,due_date,created_by,assigned_to,entered_column_at,recurring_task_id,occurrence_date'),
    supabaseRest('/recurring_tasks?select=id,board_id,title,start_date,end_date,active'),
    supabaseRest('/recurring_task_days?select=recurring_task_id,weekday,column_id'),
    supabaseRest('/client_links?select=id,client_id,url,label'),
    supabaseRest('/general_links?select=id,url,label&order=created_at.asc')
  ]);
  const statusMap = new Map(statuses.map((status) => [status.id, status]));
  const consultorMap = new Map(consultors.map((c) => [c.id, c]));
  const complexityMap = new Map(complexities.map((item) => [item.id, item]));
  const adStatusMap = new Map(adStatuses.map((item) => [item.id, item]));
  return {
    users: users.map(publicUser),
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      company: client.company,
      email: client.email || '',
      ownerId: client.owner_id || '',
      status: statusMap.get(client.status_id)?.name || 'Activo',
      consultor: consultorMap.get(client.consultor_id)?.name || '',
      complexity: complexityMap.get(client.complexity_id)?.name || '',
      adStatus: adStatusMap.get(client.ad_status_id)?.name || '',
      meliUser: client.meli_user || '',
      meetingDay: client.meeting_day ?? null,
      meetingTime: client.meeting_time || '',
      meetingFrequency: client.meeting_frequency ?? null,
      timeBankSeconds: Number(client.time_bank_seconds || 0),
      links: clientLinks.filter((link) => link.client_id === client.id).map((link) => ({
        id: link.id,
        url: link.url,
        label: link.label
      }))
    })),
    boards: boards.map((board) => ({
      id: board.id,
      name: board.name,
      color: board.color,
      columns: columns.filter((column) => column.board_id === board.id).map((column) => ({
        id: column.id,
        name: column.name,
        showTimer: column.show_timer
      })),
      cards: cards.filter((card) => card.board_id === board.id).map((card) => ({
        id: card.id,
        columnId: card.column_id,
        clientId: card.client_id || '',
        title: card.title,
        description: card.description || '',
        dueDate: card.due_date || '',
        createdBy: card.created_by || '',
        assignedTo: card.assigned_to || '',
        recurringTaskId: card.recurring_task_id || '',
        occurrenceDate: card.occurrence_date || '',
        enteredColumnAt: card.entered_column_at ? new Date(card.entered_column_at).getTime() : Date.now()
      }))
    })),
    recurringTasks: recurringTasks.map((task) => ({
      id: task.id,
      boardId: task.board_id,
      title: task.title,
      startDate: task.start_date,
      endDate: task.end_date || '',
      active: task.active,
      days: recurringDays.filter((day) => day.recurring_task_id === task.id).map((day) => ({ weekday: day.weekday, columnId: day.column_id }))
    })),
    settings: {
      clientStatuses: statuses.map((status) => normalizeStatus({ name: status.name, color: status.color })),
      clientConsultors: consultors.map((item) => ({ name: item.name, color: item.color })),
      complexities: complexities.map((c) => normalizeComplexity({ name: c.name, color: c.color })),
      adStatuses: adStatuses.map((a) => normalizeAdStatus({ name: a.name, color: a.color })),
      lastConfigChange: auditRows[0] ? mapAuditRow(auditRows[0]) : null,
      configChanges: auditRows.map(mapAuditRow)
    },
    generalLinks: generalLinks.map((link) => ({ id: link.id, url: link.url, label: link.label }))
  };
}

async function getStatusIdByName(statusName) {
  const statuses = await supabaseRest(`/client_statuses?select=id,name&name=eq.${encodeURIComponent(statusName || 'Activo')}&limit=1`);
  if (statuses.length) return statuses[0].id;
  const fallback = await supabaseRest('/client_statuses?select=id,name&order=position.asc&limit=1');
  return fallback[0]?.id;
}

async function getNextColumnPosition(boardId) {
  const columns = await supabaseRest(`/board_columns?select=position&board_id=eq.${encodeURIComponent(boardId)}&order=position.desc&limit=1`);
  return (columns[0]?.position || 0) + 1;
}

async function getNextBoardPosition() {
  const boards = await supabaseRest('/boards?select=position&order=position.desc&limit=1');
  return (boards[0]?.position || 0) + 1;
}

async function getNextStatusPosition() {
  const statuses = await supabaseRest('/client_statuses?select=position&order=position.desc&limit=1');
  return (statuses[0]?.position || 0) + 1;
}

async function getSupabaseConsultors() {
  return await supabaseRest('/client_consultors?select=id,name,position,color&order=position.asc');
}

async function getNextConsultorPosition() {
  const consultors = await supabaseRest('/client_consultors?select=position&order=position.desc&limit=1');
  return (consultors[0]?.position || 0) + 1;
}

async function getConsultorIdByName(consultorName) {
  if (!consultorName) return null;
  const consultors = await supabaseRest(`/client_consultors?select=id,name&name=eq.${encodeURIComponent(consultorName)}&limit=1`);
  return consultors[0]?.id || null;
}

async function getSupabaseStatuses() {
  try {
    const rows = await supabaseRest('/client_statuses?select=id,name,position,color&order=position.asc');
    supportsStatusColor = true;
    return rows;
  } catch {
    supportsStatusColor = false;
    return await supabaseRest('/client_statuses?select=id,name,position&order=position.asc');
  }
}

function statusWritePayload(payload) {
  if (!supportsStatusColor) {
    const { color, ...rest } = payload;
    return rest;
  }
  return payload;
}

async function getNextComplexityPosition() {
  const rows = await supabaseRest('/complexities?select=position&order=position.desc&limit=1');
  return (rows[0]?.position || 0) + 1;
}

async function getSupabaseComplexities() {
  try {
    const rows = await supabaseRest('/complexities?select=id,name,position,color&order=position.asc');
    supportsComplexityColor = true;
    return rows;
  } catch {
    supportsComplexityColor = false;
    return await supabaseRest('/complexities?select=id,name,position&order=position.asc');
  }
}

function complexityWritePayload(payload) {
  if (!supportsComplexityColor) {
    const { color, ...rest } = payload;
    return rest;
  }
  return payload;
}

function normalizeComplexity(complexity) {
  if (typeof complexity === 'string') {
    return { name: complexity, color: '#388bfd' };
  }
  const name = String(complexity?.name || '').trim();
  const color = isHexColor(complexity?.color) ? complexity.color : '#388bfd';
  return { name, color };
}

async function getComplexityIdByName(name) {
  const rows = await supabaseRest(`/complexities?select=id,name&name=eq.${encodeURIComponent(name || '')}&limit=1`);
  if (rows.length) return rows[0].id;
  return null;
}

async function enqueueComplexityWrite(operation) {
  const current = complexityWriteQueue.then(operation).catch((error) => { throw error; });
  complexityWriteQueue = current.catch(() => {});
  return current;
}

async function getNextAdStatusPosition() {
  const rows = await supabaseRest('/ad_statuses?select=position&order=position.desc&limit=1');
  return (rows[0]?.position || 0) + 1;
}

async function getSupabaseAdStatuses() {
  try {
    const rows = await supabaseRest('/ad_statuses?select=id,name,position,color&order=position.asc');
    supportsAdStatusColor = true;
    return rows;
  } catch {
    supportsAdStatusColor = false;
    return await supabaseRest('/ad_statuses?select=id,name,position&order=position.asc');
  }
}

function adStatusWritePayload(payload) {
  if (!supportsAdStatusColor) {
    const { color, ...rest } = payload;
    return rest;
  }
  return payload;
}

function normalizeAdStatus(item) {
  if (typeof item === 'string') return { name: item, color: '#388bfd' };
  const name = String(item?.name || '').trim();
  const color = isHexColor(item?.color) ? item.color : '#388bfd';
  return { name, color };
}

async function getAdStatusIdByName(name) {
  if (!name) return null;
  const rows = await supabaseRest(`/ad_statuses?select=id,name&name=eq.${encodeURIComponent(name)}&limit=1`);
  return rows.length ? rows[0].id : null;
}

async function enqueueAdStatusWrite(operation) {
  const current = adStatusWriteQueue.then(operation).catch((error) => { throw error; });
  adStatusWriteQueue = current.catch(() => {});
  return current;
}

async function recordSupabaseAudit(body, action) {
  await supabaseRest('/settings_audit', {
    method: 'POST',
    body: JSON.stringify([{
      action,
      user_id: body.userId || null,
      user_name: body.userName || 'Usuario'
    }])
  });
}

async function tryRecordSupabaseAudit(body, action) {
  try {
    await recordSupabaseAudit(body, action);
  } catch (error) {
    console.warn('Skipping audit persistence:', error.message);
  }
}

function recordAuditInBackground(body, action) {
  const task = tryRecordSupabaseAudit(body, action);
  const requestContext = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
  requestContext?.waitUntil?.(task);
}

function mapAuditRow(row) {
  return {
    action: row.action,
    userId: row.user_id || '',
    userName: row.user_name,
    at: row.created_at
  };
}

async function getSupabaseSettings() {
  const [statuses, consultors, complexities, adStatuses, auditRows] = await Promise.all([
    getSupabaseStatuses(),
    getSupabaseConsultors(),
    getSupabaseComplexities(),
    getSupabaseAdStatuses(),
    supabaseRest('/settings_audit?select=action,user_id,user_name,created_at&order=created_at.desc&limit=50')
  ]);
  return {
    clientStatuses: statuses.map((status) => normalizeStatus({ name: status.name, color: status.color })),
    clientConsultors: consultors.map((item) => ({ name: item.name, color: item.color })),
    complexities: complexities.map((c) => normalizeComplexity({ name: c.name, color: c.color })),
    adStatuses: adStatuses.map((a) => normalizeAdStatus({ name: a.name, color: a.color })),
    lastConfigChange: auditRows[0] ? mapAuditRow(auditRows[0]) : null,
    configChanges: auditRows.map(mapAuditRow)
  };
}

async function getSupabaseClient(clientId) {
  const [client] = await supabaseRest(`/clients?select=id,name,company,email,owner_id,meeting_day,meeting_time,meeting_frequency,time_bank_seconds,complexity_id,ad_status_id,meli_user,status:client_statuses(name),consultor:client_consultors(name),complexity:complexities(name),ad_status:ad_statuses(name)&id=eq.${encodeURIComponent(clientId)}&limit=1`);
  if (!client) return null;
  return {
    id: client.id,
    name: client.name,
    company: client.company,
    email: client.email || '',
    ownerId: client.owner_id || '',
    status: client.status?.name || 'Activo',
    consultor: client.consultor?.name || '',
    complexity: client.complexity?.name || '',
    adStatus: client.ad_status?.name || '',
    meliUser: client.meli_user || '',
    meetingDay: client.meeting_day ?? null,
    meetingTime: client.meeting_time || '',
    meetingFrequency: client.meeting_frequency ?? null,
    timeBankSeconds: Number(client.time_bank_seconds || 0)
  };
}

async function getSupabaseBoard(boardId) {
  const encodedId = encodeURIComponent(boardId);
  const [[board], columns, cards] = await Promise.all([
    supabaseRest(`/boards?select=id,name,color&id=eq.${encodedId}&limit=1`),
    supabaseRest(`/board_columns?select=id,name,show_timer&board_id=eq.${encodedId}&order=position.asc`),
    supabaseRest(`/cards?select=id,column_id,client_id,title,description,due_date,created_by,assigned_to,entered_column_at,recurring_task_id,occurrence_date&board_id=eq.${encodedId}`)
  ]);
  if (!board) return null;
  return {
    id: board.id,
    name: board.name,
    color: board.color,
    columns: columns.map((column) => ({ id: column.id, name: column.name, showTimer: column.show_timer })),
    cards: cards.map((card) => ({
      id: card.id,
      columnId: card.column_id,
      clientId: card.client_id || '',
      title: card.title,
      description: card.description || '',
      dueDate: card.due_date || '',
      createdBy: card.created_by || '',
      assignedTo: card.assigned_to || '',
      recurringTaskId: card.recurring_task_id || '',
      occurrenceDate: card.occurrence_date || '',
      enteredColumnAt: card.entered_column_at ? new Date(card.entered_column_at).getTime() : Date.now()
    }))
  };
}

async function syncSupabaseAppUser(authUser, fallbackName = '') {
  const email = String(authUser.email || '').trim().toLowerCase();
  const name = String(authUser.user_metadata?.name || fallbackName || email.split('@')[0] || 'Usuario').trim();
  await supabaseRest('/app_users?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ id: authUser.id, email, name }])
  });
  return { id: authUser.id, email, name };
}

async function getSupabaseAppUserByEmail(email) {
  const users = await supabaseRest(`/app_users?select=id,email,name&email=eq.${encodeURIComponent(email)}&limit=1`);
  return users[0] ? publicUser(users[0]) : null;
}

async function signInWithSupabase(email, password) {
  return supabaseRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

async function createSupabaseUser({ email, password, name }) {
  const data = await supabaseRequest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    })
  });
  return data.user || data;
}

async function getSupabaseUserFromToken(accessToken) {
  const response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: getSupabaseServiceRoleKey(),
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const authCache = new Map();
const syncedAppUsers = new Map();

function cacheAuthUser(accessToken, authUser) {
  const expMs = Number(decodeJwtPayload(accessToken)?.exp || 0) * 1000;
  const expiresAt = Math.min(Date.now() + AUTH_CACHE_TTL_MS, expMs || Infinity);
  if (authCache.size > 500) {
    for (const [token, entry] of authCache) {
      if (entry.expiresAt <= Date.now()) authCache.delete(token);
    }
  }
  authCache.set(accessToken, { authUser, expiresAt });
}

async function getCachedSupabaseUser(accessToken) {
  const cached = authCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.authUser;
  authCache.delete(accessToken);
  const authUser = await getSupabaseUserFromToken(accessToken);
  if (authUser) cacheAuthUser(accessToken, authUser);
  return authUser;
}

async function ensureSupabaseAppUser(authUser) {
  const signature = `${authUser.email}|${authUser.user_metadata?.name || ''}`;
  if (syncedAppUsers.get(authUser.id) === signature) return;
  await syncSupabaseAppUser(authUser);
  syncedAppUsers.set(authUser.id, signature);
}

async function requireApiUser(req, res) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    sendError(res, 401, 'Sesion requerida');
    return null;
  }
  const authUser = await getCachedSupabaseUser(match[1]);
  if (!authUser) {
    sendError(res, 401, 'Sesion invalida');
    return null;
  }
  const appUser = await getSupabaseAppUserByEmail(authUser.email);
  if (!appUser) {
    authCache.delete(match[1]);
    sendError(res, 401, 'Usuario eliminado');
    return null;
  }
  await ensureSupabaseAppUser(authUser);
  return { id: authUser.id, email: authUser.email, name: appUser.name || authUser.user_metadata?.name || authUser.email };
}

function normalizeStatus(status) {
  const defaultStatusColors = {
    Activo: '#3fb950',
    'En pausa': '#d29922',
    Riesgo: '#f85149',
    Cerrado: '#8b949e'
  };
  if (typeof status === 'string') {
    return { name: status, color: defaultStatusColors[status] || '#388bfd' };
  }
  const name = String(status?.name || '').trim();
  const color = isHexColor(status?.color) ? status.color : defaultStatusColors[name] || '#388bfd';
  return { name, color };
}

function isHexColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
}

function parseMeetingDay(value) {
  if (value === null || value === '' || value === undefined) return null;
  const day = Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : null;
}

function parseMeetingTime(value) {
  if (!value) return null;
  const str = String(value).trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(str) ? str.slice(0, 5) : null;
}

function parseMeetingFrequency(value) {
  if (value === null || value === '' || value === undefined) return null;
  const freq = Number(value);
  return freq === 7 || freq === 15 ? freq : null;
}

async function enqueueStatusWrite(operation) {
  const result = statusWriteQueue.then(operation, operation);
  statusWriteQueue = result.catch(() => {});
  return result;
}

async function enqueueConsultorWrite(operation) {
  const result = consultorWriteQueue.then(operation, operation);
  consultorWriteQueue = result.catch(() => {});
  return result;
}

async function handleApi(req, res, url) {
  const body = req.method === 'GET' ? {} : await readBody(req);
  const segments = url.pathname.split('/').filter(Boolean);

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    try {
      const auth = await signInWithSupabase(email, password);
      const user = await syncSupabaseAppUser(auth.user);
      syncedAppUsers.set(auth.user.id, `${auth.user.email}|${auth.user.user_metadata?.name || ''}`);
      cacheAuthUser(auth.access_token, auth.user);
      return sendJson(res, 200, { user: publicUser(user), accessToken: auth.access_token });
    } catch (error) {
      console.error('Supabase login failed:', error.message);
      return sendError(res, 401, 'Credenciales invalidas');
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/diagnostics') {
    const supabaseUrl = getSupabaseUrl();
    const serviceRoleKey = getSupabaseServiceRoleKey();
    const keyPayload = decodeJwtPayload(serviceRoleKey);
    return sendJson(res, 200, {
      hasSupabaseUrl: Boolean(supabaseUrl),
      supabaseHost: supabaseUrl ? new URL(supabaseUrl).host : null,
      hasServiceRoleKey: Boolean(serviceRoleKey),
      serviceRoleKeyLength: serviceRoleKey.length,
      serviceRoleJwtRole: keyPayload?.role || null,
      serviceRoleJwtRef: keyPayload?.ref || null
    });
  }

  const apiUser = await requireApiUser(req, res);
  if (!apiUser) return;

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    await generateRecurringCardsThroughToday();
    return sendJson(res, 200, await getSupabaseState());
  }

  if (req.method === 'PATCH' && url.pathname === '/api/users/me') {
    const name = body.name !== undefined ? String(body.name).trim() : '';
    const password = body.password !== undefined ? String(body.password) : '';
    if (!name && !password) return sendError(res, 400, 'Nada que actualizar');
    if (name && !name.trim()) return sendError(res, 400, 'El nombre no puede estar vacio');
    if (password && password.length < 6) return sendError(res, 400, 'La contrasena debe tener al menos 6 caracteres');
    const updates = {};
    if (name) updates.user_metadata = { name };
    if (password) updates.password = password;
    await supabaseRequest(`/auth/v1/admin/users/${apiUser.id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    if (name) {
      await supabaseRest(`/app_users?id=eq.${encodeURIComponent(apiUser.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name })
      });
      syncedAppUsers.delete(apiUser.id);
    }
    const updatedUser = { id: apiUser.id, email: apiUser.email, name: name || apiUser.name };
    return sendJson(res, 200, { user: publicUser(updatedUser) });
  }

  if (req.method === 'GET' && url.pathname === '/api/calendar') {
    const rangeStart = String(url.searchParams.get('from') || '');
    const rangeEnd = String(url.searchParams.get('to') || '');
    if (!isDateString(rangeStart) || !isDateString(rangeEnd) || rangeEnd < rangeStart || daysBetween(rangeStart, rangeEnd) > 62) {
      return sendError(res, 400, 'Rango de calendario invalido');
    }
    const [availability, availabilityExceptions, events, eventUsers, eventExceptions] = await Promise.all([
      supabaseRest('/calendar_availability?select=id,user_id,weekday,start_time,end_time,valid_from,valid_to&order=start_time.asc'),
      supabaseRest(`/calendar_availability_exceptions?select=id,user_id,exception_date,start_time,end_time,unavailable,note&exception_date=gte.${rangeStart}&exception_date=lte.${rangeEnd}`),
      supabaseRest('/calendar_events?select=id,title,client_id,starts_at,duration_minutes,notes,recurrence_unit,recurrence_interval,recurrence_until'),
      supabaseRest('/calendar_event_users?select=event_id,user_id'),
      supabaseRest('/calendar_event_exceptions?select=id,event_id,occurrence_starts_at,replacement_starts_at,replacement_duration_minutes,cancelled')
    ]);
    const occurrences = events.flatMap((event) => expandCalendarEvent(event, rangeStart, rangeEnd, eventUsers, eventExceptions));
    return sendJson(res, 200, {
      availability: availability.map((item) => ({
        id: item.id,
        userId: item.user_id,
        weekday: item.weekday,
        startTime: String(item.start_time).slice(0, 5),
        endTime: String(item.end_time).slice(0, 5),
        validFrom: item.valid_from,
        validTo: item.valid_to || ''
      })),
      availabilityExceptions: availabilityExceptions.map((item) => ({
        id: item.id,
        userId: item.user_id,
        date: item.exception_date,
        startTime: item.start_time ? String(item.start_time).slice(0, 5) : '',
        endTime: item.end_time ? String(item.end_time).slice(0, 5) : '',
        unavailable: item.unavailable,
        note: item.note || ''
      })),
      events: occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/calendar/availability') {
    const userId = String(body.userId || '');
    const effectiveFrom = String(body.effectiveFrom || '');
    const schedule = Array.isArray(body.schedule) ? body.schedule : [];
    if (!userId || !isDateString(effectiveFrom)) return sendError(res, 400, 'Usuario y fecha de vigencia son obligatorios');
    const normalized = schedule.map((item) => ({
      weekday: Number(item.weekday),
      startTime: String(item.startTime || '').slice(0, 5),
      endTime: String(item.endTime || '').slice(0, 5)
    }));
    if (normalized.some((item) => !Number.isInteger(item.weekday) || item.weekday < 1 || item.weekday > 7 || !isTimeString(item.startTime) || !isTimeString(item.endTime) || item.endTime <= item.startTime)) {
      return sendError(res, 400, 'Hay horarios de disponibilidad invalidos');
    }
    const existing = await supabaseRest(`/calendar_availability?select=id,valid_from,valid_to&user_id=eq.${encodeURIComponent(userId)}`);
    const previousDate = addDays(effectiveFrom, -1);
    for (const rule of existing) {
      if (rule.valid_to && rule.valid_to < effectiveFrom) continue;
      if (rule.valid_from >= effectiveFrom) {
        await supabaseRest(`/calendar_availability?id=eq.${encodeURIComponent(rule.id)}`, { method: 'DELETE' });
      } else {
        await supabaseRest(`/calendar_availability?id=eq.${encodeURIComponent(rule.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ valid_to: previousDate })
        });
      }
    }
    if (normalized.length) {
      await supabaseRest('/calendar_availability', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(normalized.map((item) => ({
          id: makeId('av'),
          user_id: userId,
          weekday: item.weekday,
          start_time: item.startTime,
          end_time: item.endTime,
          valid_from: effectiveFrom,
          created_by: apiUser.id
        })))
      });
    }
    return sendJson(res, 200, { saved: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/calendar/availability-exceptions') {
    const userId = String(body.userId || '');
    const date = String(body.date || '');
    const unavailable = Boolean(body.unavailable);
    const startTime = String(body.startTime || '').slice(0, 5);
    const endTime = String(body.endTime || '').slice(0, 5);
    if (!userId || !isDateString(date)) return sendError(res, 400, 'Usuario y fecha son obligatorios');
    if (!unavailable && (!isTimeString(startTime) || !isTimeString(endTime) || endTime <= startTime)) {
      return sendError(res, 400, 'El horario de excepcion es invalido');
    }
    await supabaseRest(`/calendar_availability_exceptions?user_id=eq.${encodeURIComponent(userId)}&exception_date=eq.${date}`, { method: 'DELETE' });
    await supabaseRest('/calendar_availability_exceptions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        id: makeId('avx'), user_id: userId, exception_date: date,
        start_time: unavailable ? null : startTime, end_time: unavailable ? null : endTime,
        unavailable, note: String(body.note || '').trim(), created_by: apiUser.id
      }])
    });
    return sendJson(res, 201, { saved: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/calendar/events') {
    const title = String(body.title || '').trim();
    const date = String(body.date || '');
    const time = String(body.time || '').slice(0, 5);
    const durationMinutes = Number(body.durationMinutes);
    const userIds = [...new Set(Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : [])];
    const recurrenceUnit = body.recurrenceUnit === 'day' || body.recurrenceUnit === 'week' ? body.recurrenceUnit : null;
    const recurrenceInterval = recurrenceUnit ? Number(body.recurrenceInterval) : null;
    const recurrenceUntil = recurrenceUnit && body.recurrenceUntil ? String(body.recurrenceUntil) : null;
    if (!title || !isDateString(date) || !isTimeString(time)) return sendError(res, 400, 'Titulo, fecha y hora son obligatorios');
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) return sendError(res, 400, 'La duracion es invalida');
    if (!userIds.length) return sendError(res, 400, 'Selecciona al menos un usuario');
    if (recurrenceUnit && (!Number.isInteger(recurrenceInterval) || recurrenceInterval < 1 || recurrenceInterval > 365)) return sendError(res, 400, 'La repeticion es invalida');
    if (recurrenceUntil && (!isDateString(recurrenceUntil) || recurrenceUntil < date)) return sendError(res, 400, 'La fecha final de repeticion es invalida');
    const event = {
      id: makeId('evt'), title, clientId: String(body.clientId || ''), startsAt: argentinaDateTime(date, time),
      durationMinutes, notes: String(body.notes || '').trim(), recurrenceUnit,
      recurrenceInterval, recurrenceUntil, userIds
    };
    await supabaseRest('/calendar_events', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        id: event.id, title: event.title, client_id: event.clientId || null, starts_at: event.startsAt,
        duration_minutes: event.durationMinutes, notes: event.notes, recurrence_unit: event.recurrenceUnit,
        recurrence_interval: event.recurrenceInterval, recurrence_until: event.recurrenceUntil,
        created_by: apiUser.id, updated_by: apiUser.id
      }])
    });
    try {
      await supabaseRest('/calendar_event_users', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(userIds.map((userId) => ({ event_id: event.id, user_id: userId })))
      });
    } catch (error) {
      await supabaseRest(`/calendar_events?id=eq.${encodeURIComponent(event.id)}`, { method: 'DELETE' });
      throw error;
    }
    return sendJson(res, 201, { event });
  }

  if (segments[0] === 'api' && segments[1] === 'calendar' && segments[2] === 'events' && segments[3]) {
    const eventId = segments[3];
    if (req.method === 'DELETE') {
      if (body.scope === 'occurrence' && body.originalStartsAt) {
        await supabaseRest('/calendar_event_exceptions?on_conflict=event_id,occurrence_starts_at', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify([{
            id: makeId('evx'), event_id: eventId, occurrence_starts_at: body.originalStartsAt,
            cancelled: true, created_by: apiUser.id
          }])
        });
        return sendJson(res, 200, { cancelled: true });
      }
      await supabaseRest(`/calendar_events?id=eq.${encodeURIComponent(eventId)}`, { method: 'DELETE' });
      return sendJson(res, 200, { deleted: true });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/client-statuses') {
    return enqueueStatusWrite(async () => {
      const status = String(body.status || '').trim();
      const color = isHexColor(body.color) ? String(body.color) : '#388bfd';
      if (!status) return sendError(res, 400, 'El estado es obligatorio');
      const statuses = await getSupabaseStatuses();
      if (statuses.some((item) => item.name.toLowerCase() === status.toLowerCase())) {
        return sendError(res, 400, 'Ese estado ya existe');
      }
      await supabaseRest('/client_statuses', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([statusWritePayload({ name: status, color, position: await getNextStatusPosition() })])
      });
      await tryRecordSupabaseAudit(body, `Agrego el estado "${status}"`);
      return sendJson(res, 201, { settings: await getSupabaseSettings() });
    });
  }

  if (segments[0] === 'api' && segments[1] === 'settings' && segments[2] === 'client-statuses' && segments[3]) {
    const index = Number(segments[3]);
    if (!Number.isInteger(index) || index < 0) {
      return sendError(res, 404, 'Estado no encontrado');
    }

    if (req.method === 'PATCH') {
      return enqueueStatusWrite(async () => {
        const statuses = await getSupabaseStatuses();
        const statusRow = statuses[index];
        if (!statusRow) return sendError(res, 404, 'Estado no encontrado');
        const nextStatus = String(body.status || '').trim();
        const nextColor = isHexColor(body.color) ? String(body.color) : normalizeStatus(statusRow).color;
        if (!nextStatus) return sendError(res, 400, 'El estado es obligatorio');
        const duplicateStatus = statuses.some((item, itemIndex) => (
          itemIndex !== index && item.name.toLowerCase() === nextStatus.toLowerCase()
        ));
        if (duplicateStatus) return sendError(res, 400, 'Ese estado ya existe');
        await supabaseRest(`/client_statuses?id=eq.${encodeURIComponent(statusRow.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(statusWritePayload({ name: nextStatus, color: nextColor }))
        });
        await tryRecordSupabaseAudit(body, `Edito el estado "${statusRow.name}" a "${nextStatus}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }

    if (req.method === 'DELETE') {
      return enqueueStatusWrite(async () => {
        const statuses = await getSupabaseStatuses();
        const statusRow = statuses[index];
        if (!statusRow) return sendError(res, 404, 'Estado no encontrado');
        if (statuses.length <= 1) return sendError(res, 400, 'Debe conservarse al menos un estado');
        const fallbackStatus = statuses.find((item) => item.id !== statusRow.id);
        await supabaseRest(`/clients?status_id=eq.${encodeURIComponent(statusRow.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status_id: fallbackStatus.id })
        });
        await supabaseRest(`/client_statuses?id=eq.${encodeURIComponent(statusRow.id)}`, { method: 'DELETE' });
        await tryRecordSupabaseAudit(body, `Saco el estado "${statusRow.name}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/complexities') {
    return enqueueComplexityWrite(async () => {
      const name = String(body.status || '').trim();
      const color = isHexColor(body.color) ? String(body.color) : '#388bfd';
      if (!name) return sendError(res, 400, 'El nombre es obligatorio');
      const existing = await getSupabaseComplexities();
      if (existing.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        return sendError(res, 400, 'Esa complejidad ya existe');
      }
      await supabaseRest('/complexities', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([complexityWritePayload({ name, color, position: await getNextComplexityPosition() })])
      });
      await tryRecordSupabaseAudit(body, `Agrego la complejidad "${name}"`);
      return sendJson(res, 201, { settings: await getSupabaseSettings() });
    });
  }

  if (segments[0] === 'api' && segments[1] === 'settings' && segments[2] === 'complexities' && segments[3]) {
    const index = Number(segments[3]);
    if (!Number.isInteger(index) || index < 0) {
      return sendError(res, 404, 'Complejidad no encontrada');
    }

    if (req.method === 'PATCH') {
      return enqueueComplexityWrite(async () => {
        const complexities = await getSupabaseComplexities();
        const row = complexities[index];
        if (!row) return sendError(res, 404, 'Complejidad no encontrada');
        const nextName = String(body.status || '').trim();
        const nextColor = isHexColor(body.color) ? String(body.color) : normalizeComplexity(row).color;
        if (!nextName) return sendError(res, 400, 'El nombre es obligatorio');
        const duplicate = complexities.some((item, i) => i !== index && item.name.toLowerCase() === nextName.toLowerCase());
        if (duplicate) return sendError(res, 400, 'Esa complejidad ya existe');
        await supabaseRest(`/complexities?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(complexityWritePayload({ name: nextName, color: nextColor }))
        });
        await tryRecordSupabaseAudit(body, `Edito la complejidad "${row.name}" a "${nextName}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }

    if (req.method === 'DELETE') {
      return enqueueComplexityWrite(async () => {
        const complexities = await getSupabaseComplexities();
        const row = complexities[index];
        if (!row) return sendError(res, 404, 'Complejidad no encontrada');
        if (complexities.length <= 1) return sendError(res, 400, 'Debe conservarse al menos una complejidad');
        const fallback = complexities.find((item) => item.id !== row.id);
        await supabaseRest(`/clients?complexity_id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ complexity_id: fallback.id })
        });
        await supabaseRest(`/complexities?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        await tryRecordSupabaseAudit(body, `Saco la complejidad "${row.name}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/client-consultors') {
    return enqueueConsultorWrite(async () => {
      const name = String(body.status || '').trim();
      const color = isHexColor(body.color) ? String(body.color) : '#388bfd';
      if (!name) return sendError(res, 400, 'El consultor es obligatorio');
      const consultors = await getSupabaseConsultors();
      if (consultors.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        return sendError(res, 400, 'Ese consultor ya existe');
      }
      await supabaseRest('/client_consultors', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ name, color, position: await getNextConsultorPosition() }])
      });
      await tryRecordSupabaseAudit(body, `Agrego el consultor "${name}"`);
      return sendJson(res, 201, { settings: await getSupabaseSettings() });
    });
  }

  if (segments[0] === 'api' && segments[1] === 'settings' && segments[2] === 'client-consultors' && segments[3]) {
    const index = Number(segments[3]);
    if (!Number.isInteger(index) || index < 0) return sendError(res, 404, 'Consultor no encontrado');

    if (req.method === 'PATCH') {
      return enqueueConsultorWrite(async () => {
        const consultors = await getSupabaseConsultors();
        const row = consultors[index];
        if (!row) return sendError(res, 404, 'Consultor no encontrado');
        const nextName = String(body.status || '').trim();
        const nextColor = isHexColor(body.color) ? String(body.color) : row.color;
        if (!nextName) return sendError(res, 400, 'El consultor es obligatorio');
        const duplicate = consultors.some((item, itemIndex) => itemIndex !== index && item.name.toLowerCase() === nextName.toLowerCase());
        if (duplicate) return sendError(res, 400, 'Ese consultor ya existe');
        await supabaseRest(`/client_consultors?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: nextName, color: nextColor })
        });
        await tryRecordSupabaseAudit(body, `Edito el consultor "${row.name}" a "${nextName}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }

    if (req.method === 'DELETE') {
      return enqueueConsultorWrite(async () => {
        const consultors = await getSupabaseConsultors();
        const row = consultors[index];
        if (!row) return sendError(res, 404, 'Consultor no encontrado');
        if (consultors.length <= 1) return sendError(res, 400, 'Debe conservarse al menos un consultor');
        const fallback = consultors.find((item) => item.id !== row.id);
        await supabaseRest(`/clients?consultor_id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ consultor_id: fallback.id })
        });
        await supabaseRest(`/client_consultors?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        await tryRecordSupabaseAudit(body, `Saco el consultor "${row.name}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/ad-statuses') {
    return enqueueAdStatusWrite(async () => {
      const name = String(body.status || '').trim();
      const color = isHexColor(body.color) ? String(body.color) : '#388bfd';
      if (!name) return sendError(res, 400, 'El nombre es obligatorio');
      const existing = await getSupabaseAdStatuses();
      if (existing.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
        return sendError(res, 400, 'Ese estado de publicidad ya existe');
      }
      await supabaseRest('/ad_statuses', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([adStatusWritePayload({ name, color, position: await getNextAdStatusPosition() })])
      });
      await tryRecordSupabaseAudit(body, `Agrego el estado de publicidad "${name}"`);
      return sendJson(res, 201, { settings: await getSupabaseSettings() });
    });
  }

  if (segments[0] === 'api' && segments[1] === 'settings' && segments[2] === 'ad-statuses' && segments[3]) {
    const index = Number(segments[3]);
    if (!Number.isInteger(index) || index < 0) return sendError(res, 404, 'Estado de publicidad no encontrado');

    if (req.method === 'PATCH') {
      return enqueueAdStatusWrite(async () => {
        const items = await getSupabaseAdStatuses();
        const row = items[index];
        if (!row) return sendError(res, 404, 'Estado de publicidad no encontrado');
        const nextName = String(body.status || '').trim();
        const nextColor = isHexColor(body.color) ? String(body.color) : normalizeAdStatus(row).color;
        if (!nextName) return sendError(res, 400, 'El nombre es obligatorio');
        const duplicate = items.some((item, i) => i !== index && item.name.toLowerCase() === nextName.toLowerCase());
        if (duplicate) return sendError(res, 400, 'Ese estado de publicidad ya existe');
        await supabaseRest(`/ad_statuses?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(adStatusWritePayload({ name: nextName, color: nextColor }))
        });
        await tryRecordSupabaseAudit(body, `Edito el estado de publicidad "${row.name}" a "${nextName}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }

    if (req.method === 'DELETE') {
      return enqueueAdStatusWrite(async () => {
        const items = await getSupabaseAdStatuses();
        const row = items[index];
        if (!row) return sendError(res, 404, 'Estado de publicidad no encontrado');
        if (items.length <= 1) return sendError(res, 400, 'Debe conservarse al menos un estado de publicidad');
        const fallback = items.find((item) => item.id !== row.id);
        await supabaseRest(`/clients?ad_status_id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ad_status_id: fallback.id })
        });
        await supabaseRest(`/ad_statuses?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        await tryRecordSupabaseAudit(body, `Saco el estado de publicidad "${row.name}"`);
        return sendJson(res, 200, { settings: await getSupabaseSettings() });
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/users/invitations') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || email.split('@')[0] || '').trim();
    const password = String(body.password || '');
    if (!email) return sendError(res, 400, 'El email es obligatorio');
    if (!name) return sendError(res, 400, 'El nombre es obligatorio');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, 'El email no es valido');
    if (password.length < 6) return sendError(res, 400, 'La contrasena debe tener al menos 6 caracteres');
    const existing = await getSupabaseAppUserByEmail(email);
    if (existing) return sendJson(res, 200, { user: publicUser(existing), invited: false });
    try {
      let authUser;
      try {
        authUser = await createSupabaseUser({ email, password, name });
      } catch (authError) {
        if (!/already.*registered|already.*exists|duplicate/i.test(authError.message)) {
          throw authError;
        }
        const allAuthUsers = await supabaseRequest('/auth/v1/admin/users');
        authUser = (allAuthUsers.users || []).find((u) => u.email === email);
        if (!authUser) throw authError;
        await supabaseRequest(`/auth/v1/admin/users/${authUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({ user_metadata: { name }, password })
        });
      }
      const user = await syncSupabaseAppUser(authUser, name);
      const auditBody = { userId: apiUser.id, userName: apiUser.name };
      recordAuditInBackground(auditBody, `Invito al usuario "${name}" (${email})`);
      return sendJson(res, 201, { user: publicUser(user), invited: true });
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/clients') {
    const client = {
      id: makeId('cl'),
      name: String(body.name || '').trim(),
      company: String(body.company || '').trim(),
      email: String(body.email || '').trim(),
      ownerId: String(body.ownerId || ''),
      status: String(body.status || 'Activo').trim(),
      consultor: String(body.consultor || '').trim(),
      complexity: String(body.complexity || '').trim(),
      adStatus: String(body.adStatus || '').trim(),
      meliUser: String(body.meliUser || '').trim(),
      meetingDay: parseMeetingDay(body.meetingDay),
      meetingTime: parseMeetingTime(body.meetingTime),
      meetingFrequency: parseMeetingFrequency(body.meetingFrequency)
    };
    if (!client.name || !client.company) return sendError(res, 400, 'Nombre y empresa son obligatorios');
    const [statusId, consultorId, complexityId, adStatusId] = await Promise.all([
      getStatusIdByName(client.status),
      getConsultorIdByName(client.consultor),
      getComplexityIdByName(client.complexity),
      getAdStatusIdByName(client.adStatus)
    ]);
    const [createdClient] = await supabaseRest('/clients', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        id: client.id,
        name: client.name,
        company: client.company,
        email: client.email || null,
        owner_id: client.ownerId || null,
        status_id: statusId,
        consultor_id: consultorId,
        complexity_id: complexityId,
        ad_status_id: adStatusId,
        meli_user: client.meliUser || null,
        meeting_day: client.meetingDay,
        meeting_time: client.meetingTime,
        meeting_frequency: client.meetingFrequency
      }])
    });
    recordAuditInBackground(body, `Creo el cliente "${client.name}"`);
    return sendJson(res, 201, { client: { ...client, id: createdClient.id } });
  }

  if (segments[0] === 'api' && segments[1] === 'clients' && segments[2]) {
    const requestedClientId = segments[2];
    const client = await getSupabaseClient(requestedClientId);
    if (!client) return sendError(res, 404, 'Cliente no encontrado');

    if (req.method === 'PATCH' && segments.length === 3) {
      const payload = {
        name: body.name === undefined ? client.name : String(body.name).trim(),
        company: body.company === undefined ? client.company : String(body.company).trim(),
        email: body.email === undefined ? client.email : String(body.email).trim(),
        ownerId: body.ownerId === undefined ? client.ownerId || '' : String(body.ownerId),
        status: body.status === undefined ? client.status || 'Activo' : String(body.status || 'Activo').trim(),
        consultor: body.consultor === undefined ? client.consultor || '' : String(body.consultor || '').trim(),
        complexity: body.complexity === undefined ? client.complexity || '' : String(body.complexity || '').trim(),
        adStatus: body.adStatus === undefined ? client.adStatus || '' : String(body.adStatus || '').trim(),
        meliUser: body.meliUser === undefined ? client.meliUser || '' : String(body.meliUser || '').trim(),
        meetingDay: body.meetingDay === undefined ? client.meetingDay : parseMeetingDay(body.meetingDay),
        meetingTime: body.meetingTime === undefined ? client.meetingTime : parseMeetingTime(body.meetingTime),
        meetingFrequency: body.meetingFrequency === undefined ? client.meetingFrequency : parseMeetingFrequency(body.meetingFrequency)
      };
      if (!payload.name || !payload.company) return sendError(res, 400, 'Nombre y empresa son obligatorios');
      const [statusId, consultorId, complexityId, adStatusId] = await Promise.all([
        getStatusIdByName(payload.status),
        getConsultorIdByName(payload.consultor),
        getComplexityIdByName(payload.complexity),
        getAdStatusIdByName(payload.adStatus)
      ]);
      await supabaseRest(`/clients?id=eq.${encodeURIComponent(client.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          name: payload.name,
          company: payload.company,
          email: payload.email || null,
          owner_id: payload.ownerId || null,
          status_id: statusId,
          consultor_id: consultorId,
          complexity_id: complexityId,
          ad_status_id: adStatusId,
          meli_user: payload.meliUser || null,
          meeting_day: payload.meetingDay,
          meeting_time: payload.meetingTime,
          meeting_frequency: payload.meetingFrequency
        })
      });
      recordAuditInBackground(body, `Modifico el cliente "${client.name}"`);
      return sendJson(res, 200, { client: { id: client.id, ...payload } });
    }

    if (req.method === 'POST' && segments[3] === 'time-bank' && segments[4] === 'reset') {
      await supabaseRest('/rpc/reset_client_time_bank', {
        method: 'POST',
        body: JSON.stringify({ p_client_id: client.id })
      });
      recordAuditInBackground(body, `Reinicio el banco de tiempo de "${client.name}"`);
      return sendJson(res, 200, { timeBankSeconds: 0 });
    }

    if (req.method === 'POST' && segments[3] === 'links' && segments.length === 4) {
      const linkUrl = String(body.url || '').trim();
      const label = String(body.label || '').trim();
      if (!linkUrl || !label) return sendError(res, 400, 'URL y descripcion son obligatorios');
      const link = { id: makeId('lnk'), url: linkUrl, label };
      await supabaseRest('/client_links', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ id: link.id, client_id: client.id, url: link.url, label: link.label }])
      });
      return sendJson(res, 201, { link });
    }

    if (req.method === 'DELETE' && segments[3] === 'links' && segments[4]) {
      const linkId = segments[4];
      await supabaseRest(`/client_links?id=eq.${encodeURIComponent(linkId)}&client_id=eq.${encodeURIComponent(client.id)}`, { method: 'DELETE' });
      return sendJson(res, 200, { deleted: true });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/general-links') {
    const linkUrl = String(body.url || '').trim();
    const label = String(body.label || '').trim();
    if (!linkUrl || !label) return sendError(res, 400, 'URL y descripcion son obligatorios');
    const link = { id: makeId('gl'), url: linkUrl, label };
    await supabaseRest('/general_links', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ id: link.id, url: link.url, label: link.label }])
    });
    return sendJson(res, 201, { link });
  }

  if (req.method === 'DELETE' && segments[0] === 'api' && segments[1] === 'general-links' && segments[2]) {
    const linkId = segments[2];
    await supabaseRest(`/general_links?id=eq.${encodeURIComponent(linkId)}`, { method: 'DELETE' });
    return sendJson(res, 200, { deleted: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/boards') {
    const name = String(body.name || '').trim();
    if (!name) return sendError(res, 400, 'El nombre es obligatorio');
    const board = {
      id: makeId('b'),
      name,
      color: '#2b52ff',
      columns: [{ id: makeId('c'), name: 'Pendiente', showTimer: false }],
      cards: []
    };
    await supabaseRest('/boards', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ id: board.id, name: board.name, color: board.color, position: await getNextBoardPosition() }])
    });
    await supabaseRest('/board_columns', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ id: board.columns[0].id, board_id: board.id, name: board.columns[0].name, show_timer: false, position: 1 }])
    });
    recordAuditInBackground(body, `Creo el tablero "${name}"`);
    return sendJson(res, 201, { board });
  }

  if (segments[0] === 'api' && segments[1] === 'boards' && segments[2]) {
    const board = await getSupabaseBoard(segments[2]);
    if (!board) return sendError(res, 404, 'Tablero no encontrado');

    if (req.method === 'PATCH' && segments.length === 3) {
      const name = String(body.name || '').trim();
      if (!name) return sendError(res, 400, 'El nombre es obligatorio');
      await supabaseRest(`/boards?id=eq.${encodeURIComponent(board.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name })
      });
      recordAuditInBackground(body, `Renombro el tablero "${board.name}" a "${name}"`);
      return sendJson(res, 200, { board: { ...board, name } });
    }

    if (req.method === 'DELETE' && segments.length === 3) {
      const boards = await supabaseRest('/boards?select=id,name,color&order=position.asc');
      if (boards.length <= 1) return sendError(res, 400, 'Debe conservarse al menos un tablero');
      await supabaseRest(`/boards?id=eq.${encodeURIComponent(board.id)}`, { method: 'DELETE' });
      recordAuditInBackground(body, `Elimino el tablero "${board.name}"`);
      return sendJson(res, 200, { boards: boards.filter((item) => item.id !== board.id) });
    }

    if (req.method === 'POST' && segments[3] === 'columns') {
      const name = String(body.name || '').trim();
      if (!name) return sendError(res, 400, 'El nombre es obligatorio');
      const column = { id: makeId('c'), name, showTimer: Boolean(body.showTimer) };
      await supabaseRest('/board_columns', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          id: column.id,
          board_id: board.id,
          name: column.name,
          show_timer: column.showTimer,
          position: await getNextColumnPosition(board.id)
        }])
      });
      board.columns.push(column);
      recordAuditInBackground(body, `Creo la columna "${name}" en "${board.name}"`);
      return sendJson(res, 201, { column, board });
    }

    if (req.method === 'POST' && segments[3] === 'recurring-tasks') {
      const title = String(body.title || '').trim();
      const startDate = String(body.startDate || '');
      const endDate = String(body.endDate || '');
      const scheduledDays = Array.isArray(body.days) ? body.days : [];
      if (!title) return sendError(res, 400, 'El titulo es obligatorio');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return sendError(res, 400, 'La fecha de inicio es obligatoria');
      if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate)) {
        return sendError(res, 400, 'La fecha de fin no puede ser anterior al inicio');
      }
      const normalizedDays = scheduledDays.map((day) => ({
        weekday: Number(day.weekday),
        columnId: String(day.columnId || '')
      }));
      if (!normalizedDays.length) return sendError(res, 400, 'Selecciona al menos un dia');
      if (new Set(normalizedDays.map((day) => day.weekday)).size !== normalizedDays.length) {
        return sendError(res, 400, 'No se puede repetir un dia de la semana');
      }
      if (normalizedDays.some((day) => !Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 7 || !board.columns.some((column) => column.id === day.columnId))) {
        return sendError(res, 400, 'La configuracion de dias o columnas es invalida');
      }
      const recurringTask = {
        id: makeId('rt'),
        boardId: board.id,
        clientId: String(body.clientId || ''),
        title,
        description: String(body.description || '').trim(),
        assignedTo: String(body.assignedTo || ''),
        createdBy: apiUser.id,
        startDate,
        endDate
      };
      await supabaseRest('/recurring_tasks', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          id: recurringTask.id,
          board_id: recurringTask.boardId,
          client_id: recurringTask.clientId || null,
          title: recurringTask.title,
          description: recurringTask.description,
          assigned_to: recurringTask.assignedTo || null,
          created_by: recurringTask.createdBy,
          start_date: recurringTask.startDate,
          end_date: recurringTask.endDate || null
        }])
      });
      try {
        await supabaseRest('/recurring_task_days', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(normalizedDays.map((day) => ({
            recurring_task_id: recurringTask.id,
            weekday: day.weekday,
            column_id: day.columnId
          })))
        });
      } catch (error) {
        await supabaseRest(`/recurring_tasks?id=eq.${encodeURIComponent(recurringTask.id)}`, { method: 'DELETE' });
        throw error;
      }
      await generateRecurringCardsThroughToday();
      recordAuditInBackground(body, `Creo la tarea recurrente "${title}" en "${board.name}"`);
      return sendJson(res, 201, { recurringTask });
    }

    if (req.method === 'DELETE' && segments[3] === 'recurring-tasks' && segments[4]) {
      const recurringTaskId = segments[4];
      const tasks = await supabaseRest(`/recurring_tasks?select=id,title&board_id=eq.${encodeURIComponent(board.id)}&id=eq.${encodeURIComponent(recurringTaskId)}&limit=1`);
      if (!tasks[0]) return sendError(res, 404, 'Tarea recurrente no encontrada');
      await supabaseRest(`/recurring_tasks?id=eq.${encodeURIComponent(recurringTaskId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false })
      });
      recordAuditInBackground(body, `Detuvo la tarea recurrente "${tasks[0].title}" en "${board.name}"`);
      return sendJson(res, 200, { stopped: true });
    }

    if (req.method === 'PATCH' && segments[3] === 'columns' && segments[4] === 'order') {
      const columnIds = Array.isArray(body.columnIds) ? body.columnIds : [];
      if (columnIds.length !== board.columns.length) return sendError(res, 400, 'Orden de columnas invalido');
      const offset = 10000;
      await Promise.all(columnIds.map((id, index) => supabaseRest(`/board_columns?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ position: index + 1 + offset })
      })));
      await Promise.all(columnIds.map((id, index) => supabaseRest(`/board_columns?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ position: index + 1 })
      })));
      board.columns = columnIds.map((id) => board.columns.find((column) => column.id === id)).filter(Boolean);
      recordAuditInBackground(body, `Reordeno columnas en "${board.name}"`);
      return sendJson(res, 200, { board });
    }

    if (req.method === 'DELETE' && segments[3] === 'columns' && segments[4]) {
      const columnId = segments[4];
      if (board.columns.length <= 1) return sendError(res, 400, 'Debe conservarse al menos una columna');
      if (board.cards.some((card) => card.columnId === columnId)) return sendError(res, 400, 'La columna contiene tarjetas');
      const recurringUses = await supabaseRest(`/recurring_task_days?select=recurring_task_id&column_id=eq.${encodeURIComponent(columnId)}&limit=1`);
      if (recurringUses.length) return sendError(res, 400, 'La columna esta configurada en una tarea recurrente');
      const column = board.columns.find((item) => item.id === columnId);
      await supabaseRest(`/board_columns?id=eq.${encodeURIComponent(columnId)}`, { method: 'DELETE' });
      board.columns = board.columns.filter((column) => column.id !== columnId);
      recordAuditInBackground(body, `Elimino la columna "${column?.name || columnId}" de "${board.name}"`);
      return sendJson(res, 200, { board });
    }

    if (req.method === 'POST' && segments[3] === 'cards') {
      const title = String(body.title || '').trim();
      if (!title) return sendError(res, 400, 'El titulo es obligatorio');
      const card = {
        id: makeId('k'),
        columnId: String(body.columnId || ''),
        clientId: String(body.clientId || ''),
        title,
        description: String(body.description || '').trim(),
        dueDate: String(body.dueDate || ''),
        createdBy: String(body.createdBy || ''),
        assignedTo: String(body.assignedTo || ''),
        enteredColumnAt: Date.now()
      };
      if (!board.columns.some((column) => column.id === card.columnId)) return sendError(res, 400, 'Columna invalida');
      await supabaseRest('/cards', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          id: card.id,
          board_id: board.id,
          column_id: card.columnId,
          client_id: card.clientId || null,
          title: card.title,
          description: card.description,
          due_date: card.dueDate || null,
          created_by: card.createdBy || null,
          assigned_to: card.assignedTo || null,
          entered_column_at: new Date(card.enteredColumnAt).toISOString()
        }])
      });
      board.cards.push(card);
      recordAuditInBackground(body, `Creo la tarjeta "${title}" en "${board.name}"`);
      return sendJson(res, 201, { card, board });
    }

    if (req.method === 'PATCH' && segments[3] === 'cards' && segments[4]) {
      const card = board.cards.find((item) => item.id === segments[4]);
      if (!card) return sendError(res, 404, 'Tarjeta no encontrada');
      const previousColumnId = card.columnId;
      const previousTitle = card.title;
      Object.assign(card, {
        title: body.title === undefined ? card.title : String(body.title).trim(),
        clientId: body.clientId === undefined ? card.clientId : String(body.clientId),
        description: body.description === undefined ? card.description : String(body.description).trim(),
        dueDate: body.dueDate === undefined ? card.dueDate : String(body.dueDate),
        assignedTo: body.assignedTo === undefined ? card.assignedTo : String(body.assignedTo),
        columnId: body.columnId === undefined ? card.columnId : String(body.columnId)
      });
      if (!card.title) return sendError(res, 400, 'El titulo es obligatorio');
      if (!board.columns.some((column) => column.id === card.columnId)) return sendError(res, 400, 'Columna invalida');
      if (previousColumnId !== card.columnId) card.enteredColumnAt = Date.now();
      await supabaseRest(`/cards?id=eq.${encodeURIComponent(card.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          column_id: card.columnId,
          client_id: card.clientId || null,
          title: card.title,
          description: card.description,
          due_date: card.dueDate || null,
          assigned_to: card.assignedTo || null,
          entered_column_at: new Date(card.enteredColumnAt).toISOString()
        })
      });
      if (previousColumnId !== card.columnId) {
        const fromColumn = board.columns.find((column) => column.id === previousColumnId);
        const toColumn = board.columns.find((column) => column.id === card.columnId);
        recordAuditInBackground(body, `Movio la tarjeta "${card.title}" de "${fromColumn?.name || previousColumnId}" a "${toColumn?.name || card.columnId}"`);
      } else {
        recordAuditInBackground(body, `Modifico la tarjeta "${previousTitle}" en "${board.name}"`);
      }
      return sendJson(res, 200, { card, board });
    }

    if (req.method === 'DELETE' && segments[3] === 'cards' && segments[4]) {
      const card = board.cards.find((item) => item.id === segments[4]);
      await supabaseRest(`/cards?id=eq.${encodeURIComponent(segments[4])}`, { method: 'DELETE' });
      board.cards = board.cards.filter((card) => card.id !== segments[4]);
      recordAuditInBackground(body, `Elimino la tarjeta "${card?.title || segments[4]}" de "${board.name}"`);
      return sendJson(res, 200, { board });
    }
  }

  // --- Client Monthly Metrics API ---

  if (req.method === 'GET' && url.pathname === '/api/client-monthly-metrics') {
    const clientId = url.searchParams.get('clientId');
    const year = url.searchParams.get('year');
    let filter = '';
    if (clientId) filter += `&client_id=eq.${encodeURIComponent(clientId)}`;
    if (year) filter += `&year=eq.${encodeURIComponent(year)}`;
    const rows = await supabaseRest(`/client_monthly_metrics?select=id,client_id,year,month,metric_type,value&order=year.asc,month.asc${filter}`);
    return sendJson(res, 200, { metrics: rows.map(r => ({ id: r.id, clientId: r.client_id, year: r.year, month: r.month, metricType: r.metric_type, value: r.value })) });
  }

  if (req.method === 'POST' && url.pathname === '/api/client-monthly-metrics') {
    const { clientId, year, month, metrics } = body;
    if (!clientId || !year || !month || !Array.isArray(metrics)) return sendError(res, 400, 'clientId, year, month y metrics son requeridos');
    // Delete existing for this client/year/month, then insert
    await supabaseRest(`/client_monthly_metrics?client_id=eq.${encodeURIComponent(clientId)}&year=eq.${year}&month=eq.${month}`, { method: 'DELETE' });
    const rows = metrics.filter(m => m.value != null).map(m => ({
      id: makeId('cmm'), client_id: clientId, year, month, metric_type: m.metricType, value: m.value
    }));
    if (rows.length) {
      await supabaseRest('/client_monthly_metrics', { method: 'POST', body: JSON.stringify(rows) });
    }
    return sendJson(res, 200, { ok: true });
  }

  // --- Weekly Reports API ---

  if (req.method === 'GET' && url.pathname === '/api/weekly-reports') {
    const rows = await supabaseRest('/weekly_reports?select=id,week_label,status,created_at,created_by&order=created_at.desc');
    return sendJson(res, 200, { reports: rows.map(r => ({ id: r.id, weekLabel: r.week_label, status: r.status, createdAt: r.created_at, createdBy: r.created_by })) });
  }

  if (req.method === 'POST' && url.pathname === '/api/weekly-reports') {
    const weekLabel = String(body.weekLabel || '').trim();
    if (!weekLabel) return sendError(res, 400, 'weekLabel es requerido');
    const id = makeId('wr');
    const daysElapsed = Number(body.daysElapsed) || 25;
    await supabaseRest('/weekly_reports', {
      method: 'POST',
      body: JSON.stringify({ id, week_label: weekLabel, days_elapsed: daysElapsed, created_by: apiUser.id })
    });
    return sendJson(res, 201, { report: { id, weekLabel, status: 'draft', daysElapsed, createdBy: apiUser.id } });
  }

  if (segments[1] === 'weekly-reports' && segments[2] && !segments[3]) {
    const reportId = segments[2];

    if (req.method === 'GET') {
      const reports = await supabaseRest(`/weekly_reports?id=eq.${encodeURIComponent(reportId)}`);
      if (!reports.length) return sendError(res, 404, 'Report no encontrado');
      const report = reports[0];
      const clientData = await supabaseRest(`/weekly_client_data?weekly_report_id=eq.${encodeURIComponent(reportId)}`);

      // Derive week range from weekLabel (format: "DD/MM - DD/MM" or "DD/MM/YYYY - DD/MM/YYYY")
      let calendarEvents = [];
      try {
        const labelParts = (report.week_label || '').split('-').map(s => s.trim());
        if (labelParts.length === 2) {
          const parsePart = (part) => {
            const nums = part.split('/').map(Number);
            if (nums.length === 3) return `${nums[2]}-${String(nums[1]).padStart(2, '0')}-${String(nums[0]).padStart(2, '0')}`;
            if (nums.length === 2) {
              const year = new Date().getFullYear();
              return `${year}-${String(nums[1]).padStart(2, '0')}-${String(nums[0]).padStart(2, '0')}`;
            }
            return null;
          };
          const rangeStart = parsePart(labelParts[0]);
          const rangeEnd = parsePart(labelParts[1]);
          if (rangeStart && rangeEnd && isDateString(rangeStart) && isDateString(rangeEnd)) {
            const [events, eventUsers, eventExceptions] = await Promise.all([
              supabaseRest('/calendar_events?select=id,title,client_id,starts_at,duration_minutes,notes,recurrence_unit,recurrence_interval,recurrence_until'),
              supabaseRest('/calendar_event_users?select=event_id,user_id'),
              supabaseRest('/calendar_event_exceptions?select=id,event_id,occurrence_starts_at,replacement_starts_at,replacement_duration_minutes,cancelled')
            ]);
            calendarEvents = events.flatMap(event => expandCalendarEvent(event, rangeStart, rangeEnd, eventUsers, eventExceptions))
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          }
        }
      } catch { /* ignore calendar errors */ }

      return sendJson(res, 200, {
        report: {
          id: report.id, weekLabel: report.week_label, status: report.status,
          daysElapsed: report.days_elapsed, notes: report.notes, meetings: report.meetings,
          createdAt: report.created_at, createdBy: report.created_by
        },
        clientData: clientData.map(d => ({
          id: d.id, clientId: d.client_id, metricType: d.metric_type,
          currentValue: d.current_value, previousValue: d.previous_value, ytdValue: d.ytd_value
        })),
        calendarEvents
      });
    }

    if (req.method === 'PATCH') {
      const reports = await supabaseRest(`/weekly_reports?id=eq.${encodeURIComponent(reportId)}`);
      if (!reports.length) return sendError(res, 404, 'Report no encontrado');
      if (reports[0].status === 'final') return sendError(res, 400, 'No se puede editar un report finalizado');
      const updates = { updated_at: new Date().toISOString() };
      if (body.daysElapsed !== undefined) updates.days_elapsed = Number(body.daysElapsed);
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.meetings !== undefined) updates.meetings = body.meetings;
      await supabaseRest(`/weekly_reports?id=eq.${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      if (Array.isArray(body.clientData)) {
        await supabaseRest(`/weekly_client_data?weekly_report_id=eq.${encodeURIComponent(reportId)}`, { method: 'DELETE' });
        const rows = body.clientData.filter(d => d.currentValue != null || d.previousValue != null || d.ytdValue != null).map(d => ({
          id: d.id || makeId('wcd'), weekly_report_id: reportId, client_id: d.clientId,
          metric_type: d.metricType, current_value: d.currentValue ?? null,
          previous_value: d.previousValue ?? null, ytd_value: d.ytdValue ?? null
        }));
        if (rows.length) {
          await supabaseRest('/weekly_client_data', {
            method: 'POST',
            body: JSON.stringify(rows)
          });
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await supabaseRest(`/weekly_reports?id=eq.${encodeURIComponent(reportId)}`, { method: 'DELETE' });
      return sendJson(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && segments[1] === 'weekly-reports' && segments[2] && segments[3] === 'finalize') {
    const reportId = segments[2];
    const reports = await supabaseRest(`/weekly_reports?id=eq.${encodeURIComponent(reportId)}`);
    if (!reports.length) return sendError(res, 404, 'Report no encontrado');
    if (reports[0].status === 'final') return sendError(res, 400, 'Ya esta finalizado');
    await supabaseRest(`/weekly_reports?id=eq.${encodeURIComponent(reportId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'final', updated_at: new Date().toISOString() })
    });
    return sendJson(res, 200, { ok: true });
  }

  sendError(res, 404, 'Ruta no encontrada');
}

async function serveStatic(req, res, url) {
  const routeFile = {
    '/': 'login.html',
    '/login': 'login.html',
    '/kanban': 'kanban.html',
    '/dashboard': 'dashboard.html',
    '/configuracion': 'configuracion.html',
    '/tableros': 'tableros.html',
    '/calendarios': 'calendarios.html',
    '/templates': 'templates.html',
    '/weekly': 'weekly.html',
    '/usuarios': 'usuarios.html'
  }[url.pathname];
  const requestedPath = routeFile ? path.join(publicDir, routeFile) : path.join(publicDir, url.pathname);
  const normalizedPath = path.normalize(requestedPath);

  if (!normalizedPath.startsWith(publicDir) || !existsSync(normalizedPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(normalizedPath);
  res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
  res.end(await readFile(normalizedPath));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendError(res, 500, 'Error interno');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${port} ya esta en uso. Proba con: PORT=3001 npm run dev`);
    process.exit(1);
  }
  throw error;
});

await loadEnv();
ensureSupabaseConfig();

server.listen(port, () => {
  console.log(`Registro Ganar v0 listo en http://localhost:${port}`);
});
