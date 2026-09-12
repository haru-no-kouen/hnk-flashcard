// 春の公園 - Flashcard
// SPA sederhana: satu index.html, navigasi antar "screen" diatur di sini
// lewat location.hash. Data kartu dibaca dari file csv di folder /data.
//
// PENTING: fetch() ke file csv lokal butuh dijalankan lewat server
// (misal `npx serve`, ekstensi "Live Server", atau saat sudah di-hosting
// di GitHub Pages). Kalau index.html dibuka langsung dobel-klik (file://),
// browser akan blokir fetch-nya karena aturan CORS bawaan browser.

/* =========================================================
   1. DATA STRUKTUR TETAP (level, jenis kata, sektor -- ini
      cuma struktur navigasi, bukan isi kartu, jadi aman di-hardcode)
   ========================================================= */

const JLPT_LEVELS = [
  { id: 'n5', label: 'N5', desc: 'Dasar', folder: 'N5' },
  { id: 'n4', label: 'N4', desc: 'Dasar-menengah', folder: 'N4' },
  { id: 'n3', label: 'N3', desc: 'Menengah', folder: 'N3' },
  { id: 'n2', label: 'N2', desc: 'Menengah-lanjut', folder: 'N2' },
  { id: 'n1', label: 'N1', desc: 'Lanjut', folder: 'N1' },
];

const WORD_TYPES = [
  { id: 'verb', jp: '動詞', label: 'Kata kerja', icon: 'run', file: 'kata-kerja' },
  { id: 'i-adj', jp: 'い形容詞', label: 'Kata sifat -i', icon: 'sparkle', file: 'kata-sifat-i' },
  { id: 'na-adj', jp: 'な形容詞', label: 'Kata sifat -na', icon: 'sparkle', file: 'kata-sifat-na' },
  { id: 'noun', jp: '名詞', label: 'Kata benda', icon: 'box', file: 'kata-benda' },
];

const SSW_SECTORS = [
  { id: 'caregiver', label: 'Caregiver', file: 'caregiver' },
  { id: 'konstruksi', label: 'Konstruksi', file: 'konstruksi' },
  { id: 'pertanian-peternakan', label: 'Pertanian dan Peternakan', file: 'pertanian-peternakan' },
  // TODO: tambah sektor lain di sini nanti
];

const LATIHAN_BIDANG = [
  { id: 'jlpt', label: 'JLPT', desc: 'Kosakata dalam kalimat', icon: 'bubbleRow' },
  { id: 'kanji', label: 'Kanji', desc: 'Bacaan kanji dalam kalimat', icon: 'kanjiGridRow' },
  { id: 'ssw', label: 'SSW', desc: 'Segera hadir', icon: 'sector' },
];

const QUIZ_TARGET_COUNT = 15;
const QUIZ_DURATION_SECONDS = 30 * 60;

/* =========================================================
   2. LOKASI FILE CSV
      data/JLPT/{level}/{jenis-kata}.csv
      data/SSW/{sektor}.csv
   ========================================================= */

function jlptCsvPath(levelId, wordTypeId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  const wordType = WORD_TYPES.find((w) => w.id === wordTypeId);
  if (!level || !wordType) return null;
  return `data/JLPT/${level.folder}/${wordType.file}.csv`;
}

function sswCsvPath(sectorId) {
  const sector = SSW_SECTORS.find((s) => s.id === sectorId);
  if (!sector) return null;
  return `data/SSW/${sector.file}.csv`;
}

function kanjiCsvPath(levelId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  if (!level) return null;
  return `data/Kanji/${level.folder}.csv`;
}

function bunpouCsvPath(levelId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  if (!level) return null;
  return `data/Bunpou/${level.folder}.csv`;
}

function kuisCsvPath(bidangId, levelId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  if (!level) return null;
  if (bidangId === 'jlpt') return `data/Kuis/JLPT/${level.folder}.csv`;
  if (bidangId === 'kanji') return `data/Kuis/Kanji/${level.folder}.csv`;
  return null; // ssw belum ada formatnya
}

/* =========================================================
   3. PARSER CSV (ringan, tanpa library luar)
      Mendukung field yang dibungkus tanda kutip "..." kalau
      isinya mengandung koma atau baris baru.
   ========================================================= */

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
      continue;
    }

    if (char === '"') { inQuotes = true; }
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char === '\r') { /* abaikan */ }
    else { field += char; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function parseCsv(text) {
  const rows = parseCsvRows(text.trim());
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
    return obj;
  });
}

// baris csv -> bentuk kartu yang dipakai tampilan flashcard
function rowToCard(row) {
  return {
    kanji: row.kosakata || '',
    reading: row.furigana || '',
    arti: row.arti || '',
    examples: [
      { jp: row.contoh1 || '', id: row.arti_contoh1 || '' },
      { jp: row.contoh2 || '', id: row.arti_contoh2 || '' },
    ],
  };
}

