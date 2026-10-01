const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'botapi.db');

let SQL = null;
let db = null;
let saveTimer = null;

const saveSync = () => {
  if (!db) return;
  try {
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  } catch (error) {
    console.error('Error guardando la base de datos:', error);
  }
};

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSync, 1000);
};

const connect = async () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
    console.log('📂 Base de datos existente cargada desde disco');
  } else {
    db = new SQL.Database();
    console.log('📂 Base de datos nueva creada');
  }
  process.on('exit', saveSync);
  process.on('SIGINT', () => { saveSync(); process.exit(0); });
  process.on('SIGTERM', () => { saveSync(); process.exit(0); });
};

const normalizeParams = (params) => {
  return (params || []).map(p => {
    if (p === undefined) return null;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
};

const query = async (sql, params = []) => {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(normalizeParams(params));
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
    if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql)) {
      scheduleSave();
    }
  }
};

const createTables = async () => {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      coins REAL DEFAULT 0,
      role TEXT DEFAULT 'user' CHECK(role IN ('user','admin')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      plan TEXT NOT NULL CHECK(plan IN ('basico','estandar','pro','ultra')),
      repo_url TEXT,
      node_version TEXT DEFAULT '20',
      status TEXT DEFAULT 'stopped' CHECK(status IN ('stopped','running','installing','expired')),
      coins_cost REAL NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      coins REAL NOT NULL,
      amount_usd REAL NOT NULL,
      paypal_order_id TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS server_logs (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      log TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    )`
  ];
  for (const table of tables) {
    db.run(table);
  }
  scheduleSave();
};

const createInitialAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL || 'l29472954@gmail.com';
  const existing = await query('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (existing.length === 0) {
    const adminId = uuidv4();
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'luis123', 10);
    await query(
      `INSERT INTO users (id, username, email, password, coins, role) VALUES (?, ?, ?, ?, 9999.00, 'admin')`,
      [adminId, process.env.ADMIN_USERNAME || 'admin', adminEmail, hashedPassword]
    );
    console.log('✅ Admin inicial creado:', adminEmail);
  }
};

module.exports = { connect, query, createTables, createInitialAdmin, save: saveSync };