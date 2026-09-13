/**
 * ============================================================================
 * Produtos — leitura pública, leitura administrativa, criação e edição
 * ============================================================================
 */

/**
 * Devolve os produtos ativos, apenas com os campos que os convidados
 * podem ver. Nunca inclui dados administrativos.
 */
function getPublicProducts() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('public_products');
  if (cached) {
    return JSON.parse(cached);
  }

  const products = getAllProductsWithAvailability();
  const publicProducts = products
    .filter(function (p) { return isTruthyActive(p.active); })
    .map(function (p) {
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        price: p.price,
        desired_quantity: p.desiredQuantity,
        reserved_quantity: p.reservedQuantity,
        available_quantity: p.availableQuantity,
        image_url: p.imageUrl,
        purchase_url: p.purchaseUrl,
        active: isTruthyActive(p.active)
      };
    });

  cache.put('public_products', JSON.stringify(publicProducts), 30);
  return publicProducts;
}

function invalidatePublicProductsCache() {
  CacheService.getScriptCache().remove('public_products');
}

/**
 * Devolve todos os produtos (ativos e inativos) com todos os campos,
 * para uso exclusivo do painel administrativo.
 */
function getAdminProducts() {
  const products = getAllProductsWithAvailability();
  return products.map(function (p) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      price: p.price,
      desired_quantity: p.desiredQuantity,
      reserved_quantity: p.reservedQuantity,
      available_quantity: p.availableQuantity,
      image_url: p.imageUrl,
      purchase_url: p.purchaseUrl,
      active: isTruthyActive(p.active),
      created_at: p.createdAt,
      updated_at: p.updatedAt
    };
  });
}

/**
 * Lê a folha "Site" e a folha "Reservas" e calcula reserved_quantity /
 * available_quantity para cada produto. A quantidade disponível NUNCA
 * é lida de uma coluna guardada — é sempre recalculada aqui.
 */
function getAllProductsWithAvailability() {
  const site = readSheetRaw(SHEET_PRODUCTS);
  const reservations = readSheetRaw(SHEET_RESERVATIONS);

  const reservedByProduct = sumActiveReservationsByProduct(reservations);

  return site.rows
    .filter(function (row) { return row[site.headerIndex[COLUMN_MAP.id]] !== ''; })
    .map(function (row) {
      const p = rowToObject(row, site.headerIndex, COLUMN_MAP);
      const desired = Number(p.desiredQuantity) || 0;
      const reserved = reservedByProduct[String(p.id)] || 0;
      p.reservedQuantity = reserved;
      p.availableQuantity = Math.max(0, desired - reserved);
      return p;
    });
}

function sumActiveReservationsByProduct(reservationsData) {
  const totals = {};
  reservationsData.rows.forEach(function (row) {
    const r = rowToObject(row, reservationsData.headerIndex, RESERVATION_COLUMN_MAP);
    const status = String(r.status || '').trim().toLowerCase();
    if (ACTIVE_RESERVATION_STATUSES.indexOf(status) === -1) {
      return;
    }
    const productId = String(r.productId);
    const qty = Number(r.quantity) || 0;
    totals[productId] = (totals[productId] || 0) + qty;
  });
  return totals;
}

/**
 * Adiciona um novo produto à folha "Site". Uso exclusivo do admin.
 */
function addProduct(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const site = readSheetRaw(SHEET_PRODUCTS);
    const newId = nextNumericId(site.rows, site.headerIndex, COLUMN_MAP);
    const now = new Date().toISOString();

    const obj = {
      id: newId,
      name: body.name || '',
      description: body.description || '',
      category: body.category || '',
      price: body.price || 0,
      desiredQuantity: body.desired_quantity || 0,
      imageUrl: body.image_url || '',
      purchaseUrl: body.purchase_url || '',
      active: body.active === false ? false : true,
      createdAt: now,
      updatedAt: now
    };

    const totalCols = Math.max(site.sheet.getLastColumn(), Object.keys(site.headerIndex).length);
    const row = objectToRow(obj, site.headerIndex, COLUMN_MAP, new Array(totalCols).fill(''));
    site.sheet.appendRow(row);
    invalidatePublicProductsCache();

    return { success: true, product: obj };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atualiza campos de um produto existente. Só altera os campos
 * presentes no corpo do pedido — preserva o resto da linha.
 */
function updateProduct(body) {
  if (!body.id) {
    throw new AppError('id do produto em falta.', 400);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const site = readSheetRaw(SHEET_PRODUCTS);
    const idColIndex = site.headerIndex[COLUMN_MAP.id];

    const rowIndex = site.rows.findIndex(function (row) {
      return String(row[idColIndex]) === String(body.id);
    });
    if (rowIndex === -1) {
      throw new AppError('Produto não encontrado.', 404);
    }

    const editable = {};
    ['name', 'description', 'category', 'price', 'image_url', 'purchase_url'].forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        const logicalField = field === 'image_url' ? 'imageUrl'
          : field === 'purchase_url' ? 'purchaseUrl'
          : field;
        editable[logicalField] = body[field];
      }
    });
    if (Object.prototype.hasOwnProperty.call(body, 'desired_quantity')) {
      editable.desiredQuantity = body.desired_quantity;
    }
    editable.updatedAt = new Date().toISOString();

    const existingRow = site.rows[rowIndex];
    const newRow = objectToRow(editable, site.headerIndex, COLUMN_MAP, existingRow);

    // +2: +1 para o cabeçalho, +1 porque getRange é 1-based
    site.sheet.getRange(rowIndex + 2, 1, 1, newRow.length).setValues([newRow]);
    invalidatePublicProductsCache();

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ativa ou desativa um produto (mostra/esconde da lista pública).
 */
function toggleProductActive(body) {
  if (!body.id) {
    throw new AppError('id do produto em falta.', 400);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const site = readSheetRaw(SHEET_PRODUCTS);
    const idColIndex = site.headerIndex[COLUMN_MAP.id];
    const activeColIndex = site.headerIndex[COLUMN_MAP.active];

    const rowIndex = site.rows.findIndex(function (row) {
      return String(row[idColIndex]) === String(body.id);
    });
    if (rowIndex === -1) {
      throw new AppError('Produto não encontrado.', 404);
    }

    const newActive = (typeof body.active === 'boolean')
      ? body.active
      : !isTruthyActive(site.rows[rowIndex][activeColIndex]);

    site.sheet.getRange(rowIndex + 2, activeColIndex + 1).setValue(newActive);

    const updatedAtColIndex = site.headerIndex[COLUMN_MAP.updatedAt];
    if (updatedAtColIndex !== undefined) {
      site.sheet.getRange(rowIndex + 2, updatedAtColIndex + 1).setValue(new Date().toISOString());
    }
    invalidatePublicProductsCache();

    return { success: true, active: newActive };
  } finally {
    lock.releaseLock();
  }
}
