require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cron = require('node-cron');

const db = require('./db/database');
const authRoutes = require('./routes/auth');
const coinsRoutes = require('./routes/coins');
const serversRoutes = require('./routes/servers');
const adminRoutes = require('./routes/admin');
const botManager = require('./services/botManager');
const paypalService = require('./services/paypal');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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

// Hacer io accesible desde rutas
app.set('io', io);

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
    // Conectar a la base de datos
    await db.connect();
    console.log('✅ Base de datos conectada');
    
    // Crear tablas si no existen
    await db.createTables();
    console.log('✅ Tablas creadas/verificadas');
    
    // Crear admin inicial
    await db.createInitialAdmin();
    console.log('✅ Admin inicial verificado');
    
    // Iniciar botManager
    await botManager.initialize();
    console.log('✅ Bot Manager inicializado');
    
    // Iniciar servidor
    server.listen(PORT, () => {
      console.log(`🚀 BOT-API-HOSTING corriendo en puerto ${PORT}`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
      console.log(`👤 Admin: ${process.env.ADMIN_EMAIL}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();