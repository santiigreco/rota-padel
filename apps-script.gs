/**
 * RotaPádel — Google Apps Script Backend
 * ========================================
 * Instrucciones de despliegue:
 * 1. Abre tu Google Sheet → Extensiones → Apps Script
 * 2. Pega este código, reemplaza todo el contenido
 * 3. Guarda (Ctrl+S) con nombre "RotaPádel API"
 * 4. Click en "Implementar" → "Nueva implementación"
 * 5. Tipo: Aplicación web
 *    - Ejecutar como: Yo (tu cuenta)
 *    - Quién tiene acceso: Cualquier persona
 * 6. Haz click en "Implementar" y copia la URL generada
 * 7. Esa URL es tu SHEETS_API_URL para Netlify / config.js
 *
 * ESTRUCTURA DE HOJAS (se crean automáticamente):
 * - Jugadores: id | nombre | color | created_at
 * - Jornadas:  id | fecha | games_format | attendees | finished
 * - Partidos:  id | id_jornada | team1_p1 | team1_p2 | team2_p1 | team2_p2 | score1 | score2 | skipped | match_index
 */

// ─── Nombres de hojas ─────────────────────────────────────────────────────────
const SHEETS = {
  JUGADORES: 'Jugadores',
  JORNADAS:  'Jornadas',
  PARTIDOS:  'Partidos',
};

const HEADERS = {
  Jugadores: ['id', 'nombre', 'color', 'created_at'],
  Jornadas:  ['id', 'fecha', 'games_format', 'attendees', 'finished'],
  Partidos:  ['id', 'id_jornada', 'team1_p1', 'team1_p2', 'team2_p1', 'team2_p2', 'score1', 'score2', 'skipped', 'match_index'],
};

// ─── Utils de hoja ────────────────────────────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const hdrs = HEADERS[name];
    if (hdrs) {
      sheet.getRange(1, 1, 1, hdrs.length).setValues([hdrs]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, hdrs.length).setFontWeight('bold')
           .setBackground('#1a2234').setFontColor('#60a5fa');
    }
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1)
    .filter(row => row[0] !== '' && row[0] !== null)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function findRowById(sheet, id) {
  const col = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let i = 1; i < col.length; i++) {
    if (String(col[i][0]) === String(id)) return i + 1; // 1-indexed
  }
  return -1;
}

function upsertRow(sheetName, obj) {
  const sheet = getSheet(sheetName);
  const hdrs  = HEADERS[sheetName];
  const values = hdrs.map(h => (obj[h] !== undefined && obj[h] !== null) ? obj[h] : '');
  const rowNum = findRowById(sheet, obj.id);
  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  SpreadsheetApp.flush();
}

// ─── Operaciones CRUD ─────────────────────────────────────────────────────────

function getAllData() {
  const jugadores = sheetToObjects(getSheet(SHEETS.JUGADORES));
  const jornadas  = sheetToObjects(getSheet(SHEETS.JORNADAS));
  const partidos  = sheetToObjects(getSheet(SHEETS.PARTIDOS));

  // Normalizar tipos
  jugadores.forEach(j => {
    j.id     = String(j.id);
    j.nombre = String(j.nombre);
    j.color  = String(j.color || '#3b82f6');
  });

  jornadas.forEach(j => {
    j.id          = String(j.id);
    j.fecha       = String(j.fecha);
    j.games_format = parseInt(j.games_format) || 4;
    j.finished    = (j.finished === true || String(j.finished).toUpperCase() === 'TRUE');
    try {
      j.attendees = typeof j.attendees === 'string' ? JSON.parse(j.attendees) : [];
    } catch (_) {
      j.attendees = [];
    }
  });

  partidos.forEach(p => {
    p.id         = String(p.id);
    p.id_jornada = String(p.id_jornada);
    p.score1     = parseInt(p.score1) || 0;
    p.score2     = parseInt(p.score2) || 0;
    p.skipped    = (p.skipped === true || String(p.skipped).toUpperCase() === 'TRUE');
    p.match_index = parseInt(p.match_index) || 0;
  });

  return { jugadores, jornadas, partidos };
}

function savePlayer(data) {
  const obj = {
    id:         String(data.id),
    nombre:     String(data.name || data.nombre),
    color:      String(data.color || '#3b82f6'),
    created_at: data.createdAt || data.created_at || new Date().toISOString(),
  };
  upsertRow(SHEETS.JUGADORES, obj);
  return { saved: obj.id };
}

function deletePlayer(id) {
  const sheet  = getSheet(SHEETS.JUGADORES);
  const rowNum = findRowById(sheet, id);
  if (rowNum > 0) sheet.deleteRow(rowNum);
  SpreadsheetApp.flush();
  return { deleted: id };
}

function deleteJornada(id) {
  const sheetJ = getSheet(SHEETS.JORNADAS);
  const rowNumJ = findRowById(sheetJ, id);
  if (rowNumJ > 0) sheetJ.deleteRow(rowNumJ);

  const sheetP = getSheet(SHEETS.PARTIDOS);
  const data = sheetP.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]) === String(id)) sheetP.deleteRow(i + 1);
  }
  
  SpreadsheetApp.flush();
  return { deleted: id };
}

function saveJornada(data) {
  const attendees = Array.isArray(data.attendees)
    ? JSON.stringify(data.attendees)
    : (data.attendees || '[]');

  const obj = {
    id:          String(data.id),
    fecha:       String(data.fecha || data.date || new Date().toISOString()),
    games_format: parseInt(data.games_format || data.gamesFormat || 4),
    attendees:   attendees,
    finished:    data.finished ? 'TRUE' : 'FALSE',
  };
  upsertRow(SHEETS.JORNADAS, obj);
  return { saved: obj.id };
}

function savePartido(data) {
  const obj = {
    id:          String(data.id),
    id_jornada:  String(data.id_jornada || data.jornadaId),
    team1_p1:    String(data.team1_p1 || (data.team1 && data.team1[0]) || ''),
    team1_p2:    String(data.team1_p2 || (data.team1 && data.team1[1]) || ''),
    team2_p1:    String(data.team2_p1 || (data.team2 && data.team2[0]) || ''),
    team2_p2:    String(data.team2_p2 || (data.team2 && data.team2[1]) || ''),
    score1:      parseInt(data.score1) || 0,
    score2:      parseInt(data.score2) || 0,
    skipped:     data.skipped ? 'TRUE' : 'FALSE',
    match_index: parseInt(data.match_index || data.matchIndex) || 0,
  };
  upsertRow(SHEETS.PARTIDOS, obj);
  return { saved: obj.id };
}

// ─── Punto de entrada ─────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const p      = e.parameter || {};
    const action = p.action || '';
    let result;

    switch (action) {
      case 'getAll':
        result = getAllData();
        break;
      case 'savePlayer':
        result = savePlayer(JSON.parse(decodeURIComponent(p.data)));
        break;
      case 'deletePlayer':
        result = deletePlayer(p.id);
        break;
      case 'deleteJornada':
        result = deleteJornada(p.id);
        break;
      case 'saveJornada':
        result = saveJornada(JSON.parse(decodeURIComponent(p.data)));
        break;
      case 'savePartido':
        result = savePartido(JSON.parse(decodeURIComponent(p.data)));
        break;
      case 'ping':
        result = { pong: true, time: new Date().toISOString() };
        break;
      default:
        result = { error: 'Acción desconocida: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
