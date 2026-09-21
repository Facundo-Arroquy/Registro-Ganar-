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

async function getSupabaseState() {
  const [users, statuses, consultors, complexities, adStatuses, auditRows, clients, boards, columns, cards, clientLinks, generalLinks] = await Promise.all([
    supabaseRest('/app_users?select=id,email,name&order=name.asc'),
    getSupabaseStatuses(),
    getSupabaseConsultors(),
    getSupabaseComplexities(),
    getSupabaseAdStatuses(),
    supabaseRest('/settings_audit?select=action,user_id,user_name,created_at&order=created_at.desc&limit=50'),
    supabaseRest('/clients?select=id,name,company,email,owner_id,status_id,consultor_id,complexity_id,ad_status_id,meli_user,meeting_day,meeting_time,meeting_frequency'),
    supabaseRest('/boards?select=id,name,color,position&order=position.asc'),
    supabaseRest('/board_columns?select=id,board_id,name,show_timer,position&order=position.asc'),
    supabaseRest('/cards?select=id,board_id,column_id,client_id,title,description,due_date,created_by,assigned_to,entered_column_at'),
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
        enteredColumnAt: card.entered_column_at ? new Date(card.entered_column_at).getTime() : Date.now()
      }))
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
  const [client] = await supabaseRest(`/clients?select=id,name,company,email,owner_id,meeting_day,meeting_time,meeting_frequency,complexity_id,ad_status_id,meli_user,status:client_statuses(name),consultor:client_consultors(name),complexity:complexities(name),ad_status:ad_statuses(name)&id=eq.${encodeURIComponent(clientId)}&limit=1`);
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
    meetingFrequency: client.meeting_frequency ?? null
  };
}

async function getSupabaseBoard(boardId) {
  const encodedId = encodeURIComponent(boardId);
  const [[board], columns, cards] = await Promise.all([
    supabaseRest(`/boards?select=id,name,color&id=eq.${encodedId}&limit=1`),
    supabaseRest(`/board_columns?select=id,name,show_timer&board_id=eq.${encodedId}&order=position.asc`),
    supabaseRest(`/cards?select=id,column_id,client_id,title,description,due_date,created_by,assigned_to,entered_column_at&board_id=eq.${encodedId}`)
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

  sendError(res, 404, 'Ruta no encontrada');
}

async function serveStatic(req, res, url) {
  const routeFile = {
    '/': 'login.html',
    '/login': 'login.html',
    '/kanban': 'kanban.html',
    '/dashboard': 'dashboard.html',
    '/configuracion': 'configuracion.html'
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
