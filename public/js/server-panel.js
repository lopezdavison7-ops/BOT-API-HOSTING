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
    showNotification('Servidor no encontrado', 'error');
    setTimeout(() => window.location.href = '/dashboard.html', 1500);
    return;
  }
  serverData = result.data.server;
  updateServerUI();
};

const updateServerUI = () => {
  document.getElementById('serverName').textContent = serverData.name;
  document.getElementById('serverPlan').textContent = capitalizeFirst(serverData.plan);
  document.getElementById('serverExpires').textContent = formatDate(serverData.expires_at);
  document.getElementById('serverNode').textContent = `v${serverData.node_version}`;
  document.getElementById('serverRepo').textContent = serverData.repo_url || 'No configurado';
  document.getElementById('serverId').textContent = serverData.id;
  document.getElementById('serverCreated').textContent = formatDate(serverData.created_at);
  document.getElementById('serverCost').textContent = `${serverData.coins_cost} coins`;

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('serverStatus');

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

  if (serverData.repo_url) document.getElementById('repoUrl').value = serverData.repo_url;
  document.getElementById('nodeVersion').value = serverData.node_version;

  updateButtons();
};

const updateButtons = () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const restartBtn = document.getElementById('restartBtn');
  const consoleInput = document.getElementById('consoleInput');
  const sendCommand = document.getElementById('sendCommand');

  if (serverData.isRunning) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    restartBtn.disabled = false;
    consoleInput.disabled = false;
    sendCommand.disabled = false;
  } else {
    startBtn.disabled = serverData.status === 'expired';
    stopBtn.disabled = true;
    restartBtn.disabled = serverData.status === 'expired';
    consoleInput.disabled = true;
    sendCommand.disabled = true;
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

  document.getElementById('clearConsole').addEventListener('click', () => consoleOutput.innerHTML = '');

  const consoleInput = document.getElementById('consoleInput');
  const sendCommandBtn = document.getElementById('sendCommand');

  consoleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendCmd(); });
  sendCommandBtn.addEventListener('click', sendCmd);

  function sendCmd() {
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
    consoleOutput.innerHTML = '';
    logs.forEach(log => addConsoleLine(log));
  }
};

const setupActions = () => {
  document.getElementById('startBtn').addEventListener('click', async () => await serverAction('start'));
  document.getElementById('stopBtn').addEventListener('click', async () => await serverAction('stop'));
  document.getElementById('restartBtn').addEventListener('click', async () => await serverAction('restart'));
};

const serverAction = async (action) => {
  const btn = document.getElementById(`${action}Btn`);
  btn.disabled = true;
  const result = await apiFetch(`/servers/${serverId}/${action}`, { method: 'POST' });
  if (result && result.ok) {
    showNotification(`Servidor ${action === 'start' ? 'iniciado' : action === 'stop' ? 'detenido' : 'reiniciado'}`, 'success');
    setTimeout(loadServer, 1000);
  } else {
    showNotification(result?.data?.error || 'Error en la acción', 'error');
    btn.disabled = false;
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
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    });
  });
};

const setupStartupForm = () => {
  const startupForm = document.getElementById('startupForm');
  const startupError = document.getElementById('startupError');
  const startupSuccess = document.getElementById('startupSuccess');

  startupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    startupError.style.display = 'none';
    startupSuccess.style.display = 'none';

    const repoUrl = document.getElementById('repoUrl').value.trim();
    const nodeVersion = document.getElementById('nodeVersion').value;

    const result = await apiFetch(`/servers/${serverId}/startup`, {
      method: 'PUT',
      body: JSON.stringify({ repo_url: repoUrl, node_version: nodeVersion, language: 'node' })
    });

    if (result && result.ok) {
      startupSuccess.textContent = 'Startup actualizado correctamente';
      startupSuccess.style.display = 'block';
      serverData.repo_url = repoUrl;
      serverData.node_version = nodeVersion;
      updateServerUI();
    } else {
      startupError.textContent = result?.data?.error || 'Error al actualizar startup';
      startupError.style.display = 'block';
    }
  });
};

