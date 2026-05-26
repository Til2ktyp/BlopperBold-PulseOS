# 🎯 BlopperBold PulseOS - Multi-Display Konfiguration

## 📺 Display-Identifikation und -Verwaltung

Das System basiert auf **IP-Adressen** der Displays zur Identifikation. Jedes Display wird in der `.env`-Datei konfiguriert.

### 🔧 Konfiguration (.env)

```env
# Display 1
DISPLAY_1_IP=192.168.1.10
DISPLAY_1_NAME=Wohnzimmer
DISPLAY_1_QUALITY=high

# Display 2
DISPLAY_2_IP=192.168.1.20
DISPLAY_2_NAME=Küche
DISPLAY_2_QUALITY=auto

# Display 3
DISPLAY_3_IP=192.168.1.30
DISPLAY_3_NAME=Schlafzimmer
DISPLAY_3_QUALITY=low
```

**Wichtig**: 
- Der Server erkennt Displays automatisch über ihre IP-Adresse
- `DISPLAY_X_QUALITY` ist optional und setzt die Standard-Qualität (Default: `auto`)
- Diese Einstellung wird beim Start geladen und in `display-settings.json` gespeichert

---

## 🚀 API Endpoints

### 📋 Allgemeine Befehle (für ALLE Displays)

Diese Befehle funktionieren wie zuvor und steuern **alle verbundenen Displays**:

```
/reload                                    # Alle Displays neu laden
/update                                    # Update + Reload
/widget/:name                              # Widget anzeigen
/idle                                      # Zurück zu Idle
/standby                                   # Standby-Modus
/timer/set/:value                          # Timer setzen
/timer/start | /timer/stop | /timer/reset  # Timer Steuerung
/stopwatch/start | /stopwatch/stop | /stopwatch/reset
/reminder?text=...&stufe=1                 # Erinnerung
/quality/animations/set/:level             # Qualität setzen (high/medium/low/auto)
/popup/:name                               # Popup umschalten
```

### 📺 Pro-Display Befehle (nur ein spezifisches Display)

Diese neuen Befehle steuern **nur ein spezifisches Display**:

```
/display/:displayId/widget/:name                           # Widget für ein Display
/display/:displayId/idle                                   # Idle-Modus
/display/:displayId/standby                                # Standby
/display/:displayId/timer/set/:value                       # Timer
/display/:displayId/timer/start | /timer/stop | /timer/reset
/display/:displayId/stopwatch/start | /stopwatch/stop | /stopwatch/reset
/display/:displayId/reminder?text=...&stufe=1              # Erinnerung
/display/:displayId/quality/animations/set/:level          # Qualität PRO Display
/display/:displayId/popup/:name                            # Popup
```

### 📊 Konfigurations-Endpoints

```
GET /config/displays                # Alle Displays mit Status anzeigen
GET /config/displays/status         # Kurzer Status über alle Displays
GET /quality/animations             # Aktuelle Qualität für dieses Display
GET /display/:displayId/quality/animations  # Qualität für spezifisches Display
```

---

## 💾 Persistent Einstellungen

Alle **Pro-Display-Einstellungen** werden in `display-settings.json` gespeichert:

```json
{
  "1": {
    "animationQuality": "high"
  },
  "2": {
    "animationQuality": "low"
  }
}
```

Diese Einstellungen bleiben erhalten, auch wenn der Server neu startet.

---

## 📱 Client-seitige Speicherung

Jedes Display speichert lokal im Browser:

- `display-id` - Die zugewiesene Display-ID (vom Server)
- `display-name` - Der Display-Name aus .env
- `animation-quality` - Die Qualitätseinstellung
- `hub-lat`, `hub-lon`, `hub-city` - Lokations-Daten

Diese Daten sind in der `localStorage` zugänglich und werden in der Konsole geloggt.

---

## 🎯 Praktische Beispiele

### Beispiel 1: Wohnzimmer-Musik starten, Küche still halten

```bash
# Spotify-Widget nur im Wohnzimmer zeigen
curl "http://localhost:3000/display/1/widget/spotify"

# Küche zeigt normales Idle
curl "http://localhost:3000/display/2/idle"
```

### Beispiel 2: Unterschiedliche Qualität pro Display

```bash
# Wohnzimmer: Hohe Qualität
curl "http://localhost:3000/display/1/quality/animations/set/high"

# Küche: Niedrige Qualität (Low-Power Device)
curl "http://localhost:3000/display/2/quality/animations/set/low"
```

### Beispiel 3: Timer nur für ein Display

```bash
# Timer im Schlafzimmer setzen
curl "http://localhost:3000/display/3/timer/set/600"  # 10 Minuten
curl "http://localhost:3000/display/3/timer/start"
```

### Beispiel 4: Alle Displays kontrollieren

```bash
# Alle Displays zeigen Idle
curl "http://localhost:3000/idle"

# Qualität für ALLE ändern
curl "http://localhost:3000/quality/animations/set/medium"
```

---

## 🔍 Status Abrufen

```bash
# Alle konfigurierten Displays ansehen
curl "http://localhost:3000/config/displays" | jq

# Aktuellen Status (nur online) sehen
curl "http://localhost:3000/config/displays/status" | jq
```

Beispiel-Ausgabe:
```json
{
  "displays": [
    {
      "displayId": "1",
      "name": "Wohnzimmer",
      "ip": "192.168.1.10",
      "online": true,
      "settings": { "animationQuality": "high" }
    },
    {
      "displayId": "2",
      "name": "Küche",
      "ip": "192.168.1.20",
      "online": false,
      "settings": {}
    }
  ]
}
```

---

## ⚙️ Wie es funktioniert

1. **Server startet** → Liest alle `DISPLAY_X_IP` und `DISPLAY_X_NAME` aus `.env`
2. **Client verbindet** → Server liest IP-Adresse des Requests
3. **IP-Matching** → Server ordnet Display-ID basierend auf IP zu
4. **Init-Event** → Server sendet `init-display` Event mit DisplayID an Client
5. **Client speichert** → Client speichert DisplayID in localStorage
6. **Per-Display Befehle** → Server sendet Befehle nur an spezifische DisplayID

Falls ein Display nicht in `.env` konfiguriert ist, wird es mit `displayId: null` akzeptiert (aber keine speziellen Features).

---

## 🐛 Debugging

### Server-Logs:
```
[Displays] Display 1 (Wohnzimmer) konfiguriert: 192.168.1.10
[SSE] Display verbunden - Name: Wohnzimmer | IP: 192.168.1.10 | DisplayID: 1
```

### Client-Console:
```
[Display] Initialisiert - ID: 1 | Name: Wohnzimmer | Quality: high
[Animations] Quality-Mode: high
```

### Test der IP-Erkennung:
```bash
# Teste mit spezifischem Client (z.B. Raspberry Pi)
ssh display@192.168.1.10 'curl -H "X-Forwarded-For: 192.168.1.10" http://localhost:3000/config/displays/status'
```

---

## 🎉 Zusammenfassung

- ✅ **Alte API** bleibt erhalten → Kompatibilität mit bestehenden Befehlen
- ✅ **Neue API** für Pro-Display-Steuerung
- ✅ **Automatische IP-Erkennung** → Keine manuellen DisplayIDs nötig
- ✅ **Persistente Einstellungen** → Pro-Display Settings bleiben erhalten
- ✅ **Flexible .env-Konfiguration** → Einfach neue Displays hinzufügen