// "bagian-tubuh" -> "Bagian tubuh"
function slugToLabel(slug) {
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// baris csv kanji -> bentuk kartu kanji. contoh kata dibaca dari
// contoh1/baca1/arti1 s.d. contoh4/baca4/arti4, tapi yang kosong
// tidak dimasukkan -- jadi kanji cukup punya 2 contoh pun tidak masalah.
function rowToKanjiCard(row) {
  const examples = [];
  for (let i = 1; i <= 4; i++) {
    const word = (row[`contoh${i}`] || '').trim();
    if (!word) continue;
    examples.push({
      word,
      reading: (row[`baca${i}`] || '').trim(),
      arti: (row[`arti${i}`] || '').trim(),
    });
  }
  return {
    kanji: row.kanji || '',
    onyomi: row.onyomi || '',
    kunyomi: row.kunyomi || '',
    arti: row.arti || '',
    day: parseInt(row.day, 10) || null,
    examples,
  };
}

// baris csv bunpou -> bentuk kartu tata bahasa. aturan pembentukan
// dibaca dari bentuk1_label/bentuk1_rumus s.d. bentuk4_label/bentuk4_rumus,
// yang kosong tidak dimasukkan -- jadi bunpou yang cuma butuh 1 aturan
// (misal ～たいです) ya cuma tampil 1 kotak, bukan dipaksa 4.
function rowToGrammarCard(row) {
  const forms = [];
  for (let i = 1; i <= 4; i++) {
    const rule = (row[`bentuk${i}_rumus`] || '').trim();
    if (!rule) continue;
    forms.push({
      label: (row[`bentuk${i}_label`] || '').trim(),
      rule,
    });
  }
  return {
    bunpou: row.bunpou || '',
    arti: row.arti || '',
    forms,
    day: parseInt(row.day, 10) || null,
    examples: [
      { jp: row.contoh1 || '', id: row.arti_contoh1 || '' },
      { jp: row.contoh2 || '', id: row.arti_contoh2 || '' },
    ],
  };
}

// baris csv kuis -> bentuk soal pilihan ganda. tanda **kata** di kolom
// kalimat otomatis diubah jadi <b>kata</b> karena user tidak bisa nge-bold
// langsung di csv.
function boldMarkupToHtml(text) {
  return (text || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function rowToQuizQuestion(row) {
  const letterToIndex = { a: 0, b: 1, c: 2, d: 3 };
  return {
    sentenceHtml: boldMarkupToHtml(row.kalimat),
    options: [row.pilihan_a || '', row.pilihan_b || '', row.pilihan_c || '', row.pilihan_d || ''],
    correctIndex: letterToIndex[(row.jawaban || '').trim().toLowerCase()] ?? null,
  };
}

/* =========================================================
   4. FETCH + CACHE
      Hasil parse csv per path disimpan di cache biar tidak
      fetch berulang tiap pindah-pindah layar.
   ========================================================= */

const csvCache = new Map(); // path -> Promise<{ rows, error }>

function loadCsv(path) {
  if (!path) return Promise.resolve({ rows: [], error: null });
  if (csvCache.has(path)) return csvCache.get(path);

  const promise = fetch(path)
    .then((res) => {
      if (!res.ok) return { rows: [], error: null }; // file belum ada -> anggap kosong
      return res.text().then((text) => ({ rows: parseCsv(text), error: null }));
    })
    .catch((err) => {
      console.error('Gagal memuat csv:', path, err);
      return { rows: [], error: err };
    });

  csvCache.set(path, promise);
  return promise;
}

async function loadJlptCards(levelId, wordTypeId) {
  const { rows, error } = await loadCsv(jlptCsvPath(levelId, wordTypeId));
  return { cards: rows.map(rowToCard).map((c, i) => ({ ...c, day: parseInt(rows[i].day, 10) || null })), error };
}

async function loadSswCards(sectorId) {
  const { rows, error } = await loadCsv(sswCsvPath(sectorId));
  return { cards: rows.map(rowToCard).map((c, i) => ({ ...c, grup: rows[i].grup || '' })), error };
}

async function loadKanjiCards(levelId) {
  const { rows, error } = await loadCsv(kanjiCsvPath(levelId));
  return { cards: rows.map(rowToKanjiCard), error };
}

async function loadGrammarCards(levelId) {
  const { rows, error } = await loadCsv(bunpouCsvPath(levelId));
  return { cards: rows.map(rowToGrammarCard), error };
}

async function loadQuizQuestions(bidangId, levelId) {
  const { rows, error } = await loadCsv(kuisCsvPath(bidangId, levelId));
  return { questions: rows.map(rowToQuizQuestion), error };
}

// Fisher-Yates shuffle, tidak mengubah array asli
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function formatMmSs(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* =========================================================
   5. ICON HELPERS (inline SVG, biar tidak butuh library luar)
   ========================================================= */

const ICONS = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18l-6-6 6-6"/></svg>`,
  chevron: `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg>`,
  navLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18l-6-6 6-6"/></svg>`,
  navRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg>`,
  run: `<svg class="row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M13 4l-2 5 3 2-1 7M8 8l3 1 2-3M6 20l4-5"/></svg>`,
  sparkle: `<svg class="row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v4M12 17v4M4 12h4M16 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>`,
  box: `<svg class="row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8l8-4 8 4-8 4-8-4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/></svg>`,
  sector: `<svg class="row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H10v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="width:15px;height:15px;"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
  confetti: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="width:34px;height:34px;color:var(--sakura);"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 5-5"/></svg>`,
  // ikon khusus 4 kartu dashboard, biar tiap kategori beda bentuk
  bubble: `<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 4h8a2 2 0 0 1 2 2v9l-4 4H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h4"/></svg>`,
  kanjiGrid: `<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 4v16M18 4v16M4 9h5M15 9h5M4 15h5M15 15h5"/></svg>`,
  bubbleRow: `<svg class="row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 4h8a2 2 0 0 1 2 2v9l-4 4H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h4"/></svg>`,
  kanjiGridRow: `<svg class="row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 4v16M18 4v16M4 9h5M15 9h5M4 15h5M15 15h5"/></svg>`,
  list: `<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h10M4 18h13"/></svg>`,
  target: `<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/></svg>`,
};

/* =========================================================
   6. ROUTER
   ========================================================= */

const viewRoot = document.getElementById('view-root');

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, ''); // buang '#' atau '#/'
  return hash.split('/').filter(Boolean); // array segmen, contoh: ['kotoba','jlpt','n5']
}

function navigate(path) {
  location.hash = '/' + path;
}

function renderRoute() {
  const parts = parseRoute();
  updateFooterActiveState(parts);

  // kalau ada sesi kuis yang masih berjalan tapi user pindah lewat
  // navigasi hash (misal klik Home di footer), matikan timer-nya
  // dulu supaya tidak terus jalan nyangkut di background.
  if (quizSession && quizSession.timerId) {
    clearInterval(quizSession.timerId);
    quizSession = null;
  }

  if (parts.length === 0) {
    return renderDashboard();
  }

  const [section, ...rest] = parts;

  if (section === 'kotoba') {
    const [tab = 'jlpt', level, wordType, day] = rest;

    if (!level) return renderKotobaHome(tab);

    if (tab === 'jlpt') {
      if (!wordType) return renderWordTypeList(level);
      if (!day) return renderDayList(level, wordType);
      return renderJlptFlashcard(level, wordType, day);
    }

    if (tab === 'ssw') {
      // di jalur ssw: 'level' = id sektor, 'wordType' = id topik (nilai grup dari csv)
      if (!wordType) return renderSswTopicList(level);
      return renderSswFlashcard(level, wordType);
    }
  }

  if (section === 'kanji') {
    const [level, day] = rest;
    if (!level) return renderKanjiLevelList();
    if (!day) return renderKanjiDayList(level);
    return renderKanjiFlashcard(level, day);
  }

  if (section === 'tatabahasa') {
    const [level, day] = rest;
    if (!level) return renderGrammarLevelList();
    if (!day) return renderGrammarDayList(level);
    return renderGrammarFlashcard(level, day);
  }
  if (section === 'latihan') {
    const [bidang, level] = rest;
    if (!bidang) return renderLatihanBidangList();
    if (!level) return renderLatihanLevelList(bidang);
    return renderKuisInfo(bidang, level);
  }

  // fallback kalau route tidak dikenali
  return renderDashboard();
}

window.addEventListener('hashchange', renderRoute);
document.addEventListener('DOMContentLoaded', () => {
  setupFooterNav();
  renderRoute();
});

/* =========================================================
   7. RENDER: Dashboard
   ========================================================= */

function renderDashboard() {
  viewRoot.innerHTML = `
    <header class="app-header">
      <h1 class="app-title">春の公園</h1>
      <p class="app-subtitle">Flashcard &mdash; belajar santai, seperti di taman</p>
    </header>
    <p class="section-label">Pilih kategori</p>
    <div class="category-grid">
      <button class="category-card cat-kosakata" data-go="kotoba">
        ${ICONS.bubble}
        <span class="category-jp">言葉</span>
        <span class="category-label">Kosakata</span>
        <span class="category-level">JLPT &ndash; SSW</span>
      </button>
      <button class="category-card cat-kanji" data-go="kanji">
        ${ICONS.kanjiGrid}
        <span class="category-jp">漢字</span>
        <span class="category-label">Kanji</span>
        <span class="category-level">N5 &ndash; N1</span>
      </button>
      <button class="category-card cat-tatabahasa" data-go="tatabahasa">
        ${ICONS.list}
        <span class="category-jp">文法</span>
        <span class="category-label">Tata bahasa</span>
        <span class="category-level">N5 &ndash; N1</span>
      </button>
      <button class="category-card cat-latihan" data-go="latihan">
        ${ICONS.target}
        <span class="category-jp">練習</span>
        <span class="category-label">Latihan &amp; kuis</span>
        <span class="category-level">Campuran</span>
      </button>
    </div>
  `;

  viewRoot.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.go));
  });
}

