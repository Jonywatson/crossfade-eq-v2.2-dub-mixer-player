// Line 1 of app.js - capture from file input
window.capturedTracks = [];

// === DEBUG LOGGER ===
const DEBUG = false; // Set to true when John Breaker needs to investigate
const log = (...args) => DEBUG && console.log(...args);
const warn = (...args) => DEBUG && console.warn(...args);
const error = (...args) => console.error(...args); // Always show errors
// ====================


console.log('Crossfade Player v2.2.8 - EQ Fix + AbortError + Crossfade Art');

// ===== 1. STATE + DOM =====

// === Canvas + Spectrum Globals === 
const canvas = document.getElementById('spectrum'); // match your canvas id
const ctx = canvas.getContext('2d');
const barCount = 128; // or however many bars you want
const DEFAULT_ART = 'assets/default-art.svg';

let audioFileInput = null;
let songs = [], currentIdx = -1;
let repeatMode = 0; // 0=off, 1=all, 2=one
let isShuffling = false, shuffleOrder = [], shufflePosition = 0;
let audioCtx = null, analyser = null, eqChain = [], activeGain, nextGain, isCrossfading = false;
let spectrumRunning = false; 
let animId = null;
let dataArray; // ADD THIS
let crossfadeMs = 5000, lastVolume = 1, waveformData = [];
let isHandlingEnded = false;
let currentSwipeTarget = null;
let crossfadeLock = -1; // -1 = idle, else = idx we're actively fading to
let vuCanvas, vuCtx, vuAnimationId;
let wakeLock = null;
let mediaSessionReady = false;
let activeAudio = null; 
let audio = null; 
let nextAudio = null; 
let audioNext = null;
let isShuffle = false;
let clickCount = 0;
let touchStartX = 0;
let touchEndX = 0;
let touchStartY = 0;
let isSwiping = false;
let touchStartTime = 0;
let lastTouchX = 0;
let velocity = 0;
let audioContext, source, filters = [];


const swipeThreshold = 50; 
const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const audioEl = document.getElementById('audio');
const audioNextEl = document.getElementById('audio-next');
const playBtn = document.getElementById('play'), prevBtn = document.getElementById('prev'), nextBtn = document.getElementById('next');
const shuffleBtn = document.getElementById('shuffle'), repeatBtn = document.getElementById('repeat');
const eqBtn = document.getElementById('eq-btn'), eqDrawer = document.getElementById('eq-drawer'), eqClose = document.getElementById('eq-close');
const eqPreset = document.getElementById('eq-preset'), eqPresetDrawer = document.getElementById('eq-preset-drawer');
const eqReset = document.getElementById('eq-reset');
const fileInput = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');
const backupBtn = document.getElementById('backup-btn');  // add this here
const restoreBtn = document.getElementById('restore-btn'); // add this too for later
const restoreInput = document.getElementById('restore-input'); // add this too for later
const matchBtn = document.getElementById('matchBtn');
const addSongsBtn = document.getElementById('add-songs-btn'); // THIS IS YOUR BUTTON
const addFolderBtn = document.getElementById('add-folder-btn');
log('fileInput found:')
const volume = document.getElementById('volume'), volumeBtn = document.getElementById('volume-btn');
const timer = document.getElementById('timer'), waveformCanvas = document.getElementById('waveform');
const fadeSlider = document.getElementById('fade-slider'), fadeTimeLabel = document.getElementById('fade-time');
const miniBtn = document.getElementById('miniBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');

crossfadeMs = parseInt(fadeSlider.value);


const deleteStuckBtn = document.getElementById('delete-stuck');
const songList = document.getElementById('song-list'), searchInput = document.getElementById('search');
const nowTitle = document.getElementById('now-title'), nowArtist = document.getElementById('now-artist'); 
const albumArt = document.getElementById('album-art');
const playerContainer = document.querySelector('.album-art-container');


// FIX 1: Correct EQ preset length
const EQ_PRESETS = {
  flat: [0,0,0,0,0,0,0,0,0,0],
  bass: [8,6,4,2,0,0,-1,-2,-2,-3],
  rock: [5,4,2,-1,-2,-1,1,3,4,5],
  pop: [-2,0,2,3,2,1,1,2,0,-1],
  vocal: [-3,-2,0,2,4,5,4,2,0,-1],
  electronic: [4,5,3,1,0,-1,1,3,5,6]
};

function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:6px;z-index:9999;opacity:0;transition:0.3s';
  document.body.appendChild(toast);
  setTimeout(() => toast.style.opacity = 1, 10);
  setTimeout(() => {toast.style.opacity = 0; setTimeout(() => toast.remove(), 300)}, 2000);
}

  async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      log('🔋 Screen wake lock active');
      
      wakeLock.addEventListener('release', () => {
        console.log('🔋 Wake lock released');
        if (!activeAudio.paused) requestWakeLock();
      });
    }
  } catch (err) {
    console.log(`Wake lock failed: ${err.name}`);
  }
}

async function releaseWakeLock() {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  
  const trackName = activeAudio.dataset.title || 'Rasta Spectrum';
  const artistName = activeAudio.dataset.artist || 'Live';
  
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackName,
      artist: artistName,
      artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
    });
    
    // iOS requires these handlers
    navigator.mediaSession.setActionHandler('play', () => activeAudio.play());
    navigator.mediaSession.setActionHandler('pause', () => activeAudio.pause());
    
    mediaSessionReady = true;
  } catch (err) {
    console.log('Media Session failed:', err);
  }
}

addSongsBtn.addEventListener('click', () => {
  clickCount++;
  log('Add Songs clicked #', clickCount);
  fileInput.click();
});


fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files).filter(f => /\.(mp3|m4a|flac|ogg|wav|aac)$/i.test(f.name));
  if (!files.length) {
    e.target.value = '';
    return;
  }

  // Revoke old blob URLs first
  songs.forEach(s => {
  if (s.src?.startsWith('blob:')) URL.revokeObjectURL(s.src);
  if (s.artUrl?.startsWith('blob:') && s.artUrl !== DEFAULT_ART) URL.revokeObjectURL(s.artUrl);
});

  const newSongs = await Promise.all(files.map(async file => {
    const meta = await readTags(file); // rename 'tags' to 'meta' to avoid confusion
    
    return {
      id: crypto.randomUUID(),
      title: meta.title || file.name.replace(/\.[^/.]+$/, ""), // ✅ use meta
      artist: meta.artist || "Unknown", // ✅ use meta
      album: meta.album || "", // ✅ use meta
      src: URL.createObjectURL(file),
      file: file,
      artUrl: meta.artUrl
    };
  }));

  songs.push(...newSongs);
  currentIdx = -1; // reset so user must click
  renderPlaylist();
  e.target.value = '';

  if (isShuffling) generateShuffleOrder();
  log(`Added ${newSongs.length} tracks`); // add this to confirm/ No loadSong here
});

folderInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files).filter(f => /\.(mp3|m4a|flac|ogg|wav|aac)$/i.test(f.name));
  if (!files.length) {
    e.target.value = '';
    return;
  }

  // Revoke old blob URLs first
  songs.forEach(s => {
    if (s.src?.startsWith('blob:')) URL.revokeObjectURL(s.src);
    if (s.artUrl?.startsWith('blob:') && s.artUrl !== DEFAULT_ART) URL.revokeObjectURL(s.artUrl);
  });

  const newSongs = await Promise.all(files.map(async file => {
    const meta = await readTags(file);
    
    return {
      id: crypto.randomUUID(),
      title: meta.title || file.name.replace(/\.[^/.]+$/, ""),
      artist: meta.artist || "Unknown",
      album: meta.album || "",
      src: URL.createObjectURL(file),
      file: file,
      artUrl: meta.artUrl
    };
  }));

  songs.push(...newSongs);
  currentIdx = -1;
  renderPlaylist();
  e.target.value = '';

  if (isShuffling) generateShuffleOrder();
  log(`Added ${newSongs.length} tracks from folder`);
});

backupBtn.addEventListener('click', () => {
  if (!songs.length) {
    log('No tracks to backup');
    return;
  }

  // Only save metadata, not blob URLs or File objects - they die on reload
  const backupData = songs.map(s => ({
    title: s.title,
    artist: s.artist,
    album: s.album,
    artUrl: s.artUrl // only if it's not a blob URL
  }));

  const blob = new Blob([JSON.stringify(backupData, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `playlist-backup-${Date.now()}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
  log(`Backup saved: ${songs.length} tracks`);
});

restoreBtn.addEventListener('click', () => {
  restoreInput.click(); // open file picker
});

restoreInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const backupData = JSON.parse(text);

    log(`Loading backup: ${backupData.length} tracks...`);

    songs = [];
    songList.innerHTML = '';

    backupData.forEach((track) => {
      songs.push({
  id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
  title: track.title || 'Unknown Track',
  artist: track.artist || 'Unknown',
  album: track.album || '',
  artUrl: track.artUrl && !track.artUrl.startsWith('blob:') ? track.artUrl : null, // <-- filter out blobs
  file: null,
  url: null
});
    });

    renderPlaylist(); // now it has IDs

    currentIdx = -1; // no track selected
if (audio && !audio.paused) audio.pause(); // stop any phantom play
log(`Restore complete: ${backupData.length} tracks loaded. Pick +songs/+folder to attach audio`);
    restoreInput.value = '';

  } catch (err) {
    log('Restore failed: ' + err.message);
    console.error(err);
  }
});

matchBtn.addEventListener('click', () => folderInput.click());

folderInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
  if (!files.length) return;

  log(`Scanning ${files.length} audio files...`);
  let matched = 0;
  const norm = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (let song of songs) {
    if (song.file) continue;
    const target = norm(song.title + song.artist);
    const file = files.find(f => norm(f.name).includes(norm(song.title)) || norm(f.name).includes(target));

    if (file) {
      song.file = file;
      song.url = URL.createObjectURL(file);
      
      try {
        const arrayBuffer = await file.slice(0, 262144).arrayBuffer();
        const tags = await readID3Tags(arrayBuffer);
        if (tags.picture) {
          const blob = new Blob([tags.picture.data], {type: tags.picture.format});
          song.artUrl = URL.createObjectURL(blob);
        }
      } catch(err) {}

      matched++;
    }
  }

  renderPlaylist();
  log(`Matched ${matched}/${songs.length} tracks. Art restored where found.`);
  folderInput.value = '';
});

async function readID3Tags(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0) !== 0x494433) return {};
  let offset = 10;
  while (offset < buffer.byteLength - 10) {
    const frameId = String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    const size = view.getUint32(offset + 4);
    if (frameId === 'APIC') {
      const mime = 'image/jpeg';
      const dataStart = offset + 21;
      const data = new Uint8Array(buffer, dataStart, size - 21);
      return { picture: { format: mime, data } };
    }
    offset += 10 + size;
  }
  return {};
}
// Helper: read tags once per file
function readTags(file) {
  return new Promise(resolve => {
    new jsmediatags.Reader(file).read({
      onSuccess: (tag) => {
        let artUrl = DEFAULT_ART;
        if (tag.tags.picture) {
          try {
            const blob = new Blob([new Uint8Array(tag.tags.picture.data)], {type: tag.tags.picture.format});
            artUrl = URL.createObjectURL(blob);
          } catch (e) {}
        }
        resolve({
          title: tag.tags.title || file.name.replace(/\.[^/.]+$/, ""),
          artist: tag.tags.artist || 'Unknown Artist',
          album: tag.tags.album || '',
          artUrl: artUrl
          // DELETE blob: file  <- fileInput already sets .file
        });
      },
      onError: () => resolve({
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: 'Unknown Artist',
        album: '',
        artUrl: DEFAULT_ART
      })
    });
  });
}

document.addEventListener('touchstart', (e) => {
  const art = e.target.closest('#album-art,.song-thumb');
  if (art) {
    e.preventDefault();
    currentSwipeTarget = art;
    handleTouchStart(e);
  }
}, {passive: false});

document.addEventListener('touchmove', (e) => {
  if (isSwiping) {
    e.preventDefault();
    handleTouchMove(e);
  }
}, {passive: false});

document.addEventListener('touchend', (e) => {
  if (isSwiping) {
    handleTouchEnd(e);
    currentSwipeTarget = null;
  }
});

document.addEventListener('touchcancel', (e) => {
  if (isSwiping) {
    currentSwipeTarget.style.transform = 'translateX(0px)';
    isSwiping = false;
    currentSwipeTarget = null;
  }
});

log('listeners attached');

function safeStartSpectrum() {
  if (spectrumRunning || !analyser || !dataArray) return;
  spectrumRunning = true;
  drawSpectrum();
}

function drawSpectrum() {
  if (!spectrumRunning) return;
  animId = requestAnimationFrame(drawSpectrum);
  analyser.getByteFrequencyData(dataArray);
}

function stopSpectrum() {
  spectrumRunning = false;
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

// ===== Audio Engine =====
async function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  // === ADD THIS FIRST ===
  if (!audio) {
    audio = new Audio();
    audio.crossOrigin = 'anonymous';
  }
  if (!audioNext) {
    audioNext = new Audio();
    audioNext.crossOrigin = 'anonymous';
  }

  activeAudio = audio;
  nextAudio = audioNext;
  // === END ADD ===


  activeGain = audioCtx.createGain();
  nextGain = audioCtx.createGain();
  nextGain.gain.value = 0;
  activeGain.gain.value = parseFloat(volume?.value) || 1;

  const preGain = audioCtx.createGain();
  preGain.gain.value = 0.707;

  // Build EQ chain
  eqChain = EQ_BANDS.map((f, i) => {
    const filter = audioCtx.createBiquadFilter();
    filter.type = i === 0? 'lowshelf' : i === 9? 'highshelf' : 'peaking';
    filter.frequency.value = f;
    filter.Q.value = i === 0 || i === 9? 1 : 1.4;
    filter.gain.value = 0;
    return filter;
  });

  eqChain.reduce((prev, curr) => {
    prev.connect(curr);
    return curr;
  });

  const activeSource = audioCtx.createMediaElementSource(activeAudio);
  const nextSource = audioCtx.createMediaElementSource(nextAudio);

  activeSource.connect(eqChain[0]);
  nextSource.connect(eqChain[0]);
  eqChain[eqChain.length - 1].connect(preGain);

  const mixBus = audioCtx.createGain();
  mixBus.gain.value = 1;
  preGain.connect(activeGain);
  preGain.connect(nextGain);
  activeGain.connect(mixBus);
  nextGain.connect(mixBus);
  mixBus.connect(audioCtx.destination);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.7;
  mixBus.connect(analyser);
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  // === ADD GUARD: only add listeners once ===
  if (!activeAudio._listenersAdded) {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' &&!activeAudio.paused) {
        await requestWakeLock();
      }
    });

    activeAudio.addEventListener('play', async () => {
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      await requestWakeLock();
      setupMediaSession();
      updateMediaSessionState('playing');
    });

    activeAudio.addEventListener('pause', async () => {
      if (activeAudio.paused && nextAudio.paused) {
        await releaseWakeLock();
        updateMediaSessionState('paused');
      }
    });

    activeAudio.addEventListener('ended', async () => {
      setTimeout(async () => {
        if (activeAudio.paused && activeAudio.currentTime >= activeAudio.duration - 0.5) {
          await releaseWakeLock();
          updateMediaSessionState('paused');
        }
      }, 200);
    });

    nextAudio.addEventListener('play', async () => {
  if (audioCtx.state === 'suspended') await audioCtx.resume(); // ADD THIS
  await requestWakeLock();
  setupMediaSession(); // ADD THIS
  updateMediaSessionState('playing'); // ADD THIS
});

nextAudio.addEventListener('pause', async () => {
  if (activeAudio.paused && nextAudio.paused) {
    await releaseWakeLock();
    updateMediaSessionState('paused'); // ADD THIS
  }
});

nextAudio.addEventListener('ended', async () => {
  setTimeout(async () => {
    if (activeAudio.paused && nextAudio.paused && nextAudio.currentTime >= nextAudio.duration - 0.5) {
      await releaseWakeLock();
      updateMediaSessionState('paused');
    }
  }, 200);
});

    activeAudio.addEventListener('timeupdate', onTimeUpdate);
    activeAudio.addEventListener('ended', handleTrackEnd);

    activeAudio._listenersAdded = true;
  }

  setupEQSliders();
  log('WebAudio 10-Band ready');
  log('AudioContext state:', audioCtx.state);
  initVU();
}

function updateActiveTrack() {
  const list = document.querySelector('#song-list');
  if (!list) return; // playlist not in DOM yet

  // Remove old highlight
  list.querySelectorAll('li').forEach(item => item.classList.remove('active'));

  // Add new highlight
  const currentItem = list.querySelector(`li[data-idx="${currentIdx}"]`);
  if (currentItem) {
    currentItem.classList.add('active');
    currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    log('updateActiveTrack: li[data-idx="'+currentIdx+'"] not found yet');
    // Retry 100ms later if DOM still building
    setTimeout(updateActiveTrack, 100);
  }
}

async function loadSong(idx, shouldPlay = true) {
  // Guard: abort if this load is stale
  const loadId = Symbol();
  activeAudio._loadId = loadId;

  currentIdx = idx;
  updateActiveTrack();
  const song = songs[idx];
log('loadSong called:', idx, 'src:', song?.src, 'src type:', typeof song?.src);

  if (!song?.src) {
    showToast("Re-select files to restore audio");
    console.error('No src on song:', song);
    return;
  }

  // 1. Abort previous load immediately
  activeAudio.pause();
  activeAudio.removeAttribute('src');
  activeAudio.load(); // cancels network request
  stopSpectrum();
  spectrumRunning = false;

  await initAudio();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  activeAudio.oncanplay = null;
  activeAudio.onended = null;
  activeAudio.onloadedmetadata = null;

  // 2. Update UI once, with placeholder art
  updateUI(song, true); // true = use placeholder art

  activeAudio.src = song.src;
  activeAudio.load();

  const playNow = async () => {
    if (activeAudio._loadId!== loadId) return; // stale load, abort
    if (!shouldPlay) return;
    try {
      await activeAudio.play();
      playBtn.textContent = '⏸️';
      updateMediaSessionState('playing');
      safeStartSpectrum();
    } catch (e) {
      if (e.name!== 'AbortError') log('Play failed:', e);
    }
  };

  if (activeAudio.readyState >= 3) {
    playNow();
  } else {
    activeAudio.oncanplay = playNow;
  }

  // 3. Only update duration here, NOT full UI
  activeAudio.onloadedmetadata = () => {
    if (activeAudio._loadId!== loadId) return;
    updateDuration(); // just update time, not title/art
    safeStartSpectrum();
    updateActiveTrack(); 
  };

  // 4. Load art + waveform async with guards
  setTimeout(async () => {
    if (activeAudio._loadId!== loadId) return; // user skipped already

    if (song.file && song.file instanceof File) {
      await new Promise((resolve) => {
        jsmediatags.read(song.file, {
          onSuccess: (tag) => {
            if (activeAudio._loadId!== loadId) return; // stale
            const picture = tag.tags.picture;
            if (picture) {
              const byteArray = new Uint8Array(picture.data);
              const artBlob = new Blob([byteArray], { type: picture.format });
              if (song.artUrl?.startsWith('blob:')) URL.revokeObjectURL(song.artUrl);
              song.artUrl = URL.createObjectURL(artBlob);
              albumArt.src = song.artUrl;
            }
            resolve();
          },
          onError: () => {
            song.artUrl = DEFAULT_ART;
            albumArt.src = DEFAULT_ART;
            resolve();
          }
        });
      });

      if (activeAudio._loadId!== loadId) return;
      await setAlbumArt(song.file); // only if no embedded art found
      await drawWaveform(song.file);
    } else {
      albumArt.src = DEFAULT_ART;
    }

    updateMediaSession(song);
  }, 0);

  activeAudio.onended = handleTrackEnd;
}

// Update updateUI to accept placeholder flag
function updateUI(song, usePlaceholder = false) {
  titleEl.textContent = song.title;
  artistEl.textContent = song.artist;

  // Set placeholder immediately so old art doesn't linger
  albumArt.src = usePlaceholder? (song.artUrl || DEFAULT_ART) : albumArt.src;

  // Highlight playlist
  document.querySelectorAll('#song-list li').forEach(li => li.classList.remove('active'));
  const el = document.querySelector(`#song-list li[data-id="${song.id}"]`);
  if (el) el.classList.add('active');
}

// 1. Define animateVU first
// 2. DPR setup function - DEFINE THIS FIRST
function setupCanvasDPR() {
  if (!vuCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = vuCanvas.getBoundingClientRect();

  vuCanvas.width = rect.width * dpr;
  vuCanvas.height = rect.height * dpr;
  vuCtx.scale(dpr, dpr);
}

// 3. Animation function - DEFINE THIS SECOND
function animateVU() {
  vuAnimationId = requestAnimationFrame(animateVU);
  analyser.getByteFrequencyData(dataArray);

  const width = vuCanvas.clientWidth;
  const height = vuCanvas.clientHeight;
  vuCtx.clearRect(0, 0, width, height);

  const barCount = 128;
  const barWidth = width / barCount;

  for (let i = 0; i < barCount; i++) {
    const barHeight = (dataArray[i] / 255) * height;
    const x = i * barWidth;
    vuCtx.fillStyle = i > barCount * 0.9? '#ff0044' : i > barCount * 0.7? '#ffaa00' : '#00ff88';
    vuCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
  }
}

// 4. Init function - DEFINE THIS THIRD
function initVU() {
  vuCanvas = document.getElementById('vu-meter');
  if (!vuCanvas ||!analyser) return;

  vuCtx = vuCanvas.getContext('2d');
  setupCanvasDPR(); // now this exists
  animateVU(); // and this exists too
}

function updateDuration() {
  if (!activeAudio.duration || isNaN(activeAudio.duration)) return;
  
  const dur = formatTime(activeAudio.duration);
  durationEl.textContent = dur;
  
  // Update Media Session duration too
  if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
    navigator.mediaSession.metadata.duration = activeAudio.duration;
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 5. Resize listener
window.addEventListener('resize', () => {
  if (vuCanvas) setupCanvasDPR();
});

// Handle phone rotation / resize
window.addEventListener('resize', () => {
  if (vuCanvas) setupCanvasDPR();
});


function setupEQSliders(){
  document.querySelectorAll('.eq-band').forEach((bandEl, i) => {
    const slider = bandEl.querySelector('.eq-slider');
    const valSpan = bandEl.querySelector('.eq-value');
    slider.addEventListener('input', e => {
      const band = parseInt(e.target.dataset.band);
      const val = parseFloat(e.target.value);
      if(!eqChain || !eqChain[band]) return;
      eqChain[band].gain.value = val;
      valSpan.textContent = val > 0? `+${val}` : val;
      if(eqPresetDrawer) eqPresetDrawer.value = 'custom';
    });
  });

  eqReset?.addEventListener('click', () => {
    eqChain.forEach(f => f.gain.value = 0);
    document.querySelectorAll('.eq-slider').forEach(s => s.value = 0);
    document.querySelectorAll('.eq-value').forEach(v => v.textContent = '0');
    if(eqPresetDrawer) eqPresetDrawer.value = 'flat';
  });
}

function updateTimer() {
  if (!activeAudio.duration || isNaN(activeAudio.duration)) return;
  timer.textContent = `${fmt(activeAudio.currentTime)} / ${fmt(activeAudio.duration)}`;
}

function fmt(sec) {
  if (isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function onTimeUpdate() {
  renderWaveform();
  updateTimer();
  checkCrossfade();
  // Add this debug line at the bottom
  if (activeAudio.duration && activeAudio.currentTime) {
    const timeLeft = activeAudio.duration - activeAudio.currentTime;
    if (timeLeft < 6) {
      log('Approaching crossfade:', timeLeft.toFixed(2), 's left, crossfading:', isCrossfading);
    }
  }
}

function applyPreset(name) {
  const gains = EQ_PRESETS[name];
  if (!gains ||!eqChain.length) return;
  document.querySelectorAll('.eq-slider').forEach((slider, i) => {
    slider.value = gains[i];
    if (eqChain[i]) {
      eqChain[i].gain.cancelScheduledValues(audioCtx.currentTime);
      eqChain[i].gain.linearRampToValueAtTime(gains[i], audioCtx.currentTime + 0.15);
    }
    slider.parentElement.querySelector('.eq-value').textContent = gains[i] > 0? `+${gains[i]}` : gains[i];
  });
  eqPreset.value = name;
  eqPresetDrawer.value = name;
}

eqPreset.addEventListener('change', e => applyPreset(e.target.value));
eqPresetDrawer.addEventListener('change', e => applyPreset(e.target.value));

// ===== Crossfade + Repeat Logic =====
function checkCrossfade() {
  if (!isFinite(activeAudio.duration) || songs.length < 2 || crossfadeMs === 0) return;

  const timeLeft = activeAudio.duration - activeAudio.currentTime;
  const crossfadeSec = crossfadeMs / 1000;

  // This log was missing in your output - add it
  if (timeLeft <= crossfadeSec + 0.5) {
    log('checkCrossfade:', timeLeft.toFixed(2), 's left, isCrossfading:', isCrossfading, 'lock:', crossfadeLock);
  }

  if (timeLeft <= crossfadeSec &&!isCrossfading && crossfadeLock === -1) {
    let next = getNextIndex(); // Don't use currentIdx + 1, that ignores shuffle/repeat
    if (next === -1 || next === currentIdx) return;

    crossfadeLock = next;
    isCrossfading = true;
    log('Crossfade triggered:', songs[currentIdx].title, '->', songs[next].title);
    startCrossfade();
  }
}

async function startCrossfade() {
  let next = crossfadeLock;
  if (next === -1 || next === currentIdx) {
    isCrossfading = false;
    crossfadeLock = -1;
    return;
  }

  // Don't remove timeupdate here - doSwap handles it

  if (!nextAudio.src || nextAudio.dataset.songIdx!= next) {
    const nextSong = songs[next];
    if (!nextSong) {
      isCrossfading = false;
      crossfadeLock = -1;
      return;
    }
    nextAudio.src = nextSong.src; // src is already blob:http://... from loadSong

// Only create new blob URL if you have File and no blob URL yet
if (nextSong.file instanceof File &&!nextSong.src.startsWith('blob:')) {
  nextAudio.src = URL.createObjectURL(nextSong.file);
}
    nextAudio.dataset.songIdx = next;
    nextAudio.load();
  }

  nextAudio.currentTime = 0;
  nextGain.gain.value = 0;

  try {
    if (nextAudio.readyState < 2) {
      await new Promise((resolve, reject) => {
        nextAudio.addEventListener('canplay', resolve, { once: true });
        nextAudio.addEventListener('error', reject, { once: true });
        setTimeout(() => reject('timeout'), 2000);
      });
    }
    await nextAudio.play();
  } catch (e) {
    log('Crossfade aborted:', e);
    isCrossfading = false;
    crossfadeLock = -1;
    return;
  }

  const now = audioCtx.currentTime;
const fadeTime = crossfadeMs / 1000;
const targetVol = parseFloat(volume.value) || 1;
const samples = 100;
const curveA = new Float32Array(samples);
const curveB = new Float32Array(samples);

// Build equal-power curves
for (let i = 0; i < samples; i++) {
  const progress = i / (samples - 1);
  curveA[i] = Math.cos(progress * Math.PI / 2) * targetVol; // fades out
  curveB[i] = Math.sin(progress * Math.PI / 2) * targetVol; // fades in
}

activeGain.gain.cancelScheduledValues(now);
nextGain.gain.cancelScheduledValues(now);

activeGain.gain.setValueAtTime(activeGain.gain.value || targetVol, now);
nextGain.gain.setValueAtTime(0.001, now);

activeGain.gain.setValueCurveAtTime(curveA, now, fadeTime);
nextGain.gain.setValueCurveAtTime(curveB, now, fadeTime);
const doSwap = async () => {
  log('doSwap START. currentIdx:', currentIdx, '->', crossfadeLock);

  try {
    // Guard 1: Validate next index exists
    if (crossfadeLock < 0 || crossfadeLock >= songs.length) {
      console.warn('doSwap aborted: invalid crossfadeLock', crossfadeLock);
      isCrossfading = false;
      return;
    }

    const nextTrack = songs[crossfadeLock];
    if (!nextTrack) {
      console.warn('doSwap aborted: nextTrack undefined');
      isCrossfading = false;
      return;
    }

    activeAudio.pause();
    activeGain.gain.setValueAtTime(0, audioCtx.currentTime);
    nextGain.gain.setValueAtTime(targetVol, audioCtx.currentTime);

    activeAudio.removeEventListener('timeupdate', onTimeUpdate);
    activeAudio.removeEventListener('ended', handleTrackEnd);

    [activeAudio, nextAudio] = [nextAudio, activeAudio];
    [activeGain, nextGain] = [nextGain, activeGain];

    activeAudio.addEventListener('timeupdate', onTimeUpdate);
    activeAudio.addEventListener('ended', handleTrackEnd);

    currentIdx = crossfadeLock;
    crossfadeLock = -1;

    // Guard 2: Validate current track before art/UI
    const currTrack = songs[currentIdx];
    if (!currTrack) {
      console.warn('doSwap: currTrack undefined, skipping art/UI');
      isCrossfading = false;
      return;
    }

    await setAlbumArt(currTrack.file);
    updateUI(currTrack);
    updateMediaSession(currTrack);
    renderPlaylist();
    preloadNextSong();

  } catch (e) {
    console.log('Crossfade swap failed:', e);
  } finally {
    isCrossfading = false;
  }
};

  const crossfadeTimeout = setTimeout(doSwap, crossfadeMs);

  const forceSwap = () => {
    clearTimeout(crossfadeTimeout);
    activeGain.gain.cancelScheduledValues(audioCtx.currentTime);
    nextGain.gain.cancelScheduledValues(audioCtx.currentTime);
    doSwap();
  };
  activeAudio.addEventListener('ended', forceSwap, { once: true });
}
// ===== Playback Logic =====
function getNextIndex() {
  if (repeatMode === 2) return currentIdx;

  if (isShuffling) {
    // Ensure shuffleOrder is valid
    if (!shuffleOrder.length || shuffleOrder.length!== songs.length) {
      generateShuffleOrder();
      shufflePosition = shuffleOrder.indexOf(currentIdx);
    }

    shufflePosition++;
    if (shufflePosition >= shuffleOrder.length) {
      if (repeatMode === 1) {
        generateShuffleOrder();
        shufflePosition = 0;
      } else {
        return -1;
      }
    }
    return shuffleOrder[shufflePosition];
  } else {
    let next = currentIdx + 1;
    if (next >= songs.length) {
      if (repeatMode === 1) return 0; // Repeat all - go to first
      return -1; // Stop at end
    }
    return next;
  }
}

function getPrevIndex() {
  if (isShuffling) {
    shufflePosition--;
    if (shufflePosition < 0) {
      if (repeatMode === 1) {
        shufflePosition = shuffleOrder.length - 1;
      } else {
        shufflePosition = 0;
        return -1;
      }
    }
    return shuffleOrder[shufflePosition];
  } else {
    if (currentIdx <= 0) {
      if (repeatMode === 1) return songs.length - 1;
      return -1;
    }
    return currentIdx - 1;
  }
}

async function handleTrackEnd() {
  log('handleTrackEnd FIRED. isHandlingEnded:', isHandlingEnded, 'isCrossfading:', isCrossfading, 'lock:', crossfadeLock);
  
  // CRITICAL: If crossfading or locked, GTFO immediately. Do not touch anything.
  if (isCrossfading || crossfadeLock!== -1) {
    log('BLOCKED: Crossfade active, ignoring ended event');
    return; // <- STOPS HERE. No reset, no getNextIndex, nothing.
  }
  
  if (isHandlingEnded) return;
  isHandlingEnded = true;

  if (repeatMode === 2) {
    activeAudio.currentTime = 0;
    activeAudio.play().catch(e => {
      if (e.name!== 'AbortError') console.log('Repeat play failed:', e);
    });
    isHandlingEnded = false;
    return;
  }

  const next = getNextIndex();
  if (next!== -1) {
    await loadSong(next, true);
  } else {
    isPlaying = false;
    playBtn.textContent = '▶️';
    activeAudio.currentTime = 0;
    updateMediaSessionState();
  }

  setTimeout(() => isHandlingEnded = false, 150);
}

// FIX 3: Proper play promise handling



function updateUI(song, usePlaceholder = false) {
  if (!song) {
    console.warn('updateUI skipped: song is undefined');
    return;
  }

  const titleEl = document.getElementById('now-title');
  const artistEl = document.getElementById('now-artist');
  const albumEl = document.getElementById('now-album');
  const artEl = document.getElementById('album-art');
  const durationEl = document.getElementById('duration'); // add this if you have it
  
  if (titleEl) titleEl.textContent = song.title || 'Unknown Track';
  if (artistEl) artistEl.textContent = song.artist || 'Unknown Artist';
  if (albumEl) {
    albumEl.textContent = song.album || '';
    albumEl.style.display = song.album ? 'block' : 'none';
  }
  
  // 1. Reset duration immediately so old time doesn't linger
  if (durationEl) durationEl.textContent = '0:00';
  
  // 2. Set art: use placeholder on shuffle, real art only when jsmediatags finishes
  if (artEl) {
    if (usePlaceholder) {
      artEl.src = song.artUrl || './assets/default-art.svg';
    } else if (song.artUrl) {
      artEl.src = song.artUrl;
    }
  }

  // 3. Highlight active song in playlist
  document.querySelectorAll('#song-list li').forEach(li => li.classList.remove('active'));
  const el = document.querySelector(`#song-list li[data-id="${song.id}"]`);
  if (el) el.classList.add('active');
}

// Add this for metadata updates
function updateDuration() {
  const durationEl = document.getElementById('duration');
  if (!durationEl || !activeAudio.duration || isNaN(activeAudio.duration)) return;
  
  const mins = Math.floor(activeAudio.duration / 60);
  const secs = Math.floor(activeAudio.duration % 60);
  durationEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function preloadNextSong() {
  if (crossfadeMs === 0 || songs.length < 2) return;

  let nextIdx = getNextIndex();
  if (nextIdx === -1 || nextIdx === currentIdx) return;

  const nextSong = songs[nextIdx];
  if (!nextSong || nextAudio.dataset.songIdx == nextIdx) return;

  // Use existing blob URL if we already made one in loadSong
  if (nextSong.src?.startsWith('blob:')) {
    nextAudio.src = nextSong.src;
  }
  // Only create new blob URL if we have File and no blob URL yet
  else if (nextSong.file instanceof File) {
    nextAudio.src = URL.createObjectURL(nextSong.file);
    // Cache it so we don't create 10 blob URLs for same song
    nextSong.src = nextAudio.src;
  }
  else {
    return; // no file, can't preload
  }

  nextAudio.dataset.songIdx = nextIdx;
  nextAudio.load();
}

function updateMediaSession(song, state) {
  if (!('mediaSession' in navigator)) return;

  const artUrl = song.artUrl && !song.artUrl.endsWith('.svg') 
    ? song.artUrl 
    : DEFAULT_ART;
    
  const artType = song.artType || 'image/png';

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title || 'Unknown',
    artist: song.artist || 'Unknown',
    album: song.album || 'PWA Music Player',
    artwork: [
      { src: artUrl, sizes: '512x512', type: artType },
      { src: artUrl, sizes: '600x600', type: artType }
    ]
  });
  
  navigator.mediaSession.playbackState = state || (activeAudio.paused ? 'paused' : 'playing');
}

function setupMediaSessionHandlers() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', async () => {
      await initAudio();
      
      // CHANGED: audioCtx not audioContext
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
      } else {
        try {
          await activeAudio.play();
          isPlaying = true;
          playBtn.textContent = '⏸️';
          updateMediaSessionState();
          
          // CHANGED: use guard
          safeStartSpectrum();
          
        } catch (e) {
          if (e.name!== 'AbortError') console.log('MediaSession play failed:', e);
        }
      }
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
      activeAudio.pause();
      isPlaying = false;
      playBtn.textContent = '▶️';
      updateMediaSessionState();
      // optional: set spectrumRunning = false; if you want it to stop drawing on pause
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => prevSong());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextSong());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime) activeAudio.currentTime = details.seekTime;
    });
  }
}

