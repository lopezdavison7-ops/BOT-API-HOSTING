let currentSection = 'stats';
let usersPage = 1;
let serversPage = 1;
let transactionsPage = 1;
let selectedUserId = null;
let selectedServerId = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAdmin()) return;
  
  loadStats();
  setupNavigation();
  setupUserSearch();
  setupTransactionFilter();
  setupUserModal();
  setupDeleteServerModal();
});

const setupNavigation = () => {
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      switchSection(section);
    });
  });
};

const switchSection = (section) => {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.querySelector(`[data-section="${section}"]`)?.classList.add('active');
  
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`${section}Section`).classList.add('active');
  
  currentSection = section;
  
  if (section === 'users') loadUsers();
  if (section === 'servers') loadServers();
  if (section === 'transactions') loadTransactions();
};

const loadStats = async () => {
  const result = await apiFetch('/admin/stats');
  
  if (!result || !result.ok) return;
  
  const stats = result.data.stats;
  
  document.getElementById('totalUsers').textContent = stats.totalUsers;
  document.getElementById('totalServers').textContent = stats.totalServers;
  document.getElementById('activeServers').textContent = stats.activeServers;
  document.getElementById('totalRevenue').textContent = `$${stats.totalRevenue.toFixed(2)}`;
  
  const recentUsersBody = document.getElementById('recentUsersBody');
  
  if (stats.recentUsers.length === 0) {
    recentUsersBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 30px;">No hay usuarios aún</td></tr>';
    return;
  }
  
  recentUsersBody.innerHTML = stats.recentUsers.map(user => `
    <tr>
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td>${escapeHtml(user.email)}</td>
      <td>${formatCoins(user.coins)}</td>
      <td>${formatDate(user.created_at)}</td>
    </tr>
  `).join('');
};

const loadUsers = async (page = 1, search = '') => {
  usersPage = page;
  const usersTableBody = document.getElementById('usersTableBody');
  
  let url = `/admin/users?page=${page}&limit=20`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  
  const result = await apiFetch(url);
  
  if (!result || !result.ok) {
    usersTableBody.innerHTML = '<tr><td colspan="6" class="loading-spinner">Error al cargar usuarios</td></tr>';
    return;
  }
  
  const users = result.data.users;
  
  if (users.length === 0) {
    usersTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 30px;">No se encontraron usuarios</td></tr>';
    return;
  }
  
  usersTableBody.innerHTML = users.map(user => `
    <tr>
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td>${escapeHtml(user.email)}</td>
      <td>${formatCoins(user.coins)}</td>
      <td><span class="status-badge ${user.role === 'admin' ? 'failed' : 'completed'}">${user.role}</span></td>
      <td>${formatDateOnly(user.created_at)}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="editUser('${user.id}')">Editar</button>
      </td>
    </tr>
  `).join('');
  
  renderPagination('usersPagination', result.data.totalPages, page, (p) => loadUsers(p, search));
};

const setupUserSearch = () => {
  const searchInput = document.getElementById('userSearch');
  const searchBtn = document.getElementById('searchUsersBtn');
  
  searchBtn.addEventListener('click', () => {
    loadUsers(1, searchInput.value.trim());
  });
  
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loadUsers(1, searchInput.value.trim());
    }
  });
};