/* =========================================================
   8. RENDER: Kotoba (tab JLPT / SSW)
   ========================================================= */

function renderKotobaHome(tab) {
  const isJlpt = tab !== 'ssw';

  viewRoot.innerHTML = `
    ${breadcrumb('春の公園', 'dashboard')}
    <h2 class="screen-title">言葉 <span class="jp-sub">Kosakata</span></h2>

    <div class="segmented">
      <button data-tab="jlpt" class="${isJlpt ? 'active' : ''}">JLPT</button>
      <button data-tab="ssw" class="${!isJlpt ? 'active' : ''}">SSW</button>
    </div>

    <div class="row-list" id="kotoba-list"></div>
  `;

  const list = document.getElementById('kotoba-list');

  if (isJlpt) {
    list.innerHTML = JLPT_LEVELS.map((lv) => rowItemHtml({
      title: lv.label,
      subtitle: lv.desc,
      goto: `kotoba/jlpt/${lv.id}`,
    })).join('');
  } else {
    list.innerHTML = SSW_SECTORS.map((s) => rowItemHtml({
      title: s.label,
      icon: 'sector',
      goto: `kotoba/ssw/${s.id}`,
    })).join('') + `<p class="hint-text">Sektor lain akan ditambahkan</p>`;
  }
  bindRowClicks(list);

  viewRoot.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`kotoba/${btn.dataset.tab}`));
  });

  bindBreadcrumb();
}

/* =========================================================
   9. RENDER: daftar jenis kata di dalam satu level JLPT
   ========================================================= */

function renderWordTypeList(levelId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  if (!level) return renderKotobaHome('jlpt');

  viewRoot.innerHTML = `
    ${breadcrumb('言葉 › JLPT', 'kotoba/jlpt')}
    <h2 class="screen-title">${level.label}</h2>
    <p class="screen-subtitle">Pilih jenis kata</p>
    <div class="row-list" id="wordtype-list"></div>
  `;

  const list = document.getElementById('wordtype-list');
  list.innerHTML = WORD_TYPES.map((wt) => rowItemHtml({
    title: wt.jp,
    subtitle: wt.label,
    icon: wt.icon,
    goto: `kotoba/jlpt/${levelId}/${wt.id}`,
  })).join('');

  bindRowClicks(list);
  bindBreadcrumb();
}

/* =========================================================
   10. RENDER: daftar day di dalam satu jenis kata (dari csv)
   ========================================================= */

