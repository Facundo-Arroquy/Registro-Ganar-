import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dbPath = path.join(__dirname, 'data', 'db.json');
const port = Number(process.env.PORT || 3000);
let statusWriteQueue = Promise.resolve();
let supportsStatusColor = true;
const defaultStatusColors = {
  Activo: '#3fb950',
  'En pausa': '#d29922',
  Riesgo: '#f85149',
  Cerrado: '#8b949e'
};

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

async function readDb() {
  return JSON.parse(await readFile(dbPath, 'utf8'));
}

async function writeDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

async function tryWriteDb(db) {
  try {
    await writeDb(db);
  } catch (error) {
    console.warn('Skipping db persistence:', error.code || error.message);
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

function hasSupabaseAuth() {
  return Boolean(getSupabaseUrl() && getSupabaseServiceRoleKey());
}

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
}

function getSupabaseServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
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
  const [users, statuses, auditRows, clients, boards, columns, cards] = await Promise.all([
    supabaseRest('/app_users?select=id,email,name&order=name.asc'),
    getSupabaseStatuses(),
    supabaseRest('/settings_audit?select=action,user_id,user_name,created_at&order=created_at.desc&limit=50'),
    supabaseRest('/clients?select=id,name,company,email,owner_id,status_id'),
    supabaseRest('/boards?select=id,name,color,position&order=position.asc'),
    supabaseRest('/board_columns?select=id,board_id,name,show_timer,position&order=position.asc'),
    supabaseRest('/cards?select=id,board_id,column_id,client_id,title,description,due_date,created_by,assigned_to,entered_column_at')
  ]);
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  return {
    users: users.map(publicUser),
    settings: {
      clientStatuses: statuses.map((status) => normalizeStatus({ name: status.name, color: status.color })),
      lastConfigChange: auditRows[0] ? mapAuditRow(auditRows[0]) : null,
      configChanges: auditRows.map(mapAuditRow)
    },
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      company: client.company,
      email: client.email || '',
      ownerId: client.owner_id || '',
      status: statusById.get(client.status_id)?.name || 'Activo'
    })),
    boards: boards.map((board) => ({
      id: board.id,
      name: board.name,
      color: board.color || '#2b52ff',
      columns: columns
        .filter((column) => column.board_id === board.id)
        .map((column) => ({
          id: column.id,
          name: column.name,
          showTimer: Boolean(column.show_timer)
        })),
      cards: cards
        .filter((card) => card.board_id === board.id)
        .map((card) => ({
          id: card.id,
          columnId: card.column_id,
          clientId: card.client_id || '',
          title: card.title,
          description: card.description || '',
          dueDate: card.due_date || '',
          createdBy: card.created_by || '',
          assignedTo: card.assigned_to || '',
          enteredColumnAt: new Date(card.entered_column_at).getTime()
        }))
    }))
  };
}

function mapAuditRow(row) {
  return {
    action: row.action,
    userId: row.user_id || '',
    userName: row.user_name || 'Usuario',
    at: row.created_at
  };
}

async function getStatusIdByName(statusName) {
  const statuses = await supabaseRest(`/client_statuses?select=id,name&name=eq.${encodeURIComponent(statusName || 'Activo')}&limit=1`);
  if (statuses[0]) return statuses[0].id;
  const fallback = await supabaseRest('/client_statuses?select=id,name&order=position.asc&limit=1');
  return fallback[0]?.id;
}

async function getNextColumnPosition(boardId) {
  const columns = await supabaseRest(`/board_columns?select=position&board_id=eq.${encodeURIComponent(boardId)}&order=position.desc&limit=1`);
  return Number(columns[0]?.position || 0) + 1;
}

async function getNextStatusPosition() {
  const statuses = await supabaseRest('/client_statuses?select=position&order=position.desc&limit=1');
  return Number(statuses[0]?.position || 0) + 1;
}

async function getSupabaseStatuses() {
  if (!supportsStatusColor) {
    return supabaseRest('/client_statuses?select=id,name,position&order=position.asc');
  }
  try {
    return await supabaseRest('/client_statuses?select=id,name,position,color&order=position.asc');
  } catch (error) {
    if (!/color/i.test(error.message)) throw error;
    supportsStatusColor = false;
    return supabaseRest('/client_statuses?select=id,name,position&order=position.asc');
  }
}

