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

const buildSafeEnv = (serverDir) => {
  const homeDir = process.env.HOME || '/home/container';
  return {
    PATH: `/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin`,
    HOME: homeDir,
    TMPDIR: '/tmp',
    NODE_ENV: 'production',
    LANG: 'C.UTF-8',
    TERM: 'xterm',
    BOT_DIR: serverDir
  };
};

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

const detectMainFile = async (serverDir, language) => {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(serverDir, 'package.json'), 'utf8'));
    if (pkg.main && typeof pkg.main === 'string') {
      try {
        await fs.access(path.join(serverDir, pkg.main));
        return pkg.main;
      } catch {}
    }
  } catch {}
  const nodeCandidates = ['index.js', 'main.js', 'app.js', 'bot.js', 'server.js', 'src/index.js', 'src/main.js', 'index.ts', 'bot.ts'];
  const pythonCandidates = ['main.py', 'bot.py', 'app.py', 'index.py'];
  const candidates = language === 'python' ? pythonCandidates : nodeCandidates;
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(serverDir, candidate));
      return candidate;
    } catch {}
  }
  return language === 'python' ? 'main.py' : 'index.js';
};

const startServer = async (serverId, nodeVersion, io) => {
  if (isRunning(serverId)) throw new Error('El servidor ya está corriendo');
  const serverDir = path.join(BOTS_DIR, serverId);
  const rows = await db.query('SELECT language FROM servers WHERE id = ?', [serverId]);
  const language = rows.length > 0 ? rows[0].language : 'node';
  const memLimit = MEM_LIMITS[(await db.query('SELECT plan FROM servers WHERE id = ?', [serverId]))[0]?.plan] || 512;
  
  let files = [];
  try { files = await fs.readdir(serverDir); } catch {}
  
  const emit = async (message) => {
    if (io) io.to(`console-${serverId}`).emit('console-output', message);
    await addLog(serverId, message);
  };
  
  if (language === 'node' && !files.includes('package.json')) {
    await emit('❌ Error: No se encontró package.json.');
    throw new Error('package.json no encontrado');
  }
  
  const mainFile = await detectMainFile(serverDir, language);
  let execCmd = 'node';
  let execArgs = [mainFile];
  if (language === 'python') execCmd = 'python3';
  else if (mainFile.endsWith('.ts')) { execCmd = 'npx'; execArgs = ['ts-node', mainFile]; }
  
  await emit(`🚀 Iniciando servidor (${language === 'python' ? 'Python 3' : `Node ${nodeVersion || '20'}`})...`);
  await emit(`📄 Archivo principal detectado: ${mainFile}`);
  await emit(`🛡️ Entorno aislado | Límite de RAM: ${language === 'node' ? memLimit + 'MB' : 'N/A (Python)'}`);
  
  const ramArgs = language === 'node' ? [`--max-old-space-size=${memLimit}`] : [];
  const proc = spawn(execCmd, [...ramArgs, ...execArgs], {
    cwd: serverDir, env: buildSafeEnv(serverDir), shell: false
  });
  
  runningProcesses.set(serverId, proc);
  proc.stdout.on('data', (data) => emit(data.toString()));
  proc.stderr.on('data', (data) => emit(`❌ ${data.toString()}`));
  proc.on('close', async (code, signal) => {
    runningProcesses.delete(serverId);
    if (proc.__stopping) await emit('🛑 Servidor detenido manualmente.');
    else {
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

const ensurePip = async (serverDir, io, serverId) => {
  try {
    await runCommand('python3', ['-m', 'pip', '--version'], serverDir, io, serverId, true);
    return true;
  } catch {}
  
  const homeDir = process.env.HOME || '/home/container';
  const getPipPath = path.join(homeDir, 'get-pip.py');
  
  try {
    await runCommand('curl', ['-fsSL', 'https://bootstrap.pypa.io/get-pip.py', '-o', getPipPath], serverDir, io, serverId);
    await runCommand('python3', [getPipPath, '--break-system-packages'], serverDir, io, serverId);
    await fs.rm(getPipPath, { force: true });
    return true;
  } catch (error) {
    throw new Error(`No se pudo instalar pip: ${error.message}`);
  }
};

const reinstall = async (serverId, repoUrl, nodeVersion, io) => {
  const serverDir = path.join(BOTS_DIR, serverId);
  const rows = await db.query('SELECT language FROM servers WHERE id = ?', [serverId]);
  const language = rows.length > 0 ? rows[0].language : 'node';
  
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
    
    if (language === 'python') {
      await emit('🔧 Verificando instalación de pip...');
      try {
        await ensurePip(serverDir, io, serverId);
        await emit('✅ pip disponible');
      } catch (e) {
        await emit(`❌ Error crítico: ${e.message}`);
        throw e;
      }
      
      await emit('🔧 Actualizando pip...');
      try {
        await runCommand('python3', ['-m', 'pip', 'install', '--upgrade', 'pip', '--break-system-packages'], serverDir, io, serverId);
      } catch (e) {
        await emit(`⚠️ No se pudo actualizar pip: ${e.message}`);
      }
      
      await emit('🔧 Instalando WAeys (WhatsApp library) desde GitHub...');
      const tmpWaeys = '/tmp/waeys-install-' + serverId.slice(0, 8);
      try {
        await runCommand('git', ['clone', '--depth', '1', 'https://github.com/toZyn/WAeys.git', tmpWaeys], serverDir, io, serverId);
        await runCommand('python3', ['-m', 'pip', 'install', '--break-system-packages', tmpWaeys], serverDir, io, serverId);
        await emit('✅ WAeys instalado correctamente');
      } catch (e) {
        await emit(`⚠️ Error al instalar WAeys: ${e.message}`);
      } finally {
        try { await fs.rm(tmpWaeys, { recursive: true, force: true }); } catch {}
      }
      
      await emit('🐍 Instalando dependencias del proyecto...');
      try {
        await fs.access(path.join(serverDir, 'requirements.txt'));
        await runCommand('python3', ['-m', 'pip', 'install', '--break-system-packages', '-r', 'requirements.txt'], serverDir, io, serverId);
        await emit('✅ Dependencias instaladas');
      } catch {
        await emit('ℹ️ No se encontró requirements.txt');
      }
    } else {
      await emit('📦 Instalando dependencias (npm install)...');
      try {
        await fs.access(path.join(serverDir, 'package.json'));
        await runCommand('npm', ['install', '--production'], serverDir, io, serverId);
      } catch {
        await emit('⚠️ No se encontró package.json.');
      }
    }
    
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
    await emit('✅ Reinstalación completada. Puedes iniciar tu servidor.');
  } catch (error) {
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', serverId]);
    await emit(`❌ Error en reinstalación: ${error.message}`);
    throw error;
  }
};

const runCommand = (command, args, cwd, io, serverId, silent = false) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env: buildSafeEnv(cwd) });
    proc.stdout.on('data', (data) => {
      if (!silent) {
        io.to(`console-${serverId}`).emit('console-output', data.toString());
        addLog(serverId, data.toString());
      }
    });
    proc.stderr.on('data', (data) => {
      if (!silent) {
        io.to(`console-${serverId}`).emit('console-output', data.toString());
        addLog(serverId, data.toString());
      }
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