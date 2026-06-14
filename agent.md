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
  session: null,      // Jornada activa: { id, date, attendees, gamesFormat, courts, matches, currentMatch, matchIndex, fixture, finished }
                      //   courts: 1 (default) | 2 (modo 2 canchas, activado auto con >=8 jugadores)
  syncStatus: 'idle'  // Estado de sincronización: 'idle' | 'syncing' | 'error' | 'offline'
};
```
- Se utiliza `localStorage` como respaldo offline (gestor `CACHE`).
- Al iniciar, se llama a `loadState()` que descarga los datos desde la API (Sheets) o hace un fallback local.

## 🔄 Flujo de Renderizado
- La app usa un enfoque declarativo simulado (re-renderizado manual).
- La función principal `renderPage()` limpia el contenedor (`#page-container`) y delega a las vistas específicas según `state.currentTab` (`renderPlayPage`, `renderHistoryPage`, `renderPlayersPage`, `renderStatsPage`).
- Al modificar datos (ej: `saveMatchResult()`), se actualiza el `state`, se guarda en `CACHE` y API (vía `withSync`), y se vuelve a llamar a `renderPage()`.
- Para micro-interacciones (ej: sumar un punto con `changeFixtureScore` usando botones +/-), se muta directamente el DOM (ej: `document.getElementById('fs-0-1').textContent = ...`) por rendimiento y velocidad táctil, sin re-renderizar toda la página.

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

### Funcionamiento correcto del cálculo (cambios 14-jun-2026)

#### 1. σ aislado por jugador (`sigmaFromMatches`)
Para evitar el efecto cascada (editar el partido de A afecta el ELO de B), **σ ya no se acumula** a través del algoritmo bayesiano cross-player. En cambio, se calcula directamente desde los partidos propios del jugador:
```
σ(n) = √(σ0² / (n+1) + τ²)
```
Así, el σ de cada jugador depende **únicamente de cuántos partidos él mismo ha jugado**, no de la historia de otros.

#### 2. Cálculo jornada a jornada (snapshot)
`computeGlobalStats()` **no actualiza μ partido a partido** dentro de una jornada. En cambio:
1. Al inicio de cada jornada se toma un **snapshot** de `μ` y `n_partidos` de todos los jugadores.
2. Todos los partidos de esa jornada calculan su delta `Δμ` usando ese snapshot (mismos valores de arranque para todos).
3. Los `Δμ` se **acumulan** durante la jornada y se aplican **todos juntos** al final.

Esto garantiza que: el orden de los partidos dentro de una jornada no afecta el resultado, y editar un partido solo afecta a los jugadores de ese partido.

### Funciones Clave
- `computeGlobalStats()`: Recalcula TODO el ranking desde el historial del torneo activo. Recorre jornadas cronológicamente con snapshot por jornada, aplica TrueSkill a cada partido 2v2, y devuelve rankings/parejas/asistencia.
- `sigmaFromMatches(n)`: Calcula el σ de un jugador desde su propio conteo de partidos. Evita cascada cross-player.
- `getSessionEloDeltas(id)`: Extrae del historial global cuánto ELO sumó o restó cada jugador en una jornada específica para coronar al MVP (Batacazo) del día.
- `normalPdf()`, `normalCdf()`, `tsVFunction()`, `tsWFunction()`: Funciones matemáticas de la distribución normal necesarias para TrueSkill.
- `getEloRankInfo(elo)`: Devuelve badge/color según el rating (Diamante ≥1200, Oro ≥1000, Plata ≥900, Bronce ≥800, Hierro <800).
- `openPlayerProfile(playerId)`: Abre un modal de transparencia completa del jugador (ver sección abajo).

### Tab "📐 Fórmula" en Estadísticas
La pestaña Fórmula en la página de estadísticas muestra toda la matemática del método con atribución a Nuco Flocco. Cualquier cambio en los parámetros o fórmulas debe reflejarse también ahí.

## 🔍 Perfil de Jugador — Transparencia

La función `openPlayerProfile(playerId)` abre un modal que muestra:

