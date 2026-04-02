/**
 * RotaPádel — Build Script (Netlify)
 * ====================================
 * Corre como build command: node build.js
 * Lee la env var SHEETS_API_URL y genera config.js
 * para que el frontend pueda leerla desde window.APP_CONFIG.
 */
const fs   = require('fs');
const path = require('path');

const apiUrl = process.env.SHEETS_API_URL || '';

if (!apiUrl) {
  console.warn('[build.js] ⚠️  SHEETS_API_URL no está definida. La app correrá en modo offline.');
}

const content = `/* Generado automáticamente por build.js — NO editar */\nwindow.APP_CONFIG = { apiUrl: '${apiUrl}' };\n`;

fs.writeFileSync(path.join(__dirname, 'config.js'), content, 'utf8');
console.log('[build.js] ✅ config.js generado. API URL:', apiUrl ? '(configurada)' : '(vacía)');