// ===== Controls =====
let isPlaying = false;

async function togglePlay() {
  await initAudio();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  
  // No song loaded yet + we have songs → load first one
  if (currentIdx === -1 && songs.length > 0) {
    await loadSong(0, true);
    return;
  }
  
  // Song already loaded → just toggle
  if (activeAudio.paused) {
    try {
      await activeAudio.play();
      playBtn.textContent = '⏸️';
      isPlaying = true;
      updateMediaSessionState('playing');
      safeStartSpectrum();
    } catch (e) {
      if (e.name !== 'AbortError') console.log('Play failed:', e);
    }
  } else {
    activeAudio.pause();
    playBtn.textContent = '▶️';
    isPlaying = false;
    updateMediaSessionState('paused');
  }
}

playBtn.addEventListener('click', togglePlay);

function nextSong() {
  const next = getNextIndex();
  if (next!== -1) loadSong(next, true);
  updateActiveTrack();
}

// FIX 4: Prev with proper error handling
function prevSong() {
  if (activeAudio.currentTime > 3) {
    activeAudio.currentTime = 0;
    activeAudio.play().then(() => {
      playBtn.textContent = '⏸️';
    }).catch(e => {
      if (e.name!== 'AbortError') console.log('Prev restart failed:', e);
    });
    updateActiveTrack();
    return;
  }
  const prev = getPrevIndex();
  if (prev!== -1) loadSong(prev, true);
}

