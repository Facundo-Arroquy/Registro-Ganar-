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

async function readDb() {
  return JSON.parse(await readFile(dbPath, 'utf8'));
}

async function writeDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
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
    const user = db.users.find((candidate) => candidate.email.toLowerCase() === email && candidate.password === password);
    if (!user) return sendError(res, 401, 'Credenciales invalidas');
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    return sendJson(res, 200, {
      users: db.users.map(publicUser),
      clients: db.clients,
      boards: db.boards,
      settings: db.settings
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/client-statuses') {
    return enqueueStatusWrite(async () => {
      const nextDb = await readDb();
      ensureSettings(nextDb);
      const status = String(body.status || '').trim();
      const color = isHexColor(body.color) ? String(body.color) : '#388bfd';
      if (!status) return sendError(res, 400, 'El estado es obligatorio');
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
    if (!Number.isInteger(index) || index < 0 || index >= db.settings.clientStatuses.length) {
      return sendError(res, 404, 'Estado no encontrado');
    }

    if (req.method === 'PATCH') {
      return enqueueStatusWrite(async () => {
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
    if (!email) return sendError(res, 400, 'El email es obligatorio');
    const existing = db.users.find((user) => user.email.toLowerCase() === email);
    if (existing) return sendJson(res, 200, { user: publicUser(existing), invited: false });
    const user = { id: makeId('u'), email, password: '******', name: email.split('@')[0] };
    db.users.push(user);
    await writeDb(db);
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
    db.clients.push(client);
    await writeDb(db);
    return sendJson(res, 201, { client });
  }

  if (segments[0] === 'api' && segments[1] === 'clients' && segments[2]) {
    const client = db.clients.find((item) => item.id === segments[2]);
    if (!client) return sendError(res, 404, 'Cliente no encontrado');

    if (req.method === 'PATCH' && segments.length === 3) {
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
    const board = findBoard(db, segments[2]);
    if (!board) return sendError(res, 404, 'Tablero no encontrado');

    if (req.method === 'PATCH' && segments.length === 3) {
      const name = String(body.name || '').trim();
      if (!name) return sendError(res, 400, 'El nombre es obligatorio');
      const previousName = board.name;
      board.name = name;
      recordConfigChange(db, body, `Renombro el tablero "${previousName}" a "${name}"`);
      await writeDb(db);
      return sendJson(res, 200, { board });
    }

    if (req.method === 'DELETE' && segments.length === 3) {
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
      board.columns.push(column);
      recordConfigChange(db, body, `Creo la columna "${name}" en "${board.name}"`);
      await writeDb(db);
      return sendJson(res, 201, { column, board });
    }

    if (req.method === 'PATCH' && segments[3] === 'columns' && segments[4] === 'order') {
      const columnIds = Array.isArray(body.columnIds) ? body.columnIds : [];
      if (columnIds.length !== board.columns.length) return sendError(res, 400, 'Orden de columnas invalido');
      board.columns = columnIds.map((id) => board.columns.find((column) => column.id === id)).filter(Boolean);
      recordConfigChange(db, body, `Reordeno columnas en "${board.name}"`);
      await writeDb(db);
      return sendJson(res, 200, { board });
    }

    if (req.method === 'DELETE' && segments[3] === 'columns' && segments[4]) {
      const columnId = segments[4];
      if (board.columns.length <= 1) return sendError(res, 400, 'Debe conservarse al menos una columna');
      if (board.cards.some((card) => card.columnId === columnId)) return sendError(res, 400, 'La columna contiene tarjetas');
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

server.listen(port, () => {
  console.log(`Registro Ganar v0 listo en http://localhost:${port}`);
});
