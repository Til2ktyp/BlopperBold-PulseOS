require('dotenv').config(); // LÄDT DIE .ENV DATEI DIREKT BEIM START

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

const PulseOSVERSION = "26.5.1111";

// WICHTIG: Erlaubt Express, JSON-Daten (z.B. vom Handy) zu lesen
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 🎯 DISPLAY MANAGEMENT SYSTEM ---
// Lade alle Displays aus .env
function loadDisplaysFromEnv() {
    const displays = {};
    const envVars = process.env;
    
    let displayNum = 1;
    while (envVars[`DISPLAY_${displayNum}_IP`]) {
        const ip = envVars[`DISPLAY_${displayNum}_IP`];
        const name = envVars[`DISPLAY_${displayNum}_NAME`] || `Display ${displayNum}`;
        const quality = envVars[`DISPLAY_${displayNum}_QUALITY`] || 'auto';
        const serial = envVars[`DISPLAY_${displayNum}_SERIAL`] || `SERIAL_${displayNum}`;
        displays[displayNum] = { ip, name, displayId: displayNum, quality, serial };
        console.log(`[Displays] Display ${displayNum} (${name}) konfiguriert: ${ip} | Quality: ${quality} | Serial: ${serial}`);
        displayNum++;
    }
    return displays;
}

function getSerial(displayId) {
    const serial= envVars[`DISPLAY_${displayId}_SERIAL`] || `SERIAL_${displayId}`; 
    return serial;
}

const CONFIGURED_DISPLAYS = loadDisplaysFromEnv();

// Display-Einstellungen Datei
const DISPLAY_SETTINGS_FILE = path.join(__dirname, 'display-settings.json');

function loadDisplaySettings() {
    try {
        if (!fs.existsSync(DISPLAY_SETTINGS_FILE)) {
            // Initialisiere mit den .env-Qualitäts-Einstellungen
            const initialSettings = {};
            for (const [displayId, config] of Object.entries(CONFIGURED_DISPLAYS)) {
                initialSettings[displayId] = { animationQuality: config.quality };
            }
            return initialSettings;
        }
        const data = fs.readFileSync(DISPLAY_SETTINGS_FILE, 'utf8');
        const settings = data ? JSON.parse(data) : {};
        
        // Migrate old standbyDisabled to standbyEnabled
        let migrated = false;
        for (const id in settings) {
            if (settings[id] && settings[id].hasOwnProperty('standbyDisabled')) {
                settings[id].standbyEnabled = !settings[id].standbyDisabled;
                delete settings[id].standbyDisabled;
                migrated = true;
            }
        }
        if (migrated) {
            try {
                fs.writeFileSync(DISPLAY_SETTINGS_FILE, JSON.stringify(settings, null, 2));
                console.log("[DisplaySettings] Migrated old standbyDisabled settings to standbyEnabled.");
            } catch (e) {
                console.error("[DisplaySettings] Fehler beim Speichern der Migration:", e);
            }
        }
        return settings;
    } catch (e) {
        console.error("[DisplaySettings] Fehler beim Laden:", e);
        return {};
    }
}

function saveDisplaySettings(settings) {
    try {
        fs.writeFileSync(DISPLAY_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error("[DisplaySettings] Fehler beim Speichern:", e);
    }
}

let displaySettings = loadDisplaySettings();

// IP zu DisplayID Mapping
const temporaryDisplays = {};

function getDisplayIdFromIp(ip) {
    // 1. Check configured displays from .env
    for (const [displayId, config] of Object.entries(CONFIGURED_DISPLAYS)) {
        if (config.ip === ip) {
            return parseInt(displayId);
        }
    }
    
    // 2. Check already assigned temporary display
    if (temporaryDisplays[ip]) {
        return temporaryDisplays[ip];
    }
    
    // 3. Assign new unique temporary integer displayId
    const maxConfiguredId = Math.max(...Object.keys(CONFIGURED_DISPLAYS).map(Number), 0);
    const maxTempId = Math.max(...Object.values(temporaryDisplays), 0);
    const newId = Math.max(maxConfiguredId, maxTempId, 9) + 1; // Starts at 10 or higher
    
    temporaryDisplays[ip] = newId;
    console.log(`[Display] Dynamic DisplayID ${newId} assigned for unconfigured IP ${ip}`);
    return newId;
}

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.socket.remoteAddress?.replace('::ffff:', '') ||
           req.ip ||
           'unknown';
}

function getDisplayNameFromRequest(req) {
    const clientIp = getClientIp(req);
    const displayId = getDisplayIdFromIp(clientIp);
    return (displayId && CONFIGURED_DISPLAYS[displayId]?.name) || process.env.SPOTIFY_DEVICE_NAME || clientIp;
}

// DAS ZENTRALE ARRAY FÜR ALLE OPENING DISPLAYS
let clients = [];
// Pro-Display Client Mapping: { displayId: { id, res, ip, displayId } }

// Hilfsfunktion um Daten an ALLE Displays zu senden (Widgets, Spotify, etc.)
function sendToClients(data) {
    clients.forEach(client => {
        try {
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch(e) {
            console.error("Fehler beim Senden an Client:", e.message);
        }
    });
}

// Hilfsfunktion um Daten an EIN spezifisches Display zu senden
function sendToDisplay(displayId, data) {
    clients.forEach(client => {
        if (client.displayId === displayId) {
            try {
                client.res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch(e) {
                console.error(`Fehler beim Senden an Display ${displayId}:`, e.message);
            }
        }
    });
}

// --- 🌐 ZENTRALE SSE EVENTS VERBINDUNG (Für Widgets, Spotify UND Reloads) ---
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Herzschlag an den Browser senden, damit Chromium/Electron die Verbindung nicht trennt
    res.write('\n'); 

    // Hole die Client-IP-Adresse
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     req.socket.remoteAddress?.replace('::ffff:', '') || 
                     req.ip || 
                     'unknown';

    const displayId = getDisplayIdFromIp(clientIp);
    const clientId = Date.now();
    const displayName = (displayId && CONFIGURED_DISPLAYS[displayId]?.name) || 'Unknown';
    
    clients.push({ id: clientId, res, ip: clientIp, displayId: displayId, name: displayName });
    console.log(`[SSE] Display verbunden - Name: ${displayName} | IP: ${clientIp} | DisplayID: ${displayId} | Aktive Displays: ${clients.length}`);

    // Sende die DisplayID zum Client
    if (displayId) {
        try {
            res.write(`data: ${JSON.stringify({ 
                action: 'init-display', 
                displayId, 
                name: displayName, 
                quality: (displayId && displaySettings[displayId]?.animationQuality) || 'auto', 
                standbyEnabled: (displayId && displaySettings[displayId]?.standbyEnabled !== false),
                serial: (displayId && CONFIGURED_DISPLAYS[displayId]?.serial) || `TEMP_${displayId}` 
            })}\n\n`);
        } catch(e) {
            console.error("Fehler beim Senden der DisplayID:", e.message);
        }
    } else {
        console.warn(`[SSE] ⚠️ IP ${clientIp} konnte keinem Display zugeordnet werden!`);
    }

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
        console.log(`[SSE] Display getrennt (${displayName}). Verbleibende Displays: ${clients.length}`);
    });
});