const setupReinstall = () => {
  const reinstallBtn = document.getElementById('reinstallBtn');
  const reinstallError = document.getElementById('reinstallError');
  const reinstallSuccess = document.getElementById('reinstallSuccess');

  reinstallBtn.addEventListener('click', async () => {
    if (!serverData.repo_url) {
      reinstallError.textContent = 'Primero configura la URL del repositorio en Startup';
      reinstallError.style.display = 'block';
      return;
    }
    if (!confirm('¿Estás seguro de reinstalar? Se eliminarán todos los archivos actuales.')) return;

    reinstallError.style.display = 'none';
    reinstallSuccess.style.display = 'none';
    reinstallBtn.disabled = true;
    reinstallBtn.textContent = 'Reinstalando...';

    document.querySelector('[data-tab="console"]').click();
    const result = await apiFetch(`/servers/${serverId}/reinstall`, { method: 'POST' });

    if (result && result.ok) {
      reinstallSuccess.textContent = 'Reinstalación iniciada. Revisa la consola.';
      reinstallSuccess.style.display = 'block';
    } else {
      reinstallError.textContent = result?.data?.error || 'Error al reinstalar';
      reinstallError.style.display = 'block';
    }
    reinstallBtn.disabled = false;
    reinstallBtn.textContent = '🔄 Reinstalar Servidor';
  });
};

const setupDeleteModal = () => {
  const deleteBtn = document.getElementById('deleteBtn');
  const deleteModal = document.getElementById('deleteModal');
  const closeDeleteModal = document.getElementById('closeDeleteModal');
  const cancelDelete = document.getElementById('cancelDelete');
  const confirmDelete = document.getElementById('confirmDelete');
  const deleteError = document.getElementById('deleteError');

  deleteBtn.addEventListener('click', () => deleteModal.classList.add('active'));
  closeDeleteModal.addEventListener('click', () => deleteModal.classList.remove('active'));
  cancelDelete.addEventListener('click', () => deleteModal.classList.remove('active'));
  deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) deleteModal.classList.remove('active'); });

  confirmDelete.addEventListener('click', async () => {
    confirmDelete.disabled = true;
    const result = await apiFetch(`/servers/${serverId}`, { method: 'DELETE' });
    if (result && result.ok) {
      showNotification('Servidor eliminado', 'success');
      setTimeout(() => window.location.href = '/dashboard.html', 1000);
    } else {
      deleteError.textContent = result?.data?.error || 'Error al eliminar';
      deleteError.style.display = 'block';
      confirmDelete.disabled = false;
    }
  });
};

const setupRenewModal = () => {
  const renewBtn = document.getElementById('renewBtn');
  const renewModal = document.getElementById('renewModal');
  const closeRenewModal = document.getElementById('closeRenewModal');
  const cancelRenew = document.getElementById('cancelRenew');
  const confirmRenew = document.getElementById('confirmRenew');
  const renewError = document.getElementById('renewError');
  const renewSuccess = document.getElementById('renewSuccess');

  renewBtn.addEventListener('click', async () => {
    renewModal.classList.add('active');
    const plansResult = await apiFetch('/servers/plans');
    if (plansResult && plansResult.ok) {
      const plan = plansResult.data.plans[serverData.plan];
      document.getElementById('renewCost').textContent = plan.coins;
    }
  });

  closeRenewModal.addEventListener('click', () => renewModal.classList.remove('active'));
  cancelRenew.addEventListener('click', () => renewModal.classList.remove('active'));
  renewModal.addEventListener('click', (e) => { if (e.target === renewModal) renewModal.classList.remove('active'); });

  confirmRenew.addEventListener('click', async () => {
    confirmRenew.disabled = true;
    renewError.style.display = 'none';
    renewSuccess.style.display = 'none';
    const result = await apiFetch(`/servers/${serverId}/renew`, { method: 'POST' });
    if (result && result.ok) {
      renewSuccess.textContent = 'Servidor renovado exitosamente';
      renewSuccess.style.display = 'block';
      setTimeout(() => { renewModal.classList.remove('active'); loadServer(); initUserUI(); }, 1500);
    } else {
      renewError.textContent = result?.data?.error || 'Error al renovar';
      renewError.style.display = 'block';
    }
    confirmRenew.disabled = false;
  });
};

const capitalizeFirst = (str) => str.charAt(0).toUpperCase() + str.slice(1);