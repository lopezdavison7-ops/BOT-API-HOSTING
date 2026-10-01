const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { authenticate } = require('../middleware/auth');
const db = require('../db/database');

const BOTS_DIR = path.join(__dirname, '..', 'bots');
const MAX_EDIT_SIZE = 1024 * 1024;

const getServerDir = async (req, res) => {
  const servers = await db.query(
    'SELECT s.id, s.user_id, u.role FROM servers s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
    [req.params.id]
  );
  
  if (servers.length === 0) {
    res.status(404).json({ error: 'Servidor no encontrado' });
    return null;
  }
  
  if (servers[0].user_id !== req.user.id && servers[0].role !== 'admin') {
    res.status(403).json({ error: 'No tienes acceso a este servidor' });
    return null;
  }
  
  return path.join(BOTS_DIR, req.params.id);
};

const safePath = (baseDir, relative) => {
  const clean = (relative || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(baseDir, clean);
  if (target !== baseDir && !target.startsWith(baseDir + path.sep)) {
    return null;
  }
  return target;
};

router.get('/:id/files', authenticate, async (req, res) => {
  try {
    const baseDir = await getServerDir(req, res);
    if (!baseDir) return;
    
    const relPath = req.query.path || '';
    const target = safePath(baseDir, relPath);
    
    if (!target) {
      return res.status(400).json({ error: 'Ruta inválida' });
    }
    
    let entries;
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch {
      return res.status(404).json({ error: 'Carpeta no encontrada' });
    }
    
    const items = [];
    for (const entry of entries) {
      try {
        const stats = await fs.stat(path.join(target, entry.name));
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          size: stats.size,
          modified: stats.mtime
        });
      } catch {}
    }
    
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json({ path: relPath, items });
  } catch (error) {
    res.status(500).json({ error: 'Error al listar archivos' });
  }
});

router.get('/:id/files/content', authenticate, async (req, res) => {
  try {
    const baseDir = await getServerDir(req, res);
    if (!baseDir) return;
    
    const target = safePath(baseDir, req.query.path);
    if (!target) return res.status(400).json({ error: 'Ruta inválida' });
    
    const stats = await fs.stat(target);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Es una carpeta, no un archivo' });
    }
    if (stats.size > MAX_EDIT_SIZE) {
      return res.status(400).json({ error: 'Archivo demasiado grande para editar (máx 1MB)' });
    }
    
    const content = await fs.readFile(target, 'utf8');
    res.json({ path: req.query.path, content, size: stats.size });
  } catch (error) {
    res.status(404).json({ error: 'Archivo no encontrado' });
  }
});

router.put('/:id/files/content', authenticate, async (req, res) => {
  try {
    const baseDir = await getServerDir(req, res);
    if (!baseDir) return;
    
    const { path: relPath, content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Contenido inválido' });
    }
    if (content.length > MAX_EDIT_SIZE) {
      return res.status(400).json({ error: 'Contenido demasiado grande (máx 1MB)' });
    }
    
    const target = safePath(baseDir, relPath);
    if (!target) return res.status(400).json({ error: 'Ruta inválida' });
    
    await fs.writeFile(target, content, 'utf8');
    res.json({ message: 'Archivo guardado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar el archivo' });
  }
});

router.post('/:id/files/create', authenticate, async (req, res) => {
  try {
    const baseDir = await getServerDir(req, res);
    if (!baseDir) return;
    
    const { path: relPath, type } = req.body;
    const target = safePath(baseDir, relPath);
    if (!target) return res.status(400).json({ error: 'Ruta inválida' });
    
    if (type === 'dir') {
      await fs.mkdir(target, { recursive: true });
    } else {
      await fs.writeFile(target, '', 'utf8');
    }
    
    res.json({ message: type === 'dir' ? 'Carpeta creada' : 'Archivo creado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear' });
  }
});

router.delete('/:id/files', authenticate, async (req, res) => {
  try {
    const baseDir = await getServerDir(req, res);
    if (!baseDir) return;
    
    const target = safePath(baseDir, req.query.path);
    if (!target) return res.status(400).json({ error: 'Ruta inválida' });
    if (target === baseDir) return res.status(400).json({ error: 'No puedes eliminar la raíz del servidor' });
    
    await fs.rm(target, { recursive: true, force: true });
    res.json({ message: 'Eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

module.exports = router;