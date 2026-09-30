const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

let pool = null;

const connect = async () => {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const connection = await pool.getConnection();
  await connection.ping();
  connection.release();
};

const query = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

const createTables = async () => {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      coins DECIMAL(10,2) DEFAULT 0.00,
      role ENUM('user', 'admin') DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS servers (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      name VARCHAR(100) NOT NULL,
      plan ENUM('basico', 'estandar', 'pro', 'ultra') NOT NULL,
      repo_url VARCHAR(500),
      node_version VARCHAR(10) DEFAULT '20',
      status ENUM('stopped', 'running', 'installing', 'expired') DEFAULT 'stopped',
      coins_cost DECIMAL(10,2) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS transactions (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      coins DECIMAL(10,2) NOT NULL,
      amount_usd DECIMAL(10,2) NOT NULL,
      paypal_order_id VARCHAR(100),
      status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS server_logs (
      id VARCHAR(36) PRIMARY KEY,
      server_id VARCHAR(36) NOT NULL,
      log TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    )`
  ];

  for (const table of tables) {
    await query(table);
  }
};

const createInitialAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL || 'l29472954@gmail.com';
  
  const existing = await query('SELECT id FROM users WHERE email = ?', [adminEmail]);
  
  if (existing.length === 0) {
    const adminId = uuidv4();
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'luis123', 10);
    
    await query(
      `INSERT INTO users (id, username, email, password, coins, role) 
       VALUES (?, ?, ?, ?, 9999.00, 'admin')`,
      [adminId, process.env.ADMIN_USERNAME || 'admin', adminEmail, hashedPassword]
    );
    
    console.log('✅ Admin inicial creado:', adminEmail);
  }
};

module.exports = {
  connect,
  query,
  createTables,
  createInitialAdmin,
  getPool: () => pool
};