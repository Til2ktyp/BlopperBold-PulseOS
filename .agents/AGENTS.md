# Project Rules: BlopperBold-PulseOS

## 🧠 Decision-Making & Code Quality

- **Thorough Planning**: Prioritize complete and thorough understanding of the architecture and code interactions before making any edits.
- **Double-Check Everything**: Think carefully about every decision, even if it requires more steps or computational resources. Do not use rushed placeholders or hasty patches.
- **Maintain Code Integrity**: Keep all designs premium, responsive, and aesthetically outstanding (no raw defaults, beautiful colors, gradients, and micro-animations).

## 🧩 Widget-Architektur & JavaScript-Verbot in HTMLs

- **Keine `<script>`-Tags in Widgets**: Da Widgets im `public/widgets/`-Ordner dynamisch vom Client über `innerHTML` geladen werden, führt der Browser darin eingebetteten JavaScript-Code (inline `<script>`-Blöcke) aus Sicherheitsgründen **nicht** aus.
- **Auslagerung in Shells**: JavaScript-Logik für Widgets muss in eigenständigen `.js`-Dateien im Ordner `public/` (z. B. `spotify-wrapped.js`) liegen und statisch in den Host-Dateien [index.html](file:///Users/dev2ktyp/Documents/GitHub/BlopperBold-PulseOS/public/index.html) und [desktop-mode.html](file:///Users/dev2ktyp/Documents/GitHub/BlopperBold-PulseOS/public/desktop-mode.html) eingebunden werden.
- **Widget-Initialisierung**: Die Ausführung der Widget-Logik wird über die Funktion `initDynamicWidget` in [script.js](file:///Users/dev2ktyp/Documents/GitHub/BlopperBold-PulseOS/public/script.js) getriggert, sobald das entsprechende Widget-Element im DOM gefunden wird.

