# Project Rules: BlopperBold-PulseOS

## 🧠 Decision-Making & Code Quality

- **Thorough Planning**: Prioritize complete and thorough understanding of the architecture and code interactions before making any edits.
- **Double-Check Everything**: Think carefully about every decision, even if it requires more steps or computational resources. Do not use rushed placeholders or hasty patches.
- **Maintain Code Integrity**: Keep all designs premium, responsive, and aesthetically outstanding (no raw defaults, beautiful colors, gradients, and micro-animations).

## 🧩 Widget-Architektur & JavaScript-Verbot in HTMLs

- **Keine `<script>`-Tags in Widgets**: Da Widgets im `public/widgets/`-Ordner dynamisch vom Client über `innerHTML` geladen werden, führt der Browser darin eingebetteten JavaScript-Code (inline `<script>`-Blöcke) aus Sicherheitsgründen **nicht** aus.
- **Auslagerung in Shells**: JavaScript-Logik für Widgets muss in eigenständigen `.js`-Dateien im Ordner `public/` (z. B. `spotify-wrapped.js`) liegen und statisch in den Host-Dateien [index.html](file:///Users/dev2ktyp/Documents/GitHub/BlopperBold-PulseOS/public/index.html) und [desktop-mode.html](file:///Users/dev2ktyp/Documents/GitHub/BlopperBold-PulseOS/public/desktop-mode.html) eingebunden werden.
- **Widget-Initialisierung**: Die Ausführung der Widget-Logik wird über die Funktion `initDynamicWidget` in [script.js](file:///Users/dev2ktyp/Documents/GitHub/BlopperBold-PulseOS/public/script.js) getriggert, sobald das entsprechende Widget-Element im DOM gefunden wird.

## Sonstiges

Für jedes neue Widget, erstelle ein Widget für den Desktop Mode, wo folgendes passiert:
- Mehr Infos werden angezeigt
- Alle Infos der Widgets auf der Hauptseite werden so auch hier in einer coolen Art angezeigt
- Es wird mehr Interaktionsmöglichkeiten geben
- Die ganze Bildschirmbreite muss benutzt werden

Sei beim Erstellen neuer Widgets immer so kreativ wie möglich. Baue dir eine coole Interaktionsmöglichkeit ein, gib viel Infos aus, etc. Sei immer so Kreativ und geizt nicht mit neuen und coolen Ideen.

## Performance

Daher, dass dieses Projekt sehr viel auf Animationen und CSS basieren, kann die Performance darunter sehr leiden. Versuche immer einen weg zu finden, das die webseite so stabil wie möglich läuft. Verwende z.B. CSS-Animationen anstatt JavaScript-Animationen, wenn es geht. Wenn möglich, baue z.B. eine Funktion ein, die die Animationen stoppt, wenn der Nutzer nicht auf die webseite schaut. (requestAnimationFrame etc.)

Der Maßstab ist folgendes: 
- Google Nest Hub Gen 1: Prozessor: "Amlogic S905D2, ARM Cortex-A53"
- Fire Tablet HD 7 (2022): 4-core ARM Cortex-A35
- Intel HD Graphics 510 (i5 6200u) Gen 6
- RAM: 4GB

Auf diesen Geräten soll folgendes Möglich sein:
- Grafik: Mittel
- FPS: Mindestens über 30 Stabil, Perferabel: 60 Konstant
- Flüssige Animationen und Übergänge

Geräte die nicht stark genug sind, sollen auf einer Art Low-Power Mode laufen. Wo dies nicht so schön ist, aber wenigstens stabil läuft.

Geräte bei denen es bei Grafikeinstellungen Hoch auf konstanten 120fps laufen laut meinen Tests:
- MacBook Pro 14inch M1 Pro 8core CPU 14core GPU 16GB
- Razer Blade 15 (2018) (i7-8750H, GTX 1060 Max-Q)

Der Low-Power Mode soll Folgendes enthalten:
- Leichte Animationen mit Ease-In-Out und längeren Animationszeiten
- Kein Blur
- Kein Gradient

Grafikeinstellungen sind wie folgt:
- Hoch: Alle Animationen, Blur, Gradient, 120fps
- Mittel: Animations: 60fps, Blur: 50% weniger, Gradient: 50% weniger
- Niedrig: Animations: 60fps, Blur: 75% weniger, Gradient: 75% weniger

Achte bitte darauf, das du jede entscheidung überdenkst und daran denkst, das nicht jeder ein Supercomputer besitzt, der die Webseite laufen kann. sie soll zumindestens 60fps auf den Maßstäben der Geräte laufen.

Optimiere bei jedem Prompt den Code ein bisschen, damit die Performance immer leicht besser wird.