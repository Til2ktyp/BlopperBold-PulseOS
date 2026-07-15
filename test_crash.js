const fs = require('fs');
const path = require('path');

function saveCrashToJson(type, reason, stack) {
    try {
        const crashFile = path.join(__dirname, 'crashes.json');
        let crashes = [];
        if (fs.existsSync(crashFile)) {
            try { crashes = JSON.parse(fs.readFileSync(crashFile, 'utf8')); } catch(e){}
        }
        crashes.push({
            time: new Date().toLocaleString('de-DE'),
            type: type,
            reason: reason,
            stack: stack
        });
        fs.writeFileSync(crashFile, JSON.stringify(crashes, null, 2));
    } catch(e) {
        console.error("WRITE ERROR:", e);
    }
}

process.on('uncaughtException', (err) => {
    console.error('FATAL ERROR (uncaughtException):', err);
    saveCrashToJson('Uncaught Exception', err.message, err.stack || String(err));
    process.exit(1); 
});

setTimeout(() => {
    throw new Error("Test crash");
}, 500);
