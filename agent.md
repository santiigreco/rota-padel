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

## 🎯 Sistema de Rating — Método Nuco Flocco
La app usa el **Método Nuco Flocco**, basado en TrueSkill (sistema bayesiano de Microsoft) con dos modificaciones originales: penalización por inasistencia y ponderación por margen de victoria. Diseñado por el matemático **Nuco Flocco** para RotaPádel.

**Los rankings son independientes por torneo.** Cada torneo recalcula su ranking solo con sus jornadas.

### Parámetros (constante `TS`)
- `MU0 = 25`: Media inicial de habilidad
- `SIGMA0 = 25/3 ≈ 8.33`: Incertidumbre inicial
- `BETA = 25/6 ≈ 4.17`: Ruido de performance
- `TAU = 0.5`: Factor dinámico (evita que σ→0, mantiene sigma relevante para la penalización por asistencia)

### Margen de Victoria
```
M = 1 + 0.15 × ln(|score₁ − score₂| + 1)
```
Rango: 1.0 (empate) a ~1.29 (diff=6). Suavizado para evitar divergencia excesiva.

### Cálculo del Rating Visible
```
rating_display = tsScaleToDisplay(μ_adjusted)
μ_adjusted = μ + (k/N - 1) × σ
```
Donde `k` = jornadas asistidas, `N` = total jornadas del torneo.
Se escala a base ~1000: `display = (μ/50)*1000 + 500`

### Funciones Clave
- `computeGlobalStats()`: Recalcula TODO el ranking desde el historial del torneo activo. Recorre jornadas cronológicamente, aplica TrueSkill a cada partido 2v2, y devuelve rankings/parejas/asistencia.
- `normalPdf()`, `normalCdf()`, `tsVFunction()`, `tsWFunction()`: Funciones matemáticas de la distribución normal necesarias para TrueSkill.
- `getEloRankInfo(elo)`: Devuelve badge/color según el rating (Diamante ≥1150, Oro ≥1080, Plata ≥1020, Bronce ≥960, Hierro <960).

### Tab "📐 Fórmula" en Estadísticas
La pestaña Fórmula en la página de estadísticas muestra toda la matemática del método con atribución a Nuco Flocco. Cualquier cambio en los parámetros o fórmulas debe reflejarse también ahí.

## ⚙️ Reglas Importantes de Desarrollo
1. **Diseño Premium**: El CSS está muy pulido con glassmorphism, gradientes, bordes sutiles y modo oscuro. Al agregar componentes, respeta las variables CSS existentes (ej: `var(--accent)`, `var(--bg-card)`) y las clases como `.card`, `.btn`, `.btn-primary`.
2. **Resiliencia Offline**: Todas las acciones de red deben manejarse amigablemente. Usa `withSync(() => ...)` para mostrar feedback al usuario de la actividad de red.
3. **Vanilla Pura**: No agregues librerías externas ni utilices JSX. Los componentes se renderizan mediante Template Literals (`` `...` ``).

---
*Última actualización: Junio 2026*
