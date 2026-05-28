// === DEBUG LOGGER ===
const DEBUG = false; // Set to true when John Breaker needs to investigate
const log = (...args) => DEBUG && console.log(...args);
const warn = (...args) => DEBUG && console.warn(...args);
const error = (...args) => console.error(...args); // Always show errors
// ====================


console.log('Crossfade Player v2.2.8 - EQ Fix + AbortError + Crossfade Art');

// === Canvas + Spectrum Globals === 
const canvas = document.getElementById('spectrum'); // match your canvas id
const ctx = canvas.getContext('2d');
const barCount = 128; // or however many bars you want

let songs = [], currentIdx = -1;
let repeatMode = 0; // 0=off, 1=all, 2=one
let isShuffling = false, shuffleOrder = [], shufflePosition = 0;
let audioCtx = null, analyser = null, eqChain = [], activeGain, nextGain, isCrossfading = false;
let spectrumRunning = false; // Keep only this one
let dataArray; // ADD THIS
let crossfadeMs = 5000, lastVolume = 1, waveformData = [];
let isHandlingEnded = false;
let currentSwipeTarget = null;
let crossfadeLock = -1; // -1 = idle, else = idx we're actively fading to

const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const audio = document.getElementById('audio');
const audioNext = document.getElementById('audio-next');
let activeAudio = audio, nextAudio = audioNext;
//const shuffleBtn = document.getElementById('shuffle');
let isShuffle = false;

const playBtn = document.getElementById('play'), prevBtn = document.getElementById('prev'), nextBtn = document.getElementById('next');
const shuffleBtn = document.getElementById('shuffle'), repeatBtn = document.getElementById('repeat');
const eqBtn = document.getElementById('eq-btn'), eqDrawer = document.getElementById('eq-drawer'), eqClose = document.getElementById('eq-close');
const eqPreset = document.getElementById('eq-preset'), eqPresetDrawer = document.getElementById('eq-preset-drawer');
const eqReset = document.getElementById('eq-reset');
const fileInput = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');
const addSongsBtn = document.getElementById('add-songs-btn'); // THIS IS YOUR BUTTON
const addFolderBtn = document.getElementById('add-folder-btn');
log('fileInput found:')

let clickCount = 0;
addSongsBtn.addEventListener('click', () => {
  clickCount++;
  log('Add Songs clicked #', clickCount);
  fileInput.click();
});
//const addSongsBtn = document.getElementById('add-songs-btn'), addFolderBtn = document.getElementById('add-folder-btn'); 
const deleteStuckBtn = document.getElementById('delete-stuck');
const songList = document.getElementById('song-list'), searchInput = document.getElementById('search');
const nowTitle = document.getElementById('now-title'), nowArtist = document.getElementById('now-artist'); 
const albumArt = document.getElementById('album-art');
const playerContainer = document.querySelector('.album-art-container'); // Change this selector


fileInput.addEventListener('change', async (e) => {
  const rawFiles = Array.from(e.target.files);
  const files = rawFiles.filter(f => /\.(mp3|m4a|flac|ogg|wav|aac)$/i.test(f.name));

  if (!files.length) {
    e.target.value = '';
    return;
  }

  for (const file of files) {
    const songData = await new Promise(resolve => {
      new jsmediatags.Reader(file).read({
        onSuccess: (tag) => {
          let artUrl = './assets/default-art.svg';
          if (tag.tags.picture) {
            try {
              const newBlob = new Blob([new Uint8Array(tag.tags.picture.data)], {type: tag.tags.picture.format});
              artUrl = URL.createObjectURL(newBlob);
            } catch (e) {}
          }
          resolve({
            id: crypto.randomUUID(),
            title: tag.tags.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: tag.tags.artist || 'Unknown Artist',
            album: tag.tags.album || '',
            blob: file,
            artUrl: artUrl
          });
        },
        onError: () => resolve({
          id: crypto.randomUUID(),
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: 'Unknown Artist',
          album: '',
          blob: file,
          artUrl: './assets/default-art.svg'
        })
      });
    });
    songs.push(songData);
  }

  renderPlaylist();
  e.target.value = '';

  if (isShuffling) generateShuffleOrder();
  if (currentIdx === -1 && songs.length > 0) loadSong(0, false);
});

folderInput.addEventListener('change', (e) => {
  log('FOLDER RAW FILES:', e.target.files);
  const files = [...e.target.files];
  log('FILTERED FOLDER FILES:', files.length);
  handleFiles(files); // use the same handler as fileInput
});


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

const volume = document.getElementById('volume'), volumeBtn = document.getElementById('volume-btn');
const timer = document.getElementById('timer'), waveformCanvas = document.getElementById('waveform');
const fadeSlider = document.getElementById('fade-slider'), fadeTimeLabel = document.getElementById('fade-time');


const DEFAULT_ART = './assets/default-art.svg';
crossfadeMs = parseInt(fadeSlider.value);