nextBtn.onclick = nextSong;
prevBtn.onclick = prevSong;

repeatBtn.onclick = () => {
  repeatMode = (repeatMode + 1) % 3;
  repeatBtn.classList.remove('active', 'repeat-one');
  if (repeatMode === 1) {
    repeatBtn.classList.add('active');
    repeatBtn.title = 'Repeat All';
  } else if (repeatMode === 2) {
    repeatBtn.classList.add('active', 'repeat-one');
    repeatBtn.title = 'Repeat One';
  } else {
    repeatBtn.title = 'Repeat Off';
  }
};

shuffleBtn.onclick = () => {
  isShuffling =!isShuffling;
  shuffleBtn.classList.toggle('active', isShuffling);
  if (isShuffling) generateShuffleOrder();
};


function updateMediaSessionState() {
  if (!('mediaSession' in navigator)) return;
  
  navigator.mediaSession.playbackState = activeAudio.paused? 'paused' : 'playing';
}


function generateShuffleOrder() {
  shuffleOrder = [...Array(songs.length).keys()];
  for (let i = shuffleOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
  }
  const currentPos = shuffleOrder.indexOf(currentIdx);
  if (currentPos!== -1 && currentPos!== 0) {
    [shuffleOrder[0], shuffleOrder[currentPos]] = [shuffleOrder[currentPos], shuffleOrder[0]];
  }
  shufflePosition = 0;
}

