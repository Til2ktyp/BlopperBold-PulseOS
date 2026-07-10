let customMixTopArtists = [];
let customMixSelectedArtists = new Set();
let customMixPlaylists = [];

async function loadCustomMixPlaylists() {
    try {
        const response = await fetch('/spotify/pulseos-playlists');
        if (response.ok) {
            const data = await response.json();
            customMixPlaylists = data.playlists || [];
            renderCustomMixPlaylists();
        }
    } catch (err) {
        console.error('[loadCustomMixPlaylists] Fehler:', err);
    }
}

function renderCustomMixPlaylists() {
    const grid = document.getElementById('custom-mix-grid');
    if (!grid) return;
    
    // Keep the first two static cards (Highlights, Neu erstellen)
    // Actually, we want: Highlights -> Playlists -> Neu erstellen (ganz rechts)
    // We assume the first child is Highlights, and the second is Neu erstellen.
    const children = Array.from(grid.children);
    const highlightsCard = children.find(c => c.textContent.includes('Highlights')) || children[0];
    const createNewCard = children.find(c => c.textContent.includes('Neu')) || children[1];
    
    grid.innerHTML = '';
    if (highlightsCard) grid.appendChild(highlightsCard);
    
    customMixPlaylists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'custom-mix-card';
        card.onclick = () => playSpotifyContext(pl.uri);
        card.oncontextmenu = (e) => showCustomMixContextMenu(e, pl.id);
        
        let imgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#333"/></svg>');
        if (pl.images && pl.images.length > 0) {
            imgUrl = pl.images[0].url;
        }
        
        card.innerHTML = `
            <div class="custom-mix-card-inner">
                <img src="${imgUrl}" alt="Cover" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">
            </div>
            <div class="custom-mix-text">${escapeHTML(pl.name)}</div>
        `;
        grid.appendChild(card);
    });
    
    if (createNewCard) grid.appendChild(createNewCard);
}

function playSpotifyContext(uri) {
    fetch('/spotify/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_uri: uri })
    }).catch(err => console.error(err));
}

function playHighlightsPlaylist() {
    fetch('/spotify/playlists').then(r => r.json()).then(data => {
        const hl = data.playlists.find(p => p.name === 'PulseOS Highlights');
        if (hl) playSpotifyContext(hl.uri);
    });
}

async function openCustomMixModal() {
    document.getElementById('custom-mix-modal').style.display = 'flex';
    customMixSelectedArtists.clear();
    document.getElementById('custom-mix-search').value = '';
    document.getElementById('custom-mix-name-input').value = '';
    updateCustomMixSelectionCount();
    
    const grid = document.getElementById('custom-mix-artists-grid');
    grid.innerHTML = '<div style="color:white;text-align:center;width:100%;grid-column:1/-1;">Lade Künstler aus History...</div>';
    
    try {
        const response = await fetch('/spotify/top-artists-custom');
        const data = await response.json();
        customMixTopArtists = data.artists || [];
        renderCustomMixArtists(customMixTopArtists);
    } catch (err) {
        console.error(err);
        grid.innerHTML = '<div style="color:red;text-align:center;width:100%;grid-column:1/-1;">Fehler beim Laden der Künstler.</div>';
    }
}

function closeCustomMixModal() {
    document.getElementById('custom-mix-modal').style.display = 'none';
}

function renderCustomMixArtists(artists) {
    const grid = document.getElementById('custom-mix-artists-grid');
    grid.innerHTML = '';
    
    if (artists.length === 0) {
        grid.innerHTML = '<div style="color:white;text-align:center;width:100%;grid-column:1/-1;">Keine Künstler in History gefunden.</div>';
        return;
    }

    artists.forEach(artist => {
        const div = document.createElement('div');
        div.className = 'custom-mix-artist-card';
        if (customMixSelectedArtists.has(artist.name)) div.classList.add('selected');
        
        div.onclick = () => toggleCustomMixArtistSelection(artist.name, div);
        
        const imgUrl = artist.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/></svg>';
        
        div.innerHTML = `
            <img src="${imgUrl}" alt="${escapeHTML(artist.name)}">
            <div class="name">${escapeHTML(artist.name)}</div>
            <div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
        `;
        grid.appendChild(div);
    });
}

function filterCustomMixArtists() {
    const query = document.getElementById('custom-mix-search').value.toLowerCase();
    const filtered = customMixTopArtists.filter(a => a.name.toLowerCase().includes(query));
    renderCustomMixArtists(filtered);
}

