let socket = null;
let serverId = null;
let serverData = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;

  const urlParams = new URLSearchParams(window.location.search);
  serverId = urlParams.get('id');

  if (!serverId) {
    window.location.href = '/dashboard.html';
    return;
  }

  loadServer();
  setupTabs();
  setupConsole();
  setupActions();
  setupStartupForm();
  setupReinstall();
  setupDeleteModal();
  setupRenewModal();
});

const loadServer = async () => {
  const result = await apiFetch(`/servers/${serverId}`);
  if (!result || !result.ok) {
    alert('Servidor no encontrado');
    window.location.href = '/dashboard.html';
    return;
  }
  serverData = result.data.server;
  updateServerUI();
};

const updateServerUI = () => {
  const setName = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  
  setName('serverName', serverData.name);
  setName('serverPlan', capitalizeFirst(serverData.plan));
  setName('serverExpires', formatDate(serverData.expires_at));
  setName('serverNode', `v${serverData.node_version}`);
  setName('serverRepo', serverData.repo_url || 'No configurado');
  setName('serverId', serverData.id);
  setName('serverCreated', formatDate(serverData.created_at));
  setName('serverCost', `${serverData.coins_cost} coins`);

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('serverStatus');

  if (statusDot && statusText) {
    if (serverData.status === 'expired') {
      statusDot.className = 'status-dot expired';
      statusText.textContent = 'Expirado';
    } else if (serverData.isRunning) {
      statusDot.className = 'status-dot running';
      statusText.textContent = 'Corriendo';
    } else if (serverData.status === 'installing') {
      statusDot.className = 'status-dot installing';
      statusText.textContent = 'Instalando';
    } else {
      statusDot.className = 'status-dot stopped';
      statusText.textContent = 'Detenido';
    }
  }

  const repoInput = document.getElementById('repoUrl');
  if (repoInput && serverData.repo_url) repoInput.value = serverData.repo_url;
  
  const nodeSelect = document.getElementById('nodeVersion');
  if (nodeSelect && serverData.node_version) nodeSelect.value = serverData.node_version;

  updateButtons();
};

const updateButtons = () => {
  const setDisabled = (id, val) => { const el = document.getElementById(id); if (el) el.disabled = val; };
  
  if (serverData.isRunning) {
    setDisabled('startBtn', true);
    setDisabled('stopBtn', false);
    setDisabled('restartBtn', false);
    setDisabled('consoleInput', false);
    setDisabled('sendCommand', false);
  } else {
    setDisabled('startBtn', serverData.status === 'expired');
    setDisabled('stopBtn', true);
    setDisabled('restartBtn', serverData.status === 'expired');
    setDisabled('consoleInput', true);
    setDisabled('sendCommand', true);
  }
};

const setupConsole = () => {
  socket = io({ auth: { token: getToken() } });
  const consoleOutput = document.getElementById('consoleOutput');

  socket.on('connect', () => {
    socket.emit('join-console', serverId);
    addConsoleLine('✅ Conectado a la consola del servidor', 'info');
    loadConsoleHistory();
  });

  socket.on('console-output', (message) => addConsoleLine(message));
  socket.on('connect_error', (error) => addConsoleLine(`❌ Error de conexión: ${error.message}`, 'error'));
  socket.on('disconnect', () => addConsoleLine('❌ Desconectado de la consola', 'error'));

  const clearBtn = document.getElementById('clearConsole');
  if (clearBtn) clearBtn.addEventListener('click', () => { if (consoleOutput) consoleOutput.innerHTML = ''; });

  const consoleInput = document.getElementById('consoleInput');
  const sendCommandBtn = document.getElementById('sendCommand');

  if (consoleInput) consoleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendCmd(); });
  if (sendCommandBtn) sendCommandBtn.addEventListener('click', sendCmd);

  function sendCmd() {
    if (!consoleInput) return;
    const command = consoleInput.value.trim();
    if (command) {
      socket.emit('send-command', { serverId, command });
      addConsoleLine(`> ${command}`, 'info');
      consoleInput.value = '';
    }
  }
};

const addConsoleLine = (message, type = '') => {
  const consoleOutput = document.getElementById('consoleOutput');
  if (!consoleOutput) return;
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.textContent = message;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
};

const loadConsoleHistory = async () => {
  const result = await apiFetch(`/servers/${serverId}/console`);
  if (result && result.ok) {
    const logs = result.data.logs;
    const consoleOutput = document.getElementById('consoleOutput');
    if (consoleOutput) {
      consoleOutput.innerHTML = '';
      logs.forEach(log => addConsoleLine(log));
    }
  }
};

const setupActions = () => {
  const bindAction = (btnId, action) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.addEventListener('click', async () => await serverAction(action));
  };
  bindAction('startBtn', 'start');
  bindAction('stopBtn', 'stop');
  bindAction('restartBtn', 'restart');
};

const serverAction = async (action) => {
  const btn = document.getElementById(`${action}Btn`);
  if (btn) btn.disabled = true;
  
  const result = await apiFetch(`/servers/${serverId}/${action}`, { method: 'POST' });
  if (result && result.ok) {
    alert(`✅ Servidor ${action === 'start' ? 'iniciado' : action === 'stop' ? 'detenido' : 'reiniciado'}`);
    setTimeout(loadServer, 1000);
  } else {
    alert(`❌ Error: ${result?.data?.error || 'Error en la acción'}`);
    if (btn) btn.disabled = false;
  }
};

