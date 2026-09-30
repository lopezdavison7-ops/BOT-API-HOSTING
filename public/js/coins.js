let selectedPackage = null;
let currentTransactionId = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;
  
  checkPaymentReturn();
  loadBalance();
  loadPackages();
  loadTransactions();
});

const checkPaymentReturn = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const transactionId = urlParams.get('tx');
  
  if (token && transactionId) {
    capturePayment(token, transactionId);
  }
};

const capturePayment = async (paypalToken, transactionId) => {
  const paymentModal = document.getElementById('paymentModal');
  const paymentError = document.getElementById('paymentError');
  
  paymentModal.classList.add('active');
  
  const result = await apiFetch('/coins/capture-order', {
    method: 'POST',
    body: JSON.stringify({ orderId: paypalToken, transactionId })
  });
  
  if (result && result.ok) {
    showNotification(`${result.data.addedCoins} coins agregados exitosamente`, 'success');
    paymentModal.classList.remove('active');
    
    window.history.replaceState({}, '', '/coins.html');
    
    loadBalance();
    loadTransactions();
  } else {
    paymentError.textContent = result?.data?.error || 'Error al procesar el pago';
    paymentError.style.display = 'block';
  }
};

const loadBalance = async () => {
  const result = await apiFetch('/coins/balance');
  
  if (result && result.ok) {
    const coins = result.data.coins;
    document.getElementById('balanceAmount').textContent = formatCoins(coins);
    document.getElementById('userCoins').textContent = formatCoins(coins);
  }
};

const loadPackages = async () => {
  const packagesGrid = document.getElementById('packagesGrid');
  
  const result = await apiFetch('/coins/packages');
  
  if (!result || !result.ok) {
    packagesGrid.innerHTML = '<div class="loading-spinner">Error al cargar paquetes</div>';
    return;
  }
  
  const packages = result.data.packages;
  
  packagesGrid.innerHTML = packages.map(pkg => `
    <div class="package-card" data-coins="${pkg.coins}" data-price="${pkg.price}">
      <div class="package-coins">${pkg.coins} <span>coins</span></div>
      <div class="package-price">$${pkg.price.toFixed(2)} USD</div>
      <button class="btn btn-primary btn-sm">Comprar</button>
    </div>
  `).join('');
  
  document.querySelectorAll('.package-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedPackage = {
        coins: parseInt(card.dataset.coins),
        price: parseFloat(card.dataset.price)
      };
      buyPackage();
    });
  });
};

const buyPackage = async () => {
  if (!selectedPackage) return;
  
  const paymentModal = document.getElementById('paymentModal');
  const paymentError = document.getElementById('paymentError');
  const cancelPayment = document.getElementById('cancelPayment');
  
  paymentError.style.display = 'none';
  paymentModal.classList.add('active');
  
  const result = await apiFetch('/coins/create-order', {
    method: 'POST',
    body: JSON.stringify({ coins: selectedPackage.coins })
  });
  
  if (result && result.ok) {
    currentTransactionId = result.data.transactionId;
    const approveUrl = result.data.approveUrl;
    
    setTimeout(() => {
      window.location.href = approveUrl;
    }, 1000);
  } else {
    paymentError.textContent = result?.data?.error || 'Error al crear la orden de pago';
    paymentError.style.display = 'block';
    paymentModal.classList.remove('active');
  }
};

const loadTransactions = async () => {
  const transactionsBody = document.getElementById('transactionsBody');
  
  const result = await apiFetch('/coins/transactions');
  
  if (!result || !result.ok) {
    transactionsBody.innerHTML = '<tr><td colspan="5" class="loading-spinner">Error al cargar transacciones</td></tr>';
    return;
  }
  
  const transactions = result.data.transactions;
  
  if (transactions.length === 0) {
    transactionsBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">No hay transacciones aún</td></tr>';
    return;
  }
  
  transactionsBody.innerHTML = transactions.map(tx => {
    const statusClass = tx.status;
    const statusText = tx.status === 'completed' ? 'Completado' : 
                       tx.status === 'pending' ? 'Pendiente' : 'Fallido';
    
    return `
      <tr>
        <td>${formatDate(tx.created_at)}</td>
        <td><strong>${tx.coins}</strong> coins</td>
        <td>$${parseFloat(tx.amount_usd).toFixed(2)}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${tx.paypal_order_id || '-'}</td>
      </tr>
    `;
  }).join('');
};

document.getElementById('cancelPayment').addEventListener('click', () => {
  document.getElementById('paymentModal').classList.remove('active');
});