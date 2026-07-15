require('dotenv').config(); // LÄDT DIE .ENV DATEI DIREKT BEIM START

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

const PulseOSVERSION = "26.5.1111";
let logSpotify204 = true;
let logSpotifyHistory = true;
let logDisplay = true;
let logSSE = true;

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function filterLog(args) {
    if (args.length > 0 && typeof args[0] === 'string') {
        const msg = args[0];
        if (!logSpotifyHistory && msg.includes('[Spotify History]')) return true;
        if (!logDisplay && msg.includes('[Display]')) return true;
        if (!logSSE && msg.includes('[SSE]')) return true;
        if (!logSpotify204 && msg.includes('Spotify sagt: Kein aktives Gerät')) return true;
    }
    return false;
}

console.log = function(...args) {
    if (filterLog(args)) return;
    originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
    if (filterLog(args)) return;
    originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
    if (filterLog(args)) return;
    originalConsoleWarn.apply(console, args);
};

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
    const serial = envVars[`DISPLAY_${displayId}_SERIAL`] || `SERIAL_${displayId}`;
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
        } catch (e) {
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
            } catch (e) {
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
        } catch (e) {
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
    try { if (typeof activeTimerInterval !== 'undefined') clearInterval(activeTimerInterval); } catch (e) { }
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
const SPOTIFY_EXCLUDED_FILE = path.join(__dirname, 'spotify-excluded.json');
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

let cachedSpotifyHistory = null;
let cachedSpotifyExcluded = null;

function loadSpotifyHistory() {
    if (cachedSpotifyHistory !== null) {
        return cachedSpotifyHistory;
    }
    try {
        if (!fs.existsSync(SPOTIFY_HISTORY_FILE)) {
            cachedSpotifyHistory = [];
            return cachedSpotifyHistory;
        }
        const data = fs.readFileSync(SPOTIFY_HISTORY_FILE, 'utf8');
        cachedSpotifyHistory = data ? JSON.parse(data) : [];
        return cachedSpotifyHistory;
    } catch (e) {
        console.error('[Spotify History] Fehler beim Laden:', e);
        return [];
    }
}

function saveSpotifyHistory(history) {
    cachedSpotifyHistory = history;
    try {
        fs.writeFile(SPOTIFY_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8', (err) => {
            if (err) console.error('[Spotify History] Fehler beim Speichern (async):', err.message);
        });
    } catch (e) {
        console.error('[Spotify History] Fehler beim Speichern:', e);
    }
}

const SPOTIFY_PULSEOS_PLAYLISTS_FILE = path.join(__dirname, 'pulseos-playlists.json');
let cachedPulseOSPlaylists = null;

function loadPulseOSPlaylists() {
    if (cachedPulseOSPlaylists !== null) return cachedPulseOSPlaylists;
    try {
        if (!fs.existsSync(SPOTIFY_PULSEOS_PLAYLISTS_FILE)) {
            cachedPulseOSPlaylists = [];
            return cachedPulseOSPlaylists;
        }
        const data = fs.readFileSync(SPOTIFY_PULSEOS_PLAYLISTS_FILE, 'utf8');
        cachedPulseOSPlaylists = data ? JSON.parse(data) : [];
        return cachedPulseOSPlaylists;
    } catch (e) {
        console.error('[PulseOS Playlists] Fehler beim Laden:', e);
        return [];
    }
}

function savePulseOSPlaylists(playlists) {
    cachedPulseOSPlaylists = playlists;
    try {
        fs.writeFile(SPOTIFY_PULSEOS_PLAYLISTS_FILE, JSON.stringify(playlists, null, 2), 'utf8', (err) => {
            if (err) console.error('[PulseOS Playlists] Fehler beim Speichern (async):', err.message);
        });
    } catch (e) {
        console.error('[PulseOS Playlists] Fehler beim Speichern:', e);
    }
}

function loadSpotifyExcluded() {
    if (cachedSpotifyExcluded !== null) {
        return cachedSpotifyExcluded;
    }
    try {
        if (!fs.existsSync(SPOTIFY_EXCLUDED_FILE)) {
            cachedSpotifyExcluded = [];
            return cachedSpotifyExcluded;
        }
        const data = fs.readFileSync(SPOTIFY_EXCLUDED_FILE, 'utf8');
        cachedSpotifyExcluded = data ? JSON.parse(data) : [];
        return cachedSpotifyExcluded;
    } catch (e) {
        console.error('[Spotify Excluded] Fehler beim Laden:', e);
        return [];
    }
}

function saveSpotifyExcluded(excluded) {
    cachedSpotifyExcluded = excluded;
    try {
        fs.writeFile(SPOTIFY_EXCLUDED_FILE, JSON.stringify(excluded, null, 2), 'utf8', (err) => {
            if (err) console.error('[Spotify Excluded] Fehler beim Speichern (async):', err.message);
        });
    } catch (e) {
        console.error('[Spotify Excluded] Fehler beim Speichern:', e);
    }
}

const SPOTIFY_SKIPPED_FILE = path.join(__dirname, 'spotify-skipped.json');
let cachedSpotifySkipped = null;

