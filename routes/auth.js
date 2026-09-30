const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    const existingEmail = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail.length > 0) {
      return res.status(400).json({ error: 'Este email ya está registrado' });
    }
    
    const existingUsername = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUsername.length > 0) {
      return res.status(400).json({ error: 'Este nombre de usuario ya está en uso' });
    }
    
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await db.query(
      `INSERT INTO users (id, username, email, password, coins, role) 
       VALUES (?, ?, ?, ?, 0.00, 'user')`,
      [userId, username, email, hashedPassword]
    );
    
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { 
      expiresIn: process.env.JWT_EXPIRES_IN || '7d' 
    });
    
    res.status(201).json({ 
      message: 'Cuenta creada exitosamente', 
      token,
      user: { id: userId, username, email, coins: 0, role: 'user' }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }
    
    const users = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { 
      expiresIn: process.env.JWT_EXPIRES_IN || '7d' 
    });
    
    res.json({ 
      message: 'Login exitoso', 
      token,
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        coins: user.coins, 
        role: user.role 
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

router.get('/profile', authenticate, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

router.put('/profile', authenticate, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    
    if (username) {
      const existingUsername = await db.query(
        'SELECT id FROM users WHERE username = ? AND id != ?', 
        [username, req.user.id]
      );
      if (existingUsername.length > 0) {
        return res.status(400).json({ error: 'Este nombre de usuario ya está en uso' });
      }
      await db.query('UPDATE users SET username = ? WHERE id = ?', [username, req.user.id]);
    }
    
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Ingresa tu contraseña actual' });
      }
      
      const users = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
      const isCurrentValid = await bcrypt.compare(currentPassword, users[0].password);
      
      if (!isCurrentValid) {
        return res.status(401).json({ error: 'Contraseña actual incorrecta' });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
      }
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
    }
    
    const updatedUser = await db.query(
      'SELECT id, username, email, coins, role FROM users WHERE id = ?', 
      [req.user.id]
    );
    
    res.json({ message: 'Perfil actualizado', user: updatedUser[0] });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

module.exports = router;