fadeSlider.addEventListener('input', () => {
  crossfadeMs = parseInt(fadeSlider.value);
  fadeTimeLabel.textContent = (crossfadeMs / 1000).toFixed(1) + 's';
});

volume.addEventListener('input', () => {
  const vol = parseFloat(volume.value);
  if (activeGain) activeGain.gain.setValueAtTime(vol, audioCtx.currentTime);
  volumeBtn.textContent = vol === 0? '🔇' : vol < 0.5? '🔉' : '🔊';
});

volumeBtn.onclick = () => {
  if (volume.value > 0) { lastVolume = volume.value; volume.value = 0; }
  else { volume.value = lastVolume; }
  volume.dispatchEvent(new Event('input'));
};

eqBtn.onclick = () => eqDrawer.classList.toggle('open');
eqClose.onclick = () => eqDrawer.classList.remove('open');

// ===== UI + Files =====

async function setAlbumArt(file) {
  const song = songs[currentIdx];
  if (!song) return;

  // Always show something immediately
  albumArt.src = song.artUrl || DEFAULT_ART;
  if (!file) return;

  return new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess: tag => {
        if (tag.tags.picture) {
          try {
            const newBlob = new Blob([new Uint8Array(tag.tags.picture.data)], {type: tag.tags.picture.format});

            if (song.artUrl && song.artUrl.startsWith('blob:')) {
              URL.revokeObjectURL(song.artUrl);
            }
            song.artUrl = URL.createObjectURL(newBlob);
            albumArt.src = song.artUrl;

            // UPDATE THE PLAYLIST ROW TOO - this is key
            const el = document.querySelector(`#song-list li[data-id="${song.id}"]`);
            if (el) {
              el.querySelector('img').src = song.artUrl;
              log('Updated playlist art for:', song.title);
            }
          } catch (e) {
            console.warn('Art extraction failed:', e);
          }
        }

        // Also update text if jsmediatags found better metadata
        if (tag.tags.title) song.title = tag.tags.title;
        if (tag.tags.artist) song.artist = tag.tags.artist;
        if (tag.tags.album) song.album = tag.tags.album;

        const el = document.querySelector(`#song-list li[data-id="${song.id}"]`);
        if (el) {
          el.querySelector('.song-title').textContent = song.title;
          el.querySelector('.song-artist').textContent = song.artist;
          el.querySelector('.song-album').textContent = song.album;
        }

        resolve();
      },
      onError: (e) => {
        console.error('setAlbumArt failed for', song.title, e);
        resolve();
      }
    });
  });
}

