Overview

This application is intended to assist administrators with solving a challenge related to blocking personal devices in Intune: 
Getting the correctly formatted corporate device identifier (manufacturer, model, serial number) into Intune before the device is enrolled.

App components: 
Frontend: React (Vite) served by Nginx.
Backend: Python FastAPI (Async).
Database: SQLite (Persistent Volume).
Sync Engine: Automatically downloads and updates official hardware models from Dell, HP, and Lenovo daily.
_____________________________________________________________________________________________________________________________________________________________

Deployment Guide (Docker)
Prerequisites

    A Linux server with Docker and Docker Compose installed.

    (Optional but Recommended) Portainer for management.

    Outbound Internet Access (See Firewall Requirements below).
_____________________________________________________________________________________________________________________________________________________________

Quick Start (Portainer)

    Log in to Portainer.

    Go to Stacks > Add stack.

    Name: intune-device-app.

    Build method: Repository.

    Repository URL: https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

    Reference: refs/heads/main

    Click Deploy the stack.
_____________________________________________________________________________________________________________________________________________________________

Manual Deployment (CLI)
Bash

# Clone the repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME

# Start the stack (Detached mode)
docker-compose up -d
_____________________________________________________________________________________________________________________________________________________________
Configuration
1. Reverse Proxy (Required for SSL)

The application exposes HTTP on Port 8090 by default. You must use a reverse proxy (like Nginx, HAProxy, or Traefik) to handle SSL/TLS termination.

2. Firewall Rules (Outbound)

The Backend container requires outbound access to the following URLs to fetch manufacturer catalogs and communicate with Microsoft Graph:
Microsoft Graph	| *.microsoftonline.com	| TCP 443	| Needed for: Authentication (OAuth2)
Microsoft Graph	| *.microsoft.com	| TCP 443	| Needed for: Intune API (Device Import)
Dell Support	| *.dell.com	| TCP 443	| Needed for: Device Model Catalog (CatalogPC.cab)
HP Support	| *.hp.com	| TCP 443	| Needed for: Device Model Catalog (platformList.cab)
Lenovo Support	| *.lenovo.com	| TCP 443	| Needed for: Device Model Catalog (catalogv2.xml)

3. Azure App Registration

To push devices to Intune, the app requires an App Registration in Azure AD (Entra ID).

    Go to Entra ID > App registrations > New registration.

    Name: Intune Device Importer.

    API Permissions:

        DeviceManagementServiceConfig.ReadWrite.All (Application Permission)

        Grant Admin Consent for these permissions.

    Certificates & secrets: Create a new Client Secret.

    Copy Values: You will need the Tenant ID, Client ID, and Client Secret to configure the app via the UI.
_____________________________________________________________________________________________________________________________________________________________
Architecture & troubleshooting
Container Architecture

    frontend (intune_frontend):

        Runs Nginx.

        Serves the React static files.

        Acts as an internal reverse proxy: Requests to /api/* are forwarded to the backend container.

    backend (intune_backend):

        Runs Uvicorn/FastAPI.

        Is NOT exposed to the host network (Security best practice).

        Performs a daily sync of the catalogue.db at startup.
_____________________________________________________________________________________________________________________________________________________________

Common Issues

1. "502 Bad Gateway" on Startup

    Cause: The backend is performing its initial download of the Dell/HP/Lenovo catalogs (approx. 100MB).

    Solution: Wait 2-3 minutes. The healthcheck in Docker Compose ensures the frontend will not route traffic until the backend is ready.

2. Frontend loads, but API calls fail (CORS/Network Error)

    Check: Open Developer Tools (F12) > Network.

    If 404: Ensure your reverse proxy is passing the /api path correctly.

    If Connection Refused: Ensure the backend container is running (docker ps).

3. Database Persistence

    The SQLite database is stored in /app/data inside the container.

    This is mapped to the Docker Volume app_data.

    Backup: You can back up this volume to save the catalogue.db (Model cache) and settings (Azure Credentials).

