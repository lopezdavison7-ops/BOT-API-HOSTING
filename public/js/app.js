const API_BASE = '/api';

const getToken = () => localStorage.getItem('token');
const getUser = () => JSON.parse(localStorage.getItem('user') || 'null');
const isLoggedIn = () => !!getToken();
const isAdmin = () => getUser()?.role === 'admin';

const setAuth = (token, user) => {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
};

const clearAuth = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

const logout = () => {
  clearAuth();
  window.location.href = '/login.html';
};

const requireAuth = () => {
  if (!isLoggedIn()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
};

const requireAdmin = () => {
  if (!requireAuth()) return false;
  if (!isAdmin()) {
    window.location.href = '/dashboard.html';
    return false;
  }
  return true;
};

const apiFetch = async (endpoint, options = {}) => {
  const token = getToken();
  
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };
  
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const data = await response.json();
    
    if (response.status === 401) {
      clearAuth();
      window.location.href = '/login.html';
      return null;
    }
    
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 500, data: { error: 'Error de conexión' } };
  }
};

const formatCoins = (coins) => {
  return parseFloat(coins).toLocaleString('es-MX', { 
    minimumFractionDigits: 0, 
    maximumFractionDigits: 2 
  });
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatDateOnly = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const getDaysRemaining = (expiresAt) => {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffTime = expires - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

const showNotification = (message, type = 'info') => {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 25px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 10000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#6366f1'
  };
  
  notification.style.background = colors[type] || colors.info;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
};

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

const initUserUI = async () => {
  const user = getUser();
  if (!user) return;
  
  const userNameEl = document.getElementById('userName');
  const userCoinsEl = document.getElementById('userCoins');
  
  if (userNameEl) userNameEl.textContent = user.username;
  
  if (userCoinsEl) {
    const result = await apiFetch('/coins/balance');
    if (result && result.ok) {
      userCoinsEl.textContent = formatCoins(result.data.coins);
    } else {
      userCoinsEl.textContent = formatCoins(user.coins || 0);
    }
  }
};

const initLogout = () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }
};

const initProfileLink = () => {
  const profileLink = document.getElementById('profileLink');
  if (profileLink) {
    profileLink.addEventListener('click', (e) => {
      e.preventDefault();
      showNotification('Función de perfil próximamente', 'info');
    });
  }
};

const initCommonUI = () => {
  initLogout();
  initProfileLink();
  initUserUI();
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('dashboard-page')) {
    initCommonUI();
  }
});