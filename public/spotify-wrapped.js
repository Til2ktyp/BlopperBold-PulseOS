// public/spotify-wrapped.js

// Spielt einen Song über die Spotify-Warteschlange ab (in die Queue legen und nach 1 Sekunde überspringen)
async function playSpotifyTrack(trackId) {
    if (!trackId) return;
    try {
        const res = await fetch('/spotify/queue-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('[playSpotifyTrack] Queue-Fehler:', err.error || res.status);
            return;
        }

        // 1 Sekunde warten, damit der Song sicher in der Queue ist
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Aktuellen Song überspringen, um den eingereihten Song abzuspielen
        const skipRes = await fetch('/spotify/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'next' })
        });
        if (!skipRes.ok) {
            const err = await skipRes.json().catch(() => ({}));
            console.error('[playSpotifyTrack] Skip-Fehler:', err.error || skipRes.status);
        }
    } catch (e) {
        console.error('[playSpotifyTrack] Netzwerk-Fehler:', e);
    }
}


async function initHistoryWidget() {
    const container = document.getElementById('history-container');
    if (!container) return;
    try {
        const response = await fetch('/spotify/history?limit=40');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        const history = data.history || [];
        if (history.length === 0) {
            container.innerHTML = '<div class="history-empty">Noch keine gehörten Songs aufgezeichnet 🎧</div>';
            return;
        }

        container.innerHTML = history.map(item => {
            const date = new Date(item.timestamp);
            const timeStr = formatHistoryTime(date);
            const durationStr = formatDuration(item.listenedMs);
            const coverUrl = item.albumImg || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 18V12l4-2v6"/></svg>';
            const artists = Array.isArray(item.artists) ? item.artists.join(', ') : item.artists;

            return `
                <div class="history-item" onclick="playSpotifyTrack('${item.trackId}')" style="cursor:pointer;">
                    <img src="${coverUrl}" class="history-cover" alt="Cover" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;50&quot; height=&quot;50&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;rgba(255,255,255,0.2)&quot; stroke-width=&quot;2&quot; stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot;><circle cx=&quot;12&quot; cy=&quot;12&quot; r=&quot;10&quot;/><path d=&quot;M9 18V12l4-2v6&quot;/></svg>';">
                    <div class="history-details">
                        <div class="history-title">${escapeHTML(item.title)}</div>
                        <div class="history-artist">${escapeHTML(artists)}</div>
                    </div>
                    <div class="history-meta">
                        <div class="history-time">${timeStr}</div>
                        <div class="history-duration">⏱️ ${durationStr}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('[History Widget] Fehler:', err);
        container.innerHTML = '<div class="history-empty" style="color: #ff453a;">Fehler beim Laden des Verlaufs.</div>';
    }
}

function formatHistoryTime(date) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    if (date >= startOfToday) {
        return `Heute, ${hours}:${minutes}`;
    } else if (date >= startOfYesterday) {
        return `Gestern, ${hours}:${minutes}`;
    } else {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${day}.${month}., ${hours}:${minutes}`;
    }
}

function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function initWrappedWidget() {
    try {
        const response = await fetch('/spotify/stats');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const statToday = document.getElementById('stat-today');
        const statAlltime = document.getElementById('stat-alltime');
        const chartContainer = document.getElementById('chart-bars-container');
        const artistsContainer = document.getElementById('artists-container');
        const songsContainer = document.getElementById('songs-container');
        const grid = document.getElementById('wrapped-grid-container');

        if (statToday) statToday.textContent = data.totalTimeTodayMinutes || 0;
        if (statAlltime) statAlltime.textContent = data.totalTimeAllTimeHours || 0;

        if (chartContainer) renderChart(chartContainer, data.dailyListenTime || []);
        if (artistsContainer) renderArtists(artistsContainer, (data.topArtists || []).slice(0, 5));
        if (songsContainer) renderSongs(songsContainer, (data.topTracks || []).slice(0, 5));

        if (grid) grid.style.opacity = '1';
    } catch (err) {
        console.error('[Wrapped Widget] Fehler:', err);
        const grid = document.getElementById('wrapped-grid-container');
        if (grid) {
            grid.innerHTML = '<div class="ranking-empty" style="color: #ff453a; grid-column: span 2;">Fehler beim Laden der Statistiken. Hast du schon Songs gehört?</div>';
            grid.style.opacity = '1';
        }
    }
}

function renderChart(chartContainer, dailyData) {
    if (dailyData.length === 0) {
        chartContainer.innerHTML = '<div class="ranking-empty">Keine täglichen Daten vorhanden</div>';
        return;
    }

    const maxVal = Math.max(...dailyData.map(d => d.minutes), 1);
    const existingBars = chartContainer.querySelectorAll('.chart-bar-wrapper');

    if (existingBars.length === dailyData.length) {
        dailyData.forEach((d, index) => {
            const barWrapper = existingBars[index];
            const bar = barWrapper.querySelector('.chart-bar');
            const tooltip = barWrapper.querySelector('.chart-bar-tooltip');
            const heightPercent = Math.max(5, (d.minutes / maxVal) * 90);
            
            if (bar) {
                bar.setAttribute('data-height', `${heightPercent}%`);
                bar.style.height = `${heightPercent}%`;
            }
            if (tooltip) {
                tooltip.textContent = `${d.minutes} Min.`;
            }
        });
        return;
    }

    chartContainer.innerHTML = dailyData.map(d => {
        const heightPercent = Math.max(5, (d.minutes / maxVal) * 90);
        const date = new Date(d.date);
        const dayLabel = date.toLocaleDateString('de-DE', { weekday: 'short' });

        return `
            <div class="chart-bar-wrapper">
                <div class="chart-bar" style="height: 0%;" data-height="${heightPercent}%">
                    <div class="chart-bar-tooltip">${d.minutes} Min.</div>
                </div>
                <div class="chart-bar-label">${dayLabel}</div>
            </div>
        `;
    }).join('');

    setTimeout(() => {
        const bars = chartContainer.querySelectorAll('.chart-bar');
        bars.forEach(bar => {
            bar.style.height = bar.getAttribute('data-height');
        });
    }, 100);
}

function renderArtists(container, artists) {
    if (artists.length === 0) {
        container.innerHTML = '<div class="ranking-empty">Noch keine Daten verfügbar</div>';
        return;
    }

    container.innerHTML = artists.map((artist, index) => {
        const displayTime = Math.round(artist.durationMs / 60000);
        return `
            <div class="ranking-item">
                <div class="ranking-number">${index + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${escapeHTML(artist.name)}</div>
                    <div class="ranking-sub">Insgesamt gehört</div>
                </div>
                <div class="ranking-badge">${displayTime} Min.</div>
            </div>
        `;
    }).join('');
}

function renderSongs(container, songs) {
    if (songs.length === 0) {
        container.innerHTML = '<div class="ranking-empty">Noch keine Daten verfügbar</div>';
        return;
    }

    container.innerHTML = songs.map((song, index) => {
        const artistsStr = Array.isArray(song.artists) ? song.artists.join(', ') : song.artists;
        return `
            <div class="ranking-item" onclick="playSpotifyTrack('${song.trackId}')" style="cursor:pointer;">
                <div class="ranking-number">${index + 1}</div>
                <div class="ranking-info">
                    <div class="ranking-name">${escapeHTML(song.title)}</div>
                    <div class="ranking-sub">${escapeHTML(artistsStr)}</div>
                </div>
                <div class="ranking-badge">${song.plays}x</div>
            </div>
        `;
    }).join('');
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ===== DESKTOP WRAPPED WIDGET =====
// ===== DESKTOP WRAPPED WIDGET =====
let _currentWdTimeframe = '7d';
let _currentWdRecentTab = 'recent';

async function changeWdTimeframe(timeframe) {
    _currentWdTimeframe = timeframe;
    
    // Update active button state
    document.querySelectorAll('.wd-timeframe-btn').forEach(btn => {
        if (btn.getAttribute('data-timeframe') === timeframe) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Update chart title text dynamically
    const chartTitleText = document.getElementById('wd-chart-title-text');
    if (chartTitleText) {
        if (timeframe === '7d') chartTitleText.innerHTML = '📊 Letzte 7 Tage (Hörzeit)';
        else if (timeframe === '30d') chartTitleText.innerHTML = '📊 Letzte 30 Tage (Hörzeit)';
        else if (timeframe === '6m') chartTitleText.innerHTML = '📊 Letzte 6 Monate (Hörzeit)';
        else if (timeframe === 'lifetime') chartTitleText.innerHTML = '📊 Lifetime (Hörzeit)';
    }

    // Refresh the widget data
    await initWrappedDesktopWidget();
}
window.changeWdTimeframe = changeWdTimeframe;

function switchWdRecentTab(tabName) {
    _currentWdRecentTab = tabName;
    const recentBtn = document.getElementById('wd-tab-recent');
    const devicesBtn = document.getElementById('wd-tab-devices');
    const recentContainer = document.getElementById('wd-recent-container');
    const devicesContainer = document.getElementById('wd-devices-container');
    
    if (tabName === 'recent') {
        if (recentBtn) recentBtn.classList.add('active');
        if (devicesBtn) devicesBtn.classList.remove('active');
        if (recentContainer) recentContainer.style.display = 'block';
        if (devicesContainer) devicesContainer.style.display = 'none';
    } else if (tabName === 'devices') {
        if (recentBtn) recentBtn.classList.remove('active');
        if (devicesBtn) devicesBtn.classList.add('active');
        if (recentContainer) recentContainer.style.display = 'none';
        if (devicesContainer) devicesContainer.style.display = 'block';
    }
}
window.switchWdRecentTab = switchWdRecentTab;

function updateTextAnimated(el, newText) {
    if (!el) return;
    if (el.textContent.trim() === String(newText).trim()) return;
    
    el.classList.add('text-changing');
    setTimeout(() => {
        el.textContent = newText;
        el.classList.remove('text-changing');
    }, 250);
}

function updateHtmlAnimated(el, newHtml) {
    if (!el) return;
    if (el.innerHTML.trim() === String(newHtml).trim()) return;
    
    el.classList.add('text-changing');
    setTimeout(() => {
        el.innerHTML = newHtml;
        el.classList.remove('text-changing');
    }, 250);
}

async function initWrappedDesktopWidget() {
    try {
        const [statsRes, historyRes] = await Promise.all([
            fetch(`/spotify/stats?range=${_currentWdTimeframe}`),
            fetch('/spotify/history?limit=50')
        ]);

        if (!statsRes.ok) throw new Error(`Stats HTTP ${statsRes.status}`);
        const data = await statsRes.json();
        const historyData = historyRes.ok ? await historyRes.json() : { history: [] };

        const statToday = document.getElementById('wd-stat-today');
        const statAlltime = document.getElementById('wd-stat-alltime');
        const statSongs = document.getElementById('wd-stat-songs');
        const statArtists = document.getElementById('wd-stat-artists');
        const statAvg = document.getElementById('wd-stat-avg');
        const chartContainer = document.getElementById('wd-chart-container');
        const artistsContainer = document.getElementById('wd-artists-container');
        const songsContainer = document.getElementById('wd-songs-container');
        const playlistsContainer = document.getElementById('wd-playlists-container');
        const recentContainer = document.getElementById('wd-recent-container');
        const devicesContainer = document.getElementById('wd-devices-container');
        const grid = document.getElementById('wrapped-desktop-grid');

        // Synchronize timeframe button active classes and title text on load
        document.querySelectorAll('.wd-timeframe-btn').forEach(btn => {
            if (btn.getAttribute('data-timeframe') === _currentWdTimeframe) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const chartTitleText = document.getElementById('wd-chart-title-text');
        if (chartTitleText) {
            let targetTitle = '';
            if (_currentWdTimeframe === '7d') targetTitle = '📊 Letzte 7 Tage (Hörzeit)';
            else if (_currentWdTimeframe === '30d') targetTitle = '📊 Letzte 30 Tage (Hörzeit)';
            else if (_currentWdTimeframe === '6m') targetTitle = '📊 Letzte 6 Monate (Hörzeit)';
            else if (_currentWdTimeframe === 'lifetime') targetTitle = '📊 Lifetime (Hörzeit)';
            updateHtmlAnimated(chartTitleText, targetTitle);
        }

        // Synchronize recent activity vs devices tab state on load
        const recentBtn = document.getElementById('wd-tab-recent');
        const devicesBtn = document.getElementById('wd-tab-devices');
        const recentCont = document.getElementById('wd-recent-container');
        const devicesCont = document.getElementById('wd-devices-container');
        if (_currentWdRecentTab === 'recent') {
            if (recentBtn) recentBtn.classList.add('active');
            if (devicesBtn) devicesBtn.classList.remove('active');
            if (recentCont) recentCont.style.display = 'block';
            if (devicesCont) devicesCont.style.display = 'none';
        } else if (_currentWdRecentTab === 'devices') {
            if (recentBtn) recentBtn.classList.remove('active');
            if (devicesBtn) devicesBtn.classList.add('active');
            if (recentCont) recentCont.style.display = 'none';
            if (devicesCont) devicesCont.style.display = 'block';
        }

        // Dynamically update card labels
        const labelAlltime = document.querySelector('.wd-hero-stat:nth-child(2) .wd-hero-label');
        const labelSongs = document.querySelector('.wd-hero-stat:nth-child(3) .wd-hero-label');
        const labelArtists = document.querySelector('.wd-hero-stat:nth-child(4) .wd-hero-label');

        let periodText = '';
        if (_currentWdTimeframe === '7d') periodText = ' (7 Tage)';
        else if (_currentWdTimeframe === '30d') periodText = ' (30 Tage)';
        else if (_currentWdTimeframe === '6m') periodText = ' (6 Monate)';

        if (labelAlltime) updateTextAnimated(labelAlltime, _currentWdTimeframe === 'lifetime' ? 'Stunden Gesamt' : `Stunden${periodText}`);
        if (labelSongs) updateTextAnimated(labelSongs, _currentWdTimeframe === 'lifetime' ? 'Songs Gehört' : `Songs Gehört${periodText}`);
        if (labelArtists) updateTextAnimated(labelArtists, _currentWdTimeframe === 'lifetime' ? 'Verschiedene Künstler' : `Künstler${periodText}`);

        if (statToday) updateTextAnimated(statToday, data.totalTimeTodayMinutes || 0);
        if (statAlltime) updateTextAnimated(statAlltime, data.totalTimeAllTimeHours || 0);

        // Total songs & unique artists from top data
        const totalSongs = data.totalPlaysCount || (data.topTracks || []).reduce((sum, t) => sum + t.plays, 0);
        const uniqueArtists = data.uniqueArtistsCount || (data.topArtists || []).length;
        
        const totalMinutes = typeof data.totalTimeAllTimeMinutes !== 'undefined'
            ? data.totalTimeAllTimeMinutes
            : (data.totalTimeAllTimeHours ? data.totalTimeAllTimeHours * 60 : (data.totalTimeTodayMinutes || 0));
        const avgVal = totalSongs > 0 ? totalMinutes / totalSongs : 0;
        const avgPerSong = avgVal % 1 === 0 ? avgVal : avgVal.toFixed(1);

        if (statSongs) updateTextAnimated(statSongs, totalSongs);
        if (statArtists) updateTextAnimated(statArtists, uniqueArtists);
        if (statAvg) updateTextAnimated(statAvg, avgPerSong);

        if (chartContainer) renderDesktopChart(chartContainer, data.chartData || data.dailyListenTime || []);
        if (artistsContainer) renderDesktopArtists(artistsContainer, data.topArtists || []);
        if (songsContainer) renderDesktopSongs(songsContainer, data.topTracks || []);
        if (playlistsContainer) renderDesktopPlaylists(playlistsContainer, data.topPlaylists || []);
        if (recentContainer) renderDesktopRecent(recentContainer, historyData.history || []);
        if (devicesContainer) renderDesktopDevices(devicesContainer, data.deviceStats || []);

        if (grid) grid.style.opacity = '1';
    } catch (err) {
        console.error('[Wrapped Desktop Widget] Fehler:', err);
        const grid = document.getElementById('wrapped-desktop-grid');
        if (grid) {
            grid.innerHTML = '<div class="wd-ranking-empty" style="color: #ff453a; grid-column: span 3;">Fehler beim Laden der Statistiken.</div>';
            grid.style.opacity = '1';
        }
    }
}

function renderDesktopChart(container, chartData) {
    if (!chartData || chartData.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Keine Daten vorhanden</div>';
        return;
    }
    const maxVal = Math.max(...chartData.map(d => d.minutes), 1);

    const activeInner = container.querySelector('.wd-chart-inner:not(.slide-out)');
    
    // Check if we can do an in-place update (same number of bars, e.g. normal data polling)
    if (activeInner) {
        const existingWrappers = Array.from(activeInner.querySelectorAll('.wd-chart-bar-wrapper'));
        if (existingWrappers.length === chartData.length) {
            existingWrappers.forEach((wrapper, i) => {
                const d = chartData[i];
                const heightPercent = Math.max(5, (d.minutes / maxVal) * 90);
                
                const bar = wrapper.querySelector('.wd-chart-bar');
                if (bar) {
                    bar.setAttribute('data-height', `${heightPercent}%`);
                    bar.style.height = `${heightPercent}%`;
                    
                    const tooltip = bar.querySelector('.wd-chart-bar-tooltip');
                    if (tooltip) tooltip.textContent = `${d.minutes} Min.`;
                    
                    if (d.startDate && d.endDate) {
                        bar.onclick = function() {
                            showChartBarDetailPopup(d.startDate, d.endDate, d.label);
                        };
                        bar.style.cursor = 'pointer';
                    } else {
                        bar.onclick = null;
                        bar.style.cursor = 'default';
                    }
                }
                const labelEl = wrapper.querySelector('.wd-chart-bar-label');
                if (labelEl) {
                    labelEl.textContent = d.label;
                    labelEl.title = d.label;
                }
            });
            return;
        }
    }

    // Different number of bars! Create a new inner container and slide it in.
    const newInner = document.createElement('div');
    newInner.className = 'wd-chart-inner slide-in-start';
    
    newInner.innerHTML = chartData.map(d => {
        const heightPercent = Math.max(5, (d.minutes / maxVal) * 90);
        const clickAction = (d.startDate && d.endDate) 
            ? `onclick="showChartBarDetailPopup('${d.startDate}', '${d.endDate}', '${escapeHTML(d.label)}')" style="cursor: pointer;"`
            : '';
        return `
            <div class="wd-chart-bar-wrapper">
                <div class="wd-chart-bar" style="height: 0%;" data-height="${heightPercent}%" ${clickAction}>
                    <div class="wd-chart-bar-tooltip">${d.minutes} Min.</div>
                </div>
                <div class="wd-chart-bar-label" style="text-align: center; font-size: 0.65rem; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(d.label)}">${escapeHTML(d.label)}</div>
            </div>
        `;
    }).join('');

    container.appendChild(newInner);

    // If there is an active inner container, slide it out to the left
    if (activeInner) {
        activeInner.classList.add('slide-out');
        setTimeout(() => {
            activeInner.remove();
        }, 600); // Wait for transition to finish
    }

    // Trigger enter transition for the new container
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            newInner.classList.remove('slide-in-start');
            // Animate individual bar heights growing from 0%
            newInner.querySelectorAll('.wd-chart-bar').forEach(bar => {
                bar.style.height = bar.getAttribute('data-height');
            });
        });
    });
}

function renderDesktopArtists(container, artists) {
    if (artists.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Noch keine Daten verfügbar</div>';
        return;
    }
    container.innerHTML = artists.map((artist, index) => {
        const displayTime = Math.round(artist.durationMs / 60000);
        return `
            <div class="wd-ranking-item" data-artist-name="${escapeHTML(artist.name)}" onclick="showArtistSongsPopup(this.dataset.artistName)" style="cursor: pointer;">
                <div class="wd-ranking-number">${index + 1}</div>
                <div class="wd-ranking-info">
                    <div class="wd-ranking-name">${escapeHTML(artist.name)}</div>
                    <div class="wd-ranking-sub">${artist.plays} Plays</div>
                </div>
                <div class="wd-ranking-badge">${displayTime} Min.</div>
            </div>
        `;
    }).join('');
}

function renderDesktopSongs(container, songs) {
    if (songs.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Noch keine Daten verfügbar</div>';
        return;
    }
    container.innerHTML = songs.map((song, index) => {
        const artistsStr = Array.isArray(song.artists) ? song.artists.join(', ') : song.artists;
        return `
            <div class="wd-ranking-item" data-track-id="${song.trackId}" onclick="playSpotifyTrack('${song.trackId}')" style="cursor:pointer;">
                <div class="wd-ranking-number">${index + 1}</div>
                <div class="wd-ranking-info">
                    <div class="wd-ranking-name">${escapeHTML(song.title)}</div>
                    <div class="wd-ranking-sub">${escapeHTML(artistsStr)}</div>
                </div>
                <div class="wd-ranking-badge">${song.plays}x</div>
            </div>
        `;
    }).join('');
}

function renderDesktopRecent(container, history) {
    if (history.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Noch keine Songs gehört</div>';
        return;
    }
    const fallbackCover = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='38' height='38' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2'><circle cx='12' cy='12' r='10'/></svg>";
    container.innerHTML = history.map(item => {
        const date = new Date(item.timestamp);
        const timeStr = formatHistoryTime(date);
        const coverUrl = item.albumImg || fallbackCover;
        const artists = Array.isArray(item.artists) ? item.artists.join(', ') : item.artists;
        const playlistInfo = item.playlistName ? `<span class="wd-recent-playlist" style="color: rgba(255,255,255,0.35); font-weight: 500;"> • 💿 ${escapeHTML(item.playlistName)}</span>` : '';
        const deviceEmoji = item.device ? ' • 🔊 ' : '';
        const deviceName = item.device ? `<span class="wd-recent-device" style="color: rgba(255,255,255,0.35); font-weight: 500;">${deviceEmoji}${escapeHTML(item.device)}</span>` : '';
        return `
            <div class="wd-recent-item" data-track-id="${item.trackId}" onclick="playSpotifyTrack('${item.trackId}')" style="cursor:pointer;">
                <img src="${coverUrl}" class="wd-recent-cover" alt="" onerror="this.src='${fallbackCover}';">
                <div class="wd-recent-info">
                    <div class="wd-recent-title">${escapeHTML(item.title)}</div>
                    <div class="wd-recent-artist">${escapeHTML(artists)}${playlistInfo}${deviceName}</div>
                </div>
                <div class="wd-recent-time">${timeStr}</div>
            </div>
        `;
    }).join('');
}

function renderDesktopPlaylists(container, playlists) {
    if (!playlists || playlists.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Noch keine Playlist-Daten verfügbar</div>';
        return;
    }
    container.innerHTML = playlists.map((playlist, index) => {
        const displayTime = Math.round(playlist.durationMs / 60000);
        return `
            <div class="wd-ranking-item">
                <div class="wd-ranking-number">${index + 1}</div>
                <div class="wd-ranking-info">
                    <div class="wd-ranking-name">${escapeHTML(playlist.name)}</div>
                    <div class="wd-ranking-sub">${playlist.plays} Plays</div>
                </div>
                <div class="wd-ranking-badge">${displayTime} Min.</div>
            </div>
        `;
    }).join('');
}

function renderDesktopDevices(container, deviceStats) {
    if (!deviceStats || deviceStats.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Keine Geräte-Daten verfügbar</div>';
        return;
    }
    const maxMs = Math.max(...deviceStats.map(d => d.durationMs), 1);
    container.innerHTML = deviceStats.map((device, index) => {
        const displayTime = Math.round(device.durationMs / 60000);
        const percent = Math.round((device.durationMs / maxMs) * 100);
        
        let emoji = '🔊';
        const name = device.name.toLowerCase();
        if (name.includes('iphone') || name.includes('phone') || name.includes('handy') || name.includes('mobile')) {
            emoji = '📱';
        } else if (name.includes('macbook') || name.includes('mac') || name.includes('computer') || name.includes('pc') || name.includes('laptop')) {
            emoji = '💻';
        } else if (name.includes('tv') || name.includes('television') || name.includes('fernseher')) {
            emoji = '📺';
        } else if (name.includes('echo') || name.includes('alexa') || name.includes('nest') || name.includes('home') || name.includes('speaker') || name.includes('lautsprecher')) {
            emoji = '🔊';
        } else if (name.includes('car') || name.includes('auto') || name.includes('tesla') || name.includes('bmw') || name.includes('audi')) {
            emoji = '🚗';
        } else if (name.includes('headphones') || name.includes('headset') || name.includes('kopfhörer') || name.includes('earbuds') || name.includes('pods')) {
            emoji = '🎧';
        }
        
        return `
            <div class="wd-ranking-item" onclick="showDeviceDetailPopup(this.dataset.deviceName)" data-device-name="${escapeHTML(device.name)}" style="cursor: pointer; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                        <span style="font-size: 1.2rem;">${emoji}</span>
                        <div style="font-size: 0.9rem; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${escapeHTML(device.name)}
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <span class="wd-ranking-sub" style="font-size: 0.75rem;">${device.plays} Plays</span>
                        <span class="wd-ranking-badge">${displayTime} Min.</span>
                    </div>
                </div>
                <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, #38bdf8, #f472b6); border-radius: 3px;"></div>
                </div>
            </div>
        `;
    }).join('');
}

async function showDeviceDetailPopup(deviceName) {
    let modal = document.getElementById('wd-device-detail-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'wd-device-detail-modal';
        modal.className = 'wd-modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="wd-modal-overlay" onclick="closeWdDeviceDetailModal()"></div>
        <div class="wd-modal-content" style="max-width: 720px; width: 90%;">
            <button class="wd-modal-close" onclick="closeWdDeviceDetailModal()">×</button>
            <div class="wd-modal-header">
                <span class="wd-modal-icon">📱</span>
                <div>
                    <h3 id="wd-modal-device-title" style="margin: 0;">Statistik für ${escapeHTML(deviceName)}</h3>
                    <p id="wd-modal-device-subtitle" style="margin: 2px 0 0 0; color: rgba(255,255,255,0.6); font-size: 0.85rem;">Lade Details...</p>
                </div>
            </div>
            <div class="wd-modal-body" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; overflow-y: hidden; max-height: 60vh;">
                <!-- Column 1: Top Artists -->
                <div style="display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 55vh; padding-right: 6px;">
                    <h4 style="margin: 0 0 5px 0; color: #f472b6; font-size: 1rem; font-weight: 700;">🎤 Top Künstler auf Gerät</h4>
                    <div id="wd-modal-device-artists" class="wd-ranking-list">
                        <div class="wd-ranking-empty">Lade Künstler...</div>
                    </div>
                </div>
                <!-- Column 2: Top Songs -->
                <div style="display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 55vh; padding-right: 6px;">
                    <h4 style="margin: 0 0 5px 0; color: #38bdf8; font-size: 1rem; font-weight: 700;">🎵 Top Songs auf Gerät</h4>
                    <div id="wd-modal-device-songs" class="wd-ranking-list">
                        <div class="wd-ranking-empty">Lade Songs...</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
    
    try {
        const res = await fetch(`/spotify/stats?device=${encodeURIComponent(deviceName)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        const subtitle = document.getElementById('wd-modal-device-subtitle');
        if (subtitle) {
            subtitle.textContent = `Hörzeit auf diesem Gerät: ${data.totalTimeAllTimeMinutes} Min. (${data.totalPlaysCount} Plays)`;
        }
        
        const artistsContainer = document.getElementById('wd-modal-device-artists');
        const songsContainer = document.getElementById('wd-modal-device-songs');
        
        if (artistsContainer) {
            const topArtists = data.topArtists || [];
            if (topArtists.length === 0) {
                artistsContainer.innerHTML = '<div class="wd-ranking-empty">Keine Daten</div>';
            } else {
                artistsContainer.innerHTML = topArtists.slice(0, 20).map((artist, index) => {
                    const displayTime = Math.round(artist.durationMs / 60000);
                    return `
                        <div class="wd-ranking-item" data-artist-name="${escapeHTML(artist.name)}" onclick="showArtistSongsPopup(this.dataset.artistName)" style="cursor: pointer; padding: 6px 10px; border-radius: 10px; font-size: 0.85rem;">
                            <div class="wd-ranking-number" style="font-size: 0.85rem; width: 15px;">${index + 1}</div>
                            <div class="wd-ranking-info">
                                <div class="wd-ranking-name" style="font-size: 0.85rem;">${escapeHTML(artist.name)}</div>
                                <div class="wd-ranking-sub" style="font-size: 0.7rem;">${artist.plays} Plays</div>
                            </div>
                            <div class="wd-ranking-badge" style="font-size: 0.7rem; padding: 2px 6px;">${displayTime} Min.</div>
                        </div>
                    `;
                }).join('');
            }
        }
        
        if (songsContainer) {
            const topSongs = data.topTracks || [];
            if (topSongs.length === 0) {
                songsContainer.innerHTML = '<div class="wd-ranking-empty">Keine Daten</div>';
            } else {
                songsContainer.innerHTML = topSongs.slice(0, 20).map((song, index) => {
                    const artistsStr = Array.isArray(song.artists) ? song.artists.join(', ') : song.artists;
                    return `
                        <div class="wd-ranking-item" data-track-id="${song.trackId}" onclick="playSpotifyTrack('${song.trackId}')" style="cursor:pointer; padding: 6px 10px; border-radius: 10px; font-size: 0.85rem;">
                            <div class="wd-ranking-number" style="font-size: 0.85rem; width: 15px;">${index + 1}</div>
                            <div class="wd-ranking-info">
                                <div class="wd-ranking-name" style="font-size: 0.85rem;">${escapeHTML(song.title)}</div>
                                <div class="wd-ranking-sub" style="font-size: 0.7rem;">${escapeHTML(artistsStr)}</div>
                            </div>
                            <div class="wd-ranking-badge" style="font-size: 0.7rem; padding: 2px 6px;">${song.plays}x</div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (err) {
        console.error('[showDeviceDetailPopup] Fehler:', err);
        const artistsContainer = document.getElementById('wd-modal-device-artists');
        if (artistsContainer) {
            artistsContainer.innerHTML = '<div class="wd-ranking-empty" style="color: #ff453a;">Fehler beim Laden.</div>';
        }
    }
}

function closeWdDeviceDetailModal() {
    const modal = document.getElementById('wd-device-detail-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    }
}

window.showDeviceDetailPopup = showDeviceDetailPopup;
window.closeWdDeviceDetailModal = closeWdDeviceDetailModal;

async function showChartBarDetailPopup(startDate, endDate, label) {
    let modal = document.getElementById('wd-chart-detail-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'wd-chart-detail-modal';
        modal.className = 'wd-modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="wd-modal-overlay" onclick="closeWdChartDetailModal()"></div>
        <div class="wd-modal-content" style="max-width: 720px; width: 90%;">
            <button class="wd-modal-close" onclick="closeWdChartDetailModal()">×</button>
            <div class="wd-modal-header">
                <span class="wd-modal-icon">📊</span>
                <div>
                    <h3 id="wd-modal-chart-title" style="margin: 0;">Detail-Statistik: ${escapeHTML(label)}</h3>
                    <p id="wd-modal-chart-subtitle" style="margin: 2px 0 0 0; color: rgba(255,255,255,0.6); font-size: 0.85rem;">Lade Details...</p>
                </div>
            </div>
            <div class="wd-modal-body" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; overflow-y: hidden; max-height: 60vh;">
                <!-- Column 1: Top Artists -->
                <div style="display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 55vh; padding-right: 6px;">
                    <h4 style="margin: 0 0 5px 0; color: #f472b6; font-size: 1rem; font-weight: 700;">🎤 Top Künstler</h4>
                    <div id="wd-modal-chart-artists" class="wd-ranking-list">
                        <div class="wd-ranking-empty">Lade Künstler...</div>
                    </div>
                </div>
                <!-- Column 2: Top Songs -->
                <div style="display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 55vh; padding-right: 6px;">
                    <h4 style="margin: 0 0 5px 0; color: #38bdf8; font-size: 1rem; font-weight: 700;">🎵 Top Songs</h4>
                    <div id="wd-modal-chart-songs" class="wd-ranking-list">
                        <div class="wd-ranking-empty">Lade Songs...</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
    
    try {
        const res = await fetch(`/spotify/stats?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        const subtitle = document.getElementById('wd-modal-chart-subtitle');
        if (subtitle) {
            subtitle.textContent = `Hörzeit in dieser Periode: ${data.totalTimeAllTimeMinutes} Min. (${data.totalPlaysCount} Plays)`;
        }
        
        const artistsContainer = document.getElementById('wd-modal-chart-artists');
        const songsContainer = document.getElementById('wd-modal-chart-songs');
        
        if (artistsContainer) {
            const topArtists = data.topArtists || [];
            if (topArtists.length === 0) {
                artistsContainer.innerHTML = '<div class="wd-ranking-empty">Keine Daten</div>';
            } else {
                artistsContainer.innerHTML = topArtists.slice(0, 20).map((artist, index) => {
                    const displayTime = Math.round(artist.durationMs / 60000);
                    return `
                        <div class="wd-ranking-item" data-artist-name="${escapeHTML(artist.name)}" onclick="showArtistSongsPopup(this.dataset.artistName)" style="cursor: pointer; padding: 6px 10px; border-radius: 10px; font-size: 0.85rem;">
                            <div class="wd-ranking-number" style="font-size: 0.85rem; width: 15px;">${index + 1}</div>
                            <div class="wd-ranking-info">
                                <div class="wd-ranking-name" style="font-size: 0.85rem;">${escapeHTML(artist.name)}</div>
                                <div class="wd-ranking-sub" style="font-size: 0.7rem;">${artist.plays} Plays</div>
                            </div>
                            <div class="wd-ranking-badge" style="font-size: 0.7rem; padding: 2px 6px;">${displayTime} Min.</div>
                        </div>
                    `;
                }).join('');
            }
        }
        
        if (songsContainer) {
            const topSongs = data.topTracks || [];
            if (topSongs.length === 0) {
                songsContainer.innerHTML = '<div class="wd-ranking-empty">Keine Daten</div>';
            } else {
                songsContainer.innerHTML = topSongs.slice(0, 20).map((song, index) => {
                    const artistsStr = Array.isArray(song.artists) ? song.artists.join(', ') : song.artists;
                    return `
                        <div class="wd-ranking-item" data-track-id="${song.trackId}" onclick="playSpotifyTrack('${song.trackId}')" style="cursor:pointer; padding: 6px 10px; border-radius: 10px; font-size: 0.85rem;">
                            <div class="wd-ranking-number" style="font-size: 0.85rem; width: 15px;">${index + 1}</div>
                            <div class="wd-ranking-info">
                                <div class="wd-ranking-name" style="font-size: 0.85rem;">${escapeHTML(song.title)}</div>
                                <div class="wd-ranking-sub" style="font-size: 0.7rem;">${escapeHTML(artistsStr)}</div>
                            </div>
                            <div class="wd-ranking-badge" style="font-size: 0.7rem; padding: 2px 6px;">${song.plays}x</div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (err) {
        console.error('[showChartBarDetailPopup] Fehler:', err);
        const artistsContainer = document.getElementById('wd-modal-chart-artists');
        if (artistsContainer) {
            artistsContainer.innerHTML = '<div class="wd-ranking-empty" style="color: #ff453a;">Fehler beim Laden.</div>';
        }
    }
}

function closeWdChartDetailModal() {
    const modal = document.getElementById('wd-chart-detail-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    }
}

window.showChartBarDetailPopup = showChartBarDetailPopup;
window.closeWdChartDetailModal = closeWdChartDetailModal;

function switchWdTab(tabName) {
    const songsBtn = document.querySelector('.wd-tab-btn[onclick*="songs"]');
    const playlistsBtn = document.querySelector('.wd-tab-btn[onclick*="playlists"]');
    const songsContainer = document.getElementById('wd-songs-container');
    const playlistsContainer = document.getElementById('wd-playlists-container');
    
    if (tabName === 'songs') {
        if (songsBtn) songsBtn.classList.add('active');
        if (playlistsBtn) playlistsBtn.classList.remove('active');
        if (songsContainer) songsContainer.style.display = 'block';
        if (playlistsContainer) playlistsContainer.style.display = 'none';
    } else if (tabName === 'playlists') {
        if (songsBtn) songsBtn.classList.remove('active');
        if (playlistsBtn) playlistsBtn.classList.add('active');
        if (songsContainer) songsContainer.style.display = 'none';
        if (playlistsContainer) playlistsContainer.style.display = 'block';
    }
}
window.switchWdTab = switchWdTab;

// ===== DESKTOP HISTORY WIDGET (4-Column, Date-Grouped, with Filters) =====

// Raw data cache for client-side filtering
let _hdAllHistory = [];

async function initHistoryDesktopWidget() {
    if (typeof toggleSelectionMode === 'function') toggleSelectionMode(false);
    const container = document.getElementById('history-desktop-container');
    const totalCountEl = document.getElementById('hd-total-count');
    if (!container) return;
    try {
        const response = await fetch('/spotify/history');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        _hdAllHistory = data.history || [];

        if (_hdAllHistory.length === 0) {
            container.innerHTML = '<div class="hd-empty">Noch keine gehörten Songs aufgezeichnet 🎧</div>';
            if (totalCountEl) totalCountEl.textContent = '';
            return;
        }

        if (totalCountEl) totalCountEl.textContent = `${_hdAllHistory.length} Einträge`;

        // Attach filter listeners once (check flag to avoid duplicates on re-render)
        if (!window._hdFiltersAttached) {
            window._hdFiltersAttached = true;
            ['hd-filter-date', 'hd-filter-time-from', 'hd-filter-time-to', 'hd-filter-artist', 'hd-filter-duration'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', hdRenderFilteredHistory);
            });
        }

        hdRenderFilteredHistory();
    } catch (err) {
        console.error('[History Desktop Widget] Fehler:', err);
        container.innerHTML = '<div class="hd-empty" style="color: #ff453a;">Fehler beim Laden des Verlaufs.</div>';
    }
}

function hdRenderFilteredHistory() {
    const container = document.getElementById('history-desktop-container');
    const totalCountEl = document.getElementById('hd-total-count');
    const resultInfo = document.getElementById('hd-result-info');
    const resetBtn = document.getElementById('hd-filter-reset');
    if (!container) return;

    const filterDate = document.getElementById('hd-filter-date')?.value || '';
    const filterTimeFrom = document.getElementById('hd-filter-time-from')?.value || '';
    const filterTimeTo = document.getElementById('hd-filter-time-to')?.value || '';
    const filterArtist = (document.getElementById('hd-filter-artist')?.value || '').toLowerCase().trim();
    const filterDuration = parseInt(document.getElementById('hd-filter-duration')?.value || '0', 10);

    const isFiltered = filterDate || filterTimeFrom || filterTimeTo || filterArtist || filterDuration > 0;
    if (resetBtn) resetBtn.classList.toggle('visible', isFiltered);

    const toMinSec = str => {
        if (!str) return null;
        const [h, m] = str.split(':').map(Number);
        return h * 60 + m;
    };
    const timeFromMin = toMinSec(filterTimeFrom);
    const timeToMin = toMinSec(filterTimeTo);

    const filtered = _hdAllHistory.filter(item => {
        const date = new Date(item.timestamp);
        const itemDateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const itemTimeMin = date.getHours() * 60 + date.getMinutes();
        const artists = Array.isArray(item.artists) ? item.artists.join(' ').toLowerCase() : (item.artists || '').toLowerCase();

        if (filterDate && itemDateKey !== filterDate) return false;
        if (timeFromMin !== null && itemTimeMin < timeFromMin) return false;
        if (timeToMin !== null && itemTimeMin > timeToMin) return false;
        if (filterArtist && !artists.includes(filterArtist) && !item.title?.toLowerCase().includes(filterArtist)) return false;
        if (filterDuration > 0 && (item.listenedMs || 0) < filterDuration * 1000) return false;
        return true;
    });

    if (resultInfo) {
        if (isFiltered) {
            resultInfo.textContent = `${filtered.length} von ${_hdAllHistory.length} Einträgen entsprechen dem Filter`;
            resultInfo.classList.add('visible');
        } else {
            resultInfo.classList.remove('visible');
        }
    }

    if (totalCountEl) totalCountEl.textContent = `${_hdAllHistory.length} Einträge`;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="hd-empty">Kein Eintrag entspricht dem Filter 🔍</div>';
        return;
    }

    // Group by date
    const grouped = {};
    filtered.forEach(item => {
        const date = new Date(item.timestamp);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(item);
    });

    const sortedDateKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    const fallbackCover = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2'><circle cx='12' cy='12' r='10'/></svg>";

    container.innerHTML = sortedDateKeys.map(dateKey => {
        const items = grouped[dateKey];
        const dateObj = new Date(dateKey + 'T00:00:00');
        const dateLabel = formatDateGroupLabel(dateObj);
        const count = items.length;

        const itemsHtml = items.map(item => {
            const date = new Date(item.timestamp);
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const timeStr = `${hours}:${minutes}`;
            const durationStr = formatDuration(item.listenedMs);
            const coverUrl = item.albumImg || fallbackCover;
            const artists = Array.isArray(item.artists) ? item.artists.join(', ') : item.artists;
            const deviceEmoji = item.device ? ' • 🔊 ' : '';
            const deviceName = item.device ? `<span class="hd-device-info" style="color: rgba(255,255,255,0.35); font-weight: 500;">${deviceEmoji}${escapeHTML(item.device)}</span>` : '';

            const isSelected = window._hdSelectedTrackIds && window._hdSelectedTrackIds.has(item.trackId) ? 'selected' : '';
            return `
                <div class="hd-item ${isSelected}" data-track-id="${item.trackId}" onclick="handleHdItemClick(this, '${item.trackId}', event)" style="cursor:pointer;">
                    <div class="hd-checkbox"></div>
                    <img src="${coverUrl}" class="hd-cover" alt="" onerror="this.src='${fallbackCover}';">
                    <div class="hd-details">
                        <div class="hd-title">${escapeHTML(item.title)}</div>
                        <div class="hd-artist">${escapeHTML(artists)}${deviceName}</div>
                    </div>
                    <div class="hd-meta">
                        <div class="hd-time">${timeStr}</div>
                        <div class="hd-duration">⏱️ ${durationStr}</div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="hd-date-group">
                <div class="hd-date-label">${dateLabel} <span class="hd-date-badge">${count} Song${count !== 1 ? 's' : ''}</span></div>
                <div class="hd-grid">${itemsHtml}</div>
            </div>
        `;
    }).join('');
}

function hdResetFilters() {
    ['hd-filter-date', 'hd-filter-time-from', 'hd-filter-time-to', 'hd-filter-artist'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const dur = document.getElementById('hd-filter-duration');
    if (dur) dur.value = '0';
    hdRenderFilteredHistory();
}

function formatDateGroupLabel(date) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

    if (date >= startOfToday) {
        return '📅 Heute';
    } else if (date >= startOfYesterday) {
        return '📅 Gestern';
    } else {
        return '📅 ' + date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' });
    }
}

// ===== AUTO-REFRESH (10 Sekunden / 30 Sekunden in low-powered) =====
let _widgetRefreshInterval = null;

function startWidgetAutoRefresh() {
    stopWidgetAutoRefresh();
    const quality = (typeof animationQuality !== 'undefined') ? animationQuality : 'high';
    const interval = (quality === 'low-powered') ? 30000 : 10000;
    _widgetRefreshInterval = setInterval(() => {
        // Only refresh if the widget container is still in the DOM
        if (document.getElementById('history-container')) {
            initHistoryWidget();
        }
        if (document.getElementById('wrapped-grid-container')) {
            initWrappedWidget();
        }
        if (document.getElementById('history-desktop-container')) {
            if (window._hdSelectionModeActive) {
                // Skip refresh during selection to prevent losing selected items
            } else if (window._currentHdTab === 'excluded') {
                if (typeof loadAndRenderExcludedSongs === 'function') loadAndRenderExcludedSongs();
            } else if (window._currentHdTab === 'skipped') {
                if (typeof loadAndRenderSkippedSongs === 'function') loadAndRenderSkippedSongs();
            } else {
                initHistoryDesktopWidget();
            }
        }
        if (document.getElementById('wrapped-desktop-grid')) {
            initWrappedDesktopWidget();
        }
    }, interval);
}

function stopWidgetAutoRefresh() {
    if (_widgetRefreshInterval) {
        clearInterval(_widgetRefreshInterval);
        _widgetRefreshInterval = null;
    }
}

// ===== 🖱️ CUSTOM CONTEXT MENU FOR EXCLUDING SONGS =====

document.addEventListener('contextmenu', function(e) {
    const songItem = e.target.closest('[data-track-id]');
    if (!songItem) return;

    // Prevent default context menu
    e.preventDefault();

    const trackId = songItem.dataset.trackId;
    if (!trackId || trackId === 'undefined') return;

    // Check if we have selected items in selection mode
    const selectedCount = window._hdSelectedTrackIds ? window._hdSelectedTrackIds.size : 0;
    if (window._hdSelectionModeActive && selectedCount > 0) {
        showHdBulkContextMenu(e.clientX, e.clientY);
        return;
    }

    // Extract song details
    const songTitle = songItem.querySelector('.wd-ranking-name, .wd-recent-title, .hd-title')?.textContent || 'dieser Song';
    
    showWrappedContextMenu(e.clientX, e.clientY, trackId, songTitle);
});

function showWrappedContextMenu(x, y, trackId, songTitle) {
    let menu = document.getElementById('wrapped-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'wrapped-context-menu';
        menu.className = 'wrapped-context-menu';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';
        
        // Dynamisches Styling hinzufügen
        const style = document.createElement('style');
        style.textContent = `
            .wrapped-context-menu {
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
                padding: 6px;
                min-width: 250px;
                display: flex;
                flex-direction: column;
                z-index: 10000;
                animation: wrappedMenuFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes wrappedMenuFadeIn {
                from { opacity: 0; transform: scale(0.96) translateY(-4px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .wrapped-context-item {
                background: none;
                border: none;
                width: 100%;
                text-align: left;
                padding: 10px 14px;
                color: #f1f5f9;
                font-size: 0.85rem;
                font-weight: 600;
                border-radius: 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: background 0.12s ease, color 0.12s ease;
            }
            .wrapped-context-item:hover {
                background: rgba(56, 189, 248, 0.15);
                color: #38bdf8;
            }
            .wrapped-context-item.danger:hover {
                background: rgba(239, 68, 68, 0.15);
                color: #fca5a5;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(menu);
    }
    
    function renderMainMenu() {
        menu.innerHTML = `
            <button class="wrapped-context-item" id="btn-add-to-playlist">
                ➕ Zu Playlist hinzufügen 
                <span style="margin-left: auto;">▶</span>
            </button>
            <button class="wrapped-context-item danger" id="btn-remove-track">
                🗑️ "${escapeHTML(songTitle)}" ausschließen
            </button>
        `;

        menu.querySelector('#btn-remove-track').onclick = async (evt) => {
            evt.stopPropagation();
            menu.style.display = 'none';
            if (confirm(`Möchtest du "${songTitle}" wirklich dauerhaft aus deinem Geschmacksprofil ausschließen?`)) {
                await removeTrackFromHistory(trackId, songTitle);
            }
        };

        menu.querySelector('#btn-add-to-playlist').onclick = async (evt) => {
            evt.stopPropagation();
            menu.innerHTML = `<div style="padding: 10px; color: rgba(255,255,255,0.5); font-size: 0.85rem; text-align: center;">Lade Playlists...</div>`;
            try {
                const res = await fetch('/spotify/playlists?limit=10&t=' + Date.now());
                const data = await res.json();
                if (!res.ok || !data.playlists) throw new Error(data.error || 'Fehler beim Laden');
                
                let html = `<div style="padding: 4px 8px; font-size: 0.75rem; color: rgba(255,255,255,0.4); font-weight: bold; text-transform: uppercase;">Zuletzt gehört</div>`;
                data.playlists.forEach(pl => {
                    html += `
                        <button class="wrapped-context-item" onclick="addTrackToPlaylist('${pl.id}', '${trackId}', '${escapeHTML(pl.name)}')">
                            <img src="${pl.image}" style="width: 24px; height: 24px; border-radius: 4px; object-fit: cover;">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${escapeHTML(pl.name)}</span>
                        </button>
                    `;
                });
                menu.innerHTML = html;
            } catch (err) {
                menu.innerHTML = `<div style="padding: 10px; color: #ff453a; font-size: 0.85rem; text-align: center;">${err.message}</div>`;
            }
        };
    }
    
    renderMainMenu();
    menu.style.display = 'flex';
    
    // Boundary check so the menu stays on screen
    const menuWidth = 250;
    const menuHeight = 250; // allow more height for playlists
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    
    let left = x;
    let top = y;
    
    if (x + menuWidth > winWidth) {
        left = winWidth - menuWidth - 10;
    }
    if (y + menuHeight > winHeight) {
        top = Math.max(10, winHeight - menuHeight - 10);
    }
    
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    
    // Global function to add track
    window.addTrackToPlaylist = async function(playlistId, trId, plName) {
        menu.innerHTML = `<div style="padding: 10px; color: #38bdf8; font-size: 0.85rem; text-align: center;">Hinzufügen...</div>`;
        try {
            const res = await fetch(`/spotify/playlists/${playlistId}/tracks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackId: trId })
            });
            if (!res.ok) throw new Error('Fehler');
            menu.innerHTML = `<div style="padding: 10px; color: #34c759; font-size: 0.85rem; text-align: center;">✅ Hinzugefügt zu ${plName}</div>`;
            setTimeout(() => { menu.style.display = 'none'; }, 1500);
        } catch (e) {
            menu.innerHTML = `<div style="padding: 10px; color: #ff453a; font-size: 0.85rem; text-align: center;">❌ Fehler beim Hinzufügen</div>`;
            setTimeout(() => { menu.style.display = 'none'; }, 2000);
        }
    };
    
    // Dismiss helpers
    const closeMenu = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('wheel', closeMenu);
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('wheel', closeMenu);
    }, 50);
}

async function removeTrackFromHistory(trackId, songTitle) {
    try {
        const res = await fetch('/spotify/history/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId })
        });
        
        if (res.ok) {
            const data = await res.json();
            const count = data.removedCount || 0;
            
            // Show toast notification
            if (typeof showSystemToast === 'function') {
                showSystemToast(`🗑️ ${songTitle} entfernt (${count}x)`, 3000);
            } else {
                console.log(`[Spotify History] Song entfernt: ${songTitle}`);
            }
            
            // Instantly refresh widgets in place
            if (typeof initWrappedDesktopWidget === 'function') {
                initWrappedDesktopWidget();
            }
            if (typeof initHistoryDesktopWidget === 'function') {
                initHistoryDesktopWidget();
            }
        } else {
            const errData = await res.json();
            alert(`Löschen fehlgeschlagen: ${errData.error || 'Unbekannter Fehler'}`);
        }
    } catch (e) {
        console.error('[removeTrackFromHistory] Fehler:', e);
        alert('Netzwerkfehler beim Löschen des Songs.');
    }
}

// ===== ARTIST SONGS MODAL POPUP (Wrapped Desktop) =====
async function showArtistSongsPopup(artistName) {
    if (!artistName) return;

    let modal = document.getElementById('wd-artist-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'wd-artist-modal';
        modal.className = 'wd-modal';
        document.body.appendChild(modal);
    }

    // Set structure and loading state
    modal.innerHTML = `
        <div class="wd-modal-overlay" onclick="closeWdArtistModal()"></div>
        <div class="wd-modal-content">
            <button class="wd-modal-close" onclick="closeWdArtistModal()">×</button>
            <div class="wd-modal-header">
                <span class="wd-modal-icon">🎤</span>
                <h3 id="wd-modal-artist-name">${escapeHTML(artistName)}</h3>
            </div>
            <div class="wd-modal-body" id="wd-modal-song-list">
                <div class="wd-ranking-empty">Lade Songs...</div>
            </div>
        </div>
    `;

    // Display modal and trigger animation
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);

    try {
        const res = await fetch('/spotify/history');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const history = data.history || [];

        // Filter songs by artist
        const artistSongs = history.filter(item => {
            if (Array.isArray(item.artists)) {
                return item.artists.some(a => a.toLowerCase() === artistName.toLowerCase());
            } else if (typeof item.artists === 'string') {
                return item.artists.toLowerCase() === artistName.toLowerCase();
            }
            return false;
        });

        const listContainer = document.getElementById('wd-modal-song-list');
        if (!listContainer) return;

        if (artistSongs.length === 0) {
            listContainer.innerHTML = '<div class="wd-ranking-empty">Keine Songs für diesen Künstler gefunden.</div>';
            return;
        }

        // Group by song
        const songCounts = {};
        artistSongs.forEach(item => {
            const key = item.trackId || item.title;
            if (!songCounts[key]) {
                songCounts[key] = {
                    trackId: item.trackId,
                    title: item.title,
                    albumImg: item.albumImg,
                    plays: 0
                };
            }
            songCounts[key].plays += 1;
        });

        const sortedSongs = Object.values(songCounts).sort((a, b) => b.plays - a.plays);
        const fallbackCover = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2'><circle cx='12' cy='12' r='10'/></svg>";

        listContainer.innerHTML = sortedSongs.map(song => {
            const coverUrl = song.albumImg || fallbackCover;
            const playAction = song.trackId ? `onclick="playSpotifyTrack('${song.trackId}'); event.stopPropagation();"` : '';
            const cursorStyle = song.trackId ? 'style="cursor: pointer;"' : '';
            return `
                <div class="wd-modal-song-item" ${playAction} ${cursorStyle}>
                    <img src="${coverUrl}" class="wd-modal-song-cover" alt="Cover" onerror="this.src='${fallbackCover}';">
                    <div class="wd-modal-song-info">
                        <div class="wd-modal-song-title">${escapeHTML(song.title)}</div>
                        <div class="wd-modal-song-count">${song.plays} Plays</div>
                    </div>
                    <div class="wd-modal-song-badge">${song.plays}x</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('[showArtistSongsPopup] Fehler:', err);
        const listContainer = document.getElementById('wd-modal-song-list');
        if (listContainer) {
            listContainer.innerHTML = '<div class="wd-ranking-empty" style="color: #ff453a;">Fehler beim Laden des Verlaufs.</div>';
        }
    }
}

function closeWdArtistModal() {
    const modal = document.getElementById('wd-artist-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    }
}

// Global exports
window.showArtistSongsPopup = showArtistSongsPopup;
window.closeWdArtistModal = closeWdArtistModal;

async function triggerPlaylistRotation() {
    const btn = document.getElementById('wd-sync-btn');
    if (!btn || btn.classList.contains('spinning')) return;

    btn.classList.add('spinning');
    const label = btn.querySelector('.wd-sync-label');
    const originalText = label ? label.textContent : 'Playlist rotieren';
    if (label) label.textContent = 'Aktualisiere...';

    try {
        const res = await fetch('/spotify/playlist/rotate-now');
        const data = await res.json();
        
        if (res.ok && data.ok) {
            if (typeof showSystemToast === 'function') {
                showSystemToast('🔄 Playlist erfolgreich aktualisiert!', 3000);
            } else {
                alert(data.message || 'Playlist erfolgreich aktualisiert!');
            }
            if (label) label.textContent = 'Aktualisiert!';
            setTimeout(() => {
                if (label) label.textContent = originalText;
            }, 3000);
        } else {
            throw new Error(data.error || 'Fehler beim Aktualisieren');
        }
    } catch (err) {
        console.error('[triggerPlaylistRotation] Fehler:', err);
        alert(`Fehler: ${err.message}`);
        if (label) label.textContent = 'Fehler!';
        setTimeout(() => {
            if (label) label.textContent = originalText;
        }, 3000);
    } finally {
        btn.classList.remove('spinning');
    }
}
window.triggerPlaylistRotation = triggerPlaylistRotation;

// ===== EXCLUDED SONGS & TABS FOR HISTORY DESKTOP =====
window._currentHdTab = 'history';

function switchHdTab(tabName) {
    window._currentHdTab = tabName;
    const historyTabBtn = document.getElementById('hd-tab-history');
    const skippedTabBtn = document.getElementById('hd-tab-skipped');
    const excludedTabBtn = document.getElementById('hd-tab-excluded');
    
    const historyContainer = document.getElementById('history-desktop-container');
    const skippedContainer = document.getElementById('history-skipped-container');
    const excludedContainer = document.getElementById('history-excluded-container');
    
    const filterBar = document.querySelector('.hd-filter-bar');
    const resultInfo = document.getElementById('hd-result-info');

    if (historyTabBtn) historyTabBtn.classList.toggle('active', tabName === 'history');
    if (skippedTabBtn) skippedTabBtn.classList.toggle('active', tabName === 'skipped');
    if (excludedTabBtn) excludedTabBtn.classList.toggle('active', tabName === 'excluded');
    
    if (historyContainer) historyContainer.style.display = (tabName === 'history') ? 'block' : 'none';
    if (skippedContainer) skippedContainer.style.display = (tabName === 'skipped') ? 'block' : 'none';
    if (excludedContainer) excludedContainer.style.display = (tabName === 'excluded') ? 'block' : 'none';
    
    if (filterBar) filterBar.style.display = (tabName === 'history') ? 'flex' : 'none';

    if (tabName === 'history') {
        hdRenderFilteredHistory();
    } else if (tabName === 'excluded') {
        if (resultInfo) resultInfo.classList.remove('visible');
        loadAndRenderExcludedSongs();
    } else if (tabName === 'skipped') {
        if (resultInfo) resultInfo.classList.remove('visible');
        loadAndRenderSkippedSongs();
    }
}
window.switchHdTab = switchHdTab;

async function loadAndRenderSkippedSongs() {
    const container = document.getElementById('history-skipped-container');
    const totalCountEl = document.getElementById('hd-total-count');
    if (!container) return;
    try {
        const response = await fetch('/spotify/skipped');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const skipped = data.skipped || [];
        
        if (totalCountEl) totalCountEl.textContent = `${skipped.length} Einträge`;
        
        if (skipped.length === 0) {
            container.innerHTML = '<div class="hd-empty">Keine übersprungenen Songs gefunden.</div>';
            return;
        }

        const fallbackCover = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2'><circle cx='12' cy='12' r='10'/></svg>";
        
        const itemsHtml = skipped.map(item => {
            const coverUrl = item.albumImg || fallbackCover;
            const artists = Array.isArray(item.artists) ? item.artists.join(', ') : item.artists;
            const date = new Date(item.timestamp);
            const dateStr = date.toLocaleDateString('de-DE') + ' ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="hd-item" style="cursor:default;">
                    <img src="${coverUrl}" class="hd-cover" alt="" onerror="this.src='${fallbackCover}';">
                    <div class="hd-details">
                        <div class="hd-title" style="color: #ff9f0a;">${escapeHTML(item.title)}</div>
                        <div class="hd-artist">${escapeHTML(artists)}</div>
                    </div>
                    <div class="hd-meta">
                        <div class="hd-time">${dateStr}</div>
                        <div class="hd-duration" style="color:#ff453a;">⏱️ ${Math.round(item.listenedMs / 1000)}s gehört</div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `<div class="hd-grid" style="margin-top: 10px;">${itemsHtml}</div>`;
    } catch (err) {
        console.error('[Skipped Songs] Fehler:', err);
        container.innerHTML = '<div class="hd-empty" style="color: #ff453a;">Fehler beim Laden der übersprungenen Songs.</div>';
    }
}

async function loadAndRenderExcludedSongs() {
    const container = document.getElementById('history-excluded-container');
    const totalCountEl = document.getElementById('hd-total-count');
    if (!container) return;

    try {
        const res = await fetch('/spotify/excluded');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const excludedList = data.excluded || [];

        if (totalCountEl) {
            totalCountEl.textContent = `${excludedList.length} ignorierte Songs`;
        }

        if (excludedList.length === 0) {
            container.innerHTML = '<div class="hd-empty">Keine Songs ausgeschlossen 🎵</div>';
            return;
        }

        const fallbackCover = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2'><circle cx='12' cy='12' r='10'/></svg>";

        container.innerHTML = `
            <div class="hd-date-group">
                <div class="hd-grid">
                    ${excludedList.map(item => {
                        const coverUrl = item.albumImg || fallbackCover;
                        const artists = Array.isArray(item.artists) ? item.artists.join(', ') : item.artists;
                        return `
                            <div class="hd-item hd-excluded-item" style="cursor: default;">
                                <img src="${coverUrl}" class="hd-cover" alt="" onerror="this.src='${fallbackCover}';">
                                <div class="hd-details">
                                    <div class="hd-title">${escapeHTML(item.title)}</div>
                                    <div class="hd-artist">${escapeHTML(artists)}</div>
                                </div>
                                <button class="hd-restore-btn" onclick="restoreExcludedTrack('${item.trackId}', event)">Zulassen</button>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    } catch (err) {
        console.error('[Excluded Songs List] Fehler:', err);
        container.innerHTML = '<div class="hd-empty" style="color: #ff453a;">Fehler beim Laden der Liste.</div>';
    }
}
window.loadAndRenderExcludedSongs = loadAndRenderExcludedSongs;

async function restoreExcludedTrack(trackId, event) {
    if (event) event.stopPropagation();
    try {
        const res = await fetch('/spotify/excluded/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId })
        });
        if (res.ok) {
            if (typeof showSystemToast === 'function') {
                showSystemToast('🎵 Song wieder zugelassen!', 3000);
            }
            loadAndRenderExcludedSongs();
        } else {
            const err = await res.json();
            alert(`Fehler: ${err.error || 'Aktion fehlgeschlagen'}`);
        }
    } catch (err) {
        console.error('[restoreExcludedTrack] Fehler:', err);
        alert('Netzwerkfehler.');
    }
}
window.restoreExcludedTrack = restoreExcludedTrack;

// ===== BULK SELECTION MODE LOGIC FOR HISTORY DESKTOP =====
window._hdSelectionModeActive = false;
window._hdSelectedTrackIds = new Set();

function toggleSelectionMode(forceState) {
    const wrapper = document.querySelector('.history-desktop-wrapper');
    if (!wrapper) return;

    const btn = document.getElementById('hd-selection-mode-btn');
    const actionsBar = document.querySelector('.hd-selection-actions');

    const newState = typeof forceState === 'boolean' ? forceState : !window._hdSelectionModeActive;
    window._hdSelectionModeActive = newState;

    if (newState) {
        wrapper.classList.add('selection-mode-active');
        if (btn) {
            btn.textContent = 'Fertig';
            btn.style.background = 'rgba(29, 185, 84, 0.15)';
            btn.style.borderColor = 'rgba(29, 185, 84, 0.3)';
            btn.style.color = '#1db954';
        }
        if (actionsBar) actionsBar.style.display = 'flex';
        window._hdSelectedTrackIds = new Set();
        updateSelectionCountLabel();
    } else {
        wrapper.classList.remove('selection-mode-active');
        if (btn) {
            btn.textContent = 'Auswahl';
            btn.style.background = 'rgba(56, 189, 248, 0.15)';
            btn.style.borderColor = 'rgba(56, 189, 248, 0.3)';
            btn.style.color = '#38bdf8';
        }
        if (actionsBar) actionsBar.style.display = 'none';
        
        // Remove .selected class from all items
        document.querySelectorAll('.hd-item.selected').forEach(el => el.classList.remove('selected'));
        window._hdSelectedTrackIds = new Set();
    }
}
window.toggleSelectionMode = toggleSelectionMode;

function handleHdItemClick(element, trackId, event) {
    if (window._hdSelectionModeActive) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        toggleHdItemSelection(element);
        return;
    }
    playSpotifyTrack(trackId);
}
window.handleHdItemClick = handleHdItemClick;

function toggleHdItemSelection(element) {
    const trackId = element.dataset.trackId;
    if (!trackId || trackId === 'undefined') return;

    if (window._hdSelectedTrackIds.has(trackId)) {
        window._hdSelectedTrackIds.delete(trackId);
        // Find all items with this trackId in the DOM and deselect them
        document.querySelectorAll(`.hd-item[data-track-id="${trackId}"]`).forEach(el => el.classList.remove('selected'));
    } else {
        window._hdSelectedTrackIds.add(trackId);
        // Find all items with this trackId in the DOM and select them
        document.querySelectorAll(`.hd-item[data-track-id="${trackId}"]`).forEach(el => el.classList.add('selected'));
    }
    updateSelectionCountLabel();
}
window.toggleHdItemSelection = toggleHdItemSelection;

function updateSelectionCountLabel() {
    const label = document.getElementById('hd-selection-count');
    if (label) {
        const count = window._hdSelectedTrackIds ? window._hdSelectedTrackIds.size : 0;
        label.textContent = `${count} ausgewählt`;
    }
}
window.updateSelectionCountLabel = updateSelectionCountLabel;

function hdSelectAll() {
    const container = document.getElementById('history-desktop-container');
    if (!container) return;
    const items = container.querySelectorAll('.hd-item[data-track-id]');
    items.forEach(item => {
        const trackId = item.dataset.trackId;
        if (trackId && trackId !== 'undefined') {
            window._hdSelectedTrackIds.add(trackId);
            item.classList.add('selected');
        }
    });
    updateSelectionCountLabel();
}
window.hdSelectAll = hdSelectAll;

function hdDeselectAll() {
    const container = document.getElementById('history-desktop-container');
    if (!container) return;
    const items = container.querySelectorAll('.hd-item[data-track-id]');
    items.forEach(item => {
        item.classList.remove('selected');
    });
    window._hdSelectedTrackIds.clear();
    updateSelectionCountLabel();
}
window.hdDeselectAll = hdDeselectAll;

function showHdBulkContextMenu(x, y) {
    let menu = document.getElementById('wrapped-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'wrapped-context-menu';
        menu.className = 'wrapped-context-menu';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';
        
        // Dynamisches Styling hinzufügen (already added in showWrappedContextMenu, but ensuring it is loaded)
        const style = document.createElement('style');
        style.textContent = `
            .wrapped-context-menu {
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
                padding: 6px;
                min-width: 250px;
                display: flex;
                flex-direction: column;
                z-index: 10000;
                animation: wrappedMenuFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes wrappedMenuFadeIn {
                from { opacity: 0; transform: scale(0.96) translateY(-4px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .wrapped-context-item {
                background: none;
                border: none;
                width: 100%;
                text-align: left;
                padding: 10px 14px;
                color: #f1f5f9;
                font-size: 0.85rem;
                font-weight: 600;
                border-radius: 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: background 0.12s ease, color 0.12s ease;
            }
            .wrapped-context-item:hover {
                background: rgba(239, 68, 68, 0.15);
                color: #fca5a5;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(menu);
    }
    
    const count = window._hdSelectedTrackIds.size;
    menu.innerHTML = `
        <button class="wrapped-context-item" id="btn-bulk-ignore">
            🚫 ${count} ausgewählte ignorieren
        </button>
        <button class="wrapped-context-item" id="btn-bulk-delete" style="color: #ff453a;">
            🗑️ ${count} ausgewählte löschen
        </button>
    `;
    
    menu.style.display = 'flex';
    
    const menuWidth = 250;
    const menuHeight = 88;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    
    let left = x;
    let top = y;
    
    if (x + menuWidth > winWidth) {
        left = winWidth - menuWidth - 10;
    }
    if (y + menuHeight > winHeight) {
        top = winHeight - menuHeight - 10;
    }
    
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    
    // Action handlers
    menu.querySelector('#btn-bulk-ignore').onclick = function(evt) {
        bulkIgnoreSelected(evt);
    };
    menu.querySelector('#btn-bulk-delete').onclick = function(evt) {
        bulkDeleteSelected(evt);
    };
    
    const closeMenu = () => {
        menu.style.display = 'none';
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('wheel', closeMenu);
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('wheel', closeMenu);
    }, 50);
}
window.showHdBulkContextMenu = showHdBulkContextMenu;

async function bulkIgnoreSelected(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('wrapped-context-menu');
    if (menu) menu.style.display = 'none';

    const trackIds = Array.from(window._hdSelectedTrackIds);
    if (trackIds.length === 0) return;

    if (confirm(`Möchtest du die ${trackIds.length} ausgewählten Songs dauerhaft ignorieren und aus dem Verlauf löschen?`)) {
        try {
            const res = await fetch('/spotify/history/exclude-multiple', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackIds })
            });
            if (res.ok) {
                if (typeof showSystemToast === 'function') {
                    showSystemToast(`🚫 ${trackIds.length} Songs ignoriert`, 3000);
                }
                window._hdSelectedTrackIds.clear();
                toggleSelectionMode(false);
                initHistoryDesktopWidget();
            } else {
                alert('Ausschluss fehlgeschlagen.');
            }
        } catch (err) {
            console.error(err);
            alert('Netzwerkfehler.');
        }
    }
}
window.bulkIgnoreSelected = bulkIgnoreSelected;

async function bulkDeleteSelected(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('wrapped-context-menu');
    if (menu) menu.style.display = 'none';

    const trackIds = Array.from(window._hdSelectedTrackIds);
    if (trackIds.length === 0) return;

    if (confirm(`Möchtest du die ${trackIds.length} ausgewählten Songs wirklich dauerhaft aus dem Verlauf löschen?`)) {
        try {
            const res = await fetch('/spotify/history/remove-multiple', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackIds })
            });
            if (res.ok) {
                if (typeof showSystemToast === 'function') {
                    showSystemToast(`🗑️ ${trackIds.length} Songs gelöscht`, 3000);
                }
                window._hdSelectedTrackIds.clear();
                toggleSelectionMode(false);
                initHistoryDesktopWidget();
            } else {
                alert('Löschen fehlgeschlagen.');
            }
        } catch (err) {
            console.error(err);
            alert('Netzwerkfehler.');
        }
    }
}
window.bulkDeleteSelected = bulkDeleteSelected;


