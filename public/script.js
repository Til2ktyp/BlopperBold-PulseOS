let idleTimeout;
let standbyTimeout;

const IDLE_TIME = 20 * 1000; // 20 sekunden
const STANDBY_TIME = 5 * 1000; // 5 sekunden nach Idle
const NIGHT_START = 22 * 60 + 30; // 22:30
const NIGHT_END = 6 * 60 + 0; // 6:00

// Helligkeit-Slider Setup (wartet bis DOM geladen ist)
document.addEventListener('DOMContentLoaded', function() {
    // Dashboard Slider (alt)
    const slider = document.getElementById('brightnessSlider');
    const brightnessValue = document.getElementById('brightness-value');
    
    if (slider && brightnessValue) {
        slider.oninput = function() {
            const brightness = this.value / 100;
            brightnessValue.textContent = this.value;
            if (window.AndroidInterface) {
                window.AndroidInterface.setBrightness(brightness);
            }
        };
    }
    
    // Settings Panel Slider
    const panelSlider = document.getElementById('panelBrightnessSlider');
    const panelValue = document.getElementById('panelBrightnessValue');
    
    if (panelSlider && panelValue) {
        panelSlider.oninput = function() {
            const brightness = this.value / 100;
            panelValue.textContent = this.value + '%';
            if (window.AndroidInterface) {
                window.AndroidInterface.setBrightness(brightness);
            }
        };
    }
});

// --- ⚙️ SETTINGS PANEL FUNCTIONS ---
let reloadTimer = null;
let reloadProgress = 0;

function toggleSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    panel.classList.toggle('active');
    document.body.classList.toggle('settings-active');
    console.log('[Settings Panel] Toggle:', panel.classList.contains('active'));
}

function startReloadTimer() {
    reloadProgress = 0;
    const progressBar = document.getElementById('reload-progress');
    
    reloadTimer = setInterval(() => {
        reloadProgress += 3.33; // 100 / 30 (30 iterationen in 3 sekunden)
        if (progressBar) {
            progressBar.style.height = reloadProgress + '%';
        }
        
        if (reloadProgress >= 100) {
            clearInterval(reloadTimer);
            console.log('[Reload] Seite wird neu geladen');
            location.reload();
        }
    }, 100);
}

function cancelReloadTimer() {
    if (reloadTimer) {
        clearInterval(reloadTimer);
        const progressBar = document.getElementById('reload-progress');
        if (progressBar) {
            progressBar.style.height = '0';
        }
        reloadProgress = 0;
    }
}

// --- 🌙 NIGHT MODE AUTO-STANDBY SYSTEM ---
let isNightMode = false;
let lastActivityTime = Date.now();
let standbyDisabled = localStorage.getItem('standby-disabled') === "true"; // Standby-Toggle State

function isCurrentlyNight() {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    // 22:30 bis Mitternacht ODER Mitternacht bis 6:00
    if (currentTime >= NIGHT_START || currentTime < NIGHT_END) {
        return true;
    }
    return false;
}

function updateNightMode() {
    const wasNightMode = isNightMode;
    isNightMode = isCurrentlyNight();
    
    if (wasNightMode !== isNightMode) {
        console.log(`[NightMode] Status: ${isNightMode ? 'AKTIV' : 'INAKTIV'}`);
        
        // Wenn Nachtmodus endet und wir sind im Standby: Standby ausschalten
        if (!isNightMode && document.body.classList.contains('standby-active')) {
            console.log('[NightMode] Nacht vorbei - Standby deaktivieren');
            document.body.classList.remove('standby-active');
        }
        
        // Timer neu starten
        resetIdleTimer();
    }
}

function resetIdleTimer() {
    if (idleTimeout) clearTimeout(idleTimeout);
    if (standbyTimeout) clearTimeout(standbyTimeout);

    lastActivityTime = Date.now();

    // Alles wieder normal anzeigen
    document.body.classList.remove('standby-active');

    // Nur nachts aktiv UND wenn Standby nicht deaktiviert ist
    if (isNightMode && standbyDisabled) {

        // Erst Idle
        idleTimeout = setTimeout(() => {
            console.log('[Idle] Wechsel zu Idle-Screen');

            document.body.classList.remove('widget-active');
            document.getElementById('spotify-widget').classList.remove('active');

            // Danach Standby Timer starten
            standbyTimeout = setTimeout(() => {
                console.log('[Standby] Standby aktivieren');

                document.body.classList.add('standby-active');

            }, STANDBY_TIME);

        }, IDLE_TIME);
    }
}

function wakeDisplay(reason = 'unknown', force = false) {
    // Nur nachts automatisch aufwecken (wenn nicht deaktiviert)
    if ((!isNightMode || standbyDisabled) && !force) return;

    console.log(`[Wake] Display geweckt durch: ${reason}`);

    // Standby deaktivieren
    if (document.body.classList.contains('standby-active')) {
        document.body.classList.remove('standby-active');
    }

    // Idle-Timer resetten
    resetIdleTimer();
}

// Benutzeraktivität erkennen
function setupActivityListeners() {
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'click'];
    
    events.forEach(event => {
        document.addEventListener(event, () => {
            const timeSinceLastActivity = Date.now() - lastActivityTime;
            
            // Nur bei echten Aktivitäten (nicht sofort nach letzter)
            if (timeSinceLastActivity > 500) {
                console.log('[Activity] Benutzerinteraktion erkannt');
                lastActivityTime = Date.now();
                
                // Aus Standby aufwachen
                if (document.body.classList.contains('standby-active')) {
                    console.log('[Activity] Standby deaktivieren');
                    document.body.classList.remove('standby-active');
                }
                
                // Timer resetten (nur nachts)
                resetIdleTimer();
            }
        }, { passive: true });
    });
}

// Nachtmodus alle 30 Sekunden prüfen
setInterval(updateNightMode, 30000);
updateNightMode(); // Initial check

