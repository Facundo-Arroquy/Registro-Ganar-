import { readFile, writeFile } from 'node:fs/promises';

function parseEnv(raw) {
  return Object.fromEntries(raw
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function getArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || '';
}

async function supabaseRequest(env, pathname, body) {
  const response = await fetch(`${env.SUPABASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg || data.message || data.error_description || 'No se pudo crear el usuario');
  }
  return data;
}

async function main() {
  const email = getArg('email').trim().toLowerCase();
  const name = getArg('name').trim() || email.split('@')[0];
  const password = getArg('password');
  if (!email || !password) {
    throw new Error('Uso: node scripts/create-supabase-user.js --email=user@mail.com --name="Nombre" --password="secreto123"');
  }

  const env = parseEnv(await readFile('.env', 'utf8'));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
  }

  const { user } = await supabaseRequest(env, '/auth/v1/admin/users', {
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });

  const db = JSON.parse(await readFile('data/db.json', 'utf8'));
  const existing = db.users.find((candidate) => candidate.email.toLowerCase() === email || candidate.id === user.id);
  if (existing) {
    existing.id = user.id;
    existing.email = email;
    existing.name = name;
    delete existing.password;
  } else {
    db.users.push({ id: user.id, email, name });
  }
  await writeFile('data/db.json', `${JSON.stringify(db, null, 2)}\n`);
  console.log(`Usuario creado/sincronizado: ${email}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