const loadServers = async (page = 1) => {
  serversPage = page;
  const serversTableBody = document.getElementById('serversTableBody');
  
  const result = await apiFetch(`/admin/servers?page=${page}&limit=20`);
  
  if (!result || !result.ok) {
    serversTableBody.innerHTML = '<tr><td colspan="6" class="loading-spinner">Error al cargar servidores</td></tr>';
    return;
  }
  
  const servers = result.data.servers;
  
  if (servers.length === 0) {
    serversTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 30px;">No hay servidores</td></tr>';
    return;
  }
  
  serversTableBody.innerHTML = servers.map(server => {
    const statusText = server.isRunning ? 'Corriendo' : 
                       server.status === 'expired' ? 'Expirado' :
                       server.status === 'installing' ? 'Instalando' : 'Detenido';
    const statusClass = server.isRunning ? 'completed' : 
                        server.status === 'expired' ? 'failed' : 'pending';
    
    return `
      <tr>
        <td><strong>${escapeHtml(server.name)}</strong></td>
        <td>${escapeHtml(server.username)}</td>
        <td>${capitalizeFirst(server.plan)}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td>${formatDateOnly(server.expires_at)}</td>
        <td>
          ${server.isRunning ? `<button class="btn btn-warning btn-sm" onclick="stopServer('${server.id}')">Detener</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteServer('${server.id}')">Eliminar</button>
        </td>
      </tr>
    `;
  }).join('');
  
  renderPagination('serversPagination', result.data.totalPages, page, loadServers);
};

const loadTransactions = async (page = 1, status = '') => {
  transactionsPage = page;
  const transactionsTableBody = document.getElementById('transactionsTableBody');
  
  let url = `/admin/transactions?page=${page}&limit=20`;
  if (status) url += `&status=${status}`;
  
  const result = await apiFetch(url);
  
  if (!result || !result.ok) {
    transactionsTableBody.innerHTML = '<tr><td colspan="6" class="loading-spinner">Error al cargar transacciones</td></tr>';
    return;
  }
  
  const transactions = result.data.transactions;
  
  if (transactions.length === 0) {
    transactionsTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 30px;">No hay transacciones</td></tr>';
    return;
  }
  
  transactionsTableBody.innerHTML = transactions.map(tx => {
    const statusText = tx.status === 'completed' ? 'Completado' : 
                       tx.status === 'pending' ? 'Pendiente' : 'Fallido';
    
    return `
      <tr>
        <td>${formatDate(tx.created_at)}</td>
        <td>${escapeHtml(tx.username)}</td>
        <td>${formatCoins(tx.coins)}</td>
        <td>$${parseFloat(tx.amount_usd).toFixed(2)}</td>
        <td><span class="status-badge ${tx.status}">${statusText}</span></td>
        <td style="font-size: 0.8rem;">${tx.paypal_order_id || '-'}</td>
      </tr>
    `;
  }).join('');
  
  renderPagination('transactionsPagination', result.data.totalPages, page, (p) => loadTransactions(p, status));
};

const setupTransactionFilter = () => {
  const filterSelect = document.getElementById('transactionFilter');
  
  filterSelect.addEventListener('change', () => {
    loadTransactions(1, filterSelect.value);
  });
};

const setupUserModal = () => {
  const userModal = document.getElementById('userModal');
  const closeUserModal = document.getElementById('closeUserModal');
  const userCoinsForm = document.getElementById('userCoinsForm');
  const userModalError = document.getElementById('userModalError');
  const userModalSuccess = document.getElementById('userModalSuccess');
  
  closeUserModal.addEventListener('click', () => userModal.classList.remove('active'));
  
  userModal.addEventListener('click', (e) => {
    if (e.target === userModal) userModal.classList.remove('active');
  });
  
  userCoinsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    userModalError.style.display = 'none';
    userModalSuccess.style.display = 'none';
    
    const action = document.getElementById('coinsAction').value;
    const coins = parseFloat(document.getElementById('coinsAmount').value);
    
    if (!coins || coins <= 0) {
      userModalError.textContent = 'Ingresa una cantidad válida';
      userModalError.style.display = 'block';
      return;
    }
    
    const result = await apiFetch(`/admin/users/${selectedUserId}/coins`, {
      method: 'PUT',
      body: JSON.stringify({ coins, action })
    });
    
    if (result && result.ok) {
      userModalSuccess.textContent = 'Coins actualizados correctamente';
      userModalSuccess.style.display = 'block';
      loadUsers(usersPage);
      loadStats();
    } else {
      userModalError.textContent = result?.data?.error || 'Error al actualizar coins';
      userModalError.style.display = 'block';
    }
  });
  
  document.getElementById('makeUser').addEventListener('click', async () => {
    await changeRole('user');
  });
  
  document.getElementById('makeAdmin').addEventListener('click', async () => {
    await changeRole('admin');
  });
  
  document.getElementById('deleteUserBtn').addEventListener('click', async () => {
    if (!confirm('¿Estás seguro de eliminar este usuario? Se eliminarán todos sus servidores.')) {
      return;
    }
    
    const result = await apiFetch(`/admin/users/${selectedUserId}`, { method: 'DELETE' });
    
    if (result && result.ok) {
      showNotification('Usuario eliminado', 'success');
      userModal.classList.remove('active');
      loadUsers(usersPage);
      loadStats();
    } else {
      userModalError.textContent = result?.data?.error || 'Error al eliminar usuario';
      userModalError.style.display = 'block';
    }
  });
};

const changeRole = async (role) => {
  const userModalError = document.getElementById('userModalError');
  const userModalSuccess = document.getElementById('userModalSuccess');
  
  const result = await apiFetch(`/admin/users/${selectedUserId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role })
  });
  
  if (result && result.ok) {
    userModalSuccess.textContent = `Rol cambiado a ${role}`;
    userModalSuccess.style.display = 'block';
    loadUsers(usersPage);
  } else {
    userModalError.textContent = result?.data?.error || 'Error al cambiar rol';
    userModalError.style.display = 'block';
  }
};