// FIX 1: Correct EQ preset length
const EQ_PRESETS = {
  flat: [0,0,0,0,0,0,0,0,0,0],
  bass: [8,6,4,2,0,0,-1,-2,-2,-3],
  rock: [5,4,2,-1,-2,-1,1,3,4,5],
  pop: [-2,0,2,3,2,1,1,2,0,-1],
  vocal: [-3,-2,0,2,4,5,4,2,0,-1],
  electronic: [4,5,3,1,0,-1,1,3,5,6]
};

// Add these right after your declarations, before functions
let touchStartX = 0;
let touchEndX = 0;
let touchStartY = 0;
let isSwiping = false;
let touchStartTime = 0;
let lastTouchX = 0;
let velocity = 0;
const swipeThreshold = 50; 

let audioContext, source, filters = [];

// ===== Audio Engine =====
async function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();

  activeGain = audioCtx.createGain();
  nextGain = audioCtx.createGain();
  nextGain.gain.value = 0;
  activeGain.gain.value = parseFloat(volume.value) || 1;

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

  // Actually chain the EQ filters
  eqChain.reduce((prev, curr) => {
    prev.connect(curr);
    return curr;
  });

  const activeSource = audioCtx.createMediaElementSource(activeAudio);
  const nextSource = audioCtx.createMediaElementSource(nextAudio);

  // Sources -> EQ start
  activeSource.connect(eqChain[0]);
  nextSource.connect(eqChain[0]);

  // EQ end -> preGain
  eqChain[eqChain.length - 1].connect(preGain);

  // Create a mix bus for analyser to tap
  const mixBus = audioCtx.createGain();
  mixBus.gain.value = 1;

  // preGain -> crossfade gains -> mixBus -> destination
  preGain.connect(activeGain);
  preGain.connect(nextGain);
  activeGain.connect(mixBus);
  nextGain.connect(mixBus);
  mixBus.connect(audioCtx.destination);

  // Analyser taps the final mix
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048; // CHANGED: was 256, need 2048 for 128 bars
  analyser.smoothingTimeConstant = 0.7; // CHANGED: was 0.8
  mixBus.connect(analyser);

  // ADD THIS LINE RIGHT HERE
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  activeAudio.addEventListener('timeupdate', onTimeUpdate);
  activeAudio.addEventListener('ended', handleTrackEnd);

  setupEQSliders();
  log('WebAudio 10-Band ready');
  log('AudioContext state:', audioCtx.state);

  // REMOVE this line from here - we'll call it after play starts
  // drawSpectrum();
}

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
    nextAudio.src = URL.createObjectURL(nextSong.blob);
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

  activeGain.gain.cancelScheduledValues(now);
  nextGain.gain.cancelScheduledValues(now);

  activeGain.gain.setValueAtTime(activeGain.gain.value || targetVol, now);
  activeGain.gain.exponentialRampToValueAtTime(0.001, now + fadeTime);

  nextGain.gain.setValueAtTime(0.001, now);
  nextGain.gain.exponentialRampToValueAtTime(targetVol, now + fadeTime);

  const doSwap = async () => {
    log('doSwap START. currentIdx:', currentIdx, '->', crossfadeLock);
    try {
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

      await setAlbumArt(songs[currentIdx].blob);
      updateUI(songs[currentIdx]);
      updateMediaSession(songs[currentIdx]);
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
async function loadSong(idx, shouldPlay = true) {
  currentIdx = idx;
  const song = songs[idx];
  log('Song data:', song); // ADD THIS - check console
  if (!song) return;

  await initAudio();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  // Ensure clean state before loading
  if (!activeAudio.paused) {
    activeAudio.pause();
    await new Promise(r => setTimeout(r, 0));
  }

  if (activeGain) {
    activeGain.gain.cancelScheduledValues(audioCtx.currentTime);
    activeGain.gain.setValueAtTime(parseFloat(volume.value) || 1, audioCtx.currentTime);
  }
  if (nextGain) {
    nextGain.gain.cancelScheduledValues(audioCtx.currentTime);
    nextGain.gain.setValueAtTime(0, audioCtx.currentTime);
  }

  if (isShuffling) shufflePosition = shuffleOrder.indexOf(idx);

  // DELETE THIS LINE: if (activeAudio.src) URL.revokeObjectURL(activeAudio.src);
  activeAudio.src = URL.createObjectURL(song.blob); // KEEP THIS - just overwrite
  activeAudio.load();

  await setAlbumArt(song.blob);
  updateUI(song);
  updateMediaSession(song);
  renderPlaylist();
  drawWaveform(song.blob).catch(() => {});
  preloadNextSong();

  if (shouldPlay) {
    try {
      // Wait for audio to be ready
      if (activeAudio.readyState < 2) {
        await new Promise(resolve => {
          activeAudio.addEventListener('canplay', resolve, { once: true });
        });
      }
      await activeAudio.play();
      isPlaying = true;
      playBtn.textContent = '⏸️';
      updateMediaSessionState();
    } catch (e) {
      if (e.name!== 'AbortError') console.log('Play failed:', e);
      isPlaying = false;
      playBtn.textContent = '▶️';
    }
  }
}


function updateUI(song) {
  const titleEl = document.getElementById('now-title');
  const artistEl = document.getElementById('now-artist');
  const albumEl = document.getElementById('now-album');
  const artEl = document.getElementById('album-art'); // THIS IS THE FIX
  
  if (titleEl) titleEl.textContent = song.title || 'Unknown Track';
  if (artistEl) artistEl.textContent = song.artist || 'Unknown Artist';
  if (albumEl) {
    albumEl.textContent = song.album || '';
    albumEl.style.display = song.album ? 'block' : 'none';
  }
  if (artEl) artEl.src = song.artUrl || './assets/default-art.svg';
}

function preloadNextSong() {
  if (crossfadeMs === 0 || songs.length < 2) return;
  let nextIdx = getNextIndex();
  if (nextIdx === -1 || nextIdx === currentIdx) return;
  const nextSong = songs[nextIdx];
  if (!nextSong || nextAudio.dataset.songIdx == nextIdx) return;

  // DELETE: if (nextAudio.src) URL.revokeObjectURL(nextAudio.src);
  nextAudio.src = URL.createObjectURL(nextSong.blob); // Just overwrite
  nextAudio.dataset.songIdx = nextIdx;
  nextAudio.load();
}

// ===== Media Session API =====
function updateMediaSession(song) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Unknown',
      artist: song.artist || 'Unknown',
      album: 'PWA Music Player',
      artwork: [
        { src: song.artUrl || DEFAULT_ART, sizes: '512x512', type: 'image/png' }
      ]
    });
    navigator.mediaSession.playbackState = activeAudio.paused? 'paused' : 'playing';
  }
}

