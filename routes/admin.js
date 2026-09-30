const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticate, isAdmin } = require('../middleware/auth');
const botManager = require('../services/botManager');

router.use(authenticate);
router.use(isAdmin);

router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await db.query('SELECT COUNT(*) as count FROM users');
    const totalServers = await db.query('SELECT COUNT(*) as count FROM servers');
    const activeServers = await db.query("SELECT COUNT(*) as count FROM servers WHERE status = 'running'");
    const totalCoins = await db.query('SELECT COALESCE(SUM(coins), 0) as total FROM users');
    const totalRevenue = await db.query("SELECT COALESCE(SUM(amount_usd), 0) as total FROM transactions WHERE status = 'completed'");
    
    const serversByPlan = await db.query(
      'SELECT plan, COUNT(*) as count FROM servers GROUP BY plan'
    );
    
    const recentUsers = await db.query(
      'SELECT id, username, email, coins, created_at FROM users ORDER BY created_at DESC LIMIT 10'
    );
    
    res.json({
      stats: {
        totalUsers: totalUsers[0].count,
        totalServers: totalServers[0].count,
        activeServers: activeServers[0].count,
        totalCoins: parseFloat(totalCoins[0].total),
        totalRevenue: parseFloat(totalRevenue[0].total),
        serversByPlan,
        recentUsers
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    let whereClause = '';
    let params = [];
    
    if (search) {
      whereClause = 'WHERE username LIKE ? OR email LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }
    
    const users = await db.query(
      `SELECT id, username, email, coins, role, created_at FROM users 
       ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    
    const total = await db.query(
      `SELECT COUNT(*) as count FROM users ${whereClause}`,
      params
    );
    
    res.json({ 
      users, 
      total: total[0].count, 
      page, 
      totalPages: Math.ceil(total[0].count / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const users = await db.query(
      'SELECT id, username, email, coins, role, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const servers = await db.query(
      'SELECT * FROM servers WHERE user_id = ?',
      [req.params.id]
    );
    
    const transactions = await db.query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    );
    
    res.json({ user: users[0], servers, transactions });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

router.put('/users/:id/coins', async (req, res) => {
  try {
    const { coins, action } = req.body;
    
    if (!coins || isNaN(coins) || coins <= 0) {
      return res.status(400).json({ error: 'Cantidad de coins inválida' });
    }
    
    if (!['add', 'remove', 'set'].includes(action)) {
      return res.status(400).json({ error: 'Acción inválida. Usa add, remove o set' });
    }
    
    const users = await db.query('SELECT coins FROM users WHERE id = ?', [req.params.id]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    let newCoins;
    
    switch (action) {
      case 'add':
        newCoins = parseFloat(users[0].coins) + coins;
        break;
      case 'remove':
        newCoins = Math.max(0, parseFloat(users[0].coins) - coins);
        break;
      case 'set':
        newCoins = coins;
        break;
    }
    
    await db.query('UPDATE users SET coins = ? WHERE id = ?', [newCoins, req.params.id]);
    
    res.json({ message: 'Coins actualizados', newCoins });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar coins' });
  }
});

router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    
    const users = await db.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    await db.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    
    res.json({ message: 'Rol actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    
    const users = await db.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const servers = await db.query('SELECT id FROM servers WHERE user_id = ?', [req.params.id]);
    
    for (const server of servers) {
      if (botManager.isRunning(server.id)) {
        await botManager.stopServer(server.id);
      }
      await botManager.deleteServerDirectory(server.id);
    }
    
    await db.query('DELETE FROM servers WHERE user_id = ?', [req.params.id]);
    await db.query('DELETE FROM transactions WHERE user_id = ?', [req.params.id]);
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

router.get('/servers', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const servers = await db.query(
      `SELECT s.*, u.username, u.email FROM servers s 
       JOIN users u ON s.user_id = u.id 
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    
    const total = await db.query('SELECT COUNT(*) as count FROM servers');
    
    const serversWithStatus = servers.map(server => ({
      ...server,
      isRunning: botManager.isRunning(server.id)
    }));
    
    res.json({ 
      servers: serversWithStatus, 
      total: total[0].count, 
      page, 
      totalPages: Math.ceil(total[0].count / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener servidores' });
  }
});

router.delete('/servers/:id', async (req, res) => {
  try {
    const servers = await db.query('SELECT * FROM servers WHERE id = ?', [req.params.id]);
    
    if (servers.length === 0) {
      return res.status(404).json({ error: 'Servidor no encontrado' });
    }
    
    if (botManager.isRunning(req.params.id)) {
      await botManager.stopServer(req.params.id);
    }
    
    await botManager.deleteServerDirectory(req.params.id);
    
    await db.query('DELETE FROM servers WHERE id = ?', [req.params.id]);
    
    res.json({ message: 'Servidor eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar servidor' });
  }
});

router.post('/servers/:id/stop', async (req, res) => {
  try {
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

router.get('/transactions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    
    let whereClause = '';
    let params = [];
    
    if (status) {
      whereClause = 'WHERE t.status = ?';
      params = [status];
    }
    
    const transactions = await db.query(
      `SELECT t.*, u.username, u.email FROM transactions t 
       JOIN users u ON t.user_id = u.id 
       ${whereClause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    
    const total = await db.query(
      `SELECT COUNT(*) as count FROM transactions t ${whereClause}`,
      params
    );
    
    res.json({ 
      transactions, 
      total: total[0].count, 
      page, 
      totalPages: Math.ceil(total[0].count / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener transacciones' });
  }
});

module.exports = router;