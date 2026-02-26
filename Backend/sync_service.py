import requests
import sqlite3
import os
import logging
import tempfile
import xml.etree.ElementTree as ET
import platform
import subprocess

# --- LOGGING SETUP ---
logger = logging.getLogger(__name__)

# --- CONFIGURATION ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_FILE = os.path.join(DATA_DIR, "catalogue.db")

# Ensure the folder exists (in case this script runs standalone)
os.makedirs(DATA_DIR, exist_ok=True)

# --- VENDOR PROVIDERS ---

def fetch_lenovo():
    """Logic specifically for Lenovo CDRT XML."""
    url = "https://download.lenovo.com/cdrt/td/catalogv2.xml"
    logger.info("[LENOVO] Fetching catalogue...")
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        models = [m.get("name") for m in root.findall(".//Model") if m.get("name")]
        logger.info(f"[LENOVO] Found {len(models)} models.")
        return ("Lenovo", list(set(models)))
    except Exception as e:
        logger.error(f"[LENOVO] Sync failed: {e}")
        return ("Lenovo", [])

def fetch_hp():
    """
    Robust Cross-Platform HP Sync using 'extrac32' (Windows) and 'cabextract' (Linux).
    """
    url = "https://ftp.hp.com/pub/caps-softpaq/cmit/imagepal/ref/platformList.cab"
    logger.info("[HP] Fetching catalogue (CAB extraction)...")

    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        with tempfile.TemporaryDirectory() as tmpdir:
            cab_path = os.path.join(tmpdir, "hp_catalog.cab")

            with open(cab_path, "wb") as f:
                f.write(response.content)

            current_os = platform.system()

            try:
                if current_os == "Windows":
                    cmd = ["extrac32", "/E", "/L", tmpdir, cab_path]
                elif current_os == "Linux":
                    cmd = ["cabextract", "-d", tmpdir, cab_path]
                else:
                    logger.warning(f"[HP] Unsupported OS for CAB extraction: {current_os}")
                    return ("HP", [])

                subprocess.run(cmd, check=True, capture_output=True, text=True)

            except subprocess.CalledProcessError as e:
                logger.error(f"[HP] CAB extraction command failed: {e.stderr}")
                return ("HP", [])
            except FileNotFoundError:
                logger.error(f"[HP] Extraction tool '{cmd[0]}' not found. Is it installed?")
                return ("HP", [])

            target_xml = None
            for root, _, files in os.walk(tmpdir):
                for file in files:
                    if file.lower() == "platformlist.xml":
                        target_xml = os.path.join(root, file)
                        break
                if target_xml:
                    break

            if not target_xml:
                logger.error("[HP] platformList.xml not found in extracted CAB.")
                return ("HP", [])

            tree = ET.parse(target_xml)
            root = tree.getroot()

            models = []
            for platform_entry in root.findall(".//Platform"):
                product_name = platform_entry.find("ProductName")
                if product_name is not None and product_name.text:
                    models.append(product_name.text.strip())

            logger.info(f"[HP] Found {len(models)} models.")
            return ("HP", list(set(models)))

    except Exception as e:
        logger.error(f"[HP] Sync failed: {e}")
        return ("HP", [])

def fetch_dell():
    """
    Robust Dell Sync using CatalogPC.cab.
    Uses iterparse for the large XML (>100MB).
    """
    url = "https://downloads.dell.com/catalog/CatalogPC.cab"
    logger.info("[DELL] Fetching catalogue (CAB extraction)...")

    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()

        with tempfile.TemporaryDirectory() as tmpdir:
            cab_path = os.path.join(tmpdir, "dell_catalog.cab")

            with open(cab_path, "wb") as f:
                f.write(response.content)

            current_os = platform.system()
            try:
                if current_os == "Windows":
                    cmd = ["extrac32", "/E", "/L", tmpdir, cab_path]
                elif current_os == "Linux":
                    cmd = ["cabextract", "-d", tmpdir, cab_path]
                else:
                    logger.warning(f"[DELL] Unsupported OS for CAB extraction: {current_os}")
                    return ("Dell", [])

                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as e:
                logger.error(f"[DELL] CAB extraction failed: {e}")
                return ("Dell", [])

            target_xml = None
            for root, _, files in os.walk(tmpdir):
                for file in files:
                    if file.lower().endswith(".xml"):
                        target_xml = os.path.join(root, file)
                        break
                if target_xml:
                    break

            if not target_xml:
                logger.error("[DELL] No XML file found in extracted CAB.")
                return ("Dell", [])

            models = set()
            context = ET.iterparse(target_xml, events=("end",))
            for _, elem in context:
                if elem.tag == "Model":
                    display_node = elem.find("Display")
                    if display_node is not None and display_node.text:
                        models.add(display_node.text.strip())
                    elif elem.get("name"):
                        models.add(elem.get("name").strip())
                    elem.clear()

            logger.info(f"[DELL] Found {len(models)} models.")
            return ("Dell", list(models))

    except Exception as e:
        logger.error(f"[DELL] Sync failed: {e}")
        return ("Dell", [])

# --- CORE ENGINE ---

def save_to_db(manufacturer, models):
    """Handles the heavy lifting of SQL insertion."""
    if not models:
        return 0

    conn = sqlite3.connect(DB_FILE)
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            manufacturer TEXT,
            model_name TEXT,
            UNIQUE(manufacturer, model_name)
        )
    ''')

    count = 0
    for name in models:
        cursor.execute(
            "INSERT OR IGNORE INTO models (manufacturer, model_name) VALUES (?, ?)",
            (manufacturer, name.strip())
        )
        if cursor.rowcount > 0:
            count += 1

    conn.commit()
    conn.close()
    return count

def run_sync_all():
    """The master orchestrator."""
    logger.info("=== STARTING GLOBAL SYNC ===")

    providers = [fetch_lenovo, fetch_hp, fetch_dell]

    total_new = 0
    for provider in providers:
        vendor_name, model_list = provider()
        added = save_to_db(vendor_name, model_list)
        logger.info(f"[SYNC] {vendor_name}: {len(model_list)} total, {added} new added.")
        total_new += added

    logger.info(f"=== SYNC COMPLETE: {total_new} NEW MODELS ADDED ===")
    return total_new

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    run_sync_all()
