/**
 * ============================================================================
 * LISTA DE NASCIMENTO — Backend (Google Apps Script)
 * ============================================================================
 *
 * Este script serve como API pública (para o site) e API administrativa
 * (para o painel de administração), usando a Google Spreadsheet existente
 * como base de dados.
 *
 * NÃO cria uma nova spreadsheet. Usa sempre SPREADSHEET_ID abaixo.
 *
 * Ver README.md para instruções de deployment.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO
// ----------------------------------------------------------------------------

const SPREADSHEET_ID = '1Uz6i_1xUdLPjr40QsTZrR8p_g3i-QHH9JsCXiuh9AaI';
const SHEET_PRODUCTS = 'Site';
const SHEET_RESERVATIONS = 'Reservas';

// Cabeçalhos que este script cria na folha "Site" caso esteja vazia.
// A folha estava vazia no momento da implementação, pelo que estes nomes
// foram definidos de raiz — ver README.md secção "Alterações necessárias
// na Google Sheet".
const SITE_HEADERS = [
  'ID',
  'Nome',
  'Descrição',
  'Categoria',
  'Preço',
  'Quantidade Desejada',
  'Imagem URL',
  'Link de Compra',
  'Ativo',
  'Criado Em',
  'Atualizado Em'
];

const RESERVATIONS_HEADERS = [
  'ID',
  'Product ID',
  'Nome do Produto',
  'Nome do Convidado',
  'Quantidade',
  'Mensagem',
  'Criado Em',
  'Status'
];

// Mapeamento entre os campos lógicos usados pela aplicação e os nomes
// reais das colunas na folha "Site". Se a folha já tivesse dados com
// nomes diferentes, apenas estes valores (à direita) precisariam de
// mudar — o resto do código usa sempre os nomes lógicos (à esquerda).
const COLUMN_MAP = {
  id: 'ID',
  name: 'Nome',
  description: 'Descrição',
  category: 'Categoria',
  price: 'Preço',
  desiredQuantity: 'Quantidade Desejada',
  imageUrl: 'Imagem URL',
  purchaseUrl: 'Link de Compra',
  active: 'Ativo',
  createdAt: 'Criado Em',
  updatedAt: 'Atualizado Em'
};

const RESERVATION_COLUMN_MAP = {
  id: 'ID',
  productId: 'Product ID',
  productName: 'Nome do Produto',
  guestName: 'Nome do Convidado',
  quantity: 'Quantidade',
  message: 'Mensagem',
  createdAt: 'Criado Em',
  status: 'Status'
};

// Estados de reserva que contam para o cálculo de "reserved_quantity".
const ACTIVE_RESERVATION_STATUSES = ['confirmed', 'pending'];

// ----------------------------------------------------------------------------
// PONTOS DE ENTRADA HTTP
// ----------------------------------------------------------------------------

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'products';

    if (action === 'products') {
      return jsonResponse({ products: getPublicProducts() });
    }

    if (action === 'admin_products') {
      requireAdmin(params.apiKey);
      return jsonResponse({ products: getAdminProducts() });
    }

    if (action === 'admin_reservations') {
      requireAdmin(params.apiKey);
      return jsonResponse({ reservations: getAdminReservations() });
    }

    return jsonResponse({ error: 'Ação desconhecida.' }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, errorStatus(err));
  }
}

function doPost(e) {
  try {
    const body = parseBody(e);
    const action = body.action || 'reserve';

    if (action === 'reserve') {
      const result = createReservation(body);
      return jsonResponse(result);
    }

    if (action === 'add_product') {
      requireAdmin(body.apiKey);
      const result = addProduct(body);
      return jsonResponse(result);
    }

    if (action === 'update_product') {
      requireAdmin(body.apiKey);
      const result = updateProduct(body);
      return jsonResponse(result);
    }

    if (action === 'toggle_active') {
      requireAdmin(body.apiKey);
      const result = toggleProductActive(body);
      return jsonResponse(result);
    }

    if (action === 'cancel_reservation') {
      requireAdmin(body.apiKey);
      const result = cancelReservation(body);
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Ação desconhecida.' }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) }, errorStatus(err));
  }
}

// ----------------------------------------------------------------------------
// SETUP — correr manualmente uma vez a partir do editor do Apps Script
// ----------------------------------------------------------------------------

/**
 * Inicializa as folhas "Site" e "Reservas" com os cabeçalhos necessários,
 * SEM apagar quaisquer dados existentes. Se a folha "Site" já tiver
 * cabeçalhos na primeira linha, esta função não os toca.
 */
function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let siteSheet = ss.getSheetByName(SHEET_PRODUCTS);
  if (!siteSheet) {
    siteSheet = ss.insertSheet(SHEET_PRODUCTS);
  }
  const siteFirstRow = siteSheet.getRange(1, 1, 1, Math.max(1, siteSheet.getLastColumn())).getValues()[0];
  const siteHasHeaders = siteFirstRow.some(function (cell) { return String(cell).trim() !== ''; });
  if (!siteHasHeaders) {
    siteSheet.getRange(1, 1, 1, SITE_HEADERS.length).setValues([SITE_HEADERS]);
    siteSheet.setFrozenRows(1);
  }

  let reservationsSheet = ss.getSheetByName(SHEET_RESERVATIONS);
  if (!reservationsSheet) {
    reservationsSheet = ss.insertSheet(SHEET_RESERVATIONS);
  }
  const resFirstRow = reservationsSheet.getRange(1, 1, 1, Math.max(1, reservationsSheet.getLastColumn())).getValues()[0];
  const resHasHeaders = resFirstRow.some(function (cell) { return String(cell).trim() !== ''; });
  if (!resHasHeaders) {
    reservationsSheet.getRange(1, 1, 1, RESERVATIONS_HEADERS.length).setValues([RESERVATIONS_HEADERS]);
    reservationsSheet.setFrozenRows(1);
  }

  Logger.log('Setup concluído. Folha "Site": %s linha(s). Folha "Reservas": %s linha(s).',
    siteSheet.getLastRow(), reservationsSheet.getLastRow());
}

/**
 * Define a chave de administrador guardada nas Script Properties.
 * Correr uma vez manualmente a partir do editor, substituindo o valor
 * abaixo por uma chave secreta forte. Não deixar a chave hardcoded
 * no resto do código nem no frontend público.
 */
function setupAdminKey() {
  const SECRET = 'BabyshowerSementinha2026';
  PropertiesService.getScriptProperties().setProperty('ADMIN_API_KEY', SECRET);
  Logger.log('Chave de administrador definida.');
}
