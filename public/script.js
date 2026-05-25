let idleTimeout;
const IDLE_TIME = 5 * 60 * 1000;

let lat = localStorage.getItem('hub-lat') || '53.5653';
let lon = localStorage.getItem('hub-lon') || '11.3653';
let locName = localStorage.getItem('hub-city') || 'Pampow';
let clockSize = localStorage.getItem('hub-clock-size') || '11';

document.documentElement.style.setProperty('--clock-size', clockSize + 'rem');

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
        totalLoadTime = Math.random() * 5000 + 9000;
    }
    
    const stage2Delay = Math.random() * 2000 + 2000;
    
    setTimeout(() => {
        // const subtitle = document.querySelector('.loading-subtitle');
        const barContainer = document.querySelector('.loading-bar-container');
        const loadingBar = document.querySelector('.loading-bar');
        
        // subtitle.classList.add('show');
        barContainer.classList.add('show');
        
        const remainingTime = totalLoadTime - stage2Delay;
        loadingBar.style.animationDuration = remainingTime + 'ms';
    }, stage2Delay);
    
    setTimeout(() => {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => {
            loadingScreen.style.display = 'none';
            showInitToast();
        }, 1200);
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
    }, 3500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideLoadingScreen);
} else {
    hideLoadingScreen();
}

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
            document.body.classList.remove('widget-active');
            document.getElementById('spotify-widget').classList.remove('active');
            
            document.body.classList.toggle('standby-active');
            console.log("Standby-Modus getoggelt. Aktiv:", document.body.classList.contains('standby-active'));
        }

        if (data.action === 'show-reminder') {
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