function renderPlaylist() {
  const list = searchInput && searchInput.value? songs.filter(s => s.title.toLowerCase().includes(searchInput.value.toLowerCase())) : songs;
  
  songList.innerHTML = list.map((s) => {
    const realIdx = songs.indexOf(s);
    const artUrl = s.artUrl || DEFAULT_ART;
    return `<li data-song-id="${s.id}" data-idx="${realIdx}" class="${realIdx === currentIdx? 'active' : ''}">
      <img class="song-thumb" src="${s.artUrl || DEFAULT_ART}" onerror="this.src=DEFAULT_ART">
      <div class="song-meta">
        <div class="song-title">${s.title}</div>
        <div class="song-artist">${s.artist}</div>
        ${s.album? `<div class="song-album">${s.album}</div>` : ''}
      </div>
      <button class="del-song" data-song-id="${s.id}">×</button>
    </li>`;
  }).join('');

  // 👇 Remove mini-player mode from body so playlist shows
  document.body.classList.remove('mini-player');
  updateActiveTrack();

  log('Playlist rendered: ' + songs.length + ' songs');
  return songs.length;
}

// Save whatever array renderPlaylist receives
const originalRender = renderPlaylist;
renderPlaylist = function(tracks) {
  window.currentTracks = tracks; // save it globally
  return originalRender(tracks);
};


