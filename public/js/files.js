let fileServerId = null;
let currentFilePath = '';
let filesLoadedOnce = false;
let editingFilePath = null;

const filesEsc = (text) => {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (!requireAuth()) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    fileServerId = urlParams.get('id');
    if (!fileServerId) return;
    
    const filesTabBtn = document.querySelector('[data-tab="files"]');
    if (filesTabBtn) {
      filesTabBtn.addEventListener('click', () => {
        if (!filesLoadedOnce) {
          filesLoadedOnce = true;
          loadFileManager('');
        }
      });
    }
    
    document.getElementById('refreshFilesBtn').addEventListener('click', () => loadFileManager(currentFilePath));
    document.getElementById('newFileBtn').addEventListener('click', () => createFileItem('file'));
    document.getElementById('newFolderBtn').addEventListener('click', () => createFileItem('dir'));
    document.getElementById('saveFileBtn').addEventListener('click', saveCurrentFile);
    document.getElementById('closeEditorBtn').addEventListener('click', () => {
      document.getElementById('fileEditor').style.display = 'none';
      editingFilePath = null;
    });
  } catch (error) {
    showFilesError('Error al inicializar: ' + error.message);
  }
});

const showFilesError = (message) => {
  const fileList = document.getElementById('fileList');
  if (fileList) {
    fileList.innerHTML = `<div class="loading-spinner" style="color: var(--danger);">❌ ${filesEsc(message)}</div>`;
  }
};

const loadFileManager = async (path) => {
  currentFilePath = path;
  const fileList = document.getElementById('fileList');
  fileList.innerHTML = '<div class="loading-spinner">Cargando archivos...</div>';
  
  let result;
  try {
    result = await apiFetch(`/servers/${fileServerId}/files?path=${encodeURIComponent(path)}`);
  } catch (error) {
    showFilesError('Error de red: ' + error.message);
    return;
  }
  
  if (!result || !result.ok) {
    showFilesError(`Error ${result?.status || 'desconocido'}: ${result?.data?.error || 'La API no respondió. Reinicia el servidor en HidenCloud.'}`);
    return;
  }
  
  try {
    renderFileBreadcrumb(path);
    renderFileList(result.data.items || [], path);
  } catch (error) {
    showFilesError('Error al renderizar: ' + error.message);
  }
};

const renderFileBreadcrumb = (path) => {
  const bc = document.getElementById('filesBreadcrumb');
  const parts = path ? path.split('/').filter(p => p) : [];
  
  let html = `<span class="crumb" data-path="">🏠 raíz</span>`;
  let acc = '';
  
  parts.forEach((part) => {
    acc += (acc ? '/' : '') + part;
    html += ` <span class="crumb-sep">/</span> <span class="crumb" data-path="${filesEsc(acc)}">${filesEsc(part)}</span>`;
  });
  
  bc.innerHTML = html;
  
  bc.querySelectorAll('.crumb').forEach(crumb => {
    crumb.addEventListener('click', () => loadFileManager(crumb.dataset.path));
  });
};

const renderFileList = (items, path) => {
  const fileList = document.getElementById('fileList');
  let html = '';
  
  if (path) {
    const parent = path.split('/').slice(0, -1).join('/');
    html += `
      <div class="file-item" data-type="dir" data-path="${filesEsc(parent)}">
        <span class="file-icon">⬆️</span>
        <span class="file-name">..</span>
        <span class="file-size"></span>
      </div>
    `;
  }
  
  if (items.length === 0) {
    html += '<div class="loading-spinner">Carpeta vacía.</div>';
  }
  
  items.forEach(item => {
    const rel = path ? `${path}/${item.name}` : item.name;
    html += `
      <div class="file-item" data-type="${item.type}" data-path="${filesEsc(rel)}">
        <span class="file-icon">${fileIcon(item)}</span>
        <span class="file-name">${filesEsc(item.name)}</span>
        <span class="file-size">${item.type === 'dir' ? '—' : formatFileSize(item.size)}</span>
        <button class="btn btn-danger btn-sm file-delete" data-path="${filesEsc(rel)}" data-type="${item.type}">🗑</button>
      </div>
    `;
  });
  
  fileList.innerHTML = html;
  
  fileList.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('file-delete')) return;
      const p = el.dataset.path;
      if (el.dataset.type === 'dir') {
        loadFileManager(p);
      } else {
        openFileEditor(p);
      }
    });
  });
  
  fileList.querySelectorAll('.file-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFileItem(btn.dataset.path, btn.dataset.type);
    });
  });
};