1. **Header**: Avatar con color, nombre, badge de ranking y puntos actuales.
2. **Modelo TrueSkill**: Tarjetas con `μ` (habilidad estimada), `σ` (certeza) y % asistencia.
3. **Banner de penalización** (solo si hay): indica cuántos pts se perdieron por faltas.
4. **Timeline jornada a jornada**: Por cada jornada del torneo activo:
   - Fecha, presencia o ausencia
   - Partidos jugados y victorias
   - `Δ pts` de esa jornada y total acumulado
   - Desglose de cada partido: resultado W/L, compáñero, rivales, marcador

**Puntos de entrada al perfil:**
- Click en cualquier fila del Ranking (tab Estadísticas → 🏆 Ranking)
- Botón 📊 en la lista de Jugadores

## 🚀 Flujo Rápido y Generación de Fixture

### 1. Setup sin Configuración
El flujo de crear una jornada ("Nueva Jornada") salta cualquier pregunta sobre "Games a jugar" o "Cantidad de partidos". Simplemente seleccionás quiénes asisten y el sistema propone un fixture de **10 partidos fijos por defecto**.

### 2. Algoritmo Inteligente de Cruces (`generateNextMatch` / `generateRoundDoubleCourt`)

El sistema soporta dos modos:

**Modo 1 cancha** (< 8 jugadores): `generateNextMatch` genera combinaciones posibles y penaliza según:
- **Equidad de Juego:** Si alguien juega más que el resto (penalización altísima, `1000 pts`).
- **Rotación:** Penaliza repetir compañero (`40 pts`) y repetir rival (`15 pts`).
- **Nivelación por ELO:** Se incorpora el *Método Nuco Flocco* calculando la diferencia de μ entre ambos equipos (`|μ_A + μ_B - (μ_C + μ_D)| * 5`). Esto hace que, a igualdad de rotación, la app **siempre elija el cruce más parejo**.

**Modo 2 canchas** (≥ 8 jugadores, activado automáticamente): `generateRoundDoubleCourt` genera **rondas** con 2 partidos simultáneos y penaliza:
- **Equidad de Juego:** `1000 pts` por asimetría grave de partidos jugados.
- **Repetición de compañero en la misma cancha:** `50 pts`.
- **Mismo grupo de 4 compartiendo cancha:** `30 pts`.
- **Desbalance ELO entre canchas:** `|muC1 - muC2| * 3`.
- **Desbalance ELO dentro de cada cancha:** `|muT1 - muT2| * 5`.

Generación por defecto: **4 rondas = 8 partidos**. Se pueden agregar más rondas durante la sesión con "Añadir otra ronda". El campo `courts` en `state.session` indica el modo (1 o 2). **No se persiste en la DB** (solo en memoria/localStorage).

### 3. Resultados Libres y Descartes
No hay límite de games. Los usuarios ingresan el resultado de cada partido mediante botones táctiles rápidos (`-` / `+`). Al finalizar la jornada, el sistema **descarta y borra automáticamente los partidos que quedaron 0-0** o no se jugaron.

### 4. Fin de Jornada y Compartir
Al terminar la jornada, se muestra el MVP ("Batacazo del día") calculado por Evolución ELO (quién sumó más puntos), junto con una tabla de la evolución diaria. Incluye un botón para compartir el podio preformateado en WhatsApp (`shareSessionWhatsApp`).

## ⚙️ Reglas Importantes de Desarrollo
1. **Diseño Premium**: El CSS está muy pulido con glassmorphism, gradientes, bordes sutiles y modo oscuro. Al agregar componentes, respeta las variables CSS existentes (ej: `var(--accent)`, `var(--bg-card)`) y las clases como `.card`, `.btn`, `.btn-primary`.
2. **Resiliencia Offline**: Todas las acciones de red deben manejarse amigablemente. Usa `withSync(() => ...)` para mostrar feedback al usuario de la actividad de red.
3. **Vanilla Pura**: No agregues librerías externas ni utilices JSX. Los componentes se renderizan mediante Template Literals (`` `...` ``).

---
*Última actualización: 14 de junio 2026 — Fix ELO cascade + cálculo por jornada + panel de transparencia + Modo 2 Canchas*
