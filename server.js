require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const selfsigned = require('selfsigned');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const db = require('./db/database');
const authRoutes = require('./routes/auth');
const coinsRoutes = require('./routes/coins');
const serversRoutes = require('./routes/servers');
const adminRoutes = require('./routes/admin');
const botManager = require('./services/botManager');

const app = express();
const httpServer = http.createServer(app);

const io = new Server({
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Autenticación requerida'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (error) {
    next(new Error('Token inválido'));
  }
});

const canAccessServer = async (userId, serverId) => {
  try {
    const rows = await db.query(
      'SELECT s.user_id, u.role FROM servers s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
      [serverId]
    );
    if (rows.length === 0) return false;
    return rows[0].user_id === userId || rows[0].role === 'admin';
  } catch (error) {
    return false;
  }
};

io.on('connection', (socket) => {
  socket.on('join-console', async (serverId) => {
    if (await canAccessServer(socket.userId, serverId)) {
      socket.join(`console-${serverId}`);
    }
  });

  socket.on('send-command', async (data) => {
    if (await canAccessServer(socket.userId, data.serverId)) {
      botManager.sendCommand(data.serverId, data.command);
    }
  });
});

app.set('io', io);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

const CERT_DIR = path.join(__dirname, 'data', 'certs');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');

let httpsServer = null;

const setupHttps = async () => {
  try {
    if (!fs.existsSync(CERT_DIR)) {
      fs.mkdirSync(CERT_DIR, { recursive: true });
    }

    let cert, key;

    if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
      cert = fs.readFileSync(CERT_PATH);
      key = fs.readFileSync(KEY_PATH);
      console.log('🔐 Certificado SSL existente cargado');
    } else {
      const pems = selfsigned.generate([{ name: 'commonName', value: 'BOT-API-Hosting' }], {
        days: 365,
        keySize: 2048,
        algorithm: 'sha256'
      });
      fs.writeFileSync(CERT_PATH, pems.cert);
      fs.writeFileSync(KEY_PATH, pems.private);
      cert = pems.cert;
      key = pems.private;
      console.log('🔐 Certificado SSL autofirmado generado');
    }

    httpsServer = https.createServer({ cert, key }, app);
    return true;
  } catch (error) {
    console.error('⚠️ Error configurando HTTPS, usando solo HTTP:', error.message);
    return false;
  }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/coins', coinsRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/admin', adminRoutes);

cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Revisando servers vencidos...');
  await botManager.checkExpiredServers();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

async function startServer() {
  try {
    await db.connect();
    console.log('✅ Base de datos conectada');
    
    await db.createTables();
    console.log('✅ Tablas creadas/verificadas');
    
    await db.createInitialAdmin();
    console.log('✅ Admin inicial verificado');
    
    await botManager.initialize();
    console.log('✅ Bot Manager inicializado');

    const httpsReady = await setupHttps();

    if (httpsReady && httpsServer) {
      io.attach(httpsServer);
      io.attach(httpServer);

      httpsServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 BOT-API-Hosting HTTPS corriendo en puerto ${PORT}`);
      });

      httpServer.listen(3001, '0.0.0.0', () => {
        console.log(`🚀 BOT-API-Hosting HTTP corriendo en puerto 3001`);
      });

      console.log(`🌐 URL: https://localhost:${PORT}`);
    } else {
      io.attach(httpServer);

      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 BOT-API-Hosting HTTP corriendo en puerto ${PORT}`);
        console.log(`🌐 URL: http://localhost:${PORT}`);
      });
    }
    
    console.log(`👤 Admin: ${process.env.ADMIN_EMAIL}`);
    console.log('🛡️ Seguridad: helmet + rate-limit + socket JWT activos');
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();