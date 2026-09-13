/**
 * ============================================================================
 * Reservas
 * ============================================================================
 * O frontend envia apenas: product_id, guest_name, quantity, message.
 * TUDO o resto (quantidade disponível, validação) é recalculado aqui,
 * dentro do lock — nunca confiar em valores de disponibilidade vindos
 * do cliente.
 */

function createReservation(body) {
  const productId = body.product_id;
  const guestName = String(body.guest_name || '').trim();
  const quantity = Number(body.quantity);
  const message = String(body.message || '').trim();

  if (!productId) {
    throw new AppError('product_id em falta.', 400);
  }
  if (!guestName) {
    throw new AppError('Nome do convidado em falta.', 400);
  }
  if (!quantity || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new AppError('Quantidade inválida.', 400);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 1. Ler quantidade desejada do produto
    const site = readSheetRaw(SHEET_PRODUCTS);
    const idColIndex = site.headerIndex[COLUMN_MAP.id];
    const activeColIndex = site.headerIndex[COLUMN_MAP.active];
    const nameColIndex = site.headerIndex[COLUMN_MAP.name];
    const desiredColIndex = site.headerIndex[COLUMN_MAP.desiredQuantity];

    const productRow = site.rows.find(function (row) {
      return String(row[idColIndex]) === String(productId);
    });
    if (!productRow) {
      throw new AppError('Produto não encontrado.', 404);
    }
    if (!isTruthyActive(productRow[activeColIndex])) {
      throw new AppError('Este produto já não está disponível.', 409);
    }

    const desiredQuantity = Number(productRow[desiredColIndex]) || 0;
    const productName = productRow[nameColIndex];

    // 2. Ler reservas atuais e calcular disponibilidade
    const reservations = readSheetRaw(SHEET_RESERVATIONS);
    const reservedTotals = sumActiveReservationsByProduct(reservations);
    const alreadyReserved = reservedTotals[String(productId)] || 0;
    const available = desiredQuantity - alreadyReserved;

    // 3. Validar quantidade solicitada
    if (quantity > available) {
      throw new AppError(
        'Quantidade indisponível. Restam apenas ' + Math.max(0, available) + ' unidade(s).',
        409
      );
    }

    // 4. Criar reserva
    const newId = nextNumericId(reservations.rows, reservations.headerIndex, RESERVATION_COLUMN_MAP);
    const reservationObj = {
      id: newId,
      productId: String(productId),
      productName: productName,
      guestName: guestName,
      quantity: quantity,
      message: message,
      createdAt: new Date().toISOString(),
      status: 'confirmed'
    };

    const totalCols = Math.max(
      reservations.sheet.getLastColumn(),
      Object.keys(reservations.headerIndex).length
    );
    const row = objectToRow(
      reservationObj,
      reservations.headerIndex,
      RESERVATION_COLUMN_MAP,
      new Array(totalCols).fill('')
    );
    reservations.sheet.appendRow(row);

    return { success: true, message: 'Reserva efetuada com sucesso.' };
  } finally {
    // 5. Libertar lock (sempre, mesmo em caso de erro)
    lock.releaseLock();
  }
}

/**
 * Devolve todas as reservas com todos os campos, para uso exclusivo
 * do painel administrativo. NUNCA expor via API pública.
 */
function getAdminReservations() {
  const reservations = readSheetRaw(SHEET_RESERVATIONS);
  return reservations.rows
    .filter(function (row) { return row[reservations.headerIndex[RESERVATION_COLUMN_MAP.id]] !== ''; })
    .map(function (row) {
      const r = rowToObject(row, reservations.headerIndex, RESERVATION_COLUMN_MAP);
      return {
        id: r.id,
        product_id: r.productId,
        product_name: r.productName,
        guest_name: r.guestName,
        quantity: r.quantity,
        message: r.message,
        created_at: r.createdAt,
        status: r.status
      };
    });
}

/**
 * Cancela uma reserva (status = cancelled). A partir daí deixa de
 * contar para reserved_quantity / available_quantity.
 */
function cancelReservation(body) {
  if (!body.id) {
    throw new AppError('id da reserva em falta.', 400);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const reservations = readSheetRaw(SHEET_RESERVATIONS);
    const idColIndex = reservations.headerIndex[RESERVATION_COLUMN_MAP.id];
    const statusColIndex = reservations.headerIndex[RESERVATION_COLUMN_MAP.status];

    const rowIndex = reservations.rows.findIndex(function (row) {
      return String(row[idColIndex]) === String(body.id);
    });
    if (rowIndex === -1) {
      throw new AppError('Reserva não encontrada.', 404);
    }

    reservations.sheet.getRange(rowIndex + 2, statusColIndex + 1).setValue('cancelled');

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}
