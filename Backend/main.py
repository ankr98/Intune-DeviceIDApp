import sqlite3
import os
import msal
import requests
import asyncio
import hashlib
import logging
import threading
import sync_service
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# --- LOGGING SETUP ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_FILE = os.path.join(DATA_DIR, "catalogue.db")

# --- DATA MODELS ---
class AzureConfig(BaseModel):
    tenant_id: str
    client_id: str
    client_secret: str
    default_manufacturer: Optional[str] = None

class DeviceEntry(BaseModel):
    manufacturer: str
    model: str
    serial: str

class PushRequest(BaseModel):
    devices: List[DeviceEntry]

# --- DATABASE HELPERS ---
def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

# --- SYNC ENGINE ---
async def sync_device_catalogue():
    logger.info("[SYNC] Triggering background device catalogue update...")
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, sync_service.run_sync_all)
        logger.info("[SYNC] Background update process finished.")
    except Exception as e:
        logger.error(f"[SYNC] FAILED: {e}")

# --- LIFESPAN (replaces deprecated @app.on_event) ---
@asynccontextmanager
async def lifespan(_app: FastAPI):
    # STARTUP
    conn = get_db_connection()
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manufacturer TEXT,
                model_name TEXT,
                UNIQUE(manufacturer, model_name)
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        conn.commit()

        table_check = conn.execute("SELECT count(*) FROM models").fetchone()[0]
        if table_check == 0:
            logger.info("[INSTALL] Database is empty. Running initial catalogue build...")
            await sync_device_catalogue()
        else:
            logger.info(f"[READY] Database loaded with {table_check} models.")
    finally:
        conn.close()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(sync_device_catalogue, 'interval', hours=24)
    scheduler.start()
    logger.info("[SCHEDULER] Background sync scheduled every 24 hours.")

    yield  # Application runs here

    # SHUTDOWN
    scheduler.shutdown()
    logger.info("[SHUTDOWN] Scheduler stopped.")

app = FastAPI(lifespan=lifespan)

# No CORS middleware: the API is only reached same-origin via the nginx
# (prod) or Vite (dev) /api proxy.

# --- INTERNAL HELPERS ---
def get_azure_credentials():
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        config = {row["key"]: row["value"] for row in rows}
        required = ["tenant_id", "client_id", "client_secret"]
        missing = [k for k in required if k not in config]
        if missing:
            logger.warning(f"[AUTH] Missing config keys: {missing}")
            raise HTTPException(status_code=400, detail=f"Azure config missing: {', '.join(missing)}")
        return config
    finally:
        conn.close()

# Reuse one ConfidentialClientApplication per credential set so MSAL's
# built-in token cache is effective (tokens live ~1h) instead of hitting
# AAD on every request.
_msal_cache = {"key": None, "app": None}
_msal_lock = threading.Lock()

def get_msal_app(creds):
    key = (
        creds["tenant_id"],
        creds["client_id"],
        hashlib.sha256(creds["client_secret"].encode()).hexdigest(),
    )
    with _msal_lock:
        if _msal_cache["key"] != key:
            _msal_cache["app"] = msal.ConfidentialClientApplication(
                creds["client_id"],
                authority=f"https://login.microsoftonline.com/{creds['tenant_id']}",
                client_credential=creds["client_secret"],
            )
            _msal_cache["key"] = key
        return _msal_cache["app"]

# --- API ENDPOINTS ---

@app.get("/health")
def health():
    """Dedicated health endpoint used by the Docker healthcheck."""
    conn = get_db_connection()
    try:
        count = conn.execute("SELECT count(*) FROM models").fetchone()[0]
        return {"status": "ok", "models_loaded": count}
    finally:
        conn.close()

@app.get("/config")
def get_config():
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        config = {row["key"]: row["value"] for row in rows}
        if "client_secret" in config:
            config["client_secret"] = "********"
        return config
    finally:
        conn.close()

@app.post("/config")
def save_config(config: AzureConfig):
    conn = get_db_connection()
    try:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('tenant_id', ?)", (config.tenant_id,))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('client_id', ?)", (config.client_id,))
        if config.client_secret != "********":
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('client_secret', ?)", (config.client_secret,))
            logger.info("[CONFIG] Client secret updated.")
        else:
            logger.info("[CONFIG] Client secret unchanged (masked value received).")
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('default_manufacturer', ?)",
            (config.default_manufacturer or "",)
        )
        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