function loadSpotifySkipped() {
    if (cachedSpotifySkipped !== null) return cachedSpotifySkipped;
    try {
        if (!fs.existsSync(SPOTIFY_SKIPPED_FILE)) {
            cachedSpotifySkipped = [];
            return cachedSpotifySkipped;
        }
        const data = fs.readFileSync(SPOTIFY_SKIPPED_FILE, 'utf8');
        cachedSpotifySkipped = data ? JSON.parse(data) : [];
        return cachedSpotifySkipped;
    } catch (e) {
        console.error('[Spotify Skipped] Fehler beim Laden:', e);
        return [];
    }
}

function saveSpotifySkipped(skipped) {
    cachedSpotifySkipped = skipped;
    try {
        fs.writeFile(SPOTIFY_SKIPPED_FILE, JSON.stringify(skipped, null, 2), 'utf8', (err) => {
            if (err) console.error('[Spotify Skipped] Fehler beim Speichern (async):', err.message);
        });
    } catch (e) {
        console.error('[Spotify Skipped] Fehler beim Speichern:', e);
    }
}

let currentSession = null;
let lastDiscardedSession = null;

function finalizeCurrentSession() {
    if (!currentSession) return;
    if (currentSession.listenedMs >= 60000) { // 1 Minute
        const excluded = loadSpotifyExcluded();
        const isExcluded = excluded.some(x => x.trackId === currentSession.trackId);
        if (isExcluded) {
            console.log(`[Spotify History] Song "${currentSession.title}" ignoriert, da er auf der Excluded-Liste steht.`);
            currentSession = null;
            return;
        }

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
            timestamp: currentSession.timestamp,
            device: currentSession.device || null
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
    const scopes = [
        'ugc-image-upload',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-currently-playing',
        'app-remote-control',
        'streaming',
        'playlist-read-private',
        'playlist-read-collaborative',
        'playlist-modify-public',
        'playlist-modify-private',
        'user-follow-modify',
        'user-follow-read',
        'user-library-modify',
        'user-library-read',
        'user-read-email',
        'user-read-private',
        'user-top-read',
        'user-read-recently-played',
        'user-read-playback-position'
    ].join(' ');
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

    // Sofort erste Wiedergabe-Daten fetchen (nicht warten!)
    fetchAndCacheCurrentPlayback();

    // Danach regelmäßig updaten (3 Sekunden)
    // Die Player-API von Spotify (v1/me/player) ist dafür ausgelegt und hält das locker aus.
    setInterval(fetchAndCacheCurrentPlayback, 3000);
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
            if (logSpotify204) {
                console.log("ℹ️ Spotify sagt: Kein aktives Gerät oder Wiedergabe pausiert (Status " + resPlayback.status + ")");
            }
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
                            lastUpdated: now,
                            device: lastSession.device || playback.device?.name || null
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

                        // NEW SONG STARTED - definitively skipped previous discarded session
                        if (lastDiscardedSession) {
                            const skipped = loadSpotifySkipped();
                            skipped.push(lastDiscardedSession);
                            saveSpotifySkipped(skipped);
                            console.log(`[Spotify Skipped] Endgültig als übersprungen markiert: "${lastDiscardedSession.title}"`);
                            lastDiscardedSession = null;
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
                            lastUpdated: now,
                            device: playback.device?.name || null
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
        let limit = parseInt(req.query.limit, 10) || 12;
        const token = await getSpotifyAccessToken();
        
        // Hole User-ID um eigene Playlists zu identifizieren
        const userRes = await fetch('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const userData = await userRes.json();
        const userId = userData.id;

        // Hole mehr Playlists als das Limit, da wir filtern werden
        const response = await fetch(`https://api.spotify.com/v1/me/playlists?limit=50`, {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText || `Spotify Playlist Fehler (${response.status})` });
        }

        const data = await response.json();
        
        // Nur Playlists behalten, die dem User gehören oder kollaborativ sind
        const editablePlaylists = (data.items || []).filter(playlist => 
            playlist.owner.id === userId || playlist.collaborative === true
        );
        
        res.json({
            playlists: editablePlaylists.slice(0, limit).map(playlist => ({
                id: playlist.id,
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

app.post('/spotify/playlists/:id/tracks', async (req, res) => {
    try {
        const { id } = req.params;
        const { trackId } = req.body;
        if (!trackId) return res.status(400).json({ error: "trackId missing" });
        
        const token = await getSpotifyAccessToken();
        const response = await fetch(`https://api.spotify.com/v1/playlists/${id}/items`, {
            method: 'POST',
            headers: { 
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: [`spotify:track:${trackId}`] })
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText || `Fehler beim Hinzufügen (${response.status})` });
        }

        res.json({ success: true });
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
            const createRes = await fetch(`https://api.spotify.com/v1/me/playlists`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({
                    name: 'PulseOS Highlights',
                    public: true,
                    description: 'Deine Top Songs aus PulseOS Wrapped der letzten 28 Tage (Jeden Tag um 10:00 automatisch aktualisiert)'
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
        const updateRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
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

        // Upload custom playlist cover image
        try {
            const fs = require('fs');
            const path = require('path');
            const imgPath = path.join(__dirname, 'public', 'pulseos_logo_p_pulse.jpg');
            if (fs.existsSync(imgPath)) {
                console.log("[Spotify Rotation] Lade custom Playlist-Cover hoch...");
                const imgBase64 = fs.readFileSync(imgPath, { encoding: 'base64' });

                const imageRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/images`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'image/jpeg'
                    },
                    body: imgBase64
                });

                if (!imageRes.ok) {
                    const text = await imageRes.text();
                    console.warn(`[Spotify Rotation] Fehler beim Hochladen des Covers: ${imageRes.status} ${text}`);
                } else {
                    console.log("[Spotify Rotation] Playlist-Cover erfolgreich hochgeladen!");
                }
            } else {
                console.warn("[Spotify Rotation] Custom Cover Image nicht gefunden unter public/pulseos_logo_p_pulse.jpg");
            }
        } catch (e) {
            console.error("[Spotify Rotation] Fehler beim Upload des Cover-Bildes:", e.message);
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
    const history = loadSpotifyHistory();
    let sortedHistory = [...history].reverse();
    if (req.query.limit) {
        const limit = parseInt(req.query.limit, 10);
        if (!isNaN(limit) && limit > 0) {
            sortedHistory = sortedHistory.slice(0, limit);
        }
    }
    res.json({ history: sortedHistory });
});

app.post('/spotify/history/remove', (req, res) => {
    const { trackId } = req.body;
    if (!trackId) {
        return res.status(400).json({ error: 'Track-ID fehlt' });
    }

    try {
        const history = loadSpotifyHistory();
        const initialCount = history.length;
        const filteredHistory = history.filter(item => item.trackId !== trackId);
        const removedCount = initialCount - filteredHistory.length;

        // Add to excluded list
        const trackToExclude = history.find(item => item.trackId === trackId);
        if (trackToExclude) {
            const excluded = loadSpotifyExcluded();
            if (!excluded.some(x => x.trackId === trackId)) {
                excluded.push({
                    trackId: trackToExclude.trackId,
                    title: trackToExclude.title,
                    artists: trackToExclude.artists,
                    albumImg: trackToExclude.albumImg,
                    timestamp: new Date().toISOString()
                });
                saveSpotifyExcluded(excluded);
                console.log(`[Spotify Excluded] Song "${trackToExclude.title}" (${trackId}) zur Excluded-Liste hinzugefügt.`);
            }
        }

        if (removedCount > 0) {
            saveSpotifyHistory(filteredHistory);
            console.log(`[Spotify History] Song mit ID ${trackId} aus Verlauf entfernt. (${removedCount} Vorkommen)`);
            sendToClients({ action: 'spotify-history-updated' });
        }

        res.json({ success: true, removedCount });
    } catch (err) {
        console.error('[Spotify History] Fehler beim Löschen:', err.message);
        res.status(500).json({ error: 'Fehler beim Löschen des Songs' });
    }
});

app.get('/spotify/excluded', (req, res) => {
    res.json({ excluded: loadSpotifyExcluded() });
});

app.get('/spotify/skipped', (req, res) => {
    const skipped = loadSpotifySkipped();
    let sortedSkipped = [...skipped].reverse();
    const limit = parseInt(req.query.limit, 10);
    if (limit && limit > 0) {
        sortedSkipped = sortedSkipped.slice(0, limit);
    }
    res.json({ skipped: sortedSkipped });
});

app.post('/spotify/excluded/remove', (req, res) => {
    const { trackId } = req.body;
    if (!trackId) {
        return res.status(400).json({ error: 'Track-ID fehlt' });
    }
    try {
        const excluded = loadSpotifyExcluded();
        const initialCount = excluded.length;
        const filtered = excluded.filter(x => x.trackId !== trackId);
        if (filtered.length !== initialCount) {
            saveSpotifyExcluded(filtered);
            console.log(`[Spotify Excluded] Song mit ID ${trackId} aus Excluded-Liste entfernt.`);
            sendToClients({ action: 'spotify-history-updated' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[Spotify Excluded] Fehler beim Entfernen:', err.message);
        res.status(500).json({ error: 'Fehler beim Entfernen aus der Excluded-Liste' });
    }
});

app.post('/spotify/history/remove-multiple', (req, res) => {
    const { trackIds } = req.body;
    if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
        return res.status(400).json({ error: 'Track-IDs fehlen oder ungültig' });
    }

    try {
        const history = loadSpotifyHistory();
        const initialCount = history.length;
        const filteredHistory = history.filter(item => !trackIds.includes(item.trackId));
        const removedCount = initialCount - filteredHistory.length;

        if (removedCount > 0) {
            saveSpotifyHistory(filteredHistory);
            console.log(`[Spotify History] ${trackIds.length} Songs aus Verlauf entfernt. (${removedCount} Vorkommen gesamt)`);
            sendToClients({ action: 'spotify-history-updated' });
        }

        res.json({ success: true, removedCount });
    } catch (err) {
        console.error('[Spotify History] Fehler beim Bulk-Löschen:', err.message);
        res.status(500).json({ error: 'Fehler beim Bulk-Löschen' });
    }
});

app.post('/spotify/history/exclude-multiple', (req, res) => {
    const { trackIds } = req.body;
    if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
        return res.status(400).json({ error: 'Track-IDs fehlen oder ungültig' });
    }

    try {
        const history = loadSpotifyHistory();
        const excluded = loadSpotifyExcluded();
        let addedCount = 0;

        trackIds.forEach(trackId => {
            const trackToExclude = history.find(item => item.trackId === trackId);
            if (trackToExclude) {
                if (!excluded.some(x => x.trackId === trackId)) {
                    excluded.push({
                        trackId: trackToExclude.trackId,
                        title: trackToExclude.title,
                        artists: trackToExclude.artists,
                        albumImg: trackToExclude.albumImg,
                        timestamp: new Date().toISOString()
                    });
                    addedCount++;
                }
            }
        });

        if (addedCount > 0) {
            saveSpotifyExcluded(excluded);
            console.log(`[Spotify Excluded] ${addedCount} Songs zur Excluded-Liste hinzugefügt.`);
        }

        // Also remove them from history!
        const initialCount = history.length;
        const filteredHistory = history.filter(item => !trackIds.includes(item.trackId));
        const removedCount = initialCount - filteredHistory.length;

        if (removedCount > 0) {
            saveSpotifyHistory(filteredHistory);
            console.log(`[Spotify History] ${trackIds.length} Songs nach Ausschluss aus Verlauf entfernt.`);
            sendToClients({ action: 'spotify-history-updated' });
        }

        res.json({ success: true, addedCount, removedCount });
    } catch (err) {
        console.error('[Spotify Excluded] Fehler beim Bulk-Ausschluss:', err.message);
        res.status(500).json({ error: 'Fehler beim Bulk-Ausschluss' });
    }
});

app.post('/spotify/migrate-devices', (req, res) => {
    try {
        const history = loadSpotifyHistory();
        let migratedCount = 0;
        const targetDevice = "AfDBook Pro von Til dem Juden";
        
        for (let i = 0; i < history.length; i++) {
            if (!history[i].device) {
                history[i].device = targetDevice;
                migratedCount++;
            }
        }
        
        if (migratedCount > 0) {
            saveSpotifyHistory(history);
        }
        
        console.log(`[Migration] ${migratedCount} Einträge erfolgreich auf "${targetDevice}" migriert.`);
        res.json({ success: true, migratedCount });
    } catch (error) {
        console.error('[Migration] Fehler:', error);
        res.status(500).json({ error: 'Migration fehlgeschlagen: ' + error.message });
    }
});

app.get('/spotify/stats', (req, res) => {
    const history = loadSpotifyHistory();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const range = req.query.range || 'lifetime';
    const startParam = req.query.start;
    const endParam = req.query.end;
    const deviceParam = req.query.device;

    // 1. Calculate Structured Chart Data based on range
    const chartData = [];

    if (range === '7d') {
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            d.setDate(d.getDate() - i);
            const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
            const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
            const ms = history.reduce((sum, item) => {
                const t = new Date(item.timestamp);
                return (t >= start && t <= end) ? sum + (item.listenedMs || 0) : sum;
            }, 0);
            chartData.push({
                label: d.toLocaleDateString('de-DE', { weekday: 'short' }),
                minutes: Math.round(ms / 60000),
                startDate: start.toISOString(),
                endDate: end.toISOString()
            });
        }
    } else if (range === '30d') {
        for (let i = 3; i >= 0; i--) {
            const startDay = i * 7 + 6;
            const endDay = i * 7;
            const start = new Date(now.getTime() - startDay * 24 * 60 * 60 * 1000);
            start.setHours(0, 0, 0, 0);
            const end = new Date(now.getTime() - endDay * 24 * 60 * 60 * 1000);
            end.setHours(23, 59, 59, 999);
            const ms = history.reduce((sum, item) => {
                const t = new Date(item.timestamp);
                return (t >= start && t <= end) ? sum + (item.listenedMs || 0) : sum;
            }, 0);
            const label = `${String(start.getDate()).padStart(2, '0')}.${String(start.getMonth() + 1).padStart(2, '0')} - ${String(end.getDate()).padStart(2, '0')}.${String(end.getMonth() + 1).padStart(2, '0')}`;
            chartData.push({
                label,
                minutes: Math.round(ms / 60000),
                startDate: start.toISOString(),
                endDate: end.toISOString()
            });
        }
    } else if (range === '6m') {
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
            const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
            const ms = history.reduce((sum, item) => {
                const t = new Date(item.timestamp);
                return (t >= start && t <= end) ? sum + (item.listenedMs || 0) : sum;
            }, 0);
            chartData.push({
                label: d.toLocaleDateString('de-DE', { month: 'short' }),
                minutes: Math.round(ms / 60000),
                startDate: start.toISOString(),
                endDate: end.toISOString()
            });
        }
    } else {
        // Lifetime: Last 12 calendar months
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
            const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
            const ms = history.reduce((sum, item) => {
                const t = new Date(item.timestamp);
                return (t >= start && t <= end) ? sum + (item.listenedMs || 0) : sum;
            }, 0);
            chartData.push({
                label: d.toLocaleDateString('de-DE', { month: 'short' }),
                minutes: Math.round(ms / 60000),
                startDate: start.toISOString(),
                endDate: end.toISOString()
            });
        }
    }

    // 2. Compute Filter boundaries
    let startCutoff = null;
    let endCutoff = null;

    if (startParam && endParam) {
        startCutoff = new Date(startParam).getTime();
        endCutoff = new Date(endParam).getTime();
    } else if (range === '7d') {
        startCutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    } else if (range === '30d') {
        startCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    } else if (range === '6m') {
        const d = new Date();
        d.setMonth(d.getMonth() - 6);
        startCutoff = d.getTime();
    }

    const startOfTodayMs = startOfToday.getTime();

    // 3. Optimized processing in a single pass
    let totalTimeTodayMs = 0;
    let totalTimeFilteredMs = 0;

    const trackCounts = {};
    const artistCounts = {};
    const deviceCounts = {};
    const playlistCounts = {};

    const dailyListenTime = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dailyListenTime[dateKey] = 0;
    }

    let filteredCount = 0;
    const len = history.length;
    for (let i = 0; i < len; i++) {
        const session = history[i];
        const sessionTime = session.listenedMs || 0;
        const timestampMs = new Date(session.timestamp).getTime();

        // Today's time
        if (timestampMs >= startOfTodayMs) {
            totalTimeTodayMs += sessionTime;
        }

        // Playlists (always lifetime)
        if (session.playlistName) {
            let p = playlistCounts[session.playlistName];
            if (!p) {
                p = playlistCounts[session.playlistName] = {
                    name: session.playlistName,
                    plays: 0,
                    durationMs: 0
                };
            }
            p.plays += 1;
            p.durationMs += sessionTime;
        }

        // Backwards compatible dailyListenTime
        const sessionDate = new Date(session.timestamp);
        const dateKey = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`;
        if (dailyListenTime[dateKey] !== undefined) {
            dailyListenTime[dateKey] += sessionTime;
        }

        // Timeframe and device filtering
        let inRange = true;
        if (startCutoff !== null && timestampMs < startCutoff) inRange = false;
        if (endCutoff !== null && timestampMs > endCutoff) inRange = false;
        if (deviceParam && (!session.device || session.device.toLowerCase() !== deviceParam.toLowerCase())) {
            inRange = false;
        }

        if (inRange) {
            totalTimeFilteredMs += sessionTime;
            filteredCount++;

            if (session.trackId) {
                let t = trackCounts[session.trackId];
                if (!t) {
                    t = trackCounts[session.trackId] = {
                        trackId: session.trackId,
                        title: session.title,
                        artists: session.artists,
                        plays: 0,
                        durationMs: session.durationMs
                    };
                }
                t.plays += 1;
            }

            if (session.artists && Array.isArray(session.artists)) {
                const artLen = session.artists.length;
                for (let j = 0; j < artLen; j++) {
                    const artist = session.artists[j];
                    let a = artistCounts[artist];
                    if (!a) {
                        a = artistCounts[artist] = {
                            name: artist,
                            plays: 0,
                            durationMs: 0
                        };
                    }
                    a.plays += 1;
                    a.durationMs += sessionTime;
                }
            }

            if (session.device) {
                let dev = deviceCounts[session.device];
                if (!dev) {
                    dev = deviceCounts[session.device] = {
                        name: session.device,
                        plays: 0,
                        durationMs: 0
                    };
                }
                dev.plays += 1;
                dev.durationMs += sessionTime;
            }
        }
    }

    const topTracks = Object.values(trackCounts)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 50);

    const topArtists = Object.values(artistCounts)
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 50);

    const topPlaylists = Object.values(playlistCounts)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 50);

    const deviceStats = Object.values(deviceCounts)
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 50);

    res.json({
        totalTimeTodayMinutes: Math.round(totalTimeTodayMs / 60000),
        totalTimeAllTimeMinutes: Math.round(totalTimeFilteredMs / 60000),
        totalTimeAllTimeHours: Math.round(totalTimeFilteredMs / 3600000),
        dailyListenTime: Object.entries(dailyListenTime).map(([date, ms]) => ({
            date,
            minutes: Math.round(ms / 60000)
        })).reverse(),
        chartData,
        topTracks,
        topArtists,
        topPlaylists,
        deviceStats,
        uniqueArtistsCount: Object.keys(artistCounts).length,
        totalPlaysCount: filteredCount
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
app.get('/spotify/pulseos-playlists', (req, res) => {
    res.json({ playlists: loadPulseOSPlaylists() });
});

app.get('/spotify/top-artists-custom', async (req, res) => {
    try {
        const historyData = loadSpotifyHistory();
        const artistStats = {};
        
        // Aggregate listening time per artist
        for (const track of historyData) {
            if (!track.artists || !track.listenedMs) continue;
            for (const artistName of track.artists) {
                if (!artistStats[artistName]) {
                    artistStats[artistName] = { name: artistName, listenedMs: 0, defaultImage: track.albumImg };
                }
                artistStats[artistName].listenedMs += track.listenedMs;
            }
        }
        
        // Sort and take top 50 to give a good selection
        const sortedArtists = Object.values(artistStats)
            .sort((a, b) => b.listenedMs - a.listenedMs)
            .slice(0, 50);
            
        const token = await getSpotifyAccessToken();
        
        // Bypass Search API entirely to avoid 429 Rate Limits
        const artists = [];
        let artistCache = {};
        const fs = require('fs');
        if (fs.existsSync('artist-cache.json')) {
            try { artistCache = JSON.parse(fs.readFileSync('artist-cache.json', 'utf8')); } catch (e) {}
        }

        // 1. Gather tracks for artists we don't have in cache
        let missingArtists = [];
        for (const artist of sortedArtists) {
            if (artistCache[artist.name]) {
                artists.push({ id: artistCache[artist.name].id || artist.name, name: artist.name, image: artistCache[artist.name].image || artistCache[artist.name] });
            } else {
                missingArtists.push(artist);
            }
        }

        if (missingArtists.length > 0) {
            // Find one trackId for each missing artist from history
            const historyData = loadSpotifyHistory();
            const trackIdsToFetch = [];
            const trackIdToArtist = {};

            for (const artist of missingArtists) {
                const track = historyData.find(t => t.artists && t.artists.includes(artist.name) && t.trackId);
                if (track) {
                    trackIdsToFetch.push(track.trackId);
                    trackIdToArtist[track.trackId] = artist;
                } else {
                    // Fallback
                    artistCache[artist.name] = { id: artist.name, image: artist.defaultImage };
                    artists.push({ id: artist.name, name: artist.name, image: artist.defaultImage });
                }
            }

            // Chunk trackIds into groups of 50 (API Limit)
            let artistIdsToFetch = [];
            let artistIdToArtist = {};

            for (let i = 0; i < trackIdsToFetch.length; i += 50) {
                const chunk = trackIdsToFetch.slice(i, i + 50);
                try {
                    const res = await fetch(`https://api.spotify.com/v1/tracks?ids=${chunk.join(',')}`, { headers: { 'Authorization': 'Bearer ' + token } });
                    if (res.ok) {
                        const data = await res.json();
                        data.tracks.forEach((t, idx) => {
                            if (t && t.artists && t.artists.length > 0) {
                                const originalArtist = trackIdToArtist[chunk[idx]];
                                // Find the closest matching artist ID on this track
                                const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
                                const matched = t.artists.find(a => normalize(a.name) === normalize(originalArtist.name) || normalize(a.name).includes(normalize(originalArtist.name))) || t.artists[0];
                                artistIdsToFetch.push(matched.id);
                                artistIdToArtist[matched.id] = originalArtist;
                            }
                        });
                    }
                } catch (e) { console.error(e); }
            }

            // Fetch Artist Profiles in chunks of 50
            for (let i = 0; i < artistIdsToFetch.length; i += 50) {
                const chunk = artistIdsToFetch.slice(i, i + 50);
                try {
                    const res = await fetch(`https://api.spotify.com/v1/artists?ids=${chunk.join(',')}`, { headers: { 'Authorization': 'Bearer ' + token } });
                    if (res.ok) {
                        const data = await res.json();
                        data.artists.forEach((a, idx) => {
                            if (a) {
                                const originalArtist = artistIdToArtist[chunk[idx]];
                                const img = a.images && a.images.length > 0 ? a.images[0].url : originalArtist.defaultImage;
                                artistCache[originalArtist.name] = { id: a.id, image: img };
                                artists.push({ id: a.id, name: originalArtist.name, image: img });
                            }
                        });
                    }
                } catch (e) { console.error(e); }
            }

            fs.writeFileSync('artist-cache.json', JSON.stringify(artistCache, null, 2));
        }
        
        res.json({ artists });
    } catch (err) {
        console.error('[Top Artists Custom Error]', err);
        res.status(500).json({ error: err.stack || err.message });
    }
});

app.post('/spotify/generate-custom-mix', async (req, res) => {
    const { seedArtistNames, playlistName, fillWithRandom } = req.body;
    if (!seedArtistNames || seedArtistNames.length === 0) return res.status(400).json({ error: 'Keine Artists angegeben' });

    try {
        const token = await getSpotifyAccessToken();
        
        // 1. Get most listened songs from local history for selected artists
        const trackStats = {};
        const historyData = loadSpotifyHistory(); 
        
        for (const track of historyData) {
            const match = track.artists && track.artists.some(artistName => 
                seedArtistNames.some(seed => artistName.toLowerCase() === seed.toLowerCase())
            );
            
            if (match && track.trackId) {
                if (!trackStats[track.trackId]) {
                    trackStats[track.trackId] = { trackId: track.trackId, name: track.trackName || 'Unbekannter Track', listenedMs: 0 };
                }
                trackStats[track.trackId].listenedMs += track.listenedMs;
            }
        }
        
        // Sort by listenedMs descending
        const sortedTracks = Object.values(trackStats)
            .sort((a, b) => b.listenedMs - a.listenedMs)
            .slice(0, 50);
            
        let finalTracksInfo = sortedTracks.map(t => ({ uri: `spotify:track:${t.trackId}`, name: t.name }));
        const uris = finalTracksInfo.map(t => t.uri);
        
        if (uris.length === 0) throw new Error('Keine Songs für die ausgewählten Künstler im Verlauf gefunden.');

        // Fill with Spotify Recommendations if requested and less than 50
        if (fillWithRandom && uris.length < 50 && sortedTracks.length > 0) {
            try {
                let additionalUrisInfo = [];
                let trackCache = {};
                const trackCacheFile = 'track-cache.json';
                if (fs.existsSync(trackCacheFile)) {
                    try { trackCache = JSON.parse(fs.readFileSync(trackCacheFile, 'utf8')); } catch (e) {}
                }

                for (const artistName of seedArtistNames) {
                    const normalizedArtistForCache = artistName.toLowerCase().trim();
                    if (trackCache[normalizedArtistForCache] && trackCache[normalizedArtistForCache].length > 0) {
                        // Load from Cache
                        additionalUrisInfo.push(...trackCache[normalizedArtistForCache]);
                        continue;
                    }
                    
                    let artistTracksFound = [];
                    // 1. Get Artist ID from Cache or History
                    let artistId = trackCache[normalizedArtistForCache]?.artistId;
                    if (!artistId) {
                        const artistCacheData = JSON.parse(fs.readFileSync('artist-cache.json', 'utf8') || '{}');
                        if (artistCacheData[artistName] && artistCacheData[artistName].id) {
                            artistId = artistCacheData[artistName].id;
                        } else {
                            // Find from history fallback
                            const historyData = loadSpotifyHistory();
                            const track = historyData.find(t => t.artists && t.artists.includes(artistName) && t.trackId);
                            if (track) {
                                try {
                                    const res = await fetch(`https://api.spotify.com/v1/tracks/${track.trackId}`, { headers: { 'Authorization': 'Bearer ' + token }});
                                    if (res.ok) {
                                        const tData = await res.json();
                                        const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
                                        const matched = tData.artists.find(a => normalize(a.name) === normalize(artistName) || normalize(a.name).includes(normalize(artistName))) || tData.artists[0];
                                        artistId = matched.id;
                                    }
                                } catch(e){}
                            }
                        }
                    }

                    if (artistId) {
                        try {
                            // 2. Fetch Albums for Artist (up to 10 to get variety)
                            const albumRes = await fetch(`https://api.spotify.com/v1/artists/${artistId}/albums?limit=10&include_groups=album,single`, {
                                headers: { 'Authorization': 'Bearer ' + token }
                            });
                            if (albumRes.ok) {
                                const albumData = await albumRes.json();
                                const albumIds = albumData.items.map(a => a.id);
                                
                                // 3. Fetch all tracks from those albums (up to 20 albums at once)
                                if (albumIds.length > 0) {
                                    const chunk = albumIds.slice(0, 20);
                                    const fullAlbumsRes = await fetch(`https://api.spotify.com/v1/albums?ids=${chunk.join(',')}`, {
                                        headers: { 'Authorization': 'Bearer ' + token }
                                    });
                                    if (fullAlbumsRes.ok) {
                                        const fullAlbumsData = await fullAlbumsRes.json();
                                        fullAlbumsData.albums.forEach(album => {
                                            if (album && album.tracks && album.tracks.items) {
                                                album.tracks.items.forEach(track => {
                                                    const trackUri = `spotify:track:${track.id}`;
                                                    if (!uris.includes(trackUri) && !additionalUrisInfo.some(t => t.uri === trackUri)) {
                                                        const trackObj = { uri: trackUri, name: track.name };
                                                        additionalUrisInfo.push(trackObj);
                                                        artistTracksFound.push(trackObj);
                                                    }
                                                });
                                            }
                                        });
                                    }
                                }
                            }
                        } catch(e) { console.error("Error fetching albums for " + artistName, e); }
                    }
                    
                    // Save to Cache
                    if (artistTracksFound.length > 0) {
                        trackCache[normalizedArtistForCache] = artistTracksFound;
                        fs.writeFileSync(trackCacheFile, JSON.stringify(trackCache, null, 2));
                    }
                }
                
                additionalUrisInfo = additionalUrisInfo.sort(() => Math.random() - 0.5);
                const needed = 50 - uris.length;
                const toAdd = additionalUrisInfo.slice(0, Math.max(0, needed));
                uris.push(...toAdd.map(t => t.uri));
                finalTracksInfo.push(...toAdd);
            } catch (e) {
                console.error('Error fetching recommendations:', e);
            }
        }

        // 2. Create Playlist (Using /v1/me/playlists like rotate-now does to avoid 403)
        const finalName = playlistName || `PulseOS Mix: ${new Date().toLocaleDateString('de-DE')}`;
        const createRes = await fetch(`https://api.spotify.com/v1/me/playlists`, {
            method: 'POST',
            headers: { 
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: finalName,
                description: 'Dein persönlicher PulseOS Mix basierend auf deiner Hör-History.',
                public: true
            })
        });
        if (!createRes.ok) {
            const errBody = await createRes.text();
            throw new Error(`Create API Error ${createRes.status}: ${errBody}`);
        }
        const playlistData = await createRes.json();

        // 3. Add Tracks
        const addRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistData.id}/items`, {
            method: 'POST',
            headers: { 
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris })
        });
        if (!addRes.ok) throw new Error('Add API Error ' + addRes.status);

        // 4. Save to local DB
        const generated = loadPulseOSPlaylists();
        const newPlaylist = {
            id: playlistData.id,
            name: playlistData.name,
            uri: playlistData.uri,
            url: playlistData.external_urls.spotify,
            createdAt: new Date().toISOString(),
            images: playlistData.images
        };
        generated.push(newPlaylist);
        savePulseOSPlaylists(generated);

        res.json({ ok: true, playlist: newPlaylist, playlistUri: playlistData.uri, addedTracks: finalTracksInfo.map(t => t.name) });
    } catch (err) {
        console.error('[Generate Custom Mix Error]', err);
        res.status(500).json({ error: err.stack || err.message });
    }
});
app.put('/spotify/playlists/:id/rename', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        const token = await getSpotifyAccessToken();
        const spotifyRes = await fetch(`https://api.spotify.com/v1/playlists/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name })
        });

        if (!spotifyRes.ok) throw new Error('Spotify API Error ' + spotifyRes.status);

        // Update locally
        const playlists = loadPulseOSPlaylists();
        const pl = playlists.find(p => p.id === id);
        if (pl) {
            pl.name = name;
            savePulseOSPlaylists(playlists);
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[Rename Error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/spotify/playlists/:id/delete', async (req, res) => {
    try {
        const { id } = req.params;
        const token = await getSpotifyAccessToken();
        
        const spotifyRes = await fetch(`https://api.spotify.com/v1/playlists/${id}/followers`, {
            method: 'DELETE',
            headers: {
                'Authorization': 'Bearer ' + token
            }
        });

        if (!spotifyRes.ok) throw new Error('Spotify API Error ' + spotifyRes.status);

        // Update locally
        let playlists = loadPulseOSPlaylists();
        playlists = playlists.filter(p => p.id !== id);
        savePulseOSPlaylists(playlists);

        res.json({ ok: true });
    } catch (err) {
        console.error('[Delete Error]', err);
        res.status(500).json({ error: err.message });
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

app.post('/spotify/queue-track', async (req, res) => {
    const trackId = req.body?.trackId;
    if (!trackId) {
        return res.status(400).json({ error: 'trackId fehlt' });
    }

    try {
        const token = await getSpotifyAccessToken();
        const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${trackId}`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token
            }
        });

        if (!response.ok && response.status !== 204) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: errorText || `Spotify Queue-Track Fehler (${response.status})` });
        }

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

// --- ⌚ WATCHFACE PERSISTENCE ENDPOINTS ---
const clientWatchfacesFile = path.join(__dirname, 'client-watchfaces.json');

function loadClientWatchfaces() {
    try {
        if (fs.existsSync(clientWatchfacesFile)) {
            return JSON.parse(fs.readFileSync(clientWatchfacesFile, 'utf8'));
        }
    } catch (e) {
        console.error('[Server] Fehler beim Laden der Client-Ziffernblätter:', e.message);
    }
    return {};
}

function saveClientWatchfaces(data) {
    try {
        fs.writeFileSync(clientWatchfacesFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[Server] Fehler beim Speichern der Client-Ziffernblätter:', e.message);
    }
}

app.get('/watchface/active', (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const data = loadClientWatchfaces();
    const activeWatchface = data[clientIp] !== undefined ? data[clientIp] : 0;
    res.json({ activeWatchface });
});

app.post('/watchface/active', (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const { activeWatchface } = req.body;
    if (activeWatchface === undefined) {
        return res.status(400).json({ error: 'activeWatchface fehlt' });
    }

    const data = loadClientWatchfaces();
    data[clientIp] = parseInt(activeWatchface, 10);
    saveClientWatchfaces(data);
    console.log(`[Server] Client ${clientIp} hat Ziffernblatt auf Index ${activeWatchface} gesetzt.`);
    res.json({ success: true });
});

app.get('/settings/logs', (req, res) => {
    res.json({
        spotify204: logSpotify204,
        spotifyHistory: logSpotifyHistory,
        display: logDisplay,
        sse: logSSE
    });
});

app.post('/settings/logs/toggle', (req, res) => {
    const { key, enabled } = req.body;
    if (key === 'spotify204') logSpotify204 = enabled;
    else if (key === 'spotifyHistory') logSpotifyHistory = enabled;
    else if (key === 'display') logDisplay = enabled;
    else if (key === 'sse') logSSE = enabled;
    res.json({ success: true, [key]: enabled });
});

app.get('/server/running', (req, res) => {
    res.status(200).send('OK');
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