const fileIcon = (item) => {
  if (item.type === 'dir') return '📁';
  const ext = item.name.split('.').pop().toLowerCase();
  const icons = {
    js: '📜', json: '🧾', md: '📘', env: '🔐',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️',
    txt: '📄', yml: '⚙️', yaml: '⚙️', sh: '⚙️', lock: '🔒'
  };
  return icons[ext] || '📄';
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const openFileEditor = async (relPath) => {
  try {
    const result = await apiFetch(`/servers/${fileServerId}/files/content?path=${encodeURIComponent(relPath)}`);
    
    if (!result || !result.ok) {
      showNotification(result?.data?.error || 'No se pudo abrir el archivo', 'error');
      return;
    }
    
    editingFilePath = relPath;
    document.getElementById('editorFileName').textContent = relPath;
    document.getElementById('fileContent').value = result.data.content;
    document.getElementById('fileEditor').style.display = 'flex';
  } catch (error) {
    showNotification('Error al abrir: ' + error.message, 'error');
  }
};

const saveCurrentFile = async () => {
  if (!editingFilePath) return;
  
  try {
    const content = document.getElementById('fileContent').value;
    
    const result = await apiFetch(`/servers/${fileServerId}/files/content`, {
      method: 'PUT',
      body: JSON.stringify({ path: editingFilePath, content })
    });
    
    if (result && result.ok) {
      showNotification('Archivo guardado ✅', 'success');
      loadFileManager(currentFilePath);
    } else {
      showNotification(result?.data?.error || 'Error al guardar', 'error');
    }
  } catch (error) {
    showNotification('Error al guardar: ' + error.message, 'error');
  }
};

const createFileItem = async (type) => {
  const name = prompt(type === 'dir' ? 'Nombre de la nueva carpeta:' : 'Nombre del nuevo archivo:');
  if (!name || !name.trim()) return;
  
  const cleanName = name.trim().replace(/[/\\]/g, '');
  const rel = currentFilePath ? `${currentFilePath}/${cleanName}` : cleanName;
  
  try {
    const result = await apiFetch(`/servers/${fileServerId}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path: rel, type })
    });
    
    if (result && result.ok) {
      showNotification(type === 'dir' ? 'Carpeta creada 📁' : 'Archivo creado 📄', 'success');
      loadFileManager(currentFilePath);
    } else {
      showNotification(result?.data?.error || 'Error al crear', 'error');
    }
  } catch (error) {
    showNotification('Error al crear: ' + error.message, 'error');
  }
};

const deleteFileItem = async (relPath, type) => {
  if (!confirm(`¿Eliminar ${type === 'dir' ? 'la carpeta' : 'el archivo'} "${relPath}"? Esta acción no se puede deshacer.`)) return;
  
  try {
    const result = await apiFetch(`/servers/${fileServerId}/files?path=${encodeURIComponent(relPath)}`, {
      method: 'DELETE'
    });
    
    if (result && result.ok) {
      showNotification('Eliminado correctamente 🗑', 'success');
      loadFileManager(currentFilePath);
    } else {
      showNotification(result?.data?.error || 'Error al eliminar', 'error');
    }
  } catch (error) {
    showNotification('Error al eliminar: ' + error.message, 'error');
  }
};