async function renderDayList(levelId, wordTypeId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  const wordType = WORD_TYPES.find((w) => w.id === wordTypeId);
  if (!level || !wordType) return renderKotobaHome('jlpt');

  viewRoot.innerHTML = `
    ${breadcrumb(`${level.label} › ${wordType.jp}`, `kotoba/jlpt/${levelId}`)}
    <h2 class="screen-title">${wordType.label}</h2>
    <p class="screen-subtitle">Pilih kelompok day</p>
    <p class="hint-text" id="day-status">Memuat data&hellip;</p>
    <div class="day-grid" id="day-grid"></div>
  `;
  bindBreadcrumb();

  const { cards, error } = await loadJlptCards(levelId, wordTypeId);
  const status = document.getElementById('day-status');
  const grid = document.getElementById('day-grid');
  if (!status || !grid) return; // user sudah pindah layar sebelum fetch selesai

  if (error) {
    status.textContent = 'Gagal memuat data csv. Pastikan situs dibuka lewat server (bukan dobel-klik file), lalu coba lagi.';
    return;
  }

  const dayMap = new Map(); // day -> jumlah kartu
  cards.forEach((c) => {
    if (c.day == null) return;
    dayMap.set(c.day, (dayMap.get(c.day) || 0) + 1);
  });
  const days = [...dayMap.entries()].sort((a, b) => a[0] - b[0]);

  if (days.length === 0) {
    status.textContent = 'Belum ada kartu untuk jenis kata ini.';
    return;
  }
  status.remove();

  grid.innerHTML = days.map(([day, count]) => `
    <button class="day-chip" data-go="kotoba/jlpt/${levelId}/${wordTypeId}/${day}">
      <p class="day-title">Day ${day}</p>
      <p class="day-count">${count} kartu</p>
    </button>
  `).join('');

  grid.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.go));
  });
}

/* =========================================================
   11. RENDER: flashcard JLPT (kartu difilter berdasarkan day)
   ========================================================= */

async function renderJlptFlashcard(levelId, wordTypeId, day) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  const wordType = WORD_TYPES.find((w) => w.id === wordTypeId);
  const breadcrumbText = `${level ? level.label : ''} › ${wordType ? wordType.jp : ''} › Day ${day}`;
  const backPath = `kotoba/jlpt/${levelId}/${wordTypeId}`;

  renderFlashcardLoading(breadcrumbText, backPath);

  const { cards: allCards, error } = await loadJlptCards(levelId, wordTypeId);
  const cards = allCards.filter((c) => String(c.day) === String(day));

  renderFlashcardResult({ cards, error, breadcrumbText, backPath });
}

/* =========================================================
   12. RENDER: daftar topik SSW (dari csv, kolom "grup")
   ========================================================= */

async function renderSswTopicList(sectorId) {
  const sector = SSW_SECTORS.find((s) => s.id === sectorId);
  if (!sector) return renderKotobaHome('ssw');

  viewRoot.innerHTML = `
    ${breadcrumb('言葉 › SSW', 'kotoba/ssw')}
    <h2 class="screen-title">${sector.label}</h2>
    <p class="screen-subtitle">Pilih topik</p>
    <p class="hint-text" id="topic-status">Memuat data&hellip;</p>
    <div class="row-list" id="topic-list"></div>
  `;
  bindBreadcrumb();

  const { cards, error } = await loadSswCards(sectorId);
  const status = document.getElementById('topic-status');
  const list = document.getElementById('topic-list');
  if (!status || !list) return;

  if (error) {
    status.textContent = 'Gagal memuat data csv. Pastikan situs dibuka lewat server (bukan dobel-klik file), lalu coba lagi.';
    return;
  }

  const topicMap = new Map(); // grup -> jumlah kartu
  cards.forEach((c) => {
    if (!c.grup) return;
    topicMap.set(c.grup, (topicMap.get(c.grup) || 0) + 1);
  });
  const topics = [...topicMap.entries()];

  if (topics.length === 0) {
    status.textContent = 'Belum ada topik untuk sektor ini.';
    return;
  }
  status.textContent = 'Topik muncul otomatis sesuai grup yang ada di csv sektor ini';

  list.innerHTML = topics.map(([grup, count]) => rowItemHtml({
    title: slugToLabel(grup),
    subtitle: `${count} kartu`,
    icon: 'sector',
    goto: `kotoba/ssw/${sectorId}/${grup}`,
  })).join('');

  bindRowClicks(list);
}

/* =========================================================
   13. RENDER: flashcard SSW (kartu difilter berdasarkan grup)
   ========================================================= */

async function renderSswFlashcard(sectorId, topicSlug) {
  const sector = SSW_SECTORS.find((s) => s.id === sectorId);
  const breadcrumbText = `SSW › ${sector ? sector.label : sectorId} › ${slugToLabel(topicSlug)}`;
  const backPath = `kotoba/ssw/${sectorId}`;

  renderFlashcardLoading(breadcrumbText, backPath);

  const { cards: allCards, error } = await loadSswCards(sectorId);
  const cards = allCards.filter((c) => c.grup === topicSlug);

  renderFlashcardResult({ cards, error, breadcrumbText, backPath });
}

/* =========================================================
   14. TAMPILAN FLASHCARD (dipakai bersama JLPT & SSW)
   ========================================================= */

function renderFlashcardLoading(breadcrumbText, backPath) {
  viewRoot.innerHTML = `
    ${breadcrumb(breadcrumbText, backPath)}
    <p class="hint-text">Memuat kartu&hellip;</p>
  `;
  bindBreadcrumb();
}

