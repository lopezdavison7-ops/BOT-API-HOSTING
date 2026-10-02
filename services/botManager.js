const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const runningProcesses = new Map();
const logQueues = new Map();
const BOTS_DIR = path.join(__dirname, '..', 'bots');
const MEM_LIMITS = { basico: 256, estandar: 512, pro: 1024, ultra: 2048 };

const initialize = async () => {
  try {
    await fs.mkdir(BOTS_DIR, { recursive: true });
    console.log('✅ Directorio de bots verificado');
  } catch (error) {
    console.error('Error al inicializar botManager:', error);
  }
};

const addLog = (serverId, message) => {
  const prev = logQueues.get(serverId) || Promise.resolve();
  const next = prev.then(() =>
    db.query('INSERT INTO server_logs (id, server_id, log) VALUES (?, ?, ?)', [uuidv4(), serverId, message])
  ).catch((error) => console.error('Error al guardar log:', error));
  logQueues.set(serverId, next);
  return next;
};

const buildSafeEnv = (serverDir) => ({
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: serverDir,
  TMPDIR: serverDir,
  NODE_ENV: 'production',
  LANG: 'C.UTF-8',
  TERM: 'xterm',
  BOT_DIR: serverDir
});

const createServerDirectory = async (serverId) => {
  const serverDir = path.join(BOTS_DIR, serverId);
  await fs.mkdir(serverDir, { recursive: true });
  return serverDir;
};

const deleteServerDirectory = async (serverId) => {
  try {
    await fs.rm(path.join(BOTS_DIR, serverId), { recursive: true, force: true });
  } catch (error) {
    console.error('Error al eliminar directorio:', error);
  }
};

const isRunning = (serverId) => runningProcesses.has(serverId);

const detectMainFile = async (serverDir) => {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(serverDir, 'package.json'), 'utf8'));
    if (pkg.main && typeof pkg.main === 'string') {
      try {
        await fs.access(path.join(serverDir, pkg.main));
        return pkg.main;
      } catch {}
    }
  } catch {}
  // 🔥 FIX: Se agregó 'main.ts' a la lista de candidatos
  const candidates = ['index.js', 'main.js', 'app.js', 'bot.js', 'server.js', 'src/index.js', 'src/main.js', 'index.ts', 'main.ts', 'bot.ts'];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(serverDir, candidate));
      return candidate;
    } catch {}
  }
  return 'index.js';
};

const startServer = async (serverId, nodeVersion, io) => {
  if (isRunning(serverId)) throw new Error('El servidor ya está corriendo');
  const serverDir = path.join(BOTS_DIR, serverId);
  const rows = await db.query('SELECT plan FROM servers WHERE id = ?', [serverId]);
  const memLimit = MEM_LIMITS[rows[0]?.plan] || 512;

  let files = [];
  try { files = await fs.readdir(serverDir); } catch {}

  const emit = async (message) => {
    if (io) io.to(`console-${serverId}`).emit('console-output', message);
    await addLog(serverId, message);
  };

  if (!files.includes('package.json')) {
    await emit('❌ Error: No se encontró package.json. Configura el repositorio y haz Reinstall.');
    throw new Error('package.json no encontrado');
  }

  const mainFile = await detectMainFile(serverDir);
  let execCmd = 'node';
  let execArgs = [`--max-old-space-size=${memLimit}`, mainFile];

  if (mainFile.endsWith('.ts')) {
    execCmd = 'npx';
    execArgs = ['ts-node', mainFile];
  }

  await emit(`🚀 Iniciando servidor (Node ${nodeVersion || '20'})...`);
  await emit(`📄 Archivo principal detectado: ${mainFile}`);
  await emit(`🛡️ Entorno aislado | Límite de RAM: ${memLimit}MB`);

  const proc = spawn(execCmd, execArgs, {
    cwd: serverDir,
    env: buildSafeEnv(serverDir),
    shell: false
  });

  runningProcesses.set(serverId, proc);
  proc.stdout.on('data', (data) => emit(data.toString()));
  proc.stderr.on('data', (data) => emit(`❌ ${data.toString()}`));
  proc.on('close', async (code, signal) => {
    runningProcesses.delete(serverId);
    if (proc.__stopping) {
      await emit('🛑 Servidor detenido manualmente.');
    } else {
      await emit(`🛑 Servidor detenido (código: ${code}${signal ? `, señal: ${signal}` : ''})`);
      if (code !== 0) await emit('💡 El bot cerró por su cuenta. Revisa los mensajes ❌ de arriba.');
    }
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
  });
  proc.on('error', async (error) => {
    runningProcesses.delete(serverId);
    await emit(`❌ Error al iniciar el proceso: ${error.message}`);
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
  });
};