songList.onclick = e => {
  // Delete button
  if (e.target.classList.contains('del-song')) {
    e.stopPropagation();
    const songId = e.target.dataset.songId;
    const idx = songs.findIndex(s => s.id === songId);

    if (idx === -1) return;

    if (songs[idx].artUrl?.startsWith('blob:')) URL.revokeObjectURL(songs[idx].artUrl);
    songs.splice(idx, 1);

    if (currentIdx === idx) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      currentIdx = -1;
      resetPlayer();
    } else if (currentIdx > idx) {
      currentIdx--;
    }

    if (isShuffling) generateShuffleOrder();
    renderPlaylist();
    return;
  }

  // Click to play
  // Click to play
const li = e.target.closest('li');
if (li) {
  const idx = parseInt(li.dataset.idx);
  if (!isNaN(idx)) {
    const song = songs[idx];
    if (!song?.src) {
      showToast("Re-select files to restore audio");
      return; // <- stops the error
    }
    loadSong(idx);
  }
}
};

function readTagsAndArt(file) {
  return new Promise((resolve) => {
  log('Reading tags for:', file.name);
    jsmediatags.read(file, {
      onSuccess: function(tag) {
        const tags = tag.tags;
        log('SUCCESS for', file.name, 'Title:', tags.title, 'Artist:', tags.artist, 'Has picture:',!!tags.picture);

        let artUrl = DEFAULT_ART;
        if (tags.picture) {
          try {
            const { data, format } = tags.picture;
            const byteArray = new Uint8Array(data);
            const blob = new Blob([byteArray], { type: format });
            artUrl = URL.createObjectURL(blob);
            log('Art extracted for', file.name, 'Size:', data.length);
          } catch (e) {
            console.error('Art extraction CRASHED for', file.name, e);
          }
        }

        resolve({
          title: tags.title || file.name.replace(/\.[^/.]+$/, ""),
          artist: tags.artist || 'Unknown Artist',
          album: tags.album || '',
          artUrl: artUrl
        });
      },
      onError: function(error) {
        console.error('TAG READ FAILED for', file.name, 'Error:', error.type, error.info);
        resolve({
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: 'Unknown Artist',
          album: '',
          artUrl: DEFAULT_ART
        });
      }
    });
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => {
    const hasAudioType = f.type.startsWith('audio/');
    const hasAudioExt = /\.(mp3|m4a|aac|ogg|wav|flac|opus|wma)$/i.test(f.name);
    return hasAudioType || hasAudioExt;
  });

  log(`Processing ${files.length} audio files out of ${fileList.length} total`);

  const songListEl = document.querySelector('#song-list');
  if (!songListEl) return console.error('song-list element not found');
  songListEl.innerHTML = '';
  songs.length = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const id = crypto.randomUUID();

    const song = {
      id,
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: 'Loading...',
      album: 'Loading...',
      blob: file,
      artUrl: DEFAULT_ART
    };

    songs.push(song);

    const li = document.createElement('li');
    li.dataset.idx = i;
    li.dataset.id = song.id;
    li.innerHTML = `
      <img src="${song.artUrl}">
      <div class="song-meta">
        <div class="song-title">${song.title}</div>
        <div class="song-artist">${song.artist}</div>
        <div class="song-album">${song.album}</div>
      </div>
      <button class="del-song">×</button>
    `;
    songListEl.appendChild(li);

    // ASYNC TAG LOAD - updates DOM when ready
    readTagsAndArt(file).then(meta => {
  song.title = meta.title;
  song.artist = meta.artist;
  song.album = meta.album;

  if (meta.artUrl!== DEFAULT_ART) {
    if (song.artUrl && song.artUrl.startsWith('blob:')) {
      URL.revokeObjectURL(song.artUrl);
    }
    song.artUrl = meta.artUrl;
  }

  // USE data-idx NOT data-id - idx is set synchronously when you create the li
  const el = songListEl.querySelector(`li[data-idx="${i}"]`); // <- i from the for loop
  if (el) {
    el.querySelector('img').src = song.artUrl;
    el.querySelector('.song-title').textContent = song.title;
    el.querySelector('.song-artist').textContent = song.artist;
    el.querySelector('.song-album').textContent = song.album;
    log('Updated playlist row for:', song.title); // <- add this to confirm
  } else {
    console.error('Could not find li[data-idx="' + i + '"] for', song.title);
  }
}).catch(err => {
  console.warn('Tag read failed for', file.name, err);
});

    await new Promise(r => setTimeout(r, 0));
  }

  if (isShuffling) generateShuffleOrder();
  log(`Done. Final playlist: ${songs.length} songs`);
}

addFolderBtn.onclick = () => folderInput.click();


// ===== Waveform =====
async function drawWaveform(file) {
  if (!file) return;
  const ctx = waveformCanvas.getContext('2d');
  const w = waveformCanvas.clientWidth || 600;
  const h = waveformCanvas.clientHeight || 40;
  waveformCanvas.width = w;
  waveformCanvas.height = h;
  const buf = await file.arrayBuffer();
  const audioBuf = await (audioCtx || new AudioContext()).decodeAudioData(buf);
  const raw = audioBuf.getChannelData(0);
  const samples = w;
  const block = Math.floor(raw.length / samples) || 1;
  waveformData = Array.from({length: samples}, (_, i) => {
    let max = 0;
    for (let j = 0; j < block; j++) max = Math.max(max, Math.abs(raw[i * block + j] || 0));
    return max;
  });
  const maxVal = Math.max(...waveformData) || 1;
  waveformData = waveformData.map(v => v / maxVal);
  renderWaveform();
}

function renderWaveform() {
  if (!waveformData.length) return;
  const ctx = waveformCanvas.getContext('2d');
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  ctx.clearRect(0, 0, w, h);
  log('waveformData length:', waveformData.length, 'duration:', activeAudio.duration)
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, w, h);
  const progress = activeAudio.duration? activeAudio.currentTime / activeAudio.duration : 0;
  const px = Math.floor(w * progress);
  waveformData.forEach((v, i) => {
    const bh = Math.max(3, v * h * 0.9);
    ctx.fillStyle = i < px? '#1ed760' : '#535353';
    ctx.fillRect(i, (h - bh) / 2, 1, bh);
  });
}

waveformCanvas.addEventListener('click', e => {
  if (!activeAudio.duration) return;
  const rect = waveformCanvas.getBoundingClientRect();
  activeAudio.currentTime = ((e.clientX - rect.left) / rect.width) * activeAudio.duration;
});

// ===== Spectrum =====
function drawSpectrum() {
  if (!analyser ||!dataArray ||!ctx) return;

  requestAnimationFrame(drawSpectrum);

  analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const barWidth = canvas.width / barCount;

  // HORIZONTAL RASTA GRADIENT: left to right - BRIGHT VERSION
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);

  gradient.addColorStop(0, 'rgba(255, 0, 0, 1)'); // pure red
  gradient.addColorStop(0.15, 'rgba(255, 80, 80, 1)'); // hot red
  gradient.addColorStop(0.35, 'rgba(255, 200, 0, 1)'); // bright orange-gold
  gradient.addColorStop(0.5, 'rgba(255, 255, 50, 1)'); // electric yellow
  gradient.addColorStop(0.65, 'rgba(180, 255, 50, 1)'); // lime yellow-green
  gradient.addColorStop(0.8, 'rgba(50, 255, 50, 1)'); // neon green
  gradient.addColorStop(1, 'rgba(0, 220, 0, 1)'); // bright green

  ctx.fillStyle = gradient;
  ctx.shadowBlur = 12; // keep the glow size

  for (let i = 0; i < barCount; i++) {
    const barHeight = (dataArray[i] / 255) * canvas.height * 0.95;
    const x = i * barWidth;
    const y = canvas.height - barHeight;

    // Position of this bar as 0 to 1 across the canvas
    const position = i / barCount;

    // Match shadow color to the gradient zone
  // 40% Red | 30% Yellow | 30% Green
  if (position < 0.4) {
    // Red zone: 0% to 40%
    ctx.shadowColor = 'rgba(255, 50, 50, 0.9)';
  } else if (position < 0.7) {
    // Yellow zone: 40% to 70%
    ctx.shadowColor = 'rgba(255, 255, 50, 0.9)';
  } else {
    // Green zone: 70% to 100%
    ctx.shadowColor = 'rgba(50, 255, 50, 0.9)';
  }

    ctx.fillRect(x, y, barWidth - 2, barHeight);
  }
}