const setupTabs = () => {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(`${tab.dataset.tab}-tab`);
      if (target) target.classList.add('active');
    });
  });
};

// 🔥 ESTA ES LA FUNCIÓN CLAVE A PRUEBA DE BALAS 🔥
const setupStartupForm = () => {
  const startupForm = document.getElementById('startupForm');
  if (!startupForm) {
    console.error('ERROR CRÍTICO: No se encontró el formulario con id="startupForm"');
    return;
  }

  startupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const repoInput = document.getElementById('repoUrl');
    const nodeSelect = document.getElementById('nodeVersion');
    
    const repoUrl = repoInput ? repoInput.value.trim() : '';
    const nodeVersion = nodeSelect ? nodeSelect.value : '20';

    if (!repoUrl) {
      alert('⚠️ Por favor, escribe la URL del repositorio primero.');
      return;
    }

    try {
      const result = await apiFetch(`/servers/${serverId}/startup`, {
        method: 'PUT',
        body: JSON.stringify({ repo_url: repoUrl, node_version: nodeVersion })
      });

      if (result && result.ok) {
        alert('✅ ¡Startup actualizado correctamente!');
        
        // Actualizar UI de forma segura
        const successEl = document.getElementById('startupSuccess');
        if (successEl) {
          successEl.textContent = 'Startup actualizado correctamente';
          successEl.style.display = 'block';
        }
        if (serverData) {
          serverData.repo_url = repoUrl;
          serverData.node_version = nodeVersion;
          updateServerUI();
        }
      } else {
        const errorMsg = result?.data?.error || `Error del servidor (Status: ${result?.status})`;
        alert('❌ Error al guardar: ' + errorMsg);
        
        const errorEl = document.getElementById('startupError');
        if (errorEl) {
          errorEl.textContent = errorMsg;
          errorEl.style.display = 'block';
        }
      }
    } catch (err) {
      console.error('Error inesperado en setupStartupForm:', err);
      alert('❌ Error de red inesperado: ' + err.message);
    }
  });
};

const setupReinstall = () => {
  const reinstallBtn = document.getElementById('reinstallBtn');
  if (!reinstallBtn) return;

  reinstallBtn.addEventListener('click', async () => {
    if (!serverData || !serverData.repo_url) {
      alert('⚠️ Primero configura la URL del repositorio en la pestaña Startup');
      return;
    }
    if (!confirm('¿Estás seguro de reinstalar? Se eliminarán todos los archivos actuales.')) return;

    reinstallBtn.disabled = true;
    reinstallBtn.textContent = 'Reinstalando...';

    const result = await apiFetch(`/servers/${serverId}/reinstall`, { method: 'POST' });

    if (result && result.ok) {
      alert('✅ Reinstalación iniciada. Revisa la consola.');
      document.querySelector('[data-tab="console"]')?.click();
    } else {
      alert('❌ Error al reinstalar: ' + (result?.data?.error || 'Desconocido'));
    }
    
    reinstallBtn.disabled = false;
    reinstallBtn.textContent = '🔄 Reinstalar Servidor';
  });
};

const setupDeleteModal = () => {
  const deleteBtn = document.getElementById('deleteBtn');
  const deleteModal = document.getElementById('deleteModal');
  if (!deleteBtn || !deleteModal) return;

  deleteBtn.addEventListener('click', () => deleteModal.classList.add('active'));
  
  const closeBtn = document.getElementById('closeDeleteModal');
  const cancelBtn = document.getElementById('cancelDelete');
  const confirmBtn = document.getElementById('confirmDelete');

  const closeModal = () => deleteModal.classList.remove('active');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) closeModal(); });

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      const result = await apiFetch(`/servers/${serverId}`, { method: 'DELETE' });
      if (result && result.ok) {
        alert('✅ Servidor eliminado');
        window.location.href = '/dashboard.html';
      } else {
        alert('❌ Error al eliminar: ' + (result?.data?.error || 'Desconocido'));
        confirmBtn.disabled = false;
      }
    });
  }
};

const setupRenewModal = () => {
  const renewBtn = document.getElementById('renewBtn');
  const renewModal = document.getElementById('renewModal');
  if (!renewBtn || !renewModal) return;

  renewBtn.addEventListener('click', async () => {
    renewModal.classList.add('active');
    const plansResult = await apiFetch('/servers/plans');
    if (plansResult && plansResult.ok && serverData) {
      const plan = plansResult.data.plans[serverData.plan];
      const costEl = document.getElementById('renewCost');
      if (costEl) costEl.textContent = plan.coins;
    }
  });

  const closeBtn = document.getElementById('closeRenewModal');
  const cancelBtn = document.getElementById('cancelRenew');
  const confirmBtn = document.getElementById('confirmRenew');

  const closeModal = () => renewModal.classList.remove('active');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  renewModal.addEventListener('click', (e) => { if (e.target === renewModal) closeModal(); });

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      const result = await apiFetch(`/servers/${serverId}/renew`, { method: 'POST' });
      if (result && result.ok) {
        alert('✅ Servidor renovado exitosamente');
        closeModal();
        loadServer();
        initUserUI();
      } else {
        alert('❌ Error al renovar: ' + (result?.data?.error || 'Desconocido'));
        confirmBtn.disabled = false;
      }
    });
  }
};

const capitalizeFirst = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : '';