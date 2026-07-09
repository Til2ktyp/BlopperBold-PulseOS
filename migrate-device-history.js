const fs = require('fs');
const path = require('path');

const historyFilePath = path.join(__dirname, 'spotify-history.json');
const targetDevice = "AfDBook Pro von Til dem Juden";

if (!fs.existsSync(historyFilePath)) {
    console.error(`Fehler: Datei ${historyFilePath} existiert nicht.`);
    process.exit(1);
}

try {
    const rawData = fs.readFileSync(historyFilePath, 'utf8');
    const history = JSON.parse(rawData);
    
    if (!Array.isArray(history)) {
        console.error('Fehler: Die geladene Historie ist kein Array.');
        process.exit(1);
    }
    
    let updatedCount = 0;
    const migratedHistory = history.map(entry => {
        if (!entry.device) {
            entry.device = targetDevice;
            updatedCount++;
        }
        return entry;
    });
    
    fs.writeFileSync(historyFilePath, JSON.stringify(migratedHistory, null, 4), 'utf8');
    console.log(`Erfolgreich migriert! ${updatedCount} alte Einträge wurden auf das Gerät "${targetDevice}" übertragen.`);
} catch (error) {
    console.error('Fehler bei der Migration:', error);
}