function updateMediaSessionState() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = activeAudio.paused? 'paused' : 'playing';
  }
}

function setupMediaSessionHandlers() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', async () => {
      await initAudio();
      
      // CHANGED: audioCtx not audioContext
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      
      if (currentIdx === -1 && songs.length > 0) {
        await loadSong(0, true);
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


function safeStartSpectrum() {
  if (!spectrumRunning && analyser) {
    spectrumRunning = true;
    drawSpectrum();
  }
}

async function togglePlay() {
  if (!songs.length) return;

  if (!audioCtx) await initAudio();

  if (!activeAudio.src || activeAudio.src === window.location.href || activeAudio.src === '' || currentIdx === -1) {
    await loadSong(currentIdx === -1 ? 0 : currentIdx, true);
    return;
  }

  if (activeAudio.paused) {
    try {
      // FIX 1: Resume FIRST, before play
      if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      
      await activeAudio.play();
      isPlaying = true;
      playBtn.textContent = '⏸️';
      updateMediaSessionState();
      
      // FIX 2: Start spectrum AFTER audio is playing
      safeStartSpectrum();
      
    } catch (e) {
      if (e.name !== 'AbortError') console.log('Play failed:', e);
    }
  } else {
    activeAudio.pause();
    isPlaying = false;
    playBtn.textContent = '▶️';
    updateMediaSessionState();
  }
}

playBtn.addEventListener('click', togglePlay);

function nextSong() {
  const next = getNextIndex();
  if (next!== -1) loadSong(next, true);
}

// FIX 4: Prev with proper error handling
function prevSong() {
  if (activeAudio.currentTime > 3) {
    activeAudio.currentTime = 0;
    activeAudio.play().catch(e => {
      if (e.name!== 'AbortError') console.log('Prev restart failed:', e);
    });
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

  // If we already have real art cached, don't re-parse
  // if (song.artUrl && song.artUrl!== DEFAULT_ART) {
   // albumArt.src = song.artUrl;
   // return;
  //} 

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
    return `<li data-song-id="${s.id}" data-idx="${realIdx}" class="${realIdx === currentIdx? 'active' : ''}">
      <img class="song-thumb" src="${s.artUrl}">
      <div class="song-meta">
        <div class="song-title">${s.title}</div>
        <div class="song-artist">${s.artist}</div>
        ${s.album? `<div class="song-album">${s.album}</div>` : ''}
      </div>
      <button class="del-song" data-song-id="${s.id}">×</button>
    </li>`;
  }).join('');
}

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
  const li = e.target.closest('li');
  if (li) {
    const idx = parseInt(li.dataset.idx);
    if (!isNaN(idx)) loadSong(idx);
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

    if (currentIdx === -1 && songs.length === 1) loadSong(0, false);

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

searchInput.addEventListener('input', renderPlaylist);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
  .then(reg => console.log('SW registered'))
  .catch(err => console.log('SW failed: ', err));
  });
}

setupMediaSessionHandlers();