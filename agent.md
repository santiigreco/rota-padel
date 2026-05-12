# 🤖 RotaPádel - Guía para Agentes (Contexto y Estado)

> **Instrucción crítica para agentes:** Este archivo contiene el contexto general de la aplicación. Si realizas cambios estructurales en el código (nuevas variables de estado, nuevas páginas, cambios en la API o lógica principal), **debes actualizar este archivo** para reflejar esos cambios y mantenerlo como fuente de verdad.

## 📌 Propósito de la Aplicación
RotaPádel es una PWA Mobile-First diseñada en Vanilla JavaScript (sin frameworks) para gestionar grupos de jugadores de pádel, armar jornadas equitativas, llevar resultados de partidos y visualizar estadísticas. 

## 🏗 Arquitectura y Archivos Clave
- **Frontend**: Vanilla JS (`app.js`), HTML5 (`index.html`), CSS nativo (`style.css`).
- **Backend/DB**: Serverless con Google Apps Script (`apps-script.gs`) que actúa como puente para usar **Google Sheets** como base de datos (REST JSON).
- **`app.js`**: Contiene TODA la lógica de estado, llamadas a la API, renderizado del DOM (por inyección de HTML en Vanilla JS) y algoritmo de cruces.

## 🧠 Estado Global (`state`)
La aplicación maneja el estado de forma global en `app.js` en la variable mutable `state`:
```javascript
let state = { 
  currentTab: 'play', // Pestaña actual: 'play' | 'history' | 'players' | 'stats'
  players: [],        // Arreglo de jugadores: { id, name, color }
  history: [],        // Arreglo de jornadas pasadas: { id, date, gamesFormat, attendees, matches }
  session: null,      // Jornada activa: { id, date, attendees, gamesFormat, matches, currentMatch, matchIndex, finished }
  syncStatus: 'idle'  // Estado de sincronización: 'idle' | 'syncing' | 'error' | 'offline'
};
```
- Se utiliza `localStorage` como respaldo offline (gestor `CACHE`).
- Al iniciar, se llama a `loadState()` que descarga los datos desde la API (Sheets) o hace un fallback local.

## 🔄 Flujo de Renderizado
- La app usa un enfoque declarativo simulado (re-renderizado manual).
- La función principal `renderPage()` limpia el contenedor (`#page-container`) y delega a las vistas específicas según `state.currentTab` (`renderPlayPage`, `renderHistoryPage`, `renderPlayersPage`, `renderStatsPage`).
- Al modificar datos (ej: `saveMatchResult()`), se actualiza el `state`, se guarda en `CACHE` y API (vía `withSync`), y se vuelve a llamar a `renderPage()`.
- Para micro-interacciones (ej: sumar un punto con `changeScore`), se muta directamente el DOM (ej: `document.getElementById('score1').textContent = ...`) por rendimiento, sin re-renderizar toda la página.

## 🗄️ Comunicación con la API (Google Sheets)
El objeto `API` contiene los métodos para llamar a Google Apps Script por GET con el parámetro `action`:
- `getAll()`: Descarga jugadores, jornadas y partidos.
- `savePlayer(p)` / `deletePlayer(id)`: ABM de jugadores.
- `saveJornada(j)` / `deleteJornada(id)`: ABM de jornadas.
- `savePartido(p)`: Guarda un partido individual de la jornada actual (fire-and-forget).

## ⚙️ Reglas Importantes de Desarrollo
1. **Diseño Premium**: El CSS está muy pulido con glassmorphism, gradientes, bordes sutiles y modo oscuro. Al agregar componentes, respeta las variables CSS existentes (ej: `var(--accent)`, `var(--bg-card)`) y las clases como `.card`, `.btn`, `.btn-primary`.
2. **Resiliencia Offline**: Todas las acciones de red deben manejarse amigablemente. Usa `withSync(() => ...)` para mostrar feedback al usuario de la actividad de red.
3. **Vanilla Pura**: No agregues librerías externas ni utilices JSX. Los componentes se renderizan mediante Template Literals (`` `...` ``).

---
*Última actualización: Mayo 2026*
