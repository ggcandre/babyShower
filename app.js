(function () {
  'use strict';

  const API_URL = window.APP_CONFIG.API_URL;

  const state = {
    products: [],
    activeCategory: 'Todos',
    selectedProduct: null,
    selectedRequestId: null
  };

  const els = {
    filters: document.getElementById('filters'),
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
    loadProducts();
    els.modalCancel.addEventListener('click', closeModal);
    if (els.modalCloseX) {
      els.modalCloseX.addEventListener('click', closeModal);
    }
    els.modalOverlay.addEventListener('click', function (e) {
      if (e.target === els.modalOverlay) closeModal();
    });
    els.reserveForm.addEventListener('submit', handleReserveSubmit);
  }

  function loadProducts() {
    fetch(API_URL + '?action=products')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        state.products = data.products || [];
        renderFilters();
        renderList();
      })
      .catch(function (err) {
        els.content.innerHTML = '<div class="error-state">Não foi possível carregar a lista. Tenta novamente mais tarde.</div>';
        console.error(err);
      });
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
        state.activeCategory = btn.getAttribute('data-category');
        renderFilters();
        renderList();
      });
    });
  }

  function renderList() {
    const items = state.products.filter(function (p) {
      return state.activeCategory === 'Todos' || p.category === state.activeCategory;
    });

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
          return escapeHtml(person.name) + ' (' + Number(person.quantity) + ')';
        }).join(', ') + '</div>'
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

  function handleReserveSubmit(e) {
    e.preventDefault();
    if (!state.selectedProduct) return;

    // Desfoca input para fechar teclado virtual no telemóvel
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    setSubmitLoading(true);
    els.formMessage.textContent = '';
    els.formMessage.className = 'form-message';

    const payload = {
      action: 'reserve',
      product_id: state.selectedProduct.id,
      guest_name: els.guestName.value.trim(),
      quantity: parseInt(els.guestQuantity.value, 10),
      message: els.guestMessage.value.trim(),
      request_id: state.selectedRequestId
    };

    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && data.error) {
          els.formMessage.textContent = data.error;
          els.formMessage.className = 'form-message error';
          setSubmitLoading(false);
          return;
        }
        closeModal();
        showToast('Reserva efetuada com sucesso. Obrigado! 🤍');
        loadProducts();
      })
      .catch(function (err) {
        console.error('Erro na reserva:', err);
        els.formMessage.textContent = 'Não foi possível concluir a reserva. Por favor tenta de novo.';
        els.formMessage.className = 'form-message error';
        setSubmitLoading(false);
      });
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
