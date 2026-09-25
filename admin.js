(function () {
  'use strict';

  const SUPABASE_URL = window.APP_CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.APP_CONFIG.SUPABASE_ANON_KEY;
  const STORAGE_KEY = 'lista_nascimento_admin_key';

  // Chave de acesso ao painel de administração (podes alterar para a tua palavra-passe preferida)
  const ADMIN_SECRET = 'Artur2026';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    if (key !== ADMIN_SECRET) {
      els.loginError.textContent = 'Chave incorreta.';
      return;
    }
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

  async function loadProducts() {
    els.productsTableWrap.innerHTML = '<div class="loading-state">A carregar produtos…</div>';
    try {
      const [productsRes, reservationsRes] = await Promise.all([
        supabase
          .from('products')
          .select('*')
          .order('id', { ascending: true }),
        supabase
          .from('reservations')
          .select('product_id, quantity')
          .in('status', ['confirmed', 'pending'])
      ]);

      if (productsRes.error) throw productsRes.error;
      if (reservationsRes.error) throw reservationsRes.error;

      const rawProducts = productsRes.data || [];
      const rawReservations = reservationsRes.data || [];

      const totals = {};
      rawReservations.forEach(function (r) {
        const pId = String(r.product_id);
        totals[pId] = (totals[pId] || 0) + (Number(r.quantity) || 0);
      });

      state.products = rawProducts.map(function (p) {
        return Object.assign({}, p, {
          reserved_quantity: totals[String(p.id)] || 0
        });
      });

      renderProductsTable();
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar produtos.');
    }
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

  async function handleProductSubmit(e) {
    e.preventDefault();
    const id = els.pf.id.value;
    const payload = {
      name: els.pf.name.value.trim(),
      description: els.pf.description.value.trim(),
      category: els.pf.category.value.trim(),
      price: parseFloat(els.pf.price.value) || 0,
      desired_quantity: parseInt(els.pf.quantity.value, 10) || 1,
      image_url: els.pf.image.value.trim(),
      purchase_url: els.pf.purchase.value.trim(),
      updated_at: new Date().toISOString()
    };

    try {
      if (id) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
      } else {
        payload.active = true;
        const { error } = await supabase
          .from('products')
          .insert([payload]);
        if (error) throw error;
      }

      closeProductModal();
      showToast('Produto guardado com sucesso.');
      loadProducts();
    } catch (err) {
      console.error(err);
      els.productFormMessage.textContent = err.message || 'Erro ao guardar produto.';
      els.productFormMessage.className = 'form-message error';
    }
  }

  async function toggleActive(id) {
    const p = state.products.find(function (x) { return String(x.id) === String(id); });
    if (!p) return;

    try {
      const { error } = await supabase
        .from('products')
        .update({ active: !p.active, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      loadProducts();
    } catch (err) {
      console.error(err);
      showToast('Erro ao atualizar estado.');
    }
  }

  // ------------------------------------------------------------------
  // Reservas
  // ------------------------------------------------------------------

  async function loadReservations() {
    els.reservationsTableWrap.innerHTML = '<div class="loading-state">A carregar reservas…</div>';
    try {
      const { data, error } = await supabase
        .from('reservations')
        .select('*, products(name)')
        .order('id', { ascending: false });

      if (error) throw error;

      state.reservations = (data || []).map(function (r) {
        return {
          id: r.id,
          product_name: (r.products && r.products.name) ? r.products.name : '—',
          guest_name: r.guest_name,
          quantity: r.quantity,
          message: r.message,
          status: r.status,
          created_at: r.created_at
        };
      });

      renderReservationsTable();
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar reservas.');
    }
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
      btn.addEventListener('click', async function () {
        if (!confirm('Cancelar esta reserva?')) return;
        const resId = btn.getAttribute('data-cancel-id');
        try {
          const { error } = await supabase
            .from('reservations')
            .update({ status: 'cancelled' })
            .eq('id', resId);

          if (error) throw error;
          showToast('Reserva cancelada.');
          loadReservations();
          loadProducts();
        } catch (err) {
          console.error(err);
          showToast('Erro ao cancelar reserva.');
        }
      });
    });
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
