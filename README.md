# Intune Corporate Device Registration App

A web application that helps IT administrators bulk-register corporate device identifiers (manufacturer, model, serial number) into Microsoft Intune — solving the challenge of blocking personal devices before enrollment.

The app automatically syncs official hardware catalogs from Dell, HP, and Lenovo, letting administrators quickly look up and queue devices for import via the Microsoft Graph API.

![Stack](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square)
![Stack](https://img.shields.io/badge/Frontend-React_+_Mantine-61DAFB?style=flat-square)
![Stack](https://img.shields.io/badge/Database-SQLite-003B57?style=flat-square)
![Stack](https://img.shields.io/badge/Infra-Docker_Compose-2496ED?style=flat-square)

---

## Features

- **Device Model Catalog** — Automatically downloads and updates hardware models from Dell, HP, and Lenovo daily
- **Searchable Dropdowns** — Quickly find manufacturers and models with type-ahead search
- **Serial Number Validation** — Manufacturer-specific format warnings (e.g., Dell 7-char Service Tags, HP 10-char serials)
- **Batch Queue** — Add multiple devices to a queue before pushing, with CSV export and one-click clear
- **Intune Integration** — Bulk-imports devices to Intune via the Microsoft Graph API with per-device status reporting; large queues are pushed in batches of 500 so one failed batch doesn't fail the rest
- **Quick Load** — Recalls your last-used manufacturer/model for fast repeat entries
- **Default Manufacturer** — Pre-select a manufacturer in Settings to skip a click for fleets dominated by one vendor
- **Dark Mode** — Ships with dark theme by default, with a light mode toggle
- **Secure by Design** — Backend is not exposed to the host network; only Nginx is externally accessible. API errors return generic messages to the browser while full details stay in the server logs

---

## Architecture

```
┌─────────────────────┐
│   Browser / User    │
└─────────┬───────────┘
          │ :8090
┌─────────▼───────────┐
│   Nginx (Frontend)  │  Serves React SPA
│   intune_frontend   │  Proxies /api/* ──┐
└─────────────────────┘                   │
          Docker Network                  │
┌─────────────────────┐                   │
│  FastAPI (Backend)  │◄──────────────────┘
│   intune_backend    │
│                     │──► SQLite (/app/data/catalogue.db)
│                     │──► Microsoft Graph API (Intune)
│                     │──► Dell / HP / Lenovo catalogs
└─────────────────────┘
```

| Component | Technology | Role |
|-----------|-----------|------|
| Frontend | React 19 + Vite, Mantine UI | Device queue UI, settings page |
| Reverse Proxy | Nginx (Alpine) | Serves static files (gzip, immutable caching for hashed assets), proxies `/api/*` to backend |
| Backend | Python 3.12, FastAPI, Uvicorn | REST API, catalog sync, Intune integration |
| Database | SQLite (WAL mode) | Stores device model catalog and Azure credentials |
| Scheduler | APScheduler | Daily automatic catalog refresh |

---

## Quick Start

### Prerequisites

- A Linux server (or any Docker host) with **Docker** and **Docker Compose** installed
- Outbound HTTPS access (see [Firewall Requirements](#firewall-requirements))

### Deploy with Docker Compose

```bash
git clone https://github.com/ankr98/Intune-DeviceIDApp.git
cd Intune-DeviceIDApp
docker-compose up -d
```

The app will be available at `http://<server-ip>:8090` once startup completes.

### Deploy with Portainer

1. Go to **Stacks > Add stack**
2. Name: `intune-deviceid-app`
3. Build method: **Repository**
4. Repository URL: `https://github.com/ankr98/Intune-DeviceIDApp`
5. Reference: `refs/heads/main`
6. Click **Deploy the stack**

> **Note:** On first launch, the backend downloads the manufacturer catalogs before it reports healthy. The three vendor downloads run in parallel, so this usually completes in well under a minute, but the healthcheck allows up to 5 minutes for slow networks. The frontend will show a 502 error until the backend healthcheck passes — this is expected.

---

## Configuration

### 1. Azure App Registration

The app uses OAuth2 Client Credentials to call the Microsoft Graph API. You need an App Registration in Entra ID (Azure AD):

1. Go to **Entra ID > App registrations > New registration**
2. Name: `Intune Device Importer` (or any name)
3. Under **API Permissions**, add:
   - `DeviceManagementServiceConfig.ReadWrite.All` (Application permission)
   - Click **Grant admin consent**
4. Under **Certificates & secrets**, create a new **Client Secret**
5. Note down your **Tenant ID**, **Client ID**, and **Client Secret**

Then open the app's **Settings** page and enter these credentials. Use **Test Connection** to verify before saving.

### 2. Reverse Proxy (Recommended)

The app exposes HTTP on port 8090. For production, place a reverse proxy (Nginx, Traefik, HAProxy, etc.) in front to handle SSL/TLS termination.

### 3. Firewall Requirements

The backend container requires outbound HTTPS access to the following:

| Service | Domain | Port | Purpose |
|---------|--------|------|---------|
| Azure Auth | `*.microsoftonline.com` | TCP 443 | OAuth2 token acquisition |
| Microsoft Graph | `*.microsoft.com` | TCP 443 | Intune device import API |
| Dell | `*.dell.com` | TCP 443 | CatalogPC.cab download |
| HP | `*.hp.com`, `*.hpcloud.hp.com` | TCP 443 | HPIA platformList.cab + DriverPack catalog |
| Lenovo | `*.lenovo.com` | TCP 443 | catalogv2.xml download |

---

## Usage

### Generator Page

1. **Select a manufacturer** from the searchable dropdown (auto-filled if a default is set in Settings)
2. **Select a model** — the list filters based on the chosen manufacturer
3. **Enter the serial number** — the app warns if the format doesn't match the manufacturer's convention
4. **Add to Queue** — repeat for as many devices as needed
5. **Push to Intune** — review the confirmation dialog, then submit. Results show per-device success or failure

Use the **Clear** button next to the queue to wipe all queued devices at once (with confirmation), or **CSV** to export the queue. The device queue is stored in your browser's session storage, so it survives page refreshes but clears when you close the tab.

### Settings Page

- Enter and save your Azure credentials (Tenant ID, Client ID, Client Secret)
- Test the connection before saving
- Set a **Default Manufacturer** to pre-select on the Generator page — useful for fleets that are mostly one vendor
- Toggle between dark and light themes

---

## API Reference

All endpoints are served under `/api` via the Nginx reverse proxy.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check — returns `{"status": "ok", "models_loaded": <count>}` |
| `GET` | `/config` | Get current Azure config (secret is masked) |
| `POST` | `/config` | Save Azure credentials |
| `POST` | `/test-azure-connection` | Test Azure credentials without saving |
| `GET` | `/manufacturers` | List all manufacturers in the catalog |
| `GET` | `/models?manufacturer=<name>` | List models for a given manufacturer |
| `POST` | `/push-to-intune` | Bulk-register devices in Intune (batched in chunks of 500; Graph tokens are cached for ~1h) |

### Push to Intune — Request

```json
{
  "devices": [
    { "manufacturer": "Dell", "model": "Latitude 5540", "serial": "ABC1234" },
    { "manufacturer": "HP", "model": "EliteBook 840 G10", "serial": "CND1234567" }
  ]
}
```

### Push to Intune — Response

```json
{
  "results": [
    { "serial": "ABC1234", "status": "success", "message": "Imported successfully" },
    { "serial": "CND1234567", "status": "error", "message": "Device already exists" }
  ]
}
```

---

## Project Structure

```
Intune-DeviceIDApp/
├── Backend/
│   ├── main.py              # FastAPI app, all endpoints, DB init
│   ├── sync_service.py      # Catalog sync (Dell, HP, Lenovo)
│   ├── requirements.txt     # Python dependencies
│   ├── Dockerfile           # Python 3.12-slim + cabextract
│   └── data/
│       └── catalogue.db     # SQLite database (created at runtime)
├── frontend/
│   ├── src/
│   │   ├── main.jsx         # React entry point, Mantine provider
│   │   ├── App.jsx          # Router, navigation bar
│   │   ├── config.js        # API base URL
│   │   └── pages/
│   │       ├── Generator.jsx  # Device registration UI
│   │       └── Settings.jsx   # Azure credential management
│   ├── nginx.conf           # Reverse proxy config (/api → backend)
│   ├── vite.config.js       # Dev server proxy
│   ├── package.json         # Node dependencies
│   └── Dockerfile           # Node build + Nginx Alpine
├── docker-compose.yml       # Service definitions, volumes, networking
└── README.md
```

---

## Catalog Sync Engine

The backend automatically syncs device models from three manufacturers:

| Manufacturer | Source | Format | Update Frequency |
|-------------|--------|--------|-----------------|
| **Lenovo** | CDRT catalog (catalogv2.xml) | XML | Every 24 hours |
| **HP** | HPIA platform list (platformList.cab) + HPClientDriverPackCatalog.cab | CAB → XML | Every 24 hours |
| **Dell** | CatalogPC.cab | CAB → XML (streamed) | Every 24 hours |

- On first startup, if the database is empty, all catalogs are downloaded immediately
- The three vendor downloads run in parallel, and models are bulk-inserted in a single transaction
- Dell's catalog (~100 MB) is parsed with iterative XML parsing to keep memory usage low
- HP syncs from two sources (HPIA platform list + DriverPack catalog) and merges them for broader model coverage
- HP and Dell CAB files are extracted using `cabextract` (Linux) or `extrac32` (Windows)
- New models are inserted; duplicates are ignored via a unique constraint on `(manufacturer, model_name)`

---

## Data Storage

All data lives in a single SQLite database at `/app/data/catalogue.db`, persisted via the `app_data` Docker volume.

| Table | Purpose |
|-------|---------|
| `models` | Device model catalog (manufacturer + model_name, unique) |
| `settings` | Azure credentials (tenant_id, client_id, client_secret) and app preferences (default_manufacturer) |

**Backup:** Back up the `app_data` Docker volume to preserve both the model cache and Azure credentials across redeployments.

> **Note:** The client secret is stored as plaintext in SQLite. The backend masks it when returning it to the frontend, but ensure the Docker volume is properly secured.

---

## Troubleshooting

### "502 Bad Gateway" on startup

The backend is downloading manufacturer catalogs for the first time. This usually finishes in under a minute (downloads run in parallel), and the Docker Compose healthcheck allows up to 300 seconds for slow connections.

### Frontend loads but API calls fail

- Open browser DevTools (F12) > Network tab
- **404 errors**: Check that your reverse proxy passes the `/api` path correctly
- **Connection refused**: Verify the backend container is running (`docker ps`)

### Catalog sync fails

Check backend logs for connection errors:

```bash
docker logs intune_backend
```

Ensure the container has outbound HTTPS access to `dell.com`, `hp.com`, and `lenovo.com`.

### Database lost after redeployment

The SQLite database must be on a persistent Docker volume. Check that the `app_data` volume exists:

```bash
docker volume ls | grep app_data
```

---

## Development

### Backend (local)

```bash
cd Backend
python -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:8000` automatically.

---

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
