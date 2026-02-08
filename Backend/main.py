import sqlite3
import os
import msal
import requests
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI()

# --- CONFIGURATION ---
# Permissive CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Set the path to the database file
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
    tenant_id: str
    client_id: str
    client_secret: str
    devices: List[DeviceEntry]

# --- DATABASE HELPERS ---
def get_db_connection():
    """Helper to connect to the local SQLite file."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row  # This lets us access columns by name
    return conn

@app.on_event("startup")
def startup():
    """Ensures the database and table exist when the API starts."""
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
        conn.commit()
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

# --- AZURE / INTUNE ENDPOINTS ---

@app.post("/test-azure-connection")
def test_azure_connection(config: AzureConfig):
    """
    Validates Azure Credentials by attempting to acquire a Graph API token.
    """
    authority_url = f"https://login.microsoftonline.com/{config.tenant_id}"
    
    # 1. Initialize the MSAL Confidential Client
    try:
        app_client = msal.ConfidentialClientApplication(
            config.client_id,
            authority=authority_url,
            client_credential=config.client_secret,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to initialize MSAL client: {str(e)}")

    # 2. Try to acquire a token for Microsoft Graph
    # The '.default' scope requests all permissions granted in the Azure Portal
    result = app_client.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])

    if "error" in result:
        # Authentication failed (Wrong Secret, ID, or Tenant)
        error_desc = result.get('error_description', 'Unknown error')
        raise HTTPException(status_code=401, detail=f"Authentication Failed: {error_desc}")

    # 3. Success
    return {
        "status": "success", 
        "message": "Connection Successful! Token acquired.",
        "token_type": result.get("token_type"),
        "expires_in": result.get("expires_in")
    }
@app.post("/push-to-intune")
def push_to_intune(data: PushRequest):
    """
    Pushes devices to Intune using the BULK IMPORT action.
    Target: https://graph.microsoft.com/beta/deviceManagement/importedDeviceIdentities/importDeviceIdentityList
    """
    
    # 1. Authenticate (Same as before)
    authority_url = f"https://login.microsoftonline.com/{data.tenant_id}"
    try:
        app_client = msal.ConfidentialClientApplication(
            data.client_id,
            authority=authority_url,
            client_credential=data.client_secret,
        )
        token_result = app_client.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"MSAL Init Failed: {str(e)}")

    if "error" in token_result:
        raise HTTPException(status_code=401, detail="Authentication Failed: Check Client Secret/ID")

    access_token = token_result['access_token']
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }

    # 2. Prepare the BULK Payload
    # We transform your simple device list into the specific Graph API objects
    identities_list = []
    for device in data.devices:
        identities_list.append({
            "importedDeviceIdentifier": device.serial,
            "importedDeviceIdentifierType": "serialNumber",
            "description": f"{device.manufacturer} - {device.model}",
            "platform": "windows"
        })

    # The Action Payload wrapper
    payload = {
        "importedDeviceIdentities": identities_list,
        "overwriteImportedDeviceIdentities": True 
    }

    # 3. Send ONE request for all devices
    url = "https://graph.microsoft.com/beta/deviceManagement/importedDeviceIdentities/importDeviceIdentityList"
    
    results = []

    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            # The API returns a list of results for each item we sent
            # Response format: { "value": [ { "importedDeviceIdentifier": "SN123", "status": true, ... } ] }
            api_results = response.json().get("value", [])
            
            # Map API results back to our format
            for res in api_results:
                is_success = res.get("status", False) # Graph returns boolean 'status' (true=success)
                serial = res.get("importedDeviceIdentifier", "Unknown")
                
                results.append({
                    "serial": serial,
                    "status": "success" if is_success else "error",
                    "message": "Imported Successfully" if is_success else "Failed (Check Intune)"
                })
        else:
            # If the entire BATCH failed (e.g. 500 Server Error)
            error_msg = f"Batch Failed: {response.text}"
            # Mark all as failed so UI shows red
            for device in data.devices:
                results.append({"serial": device.serial, "status": "error", "message": error_msg})

    except Exception as e:
        # Network level failure
        for device in data.devices:
            results.append({"serial": device.serial, "status": "error", "message": str(e)})

    return {"results": results}