// --- 🚀 DER ULTIMATIVE RESTART/UPDATE ENDPUNKT (FÜR STREAM DECK) ---
app.get('/update', (req, res) => {
    console.log(`[Update] Stream Deck aktiv. Sende Reload an ${clients.length} Displays...`);

    // Sende das reine Text-Signal "reload" an alle Displays, bevor wir sterben
    clients.forEach(client => {
        try {
            client.res.write("data: reload\n\n");
        } catch (err) {
            console.error("Fehler beim Senden des Reload-Signals:", err.message);
        }
    });

    // Python-Skript im Hintergrund starten
    const scriptPath = path.join(__dirname, 'updater.py');
    console.log(`[Update] Starte Hintergrund-Skript: ${scriptPath}`);
    
    const child = spawn('python', [scriptPath], {
        detached: true,
        stdio: 'ignore',
        cwd: __dirname
    });
    child.unref();

    res.send('Update-Prozess gestartet und alle Displays benachrichtigt.\n');
});

// --- � PER-DISPLAY UPDATE ---
app.get('/display/:displayId/update', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    console.log(`[Update] Display ${displayId} Update angefordert.`);

    sendToDisplay(displayId, { action: 'reload', displayId });
    res.send(`Display ${displayId} wird aktualisiert.\n`);
});

// --- 🔄 RELOAD ENDPUNKT (ohne Update-Skript) ---
app.get('/reload', (req, res) => {
    console.log(`[Reload] Sende Reload-Signal an ${clients.length} Displays...`);

    clients.forEach(client => {
        try {
            client.res.write("data: reload\n\n");
        } catch (err) {
            console.error("Fehler beim Senden des Reload-Signals:", err.message);
        }
    });

    res.send('Reload-Signal an alle Displays gesendet.\n');
});

// --- 🔄 PER-DISPLAY RELOAD ---
app.get('/display/:displayId/reload', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    console.log(`[Reload] Display ${displayId} Reload angefordert.`);

    sendToDisplay(displayId, { action: 'reload', displayId });
    res.send(`Display ${displayId} wird neu geladen.\n`);
});

// --- DYNAMISCHES WIDGET SYSTEM ---
app.get('/widget/:name', (req, res) => {
    const widgetName = req.params.name;
    const filePath = path.join(__dirname, 'public', 'widgets', `${widgetName}.html`);

    if (fs.existsSync(filePath)) {
        let htmlContent = fs.readFileSync(filePath, 'utf8');
        
        // Für info.html: Ersetze {{SERIAL}} Placeholder
        if (widgetName === 'info') {
            const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                            req.socket.remoteAddress?.replace('::ffff:', '') || 
                            req.ip || 
                            'unknown';
            const displayId = getDisplayIdFromIp(clientIp);
            const serial = displayId ? (CONFIGURED_DISPLAYS[displayId]?.serial || 'UNKNOWN') : 'UNMAPPED';
            
            htmlContent = htmlContent.replace('{{SERIAL}}', serial);
        }
        
        sendToClients({ action: 'show-widget', html: htmlContent, name: widgetName });
        res.send(`Widget [${widgetName}] geladen.\n`);
    } else {
        res.status(404).send(`Widget [${widgetName}] nicht gefunden.\n`);
    }
});

// --- PER-DISPLAY WIDGET SYSTEM ---
app.get('/display/:displayId/widget/:name', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const widgetName = req.params.name;
    const filePath = path.join(__dirname, 'public', 'widgets', `${widgetName}.html`);

    if (fs.existsSync(filePath)) {
        let htmlContent = fs.readFileSync(filePath, 'utf8');
        
        // Für info.html: Ersetze {{SERIAL}} Placeholder
        if (widgetName === 'info') {
            const serial = CONFIGURED_DISPLAYS[displayId]?.serial || 'UNKNOWN';
            htmlContent = htmlContent.replace('{{SERIAL}}', serial);
        }
        
        sendToDisplay(displayId, { action: 'show-widget', html: htmlContent, name: widgetName, displayId });
        res.send(`Widget [${widgetName}] für Display ${displayId} geladen.\n`);
    } else {
        res.status(404).send(`Widget [${widgetName}] nicht gefunden.\n`);
    }
});

app.get('/idle', (req, res) => {
    sendToClients({ action: 'go-idle' });
    res.send("Zurück zum Idle-Screen.\n");
});

// --- PER-DISPLAY IDLE ---
app.get('/display/:displayId/idle', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'go-idle', displayId });
    res.send(`Display ${displayId} zurück zum Idle-Screen.\n`);
});

// --- 🌙 STANDBY ENPOINT FÜR CURL ---
app.get('/standby', (req, res) => {
    sendToClients({ action: 'toggle-standby' });
    res.send("Standby-Modus getoggelt.\n");
});

// --- 🌙 PER-DISPLAY STANDBY ---
app.get('/display/:displayId/standby', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'toggle-standby', displayId });
    res.send(`Display ${displayId} Standby-Modus getoggelt.\n`);
});

// --- 🌙 STANDBY TOGGLE SYNCHRONISATION ---
app.get('/display/:displayId/standby/toggle/:state', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const state = req.params.state;
    const isEnabled = (state === 'enable');
    
    if (!displaySettings[displayId]) {
        displaySettings[displayId] = {};
    }
    displaySettings[displayId].standbyEnabled = isEnabled;
    saveDisplaySettings(displaySettings);
    
    sendToDisplay(displayId, { action: 'standby-settings-changed', standbyEnabled: isEnabled });
    res.send(`Standby für Display ${displayId} auf ${isEnabled ? 'aktiviert' : 'deaktiviert'} gesetzt.\n`);
});

// --- 🎛️ WATCHFACE CONFIGURATION ENDPOINTS ---
app.get('/display/:displayId/watchface-configs', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const configs = displaySettings[displayId]?.watchfaceConfigs || null;
    res.json(configs);
});

app.post('/display/:displayId/watchface-configs/save', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const configs = req.body;
    
    if (!displaySettings[displayId]) {
        displaySettings[displayId] = {};
    }
    displaySettings[displayId].watchfaceConfigs = configs;
    saveDisplaySettings(displaySettings);
    
    res.send("Watchface-Konfiguration gespeichert.\n");
});

// --- TIMER STEUERUNGEN ---
app.get('/timer/set/:value', (req, res) => {
    sendToClients({ action: 'timer-set', value: req.params.value, name: req.query.name || 'Timer' });
    res.send(`Timer auf ${req.params.value} Sekunden gesetzt.\n`);
});

app.get('/timer/adjust/:unit/:amount', (req, res) => {
    const { unit, amount } = req.params;
    sendToClients({ action: 'timer-adjust', unit: unit, amount: parseInt(amount) });
    res.send(`Timer angepasst: ${amount} ${unit}.\n`);
});

app.get('/timer/start', (req, res) => {
    sendToClients({ action: 'timer-start' });
    res.send("Timer gestartet.\n");
});

app.get('/timer/stop', (req, res) => {
    sendToClients({ action: 'timer-stop' });
    res.send("Timer gestoppt.\n");
});

app.get('/timer/reset', (req, res) => {
    try { if (typeof activeTimerInterval !== 'undefined') clearInterval(activeTimerInterval); } catch(e){}
    sendToClients({ action: 'timer-reset' });
    res.send("Timer zurückgesetzt.\n");
});

