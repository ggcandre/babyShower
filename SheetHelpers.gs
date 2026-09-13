/**
 * ============================================================================
 * Utilitários de acesso à folha de cálculo
 * ============================================================================
 * Estas funções são deliberadamente "dumb" quanto à posição das colunas:
 * a ordem das colunas na folha pode mudar sem partir o código, porque
 * tudo é resolvido por nome de cabeçalho (ver buildHeaderIndex).
 */

function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new AppError('Folha "' + sheetName + '" não encontrada na spreadsheet.', 500);
  }
  return sheet;
}

/**
 * Lê todas as linhas de uma folha e devolve { headerIndex, rows },
 * onde rows é um array de arrays (linhas cruas, sem o cabeçalho) e
 * headerIndex mapeia nome de cabeçalho -> índice de coluna (0-based).
 */
function readSheetRaw(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 1 || lastCol < 1) {
    return { headerIndex: {}, rows: [], sheet: sheet };
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headerRow = values[0];
  const headerIndex = buildHeaderIndex(headerRow);
  const rows = values.slice(1);

  return { headerIndex: headerIndex, rows: rows, sheet: sheet };
}

function buildHeaderIndex(headerRow) {
  const index = {};
  headerRow.forEach(function (header, i) {
    const key = String(header).trim();
    if (key !== '') {
      index[key] = i;
    }
  });
  return index;
}

/**
 * Converte uma linha crua num objeto lógico, usando um COLUMN_MAP
 * (campo lógico -> nome de cabeçalho) e o headerIndex da folha.
 */
function rowToObject(row, headerIndex, columnMap) {
  const obj = {};
  Object.keys(columnMap).forEach(function (logicalField) {
    const headerName = columnMap[logicalField];
    const colIndex = headerIndex[headerName];
    obj[logicalField] = (colIndex === undefined) ? '' : row[colIndex];
  });
  return obj;
}

/**
 * Constrói uma linha crua (array) a partir de um objeto lógico, do
 * COLUMN_MAP e do headerIndex — preservando quaisquer colunas extra
 * que já existam na folha e que não façam parte do COLUMN_MAP.
 */
function objectToRow(obj, headerIndex, columnMap, existingRow) {
  const totalCols = Object.keys(headerIndex).length;
  const row = existingRow ? existingRow.slice() : new Array(totalCols).fill('');

  Object.keys(columnMap).forEach(function (logicalField) {
    if (Object.prototype.hasOwnProperty.call(obj, logicalField)) {
      const headerName = columnMap[logicalField];
      const colIndex = headerIndex[headerName];
      if (colIndex !== undefined) {
        row[colIndex] = obj[logicalField];
      }
    }
  });

  return row;
}

function nextNumericId(rows, headerIndex, columnMap) {
  let maxId = 0;
  rows.forEach(function (row) {
    const idVal = row[headerIndex[columnMap.id]];
    const idNum = parseInt(idVal, 10);
    if (!isNaN(idNum) && idNum > maxId) {
      maxId = idNum;
    }
  });
  return String(maxId + 1);
}

function isTruthyActive(value) {
  if (typeof value === 'boolean') return value;
  const str = String(value).trim().toLowerCase();
  return str === 'true' || str === 'sim' || str === '1' || str === 'yes';
}

// ----------------------------------------------------------------------------
// Respostas HTTP / erros
// ----------------------------------------------------------------------------

/**
 * NOTA: Apps Script Web Apps não permitem definir um código de estado
 * HTTP diferente de 200 (limitação da plataforma, não deste código).
 * Por isso, erros são sinalizados dentro do próprio corpo JSON através
 * do campo "error" (e "status" com o código lógico), e o frontend deve
 * verificar a presença de "error" na resposta em vez de confiar no
 * código HTTP.
 */
function jsonResponse(obj, status) {
  const body = Object.assign({}, obj);
  if (status && status >= 400) {
    body.status = status;
  }
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new AppError('Corpo do pedido em falta.', 400);
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new AppError('Corpo do pedido não é JSON válido.', 400);
  }
}

function requireAdmin(apiKey) {
  const stored = PropertiesService.getScriptProperties().getProperty('ADMIN_API_KEY');
  if (!stored) {
    throw new AppError('Chave de administrador não configurada no servidor.', 500);
  }
  if (!apiKey || apiKey !== stored) {
    throw new AppError('Não autorizado.', 401);
  }
}

function AppError(message, status) {
  this.message = message;
  this.status = status || 400;
}
AppError.prototype = Object.create(Error.prototype);

function errorStatus(err) {
  return (err && err.status) ? err.status : 500;
}
