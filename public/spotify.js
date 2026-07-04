async function getSpotifyWebPlaybackAccessToken() {
  const response = await fetch('/spotify-token');
  const data = await response.json();

  if (!response.ok || !data.accessToken) {
    throw new Error(data.error || 'Spotify Access Token fehlt');
  }

  return data.accessToken;
}

async function getSpotifyWebPlaybackDeviceName() {
  try {
    const response = await fetch('/spotify-device-name');
    const data = await response.json();
    return data.name || 'PulseOS';
  } catch (error) {
    console.error('[Spotify SDK] Device-Name konnte nicht geladen werden:', error.message);
    return 'PulseOS';
  }
}

window.onSpotifyWebPlaybackSDKReady = async () => {
  if (window.pulseSpotifyPlayer) {
    console.log('[Spotify SDK] Player existiert bereits');
    return;
  }

  const deviceName = await getSpotifyWebPlaybackDeviceName();

  const player = new Spotify.Player({
    name: deviceName,
    getOAuthToken: async cb => {
      try {
        const accessToken = await getSpotifyWebPlaybackAccessToken();
        cb(accessToken);
      } catch (error) {
        console.error('[Spotify SDK] Token Fehler:', error.message);
      }
    },
    volume: 1
  });

  window.pulseSpotifyPlayer = player;

  const refreshSpotifyCacheAfterControl = async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      const response = await fetch(`/spotify/refresh?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.currentPlayback && typeof applySpotifyData === 'function') {
        applySpotifyData(data.currentPlayback);
      }
      console.log('[Spotify SDK] Cache nach Control aktualisiert');
    } catch (error) {
      console.error('[Spotify SDK] Cache-Refresh fehlgeschlagen:', error.message);
    }
  };

  const activatePlayer = async () => {
    return player.activateElement()
      .then(() => {
        window.pulseSpotifyActivated = true;
        console.log('[Spotify SDK] Browser-Audio aktiviert');
      })
      .catch(error => {
        console.error('[Spotify SDK] Aktivierung fehlgeschlagen:', error.message);
      });
  };

  const remoteSpotifyControl = async action => {
    const response = await fetch('/spotify/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = data.error || message;
      } catch (error) {
        console.error('[Spotify SDK] Control-Antwort konnte nicht gelesen werden:', error.message);
      }
      throw new Error(message);
    }
  };

  window.pulseSpotifyTogglePlay = async event => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      await activatePlayer();
      await player.togglePlay();
      console.log('[Spotify SDK] Toggle Play/Pause');
      await remoteSpotifyControl('toggle');
      console.log('[Spotify API] Toggle Play/Pause');
      refreshSpotifyCacheAfterControl();
    } catch (error) {
      console.error('[Spotify API] Toggle Play/Pause fehlgeschlagen:', error.message);
    }
  };

  window.pulseSpotifyPreviousTrack = async event => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      await activatePlayer();
      await remoteSpotifyControl('previous');
      console.log('[Spotify API] Vorheriger Song');
      refreshSpotifyCacheAfterControl();
    } catch (error) {
      console.error('[Spotify API] Vorheriger Song fehlgeschlagen:', error.message);
    }
  };

  window.pulseSpotifyNextTrack = async event => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      await activatePlayer();
      await remoteSpotifyControl('next');
      console.log('[Spotify API] Nächster Song');
      refreshSpotifyCacheAfterControl();
    } catch (error) {
      console.error('[Spotify API] Nächster Song fehlgeschlagen:', error.message);
    }
  };

  const getToggleButtons = () => document.querySelectorAll('[data-spotify-toggle-play]');
  const updateToggleButtons = label => {
    let svgHtml = '';
    if (label === '⏸') {
      svgHtml = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    } else {
      svgHtml = '<svg id="spotify-play-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }

    getToggleButtons().forEach(button => {
      if (button.classList.contains('spotify-quick-toggle')) {
        const textLabel = label === '⏸' ? 'Pause' : 'Play';
        button.textContent = `${textLabel} Spotify`;
      } else {
        button.innerHTML = svgHtml;
      }
    });
  };

  document.addEventListener('click', event => {
    const toggleButton = event.target.closest('[data-spotify-toggle-play]');
    const previousButton = event.target.closest('[data-spotify-previous-track]');
    const nextButton = event.target.closest('[data-spotify-next-track]');

    if (toggleButton) return window.pulseSpotifyTogglePlay(event);
    if (previousButton) return window.pulseSpotifyPreviousTrack(event);
    if (nextButton) return window.pulseSpotifyNextTrack(event);
  });

  document.addEventListener('pointerdown', event => {
    if (event.target.closest('[data-spotify-toggle-play], [data-spotify-previous-track], [data-spotify-next-track]')) {
      event.stopPropagation();
    }
  });

  document.addEventListener('pointerdown', activatePlayer, { once: true });
  document.addEventListener('keydown', activatePlayer, { once: true });

  player.addListener('ready', async ({ device_id }) => {
    console.log('Device ID:', device_id);
    window.pulseSpotifyDeviceId = device_id;
    console.log(`[Spotify SDK] ${deviceName} ist als Spotify-Gerät verfügbar`);

    try {
      await activatePlayer();
      const state = await player.getCurrentState();
      if (state && state.paused) {
        await player.togglePlay();
        console.log('[Spotify SDK] Auto-Start ausgeführt');
      }
    } catch (error) {
      console.log('[Spotify SDK] Auto-Start blockiert:', error.message);
    }
  });

  player.addListener('not_ready', ({ device_id }) => {
    console.log('Device ID offline:', device_id);
  });

  player.addListener('initialization_error', ({ message }) => {
    console.error('[Spotify SDK] Initialisierung fehlgeschlagen:', message);
  });

  player.addListener('authentication_error', ({ message }) => {
    console.error('[Spotify SDK] Authentifizierung fehlgeschlagen:', message);
  });

  player.addListener('account_error', ({ message }) => {
    console.error('[Spotify SDK] Account Fehler:', message);
  });

  player.addListener('playback_error', ({ message }) => {
    console.error('[Spotify SDK] Playback Fehler:', message);
  });

  player.addListener('player_state_changed', state => {
    if (!state) {
      console.log('[Spotify SDK] Kein Player-State');
      updateToggleButtons('⏯');
      return;
    }

    const track = state.track_window?.current_track;
    updateToggleButtons(state.paused ? '▶' : '⏸');

    console.log('[Spotify SDK] State:', {
      paused: state.paused,
      position: state.position,
      track: track ? `${track.name} - ${track.artists.map(artist => artist.name).join(', ')}` : null
    });
  });

  window.pulseSpotifyDebug = async () => {
    const state = await player.getCurrentState();
    console.log('[Spotify SDK] Debug:', {
      activated: window.pulseSpotifyActivated === true,
      deviceId: window.pulseSpotifyDeviceId || null,
      state
    });
  };

  player.connect();
};
