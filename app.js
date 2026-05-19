console.log('Crossfade Player v2.2.1 - Playlist + Repeat/Shuffle Fix');

let songs = [], currentIdx = -1, currentBlobUrl = null;
let repeatMode = 0; // 0=off, 1=all, 2=one
let isShuffling = false, shuffleOrder = [], shufflePosition = 0;
let audioCtx = null, analyser = null, eqChain = [], activeGain, nextGain, isCrossfading = false;
let crossfadeMs = 2000, lastVolume = 1, waveformData = [];

const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const audio = document.getElementById('audio');
const audioNext = document.getElementById('audio-next');
let activeAudio = audio, nextAudio = audioNext;

const playBtn = document.getElementById('play'), prevBtn = document.getElementById('prev'), nextBtn = document.getElementById('next');
const shuffleBtn = document.getElementById('shuffle'), repeatBtn = document.getElementById('repeat');
const eqBtn = document.getElementById('eq-btn'), eqDrawer = document.getElementById('eq-drawer'), eqClose = document.getElementById('eq-close');
const eqPreset = document.getElementById('eq-preset'), eqPresetDrawer = document.getElementById('eq-preset-drawer');
const eqReset = document.getElementById('eq-reset');
const fileInput = document.getElementById('file-input'), folderInput = document.getElementById('folder-input');
const addSongsBtn = document.getElementById('add-songs-btn'), addFolderBtn = document.getElementById('add-folder-btn'), deleteStuckBtn = document.getElementById('delete-stuck');
const songList = document.getElementById('song-list'), searchInput = document.getElementById('search');
const nowTitle = document.getElementById('now-title'), nowArtist = document.getElementById('now-artist'), albumArt = document.getElementById('album-art');
const volume = document.getElementById('volume'), volumeBtn = document.getElementById('volume-btn');
const timer = document.getElementById('timer'), waveformCanvas = document.getElementById('waveform');
const fadeSlider = document.getElementById('fade-slider'), fadeTimeLabel = document.getElementById('fade-time');

const DEFAULT_ART = './assets/default-art.svg';
crossfadeMs = parseInt(fadeSlider.value);

const EQ_PRESETS = {
  flat: [0,0,0,0,0,0,0,0,0,0],
  bass: [8,6,4,2,0,0,-1,-2,-2,-3],
  rock: [5,4,2,-1,-2,-1,1,3,4,5],
  pop: [-2,0,2,3,2,1,1,2,0,-1],
  vocal: [-3,-2,0,2,4,5,4,2,0,-1],
  electronic: [4,5,3,1,0,-1,1,3,5,6]
};

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

  eqChain = EQ_BANDS.map((f, i) => {
    const filter = audioCtx.createBiquadFilter();
    filter.type = i === 0? 'lowshelf' : i === 9? 'highshelf' : 'peaking';
    filter.frequency.value = f;
    filter.Q.value = i === 0 || i === 9? 1 : 1.4;
    filter.gain.value = 0;
    return filter;
  });

  const activeSource = audioCtx.createMediaElementSource(activeAudio);
  const nextSource = audioCtx.createMediaElementSource(nextAudio);
  activeSource.connect(eqChain[0]);
  nextSource.connect(eqChain[0]);
  eqChain.reduce((a, b) => a.connect(b));
  eqChain[eqChain.length - 1].connect(preGain);
  preGain.connect(activeGain).connect(audioCtx.destination);
  preGain.connect(nextGain).connect(audioCtx.destination);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  preGain.connect(analyser);

  activeAudio.addEventListener('timeupdate', onTimeUpdate);
  activeAudio.addEventListener('ended', handleTrackEnd);
  nextAudio.addEventListener('ended', handleTrackEnd);

  setupEQSliders();
  console.log('WebAudio 10-Band ready');
  drawSpectrum();
}

