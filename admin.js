(function () {
  'use strict';

  const API_URL = window.APP_CONFIG.API_URL;
  const STORAGE_KEY = 'lista_nascimento_admin_key';

  const state = {
    apiKey: sessionStorage.getItem(STORAGE_KEY) || '',
    products: [],
    reservations: [],
    activeTab: 'products'
  };

  const els = {
    loginView: document.getElementById('login-view'),
    appView: document.getElementById('app-view'),
    adminKeyInput: document.getElementById('admin-key'),
    loginBtn: document.getElementById('login-btn'),
    loginError: document.getElementById('login-error'),
    tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
    tabProducts: document.getElementById('tab-products'),
    tabReservations: document.getElementById('tab-reservations'),
    productsTableWrap: document.getElementById('products-table-wrap'),
    reservationsTableWrap: document.getElementById('reservations-table-wrap'),
    addProductBtn: document.getElementById('add-product-btn'),
    refreshReservationsBtn: document.getElementById('refresh-reservations-btn'),
    productModalOverlay: document.getElementById('product-modal-overlay'),
    productModalTitle: document.getElementById('product-modal-title'),
    productForm: document.getElementById('product-form'),
    productModalCancel: document.getElementById('product-modal-cancel'),
    productFormMessage: document.getElementById('product-form-message'),
    toast: document.getElementById('toast'),
    pf: {
      id: document.getElementById('pf-id'),
      name: document.getElementById('pf-name'),
      description: document.getElementById('pf-description'),
      category: document.getElementById('pf-category'),
      price: document.getElementById('pf-price'),
      quantity: document.getElementById('pf-quantity'),
      image: document.getElementById('pf-image'),
      purchase: document.getElementById('pf-purchase')
    }
  };

  init();

  function init() {
    els.loginBtn.addEventListener('click', handleLogin);
    els.adminKeyInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleLogin();
    });
    els.tabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
    els.addProductBtn.addEventListener('click', function () { openProductModal(null); });
    els.refreshReservationsBtn.addEventListener('click', loadReservations);
    els.productModalCancel.addEventListener('click', closeProductModal);
    els.productForm.addEventListener('submit', handleProductSubmit);

    if (state.apiKey) {
      showApp();
    }
  }

  function handleLogin() {
    const key = els.adminKeyInput.value.trim();
    if (!key) return;
    state.apiKey = key;
    sessionStorage.setItem(STORAGE_KEY, key);
    els.loginError.textContent = '';
    showApp();
  }

  function showApp() {
    els.loginView.style.display = 'none';
    els.appView.style.display = 'block';
    loadProducts();
  }

  function logout(message) {
    sessionStorage.removeItem(STORAGE_KEY);
    state.apiKey = '';
    els.appView.style.display = 'none';
    els.loginView.style.display = 'block';
    els.loginError.textContent = message || '';
  }

  function switchTab(tab) {
    state.activeTab = tab;
    els.tabButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    els.tabProducts.style.display = tab === 'products' ? 'block' : 'none';
    els.tabReservations.style.display = tab === 'reservations' ? 'block' : 'none';
    if (tab === 'reservations' && state.reservations.length === 0) {
      loadReservations();
    }
  }

  // ------------------------------------------------------------------
  // Produtos
  // ------------------------------------------------------------------

  function loadProducts() {
    apiGet('admin_products')
      .then(function (data) {
        state.products = data.products || [];
        renderProductsTable();
      })
      .catch(handleApiError);
  }

  function renderProductsTable() {
    if (state.products.length === 0) {
      els.productsTableWrap.innerHTML = '<div class="empty-state">Ainda não há produtos. Adiciona o primeiro.</div>';
      return;
    }

    const rows = state.products.map(function (p) {
      const statusClass = p.active ? 'active' : 'inactive';
      const statusLabel = p.active ? 'Ativo' : 'Inativo';
      return (
        '<tr>' +
          '<td>' + escapeHtml(p.name) + '</td>' +
          '<td>' + escapeHtml(p.category || '—') + '</td>' +
          '<td>' + (p.price ? Number(p.price).toFixed(2) + ' €' : '—') + '</td>' +
          '<td>' + p.reserved_quantity + ' / ' + p.desired_quantity + '</td>' +
          '<td><span class="status-pill ' + statusClass + '">' + statusLabel + '</span></td>' +
          '<td>' +
            '<button class="icon-btn" data-edit-id="' + escapeAttr(p.id) + '">Editar</button> ' +
            '<button class="icon-btn" data-toggle-id="' + escapeAttr(p.id) + '">' + (p.active ? 'Desativar' : 'Ativar') + '</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    els.productsTableWrap.innerHTML =
      '<table class="admin-table">' +
        '<thead><tr><th>Nome</th><th>Categoria</th><th>Preço</th><th>Reservado</th><th>Estado</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';

    Array.from(els.productsTableWrap.querySelectorAll('[data-edit-id]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        const p = state.products.find(function (x) { return String(x.id) === btn.getAttribute('data-edit-id'); });
        if (p) openProductModal(p);
      });
    });
    Array.from(els.productsTableWrap.querySelectorAll('[data-toggle-id]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleActive(btn.getAttribute('data-toggle-id'));
      });
    });
  }

  function openProductModal(product) {
    els.productFormMessage.textContent = '';
    els.productModalTitle.textContent = product ? 'Editar produto' : 'Novo produto';
    els.pf.id.value = product ? product.id : '';
    els.pf.name.value = product ? product.name : '';
    els.pf.description.value = product ? product.description : '';
    els.pf.category.value = product ? product.category : '';
    els.pf.price.value = product ? product.price : '';
    els.pf.quantity.value = product ? product.desired_quantity : '';
    els.pf.image.value = product ? product.image_url : '';
    els.pf.purchase.value = product ? product.purchase_url : '';
    els.productModalOverlay.classList.remove('hidden');
  }

  function closeProductModal() {
    els.productModalOverlay.classList.add('hidden');
  }

  function handleProductSubmit(e) {
    e.preventDefault();
    const id = els.pf.id.value;
    const payload = {
      name: els.pf.name.value.trim(),
      description: els.pf.description.value.trim(),
      category: els.pf.category.value.trim(),
      price: parseFloat(els.pf.price.value) || 0,
      desired_quantity: parseInt(els.pf.quantity.value, 10) || 0,
      image_url: els.pf.image.value.trim(),
      purchase_url: els.pf.purchase.value.trim()
    };

    const action = id ? 'update_product' : 'add_product';
    if (id) payload.id = id;

    apiPost(action, payload)
      .then(function (data) {
        if (data.error) {
          els.productFormMessage.textContent = data.error;
          els.productFormMessage.className = 'form-message error';
          return;
        }
        closeProductModal();
        showToast('Produto guardado.');
        loadProducts();
      })
      .catch(handleApiError);
  }

  function toggleActive(id) {
    apiPost('toggle_active', { id: id })
      .then(function (data) {
        if (data.error) { showToast(data.error); return; }
        loadProducts();
      })
      .catch(handleApiError);
  }

  // ------------------------------------------------------------------
  // Reservas
  // ------------------------------------------------------------------

  function loadReservations() {
    els.reservationsTableWrap.innerHTML = '<div class="loading-state">A carregar reservas…</div>';
    apiGet('admin_reservations')
      .then(function (data) {
        state.reservations = data.reservations || [];
        renderReservationsTable();
      })
      .catch(handleApiError);
  }

  function renderReservationsTable() {
    if (state.reservations.length === 0) {
      els.reservationsTableWrap.innerHTML = '<div class="empty-state">Ainda não há reservas.</div>';
      return;
    }

    const rows = state.reservations.map(function (r) {
      const canCancel = r.status === 'confirmed' || r.status === 'pending';
      return (
        '<tr>' +
          '<td>' + escapeHtml(r.product_name) + '</td>' +
          '<td>' + escapeHtml(r.guest_name) + '</td>' +
          '<td>' + escapeHtml(String(r.quantity)) + '</td>' +
          '<td>' + escapeHtml(r.message || '—') + '</td>' +
          '<td><span class="status-pill ' + escapeAttr(r.status) + '">' + escapeHtml(r.status) + '</span></td>' +
          '<td>' + (canCancel ? '<button class="icon-btn" data-cancel-id="' + escapeAttr(r.id) + '">Cancelar</button>' : '—') + '</td>' +
        '</tr>'
      );
    }).join('');

    els.reservationsTableWrap.innerHTML =
      '<table class="admin-table">' +
        '<thead><tr><th>Produto</th><th>Convidado</th><th>Qtd.</th><th>Mensagem</th><th>Estado</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';

    Array.from(els.reservationsTableWrap.querySelectorAll('[data-cancel-id]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Cancelar esta reserva?')) return;
        apiPost('cancel_reservation', { id: btn.getAttribute('data-cancel-id') })
          .then(function (data) {
            if (data.error) { showToast(data.error); return; }
            loadReservations();
            loadProducts();
          })
          .catch(handleApiError);
      });
    });
  }

  // ------------------------------------------------------------------
  // API helpers
  // ------------------------------------------------------------------

  function fetchWithRetry(url, options, retries, delay) {
    retries = (retries !== undefined) ? retries : 2;
    delay = (delay !== undefined) ? delay : 1000;

    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, 20000); // 20s timeout

    const fetchOptions = Object.assign({}, options || {}, { signal: controller.signal });

    return fetch(url, fetchOptions)
      .then(function (res) {
        clearTimeout(timeoutId);
        return res.json();
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        if (retries > 0) {
          return new Promise(function (resolve) {
            setTimeout(resolve, delay);
          }).then(function () {
            return fetchWithRetry(url, options, retries - 1, delay * 2);
          });
        }
        throw err;
      });
  }

  function apiGet(action) {
    return fetchWithRetry(API_URL + '?action=' + encodeURIComponent(action) + '&apiKey=' + encodeURIComponent(state.apiKey))
      .then(checkAuthError);
  }

  function apiPost(action, payload) {
    const body = Object.assign({ action: action, apiKey: state.apiKey }, payload);
    return fetchWithRetry(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }, 1, 1500)
      .then(checkAuthError);
  }

  function checkAuthError(data) {
    if (data && data.status === 401) {
      logout('Chave de administrador inválida.');
      throw new Error('unauthorized');
    }
    return data;
  }

  function handleApiError(err) {
    if (err && err.message === 'unauthorized') return;
    console.error(err);
    showToast('Ocorreu um erro. Tenta novamente.');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    setTimeout(function () { els.toast.classList.add('hidden'); }, 3000);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }
})();
