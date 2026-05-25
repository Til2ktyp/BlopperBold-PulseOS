// reload-hub.js
const { spawn } = require('child_process');
const path = require('path');

let clients = [];

module.exports = {
    // Registriert ein Display, das die Seite offen hat
    registerClient: (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write('\n');
        clients.push(res);

        req.on('close', () => {
            clients = clients.filter(client => client !== res);
        });
    },

    // Löst das Update aus und zwingt ALLE Displays zum Reload
    triggerUpdate: (req, res) => {
        console.log(`[Hub] Stream Deck Verbindung erhalten. Sende Reload an ${clients.length} Displays...`);
        
        // Alle Displays anfunken
        clients.forEach(client => {
            try { client.write("data: reload\n\n"); } catch (e) {}
        });

        // Python-Skript für den Server-Restart im Hintergrund triggern
        const scriptPath = path.join(__dirname, 'updater.py');
        const child = spawn('python', [scriptPath], {
            detached: true,
            stdio: 'ignore',
            cwd: __dirname
        });
        child.unref();

        res.send('Update-Befehl an Server und alle Displays verteilt.');
    }
};