// --- PER-DISPLAY TIMER STEUERUNGEN ---
app.get('/display/:displayId/timer/set/:value', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'timer-set', value: req.params.value, name: req.query.name || 'Timer', displayId });
    res.send(`Timer für Display ${displayId} auf ${req.params.value} Sekunden gesetzt.\n`);
});

app.get('/display/:displayId/timer/adjust/:unit/:amount', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const { unit, amount } = req.params;
    sendToDisplay(displayId, { action: 'timer-adjust', unit: unit, amount: parseInt(amount), displayId });
    res.send(`Timer für Display ${displayId} angepasst: ${amount} ${unit}.\n`);
});

app.get('/display/:displayId/timer/start', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'timer-start', displayId });
    res.send(`Timer für Display ${displayId} gestartet.\n`);
});

app.get('/display/:displayId/timer/stop', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'timer-stop', displayId });
    res.send(`Timer für Display ${displayId} gestoppt.\n`);
});

app.get('/display/:displayId/timer/reset', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'timer-reset', displayId });
    res.send(`Timer für Display ${displayId} zurückgesetzt.\n`);
});

// --- STOPWATCH STEUERUNGEN ---
app.get('/stopwatch/start', (req, res) => {
    sendToClients({ action: 'stopwatch-start' });
    res.send("Stoppuhr gestartet.\n");
});

app.get('/stopwatch/stop', (req, res) => {
    sendToClients({ action: 'stopwatch-stop' });
    res.send("Stoppuhr gestoppt.\n");
});

app.get('/stopwatch/reset', (req, res) => {
    sendToClients({ action: 'stopwatch-reset' });
    res.send("Stoppuhr zurückgesetzt.\n");
});

// --- PER-DISPLAY STOPWATCH STEUERUNGEN ---
app.get('/display/:displayId/stopwatch/start', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'stopwatch-start', displayId });
    res.send(`Stoppuhr für Display ${displayId} gestartet.\n`);
});

app.get('/display/:displayId/stopwatch/stop', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'stopwatch-stop', displayId });
    res.send(`Stoppuhr für Display ${displayId} gestoppt.\n`);
});

app.get('/display/:displayId/stopwatch/reset', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    sendToDisplay(displayId, { action: 'stopwatch-reset', displayId });
    res.send(`Stoppuhr für Display ${displayId} zurückgesetzt.\n`);
});

// --- ANIMATIONS QUALITY ENDPOINT ---
let animationQuality = 'medium'; // Globale Fallback

app.get('/quality/animations', (req, res) => {
    // Hole IP des Clients
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     req.socket.remoteAddress?.replace('::ffff:', '') || 
                     req.ip || 
                     'unknown';
    const displayId = getDisplayIdFromIp(clientIp);
    
    // Nutze Display-spezifische Einstellung, sonst Global-Fallback
    const quality = displayId && displaySettings[displayId]?.animationQuality ? 
                    displaySettings[displayId].animationQuality : 
                    animationQuality;
    
    res.json({ quality, displayId });
});

app.get('/quality/animations/set/:level', (req, res) => {
    const level = req.params.level;
    if (!['high', 'medium', 'low', 'low-powered', 'auto'].includes(level)) {
        return res.status(400).send("Ungültiger Quality-Level. Erlaubt: high, medium, low, low-powered, auto\n");
    }
    
    // Setze global für alle neuen Connections
    animationQuality = level;
    
    // Speichere auch für alle aktiven Displays
    clients.forEach(client => {
        if (client.displayId) {
            if (!displaySettings[client.displayId]) {
                displaySettings[client.displayId] = {};
            }
            displaySettings[client.displayId].animationQuality = level;
        }
    });
    
    saveDisplaySettings(displaySettings);
    sendToClients({ action: 'animation-quality-changed', quality: level });
    res.send(`Animations-Qualität auf ${level} gesetzt.\n`);
});

// --- PER-DISPLAY QUALITY ENDPOINT ---
app.get('/display/:displayId/quality/animations/set/:level', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const level = req.params.level;
    
    if (!['high', 'medium', 'low', 'low-powered', 'auto'].includes(level)) {
        return res.status(400).send("Ungültiger Quality-Level. Erlaubt: high, medium, low, low-powered, auto\n");
    }
    
    if (!displaySettings[displayId]) {
        displaySettings[displayId] = {};
    }
    displaySettings[displayId].animationQuality = level;
    saveDisplaySettings(displaySettings);
    
    sendToDisplay(displayId, { action: 'animation-quality-changed', quality: level });
    res.send(`Animations-Qualität für Display ${displayId} auf ${level} gesetzt.\n`);
});

app.get('/display/:displayId/quality/animations', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const quality = displaySettings[displayId]?.animationQuality || animationQuality;
    res.json({ quality, displayId });
});

// --- REMINDER SYSTEM ---
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');

function loadReminders() {
    try {
        if (!fs.existsSync(REMINDERS_FILE)) return [];
        const data = fs.readFileSync(REMINDERS_FILE, 'utf8');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('[Reminder] Fehler beim Laden:', e);
        return [];
    }
}

function saveReminders(reminders) {
    try {
        fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
    } catch (e) {
        console.error('[Reminder] Fehler beim Speichern:', e);
    }
}

function getReminderDayName(date) {
    return ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][date.getDay()];
}

function getReminderDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeRepeat(value) {
    if (value === 'täglich') return 'daily';
    if (value === 'wöchentlich') return 'weekly';
    if (['once', 'daily', 'weekly'].includes(value)) return value;
    return 'once';
}

function createScheduledReminder({ displayId = null, text, level, time, repeat, dayName }) {
    const now = new Date();
    return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        displayId,
        text,
        level: parseInt(level) || 1,
        time,
        repeat: normalizeRepeat(repeat),
        dayName: dayName || getReminderDayName(now),
        active: true,
        lastTriggeredMinute: null,
        createdAt: now.toISOString()
    };
}

function sendReminderPayload(reminder) {
    const payload = {
        action: 'show-reminder',
        text: reminder.text,
        stufe: parseInt(reminder.level) || 1,
        displayId: reminder.displayId || undefined
    };

    if (reminder.displayId) {
        sendToDisplay(parseInt(reminder.displayId), payload);
    } else {
        sendToClients(payload);
    }
}

function isReminderDue(reminder, now) {
    if (!reminder.active || !reminder.time) return false;

    const currentMinute = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    if (reminder.time !== currentMinute) return false;

    const triggerKey = `${getReminderDateKey(now)} ${currentMinute}`;
    if (reminder.lastTriggeredMinute === triggerKey) return false;

    if (reminder.repeat === 'weekly' && reminder.dayName && reminder.dayName !== getReminderDayName(now)) {
        return false;
    }

    return true;
}

