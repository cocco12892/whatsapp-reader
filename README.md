# WhatsApp Reader

Un'applicazione per leggere e gestire i messaggi WhatsApp con architettura separata frontend/backend.

## 🏗️ Architettura

- **Backend**: API Go + WebSocket (porta 8080)
- **Frontend**: React SPA (porta 3000 in dev)
- **Database**: MySQL per produzione, SQLite per WhatsApp session

## 🚀 Sviluppo Locale

### Prerequisiti

- **Node.js** v18+ e npm
- **Go** v1.20+
- **MySQL** (per produzione) o SQLite (dev)

### 1. Setup Backend

```bash
# Clona il repository
git clone <repository-url>
cd whatsapp-reader

# Installa dipendenze Go
go mod download

# Configura database (opzionale - usa SQLite di default)
cp config.json.example config.json
# Edita config.json con le tue credenziali MySQL

# Avvia il backend
go run main.go
```

**Backend disponibile su**: `http://localhost:8080`

**Endpoints**:
- API: `http://localhost:8080/api/*`
- WebSocket: `ws://localhost:8080/ws`
- Health: `http://localhost:8080/health`
- Media: `http://localhost:8080/media/*`

### 2. Setup Frontend

```bash
# Vai nella directory web
cd web

# Installa dipendenze
npm install

# Avvia il dev server
npm run dev
```

**Frontend disponibile su**: `http://localhost:3000`

Il frontend in sviluppo farà proxy delle API calls al backend su porta 8080.

### 3. Connessione WhatsApp

1. Avvia il backend (`go run main.go`)
2. Scansiona il QR code che appare nel terminale con WhatsApp
3. Usa l'opzione "Collegare un dispositivo"
4. La sessione viene salvata in `whatsmeow_store.db`

## 🏭 Build di Produzione

### Backend Build

```bash
# Build locale
go build -o whatsapp-reader .

# Build Docker per AMD64 Linux
docker buildx build --platform linux/amd64 -f Dockerfile.backend -t whatsapp-backend:latest .

# Build con push a registry
docker buildx build --platform linux/amd64 -f Dockerfile.backend -t cocco12892/whatsapp-backend:latest --push .
```

### Frontend Build

```bash
cd web

# Build per produzione
npm run build

# I file compilati saranno in web/dist/
```

## 🚢 Deploy su CapRover

### Opzione 1: Backend su CapRover + Frontend su CDN (Consigliato)

#### Backend su CapRover:

1. **Crea nuova app** in CapRover: `whatsapp-backend`

2. **Deploy tramite Docker**:
```bash
# Build e push
docker buildx build --platform linux/amd64 -f Dockerfile.backend -t cocco12892/whatsapp-backend:latest --push .
```

3. **Configurazione CapRover**:
   - **Image**: `cocco12892/whatsapp-backend:latest`
   - **Port**: `8080`
   - **Variabili ambiente**:
     ```
     DB_HOST=your-mysql-host
     DB_PORT=3306
     DB_USER=your-user
     DB_PASSWORD=your-password
     DB_NAME=whatsapp_viewer
     PORT=8080
     ```

4. **Volumi persistenti**:
   ```
   /app/session -> per sessione WhatsApp
   /app/MediaFiles -> per file media
   /app/ProfileImages -> per immagini profilo
   ```

#### Frontend su Vercel/Netlify:

1. **Configura variabili ambiente**:
   ```bash
   # .env.production
   VITE_BACKEND_URL=whatsapp-backend.your-domain.com
   VITE_BACKEND_PORT=443
   VITE_BACKEND_PROTOCOL=wss
   VITE_API_BASE_URL=https://whatsapp-backend.your-domain.com
   ```

2. **Deploy su Vercel**:
   ```bash
   cd web
   npx vercel --prod
   ```

3. **Deploy su Netlify**:
   ```bash
   cd web
   npm run build
   netlify deploy --prod --dir=dist
   ```

### Opzione 2: Tutto su CapRover (Monolitico)

```bash
# Usa il Dockerfile originale
docker buildx build --platform linux/amd64 -t whatsapp-reader:latest --push .
```

## 🌐 URL di Accesso

### Sviluppo Locale

| Servizio | URL | Descrizione |
|----------|-----|-------------|
| Frontend | `http://localhost:3000` | Interfaccia React |
| Backend API | `http://localhost:8080/api` | REST API |
| Backend WebSocket | `ws://localhost:8080/ws` | Real-time updates |
| Backend Health | `http://localhost:8080/health` | Status check |

### Produzione

#### Architettura Separata (Consigliato):

| Servizio | URL | Descrizione |
|----------|-----|-------------|
| Frontend | `https://your-frontend.vercel.app` | Interfaccia React |
| Backend API | `https://whatsapp-backend.your-domain.com/api` | REST API |
| Backend WebSocket | `wss://whatsapp-backend.your-domain.com/ws` | Real-time updates |

#### Architettura Monolitica:

| Servizio | URL | Descrizione |
|----------|-----|-------------|
| App Completa | `https://whatsapp-reader.your-domain.com` | Frontend + Backend |
| API | `https://whatsapp-reader.your-domain.com/api` | REST API |
| WebSocket | `wss://whatsapp-reader.your-domain.com/ws` | Real-time updates |

## 🔧 Configurazione

### Backend (config.json)

```json
{
  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "root", 
    "password": "your-password",
    "dbname": "whatsapp_viewer"
  },
  "server": {
    "port": 8080
  }
}
```

### Frontend (.env.production)

```bash
VITE_BACKEND_URL=your-backend-domain.com
VITE_BACKEND_PORT=443
VITE_BACKEND_PROTOCOL=wss
VITE_API_BASE_URL=https://your-backend-domain.com
```

## 🗂️ Struttura Progetto

```
whatsapp-reader/
├── 📁 web/                    # Frontend React
│   ├── 📁 src/
│   ├── 📁 components/
│   ├── package.json
│   └── vite.config.js
├── 📁 handlers/               # API handlers Go
├── 📁 models/                 # Data models
├── 📁 db/                     # Database layer
├── 📁 whatsapp/              # WhatsApp client
├── main.go                    # Backend entry point
├── Dockerfile                 # Monolitico (deprecated)
├── Dockerfile.backend         # Solo backend
├── config.json               # Backend config
└── README.md
```

## 🚨 Troubleshooting

### Backend

- **QR code non appare**: Elimina `whatsmeow_store.db` e riavvia
- **Errore database**: Verifica credenziali in `config.json`
- **Porta occupata**: Cambia porta in `config.json`

### Frontend

- **API errors**: Verifica che backend sia in esecuzione
- **CORS errors**: Controlla configurazione CORS nel backend
- **Build errors**: Pulisci cache npm: `rm -rf node_modules package-lock.json && npm install`

### Deploy

- **Container non si avvia**: Verifica variabili ambiente
- **WebSocket connection failed**: Controlla dominio e certificati SSL
- **Media files non visibili**: Verifica mapping volumi

## 📊 Monitoraggio

- **Health check**: `GET /health`
- **Logs backend**: `docker logs container-name`
- **Metrics**: Disponibili tramite endpoint `/metrics` (se abilitato)

## 🔐 Sicurezza

- Cambia password database di default
- Usa HTTPS in produzione
- Limita accesso CORS a domini specifici
- Backup regolari della sessione WhatsApp
- Monitora logs per attività sospette

## 📝 Note

- La sessione WhatsApp è **persistente** e viene salvata nel volume
- I media files sono salvati localmente nel container
- Il sistema supporta **reminder automatici**
- **WebSocket** necessario per aggiornamenti real-time
- Supporto per **multi-chat** simultanee