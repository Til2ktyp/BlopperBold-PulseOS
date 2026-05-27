let idleTimeout;
let standbyTimeout;

const IDLE_TIME = 3 * 60 * 1000; // 3min
const STANDBY_TIME = 10 * 1000; // 30 sekunden nach Idle
const NIGHT_START = 22 * 60 + 30; // 22:30
const NIGHT_END = 6 * 60; // 6:00

// --- 🌙 NIGHT MODE AUTO-STANDBY SYSTEM ---
let isNightMode = false;
let lastActivityTime = Date.now();

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

    // Nur nachts aktiv
    if (isNightMode) {

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
    // Nur nachts automatisch aufwecken
    if (!isNightMode && !force) return;

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
    
    if (randomValue < 0.05) {
        totalLoadTime = 20000;
    } else {
        totalLoadTime = Math.random() * 3000 + 4000; //5000 + 4000
    }
    
    const stage2Delay = Math.random() * 500 + 500;
    
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

// --- AUTARKE FRONTEND-ENGINE ---
let timerInterval, timerTime = 0, timerRunning = false;
let swInterval, swTime = 0, swRunning = false, swStartTime = 0;

let lastTrackId = null;
let spotifySemiTimeout = null;
let isSpotifyForcedHidden = false; 

let spotifyMode = 'immer';

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

const eventSource = new EventSource('/events');
let currentSlot = 'a';

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
            document.getElementById('track-title').textContent = data.title;
            document.getElementById('track-artist').textContent = data.artist;
            document.getElementById('track-cover').src = data.albumImg;
            
            const progressPercent = (data.progress / data.duration) * 100;
            document.getElementById('track-progress').style.width = `${progressPercent}%`;
        
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
            }

            const dashTitle = document.getElementById('dash-track-title');
            if (dashTitle) {
                document.getElementById('dash-track-title').textContent = data.title;
                document.getElementById('dash-track-artist').textContent = data.artist;
                document.getElementById('dash-track-cover').src = data.albumImg;
                document.getElementById('dash-time-current').textContent = formatMs(data.progress);
                document.getElementById('dash-time-total').textContent = formatMs(data.duration);
                document.getElementById('dash-progress').style.width = `${progressPercent}%`;
            
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
                    } else if (!data.queue) {
                        queueContainer.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:1.1rem;">Warte auf Warteschlangen-Daten...</div>';
                    } else {
                        queueContainer.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:1.1rem;">Keine weiteren Titel in der Warteschlange</div>';
                    }
                }
            
                const topContainer = document.getElementById('dash-top-tracks');
                if (topContainer) {
                    if (data.topTracks && Array.isArray(data.topTracks) && data.topTracks.length > 0) {
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
                    } else if (!data.topTracks) {
                        topContainer.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:1.1rem; padding: 20px 0;">Warte auf Top-Songs...</div>';
                    }
                }
            }
        }

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
        }
        
        if (data.action === 'go-idle') { 
            document.body.classList.remove('widget-active'); 
            document.getElementById('spotify-widget').classList.remove('active');
        }

        if (data.action === 'toggle-standby') {
            wakeDisplay('toggle-standby', true);
            document.body.classList.remove('widget-active');
            document.getElementById('spotify-widget').classList.remove('active');
            
            document.body.classList.toggle('standby-active');
            console.log("Standby-Modus getoggelt. Aktiv:", document.body.classList.contains('standby-active'));
        }

        if (data.action === 'show-reminder') {
            wakeDisplay('reminder');
            const level = parseInt(data.stufe) || 1;
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
                document.getElementById('timer-label-text').textContent = "⏱️ Timer";
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
                    document.getElementById('timer-label-text').textContent = "⏱️ Timer";
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
                                document.getElementById('timer-label-text').textContent = "⏱️ Timer";
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
