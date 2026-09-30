const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');
const paypal = require('../services/paypal');

const COIN_PACKAGES = [
  { coins: 100, price: parseFloat(process.env.COINS_PRECIO_100) || 5.00 },
  { coins: 250, price: parseFloat(process.env.COINS_PRECIO_250) || 10.00 },
  { coins: 500, price: parseFloat(process.env.COINS_PRECIO_500) || 18.00 },
  { coins: 1000, price: parseFloat(process.env.COINS_PRECIO_1000) || 30.00 },
  { coins: 2500, price: parseFloat(process.env.COINS_PRECIO_2500) || 65.00 },
  { coins: 5000, price: parseFloat(process.env.COINS_PRECIO_5000) || 120.00 }
];

router.get('/packages', authenticate, (req, res) => {
  res.json({ packages: COIN_PACKAGES });
});

router.get('/balance', authenticate, async (req, res) => {
  try {
    const users = await db.query('SELECT coins FROM users WHERE id = ?', [req.user.id]);
    res.json({ coins: users[0].coins });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener balance' });
  }
});

router.post('/create-order', authenticate, async (req, res) => {
  try {
    const { coins } = req.body;
    
    const package = COIN_PACKAGES.find(p => p.coins === coins);
    if (!package) {
      return res.status(400).json({ error: 'Paquete de coins inválido' });
    }
    
    const transactionId = uuidv4();
    
    await db.query(
      `INSERT INTO transactions (id, user_id, coins, amount_usd, status) 
       VALUES (?, ?, ?, ?, 'pending')`,
      [transactionId, req.user.id, package.coins, package.price]
    );
    
    const order = await paypal.createOrder(package.price, transactionId);
    
    await db.query(
      'UPDATE transactions SET paypal_order_id = ? WHERE id = ?',
      [order.id, transactionId]
    );
    
    res.json({ 
      orderId: order.id, 
      approveUrl: order.links.find(l => l.rel === 'approve').href,
      transactionId 
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear orden de PayPal' });
  }
});

router.post('/capture-order', authenticate, async (req, res) => {
  try {
    const { orderId, transactionId } = req.body;
    
    if (!orderId || !transactionId) {
      return res.status(400).json({ error: 'orderId y transactionId son obligatorios' });
    }
    
    const transactions = await db.query(
      'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
      [transactionId, req.user.id]
    );
    
    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Transacción no encontrada' });
    }
    
    const transaction = transactions[0];
    
    if (transaction.status === 'completed') {
      return res.status(400).json({ error: 'Esta transacción ya fue completada' });
    }
    
    const capture = await paypal.captureOrder(orderId);
    
    if (capture.status === 'COMPLETED') {
      await db.query(
        'UPDATE transactions SET status = ? WHERE id = ?',
        ['completed', transactionId]
      );
      
      await db.query(
        'UPDATE users SET coins = coins + ? WHERE id = ?',
        [transaction.coins, req.user.id]
      );
      
      const users = await db.query('SELECT coins FROM users WHERE id = ?', [req.user.id]);
      
      res.json({ 
        message: 'Coins agregados exitosamente', 
        coins: users[0].coins,
        addedCoins: transaction.coins
      });
    } else {
      await db.query(
        'UPDATE transactions SET status = ? WHERE id = ?',
        ['failed', transactionId]
      );
      res.status(400).json({ error: 'El pago no fue completado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al capturar pago' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = event.resource.id;
      
      const transactions = await db.query(
        'SELECT * FROM transactions WHERE paypal_order_id = ? AND status = ?',
        [orderId, 'pending']
      );
      
      if (transactions.length > 0) {
        const transaction = transactions[0];
        
        await db.query(
          'UPDATE transactions SET status = ? WHERE id = ?',
          ['completed', transaction.id]
        );
        
        await db.query(
          'UPDATE users SET coins = coins + ? WHERE id = ?',
          [transaction.coins, transaction.user_id]
        );
        
        console.log(`✅ Webhook: ${transaction.coins} coins agregados al usuario ${transaction.user_id}`);
      }
    }
    
    res.status(200).json({ status: 'OK' });
  } catch (error) {
    res.status(200).json({ status: 'OK' });
  }
});

router.get('/transactions', authenticate, async (req, res) => {
  try {
    const transactions = await db.query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener transacciones' });
  }
});

module.exports = router;