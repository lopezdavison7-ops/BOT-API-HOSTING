const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const botManager = require('../services/botManager');

const PLANS = {
  basico: {
    name: 'Básico',
    coins: parseInt(process.env.PLAN_BASICO_COINS) || 50,
    bots: parseInt(process.env.PLAN_BASICO_BOTS) || 1,
    dias: parseInt(process.env.PLAN_BASICO_DIAS) || 30
  },
  estandar: {
    name: 'Estándar',
    coins: parseInt(process.env.PLAN_ESTANDAR_COINS) || 100,
    bots: parseInt(process.env.PLAN_ESTANDAR_BOTS) || 2,
    dias: parseInt(process.env.PLAN_ESTANDAR_DIAS) || 30
  },
  pro: {
    name: 'Pro',
    coins: parseInt(process.env.PLAN_PRO_COINS) || 200,
    bots: parseInt(process.env.PLAN_PRO_BOTS) || 5,
    dias: parseInt(process.env.PLAN_PRO_DIAS) || 30
  },
  ultra: {
    name: 'Ultra',
    coins: parseInt(process.env.PLAN_ULTRA_COINS) || 400,
    bots: parseInt(process.env.PLAN_ULTRA_BOTS) || 10,
    dias: parseInt(process.env.PLAN_ULTRA_DIAS) || 30
  }
};

router.get('/plans', authenticate, (req, res) => {
  res.json({ plans: PLANS });
});

router.post('/buy', authenticate, async (req, res) => {
  try {
    const { plan, name } = req.body;
    
    if (!plan || !name) {
      return res.status(400).json({ error: 'Plan y nombre del servidor son obligatorios' });
    }
    
    if (!PLANS[plan]) {
      return res.status(400).json({ error: 'Plan inválido' });
    }
    
    if (name.length > 100) {
      return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
    }
    
    const selectedPlan = PLANS[plan];
    
    const users = await db.query('SELECT coins FROM users WHERE id = ?', [req.user.id]);
    const userCoins = parseFloat(users[0].coins);
    
    if (userCoins < selectedPlan.coins) {
      return res.status(400).json({ 
        error: 'Coins insuficientes', 
        required: selectedPlan.coins, 
        available: userCoins 
      });
    }
    
    const serverId = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + selectedPlan.dias);
    
    await db.query(
      `UPDATE users SET coins = coins - ? WHERE id = ?`,
      [selectedPlan.coins, req.user.id]
    );
    
    await db.query(
      `INSERT INTO servers (id, user_id, name, plan, coins_cost, expires_at, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'stopped')`,
      [serverId, req.user.id, name, plan, selectedPlan.coins, expiresAt]
    );
    
    await botManager.createServerDirectory(serverId);
    
    const updatedUser = await db.query('SELECT coins FROM users WHERE id = ?', [req.user.id]);
    
    res.status(201).json({ 
      message: 'Servidor comprado exitosamente',
      serverId,
      name,
      plan: selectedPlan.name,
      expiresAt,
      remainingCoins: updatedUser[0].coins
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al comprar servidor' });
  }
});

router.get('/my-servers', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    
    const serversWithStatus = servers.map(server => ({
      ...server,
      isRunning: botManager.isRunning(server.id)
    }));
    
    res.json({ servers: serversWithStatus });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener servidores' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    const server = servers[0];
    server.isRunning = botManager.isRunning(server.id);
    
    res.json({ server });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener servidor' });
  }
});