function renderFlashcardResult({ cards, error, breadcrumbText, backPath, cardType = 'kotoba' }) {
  if (error) {
    viewRoot.innerHTML = `
      ${breadcrumb(breadcrumbText, backPath)}
      <div class="coming-soon">
        <p class="jp">エラー</p>
        <p>Gagal memuat data csv. Pastikan situs dibuka lewat server (bukan dobel-klik file), lalu coba lagi.</p>
      </div>
    `;
    bindBreadcrumb();
    return;
  }

  if (cards.length === 0) {
    viewRoot.innerHTML = `
      ${breadcrumb(breadcrumbText, backPath)}
      <div class="coming-soon">
        <p class="jp">カードなし</p>
        <p>Belum ada kartu di csv untuk bagian ini.</p>
      </div>
    `;
    bindBreadcrumb();
    return;
  }

  viewRoot.innerHTML = `
    ${breadcrumb(breadcrumbText, backPath)}
    <div class="flashcard-view">
      <div id="flashcard" class="flashcard">
        <div id="flashcard-inner" class="flashcard-inner">
          <div id="flashcard-front" class="flashcard-face flashcard-front-face"></div>
          <div id="flashcard-back" class="flashcard-face flashcard-back-face"></div>
        </div>
      </div>
      <p class="flip-hint">Tap kartu untuk membalik</p>
      <div class="flashcard-nav">
        <button id="fc-prev" class="nav-circle-btn" aria-label="Sebelumnya">${ICONS.navLeft}</button>
        <span id="fc-counter" class="nav-counter"></span>
        <button id="fc-next" class="nav-circle-btn" aria-label="Selanjutnya">${ICONS.navRight}</button>
      </div>
    </div>
  `;
  bindBreadcrumb();

  const cardEl = document.getElementById('flashcard');
  const innerEl = document.getElementById('flashcard-inner');
  const frontEl = document.getElementById('flashcard-front');
  const backEl = document.getElementById('flashcard-back');
  const counterEl = document.getElementById('fc-counter');

  let index = 0;
  let flipped = false;

  function backContentHtml(c) {
    if (cardType === 'kanji') {
      return `
        <div class="flashcard-back-kanji">
          <p class="kanji-arti">${c.arti}</p>
          <div class="yomi-row">
            <div class="yomi-block">
              <p class="yomi-label">オンヨミ</p>
              <p class="yomi-value">${c.onyomi}</p>
            </div>
            <div class="yomi-block yomi-kun">
              <p class="yomi-label">くんよみ</p>
              <p class="yomi-value">${c.kunyomi}</p>
            </div>
          </div>
          <div class="example-grid">
            ${c.examples.map((ex) => `
              <div class="example-cell">
                <p class="example-word">${ex.word}</p>
                <p class="example-reading">${ex.reading}</p>
                <p class="example-arti-small">${ex.arti}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    if (cardType === 'grammar') {
      return `
        <div class="flashcard-back-grammar">
          <p class="bunpou-tag">${c.bunpou}</p>
          <p class="grammar-arti">${c.arti}</p>
          ${c.forms.length > 0 ? `
            <p class="forms-label">Cara pembentukan</p>
            <div class="forms-grid">
              ${c.forms.map((f) => `
                <div class="form-cell">
                  ${f.label ? `<p class="form-type">${f.label}</p>` : ''}
                  <p class="form-rule">${f.rule}</p>
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${c.examples.map((ex) => `
            <p class="example-jp">${ex.jp}</p>
            <p class="example-id">${ex.id}</p>
          `).join('')}
        </div>
      `;
    }
    return `
      <div class="flashcard-back">
        <p class="reading">${c.reading}</p>
        <p class="arti">${c.arti}</p>
        ${c.examples.map((ex) => `
          <p class="example-jp">${ex.jp}</p>
          <p class="example-id">${ex.id}</p>
        `).join('')}
      </div>
    `;
  }

  // isi konten depan & belakang sekaligus (dua-duanya selalu ada di DOM,
  // yang diputar via CSS transform, bukan ganti innerHTML pas flip)
  function fillCardContent() {
    const c = cards[index];
    counterEl.textContent = `${index + 1}/${cards.length}`;
    frontEl.innerHTML = cardType === 'grammar'
      ? `<span class="front-bunpou">${c.bunpou}</span>`
      : `<span class="front-kanji">${c.kanji}</span>`;
    backEl.innerHTML = backContentHtml(c);
  }

  function setFlipped(state, { noAnim = false } = {}) {
    flipped = state;
    if (noAnim) innerEl.classList.add('no-anim');
    innerEl.classList.toggle('is-flipped', flipped);
    if (noAnim) {
      void innerEl.offsetWidth; // paksa reflow biar class no-anim kepakai dulu
      innerEl.classList.remove('no-anim');
    }
  }

  cardEl.addEventListener('click', () => {
    setFlipped(!flipped);
  });

  document.getElementById('fc-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    index = (index - 1 + cards.length) % cards.length; // wrap ke kartu terakhir
    setFlipped(false, { noAnim: true }); // pindah kartu langsung tampil depan, tanpa animasi flip
    fillCardContent();
  });

  document.getElementById('fc-next').addEventListener('click', (e) => {
    e.stopPropagation();
    index = (index + 1) % cards.length; // wrap balik ke kartu 1
    setFlipped(false, { noAnim: true });
    fillCardContent();
  });

  fillCardContent();
}

function renderKanjiLevelList() {
  viewRoot.innerHTML = `
    ${breadcrumb('春の公園', 'dashboard')}
    <h2 class="screen-title">漢字 <span class="jp-sub">Kanji</span></h2>
    <p class="screen-subtitle">Pilih level</p>
    <div class="row-list" id="kanji-level-list"></div>
  `;

  const list = document.getElementById('kanji-level-list');
  list.innerHTML = JLPT_LEVELS.map((lv) => rowItemHtml({
    title: lv.label,
    subtitle: lv.desc,
    goto: `kanji/${lv.id}`,
  })).join('');

  bindRowClicks(list);
  bindBreadcrumb();
}

async function renderKanjiDayList(levelId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  if (!level) return renderKanjiLevelList();

  viewRoot.innerHTML = `
    ${breadcrumb('漢字', 'kanji')}
    <h2 class="screen-title">${level.label}</h2>
    <p class="screen-subtitle">Pilih kelompok day</p>
    <p class="hint-text" id="day-status">Memuat data&hellip;</p>
    <div class="day-grid" id="day-grid"></div>
  `;
  bindBreadcrumb();

  const { cards, error } = await loadKanjiCards(levelId);
  const status = document.getElementById('day-status');
  const grid = document.getElementById('day-grid');
  if (!status || !grid) return;

  if (error) {
    status.textContent = 'Gagal memuat data csv. Pastikan situs dibuka lewat server (bukan dobel-klik file), lalu coba lagi.';
    return;
  }

  const dayMap = new Map();
  cards.forEach((c) => {
    if (c.day == null) return;
    dayMap.set(c.day, (dayMap.get(c.day) || 0) + 1);
  });
  const days = [...dayMap.entries()].sort((a, b) => a[0] - b[0]);

  if (days.length === 0) {
    status.textContent = 'Belum ada kanji untuk level ini.';
    return;
  }
  status.remove();

  grid.innerHTML = days.map(([day, count]) => `
    <button class="day-chip" data-go="kanji/${levelId}/${day}">
      <p class="day-title">Day ${day}</p>
      <p class="day-count">${count} kanji</p>
    </button>
  `).join('');

  grid.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.go));
  });
}