function toggleCustomMixArtistSelection(name, el) {
    if (customMixSelectedArtists.has(name)) {
        customMixSelectedArtists.delete(name);
        el.classList.remove('selected');
    } else {
        customMixSelectedArtists.add(name);
        el.classList.add('selected');
    }
    updateCustomMixSelectionCount();
}

function updateCustomMixSelectionCount() {
    const countEl = document.getElementById('custom-mix-selection-count');
    const btn = document.getElementById('custom-mix-generate-btn');
    countEl.textContent = `${customMixSelectedArtists.size} Künstler ausgewählt`;
    
    if (customMixSelectedArtists.size > 0) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    }
}

async function generatePulseOsCustomMix() {
    if (customMixSelectedArtists.size === 0) return;
    
    const overlay = document.getElementById('custom-mix-loading-overlay');
    overlay.style.display = 'flex';
    
    const nameInput = document.getElementById('custom-mix-name-input').value.trim() || 'Mix';
    const playlistName = `PulseOS ${nameInput}`;
    const fillWithRandom = document.getElementById('custom-mix-fill-toggle') ? document.getElementById('custom-mix-fill-toggle').checked : false;
    
    try {
        const response = await fetch('/spotify/generate-custom-mix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                seedArtistNames: Array.from(customMixSelectedArtists),
                playlistName: playlistName,
                fillWithRandom: fillWithRandom
            })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            if (data.addedTracks && data.addedTracks.length > 0) {
                // Show Progress Bar
                document.getElementById('custom-mix-initial-loader').style.display = 'none';
                document.getElementById('custom-mix-progress-container').style.display = 'block';
                
                const progressText = document.getElementById('custom-mix-progress-text');
                const progressBarFill = document.getElementById('custom-mix-progress-bar-fill');
                const totalTracks = data.addedTracks.length;
                
                for (let i = 0; i < totalTracks; i++) {
                    await new Promise(r => setTimeout(r, 60)); // 60ms delay per track for cool visual effect
                    const trackName = data.addedTracks[i].toUpperCase();
                    progressText.innerText = `(${i + 1}/${totalTracks} ${trackName})`;
                    progressBarFill.style.width = `${((i + 1) / totalTracks) * 100}%`;
                }
                
                // Wait slightly after reaching 100%
                await new Promise(r => setTimeout(r, 400));
            }
            
            closeCustomMixModal();
            
            // Reset overlay for next time
            setTimeout(() => {
                const initLoader = document.getElementById('custom-mix-initial-loader');
                const progContainer = document.getElementById('custom-mix-progress-container');
                if(initLoader) initLoader.style.display = 'flex';
                if(progContainer) progContainer.style.display = 'none';
                overlay.style.display = 'none';
            }, 500);

            loadCustomMixPlaylists();
            
            if (data.playlistUri) {
                playSpotifyContext(data.playlistUri);
            }
        } else {
            alert('Fehler beim Erstellen der Playlist: ' + data.error);
            overlay.style.display = 'none';
        }
    } catch (err) {
        console.error(err);
        alert('Fehler beim Erstellen der Playlist: ' + err);
        overlay.style.display = 'none';
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
    loadCustomMixPlaylists();
});

let currentContextMenuPlaylistId = null;

function showCustomMixContextMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    currentContextMenuPlaylistId = id;
    
    const menu = document.getElementById('custom-mix-context-menu');
    if (!menu) return;
    
    menu.style.display = 'flex';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
}

document.addEventListener('click', () => {
    const menu = document.getElementById('custom-mix-context-menu');
    if (menu) menu.style.display = 'none';
});

async function renameCustomMix() {
    if (!currentContextMenuPlaylistId) return;
    
    const newName = prompt('Bitte neuen Namen für den Mix eingeben:');
    if (!newName || newName.trim() === '') return;
    
    try {
        const res = await fetch(`/spotify/playlists/${currentContextMenuPlaylistId}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName.trim() })
        });
        if (res.ok) {
            await loadCustomMixPlaylists();
        } else {
            alert('Fehler beim Umbenennen');
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteCustomMix() {
    if (!currentContextMenuPlaylistId) return;
    
    if (!confirm('Möchtest du diese Playlist wirklich löschen?')) return;
    
    try {
        const res = await fetch(`/spotify/playlists/${currentContextMenuPlaylistId}/delete`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await loadCustomMixPlaylists();
        } else {
            alert('Fehler beim Löschen');
        }
    } catch (err) {
        console.error(err);
    }
}