const stopServer = async (serverId) => {
  const proc = runningProcesses.get(serverId);
  if (!proc) throw new Error('El servidor no está corriendo');
  proc.__stopping = true;
  await addLog(serverId, '🛑 Deteniendo servidor...');
  proc.kill('SIGTERM');
  setTimeout(() => {
    if (runningProcesses.get(serverId) === proc) {
      proc.kill('SIGKILL');
      runningProcesses.delete(serverId);
    }
  }, 5000);
};

const restartServer = async (serverId, nodeVersion, io) => {
  if (isRunning(serverId)) {
    await stopServer(serverId);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  await startServer(serverId, nodeVersion, io);
};

const sendCommand = (serverId, command) => {
  const proc = runningProcesses.get(serverId);
  if (!proc) return { success: false, error: 'El servidor no está corriendo' };
  if (proc.stdin.writable) {
    proc.stdin.write(command + '\n');
    return { success: true };
  }
  return { success: false, error: 'No se puede escribir en el proceso' };
};

const reinstall = async (serverId, repoUrl, nodeVersion, io) => {
  const serverDir = path.join(BOTS_DIR, serverId);
  const emit = async (message) => {
    if (io) io.to(`console-${serverId}`).emit('console-output', message);
    await addLog(serverId, message);
  };

  try {
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['installing', serverId]);
    await emit('📦 Iniciando reinstalación...');

    await fs.rm(serverDir, { recursive: true, force: true });
    await fs.mkdir(serverDir, { recursive: true });

    await emit(`📥 Clonando repositorio: ${repoUrl}`);
    await runCommand('git', ['clone', '--depth', '1', repoUrl, '.'], serverDir, io, serverId);

    await emit('📦 Instalando dependencias (npm install)...');
    await runCommand('npm', ['install', '--production'], serverDir, io, serverId);

    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
    await emit('✅ Reinstalación completada. Puedes iniciar tu servidor.');
  } catch (error) {
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
    await emit(`❌ Error en reinstalación: ${error.message}`);
    throw error;
  }
};

const runCommand = (command, args, cwd, io, serverId) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env: buildSafeEnv(cwd) });
    proc.stdout.on('data', (data) => {
      io.to(`console-${serverId}`).emit('console-output', data.toString());
      addLog(serverId, data.toString());
    });
    proc.stderr.on('data', (data) => {
      io.to(`console-${serverId}`).emit('console-output', data.toString());
      addLog(serverId, data.toString());
    });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} terminó con código ${code}`))));
    proc.on('error', reject);
  });
};

const checkExpiredServers = async () => {
  try {
    const expiredServers = await db.query(`SELECT * FROM servers WHERE expires_at < ? AND status != 'expired'`, [new Date()]);
    for (const server of expiredServers) {
      if (isRunning(server.id)) await stopServer(server.id);
      await deleteServerDirectory(server.id);
      await db.query("UPDATE servers SET status = 'expired' WHERE id = ?", [server.id]);
      console.log(`🗑️ Servidor expirado eliminado: ${server.id}`);
    }
  } catch (error) {
    console.error('Error al verificar servers expirados:', error);
  }
};

module.exports = { initialize, createServerDirectory, deleteServerDirectory, isRunning, startServer, stopServer, restartServer, sendCommand, reinstall, checkExpiredServers };