async function renderKanjiFlashcard(levelId, day) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  const breadcrumbText = `漢字 › ${level ? level.label : ''} › Day ${day}`;
  const backPath = `kanji/${levelId}`;

  renderFlashcardLoading(breadcrumbText, backPath);

  const { cards: allCards, error } = await loadKanjiCards(levelId);
  const cards = allCards.filter((c) => String(c.day) === String(day));

  renderFlashcardResult({ cards, error, breadcrumbText, backPath, cardType: 'kanji' });
}

function renderGrammarLevelList() {
  viewRoot.innerHTML = `
    ${breadcrumb('春の公園', 'dashboard')}
    <h2 class="screen-title">文法 <span class="jp-sub">Tata bahasa</span></h2>
    <p class="screen-subtitle">Pilih level</p>
    <div class="row-list" id="grammar-level-list"></div>
  `;

  const list = document.getElementById('grammar-level-list');
  list.innerHTML = JLPT_LEVELS.map((lv) => rowItemHtml({
    title: lv.label,
    subtitle: lv.desc,
    goto: `tatabahasa/${lv.id}`,
  })).join('');

  bindRowClicks(list);
  bindBreadcrumb();
}

async function renderGrammarDayList(levelId) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  if (!level) return renderGrammarLevelList();

  viewRoot.innerHTML = `
    ${breadcrumb('文法', 'tatabahasa')}
    <h2 class="screen-title">${level.label}</h2>
    <p class="screen-subtitle">Pilih kelompok day</p>
    <p class="hint-text" id="day-status">Memuat data&hellip;</p>
    <div class="day-grid" id="day-grid"></div>
  `;
  bindBreadcrumb();

  const { cards, error } = await loadGrammarCards(levelId);
  const status = document.getElementById('day-status');
  const grid = document.getElementById('day-grid');
  if (!status || !grid) return;

  if (error) {
    status.textContent = 'Gagal memuat data csv. Pastikan situs dibuka lewat server (bukan dobel-klik file), lalu coba lagi.';
    return;
  }

  const dayMap = new Map();
  cards.forEach((c) => {
    if (c.day == null) return;
    dayMap.set(c.day, (dayMap.get(c.day) || 0) + 1);
  });
  const days = [...dayMap.entries()].sort((a, b) => a[0] - b[0]);

  if (days.length === 0) {
    status.textContent = 'Belum ada bunpou untuk level ini.';
    return;
  }
  status.remove();

  grid.innerHTML = days.map(([day, count]) => `
    <button class="day-chip" data-go="tatabahasa/${levelId}/${day}">
      <p class="day-title">Day ${day}</p>
      <p class="day-count">${count} bunpou</p>
    </button>
  `).join('');

  grid.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.go));
  });
}

async function renderGrammarFlashcard(levelId, day) {
  const level = JLPT_LEVELS.find((l) => l.id === levelId);
  const breadcrumbText = `文法 › ${level ? level.label : ''} › Day ${day}`;
  const backPath = `tatabahasa/${levelId}`;

  renderFlashcardLoading(breadcrumbText, backPath);

  const { cards: allCards, error } = await loadGrammarCards(levelId);
  const cards = allCards.filter((c) => String(c.day) === String(day));

  renderFlashcardResult({ cards, error, breadcrumbText, backPath, cardType: 'grammar' });
}

function renderLatihanBidangList() {
  viewRoot.innerHTML = `
    ${breadcrumb('春の公園', 'dashboard')}
    <h2 class="screen-title">練習 <span class="jp-sub">Latihan &amp; kuis</span></h2>
    <p class="screen-subtitle">Pilih bidang</p>
    <div class="row-list" id="bidang-list"></div>
  `;

  const list = document.getElementById('bidang-list');
  list.innerHTML = LATIHAN_BIDANG.map((b) => rowItemHtml({
    title: b.label,
    subtitle: b.desc,
    icon: b.icon,
    goto: `latihan/${b.id}`,
  })).join('');

  bindRowClicks(list);
  bindBreadcrumb();
}

function renderLatihanLevelList(bidangId) {
  const bidang = LATIHAN_BIDANG.find((b) => b.id === bidangId);
  if (!bidang) return renderLatihanBidangList();

  viewRoot.innerHTML = `
    ${breadcrumb('練習', 'latihan')}
    <h2 class="screen-title">${bidang.label}</h2>
    <p class="screen-subtitle">${bidangId === 'ssw' ? 'Pilih sektor' : 'Pilih level'}</p>
    <div class="row-list" id="latihan-level-list"></div>
  `;

  const list = document.getElementById('latihan-level-list');
  const items = bidangId === 'ssw' ? SSW_SECTORS : JLPT_LEVELS;
  list.innerHTML = items.map((it) => rowItemHtml({
    title: it.label,
    subtitle: it.desc,
    goto: `latihan/${bidangId}/${it.id}`,
  })).join('');

  bindRowClicks(list);
  bindBreadcrumb();
}

