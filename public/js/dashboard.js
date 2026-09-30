document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;
  
  loadServers();
  loadStats();
  setupBuyModal();
});

const loadServers = async () => {
  const serversGrid = document.getElementById('serversGrid');
  
  const result = await apiFetch('/servers/my-servers');
  
  if (!result || !result.ok) {
    serversGrid.innerHTML = '<div class="loading-spinner">Error al cargar servidores</div>';
    return;
  }
  
  const servers = result.data.servers;
  
  if (servers.length === 0) {
    serversGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
        <div style="font-size: 4rem; margin-bottom: 15px;">🤖</div>
        <h3 style="margin-bottom: 10px;">No tienes servidores</h3>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">Compra tu primer servidor para comenzar a hospedar tus bots</p>
        <button class="btn btn-primary" onclick="document.getElementById('buyModal').classList.add('active')">+ Comprar Servidor</button>
      </div>
    `;
    return;
  }
  
  serversGrid.innerHTML = servers.map(server => {
    const daysRemaining = getDaysRemaining(server.expires_at);
    const statusClass = server.isRunning ? 'running' : server.status;
    const statusText = server.isRunning ? 'Corriendo' : 
                       server.status === 'expired' ? 'Expirado' :
                       server.status === 'installing' ? 'Instalando' : 'Detenido';
    
    return `
      <div class="server-card">
        <div class="server-card-header">
          <span class="server-card-name">${escapeHtml(server.name)}</span>
          <div class="server-status">
            <span class="status-dot ${statusClass}"></span>
            <span>${statusText}</span>
          </div>
        </div>
        <div class="server-card-info">
          <p><span>Plan:</span> <strong>${capitalizeFirst(server.plan)}</strong></p>
          <p><span>Vence:</span> <strong>${daysRemaining} días</strong></p>
          <p><span>Node.js:</span> <strong>v${server.node_version}</strong></p>
        </div>
        <div class="server-card-actions">
          <a href="/server.html?id=${server.id}" class="btn btn-primary btn-sm">Gestionar</a>
          ${server.status === 'expired' 
            ? `<button class="btn btn-outline btn-sm" onclick="renewServer('${server.id}')">Renovar</button>`
            : ''
          }
        </div>
      </div>
    `;
  }).join('');
};

const loadStats = async () => {
  const result = await apiFetch('/servers/my-servers');
  
  if (!result || !result.ok) return;
  
  const servers = result.data.servers;
  
  document.getElementById('totalServers').textContent = servers.length;
  document.getElementById('activeServers').textContent = servers.filter(s => s.isRunning).length;
  
  const balanceResult = await apiFetch('/coins/balance');
  if (balanceResult && balanceResult.ok) {
    document.getElementById('balanceCoins').textContent = formatCoins(balanceResult.data.coins);
  }
};

const setupBuyModal = () => {
  const buyModal = document.getElementById('buyModal');
  const buyServerBtn = document.getElementById('buyServerBtn');
  const closeModal = document.getElementById('closeModal');
  const buyForm = document.getElementById('buyForm');
  const plansGrid = document.getElementById('plansGrid');
  const buyError = document.getElementById('buyError');
  const buyBtn = document.getElementById('buyBtn');
  
  let selectedPlan = null;
  
  buyServerBtn.addEventListener('click', async () => {
    buyModal.classList.add('active');
    await loadPlans();
  });
  
  closeModal.addEventListener('click', () => {
    buyModal.classList.remove('active');
  });
  
  buyModal.addEventListener('click', (e) => {
    if (e.target === buyModal) {
      buyModal.classList.remove('active');
    }
  });
  
  const loadPlans = async () => {
    const result = await apiFetch('/servers/plans');
    
    if (!result || !result.ok) {
      plansGrid.innerHTML = '<div class="loading-spinner">Error al cargar planes</div>';
      return;
    }
    
    const plans = result.data.plans;
    
    plansGrid.innerHTML = Object.entries(plans).map(([key, plan]) => `
      <div class="plan-option" data-plan="${key}">
        <div class="plan-option-name">${plan.name}</div>
        <div class="plan-option-price">${plan.coins} coins</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 5px;">${plan.bots} bot(s) / ${plan.dias} días</div>
      </div>
    `).join('');
    
    document.querySelectorAll('.plan-option').forEach(option => {
      option.addEventListener('click', () => {
        document.querySelectorAll('.plan-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        selectedPlan = option.dataset.plan;
      });
    });
  };
  
  buyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    buyError.style.display = 'none';
    
    const serverName = document.getElementById('serverName').value.trim();
    
    if (!serverName) {
      buyError.textContent = 'Ingresa un nombre para el servidor';
      buyError.style.display = 'block';
      return;
    }
    
    if (!selectedPlan) {
      buyError.textContent = 'Selecciona un plan';
      buyError.style.display = 'block';
      return;
    }
    
    buyBtn.disabled = true;
    buyBtn.textContent = 'Comprando...';
    
    const result = await apiFetch('/servers/buy', {
      method: 'POST',
      body: JSON.stringify({ plan: selectedPlan, name: serverName })
    });
    
    if (result && result.ok) {
      showNotification('Servidor comprado exitosamente', 'success');
      buyModal.classList.remove('active');
      buyForm.reset();
      selectedPlan = null;
      document.querySelectorAll('.plan-option').forEach(o => o.classList.remove('selected'));
      loadServers();
      loadStats();
    } else {
      buyError.textContent = result?.data?.error || 'Error al comprar servidor';
      buyError.style.display = 'block';
    }
    
    buyBtn.disabled = false;
    buyBtn.textContent = 'Comprar Servidor';
  });
};

const renewServer = async (serverId) => {
  const result = await apiFetch(`/servers/${serverId}/renew`, { method: 'POST' });
  
  if (result && result.ok) {
    showNotification('Servidor renovado exitosamente', 'success');
    loadServers();
    loadStats();
  } else {
    showNotification(result?.data?.error || 'Error al renovar', 'error');
  }
};

const escapeHtml = (text) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

const capitalizeFirst = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};