function checkStoredReminders() {
    const reminders = loadReminders();
    if (!reminders.length) return;

    const now = new Date();
    const currentMinuteKey = `${getReminderDateKey(now)} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    let changed = false;

    reminders.forEach(reminder => {
        if (!isReminderDue(reminder, now)) return;

        sendReminderPayload(reminder);
        reminder.lastTriggeredMinute = currentMinuteKey;
        if (reminder.repeat === 'once') {
            reminder.active = false;
        }
        changed = true;
        console.log(`[Reminder] Ausgelöst: ${reminder.text} -> ${reminder.displayId || 'alle'}`);
    });

    if (changed) saveReminders(reminders);
}

app.get('/reminder', (req, res) => {
    const text = req.query.text || "Kein Text angegeben";
    const stufe = req.query.stufe || 1;
    const time = req.query.time || '';
    const repeat = req.query.repeat || req.query.days || 'once';

    if (time) {
        const reminders = loadReminders();
        const reminder = createScheduledReminder({
            text,
            level: stufe,
            time,
            repeat,
            dayName: req.query.dayName
        });
        reminders.push(reminder);
        saveReminders(reminders);
        return res.json(reminder);
    }

    sendToClients({
        action: "show-reminder",
        text: text,
        stufe: parseInt(stufe)
    });

    res.send(`Reminder der Stufe ${stufe} gesendet.\n`);
});

// --- PER-DISPLAY REMINDER SYSTEM ---
app.get('/display/:displayId/reminder', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const text = req.query.text || "Kein Text angegeben";
    const stufe = req.query.stufe || 1;
    const time = req.query.time || '';
    const repeat = req.query.repeat || req.query.days || 'once';

    if (time) {
        const reminders = loadReminders();
        const reminder = createScheduledReminder({
            displayId,
            text,
            level: stufe,
            time,
            repeat,
            dayName: req.query.dayName
        });
        reminders.push(reminder);
        saveReminders(reminders);
        return res.json(reminder);
    }

    sendToDisplay(displayId, {
        action: "show-reminder",
        text: text,
        stufe: parseInt(stufe),
        displayId
    });

    res.send(`Reminder der Stufe ${stufe} für Display ${displayId} gesendet.\n`);
});

app.get('/reminders', (req, res) => {
    res.json(loadReminders());
});

app.get('/reminder/:id/delete', (req, res) => {
    const reminders = loadReminders();
    const nextReminders = reminders.filter(reminder => reminder.id !== req.params.id);
    saveReminders(nextReminders);
    res.json({ success: true, count: nextReminders.length });
});


// --- TO-DO / EINKAUFSLISTE ENGINE ---
const TODO_FILE = path.join(__dirname, 'todo.json');

function loadTodos() {
    try {
        if (!fs.existsSync(TODO_FILE)) return [];
        const data = fs.readFileSync(TODO_FILE, 'utf8');
        return data ? JSON.parse(data) : [];
    } catch (e) { 
        console.error("Fehler beim Lesen der todo.json:", e);
        return []; 
    }
}

function saveAndBroadcast(todos) {
    try {
        fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
        
        let itemsHTML = todos.map((item, index) => `
            <div class="todo-item ${item.done ? 'done' : ''}" onclick="toggleTodo(${index})">
                <div class="todo-checkbox">${item.done ? '✓' : ''}</div>
                <div class="todo-text">${item.text}</div>
            </div>
        `).join('');

        if (todos.length === 0) {
            itemsHTML = `<div class="todo-empty">🎉 Alles erledigt! Keine Aufgaben vorhanden.</div>`;
        }

        const todoHtml = `
            <div class="todo-widget-content">
                <div class="todo-header">
                    <h2 class="widget-title">📝 Einkaufs- & To-Do</h2>
                    <button class="todo-clear-btn" onclick="clearDoneTodos(event)">
                        🗑️ Erledigte löschen
                    </button>
                </div>
                <div class="todo-list-container">
                    ${itemsHTML}
                </div>
            </div>
        `;

        sendToClients({
            action: 'show-widget',
            html: todoHtml,
            todos: todos
        });
    } catch (e) {
        console.error("Fehler beim Speichern oder Broadcasten der To-Dos:", e);
    }
}

app.get('/todo', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/todo.html'));
});

app.get('/todo/list', (req, res) => {
    res.json(loadTodos());
});

app.post('/todo/add', (req, res) => {
    const todos = loadTodos();
    if (req.body && req.body.text) {
        todos.push({ text: req.body.text, done: false });
        saveAndBroadcast(todos);
        res.status(200).json({ success: true });
    } else {
        res.status(400).send("Text fehlt im Body");
    }
});

app.get('/todo/toggle', (req, res) => {
    const index = parseInt(req.query.index);
    const todos = loadTodos();

    if (isNaN(index) || index < 0 || index >= todos.length) {
        return res.status(400).send("Ungültiger Index");
    }

    todos[index].done = !todos[index].done;
    saveAndBroadcast(todos);
    res.status(200).send("Status aktualisiert");
});

app.get('/todo/delete', (req, res) => {
    const index = parseInt(req.query.index);
    const todos = loadTodos();

    if (isNaN(index) || index < 0 || index >= todos.length) {
        return res.status(400).send("Ungültiger Index");
    }

    todos.splice(index, 1);
    saveAndBroadcast(todos);
    res.status(200).send("Gelöscht");
});

app.get('/todo/clear', (req, res) => {
    let todos = loadTodos();
    todos = todos.filter(item => !item.done);
    saveAndBroadcast(todos);
    res.status(200).send("Aufgeräumt");
});

app.get('/todo/show', (req, res) => {
    saveAndBroadcast(loadTodos());
    res.send("Widget erfolgreich auf dem Hub geöffnet.");
});

// --- CALENDAR / ICLOUD ICS SYNC ---
const CALENDAR_ICS_URL = process.env.CALENDAR_ICS_URL || process.env.ICLOUD_CALENDAR_URL || '';

function unfoldIcsLines(text) {
    return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
}

function cleanIcsText(value = '') {
    return value
        .replace(/\\n/g, ' ')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\')
        .trim();
}

function parseIcsDate(value = '') {
    if (!value) return null;

    const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateOnly) {
        return {
            dateKey: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`,
            time: ''
        };
    }

    const dateTime = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
    if (!dateTime) return null;

    const isUtc = value.endsWith('Z');
    const date = isUtc
        ? new Date(Date.UTC(
            Number(dateTime[1]),
            Number(dateTime[2]) - 1,
            Number(dateTime[3]),
            Number(dateTime[4]),
            Number(dateTime[5])
        ))
        : new Date(
            Number(dateTime[1]),
            Number(dateTime[2]) - 1,
            Number(dateTime[3]),
            Number(dateTime[4]),
            Number(dateTime[5])
        );

    return {
        dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        time: date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    };
}

function parseIcsEvents(icsText) {
    const lines = unfoldIcsLines(icsText);
    const eventsByDate = {};
    let currentEvent = null;

    lines.forEach(line => {
        if (line === 'BEGIN:VEVENT') {
            currentEvent = {};
            return;
        }

        if (line === 'END:VEVENT') {
            if (currentEvent && currentEvent.dtstart && currentEvent.summary) {
                const parsedDate = parseIcsDate(currentEvent.dtstart);
                if (parsedDate) {
                    if (!eventsByDate[parsedDate.dateKey]) eventsByDate[parsedDate.dateKey] = [];
                    eventsByDate[parsedDate.dateKey].push({
                        time: parsedDate.time,
                        title: cleanIcsText(currentEvent.summary),
                        location: cleanIcsText(currentEvent.location || '')
                    });
                }
            }
            currentEvent = null;
            return;
        }

        if (!currentEvent) return;

        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) return;

        const rawKey = line.slice(0, separatorIndex);
        const key = rawKey.split(';')[0].toUpperCase();
        const value = line.slice(separatorIndex + 1);

        if (key === 'SUMMARY') currentEvent.summary = value;
        if (key === 'LOCATION') currentEvent.location = value;
        if (key === 'DTSTART') currentEvent.dtstart = value;
    });

    Object.values(eventsByDate).forEach(dayEvents => {
        dayEvents.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    });

    return eventsByDate;
}