@app.get("/manufacturers")
def get_manufacturers():
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT DISTINCT manufacturer FROM models ORDER BY manufacturer").fetchall()
        return [row["manufacturer"] for row in rows]
    finally:
        conn.close()

@app.get("/models")
def get_models(manufacturer: str = Query(...)):
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT model_name FROM models WHERE manufacturer = ? ORDER BY model_name",
            (manufacturer,)
        ).fetchall()
        return [row["model_name"] for row in rows]
    finally:
        conn.close()

@app.post("/test-azure-connection")
def test_azure_connection(config_in: Optional[AzureConfig] = None):
    try:
        if config_in and config_in.client_secret != "********":
            creds = config_in.model_dump()
        else:
            creds = get_azure_credentials()

        app_client = get_msal_app(creds)
        result = app_client.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])

        if "error" in result:
            raise HTTPException(status_code=401, detail=result.get('error_description'))

        logger.info("[AUTH] Azure connection test successful.")
        return {"status": "success", "message": "Connection Successful"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[AUTH] Connection test failed: {e}")
        raise HTTPException(status_code=400, detail="Connection test failed. Check the values and see server logs for details.")

GRAPH_IMPORT_URL = "https://graph.microsoft.com/beta/deviceManagement/importedDeviceIdentities/importDeviceIdentityList"
GRAPH_BATCH_SIZE = 500

@app.post("/push-to-intune")
def push_to_intune(data: PushRequest):
    creds = get_azure_credentials()

    try:
        app_client = get_msal_app(creds)
        token_result = app_client.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    except Exception as e:
        logger.error(f"[INTUNE] MSAL init failed: {e}")
        raise HTTPException(status_code=400, detail="Azure authentication could not be initialized. Check Server Settings.")

    if "error" in token_result:
        raise HTTPException(status_code=401, detail="Authentication Failed. Check Server Settings.")

    headers = {
        'Authorization': f"Bearer {token_result['access_token']}",
        'Content-Type': 'application/json'
    }

    identities_list = []
    for device in data.devices:
        man = device.manufacturer.strip()
        mod = device.model.strip()
        ser = device.serial.strip().upper()
        composite_id = f"{man},{mod},{ser}"
        identities_list.append({
            "@odata.type": "#microsoft.graph.importedDeviceIdentity",
            "importedDeviceIdentifier": composite_id,
            "importedDeviceIdentityType": "manufacturerModelSerial",
            "description": f"Added via App: {man} {mod}",
            "platform": "windows"
        })

    # Graph limits importDeviceIdentityList payload sizes, so push in chunks;
    # a failed chunk only fails its own devices.
    results = []
    for start in range(0, len(identities_list), GRAPH_BATCH_SIZE):
        batch_identities = identities_list[start:start + GRAPH_BATCH_SIZE]
        batch_devices = data.devices[start:start + GRAPH_BATCH_SIZE]
        payload = {
            "importedDeviceIdentities": batch_identities,
            "overwriteImportedDeviceIdentities": True
        }

        try:
            response = requests.post(GRAPH_IMPORT_URL, headers=headers, json=payload, timeout=(10, 120))
        except requests.RequestException as e:
            logger.error(f"[INTUNE] Graph request failed for devices {start + 1}-{start + len(batch_devices)}: {e}")
            results.extend(
                {"serial": d.serial, "status": "error", "message": "Could not reach Microsoft Graph. See server logs."}
                for d in batch_devices
            )
            continue

        if response.status_code == 200:
            api_results = response.json().get("value", [])
            logger.info(f"[INTUNE] Pushed batch of {len(api_results)} devices.")
            results.extend(
                {
                    "serial": res.get("importedDeviceIdentifier", "").split(',')[-1] if ',' in res.get("importedDeviceIdentifier", "") else "Unknown",
                    "status": "success" if res.get("status") else "error",
                    "message": "Imported Successfully" if res.get("status") else res.get("error", {}).get("message", "Failed")
                } for res in api_results
            )
        else:
            try:
                main_error = response.json().get("error", {}).get("message")
            except ValueError:
                main_error = None
            message = f"Batch Failed: {main_error or f'Graph API error (HTTP {response.status_code})'}"
            logger.error(f"[INTUNE] {message} (devices {start + 1}-{start + len(batch_devices)})")
            results.extend(
                {"serial": d.serial, "status": "error", "message": message}
                for d in batch_devices
            )

    return {"results": results}