function setupEQSliders(){
  document.querySelectorAll('.eq-band').forEach((bandEl, i) => {
    const slider = bandEl.querySelector('.eq-slider');
    const valSpan = bandEl.querySelector('.eq-value');
    slider.addEventListener('input', e => {
      const band = parseInt(e.target.dataset.band);
      const val = parseFloat(e.target.value);
      if(!eqChain[band]) return;
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

function onTimeUpdate() {
  renderWaveform();
  updateTimer();
  checkCrossfade();
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
  if (crossfadeMs === 0 || isCrossfading ||!activeAudio.duration || songs.length < 2) return;
  if (repeatMode === 2) return; // Don't crossfade on repeat-one
  const timeLeft = activeAudio.duration - activeAudio.currentTime;
  const fadeSec = crossfadeMs / 1000;
  if (timeLeft <= fadeSec && timeLeft > 0.5) startCrossfade();
}

function startCrossfade() {
  let next = getNextIndex();
  if (next === -1) { isCrossfading = false; return; }

  isCrossfading = true;
  activeAudio.removeEventListener('timeupdate', onTimeUpdate);

  nextAudio.currentTime = 0;
  nextGain.gain.value = 0;
  nextAudio.play().catch(() => {});

  const now = audioCtx.currentTime, fadeTime = crossfadeMs / 1000;
  activeGain.gain.cancelScheduledValues(now);
  nextGain.gain.cancelScheduledValues(now);
  activeGain.gain.setValueAtTime(activeGain.gain.value, now);
  activeGain.gain.linearRampToValueAtTime(0, now + fadeTime);
  nextGain.gain.setValueAtTime(0, now);
  nextGain.gain.linearRampToValueAtTime(1, now + fadeTime);

  setTimeout(() => {
    activeAudio.pause();
    activeGain.gain.value = parseFloat(volume.value) || 1;
    [activeAudio, nextAudio] = [nextAudio, activeAudio];
    [activeGain, nextGain] = [nextGain, activeGain];
    activeAudio.addEventListener('timeupdate', onTimeUpdate);
    currentIdx = next;
    updateUI(songs[currentIdx]);
    renderPlaylist();
    preloadNextSong();
    isCrossfading = false;
  }, crossfadeMs);
}

// ===== Playback Logic =====
function getNextIndex() {
  if (repeatMode === 2) return currentIdx; // repeat one

  if (isShuffling) {
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
      if (repeatMode === 1) return 0;
      return -1;
    }
    return next;
  }
}

function getPrevIndex() {
  if (isShuffling) {
    shufflePosition--;
    if (shufflePosition < 0) shufflePosition = shuffleOrder.length - 1;
    return shuffleOrder[shufflePosition];
  } else {
    return (currentIdx - 1 + songs.length) % songs.length;
  }
}

function handleTrackEnd() {
  if (isCrossfading) return;
  if (repeatMode === 2) {
    activeAudio.currentTime = 0;
    activeAudio.play();
    return;
  }
  const next = getNextIndex();
  if (next!== -1) loadSong(next, true);
}

async function loadSong(idx, shouldPlay = true) {
  const song = songs[idx]; if (!song) return;
  await initAudio(); if (audioCtx.state === 'suspended') await audioCtx.resume();
  activeAudio.pause();
  if (activeGain) { activeGain.gain.cancelScheduledValues(audioCtx.currentTime); activeGain.gain.setValueAtTime(parseFloat(volume.value) || 1, audioCtx.currentTime); }
  if (nextGain) { nextGain.gain.cancelScheduledValues(audioCtx.currentTime); nextGain.gain.setValueAtTime(0, audioCtx.currentTime); }
  currentIdx = idx;
  if (isShuffling) shufflePosition = shuffleOrder.indexOf(idx);
  if (activeAudio.src) URL.revokeObjectURL(activeAudio.src);
  activeAudio.src = URL.createObjectURL(song.blob);
  activeAudio.load();
  setAlbumArt(song.blob);
  updateUI(song);
  renderPlaylist();
  drawWaveform(song.blob).catch(() => {});
  preloadNextSong();
  if (shouldPlay) { try { await activeAudio.play(); playBtn.textContent = '⏸️'; } catch {} }
}

function preloadNextSong() {
  if (crossfadeMs === 0 || songs.length < 2) return;
  let nextIdx = getNextIndex();
  if (nextIdx === -1 || nextIdx === currentIdx) return;
  const nextSong = songs[nextIdx];
  if (!nextSong || nextAudio.dataset.songIdx == nextIdx) return;
  if (nextAudio.src) URL.revokeObjectURL(nextAudio.src);
  nextAudio.src = URL.createObjectURL(nextSong.blob);
  nextAudio.dataset.songIdx = nextIdx;
  nextAudio.load();
}

// ===== Controls =====
playBtn.addEventListener('click', async () => {
  await initAudio();
  if (songs.length === 0) return;
  if (currentIdx === -1) { await loadSong(0, true); return; }
  if (activeAudio.paused) { await activeAudio.play(); playBtn.textContent = '⏸️'; }
  else { activeAudio.pause(); playBtn.textContent = '▶️'; }
});

nextBtn.onclick = () => {
  const next = getNextIndex();
  if (next!== -1) loadSong(next, true);
};

prevBtn.onclick = () => {
  const prev = getPrevIndex();
  loadSong(prev, true);
};

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
function updateUI(song) {
  nowTitle.textContent = song.title;
  nowArtist.textContent = song.artist;
}

function setAlbumArt(file) {
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  albumArt.src = DEFAULT_ART;
  if (!file) return;
  jsmediatags.read(file, {
    onSuccess: tag => {
      if (tag.tags.picture) {
        const blob = new Blob([new Uint8Array(tag.tags.picture.data)], {type: tag.tags.picture.format});
        currentBlobUrl = URL.createObjectURL(blob);
        albumArt.src = currentBlobUrl;
      }
    },
    onError: () => { albumArt.src = DEFAULT_ART; }
  });
}

// FIXED: Playlist render with proper structure
function renderPlaylist() {
  const list = searchInput && searchInput.value? songs.filter(s => s.title.toLowerCase().includes(searchInput.value.toLowerCase())) : songs;
  songList.innerHTML = list.map((s) => {
    const realIdx = songs.indexOf(s);
    return `<li data-idx="${realIdx}" class="${realIdx === currentIdx? 'active' : ''}">
      <img class="song-thumb" src="${s.artUrl}">
      <div class="song-meta">
        <div class="song-title">${s.title}</div>
        <div class="song-artist">${s.artist}</div>
      </div>
      <button class="del-song" data-idx="${realIdx}">×</button>
    </li>`;
  }).join('');
}

songList.onclick = e => {
  if (e.target.classList.contains('del-song')) {
    e.stopPropagation();
    const idx = parseInt(e.target.dataset.idx);
    songs.splice(idx, 1);
    if (currentIdx === idx) {
      activeAudio.pause();
      currentIdx = -1;
    } else if (currentIdx > idx) {
      currentIdx--;
    }
    if (isShuffling) generateShuffleOrder();
    renderPlaylist();
    return;
  }
  const li = e.target.closest('li');
  if (li) loadSong(parseInt(li.dataset.idx));
};

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('audio/'));

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const id = crypto.randomUUID();

    const song = {
      id,
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: 'Loading...',
      blob: file,
      artUrl: DEFAULT_ART
    };
    songs.push(song);

    renderPlaylist();
    if (currentIdx === -1 && songs.length === 1) loadSong(0, false);

    try {
      const meta = await readTagsAndArt(file);
      song.title = meta.title;
      song.artist = meta.artist;
      song.artUrl = meta.artUrl;

      const idx = songs.length - 1;
      const row = songList.querySelector(`li[data-idx="${idx}"]`);
      if (row) {
        row.querySelector('.song-title').textContent = song.title;
        row.querySelector('.song-artist').textContent = song.artist;
        row.querySelector('.song-thumb').src = song.artUrl;
      }
      if (currentIdx === idx) updateUI(song);

    } catch (err) {
      console.warn('Tag read failed for', file.name, err);
    }

    await new Promise(r => setTimeout(r, 0));
  }

  if (isShuffling) generateShuffleOrder();
}

addSongsBtn.onclick = () => fileInput.click();
addFolderBtn.onclick = () => folderInput.click();
fileInput.onchange = e => handleFiles(e.target.files);
folderInput.onchange = e => handleFiles(e.target.files);

async function readTagsAndArt(file) {
  return new Promise(resolve => {
    jsmediatags.read(file, {
      onSuccess: tag => {
        let artUrl = DEFAULT_ART;
        try {
          if (tag.tags.picture) {
            const blob = new Blob([new Uint8Array(tag.tags.picture.data)], {type: tag.tags.picture.format});
            artUrl = URL.createObjectURL(blob);
          }
        } catch (e) {
          console.warn('Art extraction failed:', e);
        }
        resolve({
          title: tag.tags.title || file.name.replace(/\.[^/.]+$/, ""),
          artist: tag.tags.artist || 'Unknown',
          artUrl: artUrl
        });
      },
      onError: () => resolve({
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: 'Unknown',
        artUrl: DEFAULT_ART
      })
    });
  });
}

function updateTimer() {
  if (!activeAudio.duration) return;
  timer.textContent = `${fmt(activeAudio.currentTime)} / ${fmt(activeAudio.duration)}`;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
  const canvas = document.getElementById('spectrum');
  if (!canvas ||!analyser) return;
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount);
  function loop() {
    requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bw = canvas.width / 24;
    for (let i = 0; i < 24; i++) {
      const bh = data[i * 4] / 255 * canvas.height;
      ctx.fillStyle = i < 8? '#aa4444' : i < 16? '#aa8844' : '#44aa44';
      ctx.fillRect(i * bw, canvas.height - bh, bw - 1, bh);
    }
  }
  loop();
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