app.get('/calendar/events', async (req, res) => {
    if (!CALENDAR_ICS_URL) {
        return res.json({
            configured: false,
            count: 0,
            eventsByDate: {}
        });
    }

    try {
        const response = await fetch(CALENDAR_ICS_URL);
        if (!response.ok) {
            return res.status(response.status).json({
                configured: true,
                error: `Kalender-Feed antwortet mit HTTP ${response.status}`
            });
        }

        const icsText = await response.text();
        const eventsByDate = parseIcsEvents(icsText);
        const count = Object.values(eventsByDate).reduce((sum, dayEvents) => sum + dayEvents.length, 0);

        res.json({
            configured: true,
            count,
            eventsByDate,
            lastSync: new Date().toISOString()
        });
    } catch (e) {
        console.error('[Calendar] ICS Sync Fehler:', e.message);
        res.status(500).json({
            configured: true,
            error: e.message
        });
    }
});


// --- SPOTIFY INTEGRATION ---
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/callback';
const SPOTIFY_ACCESS_TOKEN = process.env.SPOTIFY_ACCESS_TOKEN;
let SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;
const SPOTIFY_CACHE_FILE = path.join(__dirname, 'public', 'spotify-cache.json'); // Im public Ordner!
const SPOTIFY_HISTORY_FILE = path.join(__dirname, 'spotify-history.json');
const playlistNameCache = {};

async function getPlaylistNameCached(playlistId, token) {
    if (playlistNameCache[playlistId]) return playlistNameCache[playlistId];
    try {
        const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.status === 200) {
            const data = await res.json();
            if (data && data.name) {
                playlistNameCache[playlistId] = data.name;
                return data.name;
            }
        }
    } catch (e) {
        console.error(`[Spotify Playlist Cache] Fehler beim Laden von ${playlistId}:`, e.message);
    }
    return null;
}

function loadSpotifyHistory() {
    try {
        if (!fs.existsSync(SPOTIFY_HISTORY_FILE)) return [];
        const data = fs.readFileSync(SPOTIFY_HISTORY_FILE, 'utf8');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('[Spotify History] Fehler beim Laden:', e);
        return [];
    }
}

function saveSpotifyHistory(history) {
    try {
        fs.writeFileSync(SPOTIFY_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('[Spotify History] Fehler beim Speichern:', e);
    }
}

let currentSession = null;
let lastDiscardedSession = null;

function finalizeCurrentSession() {
    if (!currentSession) return;
    if (currentSession.listenedMs >= 30000) { // 30 Sekunden
        const history = loadSpotifyHistory();
        const sessionToSave = {
            id: currentSession.id,
            trackId: currentSession.trackId,
            title: currentSession.title,
            artists: currentSession.artists,
            playlistName: currentSession.playlistName || null,
            albumImg: currentSession.albumImg,
            url: currentSession.url,
            durationMs: currentSession.durationMs,
            listenedMs: currentSession.listenedMs,
            timestamp: currentSession.timestamp
        };
        history.push(sessionToSave);
        saveSpotifyHistory(history);
        console.log(`[Spotify History] Gespeichert: "${sessionToSave.title}" (${Math.round(sessionToSave.listenedMs / 1000)}s gehört)`);
        lastDiscardedSession = null;
    } else {
        console.log(`[Spotify History] Übersprungen (nur ${Math.round(currentSession.listenedMs / 1000)}s gehört): "${currentSession.title}"`);
        lastDiscardedSession = currentSession;
    }
    currentSession = null;
}

let cachedTopTracks = [];
let cachedCurrentPlayback = null; // Cache für aktuellen Track

// Lade Spotify-Cache aus Datei
function loadSpotifyCacheFromFile() {
    try {
        if (fs.existsSync(SPOTIFY_CACHE_FILE)) {
            const data = fs.readFileSync(SPOTIFY_CACHE_FILE, 'utf8');
            const cache = JSON.parse(data);
            cachedTopTracks = cache.topTracks || [];
            cachedCurrentPlayback = cache.currentPlayback || null;
            console.log("📁 Spotify-Cache aus Datei geladen");
            return cache;
        }
    } catch (err) {
        console.error("Fehler beim Laden des Spotify-Caches:", err.message);
    }
    return null;
}

// Speichere Spotify-Cache in Datei
function saveSpotifyCacheToFile() {
    try {
        const cache = {
            topTracks: cachedTopTracks,
            currentPlayback: cachedCurrentPlayback,
            lastUpdate: new Date().toISOString()
        };
        fs.writeFileSync(SPOTIFY_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (err) {
        console.error("Fehler beim Speichern des Spotify-Caches:", err.message);
    }
}

// Lade Cache beim Start
loadSpotifyCacheFromFile();

// Initialisiere Cache-Datei mit Standardwerten wenn noch nicht vorhanden
if (!fs.existsSync(SPOTIFY_CACHE_FILE)) {
    console.log("⚠️ Spotify-Cache-Datei existiert nicht, erstelle mit Standardwerten...");
    cachedCurrentPlayback = {
        action: 'spotify-playing',
        title: 'Warte auf erste Wiedergabe',
        artist: 'Starten Sie ein Lied in Spotify',
        albumImg: '',
        progress: 0,
        duration: 0,
        queue: [],
        topTracks: []
    };
    cachedTopTracks = [];
    saveSpotifyCacheToFile();
}

app.get('/spotify/login', (req, res) => {
    const scopes = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing user-top-read playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private';
    res.redirect('https://accounts.spotify.com/authorize' +
        '?response_type=code' +
        '&client_id=' + SPOTIFY_CLIENT_ID +
        '&scope=' + encodeURIComponent(scopes) +
        '&redirect_uri=' + encodeURIComponent(SPOTIFY_REDIRECT_URI) +
        '&show_dialog=true');
});

app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
            },
            body: new URLSearchParams({
                code: code,
                redirect_uri: SPOTIFY_REDIRECT_URI,
                grant_type: 'authorization_code'
            })
        });

        const data = await response.json();
        if (data.refresh_token) {
            SPOTIFY_REFRESH_TOKEN = data.refresh_token;
            console.log("👉 NEUER REFRESH TOKEN:", SPOTIFY_REFRESH_TOKEN);
            updateTopTracksCache();
            res.send("Erfolgreich verbunden! Der Polling-Prozess läuft bereits.");
        } else {
            res.send("Fehler beim Abrufen der Tokens.");
        }
    } catch (e) {
        res.status(500).send("Callback Fehler: " + e.message);
    }
});

async function getSpotifyAccessToken() {
    if (SPOTIFY_ACCESS_TOKEN) {
        return SPOTIFY_ACCESS_TOKEN;
    }

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
        throw new Error('Spotify Credentials fehlen in .env');
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: SPOTIFY_REFRESH_TOKEN
        })
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || `Spotify Token Fehler (${response.status})`);
    }
    return data.access_token;
}