router.put('/:id/startup', authenticate, async (req, res) => {
  try {
    const { repo_url, node_version } = req.body;
    
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    if (repo_url && !repo_url.match(/^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w\-]+\/[\w\-\.]+(\/)?$/)) {
      return res.status(400).json({ error: 'URL de repositorio inválida. Usa GitHub, GitLab o Bitbucket' });
    }
    
    if (node_version && !['16', '18', '20'].includes(node_version)) {
      return res.status(400).json({ error: 'Versión de Node inválida. Usa 16, 18 o 20' });
    }
    
    if (botManager.isRunning(req.params.id)) {
      return res.status(400).json({ error: 'Detén el servidor antes de modificar el startup' });
    }
    
    const updates = [];
    const params = [];
    
    if (repo_url) {
      updates.push('repo_url = ?');
      params.push(repo_url);
    }
    
    if (node_version) {
      updates.push('node_version = ?');
      params.push(node_version);
    }
    
    if (updates.length > 0) {
      params.push(req.params.id);
      await db.query(
        `UPDATE servers SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }
    
    res.json({ message: 'Startup actualizado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar startup' });
  }
});

router.post('/:id/reinstall', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    const server = servers[0];
    
    if (!server.repo_url) {
      return res.status(400).json({ error: 'Primero configura la URL del repositorio en Startup' });
    }
    
    if (botManager.isRunning(server.id)) {
      return res.status(400).json({ error: 'Detén el servidor antes de reinstalar' });
    }
    
    const io = req.app.get('io');
    
    res.json({ message: 'Reinstalación iniciada' });
    
    await botManager.reinstall(server.id, server.repo_url, server.node_version, io);
    
  } catch (error) {
    res.status(500).json({ error: 'Error al reinstalar servidor' });
  }
});

router.post('/:id/start', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    const server = servers[0];
    
    if (server.status === 'expired') {
      return res.status(400).json({ error: 'Este servidor ha expirado' });
    }
    
    if (botManager.isRunning(server.id)) {
      return res.status(400).json({ error: 'El servidor ya está corriendo' });
    }
    
    const io = req.app.get('io');
    await botManager.startServer(server.id, server.node_version, io);
    
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['running', server.id]);
    
    res.json({ message: 'Servidor iniciado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar servidor' });
  }
});

router.post('/:id/stop', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    if (!botManager.isRunning(req.params.id)) {
      return res.status(400).json({ error: 'El servidor no está corriendo' });
    }
    
    await botManager.stopServer(req.params.id);
    
    await db.query('UPDATE servers SET status = ? WHERE id = ?', ['stopped', req.params.id]);
    
    res.json({ message: 'Servidor detenido' });
  } catch (error) {
    res.status(500).json({ error: 'Error al detener servidor' });
  }
});

router.post('/:id/restart', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    const server = servers[0];
    
    if (server.status === 'expired') {
      return res.status(400).json({ error: 'Este servidor ha expirado' });
    }
    
    const io = req.app.get('io');
    await botManager.restartServer(server.id, server.node_version, io);
    
    res.json({ message: 'Servidor reiniciado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al reiniciar servidor' });
  }
});

router.get('/:id/console', authenticate, async (req, res) => {
  try {
    const logs = await db.query(
      'SELECT log FROM server_logs WHERE server_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.params.id]
    );
    
    res.json({ logs: logs.map(l => l.log).reverse() });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener consola' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    if (botManager.isRunning(req.params.id)) {
      await botManager.stopServer(req.params.id);
    }
    
    await botManager.deleteServerDirectory(req.params.id);
    
    await db.query('DELETE FROM servers WHERE id = ?', [req.params.id]);
    
    res.json({ message: 'Servidor eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar servidor' });
  }
});

router.post('/:id/renew', authenticate, async (req, res) => {
  try {
    const servers = await db.query(
      'SELECT * FROM servers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    const server = servers[0];
    const plan = PLANS[server.plan];
    
    const users = await db.query('SELECT coins FROM users WHERE id = ?', [req.user.id]);
    const userCoins = parseFloat(users[0].coins);
    
    if (userCoins < plan.coins) {
      return res.status(400).json({ 
        error: 'Coins insuficientes para renovar', 
        required: plan.coins, 
        available: userCoins 
      });
    }
    
    await db.query(
      'UPDATE users SET coins = coins - ? WHERE id = ?',
      [plan.coins, req.user.id]
    );
    
    const newExpiresAt = new Date(server.expires_at);
    newExpiresAt.setDate(newExpiresAt.getDate() + plan.dias);
    
    await db.query(
      'UPDATE servers SET expires_at = ?, status = ? WHERE id = ?',
      [newExpiresAt, 'stopped', server.id]
    );
    
    const updatedUser = await db.query('SELECT coins FROM users WHERE id = ?', [req.user.id]);
    
    res.json({ 
      message: 'Servidor renovado exitosamente',
      newExpiresAt,
      remainingCoins: updatedUser[0].coins
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al renovar servidor' });
  }
});

module.exports = router;