function statusWritePayload(payload) {
  if (!supportsStatusColor) {
    const { color, ...rest } = payload;
    return rest;
  }
  return payload;
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

async function getSupabaseSettings() {
  return (await getSupabaseState()).settings;
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
  return supabaseRequest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    })
  });
}

async function getSupabaseUserFromToken(accessToken) {
  const response = await fetch(`${getSupabaseUrl()}/auth/v1/user`, {
    headers: {
      apikey: getSupabaseServiceRoleKey(),
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id || !data.email) return null;
  return data;
}

async function requireApiUser(req, res, db) {
  if (!hasSupabaseAuth()) {
    sendError(res, 503, 'Supabase Auth no esta configurado');
    return null;
  }
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    sendError(res, 401, 'Sesion requerida');
    return null;
  }
  const authUser = await getSupabaseUserFromToken(match[1]);
  if (!authUser) {
    sendError(res, 401, 'Sesion invalida');
    return null;
  }
  await syncSupabaseAppUser(authUser);
  const user = syncLocalUser(db, authUser);
  return user;
}

function syncLocalUser(db, authUser, fallbackName = '') {
  const email = String(authUser.email || '').trim().toLowerCase();
  const name = String(authUser.user_metadata?.name || fallbackName || email.split('@')[0] || 'Usuario').trim();
  let user = db.users.find((candidate) => candidate.id === authUser.id || candidate.email.toLowerCase() === email);
  if (user) {
    user.id = authUser.id || user.id;
    user.email = email || user.email;
    user.name = name || user.name;
    delete user.password;
    return user;
  }
  user = { id: authUser.id, email, name };
  db.users.push(user);
  return user;
}

function findBoard(db, boardId) {
  return db.boards.find((board) => board.id === boardId);
}

function ensureSettings(db) {
  db.settings = db.settings || {};
  db.settings.clientStatuses = Array.isArray(db.settings.clientStatuses) && db.settings.clientStatuses.length
    ? db.settings.clientStatuses.map(normalizeStatus)
    : ['Activo', 'En pausa', 'Riesgo', 'Cerrado'].map(normalizeStatus);
  db.settings.lastConfigChange = db.settings.lastConfigChange || null;
  db.settings.configChanges = Array.isArray(db.settings.configChanges)
    ? db.settings.configChanges
    : (db.settings.lastConfigChange ? [db.settings.lastConfigChange] : []);
}

function normalizeStatus(status) {
  if (typeof status === 'string') {
    return { name: status, color: defaultStatusColors[status] || '#388bfd' };
  }
  const name = String(status?.name || '').trim();
  const color = isHexColor(status?.color) ? status.color : defaultStatusColors[name] || '#388bfd';
  return { name, color };
}

function getStatusName(status) {
  return typeof status === 'string' ? status : status?.name;
}

function isHexColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(String(color || ''));
}

function recordConfigChange(db, body, action) {
  const user = db.users.find((item) => item.id === body.userId);
  const change = {
    action,
    userId: user?.id || String(body.userId || ''),
    userName: user?.name || String(body.userName || 'Usuario'),
    at: new Date().toISOString()
  };
  db.settings.lastConfigChange = change;
  db.settings.configChanges = [change, ...(db.settings.configChanges || [])].slice(0, 50);
}

async function enqueueStatusWrite(operation) {
  const result = statusWriteQueue.then(operation, operation);
  statusWriteQueue = result.catch(() => {});
  return result;
}

