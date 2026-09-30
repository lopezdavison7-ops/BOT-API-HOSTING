const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const runningProcesses = new Map();
const BOTS_DIR = path.join(__dirname, '..', 'bots');

const initialize = async () => {
  try {
    await fs.mkdir(BOTS_DIR, { recursive: true });
    console.log('✅ Directorio de bots verificado');
  } catch (error) {
    console.error('Error al inicializar botManager:', error);
  }
};

const createServerDirectory = async (serverId) => {
  try {
    const serverDir = path.join(BOTS_DIR, serverId);
    await fs.mkdir(serverDir, { recursive: true });
    return serverDir;
  } catch (error) {
    throw new Error('Error al crear directorio del servidor');
  }
};

const deleteServerDirectory = async (serverId) => {
  try {
    const serverDir = path.join(BOTS_DIR, serverId);
    await fs.rm(serverDir, { recursive: true, force: true });
  } catch (error) {
    console.error('Error al eliminar directorio:', error);
  }
};

const isRunning = (serverId) => {
  return runningProcesses.has(serverId);
};

const startServer = async (serverId, nodeVersion, io) => {
  try {
    if (isRunning(serverId)) {
      throw new Error('El servidor ya está corriendo');
    }
    
    const serverDir = path.join(BOTS_DIR, serverId);
    
    try {
      await fs.access(serverDir);
    } catch {
      await fs.mkdir(serverDir, { recursive: true });
    }
    
    const files = await fs.readdir(serverDir);
    const hasPackageJson = files.includes('package.json');
    
    if (!hasPackageJson) {
      const errorMsg = '❌ Error: No se encontró package.json. Configura el repositorio en Startup y haz Reinstall.';
      await addLog(serverId, errorMsg);
      if (io) io.to(`console-${serverId}`).emit('console-output', errorMsg);
      throw new Error('package.json no encontrado');
    }
    
    await addLog(serverId, `🚀 Iniciando servidor con Node ${nodeVersion || '20'}...`);
    if (io) io.to(`console-${serverId}`).emit('console-output', `🚀 Iniciando servidor con Node ${nodeVersion || '20'}...`);
    
    const process = spawn('node', ['index.js'], {
      cwd: serverDir,
      env: { ...process.env },
      shell: false
    });
    
    runningProcesses.set(serverId, process);
    
    process.stdout.on('data', async (data) => {
      const message = data.toString();
      if (io) io.to(`console-${serverId}`).emit('console-output', message);
      await addLog(serverId, message);
    });
    
    process.stderr.on('data', async (data) => {
      const message = data.toString();
      if (io) io.to(`console-${serverId}`).emit('console-output', `❌ ${message}`);
      await addLog(serverId, `ERROR: ${message}`);
    });
    
    process.on('close', async (code) => {
      runningProcesses.delete(serverId);
      const message = `🛑 Servidor detenido con código: ${code}`;
      if (io) io.to(`console-${serverId}`).emit('console-output', message);
      await addLog(serverId, message);
      await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
    });
    
    process.on('error', async (error) => {
      runningProcesses.delete(serverId);
      const message = `❌ Error al iniciar: ${error.message}`;
      if (io) io.to(`console-${serverId}`).emit('console-output', message);
      await addLog(serverId, message);
    });
    
    await addLog(serverId, '✅ Servidor iniciado correctamente');
    if (io) io.to(`console-${serverId}`).emit('console-output', '✅ Servidor iniciado correctamente');
    
  } catch (error) {
    throw error;
  }
};

const stopServer = async (serverId) => {
  try {
    const process = runningProcesses.get(serverId);
    
    if (!process) {
      throw new Error('El servidor no está corriendo');
    }
    
    process.kill('SIGTERM');
    
    setTimeout(() => {
      if (runningProcesses.has(serverId)) {
        const proc = runningProcesses.get(serverId);
        proc.kill('SIGKILL');
        runningProcesses.delete(serverId);
      }
    }, 5000);
    
    await addLog(serverId, '🛑 Deteniendo servidor...');
    
  } catch (error) {
    throw error;
  }
};

