# 🎾 RotaPádel

RotaPádel es una aplicación web móvil (*Mobile-First PWA*) diseñada para gestionar turnos, rotaciones equitativas, llevar los resultados y visualizar las estadísticas de tu grupo de jugadores de Pádel. 

En lugar de utilizar una base de datos tradicional que requiere mantenimiento, la aplicación utiliza tu propio **Google Sheets** como baúl de datos mediante un puente de conexión *Serverless* provisto por Google Apps Script.

## ✨ Características Principales

- **Gestión de Jugadores**: Añade a todo tu grupo, personaliza colores y visibiliza sus estadísticas históricas.
- **Armado de Jornadas**: Selecciona quiénes asisten a jugar (entre 4 y 8 personas).
- **Algoritmo de Rotación**: El motor interno cruzará a todos con todos buscando las combinaciones más equitativas de forma automática.
- **Seguimiento en directo**: Carga los resultados de cada partido y el sistema generará de forma automática el cruce del siguiente partido.
- **Estadísticas**: Tablas globales de Victorias, Games sumados, Nivel de Asistencia y Mejores Parejas.
- **Offline Fallback**: El estado se cachea de forma local por lo que si pierdes señal dentro de la pista, la app nunca te dejará tirado e intentará sincronizar de nuevo al volver en línea.

## 🚀 Arquitectura y Tecnologías

- **Frontend**: Vanilla Javascript (ES6), HTML5 y CSS3 nativo. Sin pesados frameworks que retrasen la carga en el celular.
- **Backend / Base de datos**: Google Sheets + Google Apps Script (`doGet` / REST JSON api).
- **Despliegue C-CD**: Netlify con compilación de variables de entorno (Node.js).

---

## 🛠 Instalación y Despliegue Local

### 1. Configurar Base de Datos (Google Sheets)
1. Crea una Hoja de Cálculo nueva en tu cuenta de Google.
2. Ve a **Extensiones > Apps Script**.
3. Reemplaza el texto en el editor por el contenido del archivo `apps-script.gs` de este repositorio.
4. Arriba a la derecha dale a **Implementar > Nueva Implementación**.
5. Selecciona el ícono del engranaje y escoge **Aplicación Web**.
6. En *Ejecutar como*, elige **Yo**. En *Quién tiene acceso*, elige **Cualquier persona**.
7. Copia la URL de Aplicación Web generada. ¡Tu base de datos está lista!

### 2. Ejecutar la Aplicación Localmente
1. Clona el repositorio:
   ```bash
   git clone https://github.com/tu-usuario/rota-padel.git
   ```
2. Renombra/copia el archivo `config.example.js` y llámalo `config.js`
3. Pega la URL de tu API de Apps Script dentro de la variable de `config.js`. *(Nota: `config.js` está ignorado en git por seguridad de tu clave)*
4. Abre `index.html` con cualquier servidor local (Ej: `Live Server` en VSCode) y la app funcionará mágicamente unida a tu Excel. 

### 3. Deploy en Netlify (Producción)
1. Conecta tu repositorio de GitHub a tu cuenta de Netlify.
2. Netlify detectará automáticamente tu archivo `netlify.toml` con los pasos para hacer la compilación web.
3. Para que la app sepa la URL de la base de datos sin subir tu `config.js`, **debes inyectar una variable de entorno**:
   - Ve a Netlify Dashboard > Tu sitio > *Site configuration* > *Environment variables*.
   - Crea una variable **Key:** `SHEETS_API_URL`
   -  **Value:** *[Tu URL del Apps Script]*
4. Dispara un nuevo despliegue manual en Netlify y ¡listo! Tienes RotaPádel corriendo de forma global. 
