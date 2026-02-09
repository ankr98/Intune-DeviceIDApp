import sqlite3
import os
import msal
import requests
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()

# --- CONFIGURATION ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "catalogue.db")

# --- DATA MODELS ---
class AzureConfig(BaseModel):
    tenant_id: str
    client_id: str
    client_secret: str

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
    return conn

@app.on_event("startup")
def startup():
    conn = get_db_connection()
    try:
        # Create Hardware Table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manufacturer TEXT,
                model_name TEXT,
                UNIQUE(manufacturer, model_name)
            )
        ''')
        # Create Settings Table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        conn.commit()
    finally:
        conn.close()

# --- INTERNAL HELPERS (Must be above endpoints that use them) ---

def get_azure_credentials():
    """Internal helper to fetch credentials from the local database."""
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        config = {row["key"]: row["value"] for row in rows}
        
        # --- DEBUG LOGGING ---
        # This will print to your VS Code terminal so you can see what is saved
        print(f"DEBUG: Reading DB Settings. Keys found: {list(config.keys())}")
        # ---------------------

        # Check if we have the required keys
        required = ["tenant_id", "client_id", "client_secret"]
        missing = [k for k in required if k not in config]
        
        if missing:
            print(f"DEBUG: Missing keys: {missing}")
            raise HTTPException(status_code=400, detail=f"Azure config missing: {', '.join(missing)}")
            
        return config
    finally:
        conn.close()

# --- CONFIG / SETTINGS ENDPOINTS ---

@app.get("/config")
def get_config():
    """Retrieves saved config (masks secret for UI)."""
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
@app.post("/config")
def save_config(config: AzureConfig):
    """Saves Azure credentials to the local SQLite database."""
    print(f"DEBUG: SAVE RECEIVED -> Tenant: {config.tenant_id}, Client: {config.client_id}")
    
    conn = get_db_connection()
    try:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('tenant_id', ?)", (config.tenant_id,))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('client_id', ?)", (config.client_id,))
        
        # Logic to handle the masked secret
        if config.client_secret and config.client_secret != "********":
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('client_secret', ?)", (config.client_secret,))
            print("DEBUG: Client Secret Saved to DB")
        else:
            print("DEBUG: Client Secret was masked, skipping save.")
            
        conn.commit()
        
        # IMMEDIATE VERIFICATION
        check = conn.execute("SELECT count(*) FROM settings").fetchone()[0]
        print(f"DEBUG: Total rows in settings table now: {check}")
        
        return {"status": "success"}
    except Exception as e:
        print(f"DEBUG: Save Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

# --- HARDWARE ENDPOINTS ---

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

# --- INTUNE / GRAPH ENDPOINTS ---

@app.post("/test-azure-connection")
def test_azure_connection(config_in: Optional[AzureConfig] = None):
    """Tests connection using provided config OR saved DB config."""
    try:
        if config_in and config_in.client_secret != "********":
            creds = config_in.dict()
        else:
            creds = get_azure_credentials()

        authority_url = f"https://login.microsoftonline.com/{creds['tenant_id']}"
        app_client = msal.ConfidentialClientApplication(
            creds['client_id'],
            authority=authority_url,
            client_credential=creds['client_secret'],
        )
        result = app_client.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])

        if "error" in result:
            raise HTTPException(status_code=401, detail=result.get('error_description'))
        return {"status": "success", "message": "Connection Successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/push-to-intune")
def push_to_intune(data: PushRequest):
    """
    Pushes devices using the 'manufacturerModelSerial' composite key required for Windows.
    """
    creds = get_azure_credentials()
    authority_url = f"https://login.microsoftonline.com/{creds['tenant_id']}"
    
    try:
        app_client = msal.ConfidentialClientApplication(
            creds['client_id'],
            authority=authority_url,
            client_credential=creds['client_secret'],
        )
        token_result = app_client.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"MSAL Init Failed: {str(e)}")

    if "error" in token_result:
        raise HTTPException(status_code=401, detail="Authentication Failed. Check Server Settings.")

    headers = {
        'Authorization': f"Bearer {token_result['access_token']}",
        'Content-Type': 'application/json'
    }

    identities_list = []
    for device in data.devices:
        # 1. Clean the data (Strip whitespace)
        man = device.manufacturer.strip()
        mod = device.model.strip()
        ser = device.serial.strip().upper()

        # 2. Construct the Composite Key (Comma Separated)
        # Format: "Manufacturer,Model,SerialNumber"
        composite_id = f"{man},{mod},{ser}"

        identities_list.append({
            # The Magic Header
            "@odata.type": "#microsoft.graph.importedDeviceIdentity",
            
            # The Composite String
            "importedDeviceIdentifier": composite_id,
            
            # The Correct Windows Type
            "importedDeviceIdentityType": "manufacturerModelSerial",
            
            "description": f"Added via App: {man} {mod}",
            "platform": "windows"
        })

    payload = {
        "importedDeviceIdentities": identities_list,
        "overwriteImportedDeviceIdentities": True 
    }

    url = "https://graph.microsoft.com/beta/deviceManagement/importedDeviceIdentities/importDeviceIdentityList"
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            api_results = response.json().get("value", [])
            
            return {"results": [
                {
                    "serial": res.get("importedDeviceIdentifier", "").split(',')[-1] if ',' in res.get("importedDeviceIdentifier", "") else "Unknown",
                    "status": "success" if res.get("status") else "error",
                    "message": "Imported Successfully" if res.get("status") else res.get("error", {}).get("message", "Failed")
                } for res in api_results
            ]}
        else:
            error_json = response.json()
            main_error = error_json.get("error", {}).get("message", response.text)
            raise Exception(f"Batch Failed: {main_error}")

    except Exception as e:
        return {"results": [{"serial": d.serial, "status": "error", "message": str(e)} for d in data.devices]}