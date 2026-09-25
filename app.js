(function () {
  'use strict';

  const SUPABASE_URL = window.APP_CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.APP_CONFIG.SUPABASE_ANON_KEY;
  const CACHE_KEY = 'lista_nascimento_products_cache_v3';

  // Inicializa o cliente Supabase
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const state = {
    products: [],
    activeCategory: 'Todos',
    sortOrder: 'default',
    priceLimit: '',
    selectedProduct: null,
    selectedRequestId: null
  };

  const els = {
    filters: document.getElementById('filters'),
    sortOrder: document.getElementById('sort-order'),
    priceLimit: document.getElementById('price-limit'),
    priceLimitValue: document.getElementById('price-limit-value'),
    content: document.getElementById('content'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalCloseX: document.getElementById('modal-close-x'),
    modalItemName: document.getElementById('modal-item-name'),
    modalItemAvailability: document.getElementById('modal-item-availability'),
    reserveForm: document.getElementById('reserve-form'),
    guestName: document.getElementById('guest-name'),
    guestQuantity: document.getElementById('guest-quantity'),
    guestMessage: document.getElementById('guest-message'),
    modalCancel: document.getElementById('modal-cancel'),
    modalSubmit: document.getElementById('modal-submit'),
    formMessage: document.getElementById('form-message'),
    toast: document.getElementById('toast')
  };

  init();

  function init() {
    // 1. Carrega imediatamente da cache local (se existir) para render instantâneo (<30ms)
    const cached = getLocalCache();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      state.products = cached;
      configurePriceLimit();
      renderFilters();
      renderList();
      loadProducts(true);
    } else {
      loadProducts(false);
    }

    // 2. Subscreve a atualizações em TEMPO REAL (Realtime)
    setupRealtimeSubscription();

    els.modalCancel.addEventListener('click', closeModal);
    if (els.modalCloseX) {
      els.modalCloseX.addEventListener('click', closeModal);
    }
    els.modalOverlay.addEventListener('click', function (e) {
      if (e.target === els.modalOverlay) closeModal();
    });
    els.reserveForm.addEventListener('submit', handleReserveSubmit);
    els.sortOrder.addEventListener('change', function () {
      state.sortOrder = els.sortOrder.value;
      renderList();
    });
    els.priceLimit.addEventListener('input', function () {
      updatePriceLimitValue();
      renderList();
    });
  }

  function getLocalCache() {
    try {
      const data = localStorage.getItem(CACHE_KEY);
      const products = data ? JSON.parse(data) : null;
      return Array.isArray(products)
        ? moveFirstProductToEnd(products.filter(isVisibleProduct))
        : null;
    } catch (e) {
      return null;
    }
  }

  function isVisibleProduct(product) {
    return String(product && product.category || '').trim() !== 'Amamentação';
  }

  function moveFirstProductToEnd(products) {
    return products.length > 1 ? products.slice(1).concat(products[0]) : products;
  }

  function setLocalCache(products) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(products));
    } catch (e) {
      // Ignora erros de quota
    }
  }

  /**
   * Obtém produtos e reservas ativas diretamente do Supabase e calcula disponibilidades.
   */
  async function loadProducts(isSilent) {
    if (!isSilent && state.products.length === 0) {
      els.content.innerHTML = '<div class="loading-state">A carregar a lista…</div>';
    }

    try {
      // Pedidos em paralelo ultra rápidos
      const [productsRes, reservationsRes] = await Promise.all([
        supabase
          .from('products')
          .select('*')
          .eq('active', true)
          .order('id', { ascending: true }),
        supabase
          .from('reservations')
          .select('product_id, guest_name, quantity, status')
          .in('status', ['confirmed', 'pending'])
      ]);

      if (productsRes.error) throw productsRes.error;
      if (reservationsRes.error) throw reservationsRes.error;

      const rawProducts = (productsRes.data || []).filter(isVisibleProduct);
      const rawReservations = reservationsRes.data || [];

      // Resumo de reservas por produto
      const totals = {};
      const people = {};
      rawReservations.forEach(function (r) {
        const pId = String(r.product_id);
        const qty = Number(r.quantity) || 0;
        totals[pId] = (totals[pId] || 0) + qty;

        if (!people[pId]) people[pId] = [];
        const gName = String(r.guest_name || '').trim();
        if (gName && people[pId].indexOf(gName) === -1) {
          people[pId].push(gName);
        }
      });

      const processed = moveFirstProductToEnd(rawProducts.map(function (p) {
        const pId = String(p.id);
        const desired = Number(p.desired_quantity) || 0;
        const reserved = totals[pId] || 0;
        const reservedBy = people[pId] || [];

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          price: p.price,
          desired_quantity: desired,
          reserved_quantity: reserved,
          reserved_by: reservedBy,
          available_quantity: Math.max(0, desired - reserved),
          image_url: p.image_url,
          purchase_url: p.purchase_url,
          active: p.active
        };
      }));

      state.products = processed;
      setLocalCache(processed);
      configurePriceLimit();
      renderFilters();
      renderList();
    } catch (err) {
      console.error('Erro ao carregar produtos do Supabase:', err);
      if (state.products.length === 0) {
        renderErrorState();
      }
    }
  }

  function setupRealtimeSubscription() {
    supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        function () {
          // Quando qualquer reserva for feita/alterada, atualiza em background
          loadProducts(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        function () {
          loadProducts(true);
        }
      )
      .subscribe();
  }

  function renderErrorState() {
    els.content.innerHTML =
      '<div class="error-state">' +
        '<p>Não foi possível carregar a lista no momento.</p>' +
        '<button type="button" class="btn btn-secondary" id="retry-btn" style="margin-top:12px;">Tentar novamente</button>' +
      '</div>';
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        loadProducts(false);
      });
    }
  }

  function renderFilters() {
    const categories = ['Todos'].concat(
      Array.from(new Set(state.products.map(function (p) { return p.category; }).filter(Boolean)))
    );

    if (categories.length <= 2) {
      els.filters.innerHTML = '';
      return;
    }

    els.filters.innerHTML = categories.map(function (cat) {
      const active = cat === state.activeCategory ? ' active' : '';
      return '<button class="filter-chip' + active + '" data-category="' + escapeHtml(cat) + '">' + escapeHtml(cat) + '</button>';
    }).join('');

    Array.from(els.filters.querySelectorAll('.filter-chip')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        const category = btn.getAttribute('data-category');
        state.activeCategory = state.activeCategory === category ? 'Todos' : category;
        renderFilters();
        renderList();
      });
    });
  }

  function renderList() {
    let items = state.products.filter(function (p) {
      const matchesCategory = state.activeCategory === 'Todos' || p.category === state.activeCategory;
      const price = Number(p.price);
      const matchesPrice = !state.priceLimit || (Number.isFinite(price) && price <= Number(state.priceLimit));
      return matchesCategory && matchesPrice;
    });

    if (state.sortOrder !== 'default') {
      items = items.slice().sort(function (a, b) {
        const priceA = Number(a.price);
        const priceB = Number(b.price);
        const hasPriceA = Number.isFinite(priceA);
        const hasPriceB = Number.isFinite(priceB);

        if (hasPriceA !== hasPriceB) return hasPriceA ? -1 : 1;
        if (!hasPriceA) return 0;
        return state.sortOrder === 'price-asc' ? priceA - priceB : priceB - priceA;
      });
    }

    if (items.length === 0) {
      els.content.innerHTML = '<div class="empty-state">Ainda não há itens nesta categoria.</div>';
      return;
    }

    const rows = items.map(renderItemRow).join('');
    els.content.innerHTML = '<div class="item-list">' + rows + '</div>';

    Array.from(els.content.querySelectorAll('[data-reserve-id]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-reserve-id');
        const product = state.products.find(function (p) { return String(p.id) === String(id); });
        if (product) openModal(product);
      });
    });
  }

  function configurePriceLimit() {
    const prices = state.products
      .map(function (product) { return Number(product.price); })
      .filter(Number.isFinite);
    const minimum = prices.length > 0 ? Math.min.apply(null, prices) : 0;
    const maximum = prices.length > 0 ? Math.max.apply(null, prices) : 0;
    const sliderMaximum = prices.length > 0 ? maximum : 10;

    els.priceLimit.min = minimum;
    els.priceLimit.max = sliderMaximum;
    if (!state.priceLimit || Number(state.priceLimit) < minimum || Number(state.priceLimit) > sliderMaximum) {
      state.priceLimit = '';
    }
    els.priceLimit.value = state.priceLimit || sliderMaximum;
    updatePriceLimitValue();
  }

  function updatePriceLimitValue() {
    const value = Number(els.priceLimit.value);
    const maximum = Number(els.priceLimit.max);
    state.priceLimit = value >= maximum ? '' : els.priceLimit.value;
    els.priceLimitValue.textContent = state.priceLimit ? 'Até ' + value + ' €' : 'Todos';
  }

  function renderItemRow(p) {
    const desired = Number(p.desired_quantity) || 0;
    const available = Number(p.available_quantity) || 0;
    const reserved = Math.max(0, desired - available);
    const pct = desired > 0 ? Math.min(100, Math.round((reserved / desired) * 100)) : 0;
    const isFull = available <= 0;

    const thumb = p.image_url
      ? '<img class="item-thumb" src="' + escapeAttr(p.image_url) + '" alt="' + escapeAttr(p.name || '') + '" loading="lazy">'
      : '<div class="item-thumb-placeholder">' + escapeHtml((p.name || '?').charAt(0)) + '</div>';

    const priceText = p.price ? formatPrice(p.price) : '';
    const priceMobileHtml = priceText ? '<span class="item-price-mobile">' + priceText + '</span>' : '';
    const priceDesktopHtml = priceText ? '<div class="item-price-desktop">' + priceText + '</div>' : '';

    const actionHtml = isFull
      ? '<span class="tag-full">Já reservado</span>'
      : '<button type="button" class="btn btn-primary" data-reserve-id="' + escapeAttr(p.id) + '">Reservar</button>';

    const reservedByHtml = (p.reserved_by && p.reserved_by.length)
      ? '<div class="item-reserved-by"><strong>Reservado por:</strong> ' +
        p.reserved_by.map(function (person) {
          const name = (typeof person === 'string') ? person : (person && person.name) ? person.name : '';
          return escapeHtml(name);
        }).filter(Boolean).join(', ') + '</div>'
      : '';

    const purchaseLink = p.purchase_url
      ? '<a href="' + escapeAttr(p.purchase_url) + '" target="_blank" rel="noopener" class="item-purchase-link">Ver na loja ↗</a>'
      : '';

    return (
      '<div class="item-row' + (isFull ? ' is-full' : '') + '">' +
        '<div class="item-header-mobile">' +
          thumb +
          '<div class="item-body">' +
            '<div class="item-title-row">' +
              '<h3>' + escapeHtml(p.name) + '</h3>' +
              priceMobileHtml +
            '</div>' +
            (p.category ? '<div class="item-category">' + escapeHtml(p.category) + '</div>' : '') +
            (p.description ? '<p class="item-desc">' + escapeHtml(p.description) + '</p>' : '') +
            '<div class="item-progress">' +
              '<div class="item-progress-track"><div class="item-progress-fill" style="width:' + pct + '%"></div></div>' +
              '<span>' + reserved + ' de ' + desired + ' reservado' + (desired === 1 ? '' : 's') + '</span>' +
            '</div>' +
            reservedByHtml +
            purchaseLink +
          '</div>' +
        '</div>' +
        '<div class="item-actions">' +
          priceDesktopHtml +
          actionHtml +
        '</div>' +
      '</div>'
    );
  }

  function openModal(product) {
    state.selectedProduct = product;
    state.selectedRequestId = createRequestId();
    els.modalItemName.textContent = product.name;
    els.modalItemAvailability.textContent = product.available_quantity + ' disponível(is) de ' + product.desired_quantity;
    els.guestName.value = '';
    els.guestQuantity.value = 1;
    els.guestQuantity.max = product.available_quantity;
    els.guestMessage.value = '';
    els.formMessage.textContent = '';
    els.formMessage.className = 'form-message';
    setSubmitLoading(false);
    els.modalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    els.modalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    state.selectedProduct = null;
    state.selectedRequestId = null;
    setSubmitLoading(false);
  }

  function setSubmitLoading(isLoading) {
    if (!els.modalSubmit) return;
    els.modalSubmit.disabled = !!isLoading;
    const btnTextEl = els.modalSubmit.querySelector('.btn-text') || els.modalSubmit;
    btnTextEl.textContent = isLoading ? 'A registar reserva…' : 'Confirmar reserva';
  }

  async function handleReserveSubmit(e) {
    e.preventDefault();
    if (!state.selectedProduct) return;

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    setSubmitLoading(true);
    els.formMessage.textContent = '';
    els.formMessage.className = 'form-message';

    const selectedProd = state.selectedProduct;
    const guestName = els.guestName.value.trim();
    const guestQty = parseInt(els.guestQuantity.value, 10);
    const guestMsg = els.guestMessage.value.trim();

    try {
      // Chama a função RPC atómica do Postgres no Supabase
      const { data, error } = await supabase.rpc('make_reservation', {
        p_product_id: selectedProd.id,
        p_guest_name: guestName,
        p_quantity: guestQty,
        p_message: guestMsg,
        p_request_id: state.selectedRequestId
      });

      if (error) {
        throw error;
      }

      closeModal();
      showToast('Reserva efetuada com sucesso. Obrigado! 🤍');
      loadProducts(true);
    } catch (err) {
      console.error('Erro na reserva:', err);
      els.formMessage.textContent = err.message || 'Não foi possível concluir a reserva. Por favor tenta de novo.';
      els.formMessage.className = 'form-message error';
      setSubmitLoading(false);
    }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    setTimeout(function () { els.toast.classList.add('hidden'); }, 3500);
  }

  function formatPrice(price) {
    const num = Number(price);
    if (isNaN(num)) return '';
    return num.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'reserve-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }
})();