app.get('/spotify-token', async (req, res) => {
    try {
        const accessToken = await getSpotifyAccessToken();
        res.json({ accessToken });
    } catch (e) {
        console.error('[Spotify SDK] Token konnte nicht geladen werden:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/spotify-device-name', (req, res) => {
    const displayName = getDisplayNameFromRequest(req);
    res.json({ name: `PulseOS - ${displayName}` });
});

async function updateTopTracksCache() {
    if (!SPOTIFY_REFRESH_TOKEN) return;
    try {
        const token = await getSpotifyAccessToken();
        const res = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=short_term', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.status === 200) {
            const data = await res.json();
            if (data && data.items) {
                cachedTopTracks = data.items.map(track => ({
                    title: track.name,
                    artist: track.artists.map(a => a.name).join(', '),
                    albumImg: track.album.images[2]?.url || track.album.images[0]?.url || ''
                }));
                saveSpotifyCacheToFile();
                console.log("🔥 Spotify Top 10 erfolgreich aktualisiert.");
            }
        }
    } catch (err) {
        console.error("Fehler beim Abruf der Top Tracks:", err.message);
    }
}

function startSpotifyPolling() {
    console.log("🟢 Spotify-Polling wurde gestartet...");
    updateTopTracksCache();
    setInterval(updateTopTracksCache, 30 * 60 * 1000);

    // Sofort erste Wiedergabe-Daten fetchen (nicht 12 Sekunden warten!)
    fetchAndCacheCurrentPlayback();
    
    // Danach regelmäßig updaten
    setInterval(fetchAndCacheCurrentPlayback, 12000);
}

async function fetchAndCacheCurrentPlayback() {
    if (!SPOTIFY_REFRESH_TOKEN) return;
    try {
        const token = await getSpotifyAccessToken();
        const resPlayback = await fetch('https://api.spotify.com/v1/me/player', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (resPlayback.status === 204 || resPlayback.status > 400) {
            finalizeCurrentSession();
            console.log("ℹ️ Spotify sagt: Kein aktives Gerät oder Wiedergabe pausiert (Status " + resPlayback.status + ")");
            sendToClients({
                action: 'spotify-unavailable',
                reason: resPlayback.status === 204 ? 'no_device' : 'playback_error'
            });
            return null;
        }

        const playback = await resPlayback.json();
        if (!playback) {
            finalizeCurrentSession();
            console.log("ℹ️ Spotify: Keine Playback-Daten verfügbar");
            sendToClients({
                action: 'spotify-unavailable',
                reason: 'no_playback'
            });
            return null;
        }

        if (playback.item) {
            // Session Tracking
            if (playback.is_playing) {
                const now = Date.now();
                if (!currentSession || currentSession.trackId !== playback.item.id) {
                    finalizeCurrentSession();
                    
                    const history = loadSpotifyHistory();
                    const lastSession = history[history.length - 1];
                    const mergeWindowMs = 15 * 60 * 1000; // 15 Minuten
                    
                    if (lastSession && lastSession.trackId === playback.item.id && (Date.now() - new Date(lastSession.timestamp).getTime()) < mergeWindowMs) {
                        history.pop();
                        saveSpotifyHistory(history);
                        currentSession = {
                            id: lastSession.id,
                            trackId: lastSession.trackId,
                            title: lastSession.title,
                            artists: lastSession.artists,
                            playlistName: lastSession.playlistName || null,
                            albumImg: lastSession.albumImg,
                            url: lastSession.url,
                            durationMs: lastSession.durationMs,
                            listenedMs: lastSession.listenedMs,
                            timestamp: lastSession.timestamp,
                            lastProgress: playback.progress_ms,
                            lastUpdated: now
                        };
                        console.log(`[Spotify History] Session fortgesetzt (aus Verlauf wiederhergestellt): "${currentSession.title}"`);
                    } else if (lastDiscardedSession && lastDiscardedSession.trackId === playback.item.id && (Date.now() - lastDiscardedSession.lastUpdated) < mergeWindowMs) {
                        currentSession = lastDiscardedSession;
                        currentSession.lastProgress = playback.progress_ms;
                        currentSession.lastUpdated = now;
                        lastDiscardedSession = null;
                        console.log(`[Spotify History] Session fortgesetzt (aus Zwischenspeicher): "${currentSession.title}"`);
                    } else {
                        let playlistName = null;
                        if (playback.context && playback.context.type === 'playlist') {
                            const playlistId = playback.context.uri.split(':').pop();
                            playlistName = await getPlaylistNameCached(playlistId, token);
                        }

                        currentSession = {
                            id: `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                            trackId: playback.item.id,
                            title: playback.item.name,
                            artists: playback.item.artists.map(a => a.name),
                            playlistName: playlistName || null,
                            albumImg: playback.item.album?.images?.[0]?.url || '',
                            url: playback.item.external_urls?.spotify || `https://open.spotify.com/track/${playback.item.id}`,
                            durationMs: playback.item.duration_ms,
                            listenedMs: 0,
                            timestamp: new Date().toISOString(),
                            lastProgress: playback.progress_ms,
                            lastUpdated: now
                        };
                        console.log(`[Spotify History] Neue Session gestartet: "${currentSession.title}" (Playlist: ${playlistName || 'Keine'})`);
                    }
                } else {
                    const deltaProgress = playback.progress_ms - currentSession.lastProgress;
                    const timeElapsed = now - currentSession.lastUpdated;
                    if (deltaProgress > 0 && deltaProgress < 20000) {
                        currentSession.listenedMs += deltaProgress;
                    } else if (timeElapsed > 0 && timeElapsed < 20000) {
                        currentSession.listenedMs += timeElapsed;
                    }
                    currentSession.lastProgress = playback.progress_ms;
                    currentSession.lastUpdated = now;
                    console.log(`[Spotify History] Session aktiv: "${currentSession.title}" (bisher ${Math.round(currentSession.listenedMs / 1000)}s)`);
                }
            } else {
                finalizeCurrentSession();
            }

            let queueData = [];
            try {
                const resQueue = await fetch('https://api.spotify.com/v1/me/player/queue', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (resQueue.status === 200) {
                    const queueJson = await resQueue.json();
                    if (queueJson && queueJson.queue) {
                        queueData = queueJson.queue.slice(0, 9).map(track => ({
                            title: track.name,
                            artist: track.artists.map(a => a.name).join(', ')
                        }));
                    }
                }
            } catch (qErr) {
                console.error("Fehler beim Einlesen der Warteschlange:", qErr.message);
            }

            const spotifyData = {
                action: 'spotify-playing',
                title: playback.item.name,
                artist: playback.item.artists.map(a => a.name).join(', '),
                albumImg: playback.item.album.images[0].url,
                progress: playback.progress_ms,
                duration: playback.item.duration_ms,
                isPlaying: playback.is_playing,
                deviceName: playback.device?.name || '',
                deviceType: playback.device?.type || '',
                queue: queueData,
                topTracks: cachedTopTracks
            };
            cachedCurrentPlayback = spotifyData; // Cache aktualisieren
            saveSpotifyCacheToFile(); // Cache speichern
            if (playback.is_playing) {
                sendToClients(spotifyData);
            } else {
                sendToClients({
                    action: 'spotify-unavailable',
                    reason: 'paused'
                });
            }
            return spotifyData;
        } else {
            finalizeCurrentSession();
            // Wenn Musik gestoppt/pausiert ist
            console.log("ℹ️ Spotify: Musik ist pausiert oder gestoppt");
            sendToClients({
                action: 'spotify-unavailable',
                reason: 'paused'
            });
            return null;
        }
    } catch (err) {
        console.error("Spotify-Polling Fehler:", err.message);
        return null;
    }
}

app.get('/spotify/refresh', async (req, res) => {
    try {
        const playback = await fetchAndCacheCurrentPlayback();
        res.json({
            ok: true,
            currentPlayback: playback,
            cached: cachedCurrentPlayback,
            topTracks: cachedTopTracks
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/spotify/playlists', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 12));
        const token = await getSpotifyAccessToken();
        const response = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText || `Spotify Playlist Fehler (${response.status})` });
        }

        const data = await response.json();
        res.json({
            playlists: (data.items || []).map(playlist => ({
                name: playlist.name,
                uri: playlist.uri,
                tracks: Number.isFinite(playlist.tracks?.total) ? playlist.tracks.total : null,
                image: playlist.images?.[0]?.url || ''
            }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- SPOTIFY ROTATION, HISTORY & STATS LOGIC ---

async function rotateSpotifyPlaylist() {
    console.log("[Spotify Rotation] Starte Playlist-Rotation...");
    try {
        const history = loadSpotifyHistory();
        if (!history || history.length === 0) {
            console.log("[Spotify Rotation] Keine Historie vorhanden, überspringe.");
            return { success: false, error: "Keine Historie vorhanden" };
        }

        const now = new Date();
        const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

        // Filter tracks played in the last 20 days
        const recentPlays = history.filter(item => new Date(item.timestamp) >= twentyDaysAgo);

        if (recentPlays.length === 0) {
            console.log("[Spotify Rotation] Keine Songs in den letzten 20 Tagen gehört.");
            return { success: true, tracksCount: 0 };
        }

        // Count plays per track
        const trackStats = {};
        recentPlays.forEach(play => {
            if (!trackStats[play.trackId]) {
                trackStats[play.trackId] = {
                    trackId: play.trackId,
                    title: play.title,
                    plays: 0
                };
            }
            trackStats[play.trackId].plays += 1;
        });

        // Sort by play count descending, limit to 100 tracks
        const sortedTracks = Object.values(trackStats)
            .sort((a, b) => b.plays - a.plays)
            .slice(0, 100);

        const trackUris = sortedTracks.map(t => `spotify:track:${t.trackId}`);

        // Get Spotify Token
        const token = await getSpotifyAccessToken();

        // Get User ID
        const userRes = await fetch('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!userRes.ok) {
            throw new Error(`Fehler beim Abrufen des Nutzers: ${userRes.statusText}`);
        }
        const userData = await userRes.json();
        const userId = userData.id;

        // Find or create playlist "PulseOS Highlights"
        let playlistId = null;
        let limit = 50;
        let offset = 0;
        let finished = false;

        while (!finished) {
            const playlistsRes = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!playlistsRes.ok) {
                throw new Error(`Fehler beim Abrufen der Playlists: ${playlistsRes.statusText}`);
            }
            const playlistsData = await playlistsRes.json();
            const playlists = playlistsData.items || [];
            
            const existing = playlists.find(p => p.name === 'PulseOS Highlights');
            if (existing) {
                playlistId = existing.id;
                finished = true;
            } else if (playlists.length < limit) {
                finished = true;
            } else {
                offset += limit;
            }
        }

        if (!playlistId) {
            console.log("[Spotify Rotation] Erstelle neue Playlist 'PulseOS Highlights'...");
            const createRes = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({
                    name: 'PulseOS Highlights',
                    public: true,
                    description: 'Deine PulseOS Highlights der letzten 20 Tage (wird automatisch aktualisiert)'
                })
            });
            if (!createRes.ok) {
                throw new Error(`Fehler beim Erstellen der Playlist: ${createRes.statusText}`);
            }
            const newPlaylist = await createRes.json();
            playlistId = newPlaylist.id;
        }

        // Replace playlist tracks
        console.log(`[Spotify Rotation] Aktualisiere Playlist mit ${trackUris.length} Songs...`);
        const updateRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                uris: trackUris
            })
        });

        if (!updateRes.ok) {
            throw new Error(`Fehler beim Aktualisieren der Playlist-Tracks: ${updateRes.statusText}`);
        }

        console.log("[Spotify Rotation] Playlist-Rotation erfolgreich durchgeführt!");
        return { success: true, tracksCount: trackUris.length };
    } catch (err) {
        console.error("[Spotify Rotation] Fehler bei der Rotation:", err.message);
        return { success: false, error: err.message };
    }
}

let lastRotationDay = null;

function checkPlaylistRotationScheduling() {
    const now = new Date();
    // Monday is 1, 12:00
    if (now.getDay() === 1 && now.getHours() === 12 && now.getMinutes() === 0) {
        const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        if (lastRotationDay !== todayKey) {
            lastRotationDay = todayKey;
            rotateSpotifyPlaylist();
        }
    }
}

app.get('/spotify/history', (req, res) => {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
    const history = loadSpotifyHistory();
    const sortedHistory = [...history].reverse().slice(0, limit);
    res.json({ history: sortedHistory });
});

app.get('/spotify/stats', (req, res) => {
    const history = loadSpotifyHistory();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let totalTimeTodayMs = 0;
    let totalTimeAllTimeMs = 0;

    const dailyListenTime = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dailyListenTime[dateKey] = 0;
    }

    const trackCounts = {};
    const artistCounts = {};
    const playlistCounts = {};

    history.forEach(session => {
        const sessionTime = session.listenedMs || 0;
        totalTimeAllTimeMs += sessionTime;

        const sessionDate = new Date(session.timestamp);
        if (sessionDate >= startOfToday) {
            totalTimeTodayMs += sessionTime;
        }

        const dateKey = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`;
        if (dailyListenTime[dateKey] !== undefined) {
            dailyListenTime[dateKey] += sessionTime;
        }

        if (session.trackId) {
            if (!trackCounts[session.trackId]) {
                trackCounts[session.trackId] = {
                    trackId: session.trackId,
                    title: session.title,
                    artists: session.artists,
                    plays: 0,
                    durationMs: session.durationMs
                };
            }
            trackCounts[session.trackId].plays += 1;
        }

        if (session.artists && Array.isArray(session.artists)) {
            session.artists.forEach(artist => {
                if (!artistCounts[artist]) {
                    artistCounts[artist] = {
                        name: artist,
                        plays: 0,
                        durationMs: 0
                    };
                }
                artistCounts[artist].plays += 1;
                artistCounts[artist].durationMs += sessionTime;
            });
        }

        if (session.playlistName) {
            if (!playlistCounts[session.playlistName]) {
                playlistCounts[session.playlistName] = {
                    name: session.playlistName,
                    plays: 0,
                    durationMs: 0
                };
            }
            playlistCounts[session.playlistName].plays += 1;
            playlistCounts[session.playlistName].durationMs += sessionTime;
        }
    });

    const topTracks = Object.values(trackCounts)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 50);

    const topArtists = Object.values(artistCounts)
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 50);

    const topPlaylists = Object.values(playlistCounts)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 50);

    res.json({
        totalTimeTodayMinutes: Math.round(totalTimeTodayMs / 60000),
        totalTimeAllTimeHours: Math.round(totalTimeAllTimeMs / 3600000),
        dailyListenTime: Object.entries(dailyListenTime).map(([date, ms]) => ({
            date,
            minutes: Math.round(ms / 60000)
        })).reverse(),
        topTracks,
        topArtists,
        topPlaylists,
        uniqueArtistsCount: Object.keys(artistCounts).length,
        totalPlaysCount: history.length
    });
});

app.get('/spotify/playlist/rotate-now', async (req, res) => {
    const result = await rotateSpotifyPlaylist();
    if (result.success) {
        res.json({ ok: true, message: `Playlist 'PulseOS Highlights' erfolgreich rotiert mit ${result.tracksCount} Songs.` });
    } else {
        res.status(500).json({ ok: false, error: result.error });
    }
});

app.post('/spotify/control', async (req, res) => {
    const action = req.body?.action;
    if (!['toggle', 'next', 'previous'].includes(action)) {
        return res.status(400).json({ error: 'Ungültige Spotify-Aktion' });
    }

    try {
        const token = await getSpotifyAccessToken();
        let endpoint = '';
        let method = 'POST';

        if (action === 'next') endpoint = 'https://api.spotify.com/v1/me/player/next';
        if (action === 'previous') endpoint = 'https://api.spotify.com/v1/me/player/previous';

        if (action === 'toggle') {
            const playbackResponse = await fetch('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (playbackResponse.status === 204) {
                return res.status(404).json({ error: 'Kein aktives Spotify-Gerät' });
            }

            if (!playbackResponse.ok) {
                const errorText = await playbackResponse.text();
                return res.status(playbackResponse.status).json({ error: errorText || `Spotify Playback Fehler (${playbackResponse.status})` });
            }

            const playback = await playbackResponse.json();
            endpoint = playback.is_playing
                ? 'https://api.spotify.com/v1/me/player/pause'
                : 'https://api.spotify.com/v1/me/player/play';
            method = 'PUT';
        }

        const response = await fetch(endpoint, {
            method,
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!response.ok && response.status !== 204) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText || `Spotify Control Fehler (${response.status})` });
        }

        setTimeout(fetchAndCacheCurrentPlayback, 1000);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/spotify/play', async (req, res) => {
    const contextUri = req.body?.contextUri;
    if (!contextUri) {
        return res.status(400).json({ error: 'Spotify contextUri fehlt' });
    }

    try {
        const token = await getSpotifyAccessToken();
        const response = await fetch('https://api.spotify.com/v1/me/player/play', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ context_uri: contextUri })
        });

        if (!response.ok && response.status !== 204) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText || `Spotify Play Fehler (${response.status})` });
        }

        setTimeout(fetchAndCacheCurrentPlayback, 1000);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/spotify/play-track', async (req, res) => {
    const trackId = req.body?.trackId;
    if (!trackId) {
        return res.status(400).json({ error: 'trackId fehlt' });
    }

    try {
        const token = await getSpotifyAccessToken();
        const response = await fetch('https://api.spotify.com/v1/me/player/play', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ uris: [`spotify:track:${trackId}`] })
        });

        if (!response.ok && response.status !== 204) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText || `Spotify Play-Track Fehler (${response.status})` });
        }

        setTimeout(fetchAndCacheCurrentPlayback, 1000);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- POPUP / WIDGET TOGGLE SYSTEM (STREAM DECK) ---
let allPopupsHidden = false;

app.get('/popup/:name', (req, res) => {
    const name = req.params.name;
    const requestedMode = req.query.mode; 

    if (name === 'alle') {
        allPopupsHidden = !allPopupsHidden;
        sendToClients({ 
            action: 'toggle-popup', 
            target: 'alle', 
            visible: !allPopupsHidden 
        });
        return res.send(`Alle Popups werden ${allPopupsHidden ? 'versteckt' : 'eingeblendet'}.\n`);
    }

    sendToClients({ 
        action: 'toggle-popup', 
        target: name,
        mode: requestedMode 
    });

    if (requestedMode) {
        res.send(`Popup [${name}] auf Modus [${requestedMode}] gesetzt.\n`);
    } else {
        res.send(`Popup [${name}] getoggelt.\n`);
    }
});

// --- PER-DISPLAY POPUP SYSTEM ---
app.get('/display/:displayId/popup/:name', (req, res) => {
    const displayId = parseInt(req.params.displayId);
    const name = req.params.name;
    const requestedMode = req.query.mode; 

    sendToDisplay(displayId, { 
        action: 'toggle-popup', 
        target: name,
        mode: requestedMode,
        displayId
    });

    if (requestedMode) {
        res.send(`Popup [${name}] für Display ${displayId} auf Modus [${requestedMode}] gesetzt.\n`);
    } else {
        res.send(`Popup [${name}] für Display ${displayId} getoggelt.\n`);
    }
});


// --- SERVER INFO & CONFIG ENDPOINTS ---
app.get('/config/displays', (req, res) => {
    const displaysList = Object.entries(CONFIGURED_DISPLAYS).map(([id, config]) => ({
        displayId: parseInt(id),
        name: config.name,
        ip: config.ip,
        online: clients.some(c => c.displayId === parseInt(id)),
        settings: displaySettings[id] || {}
    }));
    
    // Add online temporary displays
    clients.forEach(client => {
        const id = client.displayId;
        if (id && !CONFIGURED_DISPLAYS[id] && !displaysList.some(d => d.displayId === id)) {
            displaysList.push({
                displayId: id,
                name: client.name,
                ip: client.ip,
                online: true,
                settings: displaySettings[id] || {}
            });
        }
    });

    res.json({ displays: displaysList, total: displaysList.length });
});

app.get('/config/displays/status', (req, res) => {
    const status = {
        configuredCount: Object.keys(CONFIGURED_DISPLAYS).length,
        onlineCount: clients.length,
        displays: clients.map(c => ({
            displayId: c.displayId,
            name: c.name,
            ip: c.ip,
            settings: displaySettings[c.displayId] || {}
        }))
    };
    res.json(status);
});

// --- 🔆 BRIGHTNESS ENDPOINTS ---
let brightnessValue = 50; // Default Helligkeit

app.get('/brightness', (req, res) => {
    res.json({ brightness: brightnessValue });
});

app.post('/brightness/:value', (req, res) => {
    const value = Math.max(0, Math.min(100, parseInt(req.params.value)));
    brightnessValue = value;
    console.log(`[Brightness] Updated: ${value}%`);
    res.json({ brightness: brightnessValue });
});

// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
    checkStoredReminders();
    checkPlaylistRotationScheduling();
    setInterval(() => {
        checkStoredReminders();
        checkPlaylistRotationScheduling();
    }, 60 * 1000);
    if (SPOTIFY_REFRESH_TOKEN) {
        startSpotifyPolling();
    } else {
        console.log("⚠️ Kein Spotify Token hinterlegt. Bitte /spotify/login aufrufen!");
    }
});
