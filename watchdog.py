import os
import sys
import time
import urllib.request
import subprocess
import json

# --- Konfiguration ---
HOST = "127.0.0.1" # IP des Servers, normalerweise localhost
PORT = 3000
URL = f"http://{HOST}:{PORT}/server/running"
SETTINGS_URL = f"http://{HOST}:{PORT}/settings/logs"
CHECK_INTERVAL = 5 # In Sekunden, wie oft gecheckt wird
WAIT_AFTER_RESTART = 15 # Wartezeit nach Neustart in Sekunden

last_settings = None

def get_server_settings():
    try:
        req = urllib.request.Request(SETTINGS_URL, method="GET")
        with urllib.request.urlopen(req, timeout=2) as response:
            if response.status == 200:
                data = response.read().decode('utf-8')
                return json.loads(data)
    except Exception:
        pass
    return None

def check_for_setting_changes():
    global last_settings
    current_settings = get_server_settings()
    if current_settings and last_settings:
        for key, value in current_settings.items():
            if key in last_settings and last_settings[key] != value:
                status = "🟢 Aktiviert" if value else "🔴 Deaktiviert"
                print(f"[{time.strftime('%H:%M:%S')}] ⚙️ Einstellung geändert: {key} ist nun {status}")
    if current_settings:
        last_settings = current_settings

def is_server_running():
    try:
        # Kurzer Timeout, um nicht ewig zu warten wenn der Server down ist
        req = urllib.request.Request(URL, method="GET")
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status == 200:
                return True
    except Exception:
        # Bei jeglichem Fehler (Verbindung abgelehnt, Timeout, etc.) gehen wir davon aus, dass er down ist
        return False
    return False

def open_terminal_and_run_node():
    cwd = os.path.dirname(os.path.abspath(__file__))
    
    if sys.platform == "darwin":  # macOS
        print("Starte neues Terminal auf macOS...")
        applescript = f'''
        tell application "Terminal"
            do script "cd '{cwd}' && node server.js"
            activate
        end tell
        '''
        subprocess.run(["osascript", "-e", applescript])
        
    elif sys.platform == "win32":  # Windows
        print("Starte neues Terminal auf Windows...")
        subprocess.Popen(["start", "cmd", "/k", "node --watch server.js"], shell=True, cwd=cwd)
        
    else:
        print("Betriebssystem wird nicht offiziell unterstützt. Versuche Standard-Ausführung...")
        subprocess.Popen(["node", "server.js"], cwd=cwd)

if __name__ == "__main__":
    print("=" * 40)
    print("🤖 PulseOS Watchdog Helper Gestartet")
    print("=" * 40)
    print(f"Überwache: {URL}")
    print(f"Intervall: {CHECK_INTERVAL} Sekunden")
    print("Das Skript läuft nun im Hintergrund. Drücke STRG+C zum Beenden.\n")
    
    # Initiale kleine Pause
    time.sleep(2)
    
    while True:
        if not is_server_running():
            current_time = time.strftime('%H:%M:%S')
            print(f"[{current_time}] ⚠️ Server ist nicht erreichbar! Starte 'node server.js' neu...")
            open_terminal_and_run_node()
            
            print(f"[{current_time}] Warte {WAIT_AFTER_RESTART} Sekunden für den Bootvorgang...")
            time.sleep(WAIT_AFTER_RESTART)
        else:
            # Server läuft ganz normal
            check_for_setting_changes()
            time.sleep(CHECK_INTERVAL)