// --- 🎵 WIDGET OPENING ---
function openWidget(widgetName) {
    console.log(`[openWidget] ${widgetName}`);
    toggleSettingsPanel(); // Panel schließen
    
    setTimeout(async () => {
        try {
            const widgetFile = (widgetName === 'spotify') ? 'spotify.html' : `${widgetName}.html`;
            const response = await fetch(`/widgets/${widgetFile}`);
            const html = await response.text();
            
            const slotA = document.getElementById('widget-slot-a');
            const slotB = document.getElementById('widget-slot-b');
            const nextSlot = (currentSlot === 'a') ? slotB : slotA;
            const activeSlot = (currentSlot === 'a') ? slotA : slotB;
            
            nextSlot.innerHTML = html;
            document.getElementById('spotify-widget').classList.remove('active');
            
            if (document.body.classList.contains('widget-active')) {
                activeSlot.classList.remove('slot-active');
                nextSlot.classList.add('slot-active');
            } else {
                slotA.classList.remove('slot-active');
                slotB.classList.remove('slot-active');
                nextSlot.classList.add('slot-active');
                document.body.classList.add('widget-active');
            }
            
            currentSlot = (currentSlot === 'a') ? 'b' : 'a';
            
            const backBtn = document.getElementById('status-back-btn');
            if (backBtn) backBtn.style.display = 'block';
            
            console.log(`[Widget] ${widgetName} geöffnet`);
        } catch (error) {
            console.error(`[Widget] Fehler beim Laden ${widgetName}:`, error);
        }
    }, 150);
}

function closeWidget() {
    document.body.classList.remove('widget-active');
    const slotA = document.getElementById('widget-slot-a');
    const slotB = document.getElementById('widget-slot-b');
    slotA.innerHTML = '';
    slotB.innerHTML = '';
    slotA.classList.remove('slot-active');
    slotB.classList.remove('slot-active');
    
    const backBtn = document.getElementById('status-back-btn');
    if (backBtn) backBtn.style.display = 'none';
    
    console.log('[Widget] Geschlossen');
}

// --- 📺 DISPLAY ID & CONFIGURATION ---
let displayId = localStorage.getItem('display-id') || null;
let displayName = localStorage.getItem('display-name') || 'Unknown';

let lat = localStorage.getItem('hub-lat') || '53.5653';
let lon = localStorage.getItem('hub-lon') || '11.3653';
let locName = localStorage.getItem('hub-city') || 'Pampow';
let clockSize = localStorage.getItem('hub-clock-size') || '11';

document.documentElement.style.setProperty('--clock-size', clockSize + 'rem');

// --- 🎬 ANIMATIONS QUALITY DETECTION & APPLICATION ---
let animationQuality = localStorage.getItem('animation-quality') || 'auto';

async function initAnimationQuality() {
    try {
        const response = await fetch('/quality/animations');
        const data = await response.json();
        animationQuality = data.quality || 'high';
        
        // Auto-detect für Low-Power-Devices
        if (animationQuality === 'auto') {
            animationQuality = await detectDeviceCapability() ? 'high' : 'low';
        }
        
        applyAnimationQuality(animationQuality);
        localStorage.setItem('animation-quality', animationQuality);
        console.log(`[Animations] Quality-Mode: ${animationQuality}`);
    } catch (e) {
        console.warn("[Animations] Fehler beim Abrufen der Quality, nutze Default:", e);
        applyAnimationQuality('high');
    }
}

function detectDeviceCapability() {
    // Prüfe GPU-Kapazität via WebGL
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return false;
        
        const renderer = gl.getParameter(gl.RENDERER);
        const vendor = gl.getParameter(gl.VENDOR);
        
        // Low-Power-Devices erkennen
        const lowPowerIndicators = ['Mali', 'Adreno', 'PowerVR', 'Apple A8', 'A9', 'Intel HD Graphics 4000'];
        const isLowPower = lowPowerIndicators.some(indicator => 
            renderer.includes(indicator) || vendor.includes(indicator)
        );
        
        return !isLowPower;
    } catch (e) {
        return true; // Fallback zu High-Quality wenn WebGL nicht verfügbar
    }
}

function applyAnimationQuality(quality) {
    document.body.classList.remove('animation-high', 'animation-medium', 'animation-low');
    
    if (quality === 'high') {
        document.body.classList.add('animation-high');
    } else if (quality === 'medium') {
        document.body.classList.add('animation-medium');
    } else if (quality === 'low') {
        document.body.classList.add('animation-low');
    }
}

// Initialize animations beim Load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnimationQuality);
} else {
    initAnimationQuality();
}

function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    
    document.getElementById('clock').textContent = timeStr;
    document.getElementById('status-time').textContent = timeStr;
    document.getElementById('status-date').textContent = now.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '');
}

setTimeout(() => {
    updateClock();
    setInterval(updateClock, 1000);
}, 1000);

// --- 🚀 LOADING SCREEN LOGIC ---
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    
    const randomValue = Math.random();
    let totalLoadTime;
    
    if (randomValue < 0.005) {
        totalLoadTime = 20000;
    } else {
        totalLoadTime = Math.random() * 3000 + 4000; //3000 + 4000
    }
    
    const stage2Delay = Math.random() * 200 + 400;
    
    setTimeout(() => {
        // const subtitle = document.querySelector('.loading-subtitle');
        const barContainer = document.querySelector('.loading-bar-container');
        const loadingBar = document.querySelector('.loading-bar');
        
        // subtitle.classList.add('show');
        barContainer.classList.add('show');
        
        const remainingTime = totalLoadTime - stage2Delay;
        loadingBar.style.animationDuration = remainingTime + 'ms';
    }, stage2Delay);

    setTimeout(showInitToast, totalLoadTime - 1000);
    
    setTimeout(() => {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => {
            loadingScreen.style.display = 'none';
            fetchWeather();
        }, 1600);
    }, totalLoadTime);
}

function showInitToast() {
    const initToast = document.getElementById('init-toast');
    initToast.classList.add('init-show');
    
    fetchWeather();
    
    setTimeout(() => {
        initToast.classList.remove('init-show');
        initToast.classList.add('init-hide');
        
        setTimeout(() => {
            initToast.classList.remove('init-hide');
        }, 500);
    }, 6200);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideLoadingScreen);
} else {
    hideLoadingScreen();
}

// Setup night mode and activity detection
setupActivityListeners();

async function fetchWeather() {
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const data = await res.json();
        const temp = Math.round(data.current_weather.temperature);
        
        document.getElementById('weather').innerHTML = `☁️ ${temp}°C · ${locName}`;
        document.getElementById('status-weather').innerHTML = `☁️ ${temp}°C`;
    } catch (e) { console.log("Wetter Fehler"); }
}