/* =========================================================
   17. LAYAR INFO KUIS (sebelum mulai)
   ========================================================= */

async function renderKuisInfo(bidangId, levelId) {
  const bidang = LATIHAN_BIDANG.find((b) => b.id === bidangId);
  const level = JLPT_LEVELS.find((l) => l.id === levelId) || SSW_SECTORS.find((s) => s.id === levelId);
  if (!bidang || !level) return renderLatihanBidangList();

  const backPath = `latihan/${bidangId}`;

  viewRoot.innerHTML = `
    ${breadcrumb(`練習 › ${bidang.label}`, backPath)}
    <h2 class="screen-title">${level.label}</h2>
    <div class="kuis-info-card" id="kuis-info-card">
      <p class="hint-text">Memuat soal&hellip;</p>
    </div>
  `;
  bindBreadcrumb();

  const card = document.getElementById('kuis-info-card');
  if (bidangId === 'ssw') {
    card.innerHTML = `<p class="hint-text">Kuis untuk SSW belum dirancang, segera hadir.</p>`;
    return;
  }

  const { questions, error } = await loadQuizQuestions(bidangId, levelId);
  if (!document.getElementById('kuis-info-card')) return; // sudah pindah layar

  if (error) {
    card.innerHTML = `<p class="hint-text">Gagal memuat data csv. Pastikan situs dibuka lewat server (bukan dobel-klik file), lalu coba lagi.</p>`;
    return;
  }

  const validQuestions = questions.filter((q) => q.correctIndex !== null);
  if (validQuestions.length === 0) {
    card.innerHTML = `<p class="hint-text">Belum ada soal untuk level ini.</p>`;
    return;
  }

  const questionCount = Math.min(QUIZ_TARGET_COUNT, validQuestions.length);

  card.innerHTML = `
    <p class="kuis-title">Kuis ${level.label}</p>
    <p class="kuis-desc">Pilihan ganda A-D dari ${bidang.label}</p>
    <div class="kuis-stats-row">
      <div class="kuis-stat">
        <p class="kuis-stat-num">${questionCount}</p>
        <p class="kuis-stat-label">Soal</p>
      </div>
      <div class="kuis-stat">
        <p class="kuis-stat-num">${formatMmSs(QUIZ_DURATION_SECONDS)}</p>
        <p class="kuis-stat-label">Menit</p>
      </div>
    </div>
    <button class="kuis-start-btn" id="btn-start-kuis">Mulai Kuis</button>
  `;

  document.getElementById('btn-start-kuis').addEventListener('click', () => {
    startQuiz({ bidangId, levelId, bidangLabel: bidang.label, levelLabel: level.label, allQuestions: validQuestions });
  });
}

/* =========================================================
   18. SESI KUIS (mengerjakan) - tidak lewat hash router,
       supaya timer & progress tidak hilang kalau layar
       "ke-render ulang" karena alasan lain.
   ========================================================= */

let quizSession = null; // { ...ctx, questions, answers, current, remainingSeconds, timerId }

function startQuiz(ctx) {
  const questionCount = Math.min(QUIZ_TARGET_COUNT, ctx.allQuestions.length);
  const questions = shuffle(ctx.allQuestions).slice(0, questionCount);

  quizSession = {
    ...ctx,
    questions,
    answers: new Array(questions.length).fill(null),
    current: 0,
    remainingSeconds: QUIZ_DURATION_SECONDS,
    timerId: null,
  };

  renderQuizTaking();

  quizSession.timerId = setInterval(() => {
    quizSession.remainingSeconds -= 1;
    updateQuizTimerDisplay();
    if (quizSession.remainingSeconds <= 0) {
      finishQuiz(); // waktu habis -> auto submit
    }
  }, 1000);
}

function updateQuizTimerDisplay() {
  const el = document.getElementById('quiz-timer');
  if (el) el.textContent = formatMmSs(Math.max(0, quizSession.remainingSeconds));
}

function exitQuiz() {
  if (quizSession && quizSession.timerId) clearInterval(quizSession.timerId);
  const backPath = quizSession ? `latihan/${quizSession.bidangId}/${quizSession.levelId}` : 'latihan';
  quizSession = null;
  navigate(backPath);
}

function renderQuizTaking() {
  const { questions, bidangLabel, levelLabel } = quizSession;

  viewRoot.innerHTML = `
    <button class="breadcrumb" id="quiz-exit-btn">
      ${ICONS.back}
      <span>練習 › ${bidangLabel} › ${levelLabel}</span>
    </button>

    <div class="quiz-header">
      <span class="quiz-progress">Soal <span id="quiz-q-num"></span>/${questions.length}</span>
      <span class="quiz-timer-wrap">${ICONS.clock}<span id="quiz-timer"></span></span>
    </div>

    <div class="quiz-tracker" id="quiz-tracker"></div>

    <div class="quiz-question-card">
      <p id="quiz-question-text"></p>
    </div>

    <div class="quiz-options" id="quiz-options"></div>

    <div class="quiz-nav-row">
      <button id="quiz-btn-prev" class="nav-circle-btn" aria-label="Sebelumnya">${ICONS.navLeft}</button>
      <button id="quiz-btn-finish" class="kuis-finish-btn">Selesai</button>
      <button id="quiz-btn-next" class="nav-circle-btn" aria-label="Selanjutnya">${ICONS.navRight}</button>
    </div>
  `;

  document.getElementById('quiz-exit-btn').addEventListener('click', () => {
    if (window.confirm('Keluar dari kuis? Progres akan hilang.')) exitQuiz();
  });

  document.getElementById('quiz-btn-prev').addEventListener('click', () => {
    quizSession.current = (quizSession.current - 1 + questions.length) % questions.length;
    renderQuizQuestionAndTracker();
  });
  document.getElementById('quiz-btn-next').addEventListener('click', () => {
    quizSession.current = (quizSession.current + 1) % questions.length;
    renderQuizQuestionAndTracker();
  });
  document.getElementById('quiz-btn-finish').addEventListener('click', () => {
    const unanswered = quizSession.answers.filter((a) => a === null).length;
    const msg = unanswered > 0
      ? `Masih ada ${unanswered} soal belum dijawab. Yakin mau selesai sekarang?`
      : 'Yakin mau submit jawaban sekarang?';
    if (window.confirm(msg)) finishQuiz();
  });

  updateQuizTimerDisplay();
  renderQuizQuestionAndTracker();
}