function resetPlayer() {
  nowTitle.textContent = 'No Song';
  nowArtist.textContent = 'Unknown Artist';
  albumArt.src = DEFAULT_ART;
  timer.textContent = '0:00 / 0:00';
  const ctx = waveformCanvas.getContext('2d');
  ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}
function handleTouchStart(e) {
  touchStartX = e.changedTouches[0].screenX;
  lastTouchX = touchStartX;
  isSwiping = true;
  albumArt.style.transition = 'none';
}

function handleTouchMove(e) {
  if (!isSwiping) return;

  const currentX = e.changedTouches[0].screenX;
  const diffX = currentX - touchStartX;

  // Track velocity if you want momentum later
  velocity = currentX - lastTouchX;
  lastTouchX = currentX;

  albumArt.style.transform = `translateX(${diffX}px)`;
}

function handleTouchEnd(e) {
  if (!isSwiping) return;

  touchEndX = e.changedTouches[0].screenX;
  const diffX = touchEndX - touchStartX;
  albumArt.style.transition = 'transform 0.3s ease-out';

  if (diffX > swipeThreshold) {
    prevSong(); // Swiped right
  } else if (diffX < -swipeThreshold) {
    nextSong(); // Swiped left
  }

  albumArt.style.transform = 'translateX(0px)';
  isSwiping = false;
}

// ===== Cleanup + Init =====
deleteStuckBtn.onclick = () => {
  songs.forEach(s => { if (s.artUrl && s.artUrl.startsWith('blob:')) URL.revokeObjectURL(s.artUrl); });
  songs = [];
  currentIdx = -1;
  activeAudio.pause();
  if (activeAudio.src) URL.revokeObjectURL(activeAudio.src);
  activeAudio.src = '';
  renderPlaylist();
  setAlbumArt(null);
};

searchInput.addEventListener('input', () => renderPlaylist());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
  .then(reg => console.log('SW registered'))
  .catch(err => console.log('SW failed: ', err));
  });
}

// Save current playlist to localStorage
function backupPlaylist() {
  if (!window.currentTracks || currentTracks.length === 0) {
    showToast("No songs loaded to backup");
    return;
  }

  const data = JSON.stringify(currentTracks, null, 2);
  const blob = new Blob([data], {type: 'application/json'});
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'playlist-backup.json';
  a.click();

  URL.revokeObjectURL(url);
  showToast(`Backed up ${currentTracks.length} songs!`);
}

miniBtn.addEventListener('click', () => {
  document.body.classList.toggle('mini-player');
  miniBtn.textContent = document.body.classList.contains('mini-player') ? '⊞' : '⊟';
  log(document.body.classList.contains('mini-player') ? 'Mini mode ON' : 'Full mode ON');
});

window.addEventListener('load', () => {
  setTimeout(restorePlaylist, 3000); // 3s to be safe
});

// Wait for renderPlaylist to exist, then hijack it
function hookRender() {
  if(typeof renderPlaylist!== 'function') {
    return setTimeout(hookRender, 100);
  }

  const originalRender = renderPlaylist;
  window.renderPlaylist = function(tracks) {
    // Only save if tracks exists and has items
    if(tracks && tracks.length > 0) {
      window.currentTracks = tracks;
      console.log('📋 Tracks captured:', tracks.length, 'with src:',!!tracks[0]?.src);
    } else {
      log('📋 Render called with empty tracks - skip save');
    }
    return originalRender(tracks);
  };

log('✅ renderPlaylist hooked');

}
hookRender();

// Dedupe function - removes duplicate src URLs
function dedupeTracks(tracks) {
  const seen = new Set();
  return tracks.filter(t => {
    if(seen.has(t.src)) return false;
    seen.add(t.src);
    return true;
  });
}

// Backup button

// Restore// Load saved metadata on start
window.savedPlaylistMeta = null;

function restorePlaylist() {
  const raw = localStorage.getItem('crossfadeBackup');
  if(!raw) return;

  const tracks = JSON.parse(raw);
  if(!tracks.length) return;

  window.savedPlaylistMeta = tracks; // store names + order only
  console.log('📋 Found backup:', tracks.length, 'songs. Waiting for user to re-select files...');
  
  // Show message in UI instead of trying to play dead blobs
  const status = document.getElementById('status') || document.body;
  const msg = document.createElement('div');
  msg.id = 'restore-msg';
  msg.style.cssText = 'position:fixed;top:10px;right:10px;background:#4CAF50;color:white;padding:10px;border-radius:6px;z-index:9999';
  msg.textContent = `Backup found: ${tracks.length} songs. Re-select files to restore order.`;
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 5000);
}
window.addEventListener('load', () => setTimeout(restorePlaylist, 1000));

let savedPlaylistMeta = null;

window.backupPlaylist = () => {
  if (!fileInput?.files.length) return  // uses line 78 fileInput
  const meta = Array.from(fileInput.files).map(f => ({ name: f.name }));
  localStorage.setItem('playlistBackup', JSON.stringify(meta));
  alert(`Backed up ${meta.length} songs!`);
};

window.restorePlaylist = () => {
  const raw = localStorage.getItem('playlistBackup');
  if (!raw) return 
  savedPlaylistMeta = JSON.parse(raw);
  alert(`Backup loaded. Re-select files to restore order.`);
};

if(window.innerWidth < 600) document.body.classList.add('mini-player');

settingsBtn.onclick = () => settingsPanel.classList.remove('hidden');
closeSettings.onclick = () => settingsPanel.classList.add('hidden');



// ===== DOWNTOWN - FB Disclaimer Toggle =====
document.addEventListener('DOMContentLoaded', () => {
  const fbToggle = document.getElementById('fbDisclaimerToggle');
  const fbDisclaimer = document.getElementById('fbDisclaimer');

  if (!fbToggle || !fbDisclaimer) return;

  const saved = localStorage.getItem('showFBDisclaimer');
  const showDisclaimer = saved === null ? true : saved === 'true';
  fbToggle.checked = showDisclaimer;

  // Just show/hide. No .open magic
  fbDisclaimer.classList.toggle('hidden', !showDisclaimer);

  fbToggle.addEventListener('change', () => {
    localStorage.setItem('showFBDisclaimer', fbToggle.checked);
    fbDisclaimer.classList.toggle('hidden', !fbToggle.checked);
  });
});

setupMediaSessionHandlers();