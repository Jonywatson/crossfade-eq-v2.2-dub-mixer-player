// Persists the playlist (the audio files plus their order) in IndexedDB so it
// survives closing the app. Titles and artwork are re-read from the files on
// restore, so only { id, order, file } is stored.
const PlaylistStore = (() => {
  const DB_NAME = 'xfade-player';
  const STORE = 'songs';
  let dbPromise = null;
  let nextOrder = 0;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function run(mode, work) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const request = work(t.objectStore(STORE));
      t.oncomplete = () => resolve(request ? request.result : undefined);
      t.onerror = t.onabort = () => reject(t.error);
    }));
  }

  async function loadAll() {
    const records = await run('readonly', store => store.getAll());
    records.sort((a, b) => a.order - b.order);
    nextOrder = records.length ? records[records.length - 1].order + 1 : 0;
    return records;
  }

  function add(songs) {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    songs.forEach(s => { s.order = nextOrder++; });
    return run('readwrite', store => {
      songs.forEach(s => store.put({ id: s.id, order: s.order, file: s.file }));
    });
  }

  function remove(id) {
    return run('readwrite', store => { store.delete(id); });
  }

  function clear() {
    return run('readwrite', store => { store.clear(); });
  }

  async function usageText() {
    if (!navigator.storage || !navigator.storage.estimate) return '';
    const { usage } = await navigator.storage.estimate();
    return `${Math.round(usage / 1048576)} MB`;
  }

  return { loadAll, add, remove, clear, usageText };
})();