async function handleApi(req, res, url) {
  const db = await readDb();
  ensureSettings(db);
  const body = req.method === 'GET' ? {} : await readBody(req);
  const segments = url.pathname.split('/').filter(Boolean);

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (hasSupabaseAuth()) {
      try {
        const auth = await signInWithSupabase(email, password);
        const nextDb = await readDb();
        ensureSettings(nextDb);
        await syncSupabaseAppUser(auth.user);
        const user = syncLocalUser(nextDb, auth.user);
        await tryWriteDb(nextDb);
        return sendJson(res, 200, { user: publicUser(user), accessToken: auth.access_token });
      } catch (error) {
        console.error('Supabase login failed:', error.message);
        return sendError(res, 401, 'Credenciales invalidas');
      }
    }
    return sendError(res, 503, 'Supabase Auth no esta configurado');
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

  const apiUser = await requireApiUser(req, res, db);
  if (!apiUser) return;

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    if (hasSupabaseAuth()) {
      return sendJson(res, 200, await getSupabaseState());
    }
    await tryWriteDb(db);
    return sendJson(res, 200, {
      users: db.users.map(publicUser),
      clients: db.clients,
      boards: db.boards,
      settings: db.settings
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/client-statuses') {
    return enqueueStatusWrite(async () => {
      const status = String(body.status || '').trim();
      const color = isHexColor(body.color) ? String(body.color) : '#388bfd';
      if (!status) return sendError(res, 400, 'El estado es obligatorio');
      if (hasSupabaseAuth()) {
        const statuses = await getSupabaseStatuses();
        if (statuses.some((item) => item.name.toLowerCase() === status.toLowerCase())) {
          return sendError(res, 400, 'Ese estado ya existe');
        }
        await supabaseRest('/client_statuses', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify([statusWritePayload({ name: status, color, position: await getNextStatusPosition() })])
        });
        await recordSupabaseAudit(body, `Agrego el estado "${status}"`);
        return sendJson(res, 201, { settings: await getSupabaseSettings() });
      }
      const nextDb = await readDb();
      ensureSettings(nextDb);
      if (nextDb.settings.clientStatuses.some((item) => getStatusName(item).toLowerCase() === status.toLowerCase())) {
        return sendError(res, 400, 'Ese estado ya existe');
      }
      nextDb.settings.clientStatuses.push({ name: status, color });
      recordConfigChange(nextDb, body, `Agrego el estado "${status}"`);
      await writeDb(nextDb);
      return sendJson(res, 201, { settings: nextDb.settings });
    });
  }

  if (segments[0] === 'api' && segments[1] === 'settings' && segments[2] === 'client-statuses' && segments[3]) {
    const index = Number(segments[3]);
    if (!Number.isInteger(index) || index < 0) {
      return sendError(res, 404, 'Estado no encontrado');
    }

    if (req.method === 'PATCH') {
      return enqueueStatusWrite(async () => {
        if (hasSupabaseAuth()) {
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
          await recordSupabaseAudit(body, `Edito el estado "${statusRow.name}" a "${nextStatus}"`);
          return sendJson(res, 200, { settings: await getSupabaseSettings() });
        }
        const nextDb = await readDb();
        ensureSettings(nextDb);
        if (index < 0 || index >= nextDb.settings.clientStatuses.length) {
          return sendError(res, 404, 'Estado no encontrado');
        }
        const previousStatus = getStatusName(nextDb.settings.clientStatuses[index]);
        const nextStatus = String(body.status || '').trim();
        const nextColor = isHexColor(body.color) ? String(body.color) : nextDb.settings.clientStatuses[index].color;
        if (!nextStatus) return sendError(res, 400, 'El estado es obligatorio');
        const duplicateStatus = nextDb.settings.clientStatuses.some((item, itemIndex) => (
          itemIndex !== index && getStatusName(item).toLowerCase() === nextStatus.toLowerCase()
        ));
        if (duplicateStatus) return sendError(res, 400, 'Ese estado ya existe');
        nextDb.settings.clientStatuses[index] = { name: nextStatus, color: nextColor };
        nextDb.clients.forEach((client) => {
          if (client.status === previousStatus) client.status = nextStatus;
        });
        recordConfigChange(nextDb, body, `Edito el estado "${previousStatus}" a "${nextStatus}"`);
        await writeDb(nextDb);
        return sendJson(res, 200, { settings: nextDb.settings });
      });
    }

    if (req.method === 'DELETE') {
      return enqueueStatusWrite(async () => {
        if (hasSupabaseAuth()) {
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
          await recordSupabaseAudit(body, `Saco el estado "${statusRow.name}"`);
          return sendJson(res, 200, { settings: await getSupabaseSettings() });
        }
        const nextDb = await readDb();
        ensureSettings(nextDb);
        if (index < 0 || index >= nextDb.settings.clientStatuses.length) {
          return sendError(res, 404, 'Estado no encontrado');
        }
        if (nextDb.settings.clientStatuses.length <= 1) return sendError(res, 400, 'Debe conservarse al menos un estado');
        const [removedStatusItem] = nextDb.settings.clientStatuses.splice(index, 1);
        const removedStatus = getStatusName(removedStatusItem);
        const fallbackStatus = getStatusName(nextDb.settings.clientStatuses[0]);
        nextDb.clients.forEach((client) => {
          if (client.status === removedStatus) client.status = fallbackStatus;
        });
        recordConfigChange(nextDb, body, `Saco el estado "${removedStatus}"`);
        await writeDb(nextDb);
        return sendJson(res, 200, { settings: nextDb.settings });
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/users/invitations') {
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || email.split('@')[0] || '').trim();
    const password = String(body.password || '');
    if (!email) return sendError(res, 400, 'El email es obligatorio');
    const existing = hasSupabaseAuth()
      ? await getSupabaseAppUserByEmail(email)
      : db.users.find((user) => user.email.toLowerCase() === email);
    if (existing) return sendJson(res, 200, { user: publicUser(existing), invited: false });
    if (hasSupabaseAuth() && password.length < 6) return sendError(res, 400, 'La contrasena debe tener al menos 6 caracteres');
    let user = { id: makeId('u'), email, password: '******', name };
    if (hasSupabaseAuth()) {
      try {
        const auth = await createSupabaseUser({ email, password, name });
        await syncSupabaseAppUser(auth.user, name);
        user = syncLocalUser(db, auth.user, name);
        await recordSupabaseAudit(body, `Creo el usuario "${email}"`);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
    } else {
      db.users.push(user);
    }
    await tryWriteDb(db);
    return sendJson(res, 201, { user: publicUser(user), invited: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/clients') {
    const client = {
      id: makeId('cl'),
      name: String(body.name || '').trim(),
      company: String(body.company || '').trim(),
      email: String(body.email || '').trim(),
      ownerId: String(body.ownerId || ''),
      status: String(body.status || 'Activo').trim()
    };
    if (!client.name || !client.company) return sendError(res, 400, 'Nombre y empresa son obligatorios');
    if (hasSupabaseAuth()) {
      const statusId = await getStatusIdByName(client.status);
      const [createdClient] = await supabaseRest('/clients', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          id: client.id,
          name: client.name,
          company: client.company,
          email: client.email || null,
          owner_id: client.ownerId || null,
          status_id: statusId
        }])
      });
      await recordSupabaseAudit(body, `Creo el cliente "${client.name}"`);
      return sendJson(res, 201, { client: { ...client, id: createdClient.id } });
    }
    db.clients.push(client);
    await writeDb(db);
    return sendJson(res, 201, { client });
  }

  if (segments[0] === 'api' && segments[1] === 'clients' && segments[2]) {
    const client = hasSupabaseAuth()
      ? (await getSupabaseState()).clients.find((item) => item.id === segments[2])
      : db.clients.find((item) => item.id === segments[2]);
    if (!client) return sendError(res, 404, 'Cliente no encontrado');

    if (req.method === 'PATCH' && segments.length === 3) {
      if (hasSupabaseAuth()) {
        const payload = {
          name: body.name === undefined ? client.name : String(body.name).trim(),
          company: body.company === undefined ? client.company : String(body.company).trim(),
          email: body.email === undefined ? client.email : String(body.email).trim(),
          ownerId: body.ownerId === undefined ? client.ownerId || '' : String(body.ownerId),
          status: body.status === undefined ? client.status || 'Activo' : String(body.status || 'Activo').trim()
        };
        if (!payload.name || !payload.company) return sendError(res, 400, 'Nombre y empresa son obligatorios');
        const statusId = await getStatusIdByName(payload.status);
        await supabaseRest(`/clients?id=eq.${encodeURIComponent(client.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            name: payload.name,
            company: payload.company,
            email: payload.email || null,
            owner_id: payload.ownerId || null,
            status_id: statusId
          })
        });
        await recordSupabaseAudit(body, `Modifico el cliente "${client.name}"`);
        return sendJson(res, 200, { client: { id: client.id, ...payload } });
      }
      client.name = body.name === undefined ? client.name : String(body.name).trim();
      client.company = body.company === undefined ? client.company : String(body.company).trim();
      client.email = body.email === undefined ? client.email : String(body.email).trim();
      client.ownerId = body.ownerId === undefined ? client.ownerId || '' : String(body.ownerId);
      client.status = body.status === undefined ? client.status || 'Activo' : String(body.status || 'Activo').trim();
      if (!client.name || !client.company) return sendError(res, 400, 'Nombre y empresa son obligatorios');
      await writeDb(db);
      return sendJson(res, 200, { client });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/boards') {
    const name = String(body.name || '').trim();
    if (!name) return sendError(res, 400, 'El nombre es obligatorio');
    if (hasSupabaseAuth()) {
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
        body: JSON.stringify([{ id: board.id, name: board.name, color: board.color, position: 1 }])
      });
      await supabaseRest('/board_columns', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ id: board.columns[0].id, board_id: board.id, name: board.columns[0].name, show_timer: false, position: 1 }])
      });
      await recordSupabaseAudit(body, `Creo el tablero "${name}"`);
      return sendJson(res, 201, { board });
    }
    const board = {
      id: makeId('b'),
      name,
      color: '#2b52ff',
      columns: [{ id: makeId('c'), name: 'Pendiente', showTimer: false }],
      cards: []
    };
    db.boards.push(board);
    recordConfigChange(db, body, `Creo el tablero "${name}"`);
    await writeDb(db);
    return sendJson(res, 201, { board });
  }

  if (segments[0] === 'api' && segments[1] === 'boards' && segments[2]) {
    const board = hasSupabaseAuth()
      ? (await getSupabaseState()).boards.find((item) => item.id === segments[2])
      : findBoard(db, segments[2]);
    if (!board) return sendError(res, 404, 'Tablero no encontrado');

    if (req.method === 'PATCH' && segments.length === 3) {
      const name = String(body.name || '').trim();
      if (!name) return sendError(res, 400, 'El nombre es obligatorio');
      if (hasSupabaseAuth()) {
        await supabaseRest(`/boards?id=eq.${encodeURIComponent(board.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ name })
        });
        await recordSupabaseAudit(body, `Renombro el tablero "${board.name}" a "${name}"`);
        return sendJson(res, 200, { board: { ...board, name } });
      }
      const previousName = board.name;
      board.name = name;
      recordConfigChange(db, body, `Renombro el tablero "${previousName}" a "${name}"`);
      await writeDb(db);
      return sendJson(res, 200, { board });
    }

    if (req.method === 'DELETE' && segments.length === 3) {
      if (hasSupabaseAuth()) {
        const state = await getSupabaseState();
        if (state.boards.length <= 1) return sendError(res, 400, 'Debe conservarse al menos un tablero');
        await supabaseRest(`/boards?id=eq.${encodeURIComponent(board.id)}`, { method: 'DELETE' });
        await recordSupabaseAudit(body, `Elimino el tablero "${board.name}"`);
        return sendJson(res, 200, { boards: state.boards.filter((item) => item.id !== board.id) });
      }
      if (db.boards.length <= 1) return sendError(res, 400, 'Debe conservarse al menos un tablero');
      const boardName = board.name;
      db.boards = db.boards.filter((item) => item.id !== board.id);
      recordConfigChange(db, body, `Elimino el tablero "${boardName}"`);
      await writeDb(db);
      return sendJson(res, 200, { boards: db.boards });
    }

    if (req.method === 'POST' && segments[3] === 'columns') {
      const name = String(body.name || '').trim();
      if (!name) return sendError(res, 400, 'El nombre es obligatorio');
      const column = { id: makeId('c'), name, showTimer: Boolean(body.showTimer) };
      if (hasSupabaseAuth()) {
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
        await recordSupabaseAudit(body, `Creo la columna "${name}" en "${board.name}"`);
        return sendJson(res, 201, { column, board });
      }
      board.columns.push(column);
      recordConfigChange(db, body, `Creo la columna "${name}" en "${board.name}"`);
      await writeDb(db);
      return sendJson(res, 201, { column, board });
    }

    if (req.method === 'PATCH' && segments[3] === 'columns' && segments[4] === 'order') {
      const columnIds = Array.isArray(body.columnIds) ? body.columnIds : [];
      if (columnIds.length !== board.columns.length) return sendError(res, 400, 'Orden de columnas invalido');
      if (hasSupabaseAuth()) {
        await Promise.all(columnIds.map((id, index) => supabaseRest(`/board_columns?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: index + 1 })
        })));
        board.columns = columnIds.map((id) => board.columns.find((column) => column.id === id)).filter(Boolean);
        await recordSupabaseAudit(body, `Reordeno columnas en "${board.name}"`);
        return sendJson(res, 200, { board });
      }
      board.columns = columnIds.map((id) => board.columns.find((column) => column.id === id)).filter(Boolean);
      recordConfigChange(db, body, `Reordeno columnas en "${board.name}"`);
      await writeDb(db);
      return sendJson(res, 200, { board });
    }

    if (req.method === 'DELETE' && segments[3] === 'columns' && segments[4]) {
      const columnId = segments[4];
      if (board.columns.length <= 1) return sendError(res, 400, 'Debe conservarse al menos una columna');
      if (board.cards.some((card) => card.columnId === columnId)) return sendError(res, 400, 'La columna contiene tarjetas');
      if (hasSupabaseAuth()) {
        const column = board.columns.find((item) => item.id === columnId);
        await supabaseRest(`/board_columns?id=eq.${encodeURIComponent(columnId)}`, { method: 'DELETE' });
        board.columns = board.columns.filter((column) => column.id !== columnId);
        await recordSupabaseAudit(body, `Elimino la columna "${column?.name || columnId}" de "${board.name}"`);
        return sendJson(res, 200, { board });
      }
      const column = board.columns.find((item) => item.id === columnId);
      board.columns = board.columns.filter((column) => column.id !== columnId);
      recordConfigChange(db, body, `Elimino la columna "${column?.name || columnId}" de "${board.name}"`);
      await writeDb(db);
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
      if (hasSupabaseAuth()) {
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
        await recordSupabaseAudit(body, `Creo la tarjeta "${title}" en "${board.name}"`);
        return sendJson(res, 201, { card, board });
      }
      board.cards.push(card);
      recordConfigChange(db, body, `Creo la tarjeta "${title}" en "${board.name}"`);
      await writeDb(db);
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
      if (hasSupabaseAuth()) {
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
          await recordSupabaseAudit(body, `Movio la tarjeta "${card.title}" de "${fromColumn?.name || previousColumnId}" a "${toColumn?.name || card.columnId}"`);
        } else {
          await recordSupabaseAudit(body, `Modifico la tarjeta "${previousTitle}" en "${board.name}"`);
        }
        return sendJson(res, 200, { card, board });
      }
      if (previousColumnId !== card.columnId) {
        const fromColumn = board.columns.find((column) => column.id === previousColumnId);
        const toColumn = board.columns.find((column) => column.id === card.columnId);
        recordConfigChange(db, body, `Movio la tarjeta "${card.title}" de "${fromColumn?.name || previousColumnId}" a "${toColumn?.name || card.columnId}"`);
      } else {
        recordConfigChange(db, body, `Modifico la tarjeta "${previousTitle}" en "${board.name}"`);
      }
      await writeDb(db);
      return sendJson(res, 200, { card, board });
    }

    if (req.method === 'DELETE' && segments[3] === 'cards' && segments[4]) {
      const card = board.cards.find((item) => item.id === segments[4]);
      if (hasSupabaseAuth()) {
        await supabaseRest(`/cards?id=eq.${encodeURIComponent(segments[4])}`, { method: 'DELETE' });
        board.cards = board.cards.filter((card) => card.id !== segments[4]);
        await recordSupabaseAudit(body, `Elimino la tarjeta "${card?.title || segments[4]}" de "${board.name}"`);
        return sendJson(res, 200, { board });
      }
      board.cards = board.cards.filter((card) => card.id !== segments[4]);
      recordConfigChange(db, body, `Elimino la tarjeta "${card?.title || segments[4]}" de "${board.name}"`);
      await writeDb(db);
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

server.listen(port, () => {
  console.log(`Registro Ganar v0 listo en http://localhost:${port}`);
});