const editUser = async (userId) => {
  selectedUserId = userId;
  
  const result = await apiFetch(`/admin/users/${userId}`);
  
  if (!result || !result.ok) return;
  
  const user = result.data.user;
  
  document.getElementById('modalUsername').textContent = user.username;
  document.getElementById('modalEmail').textContent = user.email;
  document.getElementById('modalCoins').textContent = formatCoins(user.coins);
  document.getElementById('coinsAmount').value = '';
  document.getElementById('userModalError').style.display = 'none';
  document.getElementById('userModalSuccess').style.display = 'none';
  
  document.getElementById('userModal').classList.add('active');
};

const stopServer = async (serverId) => {
  const result = await apiFetch(`/admin/servers/${serverId}/stop`, { method: 'POST' });
  
  if (result && result.ok) {
    showNotification('Servidor detenido', 'success');
    loadServers(serversPage);
    loadStats();
  } else {
    showNotification(result?.data?.error || 'Error al detener servidor', 'error');
  }
};

const setupDeleteServerModal = () => {
  const deleteServerModal = document.getElementById('deleteServerModal');
  const closeDeleteServerModal = document.getElementById('closeDeleteServerModal');
  const cancelDeleteServer = document.getElementById('cancelDeleteServer');
  const confirmDeleteServer = document.getElementById('confirmDeleteServer');
  const deleteServerError = document.getElementById('deleteServerError');
  
  closeDeleteServerModal.addEventListener('click', () => deleteServerModal.classList.remove('active'));
  cancelDeleteServer.addEventListener('click', () => deleteServerModal.classList.remove('active'));
  
  deleteServerModal.addEventListener('click', (e) => {
    if (e.target === deleteServerModal) deleteServerModal.classList.remove('active');
  });
  
  confirmDeleteServer.addEventListener('click', async () => {
    confirmDeleteServer.disabled = true;
    deleteServerError.style.display = 'none';
    
    const result = await apiFetch(`/admin/servers/${selectedServerId}`, { method: 'DELETE' });
    
    if (result && result.ok) {
      showNotification('Servidor eliminado', 'success');
      deleteServerModal.classList.remove('active');
      loadServers(serversPage);
      loadStats();
    } else {
      deleteServerError.textContent = result?.data?.error || 'Error al eliminar servidor';
      deleteServerError.style.display = 'block';
    }
    
    confirmDeleteServer.disabled = false;
  });
};

const confirmDeleteServer = (serverId) => {
  selectedServerId = serverId;
  document.getElementById('deleteServerModal').classList.add('active');
};

const renderPagination = (containerId, totalPages, currentPage, callback) => {
  const container = document.getElementById(containerId);
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = '';
  
  html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="void(0)">←</button>`;
  
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      html += `<button class="${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<span style="padding: 8px;">...</span>';
    }
  }
  
  html += `<button ${currentPage === totalPages ? 'disabled' : ''}>→</button>`;
  
  container.innerHTML = html;
  
  container.querySelectorAll('button:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      if (page) callback(page);
    });
  });
};

const escapeHtml = (text) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

const capitalizeFirst = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};