const restartServer = async (serverId, nodeVersion, io) => {
  try {
    if (isRunning(serverId)) {
      await stopServer(serverId);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    await startServer(serverId, nodeVersion, io);
  } catch (error) {
    throw error;
  }
};

const sendCommand = (serverId, command) => {
  const process = runningProcesses.get(serverId);
  
  if (!process) {
    return { success: false, error: 'El servidor no está corriendo' };
  }
  
  if (process.stdin.writable) {
    process.stdin.write(command + '\n');
    return { success: true };
  }
  
  return { success: false, error: 'No se puede escribir en el proceso' };
};

const reinstall = async (serverId, repoUrl, nodeVersion, io) => {
  try {
    const serverDir = path.join(BOTS_DIR, serverId);
    
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['installing', serverId]);
    
    await addLog(serverId, '📦 Iniciando reinstalación...');
    if (io) io.to(`console-${serverId}`).emit('console-output', '📦 Iniciando reinstalación...');
    
    await fs.rm(serverDir, { recursive: true, force: true });
    await fs.mkdir(serverDir, { recursive: true });
    
    await addLog(serverId, `📥 Clonando repositorio: ${repoUrl}`);
    if (io) io.to(`console-${serverId}`).emit('console-output', `📥 Clonando repositorio: ${repoUrl}`);
    
    await runCommand('git', ['clone', repoUrl, serverDir], serverDir, io, serverId);
    
    await addLog(serverId, '📦 Instalando dependencias (npm install)...');
    if (io) io.to(`console-${serverId}`).emit('console-output', '📦 Instalando dependencias (npm install)...');
    
    await runCommand('npm', ['install', '--production'], serverDir, io, serverId);
    
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
    
    await addLog(serverId, '✅ Reinstalación completada. Puedes iniciar tu servidor.');
    if (io) io.to(`console-${serverId}`).emit('console-output', '✅ Reinstalación completada. Puedes iniciar tu servidor.');
    
  } catch (error) {
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
    const errorMsg = `❌ Error en reinstalación: ${error.message}`;
    await addLog(serverId, errorMsg);
    if (io) io.to(`console-${serverId}`).emit('console-output', errorMsg);
    throw error;
  }
};

const runCommand = (command, args, cwd, io, serverId) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd });
    
    proc.stdout.on('data', async (data) => {
      const message = data.toString();
      if (io) io.to(`console-${serverId}`).emit('console-output', message);
      await addLog(serverId, message);
    });
    
    proc.stderr.on('data', async (data) => {
      const message = data.toString();
      if (io) io.to(`console-${serverId}`).emit('console-output', message);
      await addLog(serverId, message);
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} terminó con código ${code}`));
      }
    });
    
    proc.on('error', (error) => {
      reject(error);
    });
  });
};

const checkExpiredServers = async () => {
  try {
    const now = new Date();
    
    const expiredServers = await db.query(
      `SELECT * FROM servers WHERE expires_at < ? AND status != 'expired'`,
      [now]
    );
    
    for (const server of expiredServers) {
      if (isRunning(server.id)) {
        await stopServer(server.id);
      }
      
      await deleteServerDirectory(server.id);
      
      await db.query(
        "UPDATE servers SET status = 'expired' WHERE id = ?",
        [server.id]
      );
      
      console.log(`🗑️ Servidor expirado eliminado: ${server.id}`);
    }
    
    if (expiredServers.length > 0) {
      console.log(`🗑️ ${expiredServers.length} servidor(es) expirado(s) procesado(s)`);
    }
  } catch (error) {
    console.error('Error al verificar servers expirados:', error);
  }
};

const addLog = async (serverId, message) => {
  try {
    const logId = uuidv4();
    await db.query(
      'INSERT INTO server_logs (id, server_id, log) VALUES (?, ?, ?)',
      [logId, serverId, message]
    );
  } catch (error) {
    console.error('Error al guardar log:', error);
  }
};

module.exports = {
  initialize,
  createServerDirectory,
  deleteServerDirectory,
  isRunning,
  startServer,
  stopServer,
  restartServer,
  sendCommand,
  reinstall,
  checkExpiredServers
};