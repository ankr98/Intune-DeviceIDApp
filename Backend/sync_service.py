import requests
import sqlite3
import os
import tempfile
import xml.etree.ElementTree as ET
import platform
import subprocess

# --- CONFIGURATION ---
DB_FILE = os.path.join(os.path.dirname(__file__), "catalogue.db")

# --- VENDOR PROVIDERS ---

def fetch_lenovo():
    """Logic specifically for Lenovo CDRT XML."""
    url = "https://download.lenovo.com/cdrt/td/catalogv2.xml"
    print(f"-> Fetching Lenovo data...")
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        
        # Pulling 'name' attribute from <Model> tags
        models = [m.get("name") for m in root.findall(".//Model") if m.get("name")]
        return ("Lenovo", list(set(models)))
    except Exception as e:
        print(f"   [!] Lenovo Sync Failed: {e}")
        return ("Lenovo", [])

def fetch_hp():
    """
    Robust Cross-Platform HP Sync using 'extrac32' (Windows) and 'cabextract' (Linux).
    Includes full error logging.
    """
    url = "https://ftp.hp.com/pub/caps-softpaq/cmit/imagepal/ref/platformList.cab"
    print(f"-> Fetching HP data (Robust Extraction)...")
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        with tempfile.TemporaryDirectory() as tmpdir:
            cab_path = os.path.join(tmpdir, "hp_catalog.cab")
            
            # 1. Save the downloaded CAB
            with open(cab_path, "wb") as f:
                f.write(response.content)
            
            current_os = platform.system()
            
            # 2. Extract based on OS
            try:
                if current_os == "Windows":
                    # 'extrac32' is a hidden Windows tool that is often more reliable than 'expand'
                    # /E = Extract, /L = Location, /Y = Overwrite yes
                    cmd = ["extrac32", "/E", "/L", tmpdir, cab_path]
                elif current_os == "Linux":
                    cmd = ["cabextract", "-d", tmpdir, cab_path]
                else:
                    print(f"   [!] OS {current_os} not supported for HP sync.")
                    return ("HP", [])

                # Run the command and CAPTURE output for debugging
                result = subprocess.run(
                    cmd,
                    check=True,
                    capture_output=True,
                    text=True
                )
                
            except subprocess.CalledProcessError as e:
                # If extraction fails, PRINT THE ERROR
                print(f"   [!] Extraction Command Failed!")
                print(f"   [!] STDOUT: {e.stdout}")
                print(f"   [!] STDERR: {e.stderr}")
                return ("HP", [])

            # 3. Hunt for the XML file recursively
            target_xml = None
            found_files = []
            
            for root, dirs, files in os.walk(tmpdir):
                for file in files:
                    found_files.append(file)
                    if file.lower() == "platformlist.xml":
                        target_xml = os.path.join(root, file)
                        break
                if target_xml:
                    break
            
            if not target_xml:
                print(f"   [!] Debug: Temp folder contains: {found_files}")
                print("   [!] platformList.xml not found.")
                return ("HP", [])

            # 4. Parse the found XML
            tree = ET.parse(target_xml)
            root = tree.getroot()
            
            models = []
            for platform_entry in root.findall(".//Platform"):
                product_name = platform_entry.find("ProductName")
                if product_name is not None and product_name.text:
                    models.append(product_name.text.strip())
            
            return ("HP", list(set(models)))
            
    except Exception as e:
        print(f"   [!] HP Sync Failed: {e}")
        return ("HP", [])

def fetch_dell():
    """
    Robust Dell Sync using CatalogPC.cab.
    - URL: https://downloads.dell.com/catalog/CatalogPC.cab
    - Extraction: Uses 'extrac32' (Windows) or 'cabextract' (Linux).
    - Parsing: Uses iterparse because the extracted XML is HUGE (>100MB).
    """
    url = "https://downloads.dell.com/catalog/CatalogPC.cab"
    print(f"-> Fetching Dell data (CatalogPC.cab)...")
    
    try:
        response = requests.get(url, timeout=60) # Increased timeout for larger file
        response.raise_for_status()

        with tempfile.TemporaryDirectory() as tmpdir:
            cab_path = os.path.join(tmpdir, "dell_catalog.cab")
            
            # 1. Save the downloaded CAB
            with open(cab_path, "wb") as f:
                f.write(response.content)
            
            # 2. Extract using OS tools (Same robust logic as HP)
            current_os = platform.system()
            try:
                if current_os == "Windows":
                    cmd = ["extrac32", "/E", "/L", tmpdir, cab_path]
                elif current_os == "Linux":
                    cmd = ["cabextract", "-d", tmpdir, cab_path]
                else:
                    return ("Dell", [])

                # Run extraction quietly
                subprocess.run(
                    cmd,
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except subprocess.CalledProcessError:
                print("   [!] Dell Extraction Failed.")
                return ("Dell", [])

            # 3. Find the XML (It is usually named CatalogPC.xml)
            target_xml = None
            for root, dirs, files in os.walk(tmpdir):
                for file in files:
                    if file.lower().endswith(".xml"):
                        target_xml = os.path.join(root, file)
                        break
                if target_xml:
                    break
            
            if not target_xml:
                print("   [!] Dell XML not found in extracted CAB.")
                return ("Dell", [])

            # 4. Parse the Dell Catalog
            # This file is massive, so we use iterparse to save RAM.
            # We are looking for <Model> tags with a 'display' child or 'name' attribute.
            models = set()
            
            context = ET.iterparse(target_xml, events=("end",))
            for event, elem in context:
                # Dell structure is usually: <Model systemID="xyz"><Display>Latitude 7420</Display>...</Model>
                if elem.tag == "Model":
                    # Try to find the clean display name first
                    display_node = elem.find("Display")
                    if display_node is not None and display_node.text:
                        models.add(display_node.text.strip())
                    # Fallback to the name attribute
                    elif elem.get("name"):
                        models.add(elem.get("name").strip())
                    
                    # Memory Cleanup: Clear element from RAM
                    elem.clear()
            
            return ("Dell", list(models))

    except Exception as e:
        print(f"   [!] Dell Sync Failed: {e}")
        return ("Dell", [])

# --- CORE ENGINE ---

def save_to_db(manufacturer, models):
    """Handles the heavy lifting of SQL insertion."""
    if not models:
        return 0
        
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Ensure table exists
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
    print("=== STARTING GLOBAL SYNC ===")
    
    # Add your functions to this list as you build them
    providers = [fetch_lenovo, fetch_hp, fetch_dell] 
    
    total_new = 0
    for provider in providers:
        vendor_name, model_list = provider()
        added = save_to_db(vendor_name, model_list)
        print(f"   [+] {vendor_name}: Processed {len(model_list)} total, {added} new added.")
        total_new += added

    print(f"=== SYNC COMPLETE: {total_new} NEW MODELS ADDED ===")

if __name__ == "__main__":
    run_sync_all()