setInterval(fetchWeather, 30 * 60 * 1000);

// --- 🔔 REMINDER SCHEDULER ---
function checkScheduledReminders() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');
    const dayName = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][now.getDay()];
    
    scheduledReminders.forEach((reminder, index) => {
        if (!reminder.time || !reminder.days) return;
        
        const isTimeMatch = reminder.time === currentTime;
        const isDayMatch = reminder.days === 'täglich' || 
                          (reminder.days === 'wöchentlich' && reminder.dayName === dayName) ||
                          reminder.days === '';
        
        if (isTimeMatch && isDayMatch && !reminder.lastTriggered) {
            console.log('[Reminder] Triggering:', reminder.text);
            
            // Show reminder popup
            const reminderPopup = document.getElementById('reminder-popup');
            if (reminderPopup) {
                document.getElementById('reminder-label-text').textContent = `🔔 Erinnerung - Level ${reminder.level}`;
                document.getElementById('reminder-content').textContent = reminder.text;
                reminderPopup.classList.add('reminder-show');
                wakeDisplay('reminder-triggered', true);
                
                // Mark as triggered for this minute
                reminder.lastTriggered = now.getTime();
                setTimeout(() => {
                    reminder.lastTriggered = null;
                }, 60000);
            }
        }
    });
}

// Scheduled Reminders speichern
let scheduledReminders = JSON.parse(localStorage.getItem('scheduled-reminders') || '[]');

// Check reminders every minute
setInterval(checkScheduledReminders, 60000);
checkScheduledReminders(); // Initial check

// --- AUTARKE FRONTEND-ENGINE ---
let timerInterval, timerTime = 0, timerRunning = false;
let timerName = 'Timer'; // Timer-Name für Anzeige
let swInterval, swTime = 0, swRunning = false, swStartTime = 0;

let lastTrackId = null;
let spotifySemiTimeout = null;
let isSpotifyForcedHidden = false; 

let spotifyMode = 'immer';

let spotifyProgressInterval = null;
let spotifyCurrentProgress = 0;
let spotifyCurrentDuration = 0;
let spotifyLastUpdate = 0;

function formatTime(seconds) {
    const isNegative = seconds < 0;
    const absoluteSeconds = Math.abs(seconds);
    const m = Math.floor(absoluteSeconds / 60).toString().padStart(2, '0');
    const s = (absoluteSeconds % 60).toString().padStart(2, '0');
    return `${isNegative ? '-' : ''}${m}:${s}`;
}

function formatStopwatch(ms) {
    const m = Math.floor(ms / 60000).toString().padStart(2, '0');
    const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    const d = Math.floor((ms % 1000) / 100);
    return `${m}:${s}.${d}`;
}

function formatMs(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function showPopup(elementId) {
    const el = document.getElementById(elementId);
    el.style.display = 'block';
    el.classList.remove('popup-hide');
    setTimeout(() => { el.classList.add('popup-show'); }, 10);
}

function hidePopup(elementId) {
    const el = document.getElementById(elementId);
    el.classList.remove('popup-show');
    el.classList.add('popup-hide');
    setTimeout(() => {
        if (el.classList.contains('popup-hide')) {
            el.style.display = 'none';
            el.classList.remove('popup-hide');
        }
    }, 300);
}

function toggleTodo(index) {
  fetch(`/todo/toggle?index=${index}`)
  .catch(e => console.error("To-Do Update Fehler:", e));
}

function clearDoneTodos(event) {
    event.stopPropagation(); 
    fetch('/todo/clear')
        .then(response => {
            if (!response.ok) throw new Error('Server-Fehler beim Löschen');
            console.log("Erledigte Items erfolgreich gelöscht.");
        })
        .catch(e => console.error("Fehler beim Aufräumen der Liste:", e));
}

function localTimerReset() {
    clearInterval(timerInterval);
    timerRunning = false;
    timerTime = 0;
    
    const tPopup = document.getElementById('timer-popup');
    tPopup.classList.remove('timer-alarm', 'popup-show');
    tPopup.classList.add('popup-hide');
    
    document.getElementById('timer-display').textContent = "00:00";
    timerName = 'Timer'; // Reset to default
    document.getElementById('timer-label-text').textContent = "⏱️ Timer";
    
    setTimeout(() => {
        if (tPopup.classList.contains('popup-hide')) {
            tPopup.style.display = 'none';
            tPopup.classList.remove('popup-hide');
        }
    }, 300);

    fetch('/timer/reset').catch(e => console.error("Reset Fehler:", e));
}

function closeAdhsPopup() { document.getElementById('adhs-overlay').classList.remove('active'); }

function getSerial() {
    document.getElementById('serial');
}

// --- 🎵 SPOTIFY CACHE FUNCTIONS ---
function loadSpotifyCacheFromStorage() {
    const cached = localStorage.getItem('spotify-cache');
    if (cached) {
        try {
            const data = JSON.parse(cached);
            console.log('[Spotify Cache] Geladen aus localStorage');
            return data;
        } catch (e) {
            console.error('[Spotify Cache] Fehler beim Laden:', e);
            return null;
        }
    }
    return null;
}

function saveSpotifyCacheToStorage(data) {
    try {
        localStorage.setItem('spotify-cache', JSON.stringify(data));
        console.log('[Spotify Cache] Gespeichert in localStorage');
    } catch (e) {
        console.error('[Spotify Cache] Fehler beim Speichern:', e);
    }
}

let selectedDate = new Date();
let currentDate = new Date();
let events = JSON.parse(localStorage.getItem('calendar-events') || '{}');

// Kalender rendern
function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    // Update header
    document.getElementById('current-month').textContent = 
        currentDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    
    // First day of month & number of days
    const firstDay = new Date(year, month, 1).getDay() || 7; // 1-7 (Mo-So)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    
    const calendarDays = document.getElementById('calendar-days');
    calendarDays.innerHTML = '';
    
    // Previous month days
    for (let i = firstDay - 1; i > 0; i--) {
        const day = daysInPrevMonth - i + 1;
        const cell = createDayCell(day, true);
        calendarDays.appendChild(cell);
    }
    
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const cell = createDayCell(day, false);
        calendarDays.appendChild(cell);
    }
    
    // Next month days
    const totalCells = calendarDays.children.length;
    const remainingCells = 42 - totalCells; // 6 weeks * 7 days
    for (let day = 1; day <= remainingCells; day++) {
        const cell = createDayCell(day, true);
        calendarDays.appendChild(cell);
    }
}

