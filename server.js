require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const selfsigned = require('selfsigned');

const db = require('./db/database');
const authRoutes = require('./routes/auth');
const coinsRoutes = require('./routes/coins');
const serversRoutes = require('./routes/servers');
const adminRoutes = require('./routes/admin');
const botManager = require('./services/botManager');
const paypalService = require('./services/paypal');

const app = express();

// Servidor HTTP (redirige a HTTPS)
const httpServer = http.createServer(app);

// Servidor HTTPS con certificado autofirmado
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
      const attrs = [{ name: 'commonName', value: 'BOT-API-Hosting' }];
      const pems = selfsigned.generate(attrs, {
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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/coins', coinsRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/admin', adminRoutes);

// Socket.IO para consolas en vivo
let io = null;

const setupSocketIO = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);
    
    socket.on('join-console', (serverId) => {
      socket.join(`console-${serverId}`);
    });
    
    socket.on('send-command', (data) => {
      botManager.sendCommand(data.serverId, data.command);
    });
    
    socket.on('disconnect', () => {
      console.log('Usuario desconectado:', socket.id);
    });
  });

  app.set('io', io);
};

// Cron job: revisar servers vencidos cada hora
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Revisando servers vencidos...');
  await botManager.checkExpiredServers();
});

// Ruta raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar base de datos y servidor
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

    // Configurar HTTPS
    const httpsReady = await setupHttps();

    if (httpsReady && httpsServer) {
      setupSocketIO(httpsServer);
      setupSocketIO(httpServer);

      httpsServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 BOT-API-Hosting HTTPS corriendo en puerto ${PORT}`);
      });

      httpServer.listen(3001, '0.0.0.0', () => {
        console.log(`🚀 BOT-API-Hosting HTTP corriendo en puerto 3001`);
      });

      console.log(`🌐 URL: https://localhost:${PORT}`);
    } else {
      setupSocketIO(httpServer);
      
      httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 BOT-API-Hosting HTTP corriendo en puerto ${PORT}`);
        console.log(`🌐 URL: http://localhost:${PORT}`);
      });
    }
    
    console.log(`👤 Admin: ${process.env.ADMIN_EMAIL}`);
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();