function renderQuizQuestionAndTracker() {
  renderQuizTracker();
  renderQuizQuestion();
}

function renderQuizTracker() {
  const { questions, answers, current } = quizSession;
  const trackerEl = document.getElementById('quiz-tracker');
  trackerEl.innerHTML = questions.map((_, i) => `
    <button class="tracker-cell ${answers[i] !== null ? 'is-answered' : ''} ${i === current ? 'is-current' : ''}" data-idx="${i}">${i + 1}</button>
  `).join('');
  trackerEl.querySelectorAll('[data-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      quizSession.current = parseInt(btn.dataset.idx, 10);
      renderQuizQuestionAndTracker();
    });
  });
}

function renderQuizQuestion() {
  const { questions, answers, current } = quizSession;
  const q = questions[current];
  const letters = ['A', 'B', 'C', 'D'];

  document.getElementById('quiz-q-num').textContent = current + 1;
  document.getElementById('quiz-question-text').innerHTML = q.sentenceHtml;

  const optionsEl = document.getElementById('quiz-options');
  optionsEl.innerHTML = q.options.map((opt, i) => `
    <button class="quiz-option-btn ${answers[current] === i ? 'is-selected' : ''}" data-idx="${i}">
      <span class="quiz-option-letter">${letters[i]}</span><span>${opt}</span>
    </button>
  `).join('');

  optionsEl.querySelectorAll('[data-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      quizSession.answers[current] = parseInt(btn.dataset.idx, 10);
      renderQuizQuestionAndTracker();
    });
  });
}

function finishQuiz() {
  if (quizSession.timerId) clearInterval(quizSession.timerId);

  const { questions, answers } = quizSession;
  const correct = questions.reduce((sum, q, i) => sum + (answers[i] === q.correctIndex ? 1 : 0), 0);
  const total = questions.length;
  const timeUsedSeconds = QUIZ_DURATION_SECONDS - Math.max(0, quizSession.remainingSeconds);
  const ctxForRetry = { ...quizSession };

  renderQuizScore({ correct, total, timeUsedSeconds, ctxForRetry });
  quizSession = null;
}

function renderQuizScore({ correct, total, timeUsedSeconds, ctxForRetry }) {
  const wrong = total - correct;
  const percent = Math.round((correct / total) * 100);

  viewRoot.innerHTML = `
    <div class="quiz-score">
      ${ICONS.confetti}
      <p class="quiz-score-caption">Kuis selesai</p>
      <p class="quiz-score-num">${correct}<span class="quiz-score-total"> / ${total}</span></p>
      <p class="quiz-score-percent">${percent}% benar</p>

      <div class="kuis-stats-row">
        <div class="kuis-stat"><p class="kuis-stat-num quiz-correct">${correct} benar</p></div>
        <div class="kuis-stat"><p class="kuis-stat-num quiz-wrong">${wrong} salah</p></div>
        <div class="kuis-stat">
          <p class="kuis-stat-num">${formatMmSs(timeUsedSeconds)}</p>
          <p class="kuis-stat-label">waktu terpakai</p>
        </div>
      </div>

      <button class="kuis-start-btn" id="btn-retry-kuis">Ulangi Kuis</button>
      <button class="kuis-secondary-btn" id="btn-back-latihan">Kembali ke 練習</button>
    </div>
  `;

  document.getElementById('btn-retry-kuis').addEventListener('click', () => {
    startQuiz(ctxForRetry);
  });
  document.getElementById('btn-back-latihan').addEventListener('click', () => {
    navigate(`latihan/${ctxForRetry.bidangId}`);
  });
}

function renderComingSoon(jp, label) {
  viewRoot.innerHTML = `
    ${breadcrumb('春の公園', 'dashboard')}
    <div class="coming-soon">
      <p class="jp">${jp}</p>
      <p>${label} &mdash; belum dirancang, segera hadir.</p>
    </div>
  `;
  bindBreadcrumb();
}

/* =========================================================
   15. KOMPONEN KECIL YANG DIPAKAI BERULANG
   ========================================================= */

function breadcrumb(text, backPath) {
  return `
    <button class="breadcrumb" id="breadcrumb-back" data-go="${backPath}">
      ${ICONS.back}
      <span>${text}</span>
    </button>
  `;
}

function bindBreadcrumb() {
  const el = document.getElementById('breadcrumb-back');
  if (el) el.addEventListener('click', () => navigate(el.dataset.go));
}

function rowItemHtml({ title, subtitle, icon, goto }) {
  return `
    <button class="row-item" data-go="${goto}">
      <span class="row-item-left">
        ${icon ? ICONS[icon] : ''}
        <span>
          <p class="row-title">${title}</p>
          ${subtitle ? `<p class="row-subtitle">${subtitle}</p>` : ''}
        </span>
      </span>
      ${ICONS.chevron}
    </button>
  `;
}

function bindRowClicks(container) {
  container.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.go));
  });
}

/* =========================================================
   16. FOOTER NAV (home / setelan)
   ========================================================= */

function updateFooterActiveState(parts) {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach((btn) => btn.classList.remove('active'));
  const homeBtn = document.querySelector('.nav-btn[data-nav="home"]');
  if (parts.length === 0 && homeBtn) homeBtn.classList.add('active');
}

function setupFooterNav() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.nav === 'home') navigate('');
      // TODO: implementasikan halaman setelan
    });
  });
}