function createDayCell(day, isOtherMonth) {
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (isOtherMonth) cell.classList.add('other-month');
            
    const dateStr = formatDateString(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
    const today = formatDateString(new Date());
            
    if (dateStr === today && !isOtherMonth) {
        cell.classList.add('today');
    }
            
    if (events[dateStr] && events[dateStr].length > 0) {
        cell.classList.add('has-event');
    }
    
    cell.innerHTML = `<span class="day-number">${day}</span>`;
    if (events[dateStr] && events[dateStr].length > 0) {
        cell.innerHTML += '<div class="event-dot"></div>';
    }
            
    cell.addEventListener('click', () => selectDate(day, isOtherMonth));
    return cell;
}

function formatDateString(date) {
    return date.toISOString().split('T')[0];
}

function selectDate(day, isOtherMonth) {
    if (isOtherMonth) {
        if (day < 15) {
            currentDate.setMonth(currentDate.getMonth() + 1);
        } else {
            currentDate.setMonth(currentDate.getMonth() - 1);
        }
    }
    selectedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    renderCalendar();
    updateEventList();
}

function updateEventList() {
    const dateStr = formatDateString(selectedDate);
    const dayName = selectedDate.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('selected-date').textContent = dayName;
    
    const eventList = document.getElementById('event-list');
    const dayEvents = events[dateStr] || [];
    
    if (dayEvents.length === 0) {
        eventList.innerHTML = '<div class="no-events">Keine Termine für diesen Tag</div>';
        return;
    }
    
    eventList.innerHTML = dayEvents.map(event => `
        <div class="event-item">
            <div class="event-time">${event.time || '--:--'}</div>
            <div class="event-title">${event.title}</div>
            ${event.location ? `<div class="event-location">📍 ${event.location}</div>` : ''}
        </div>
    `).join('');
}

// Navigation
const prevMonthBtn = document.getElementById('btn-prev-month');
const nextMonthBtn = document.getElementById('btn-next-month');
const todayBtn = document.getElementById('btn-today');

if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
}

if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });
}

if (todayBtn) {
    todayBtn.addEventListener('click', () => {
        currentDate = new Date();
        selectedDate = new Date();
        renderCalendar();
        updateEventList();
    });
}

// Update last sync time
function updateSyncTime() {
    const now = new Date();
    const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    document.getElementById('last-sync').textContent = `${time} ${date}`;
}

// Initial render nur wenn Kalender-Widget existiert
const isCalendarWidget =
    document.getElementById('calendar-days') &&
    document.getElementById('current-month') &&
    document.getElementById('event-list');

if (isCalendarWidget) {
    renderCalendar();
    updateEventList();
    updateSyncTime();

    // Sync every hour
    setInterval(updateSyncTime, 60 * 60 * 1000);
}

// Example events (test data)
function addTestEvents() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    events[formatDateString(today)] = [
        { time: '10:00', title: 'Team Meeting', location: 'Besprechungsraum' },
        { time: '14:30', title: 'Projekt Review' }
    ];
    
    events[formatDateString(tomorrow)] = [
        { time: '09:00', title: 'Client Call' }
    ];
    
    localStorage.setItem('calendar-events', JSON.stringify(events));
    renderCalendar();
}

// Uncomment to add test events
// addTestEvents();

