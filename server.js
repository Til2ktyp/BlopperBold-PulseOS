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

// DAS ZENTRALE ARRAY FÜR ALLE OPENING DISPLAYS
let clients = [];

// Hilfsfunktion um Daten an alle Displays zu senden (Widgets, Spotify, etc.)
function sendToClients(data) {
    clients.forEach(client => {
        try {
            client.res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch(e) {
            console.error("Fehler beim Senden an Client:", e.message);
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

    const clientId = Date.now();
    clients.push({ id: clientId, res });
    console.log(`[SSE] Display verbunden. Aktive Displays: ${clients.length}`);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
        console.log(`[SSE] Display getrennt. Verbleibende Displays: ${clients.length}`);
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


// --- DYNAMISCHES WIDGET SYSTEM ---
app.get('/widget/:name', (req, res) => {
    const widgetName = req.params.name;
    const filePath = path.join(__dirname, 'public', 'widgets', `${widgetName}.html`);

    if (fs.existsSync(filePath)) {
        const htmlContent = fs.readFileSync(filePath, 'utf8');
        sendToClients({ action: 'show-widget', html: htmlContent, name: widgetName });
        res.send(`Widget [${widgetName}] geladen.\n`);
    } else {
        res.status(404).send(`Widget [${widgetName}] nicht gefunden.\n`);
    }
});

app.get('/idle', (req, res) => {
    sendToClients({ action: 'go-idle' });
    res.send("Zurück zum Idle-Screen.\n");
});

// --- 🌙 STANDBY ENPOINT FÜR CURL ---
app.get('/standby', (req, res) => {
    sendToClients({ action: 'toggle-standby' });
    res.send("Standby-Modus getoggelt.\n");
});

// --- TIMER STEUERUNGEN ---
app.get('/timer/set/:value', (req, res) => {
    sendToClients({ action: 'timer-set', value: req.params.value });
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

// --- REMINDER SYSTEM ---
app.get('/reminder', (req, res) => {
    const text = req.query.text || "Kein Text angegeben";
    const stufe = req.query.stufe || 1;

    sendToClients({
        action: "show-reminder",
        text: text,
        stufe: parseInt(stufe)
    });

    res.send(`Reminder der Stufe ${stufe} gesendet.\n`);
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


// --- SPOTIFY INTEGRATION ---
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/callback';
let SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

let cachedTopTracks = [];

app.get('/spotify/login', (req, res) => {
    const scopes = 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-top-read';
    res.redirect('https://accounts.spotify.com/authorize' +
        '?response_type=code' +
        '&client_id=' + SPOTIFY_CLIENT_ID +
        '&scope=' + encodeURIComponent(scopes) +
        '&redirect_uri=' + encodeURIComponent(SPOTIFY_REDIRECT_URI));
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
    return data.access_token;
}

async function updateTopTracksCache() {
    if (!SPOTIFY_REFRESH_TOKEN) return;
    try {
        const token = await getSpotifyAccessToken();
        const res = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=5&time_range=short_term', {
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
                console.log("🔥 Spotify Top 5 erfolgreich aktualisiert.");
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

    setInterval(async () => {
        if (!SPOTIFY_REFRESH_TOKEN) return;
        try {
            const token = await getSpotifyAccessToken();
            const resPlayback = await fetch('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (resPlayback.status === 204 || resPlayback.status > 400) {
                console.log("ℹ️ Spotify sagt: Kein aktives Gerät oder Wiedergabe pausiert (Status " + resPlayback.status + ")");
                return;
            }

            const playback = await resPlayback.json();
            if (playback && playback.is_playing) {
                let queueData = [];
                try {
                    const resQueue = await fetch('https://api.spotify.com/v1/me/player/queue', {
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                    if (resQueue.status === 200) {
                        const queueJson = await resQueue.json();
                        if (queueJson && queueJson.queue) {
                            queueData = queueJson.queue.slice(0, 4).map(track => ({
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
                    queue: queueData,
                    topTracks: cachedTopTracks
                };
                sendToClients(spotifyData);
            }
        } catch (err) {
            console.error("Spotify-Polling Fehler:", err.message);
        }
    }, 5000); // Intervall korrigiert auf sinnvolle 5 Sekunden statt Max_Int
}

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


// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
    if (SPOTIFY_REFRESH_TOKEN) {
        startSpotifyPolling();
    } else {
        console.log("⚠️ Kein Spotify Token hinterlegt. Bitte /spotify/login aufrufen!");
    }
});