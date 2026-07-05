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
async function initWrappedDesktopWidget() {
    try {
        const [statsRes, historyRes] = await Promise.all([
            fetch('/spotify/stats'),
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
        const grid = document.getElementById('wrapped-desktop-grid');

        if (statToday) statToday.textContent = data.totalTimeTodayMinutes || 0;
        if (statAlltime) statAlltime.textContent = data.totalTimeAllTimeHours || 0;

        // Total songs & unique artists from top data
        const totalSongs = data.totalPlaysCount || (data.topTracks || []).reduce((sum, t) => sum + t.plays, 0);
        const uniqueArtists = data.uniqueArtistsCount || (data.topArtists || []).length;
        
        const totalMinutes = typeof data.totalTimeAllTimeMinutes !== 'undefined'
            ? data.totalTimeAllTimeMinutes
            : (data.totalTimeAllTimeHours ? data.totalTimeAllTimeHours * 60 : (data.totalTimeTodayMinutes || 0));
        const avgVal = totalSongs > 0 ? totalMinutes / totalSongs : 0;
        const avgPerSong = avgVal % 1 === 0 ? avgVal : avgVal.toFixed(1);

        if (statSongs) statSongs.textContent = totalSongs;
        if (statArtists) statArtists.textContent = uniqueArtists;
        if (statAvg) statAvg.textContent = avgPerSong;

        if (chartContainer) renderDesktopChart(chartContainer, data.dailyListenTime || []);
        if (artistsContainer) renderDesktopArtists(artistsContainer, data.topArtists || []);
        if (songsContainer) renderDesktopSongs(songsContainer, data.topTracks || []);
        if (playlistsContainer) renderDesktopPlaylists(playlistsContainer, data.topPlaylists || []);
        if (recentContainer) renderDesktopRecent(recentContainer, historyData.history || []);

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

function renderDesktopChart(container, dailyData) {
    if (dailyData.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Keine täglichen Daten vorhanden</div>';
        return;
    }
    const maxVal = Math.max(...dailyData.map(d => d.minutes), 1);
    const existingBars = container.querySelectorAll('.wd-chart-bar-wrapper');

    if (existingBars.length === dailyData.length) {
        dailyData.forEach((d, index) => {
            const barWrapper = existingBars[index];
            const bar = barWrapper.querySelector('.wd-chart-bar');
            const tooltip = barWrapper.querySelector('.wd-chart-bar-tooltip');
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

    container.innerHTML = dailyData.map(d => {
        const heightPercent = Math.max(5, (d.minutes / maxVal) * 90);
        const date = new Date(d.date);
        const dayLabel = date.toLocaleDateString('de-DE', { weekday: 'short' });
        return `
            <div class="wd-chart-bar-wrapper">
                <div class="wd-chart-bar" style="height: 0%;" data-height="${heightPercent}%">
                    <div class="wd-chart-bar-tooltip">${d.minutes} Min.</div>
                </div>
                <div class="wd-chart-bar-label">${dayLabel}</div>
            </div>
        `;
    }).join('');
    setTimeout(() => {
        container.querySelectorAll('.wd-chart-bar').forEach(bar => {
            bar.style.height = bar.getAttribute('data-height');
        });
    }, 100);
}

function renderDesktopArtists(container, artists) {
    if (artists.length === 0) {
        container.innerHTML = '<div class="wd-ranking-empty">Noch keine Daten verfügbar</div>';
        return;
    }
    container.innerHTML = artists.map((artist, index) => {
        const displayTime = Math.round(artist.durationMs / 60000);
        return `
            <div class="wd-ranking-item">
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
        return `
            <div class="wd-recent-item" data-track-id="${item.trackId}" onclick="playSpotifyTrack('${item.trackId}')" style="cursor:pointer;">
                <img src="${coverUrl}" class="wd-recent-cover" alt="" onerror="this.src='${fallbackCover}';">
                <div class="wd-recent-info">
                    <div class="wd-recent-title">${escapeHTML(item.title)}</div>
                    <div class="wd-recent-artist">${escapeHTML(artists)}${playlistInfo}</div>
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

            return `
                <div class="hd-item" data-track-id="${item.trackId}" onclick="playSpotifyTrack('${item.trackId}')" style="cursor:pointer;">
                    <img src="${coverUrl}" class="hd-cover" alt="" onerror="this.src='${fallbackCover}';">
                    <div class="hd-details">
                        <div class="hd-title">${escapeHTML(item.title)}</div>
                        <div class="hd-artist">${escapeHTML(artists)}</div>
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
            initHistoryDesktopWidget();
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
                background: rgba(239, 68, 68, 0.15);
                color: #fca5a5;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(menu);
    }
    
    menu.innerHTML = `
        <button class="wrapped-context-item" id="btn-remove-track">
            🗑️ "${escapeHTML(songTitle)}" ausschließen
        </button>
    `;
    
    menu.style.display = 'flex';
    
    // Boundary check so the menu stays on screen
    const menuWidth = 250;
    const menuHeight = 44;
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
    
    // Action handler
    const btn = menu.querySelector('#btn-remove-track');
    btn.onclick = async function(evt) {
        evt.stopPropagation();
        menu.style.display = 'none';
        
        if (confirm(`Möchtest du "${songTitle}" wirklich dauerhaft aus deinem Geschmacksprofil ausschließen?`)) {
            await removeTrackFromHistory(trackId, songTitle);
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