function applySpotifyData(data) {
    if (!data) {
        console.log('[Spotify] Keine Daten zu applizieren');
        return;
    }
    
    console.log('[Spotify] Appliziere Daten:', data.title, '-', data.artist);
    
    // Update Track-Info (Main Widget)
    const trackTitle = document.getElementById('track-title');
    const trackArtist = document.getElementById('track-artist');
    const trackCover = document.getElementById('track-cover');
    const trackProgress = document.getElementById('track-progress');
    
    if (trackTitle) trackTitle.textContent = data.title || '';
    if (trackArtist) trackArtist.textContent = data.artist || '';
    if (trackCover && data.albumImg) trackCover.src = data.albumImg;
    
    if (data.progress !== undefined && data.duration !== undefined) {

        spotifyCurrentProgress = data.progress;
        spotifyCurrentDuration = data.duration;
        spotifyLastUpdate = Date.now();

        updateSpotifyProgressBars();

        if (spotifyProgressInterval) {
            clearInterval(spotifyProgressInterval);
        }

        spotifyProgressInterval = setInterval(() => {
            spotifyCurrentProgress += 1000;

            if (spotifyCurrentProgress > spotifyCurrentDuration) {
                spotifyCurrentProgress = spotifyCurrentDuration;
            }

            updateSpotifyProgressBars();

        }, 1000);
    }

    // Update Dashboard (spotify.html)
    const dashTitle = document.getElementById('dash-track-title');
    if (dashTitle) {
        document.getElementById('dash-track-title').textContent = data.title || '';
        document.getElementById('dash-track-artist').textContent = data.artist || '';
        const dashCover = document.getElementById('dash-track-cover');
        if (dashCover && data.albumImg) dashCover.src = data.albumImg;
        document.getElementById('dash-time-current').textContent = formatMs(data.progress || 0);
        document.getElementById('dash-time-total').textContent = formatMs(data.duration || 0);
        
        if (data.progress !== undefined && data.duration !== undefined) {
            const progressPercent = (data.progress / data.duration) * 100;
            document.getElementById('dash-progress').style.width = `${progressPercent}%`;
        }
    
        const queueContainer = document.getElementById('dash-queue');
        if (queueContainer) {
            if (data.queue && Array.isArray(data.queue) && data.queue.length > 0) {
                queueContainer.innerHTML = data.queue.slice(0, 4).map(t => `
                    <div class="queue-item">
                        <div class="top-track-meta queue-meta">
                            <div class="top-track-name" style="font-size: 1.1rem; font-weight: 600;">${t.title || 'Unbekannter Titel'}</div>
                            <div class="top-track-artist" style="font-size: 0.9rem; color: rgba(255,255,255,0.5);">${t.artist || 'Unbekannter Interpret'}</div>
                        </div>
                    </div>
                `).join('');
            }
        }
    
        const topContainer = document.getElementById('dash-top-tracks');
        if (topContainer && data.topTracks && Array.isArray(data.topTracks) && data.topTracks.length > 0) {
            topContainer.innerHTML = data.topTracks.slice(0, 10).map((t, idx) => `
                <div class="top-track-item" style="display: flex; align-items: center; gap: 15px; background: rgba(255, 255, 255, 0.02); padding: 10px 14px; border-radius: 16px; margin-bottom: 8px;">
                    <div class="top-track-rank" style="font-size: 1.1rem; font-weight: 700; color: #1db954; width: 25px; text-align: center;">${idx + 1}</div>
                    ${t.albumImg ? `<img class="top-track-img" src="${t.albumImg}" alt="Cover" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover;">` : ''}
                    <div class="top-track-meta" style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                        <div class="top-track-name" style="font-size: 1rem; font-weight: 600; text-overflow: ellipsis; overflow: hidden;">${t.title}</div>
                        <div class="top-track-artist" style="font-size: 0.85rem; color: rgba(255,255,255,0.5); text-overflow: ellipsis; overflow: hidden;">${t.artist}</div>
                    </div>
                </div>
            `).join('');
        }
    }
}

function updateSpotifyProgressBars() {
    const progressPercent =
        (spotifyCurrentProgress / spotifyCurrentDuration) * 100;

    // Main Widget
    const trackProgress = document.getElementById('track-progress');

    if (trackProgress) {
        trackProgress.style.width = `${progressPercent}%`;
    }

    // Dashboard
    const dashProgress = document.getElementById('dash-progress');

    if (dashProgress) {
        dashProgress.style.width = `${progressPercent}%`;
    }

    // Zeiten Dashboard
    const currentTime = document.getElementById('dash-time-current');

    if (currentTime) {
        currentTime.textContent = formatMs(spotifyCurrentProgress);
    }
}

// Lade Spotify-Cache aus localhost direkt
async function initSpotifyCache() {
    console.log('[Spotify] Lade spotify-cache.json...');
    
    try {
        const response = await fetch('/spotify-cache.json');
        const data = await response.json();
        
        if (data && data.currentPlayback) {
            console.log('[Spotify] Daten geladen:', data.currentPlayback.title);
            applySpotifyData(data.currentPlayback);
            saveSpotifyCacheToStorage(data.currentPlayback);
        }
    } catch (e) {
        console.error('[Spotify] Fehler beim Laden von spotify-cache.json:', e);
    }
}

async function fetchSpotifyDataWithRetry(attempt = 1) {
    try {
        console.log(`[Spotify] Fetch Versuch ${attempt}/5...`);
        const response = await fetch('/spotify-cache.json');
        const data = await response.json();
        console.log('[Spotify] Server antwortet:', data);
        
        // Prüfe ob echte Daten vorhanden sind (nicht nur Fallback)
        if (data && data.title && data.title !== 'Keine Wiedergabe aktiv' && data.title !== 'Warte auf erste Wiedergabe') {
            console.log('[Spotify] ✓ Gültige Daten vom Server erhalten!');
            applySpotifyData(data);
            saveSpotifyCacheToStorage(data);
            return; // Erfolgreich!
        } else {
            // Keine echten Daten - versuche später nochmal
            if (attempt < 5) {
                console.log(`[Spotify] Noch keine Daten, versuche in 1s nochmal...`);
                setTimeout(() => fetchSpotifyDataWithRetry(attempt + 1), 1000);
            } else {
                console.log('[Spotify] Max Versuche erreicht, verwende Fallback');
            }
        }
    } catch (e) {
        console.error('[Spotify Cache] Fehler beim Abrufen vom Server:', e);
        if (attempt < 5) {
            setTimeout(() => fetchSpotifyDataWithRetry(attempt + 1), 1000);
        }
    }
}

const eventSource = new EventSource('/events');
let currentSlot = 'a';

// Initialisiere Spotify-Cache beim Start
initSpotifyCache();

eventSource.onmessage = function(event) {
    try {
        if (event.data === 'reload') {
            console.log('Server meldet Update. Schließe Event-Stream...');
            eventSource.close(); 
            console.log('Lade in 5 Sekunden neu...');
            setTimeout(() => {
                window.location.reload();
            }, 5000);
            return;
        }
        
        const data = JSON.parse(event.data);
        if (!data || !data.action) return;
        
        // --- 📺 DISPLAY INITIALIZATION ---
        if (data.action === 'init-display') {
            displayId = data.displayId;
            displayName = data.name;
            animationQuality = data.quality || 'auto';
            
            localStorage.setItem('display-id', displayId);
            localStorage.setItem('display-name', displayName);
            localStorage.setItem('animation-quality', animationQuality);
            
            console.log(`[Display] Initialisiert - ID: ${displayId} | Name: ${displayName} | Quality: ${animationQuality}`);
            
            // Auto-detect für Low-Power-Devices wenn auto
            if (animationQuality === 'auto') {
                animationQuality = detectDeviceCapability() ? 'high' : 'low';
            }
            
            applyAnimationQuality(animationQuality);
            return;
        }
        
        // --- 🎬 ANIMATIONS QUALITY CHANGED ---
        if (data.action === 'animation-quality-changed') {
            animationQuality = data.quality;
            applyAnimationQuality(animationQuality);
            localStorage.setItem('animation-quality', animationQuality);
            console.log(`[Animations] Quality geändert zu: ${animationQuality}`);
            return;
        }

        // --- 🔥 STREAM DECK POPUP TOGGLE LOGIK ---
        if (data.action === 'toggle-popup') {
            const target = data.target;

            const toggleStandardPopup = (element, forceVisible) => {
                if (!element) return;
                if (forceVisible !== undefined) {
                    if (forceVisible) {
                        element.style.display = 'block';
                        setTimeout(() => { element.classList.remove('popup-hide'); element.classList.add('popup-show'); }, 10);
                    } else {
                        element.classList.remove('popup-show'); element.classList.add('popup-hide');
                        setTimeout(() => { if (element.classList.contains('popup-hide')) element.style.display = 'none'; }, 300);
                    }
                } else {
                    if (element.style.display === 'none' || element.classList.contains('popup-hide') || !element.classList.contains('popup-show')) {
                        element.style.display = 'block';
                        setTimeout(() => { element.classList.remove('popup-hide'); element.classList.add('popup-show'); }, 10);
                    } else {
                        element.classList.remove('popup-show'); element.classList.add('popup-hide');
                        setTimeout(() => { if (element.classList.contains('popup-hide')) element.style.display = 'none'; }, 300);
                    }
                }
            };

            if (target === 'alle') {
                const isVisible = data.visible;
                isSpotifyForcedHidden = !isVisible; 
                toggleStandardPopup(document.getElementById('timer-popup'), isVisible);
                toggleStandardPopup(document.getElementById('stopwatch-popup'), isVisible);
                
                const spotifyWidget = document.getElementById('spotify-widget');
                if (!isVisible) {
                    spotifyWidget.classList.remove('active');
                    clearTimeout(spotifySemiTimeout);
                }
                
                const todoWidget = document.querySelector('.todo-widget-content');
                if (todoWidget && todoWidget.parentElement) {
                    todoWidget.parentElement.style.display = isVisible ? 'block' : 'none';
                }
            } 
            else if (target === 'spotify') {
                if (data.mode) {
                    spotifyMode = data.mode;
                    console.log("Spotify-Modus gesetzt auf:", spotifyMode);
                } else {
                    if (spotifyMode === 'aus') {
                        spotifyMode = 'immer';
                        console.log("Spotify-Modus: IMMER");
                    } else if (spotifyMode === 'immer') {
                        spotifyMode = 'semi';
                        console.log("Spotify-Modus: SEMI (10s)");
                    } else {
                        spotifyMode = 'aus';
                        console.log("Spotify-Modus: AUS");
                    }
                }
                
                const toast = document.getElementById('mode-toast');
                const modeText = spotifyMode.charAt(0).toUpperCase() + spotifyMode.slice(1);
                
                toast.textContent = `🎵 Spotify: ${modeText === 'Aus' ? 'Aus' : modeText}`;
                
                if (window.toastTimeout) clearTimeout(window.toastTimeout);
                
                toast.classList.add('toast-show');
                
                window.toastTimeout = setTimeout(() => {
                    toast.classList.remove('toast-show');
                }, 2500);

                const spotifyWidget = document.getElementById('spotify-widget');
                if (spotifyMode === 'aus') {
                    spotifyWidget.classList.remove('active');
                    clearTimeout(spotifySemiTimeout);
                } else if (spotifyMode === 'immer') {
                    spotifyWidget.classList.add('active');
                    clearTimeout(spotifySemiTimeout);
                    document.getElementById('spotify-semi-countdown').style.transform = 'scaleX(0)';
                } else if (spotifyMode === 'semi') {
                    lastTrackId = null; 
                    spotifyWidget.classList.remove('active');
                }
            }
        }



        // --- SPOTIFY SSE LOGIK ---
        if (data.action === 'spotify-playing') {
            // Speichere in localStorage für späteren Zugriff
            saveSpotifyCacheToStorage(data);
            
            // Wende Daten an
            applySpotifyData(data);
        
            const spotifyWidget = document.getElementById('spotify-widget');
            const countdownBar = document.getElementById('spotify-semi-countdown');
            const currentTrackIdentifier = data.title + data.artist;
        
            if (spotifyMode === 'aus' || isSpotifyForcedHidden || document.body.classList.contains('widget-active')) {
                spotifyWidget.classList.remove('active');
                clearTimeout(spotifySemiTimeout);
            } 
            else if (spotifyMode === 'immer') {
                spotifyWidget.classList.add('active');
                clearTimeout(spotifySemiTimeout);
                countdownBar.style.transform = 'scaleX(0)'; 
            } 
            else if (spotifyMode === 'semi') {
                if (currentTrackIdentifier !== lastTrackId) {
                    lastTrackId = currentTrackIdentifier;
                    
                    spotifyWidget.classList.add('active');
                    
                    countdownBar.style.transition = 'none';
                    countdownBar.style.transform = 'scaleX(1)';
                    
                    setTimeout(() => {
                        countdownBar.style.transition = 'transform 10s linear';
                        countdownBar.style.transform = 'scaleX(0)';
                    }, 50);
        
                    clearTimeout(spotifySemiTimeout);
                    spotifySemiTimeout = setTimeout(() => {
                        if (spotifyMode === 'semi') {
                            spotifyWidget.classList.remove('active');
                        }
                    }, 10050);
                }
            };
        };

        // --- REMINDER & WIDGET LOGIK ---
        if (data.action === 'show-widget') {
            wakeDisplay('widget');
            const slotA = document.getElementById('widget-slot-a');
            const slotB = document.getElementById('widget-slot-b');
            const nextSlot = (currentSlot === 'a') ? document.getElementById('widget-slot-b') : document.getElementById('widget-slot-a');
            const activeSlot = (currentSlot === 'a') ? document.getElementById('widget-slot-a') : document.getElementById('widget-slot-b');
            nextSlot.innerHTML = data.html || '';
            
            document.getElementById('spotify-widget').classList.remove('active');
            clearTimeout(spotifySemiTimeout);

            if (document.body.classList.contains('widget-active')) {
                activeSlot.classList.remove('slot-active');
                nextSlot.classList.add('slot-active');
            } else {
                slotA.classList.remove('slot-active'); slotB.classList.remove('slot-active');
                nextSlot.classList.add('slot-active');
                document.body.classList.add('widget-active');
            }
            currentSlot = (currentSlot === 'a') ? 'b' : 'a';
            
            // Zurück-Button anzeigen
            const backBtn = document.getElementById('status-back-btn');
            if (backBtn) backBtn.style.display = 'block';
        }
        
        if (data.action === 'go-idle') { 
            document.body.classList.remove('widget-active'); 
            document.getElementById('spotify-widget').classList.remove('active');
            const backBtn = document.getElementById('status-back-btn');
            if (backBtn) backBtn.style.display = 'none';
        }

        if (data.action === 'toggle-standby') {
            wakeDisplay('toggle-standby', true);
            document.body.classList.remove('widget-active');
            document.getElementById('spotify-widget').classList.remove('active');
            const backBtn = document.getElementById('status-back-btn');
            if (backBtn) backBtn.style.display = 'none';
            
            document.body.classList.toggle('standby-active');
            console.log("Standby-Modus getoggelt. Aktiv:", document.body.classList.contains('standby-active'));
        }

        if (data.action === 'show-reminder') {
            wakeDisplay('reminder');
            const level = parseInt(data.stufe) || 1;
            
            // If it has time/days info, save as scheduled reminder
            if (data.time || data.days) {
                const newReminder = {
                    text: data.text,
                    level: level,
                    time: data.time || null,
                    days: data.days || '',
                    dayName: data.dayName || null,
                    lastTriggered: null
                };
                scheduledReminders.push(newReminder);
                localStorage.setItem('scheduled-reminders', JSON.stringify(scheduledReminders));
                console.log('[Reminder] Saved scheduled reminder:', newReminder);
            }
            
            if (level === 3) {
                document.getElementById('adhs-message-text').textContent = data.text || 'Aufstehen!';
                document.getElementById('adhs-overlay').classList.add('active');
            } else {
                const rPopup = document.getElementById('reminder-popup');
                document.getElementById('reminder-content').textContent = data.text || '';
                rPopup.classList.remove('lvl-1', 'lvl-2');
                rPopup.classList.add(`lvl-${level}`);
                document.getElementById('reminder-label-text').textContent = (level === 1) ? '📌 Info' : '🔔 Reminder';
                showPopup('reminder-popup');
                setTimeout(() => { hidePopup('reminder-popup'); }, 10000);
            }
        }

        // --- TIMER ENGINE ---
        if (data.action.startsWith('timer-')) {
            const action = data.action.replace('timer-', '');
            const tPopup = document.getElementById('timer-popup');

            if (action === 'set') {
                clearInterval(timerInterval);
                timerRunning = false;
                tPopup.classList.remove('timer-alarm', 'popup-hide', 'popup-show');
                timerName = data.name || 'Timer'; // Use timer name from server
                document.getElementById('timer-label-text').textContent = `⏱️ ${timerName}`;
                timerTime = parseInt(data.value) || 0;
                document.getElementById('timer-display').textContent = formatTime(timerTime);
                showPopup('timer-popup');
            }
            else if (action === 'adjust') {
                let modifier = data.unit === 'min' ? 60 : 1;
                timerTime += (data.amount * modifier);
                document.getElementById('timer-display').textContent = formatTime(timerTime);
                showPopup('timer-popup');
                if (timerTime > 0) {
                    wakeDisplay('timer-finished', true);
                    tPopup.classList.remove('timer-alarm');
                    document.getElementById('timer-label-text').textContent = `⏱️ ${timerName}`;
                }
            }
            else if (action === 'start') {
                tPopup.style.display = 'block';
                tPopup.style.opacity = '1';
                tPopup.classList.remove('popup-hide');
                
                if (!timerRunning) {
                    timerRunning = true;
                    clearInterval(timerInterval);
                    timerInterval = setInterval(() => {
                        timerTime--;
                        document.getElementById('timer-display').textContent = formatTime(timerTime);
                        tPopup.style.display = 'block';
                        tPopup.style.opacity = '1';
                        
                        if (timerTime <= 0) {
                            if (!tPopup.classList.contains('timer-alarm')) {
                                tPopup.classList.add('timer-alarm');
                            }
                            document.getElementById('timer-label-text').textContent = "🚨 ABGELAUFEN";
                        } else {
                            if (tPopup.classList.contains('timer-alarm')) {
                                tPopup.classList.remove('timer-alarm');
                                document.getElementById('timer-label-text').textContent = `⏱️ ${timerName}`;
                            }
                        }
                    }, 1000);
                }
            }
            else if (action === 'stop') {
                clearInterval(timerInterval);
                timerRunning = false;
                tPopup.style.display = 'block';
                tPopup.style.opacity = '1';
            }
            else if (action === 'reset') {
                clearInterval(timerInterval);
                timerRunning = false;
                timerTime = 0;
                timerName = 'Timer'; // Reset to default
                
                tPopup.classList.remove('timer-alarm', 'popup-show');
                tPopup.classList.add('popup-hide');
                document.getElementById('timer-display').textContent = "00:00";
                document.getElementById('timer-label-text').textContent = "⏱️ Timer";
                
                setTimeout(() => {
                    if (tPopup.classList.contains('popup-hide')) {
                        tPopup.style.display = 'none';
                        tPopup.classList.remove('popup-hide');
                    }
                }, 300);
            }
        }
          
        // --- STOPWATCH LOGIK ---
        if (data.action.startsWith('stopwatch-')) {
            const action = data.action.replace('stopwatch-', '');
            if (action === 'start' && !swRunning) {
                showPopup('stopwatch-popup');
                swRunning = true;
                swStartTime = Date.now() - swTime;
                clearInterval(swInterval);
                swInterval = setInterval(() => {
                    swTime = Date.now() - swStartTime;
                    document.getElementById('stopwatch-display').textContent = formatStopwatch(swTime);
                }, 100);
            }
            else if (action === 'stop') { clearInterval(swInterval); swRunning = false; }
            else if (action === 'reset') { clearInterval(swInterval); swRunning = false; swTime = 0; document.getElementById('stopwatch-display').textContent = "00:00.0"; hidePopup('stopwatch-popup'); }
        }
    } catch(err) { console.error(err); }
};

// ========== SPOTIFY WIDGET NAMESPACE ==========
(function() {
    'use strict';
    
    // Private Variablen
    const spotify_spotifyCache = {};
    const spotify_updateInterval = 2000; // 1 Sekunde Update-Intervall
    let spotify_updateTimer = null;
    
    // Helper: Zeit formatieren (MM:SS)
    function spotify_formatTime(seconds) {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }
    
    // Hauptfunktion: Daten laden
    async function spotify_fetchAndUpdateWidget() {
        try {
            console.log('[Spotify Widget] Lade Daten aus spotify-cache.json...');
            
            const response = await fetch(`/spotify-cache.json?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const cache = await response.json();
            if (!cache) {
                throw new Error('Cache-Datei ist leer');
            }
            
            Object.assign(spotify_spotifyCache, cache);
            spotify_renderUI();
            
        } catch (error) {
            console.error('[Spotify Widget] Fehler:', error);
            spotify_showError(error.message);
        }
    }
    
    // Render UI mit aktuellen Daten
    function spotify_renderUI() {
        const spotify_currentPlayback = spotify_spotifyCache.currentPlayback;
        
        if (!spotify_currentPlayback) {
            spotify_showError('Keine Playback-Daten verfügbar');
            return;
        }
        
        // === CURRENTLY PLAYING ===
        spotify_updateCurrentTrack(spotify_currentPlayback);
        
        // === QUEUE ===
        spotify_updateQueue(spotify_currentPlayback.queue);
        
        // === TOP TRACKS ===
        spotify_updateTopTracks(spotify_spotifyCache.topTracks);
    }
    
    // Update: Aktueller Song
    function spotify_updateCurrentTrack(spotify_playback) {
        // Cover
        const spotify_coverEl = document.getElementById('spotify-track-cover');
        if (spotify_coverEl && spotify_playback.albumImg) {
            spotify_coverEl.src = spotify_playback.albumImg;
        }
        
        // Title
        const spotify_titleEl = document.getElementById('spotify-track-title');
        if (spotify_titleEl) {
            spotify_titleEl.textContent = spotify_playback.title || 'Unbekannter Titel';
        }
        
        // Artist
        const spotify_artistEl = document.getElementById('spotify-track-artist');
        if (spotify_artistEl) {
            spotify_artistEl.textContent = spotify_playback.artist || 'Unbekannter Künstler';
        }
        
        // Progress Bar & Zeit
        if (spotify_playback.progress !== undefined && spotify_playback.duration !== undefined) {
            const spotify_progressPercent = (spotify_playback.progress / spotify_playback.duration) * 100;
            
            const spotify_progressBar = document.getElementById('spotify-progress');
            if (spotify_progressBar) {
                spotify_progressBar.style.width = `${spotify_progressPercent}%`;
            }
            
            const spotify_currentTimeEl = document.getElementById('spotify-time-current');
            if (spotify_currentTimeEl) {
                spotify_currentTimeEl.textContent = spotify_formatTime(Math.floor(spotify_playback.progress / 1000));
            }
            
            const spotify_totalTimeEl = document.getElementById('spotify-time-total');
            if (spotify_totalTimeEl) {
                spotify_totalTimeEl.textContent = spotify_formatTime(Math.floor(spotify_playback.duration / 1000));
            }
        }
    }
    
    // Update: Warteschlange
    function spotify_updateQueue(spotify_queueData) {
        const spotify_queueEl = document.getElementById('spotify-queue');
        if (!spotify_queueEl) return;
        
        if (!spotify_queueData || !Array.isArray(spotify_queueData) || spotify_queueData.length === 0) {
            spotify_queueEl.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:1.1rem; padding: 10px 0;">Warteschlange leer</div>';
            return;
        }
        
        spotify_queueEl.innerHTML = spotify_queueData.slice(0, 4).map(spotify_track => `
            <div class="queue-item">
                <div class="top-track-meta queue-meta">
                    <div class="top-track-name" style="font-size: 1.1rem; font-weight: 600;">${spotify_track.title || 'Unbekannt'}</div>
                    <div class="top-track-artist" style="font-size: 0.9rem; color: rgba(255,255,255,0.5);">${spotify_track.artist || 'Unbekannt'}</div>
                </div>
            </div>
        `).join('');
    }
    
    // Update: Top Tracks
    function spotify_updateTopTracks(spotify_topTracksData) {
        const spotify_topEl = document.getElementById('spotify-top-tracks');
        if (!spotify_topEl) return;
        
        if (!spotify_topTracksData || !Array.isArray(spotify_topTracksData) || spotify_topTracksData.length === 0) {
            spotify_topEl.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:1.1rem; padding: 10px 0;">Keine Charts vorhanden</div>';
            return;
        }
        
        spotify_topEl.innerHTML = spotify_topTracksData.slice(0, 10).map((spotify_track, spotify_idx) => `
            <div class="top-track-item" style="display: flex; align-items: center; gap: 15px; background: rgba(255, 255, 255, 0.02); padding: 10px 14px; border-radius: 16px; margin-bottom: 8px;">
                <div class="top-track-rank" style="font-size: 1.1rem; font-weight: 700; color: #1db954; width: 25px; text-align: center;">${spotify_idx + 1}</div>
                ${spotify_track.albumImg ? `<img class="top-track-img" src="${spotify_track.albumImg}" alt="Cover" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover;">` : ''}
                <div class="top-track-meta" style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                    <div class="top-track-name" style="font-size: 1rem; font-weight: 600; text-overflow: ellipsis; overflow: hidden;">${spotify_track.title}</div>
                    <div class="top-track-artist" style="font-size: 0.85rem; color: rgba(255,255,255,0.5); text-overflow: ellipsis; overflow: hidden;">${spotify_track.artist}</div>
                </div>
            </div>
        `).join('');
    }
    
    // Fehler anzeigen
    function spotify_showError(spotify_message) {
        const spotify_topEl = document.getElementById('spotify-top-tracks');
        if (spotify_topEl) {
            spotify_topEl.innerHTML = `<div style="color: #ff6b6b; font-size:1rem; padding: 10px 0;">⚠️ ${spotify_message}</div>`;
        }
    }
    
    // Initiale Ladung
    function spotify_init() {
        console.log('[Spotify Widget] Initialisiere...');
        spotify_fetchAndUpdateWidget();
        
        // Auto-Refresh jede Sekunde
        if (spotify_updateTimer) clearInterval(spotify_updateTimer);
        spotify_updateTimer = setInterval(() => {
            spotify_fetchAndUpdateWidget();
        }, spotify_updateInterval);
    }
    
    // MutationObserver um zu erkennen, wenn das Widget geladen wird
    function spotify_setupObserver() {
        const observer = new MutationObserver((mutations) => {
            // Prüfe ob die Spotify-Elemente nun vorhanden sind
            if (document.getElementById('spotify-track-cover')) {
                console.log('[Spotify Widget] Elemente gefunden - starte Init');
                observer.disconnect(); // Stoppe Observer
                spotify_init();
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
        
        console.log('[Spotify Widget] MutationObserver aktiviert');
    }
    
    // Starte bei DOM-Ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('spotify-track-cover')) {
                spotify_init();
            } else {
                spotify_setupObserver();
            }
        });
    } else {
        if (document.getElementById('spotify-track-cover')) {
            spotify_init();
        } else {
            spotify_setupObserver();
        }
    }
    
})();
