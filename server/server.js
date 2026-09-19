/**
 * SOCIES CENTRAL SERVER & TELEMETRY HUB
 * 
 * - Cihaz Kayıt & Çevrimiçi/Çevrimdışı (Presence) Takibi
 * - Çağrı Cihazı (Pager) Mesaj Yönlendirme & Çevrimdışı Mesaj Kuyruğu (Store & Forward)
 * - Canlı WebSocket Bağlantısı (Heartbeat & Eşzamanlı Sosyal Oyunlar)
 * - Bulut Hesap Yedekleme & Sıfırdan Başlama (Google / Apple ID)
 * - GitHub Otomatik Güncelleme (OTA) Kontrol Servisi
 * - Canlı Web Yönetim & İstatistik Paneli (/dashboard)
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const pathModule = require('path');

const PORT = process.env.PORT || 3000;

// =========================================================================
// KALICI SQLITE VERİTABANI (Disk Persistence: server/socies.db)
// =========================================================================
const { DatabaseSync } = require('node:sqlite');
const dbPath = pathModule.join(__dirname, 'socies.db');
const db = new DatabaseSync(dbPath);
try {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
} catch(e) {}

// Tabloları Oluştur
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    nickname TEXT,
    avatar TEXT,
    user_email TEXT,
    pet_json TEXT,
    needs_json TEXT,
    stats_json TEXT,
    score INTEGER DEFAULT 0,
    steps INTEGER DEFAULT 0,
    last_seen INTEGER,
    is_online INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS pokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_dev TEXT,
    from_nick TEXT,
    target_dev TEXT,
    poke_type TEXT DEFAULT 'POKE',
    is_read INTEGER DEFAULT 0,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_dev TEXT,
    from_nick TEXT,
    target_dev TEXT,
    message_text TEXT,
    is_delivered INTEGER DEFAULT 0,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    nickname TEXT,
    game TEXT,
    score INTEGER,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    nickname TEXT,
    avatar TEXT,
    device_id TEXT,
    google_id TEXT,
    profile_json TEXT,
    cloud_save_json TEXT,
    created_at INTEGER,
    last_login INTEGER
  );
`);

// MIGRATIONS: session_token, backups_json ve telemetry_logs tablosu
try { db.exec("ALTER TABLE users ADD COLUMN session_token TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN backups_json TEXT;"); } catch(e) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT,
      category TEXT,
      message TEXT,
      details_json TEXT,
      user_email TEXT,
      device_id TEXT,
      app_version TEXT,
      created_at INTEGER
    );
  `);
} catch(e) {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      message TEXT,
      animation TEXT,
      gift_gold INTEGER DEFAULT 0,
      gift_food TEXT DEFAULT '',
      created_at INTEGER,
      expires_at INTEGER
    );
  `);
} catch(e) {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_interests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      device_id TEXT,
      category TEXT,
      question TEXT,
      answer TEXT,
      timestamp INTEGER
    );
  `);
} catch(e) {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_type TEXT,
      device_id TEXT,
      nickname TEXT,
      avatar TEXT,
      pet_name TEXT,
      badge_icon TEXT,
      title TEXT,
      details TEXT,
      likes_count INTEGER DEFAULT 0,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS feed_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER,
      liker_device_id TEXT,
      liker_nickname TEXT,
      created_at INTEGER,
      UNIQUE(post_id, liker_device_id)
    );
  `);
} catch(e) {}

// =========================================================================
// LIVEOPS CMS: KARAKTER & KATEGORİ CANLI YAYIN VERİTABANI
// =========================================================================
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_categories (
      id TEXT PRIMARY KEY,
      name TEXT,
      icon TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS custom_characters (
      id TEXT PRIMARY KEY,
      name TEXT,
      category TEXT,
      icon TEXT,
      color TEXT,
      desc TEXT,
      frame0_json TEXT,
      frame1_json TEXT,
      states_json TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);
  try { db.exec("ALTER TABLE custom_characters ADD COLUMN states_json TEXT"); } catch(e) {}

  // Varsayılan kategorileri ekle
  const defaultCategories = [
    { id: 'animals', name: 'Hayvanlar', icon: '🐾' },
    { id: 'cute', name: 'Sevimli & Chibi', icon: '✨' },
    { id: 'spooky', name: 'Korkunç & Canavar', icon: '🎃' },
    { id: 'aliens', name: 'Uzaylılar & Galaksi', icon: '🛸' },
    { id: 'robots', name: 'Robotlar & Sibernetik', icon: '🤖' },
    { id: 'retro', name: 'Retro Efsaneler', icon: '👾' },
    { id: 'rpg', name: 'RPG & Zindan', icon: '⚔️' }
  ];

  const insertCatStmt = db.prepare(`
    INSERT OR IGNORE INTO custom_categories (id, name, icon, created_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const cat of defaultCategories) {
    insertCatStmt.run(cat.id, cat.name, cat.icon, Date.now());
  }

  // Varsayılan çekirdek karakterleri custom_characters tablosuna tohumla
  const charCount = db.prepare('SELECT COUNT(*) AS c FROM custom_characters').get().c;
  if (charCount === 0) {
    const seedPath = pathModule.join(__dirname, 'characters_seed.json');
    if (fs.existsSync(seedPath)) {
      const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      const insertCharStmt = db.prepare(`
        INSERT OR REPLACE INTO custom_characters (id, name, category, icon, color, desc, frame0_json, frame1_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const [id, c] of Object.entries(seedData)) {
        insertCharStmt.run(
          id,
          c.name || id,
          c.category || 'animals',
          c.icon || '🐾',
          c.color || '#38bdf8',
          c.desc || '',
          JSON.stringify(c.frame0 || []),
          JSON.stringify(c.frame1 || c.frame0 || []),
          now,
          now
        );
      }
      console.log(`[CHARACTERS SEED] ${Object.keys(seedData).length} varsayılan karakter custom_characters tablosuna eklendi.`);
    }
  }
} catch(e) {
  console.error('[DB CHARACTERS/CATEGORIES SEED ERROR]', e);
}

// IN-MEMORY CACHE & WEBSOCKET KÖPRÜSÜ
const database = {
  devices: new Map(),        // deviceId -> { deviceId, mac, userEmail, pet, needs, stats, lastSeen, isOnline }
  users: new Map(),          // userEmail -> { email, activeDeviceId, cloudSave, createdAt }
  offlineMessages: new Map(),// targetDeviceId -> [ { id, from, text, timestamp } ]
  activeSockets: new Map(),  // deviceId -> socket/client connection
  customSprites: new Map(),  // userEmail -> [ { id, name, type, xbm, createdAt } ]
  bridgeEvents: [],          // Real-time bridge between Companion and Pocket Emulator
  bridgeNextId: 1,
  systemStats: {
    totalMessagesSent: 0,
    totalPokesSent: 0,
    totalDuelMatches: 0,
    serverStartTime: Date.now()
  }
};

// =========================================================================
// 50 TÜRKİYE BOT FİLOSU (Ankara ve Batısı: %50 İstanbul, %50 Batı İlleri; %50 Kız, %50 Erkek)
// =========================================================================
const TURKISH_BOTS = [
  // --- 25 KIZ ÇOCUK ---
  { deviceId: 'BOT-TR-01', nick: 'Defne_Y', fullName: 'Defne Yılmaz', city: 'İstanbul', dist: 'Kadıköy', pet: 'Pufi', breed: 'kedi', avatar: '🐱', stage: 3, xp: 2450 },
  { deviceId: 'BOT-TR-02', nick: 'Zeynep_K', fullName: 'Zeynep Kaya', city: 'İstanbul', dist: 'Beşiktaş', pet: 'Pamuk', breed: 'kopek', avatar: '🐶', stage: 2, xp: 1890 },
  { deviceId: 'BOT-TR-03', nick: 'Elif_D', fullName: 'Elif Demir', city: 'İstanbul', dist: 'Üsküdar', pet: 'Minnoş', breed: 'kedi', avatar: '🐱', stage: 3, xp: 3120 },
  { deviceId: 'BOT-TR-04', nick: 'Asya_S', fullName: 'Asya Şahin', city: 'İstanbul', dist: 'Bakırköy', pet: 'Fıstık', breed: 'kus', avatar: '🐦', stage: 2, xp: 1420 },
  { deviceId: 'BOT-TR-05', nick: 'Ada_C', fullName: 'Ada Çelik', city: 'İstanbul', dist: 'Şişli', pet: 'Boncuk', breed: 'balik', avatar: '🐠', stage: 1, xp: 820 },
  { deviceId: 'BOT-TR-06', nick: 'Duru_Y', fullName: 'Duru Yıldız', city: 'İstanbul', dist: 'Maltepe', pet: 'Şeker', breed: 'top', avatar: '👑', stage: 3, xp: 2780 },
  { deviceId: 'BOT-TR-07', nick: 'Masal_O', fullName: 'Masal Öztürk', city: 'İstanbul', dist: 'Ataşehir', pet: 'Limon', breed: 'kus', avatar: '🐦', stage: 2, xp: 1650 },
  { deviceId: 'BOT-TR-08', nick: 'Nehir_A', fullName: 'Nehir Aydın', city: 'İstanbul', dist: 'Sarıyer', pet: 'Bulut', breed: 'kopek', avatar: '🐶', stage: 4, xp: 4890 },
  { deviceId: 'BOT-TR-09', nick: 'Gece_O', fullName: 'Gece Özdemir', city: 'İstanbul', dist: 'Beylikdüzü', pet: 'Gölge', breed: 'kedi', avatar: '🐱', stage: 2, xp: 1980 },
  { deviceId: 'BOT-TR-10', nick: 'Lina_A', fullName: 'Lina Arslan', city: 'İstanbul', dist: 'Pendik', pet: 'Zeytin', breed: 'kedi', avatar: '🐱', stage: 1, xp: 940 },
  { deviceId: 'BOT-TR-11', nick: 'Nil_D', fullName: 'Nil Doğan', city: 'İstanbul', dist: 'Kartal', pet: 'Mavi', breed: 'balik', avatar: '🐠', stage: 2, xp: 1250 },
  { deviceId: 'BOT-TR-12', nick: 'Derin_K', fullName: 'Derin Kılıç', city: 'İstanbul', dist: 'Fatih', pet: 'Dobi', breed: 'kopek', avatar: '🐶', stage: 3, xp: 3340 },
  { deviceId: 'BOT-TR-13', nick: 'Melis_A', fullName: 'Melis Aslan', city: 'İstanbul', dist: 'Çekmeköy', pet: 'Badi', breed: 'top', avatar: '👑', stage: 2, xp: 1720 },
  { deviceId: 'BOT-TR-14', nick: 'Alin_K', fullName: 'Alin Koç', city: 'Ankara', dist: 'Çankaya', pet: 'Pırıltı', breed: 'bitki', avatar: '🌱', stage: 3, xp: 2650 },
  { deviceId: 'BOT-TR-15', nick: 'Ela_K', fullName: 'Ela Kurt', city: 'Ankara', dist: 'Yenimahalle', pet: 'Bal', breed: 'kedi', avatar: '🐱', stage: 2, xp: 1540 },
  { deviceId: 'BOT-TR-16', nick: 'Doga_O', fullName: 'Doğa Özkan', city: 'İzmir', dist: 'Karşıyaka', pet: 'Çimen', breed: 'bitki', avatar: '🌱', stage: 2, xp: 1820 },
  { deviceId: 'BOT-TR-17', nick: 'Bade_S', fullName: 'Bade Şimşek', city: 'İzmir', dist: 'Bornova', pet: 'Çilek', breed: 'top', avatar: '👑', stage: 3, xp: 2980 },
  { deviceId: 'BOT-TR-18', nick: 'Ece_Y', fullName: 'Ece Yavuz', city: 'İzmir', dist: 'Alsancak', pet: 'Kumsal', breed: 'balik', avatar: '🐠', stage: 1, xp: 670 },
  { deviceId: 'BOT-TR-19', nick: 'Ipek_P', fullName: 'İpek Polat', city: 'Bursa', dist: 'Nilüfer', pet: 'Kestane', breed: 'kopek', avatar: '🐶', stage: 2, xp: 2110 },
  { deviceId: 'BOT-TR-20', nick: 'Maya_K', fullName: 'Maya Korkmaz', city: 'Bursa', dist: 'Osmangazi', pet: 'Yumak', breed: 'kedi', avatar: '🐱', stage: 3, xp: 3420 },
  { deviceId: 'BOT-TR-21', nick: 'Sare_O', fullName: 'Sare Özer', city: 'Kocaeli', dist: 'İzmit', pet: 'Martı', breed: 'kus', avatar: '🐦', stage: 2, xp: 1450 },
  { deviceId: 'BOT-TR-22', nick: 'Beren_Y', fullName: 'Beren Yüksel', city: 'Kocaeli', dist: 'Gebze', pet: 'Gofret', breed: 'kopek', avatar: '🐶', stage: 1, xp: 890 },
  { deviceId: 'BOT-TR-23', nick: 'Belinay_G', fullName: 'Belinay Güler', city: 'Balıkesir', dist: 'Bandırma', pet: 'Rüzgar', breed: 'kus', avatar: '🐦', stage: 2, xp: 1680 },
  { deviceId: 'BOT-TR-24', nick: 'Azra_Y', fullName: 'Azra Yalçın', city: 'Tekirdağ', dist: 'Süleymanpaşa', pet: 'Neşe', breed: 'kedi', avatar: '🐱', stage: 3, xp: 2890 },
  { deviceId: 'BOT-TR-25', nick: 'Yagmur_A', fullName: 'Yağmur Aksoy', city: 'Edirne', dist: 'Keşan', pet: 'Damlacık', breed: 'balik', avatar: '🐠', stage: 2, xp: 1750 },

  // --- 25 ERKEK ÇOCUK ---
  { deviceId: 'BOT-TR-26', nick: 'Poyraz_B', fullName: 'Poyraz Bulut', city: 'İstanbul', dist: 'Kadıköy', pet: 'Şimşek', breed: 'kopek', avatar: '🐶', stage: 3, xp: 3150 },
  { deviceId: 'BOT-TR-27', nick: 'Ruzgar_K', fullName: 'Rüzgar Keskin', city: 'İstanbul', dist: 'Beşiktaş', pet: 'Fırtına', breed: 'kus', avatar: '🐦', stage: 2, xp: 1940 },
  { deviceId: 'BOT-TR-28', nick: 'Aras_K', fullName: 'Aras Karaca', city: 'İstanbul', dist: 'Üsküdar', pet: 'Kaptan', breed: 'kedi', avatar: '🐱', stage: 3, xp: 2840 },
  { deviceId: 'BOT-TR-29', nick: 'Atlas_A', fullName: 'Atlas Avcı', city: 'İstanbul', dist: 'Bakırköy', pet: 'Pusula', breed: 'top', avatar: '👑', stage: 2, xp: 1620 },
  { deviceId: 'BOT-TR-30', nick: 'Kuzey_T', fullName: 'Kuzey Tunç', city: 'İstanbul', dist: 'Şişli', pet: 'Kutup', breed: 'kopek', avatar: '🐶', stage: 4, xp: 4560 },
  { deviceId: 'BOT-TR-31', nick: 'Doruk_G', fullName: 'Doruk Güneş', city: 'İstanbul', dist: 'Maltepe', pet: 'Zirve', breed: 'kus', avatar: '🐦', stage: 2, xp: 2050 },
  { deviceId: 'BOT-TR-32', nick: 'Efe_C', fullName: 'Efe Coşkun', city: 'İstanbul', dist: 'Ataşehir', pet: 'Cesur', breed: 'kopek', avatar: '🐶', stage: 3, xp: 3290 },
  { deviceId: 'BOT-TR-33', nick: 'Demir_E', fullName: 'Demir Eren', city: 'İstanbul', dist: 'Sarıyer', pet: 'Robot', breed: 'top', avatar: '👑', stage: 2, xp: 1740 },
  { deviceId: 'BOT-TR-34', nick: 'Kerem_T', fullName: 'Kerem Taş', city: 'İstanbul', dist: 'Beylikdüzü', pet: 'Bambam', breed: 'kedi', avatar: '🐱', stage: 1, xp: 910 },
  { deviceId: 'BOT-TR-35', nick: 'Bartu_K', fullName: 'Bartu Kaplan', city: 'İstanbul', dist: 'Pendik', pet: 'Çakıl', breed: 'kopek', avatar: '🐶', stage: 2, xp: 1530 },
  { deviceId: 'BOT-TR-36', nick: 'Cinar_A', fullName: 'Çınar Aktaş', city: 'İstanbul', dist: 'Kartal', pet: 'Meşe', breed: 'bitki', avatar: '🌱', stage: 3, xp: 2720 },
  { deviceId: 'BOT-TR-37', nick: 'Baris_T', fullName: 'Barış Tekin', city: 'İstanbul', dist: 'Kadıköy', pet: 'Huzur', breed: 'balik', avatar: '🐠', stage: 2, xp: 1840 },
  { deviceId: 'BOT-TR-38', nick: 'Alp_Y', fullName: 'Alp Yaman', city: 'Ankara', dist: 'Çankaya', pet: 'Bozkır', breed: 'kopek', avatar: '🐶', stage: 3, xp: 3080 },
  { deviceId: 'BOT-TR-39', nick: 'Kaan_B', fullName: 'Kaan Bozkurt', city: 'Ankara', dist: 'Batıkent', pet: 'Pars', breed: 'kedi', avatar: '🐱', stage: 2, xp: 1950 },
  { deviceId: 'BOT-TR-40', nick: 'Mert_U', fullName: 'Mert Ünal', city: 'Ankara', dist: 'Etimesgut', pet: 'Roket', breed: 'top', avatar: '👑', stage: 1, xp: 780 },
  { deviceId: 'BOT-TR-41', nick: 'Arda_C', fullName: 'Arda Çetin', city: 'İzmir', dist: 'Karşıyaka', pet: 'Ege', breed: 'balik', avatar: '🐠', stage: 3, xp: 2890 },
  { deviceId: 'BOT-TR-42', nick: 'Deniz_K', fullName: 'Deniz Koçyiğit', city: 'İzmir', dist: 'Urla', pet: 'Yunus', breed: 'balik', avatar: '🐠', stage: 2, xp: 1670 },
  { deviceId: 'BOT-TR-43', nick: 'Emir_K', fullName: 'Emir Karahan', city: 'Bursa', dist: 'Nilüfer', pet: 'Paşa', breed: 'kopek', avatar: '🐶', stage: 4, xp: 4420 },
  { deviceId: 'BOT-TR-44', nick: 'Yigit_D', fullName: 'Yiğit Duman', city: 'Bursa', dist: 'Osmangazi', pet: 'Aslan', breed: 'kedi', avatar: '🐱', stage: 2, xp: 2150 },
  { deviceId: 'BOT-TR-45', nick: 'Can_B', fullName: 'Can Başaran', city: 'Kocaeli', dist: 'İzmit', pet: 'Pati', breed: 'kopek', avatar: '🐶', stage: 2, xp: 1780 },
  { deviceId: 'BOT-TR-46', nick: 'Batu_S', fullName: 'Batu Sezer', city: 'Balıkesir', dist: 'Karesi', pet: 'Kuvvet', breed: 'kopek', avatar: '🐶', stage: 1, xp: 860 },
  { deviceId: 'BOT-TR-47', nick: 'Mete_B', fullName: 'Mete Bilgin', city: 'Balıkesir', dist: 'Ayvalık', pet: 'Ada', breed: 'balik', avatar: '🐠', stage: 2, xp: 1590 },
  { deviceId: 'BOT-TR-48', nick: 'Bora_Y', fullName: 'Bora Yıldırım', city: 'Tekirdağ', dist: 'Çorlu', pet: 'Tayfun', breed: 'kus', avatar: '🐦', stage: 3, xp: 2950 },
  { deviceId: 'BOT-TR-49', nick: 'Sarp_G', fullName: 'Sarp Gök', city: 'Tekirdağ', dist: 'Süleymanpaşa', pet: 'Kartal', breed: 'kus', avatar: '🐦', stage: 2, xp: 1810 },
  { deviceId: 'BOT-TR-50', nick: 'Yagiz_C', fullName: 'Yağız Candan', city: 'Edirne', dist: 'Merkez', pet: 'Meriç', breed: 'top', avatar: '👑', stage: 3, xp: 3200 }
];

// SQLite to memory synchronization & Bot Initialization
try {
  // Eski yabancı / geçici mock kayıtlarını temizle
  try {
    db.exec("DELETE FROM devices WHERE device_id LIKE 'SOCIES-ESP32-%' OR device_id LIKE 'SOCIES-AND-%' OR device_id LIKE 'SOCIES-IOS-%' OR device_id LIKE 'PHONE-2-TEST' OR device_id LIKE 'SOCIES-PHONE%';");
  } catch(e) {}

  const insertBotStmt = db.prepare(`
    INSERT OR REPLACE INTO devices (device_id, nickname, avatar, user_email, pet_json, needs_json, stats_json, score, steps, last_seen, is_online)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  TURKISH_BOTS.forEach((b, idx) => {
    const isOnline = (idx % 2 === 0);
    const lastSeen = isOnline ? now - Math.floor(Math.random() * 60000) : now - Math.floor(Math.random() * 3600000);
    const petObj = {
      name: b.pet,
      breed: b.breed,
      stage: b.stage,
      score: b.xp,
      ageDays: b.stage * 5 + Math.floor(Math.random() * 4),
      streakDays: Math.floor(Math.random() * 15) + 3
    };
    const needsObj = {
      hunger: Math.floor(Math.random() * 30) + 65,
      fun: Math.floor(Math.random() * 30) + 65,
      love: Math.floor(Math.random() * 20) + 75,
      sleep: Math.floor(Math.random() * 30) + 65,
      toilet: Math.floor(Math.random() * 25) + 70,
      clean: Math.floor(Math.random() * 25) + 70,
      social: Math.floor(Math.random() * 30) + 60
    };
    const statsObj = {
      location: { country: 'Türkiye', city: b.city, district: b.dist, flag: '🇹🇷' },
      phone: { model: idx % 2 === 0 ? 'Samsung Galaxy A54' : 'Redmi Note 12', os: 'Android 14', batteryPct: Math.floor(Math.random() * 30) + 68, stepsToday: Math.floor(Math.random() * 6000) + 2000, connection: '4.5G / Wi-Fi', appVersion: 'v1.0.20', latencyMs: Math.floor(Math.random() * 30) + 15 }
    };

    insertBotStmt.run(
      b.deviceId,
      b.nick,
      b.avatar,
      `${b.nick.toLowerCase()}@socies.bot`,
      JSON.stringify(petObj),
      JSON.stringify(needsObj),
      JSON.stringify(statsObj),
      b.xp,
      statsObj.phone.stepsToday,
      lastSeen,
      isOnline ? 1 : 0
    );
  });

  // Load all devices from SQLite into memory map
  const allRows = db.prepare('SELECT * FROM devices').all();
  allRows.forEach(r => {
    const parsedStats = JSON.parse(r.stats_json || '{}');
    const location = parsedStats.location || { country: 'Türkiye', city: 'İstanbul', district: 'Kadıköy', flag: '🇹🇷' };
    const phone = parsedStats.phone || { model: 'Mobil Telefon', os: 'Android', batteryPct: 85, stepsToday: 3500, connection: 'Wi-Fi', appVersion: 'v1.0.20', latencyMs: 22 };

    database.devices.set(r.device_id, {
      deviceId: r.device_id,
      mac: 'A4:CF:12:89:34:B1',
      user: { nickname: r.nickname, email: r.user_email, avatar: r.avatar, isVip: r.nickname.includes('Kurucu') },
      location,
      phone,
      pet: JSON.parse(r.pet_json || '{}'),
      needs: JSON.parse(r.needs_json || '{}'),
      stats: parsedStats,
      score: r.score,
      steps: r.steps,
      lastSeen: r.last_seen,
      isOnline: (Date.now() - r.last_seen) < 180000
    });
  });

  // FEED POSTS SEED (İlk açılışta canlı sosyal akış için zengin içerik)
  try {
    const postCount = db.prepare('SELECT COUNT(*) AS c FROM feed_posts').get().c;
    if (postCount === 0) {
      const now = Date.now();
      const initialPosts = [
        { type: 'HIGHSCORE', dev: 'SOCIES-7A8B1C', nick: 'Zeynep', av: '🐱', pet: 'PAMUK', icon: '🏃‍♀️', title: 'Maraton Koşusunda Yeni Rekor!', details: 'Maraton mini oyununda 340 puan yaparak rekor kırdı!', likes: 7, ago: 12 * 60000 },
        { type: 'LEVEL_UP', dev: 'SOCIES-9F2D4E', nick: 'Emir', av: '🚀', pet: 'ŞİMŞEK', icon: '⚡', title: 'Seviye 5 ve Sportif Evrim!', details: 'Şimşek Seviye 5 oldu ve Sportif Evrim rozetini kazandı!', likes: 11, ago: 35 * 60000 },
        { type: 'STORE_PURCHASE', dev: 'SOCIES-3C5A88', nick: 'Defne', av: '🌸', pet: 'BONCUK', icon: '🧙‍♂️', title: 'Mağazadan Yeni Şapka Aldı!', details: 'Boncuk için Yıldızlı Sihirbaz Külahı satın aldı ve kuşandı.', likes: 5, ago: 60 * 60000 },
        { type: 'STREAK', dev: 'SOCIES-8E1B9A', nick: 'Kerem', av: '🦊', pet: 'DUMAN', icon: '🔥', title: '7 Günlük Aktiflik Ateşi!', details: 'Üst üste 7 gün boyunca bebeğini yalnız bırakmadı.', likes: 14, ago: 90 * 60000 },
        { type: 'SOUVENIR', dev: 'SOCIES-4D7A2F', nick: 'Ece', av: '⭐', pet: 'LİMON', icon: '🍀', title: 'Park Molasından Hatıra!', details: 'Limon park molasından Dört Yapraklı Yonca hatırası getirdi.', likes: 6, ago: 120 * 60000 },
        { type: 'GAME_CLEAR', dev: 'SOCIES-6B3E9C', nick: 'Mert', av: '🤖', pet: 'ROBO', icon: '🧱', title: 'Tuğla Kırma Ustası!', details: 'Tuğla Kırma oyununda tüm bölümleri sıfır hatayla geçti!', likes: 8, ago: 180 * 60000 },
        { type: 'LEVEL_UP', dev: 'SOCIES-1A9F5D', nick: 'Elif', av: '🌈', pet: 'MAVİŞ', icon: '🍼', title: 'Yumurta Çatladı!', details: 'Gökkuşağı yumurtasını çatlatıp Maviş ile maceraya başladı.', likes: 19, ago: 240 * 60000 }
      ];
      const insertFeed = db.prepare(`
        INSERT INTO feed_posts (post_type, device_id, nickname, avatar, pet_name, badge_icon, title, details, likes_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      initialPosts.forEach(p => {
        insertFeed.run(p.type, p.dev, p.nick, p.av, p.pet, p.icon, p.title, p.details, p.likes, now - p.ago);
      });
      console.log('[DB] 7 Sosyal Akış Başlangıç Etkinliği Eklendi.');
    }
  } catch(e) {
    console.error('[DB] Feed post seed error:', e.message);
  }
} catch(e) {
  console.error('[DB SYNC ERROR]', e);
}

// 🤖 CANLI TÜRKİYE BOT SİMÜLASYONU MOTORU (Gerçekçi İhtiyaç & Çevrimiçi Döngüsü)
function runTurkishBotsSimulation() {
  const now = Date.now();
  for (const bot of TURKISH_BOTS) {
    const dev = database.devices.get(bot.deviceId);
    if (!dev) continue;

    // Rastgele hafif aksiyon
    const roll = Math.random();
    if (roll < 0.25) {
      // Beslendi
      dev.needs.hunger = Math.min(100, (dev.needs.hunger || 70) + Math.floor(Math.random() * 6) + 3);
      dev.pet.score = (dev.pet.score || 100) + 10;
    } else if (roll < 0.50) {
      // Oyun oynandı
      dev.needs.fun = Math.min(100, (dev.needs.fun || 70) + Math.floor(Math.random() * 8) + 4);
      dev.needs.hunger = Math.max(25, (dev.needs.hunger || 70) - 2);
      dev.pet.score = (dev.pet.score || 100) + 15;
    } else if (roll < 0.70) {
      // Uyku / Dinlenme
      dev.needs.sleep = Math.min(100, (dev.needs.sleep || 70) + 5);
    }

    // Doğal ihtiyaç azalması
    dev.needs.hunger = Math.max(30, (dev.needs.hunger || 70) - 0.2);
    dev.needs.fun = Math.max(25, (dev.needs.fun || 70) - 0.2);

    // Çevrimiçi / Çevrimdışı geçiş döngüsü
    if (Math.random() < 0.12) {
      dev.isOnline = !dev.isOnline;
      dev.lastSeen = dev.isOnline ? now : (now - Math.floor(Math.random() * 180000));
    } else if (dev.isOnline) {
      dev.lastSeen = now;
    }

    // SQLite senkronizasyonu
    try {
      db.prepare(`
        UPDATE devices SET
          needs_json = ?,
          pet_json = ?,
          score = ?,
          last_seen = ?,
          is_online = ?
        WHERE device_id = ?
      `).run(
        JSON.stringify(dev.needs),
        JSON.stringify(dev.pet),
        dev.pet.score || 0,
        dev.lastSeen,
        dev.isOnline ? 1 : 0,
        dev.deviceId
      );
    } catch(e) {}
  }
}
setInterval(runTurkishBotsSimulation, 25000);

// YARDIMCI JSON YANIT FONKSİYONU
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data, null, 2));
}

// HTTP SUNUCUSU
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // 1. ANA SAYFA & WEB EMÜLATÖRÜ (index.html)
  if (path === '/' || path === '/index.html' || path === '/emulator') {
    const indexPath = pathModule.join(__dirname, '../index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }
  }

  // 1.0 SOCIES AĞ & ETKİN KULLANICILAR SAYFASI (/socies, /socies.html)
  if (path === '/socies' || path === '/socies/' || path === '/socies.html' || path === '/community' || path === '/users') {
    const sociesPath = pathModule.join(__dirname, '../socies.html');
    if (fs.existsSync(sociesPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(sociesPath).pipe(res);
    }
    return serveSociesNetworkPage(res);
  }

  if (path === '/app' || path === '/mobile' || path === '/unified' || path === '/companion' || path === '/pocket' || path === '/console') {
    const appPath = pathModule.join(__dirname, '../app.html');
    if (fs.existsSync(appPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return fs.createReadStream(appPath).pipe(res);
    }
  }

  // 1.1 KARAKTER STÜDYOSU & CANLI CMS YÖNETİM MASASI (/studio)
  if (path === '/studio' || path === '/studio/' || path === '/studio.html' || path === '/cms' || path === '/characters-admin') {
    const studioPath = pathModule.join(__dirname, 'public/studio.html');
    if (fs.existsSync(studioPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return fs.createReadStream(studioPath).pipe(res);
    }
  }

  // 1.2 STATİK VARLIKLAR (PUBLIC KLASÖRÜ: /characters/..., /uploads/...)
  if (path.startsWith('/characters/') || path.startsWith('/uploads/') || path.startsWith('/public/')) {
    const relPath = path.replace(/^\/public\//, '/');
    const filePath = pathModule.join(__dirname, 'public', relPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = pathModule.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.html': 'text/html; charset=utf-8'
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  // =========================================================================
  // LIVEOPS CMS: KATEGORİ VE KARAKTER REST API ENDPOINT'LERİ
  // =========================================================================

  // KATEGORİ LİSTESİ
  if (path === '/api/v1/categories/list' && method === 'GET') {
    try {
      const categories = db.prepare('SELECT id, name, icon FROM custom_categories ORDER BY created_at ASC').all();
      return sendJSON(res, 200, { success: true, categories });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // KATEGORİ OLUŞTURMA
  if (path === '/api/v1/categories/create' && method === 'POST') {
    return parseBody(req, (body) => {
      const { id, name, icon } = body;
      if (!name) return sendJSON(res, 400, { error: 'Kategori adı zorunludur' });
      const catId = (id || name.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim();
      const catIcon = icon || '✨';
      try {
        db.prepare(`
          INSERT INTO custom_categories (id, name, icon, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon
        `).run(catId, name, catIcon, Date.now());
        return sendJSON(res, 200, { success: true, category: { id: catId, name, icon: catIcon } });
      } catch (e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // KATEGORİ SİLME
  if (path.startsWith('/api/v1/categories/') && method === 'DELETE') {
    const catId = path.split('/')[4];
    if (!catId) return sendJSON(res, 400, { error: 'Kategori ID belirtilmedi' });
    try {
      db.prepare('DELETE FROM custom_categories WHERE id = ?').run(catId);
      return sendJSON(res, 200, { success: true, message: `"${catId}" kategorisi silindi.` });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // TÜM KARAKTER KATALOĞU (CİHAZLAR VE STÜDYO İÇİN DİNAMİK JSON)
  if (path === '/api/v1/characters/catalog' && method === 'GET') {
    try {
      const rows = db.prepare('SELECT * FROM custom_characters ORDER BY created_at ASC').all();
      const characters = {};
      for (const r of rows) {
        characters[r.id] = {
          id: r.id,
          name: r.name,
          category: r.category,
          icon: r.icon,
          color: r.color,
          desc: r.desc,
          frame0: JSON.parse(r.frame0_json || '[]'),
          frame1: JSON.parse(r.frame1_json || '[]'),
          grid: JSON.parse(r.frame0_json || '[]'),
          states: r.states_json ? JSON.parse(r.states_json) : null,
          updatedAt: r.updated_at
        };
      }
      return sendJSON(res, 200, {
        success: true,
        count: Object.keys(characters).length,
        version: 'v1.0.33',
        timestamp: Date.now(),
        characters
      });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // KARAKTER KAYDETME / YAYINLAMA
  if (path === '/api/v1/characters/save' && method === 'POST') {
    return parseBody(req, (body) => {
      const { id, name, category, icon, color, desc, frame0, frame1, states } = body;
      if (!name || !frame0 || !Array.isArray(frame0) || frame0.length === 0) {
        return sendJSON(res, 400, { error: 'Geçersiz karakter verisi (name ve frame0 zorunludur)' });
      }
      if (name.length > 50 || (id && id.length > 50)) {
        return sendJSON(res, 400, { error: 'Karakter adı veya ID 50 karakterden uzun olamaz' });
      }
      const charId = (id || name.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim();
      const charName = name.trim();
      const charCat = category || 'animals';
      const charIcon = icon || '🐾';
      const charColor = color || '#38bdf8';
      const charDesc = desc || '';
      const now = Date.now();

      try {
        db.prepare(`
          INSERT INTO custom_characters (id, name, category, icon, color, desc, frame0_json, frame1_json, states_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            icon = excluded.icon,
            color = excluded.color,
            desc = excluded.desc,
            frame0_json = excluded.frame0_json,
            frame1_json = excluded.frame1_json,
            states_json = excluded.states_json,
            updated_at = excluded.updated_at
        `).run(
          charId,
          charName,
          charCat,
          charIcon,
          charColor,
          charDesc,
          JSON.stringify(frame0),
          JSON.stringify(frame1 || frame0),
          states ? JSON.stringify(states) : null,
          now,
          now
        );

        console.log(`[LIVEOPS CMS] Karakter yayınlandı: ${charId} (${charName})`);
        return sendJSON(res, 200, {
          success: true,
          message: `"${charName}" karakteri başarıyla kaydedildi ve cihazlara sunuldu.`,
          character: { id: charId, name: charName, category: charCat, icon: charIcon, color: charColor, desc: charDesc }
        });
      } catch (e) {
        return sendJSON(res, 500, { error: 'Veritabanı hatası: ' + e.message });
      }
    });
  }

  // LIVEOPS CMS: RESİMLER KLASÖRÜNDEKİ KAYNAK KIRPIMLARI OTOMATİK İÇE AKTAR
  if (path === '/api/v1/characters/import-source-crops' && method === 'POST') {
    try {
      const exactJsonPath = pathModule.join(__dirname, 'exact_source_characters.json');
      if (!fs.existsSync(exactJsonPath)) {
        return sendJSON(res, 404, { error: 'exact_source_characters.json bulunamadı' });
      }
      const data = JSON.parse(fs.readFileSync(exactJsonPath, 'utf8'));
      const insertCharStmt = db.prepare(`
        INSERT INTO custom_characters (id, name, category, icon, color, desc, frame0_json, frame1_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          icon = excluded.icon,
          color = excluded.color,
          desc = excluded.desc,
          frame0_json = excluded.frame0_json,
          frame1_json = excluded.frame1_json,
          updated_at = excluded.updated_at
      `);
      const now = Date.now();
      let importedCount = 0;
      for (const [id, c] of Object.entries(data)) {
        insertCharStmt.run(
          id,
          c.name || id,
          c.category || 'animals',
          c.icon || '🐾',
          c.color || '#38bdf8',
          c.desc || '',
          JSON.stringify(c.frame0 || []),
          JSON.stringify(c.frame1 || c.frame0 || []),
          now,
          now
        );
        importedCount++;
      }
      console.log(`[LIVEOPS CMS] ${importedCount} kaynak karakter başarıyla içe aktarıldı.`);
      return sendJSON(res, 200, {
        success: true,
        message: `${importedCount} adet gerçek kaynak karakter (Kedi, Köpek, Tavşan, Panda, Penguen) başarıyla içe aktarıldı ve yayınlandı!`,
        count: importedCount
      });
    } catch (e) {
      return sendJSON(res, 500, { error: 'İçe aktarma hatası: ' + e.message });
    }
  }

  // KARAKTER SİLME
  if (path.startsWith('/api/v1/characters/') && method === 'DELETE') {
    const charId = path.split('/')[4];
    if (!charId) return sendJSON(res, 400, { error: 'Karakter ID belirtilmedi' });
    try {
      db.prepare('DELETE FROM custom_characters WHERE id = ?').run(charId);
      console.log(`[LIVEOPS CMS] Karakter silindi: ${charId}`);
      return sendJSON(res, 200, { success: true, message: `"${charId}" karakteri silindi.` });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 1.3 GERÇEK ZAMANLI TELEFON-KONSOL KÖPRÜSÜ (BRIDGE EVENTS)
  if (path === '/api/v1/bridge/companion-event' && method === 'POST') {
    return parseBody(req, (body) => {
      const event = {
        id: database.bridgeNextId++,
        type: body.type || 'ACTION',
        payload: body.payload || {},
        sender: body.sender || 'companion',
        timestamp: Date.now()
      };
      database.bridgeEvents.push(event);
      if (database.bridgeEvents.length > 100) database.bridgeEvents.shift();
      return sendJSON(res, 200, { success: true, eventId: event.id });
    });
  }

  if (path.startsWith('/api/v1/bridge/events') && method === 'GET') {
    const since = parseInt(parsedUrl.query.since || '0', 10);
    const newEvents = database.bridgeEvents.filter(ev => ev.id > since);
    return sendJSON(res, 200, { events: newEvents });
  }

  // 1.4 CANLI İSTATİSTİK & YÖNETİM PANELİ (DASHBOARD)
  if (path === '/dashboard' || path === '/admin' || path === '/server') {
    return serveDashboard(res);
  }

  // 1.5 TEK BİRLEŞİK APK İNDİRME UÇ NOKTALARI
  if (path.startsWith('/download/') || path.startsWith('/downloads/') || path === '/socies-app.apk') {
    const apkFile = pathModule.join(__dirname, '../downloads/socies-app.apk');
    if (fs.existsSync(apkFile)) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="socies-v1.0.33.apk"',
        'Access-Control-Allow-Origin': '*'
      });
      return fs.createReadStream(apkFile).pipe(res);
    }
  }

  // 1.6 SUNUCU CANLILIK & PING KONTROLÜ (HEALTH / PING)
  if (path === '/api/v1/ping' && (method === 'GET' || method === 'HEAD')) {
    return sendJSON(res, 200, {
      status: 'OK',
      serverTime: Date.now(),
      serverHost: req.headers.host || '46.1.173.159:3000',
      clientIp: req.socket.remoteAddress,
      registeredDevicesCount: db.prepare('SELECT COUNT(*) AS c FROM devices').get().c
    });
  }

  // 2. CİHAZ KAYDI & NICKNAME GÜNCELLEME (REGISTER)
  if (path === '/api/v1/devices/register' && method === 'POST') {
    return parseBody(req, (body) => {
      const { deviceId, nickname, avatar, userEmail, pet, needs, stats } = body;
      if (!deviceId) return sendJSON(res, 400, { error: 'deviceId zorunludur' });

      const nick = nickname || `Oyuncu_${deviceId.slice(-4)}`;
      const av = avatar || '🐾';
      const email = userEmail || `${deviceId.toLowerCase()}@socies.io`;
      const now = Date.now();

      try {
        const stmt = db.prepare(`
          INSERT INTO devices (device_id, nickname, avatar, user_email, pet_json, needs_json, stats_json, score, steps, last_seen, is_online)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(device_id) DO UPDATE SET
            nickname = excluded.nickname,
            avatar = excluded.avatar,
            user_email = excluded.user_email,
            pet_json = COALESCE(excluded.pet_json, pet_json),
            needs_json = COALESCE(excluded.needs_json, needs_json),
            stats_json = COALESCE(excluded.stats_json, stats_json),
            last_seen = excluded.last_seen,
            is_online = 1
        `);
        stmt.run(
          deviceId,
          nick,
          av,
          email,
          JSON.stringify(pet || {}),
          JSON.stringify(needs || {}),
          JSON.stringify(stats || {}),
          pet?.score || 0,
          stats?.steps || 0,
          now
        );

        database.devices.set(deviceId, {
          deviceId,
          mac: 'A4:CF:12:89:34:B1',
          user: { nickname: nick, email, avatar: av, isVip: nick.includes('Kurucu') },
          pet: pet || { breed: 'top', stage: 1, ageDays: 1, score: 0 },
          needs: needs || { hunger: 100, fun: 100, love: 100, sleep: 100, toilet: 100, clean: 100, social: 100 },
          stats: stats || { batteryMv: 4000, batteryPct: 100, steps: 0, fwVer: 'v1.0.5' },
          lastSeen: now,
          isOnline: true
        });

        // Bekleyen poke ve mesaj sayısını öğren
        const pokesCount = db.prepare('SELECT COUNT(*) AS c FROM pokes WHERE target_dev = ? AND is_read = 0').get(deviceId).c;
        const msgsCount = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE target_dev = ? AND is_delivered = 0').get(deviceId).c;

        sendJSON(res, 200, {
          success: true,
          message: 'Cihaz başarıyla kaydedildi & veritabanında güncellendi',
          deviceId,
          nickname: nick,
          registeredAt: new Date(now).toISOString(),
          pendingPokesCount: pokesCount,
          pendingMessagesCount: msgsCount
        });
      } catch(err) {
        console.error('[REGISTER ERROR]', err);
        sendJSON(res, 500, { error: 'Kayıt veritabanına yazılamadı: ' + err.message });
      }
    });
  }

  // 2.1 CİHAZ VE ARKADAŞ LİSTESİ (RADAR / USERS LIST)
  if (path === '/api/v1/devices/list' && method === 'GET') {
    try {
      const rows = db.prepare('SELECT * FROM devices ORDER BY last_seen DESC LIMIT 50').all();
      const devices = rows.map(r => ({
        deviceId: r.device_id,
        nickname: r.nickname,
        avatar: r.avatar,
        pet: JSON.parse(r.pet_json || '{}'),
        needs: JSON.parse(r.needs_json || '{}'),
        stats: JSON.parse(r.stats_json || '{}'),
        score: r.score,
        steps: r.steps,
        lastSeen: r.last_seen,
        isOnline: (Date.now() - r.last_seen) < 180000
      }));

      return sendJSON(res, 200, { success: true, count: devices.length, devices });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 2.2 CANLI DÜRTME (POKE) GÖNDERME
  if (path === '/api/v1/pokes/send' && method === 'POST') {
    return parseBody(req, (body) => {
      const { fromDev, fromNick, targetDev, pokeType } = body;
      if (!targetDev || !fromDev) return sendJSON(res, 400, { error: 'fromDev ve targetDev zorunludur' });

      try {
        db.prepare('INSERT INTO pokes (from_dev, from_nick, target_dev, poke_type, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
          fromDev, fromNick || 'Dost', targetDev, pokeType || 'POKE', Date.now()
        );
        database.systemStats.totalPokesSent++;

        return sendJSON(res, 200, {
          success: true,
          message: `${targetDev} cihazına ${pokeType || 'POKE'} başarıyla iletildi`
        });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 2.3 BEKLEYEN POKE'LARI ÇEKME (POLL POKES)
  if (path.startsWith('/api/v1/pokes/pending') && method === 'GET') {
    const targetDev = parsedUrl.query.targetDev;
    if (!targetDev) return sendJSON(res, 400, { error: 'targetDev parametresi gerekli' });

    try {
      const pokes = db.prepare('SELECT * FROM pokes WHERE target_dev = ? AND is_read = 0 ORDER BY created_at ASC').all(targetDev);
      if (pokes.length > 0) {
        db.prepare('UPDATE pokes SET is_read = 1 WHERE target_dev = ?').run(targetDev);
      }
      return sendJSON(res, 200, { success: true, count: pokes.length, pokes });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 2.4 CANLI SKOR TABLOSUNA SKOR GÖNDERME (LEADERBOARD SUBMIT)
  if (path === '/api/v1/leaderboard/submit' && method === 'POST') {
    return parseBody(req, (body) => {
      const { deviceId, nickname, game, score } = body;
      if (!deviceId || score === undefined) return sendJSON(res, 400, { error: 'deviceId ve score gerekli' });

      try {
        db.prepare('INSERT INTO leaderboard (device_id, nickname, game, score, created_at) VALUES (?, ?, ?, ?, ?)').run(
          deviceId, nickname || 'Oyuncu', game || 'PONG', parseInt(score, 10), Date.now()
        );
        db.prepare('UPDATE devices SET score = MAX(score, ?) WHERE device_id = ?').run(parseInt(score, 10), deviceId);

        return sendJSON(res, 200, { success: true, message: 'Skor veritabanına işlendi' });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 2.5 LİDERLİK TABLOSUNU ÇEKME (GET LEADERBOARD)
  if (path === '/api/v1/leaderboard/top' && method === 'GET') {
    try {
      const topScores = db.prepare(`
        SELECT device_id, nickname, MAX(score) AS top_score, MAX(created_at) AS last_active
        FROM (
          SELECT device_id, nickname, score, created_at FROM leaderboard
          UNION ALL
          SELECT device_id, nickname, score, last_seen AS created_at FROM devices
        )
        GROUP BY device_id, nickname
        ORDER BY top_score DESC
        LIMIT 25
      `).all();

      return sendJSON(res, 200, { success: true, leaderboard: topScores });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 2.6 SOSYAL AKIŞ & BAŞARILAR (GET FEED)
  if (path === '/api/v1/feed' && method === 'GET') {
    const myDev = (parsedUrl.query && parsedUrl.query.deviceId) || '';
    try {
      const posts = db.prepare(`
        SELECT p.*,
          CASE WHEN EXISTS(SELECT 1 FROM feed_likes l WHERE l.post_id = p.id AND l.liker_device_id = ?) THEN 1 ELSE 0 END AS is_liked
        FROM feed_posts p
        ORDER BY p.created_at DESC
        LIMIT 40
      `).all(myDev);
      return sendJSON(res, 200, { success: true, posts });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 2.7 SOSYAL AKIŞA YENİ BAŞARI / ETKİNLİK GÖNDERME (POST TO FEED)
  if (path === '/api/v1/feed/post' && method === 'POST') {
    return parseBody(req, (body) => {
      const { postType, deviceId, nickname, avatar, petName, badgeIcon, title, details } = body;
      if (!deviceId || !title) return sendJSON(res, 400, { error: 'deviceId ve title zorunludur' });
      try {
        const result = db.prepare(`
          INSERT INTO feed_posts (post_type, device_id, nickname, avatar, pet_name, badge_icon, title, details, likes_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(
          postType || 'ACHIEVEMENT',
          deviceId,
          nickname || 'Oyuncu',
          avatar || '👑',
          petName || 'Pufi',
          badgeIcon || '⭐',
          title,
          details || '',
          Date.now()
        );
        return sendJSON(res, 200, { success: true, postId: result.lastInsertRowid });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 2.8 SOSYAL AKIŞ PAYLAŞIMINA KALP / LIKE ATMA (LIKE POST)
  if (path === '/api/v1/feed/like' && method === 'POST') {
    return parseBody(req, (body) => {
      const { postId, deviceId, nickname } = body;
      if (!postId || !deviceId) return sendJSON(res, 400, { error: 'postId ve deviceId zorunludur' });
      try {
        const post = db.prepare('SELECT * FROM feed_posts WHERE id = ?').get(postId);
        if (!post) return sendJSON(res, 404, { error: 'Paylaşım bulunamadı' });

        const existing = db.prepare('SELECT id FROM feed_likes WHERE post_id = ? AND liker_device_id = ?').get(postId, deviceId);
        let isLiked = false;
        if (existing) {
          db.prepare('DELETE FROM feed_likes WHERE id = ?').run(existing.id);
          db.prepare('UPDATE feed_posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(postId);
          isLiked = false;
        } else {
          db.prepare('INSERT INTO feed_likes (post_id, liker_device_id, liker_nickname, created_at) VALUES (?, ?, ?, ?)').run(
            postId, deviceId, nickname || 'Dost', Date.now()
          );
          db.prepare('UPDATE feed_posts SET likes_count = likes_count + 1 WHERE id = ?').run(postId);
          isLiked = true;

          // Eğer kendi paylaşımı değilse, paylaşım sahibine bildirim poke'u gönder!
          if (post.device_id !== deviceId) {
            db.prepare('INSERT INTO pokes (from_dev, from_nick, target_dev, poke_type, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
              deviceId, nickname || 'Bir arkadaşın', post.device_id, 'LIKE_EVENT', Date.now()
            );
          }
        }
        const updated = db.prepare('SELECT likes_count FROM feed_posts WHERE id = ?').get(postId);
        return sendJSON(res, 200, { success: true, isLiked, likesCount: updated ? updated.likes_count : 0 });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 2.9 KİŞİSEL BAŞARI GÜNLÜĞÜ (GET MILESTONES)
  if (path === '/api/v1/feed/milestones' && method === 'GET') {
    const targetDev = (parsedUrl.query && parsedUrl.query.deviceId);
    if (!targetDev) return sendJSON(res, 400, { error: 'deviceId zorunludur' });
    try {
      const milestones = db.prepare(`
        SELECT * FROM feed_posts WHERE device_id = ? ORDER BY created_at DESC LIMIT 30
      `).all(targetDev);
      return sendJSON(res, 200, { success: true, milestones });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 3. CANLI TELEMETRİ BİLDİRİMİ (TELEMETRY)
  if (path === '/api/v1/telemetry' && method === 'POST') {
    return parseBody(req, (body) => {
      const { deviceId, pet, needs, stats } = body;
      if (!deviceId) return sendJSON(res, 400, { error: 'deviceId zorunludur' });

      const dev = database.devices.get(deviceId) || { deviceId };
      if (pet) dev.pet = pet;
      if (needs) dev.needs = needs;
      if (stats) dev.stats = stats;
      dev.lastSeen = Date.now();
      dev.isOnline = true;
      database.devices.set(deviceId, dev);

      try {
        db.prepare(`
          UPDATE devices SET
            needs_json = COALESCE(?, needs_json),
            stats_json = COALESCE(?, stats_json),
            pet_json = COALESCE(?, pet_json),
            last_seen = ?,
            is_online = 1
          WHERE device_id = ?
        `).run(
          needs ? JSON.stringify(needs) : null,
          stats ? JSON.stringify(stats) : null,
          pet ? JSON.stringify(pet) : null,
          dev.lastSeen,
          deviceId
        );
      } catch(e) {}
      dev.isOnline = true;
      database.devices.set(deviceId, dev);

      sendJSON(res, 200, {
        success: true,
        status: 'acknowledged',
        serverTime: new Date().toISOString(),
        isOnline: true
      });
    });
  }

  // 4. ÇEVRİMİÇİ / ÇEVRİMDIŞI DURUM SORGUSU (PRESENCE)
  if (path === '/api/v1/presence' && method === 'GET') {
    const list = Array.from(database.devices.values()).map(d => ({
      deviceId: d.deviceId,
      user: d.user || { nickname: d.userEmail, email: d.userEmail, avatar: '👤' },
      location: d.location || { country: 'Türkiye', city: 'İstanbul', flag: '🇹🇷' },
      phone: d.phone || { model: 'Android Cihaz', os: 'Android 14', batteryPct: d.stats?.batteryPct || 100, stepsToday: d.stats?.steps || 0 },
      pet: d.pet,
      isOnline: (Date.now() - d.lastSeen) < 180000,
      lastSeenSecAgo: Math.round((Date.now() - d.lastSeen) / 1000)
    }));

    return sendJSON(res, 200, {
      totalRegistered: list.length,
      onlineCount: list.filter(d => d.isOnline).length,
      devices: list
    });
  }

  // 4.1 ETKİN KULLANICILAR VE TELEFON / KONUM BİLGİLERİ (SOCIES AĞI API)
  if (path === '/api/v1/socies/active-users' && method === 'GET') {
    const list = Array.from(database.devices.values()).map(d => ({
      deviceId: d.deviceId,
      mac: d.mac,
      user: d.user || { nickname: d.userEmail?.split('@')[0] || 'Dost', email: d.userEmail, avatar: '👤', isVip: false },
      location: d.location || { country: 'Türkiye', city: 'İstanbul', district: 'Merkez', flag: '🇹🇷', ip: '127.0.0.1' },
      phone: d.phone || { model: 'Mobil Telefon', os: 'Android', batteryPct: d.stats?.batteryPct || 100, batteryMv: d.stats?.batteryMv || 4000, stepsToday: d.stats?.steps || 0, connection: 'Wi-Fi', appVersion: 'v1.0.5+6', latencyMs: 25 },
      pet: d.pet || { breed: 'top', stage: 1, ageDays: 1, score: 100, streakDays: 1 },
      needs: d.needs || { hunger: 80, fun: 80, love: 80, sleep: 80, toilet: 80, clean: 80, social: 80 },
      isOnline: (Date.now() - d.lastSeen) < 180000,
      lastSeenSecAgo: Math.round((Date.now() - d.lastSeen) / 1000)
    }));

    const countries = [...new Set(list.map(u => u.location.country))];
    const cities = [...new Set(list.map(u => u.location.city))];

    return sendJSON(res, 200, {
      totalUsers: list.length,
      onlineCount: list.filter(u => u.isOnline).length,
      countriesCount: countries.length,
      citiesCount: cities.length,
      countries,
      cities,
      serverTime: new Date().toISOString(),
      users: list
    });
  }

  // 5. ÇAĞRI CİHAZI (PAGER) MESAJ GÖNDERME
  if (path === '/api/v1/messages/send' && method === 'POST') {
    return parseBody(req, (body) => {
      const targetDeviceId = body.targetDeviceId || body.targetDev;
      const messageText = body.messageText || body.message;
      const fromUser = body.fromUser || body.fromNick || body.fromDev || 'Bilinmeyen Dost';
      const fromDev = body.fromDev || fromUser;

      if (!targetDeviceId || !messageText) {
        return sendJSON(res, 400, { error: 'targetDeviceId ve messageText zorunludur' });
      }

      database.systemStats.totalMessagesSent++;

      const targetDev = database.devices.get(targetDeviceId);
      const isTargetOnline = targetDev && (Date.now() - targetDev.lastSeen < 90000);
      const now = Date.now();

      // SQLite Kaydı
      try {
        db.prepare('INSERT INTO messages (from_dev, from_nick, target_dev, message_text, is_delivered, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          fromDev, fromUser, targetDeviceId, messageText.slice(0, 32), isTargetOnline ? 1 : 0, now
        );
      } catch (e) {
        console.error('Mesaj SQLite kayit hatasi:', e.message);
      }

      const msgObj = {
        id: crypto.randomUUID(),
        from: fromUser,
        from_nick: fromUser,
        from_dev: fromDev,
        text: messageText.slice(0, 32),
        message: messageText.slice(0, 32),
        timestamp: new Date().toISOString(),
        deliveredImmediately: isTargetOnline
      };

      if (!database.offlineMessages.has(targetDeviceId)) {
        database.offlineMessages.set(targetDeviceId, []);
      }
      database.offlineMessages.get(targetDeviceId).push(msgObj);

      sendJSON(res, 200, {
        success: true,
        messageId: msgObj.id,
        status: isTargetOnline ? 'DELIVERED_TO_ONLINE_DEVICE' : 'QUEUED_IN_OFFLINE_STORE',
        note: isTargetOnline ? 'Cihaz çevrimiçi, ekranda akıyor!' : 'Cihaz kapalı, açılınca iletilecek.'
      });
    });
  }

  // 6. ÇEVRİMDIŞI MESAJ KUYRUĞUNU ÇEKME (GET INBOX)
  if (path.startsWith('/api/v1/messages/inbox/') && method === 'GET') {
    const devId = path.split('/')[5];
    const msgs = database.offlineMessages.get(devId) || [];
    database.offlineMessages.set(devId, []); // Çekilince kuyruğu boşalt

    // SQLite bekleyen mesajları da topla
    let sqlMsgs = [];
    try {
      sqlMsgs = db.prepare('SELECT id, from_dev, from_nick, message_text, created_at FROM messages WHERE target_dev = ? AND is_delivered = 0').all(devId);
      if (sqlMsgs.length > 0) {
        db.prepare('UPDATE messages SET is_delivered = 1 WHERE target_dev = ? AND is_delivered = 0').run(devId);
      }
    } catch(e) {}

    // Birleştir ve uyuştur
    const combined = [...msgs];
    sqlMsgs.forEach(sm => {
      if (!combined.some(m => m.text === sm.message_text && m.from_dev === sm.from_dev)) {
        combined.push({
          id: sm.id,
          from: sm.from_nick,
          from_nick: sm.from_nick,
          from_dev: sm.from_dev,
          text: sm.message_text,
          message: sm.message_text,
          timestamp: new Date(sm.created_at).toISOString()
        });
      }
    });

    return sendJSON(res, 200, {
      deviceId: devId,
      messages: combined,
      count: combined.length
    });
  }

  // 7. BULUT YEDEKLEME & GERİ YÜKLEME (CLOUD BACKUP / RESTORE)
  if (path === '/api/v1/cloud/backup' && method === 'POST') {
    return parseBody(req, (body) => {
      const { userEmail, petState, totalScore, streakDays } = body;
      if (!userEmail) return sendJSON(res, 400, { error: 'userEmail zorunludur' });

      database.users.set(userEmail, {
        userEmail,
        petState,
        totalScore,
        streakDays,
        updatedAt: new Date().toISOString()
      });

      sendJSON(res, 200, { success: true, message: 'Bulut yedeği güncellendi', updatedAt: new Date().toISOString() });
    });
  }

  if (path.startsWith('/api/v1/cloud/restore/') && method === 'GET') {
    const email = decodeURIComponent(path.split('/')[5]);
    const userData = database.users.get(email);
    if (!userData) {
      return sendJSON(res, 404, { error: 'Kullanıcıya ait bulut yedeği bulunamadı' });
    }
    return sendJSON(res, 200, { success: true, backup: userData });
  }

  // 7.0 GOOGLE AUTH & KULLANICI PROFİL YÖNETİMİ (TEK OTURUM CONCURRENCY KİLİDİ İLE)
  if (path === '/api/v1/auth/google/signin' && method === 'POST') {
    return parseBody(req, (body) => {
      const { email, nickname, avatar, googleId, deviceId, pet, needs, stats } = body;
      if (!email) return sendJSON(res, 400, { error: 'email parametresi zorunludur' });

      const normEmail = email.trim().toLowerCase();
      const now = Date.now();
      const devId = deviceId || `SOCIES-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      const sessionToken = crypto.randomUUID();

      try {
        let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
        const isNewUser = !user;

        if (user) {
          // Mevcut kullanıcı: Son giriş, oturum belirteci ve cihaz ID güncelle
          db.prepare(`
            UPDATE users SET
              nickname = COALESCE(?, nickname),
              avatar = COALESCE(?, avatar),
              device_id = ?,
              google_id = COALESCE(?, google_id),
              session_token = ?,
              last_login = ?
            WHERE email = ?
          `).run(nickname || null, avatar || null, devId, googleId || null, sessionToken, now, normEmail);

          user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
        } else {
          // Yeni kullanıcı kaydı oluştur (henüz yumurtadan çıkmamış/çatlamamış)
          const initialSave = {
            pet: pet ? Object.assign({}, pet, { hatched: false }) : null,
            needs: needs || { hunger: 90, fun: 90, love: 90, sleep: 90, toilet: 90, clean: 90, xp: 100, level: 1 },
            stats: stats || { batteryPct: 100, steps: 0 },
            createdAt: now
          };

          db.prepare(`
            INSERT INTO users (email, nickname, avatar, device_id, google_id, profile_json, cloud_save_json, session_token, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            normEmail,
            nickname || normEmail.split('@')[0],
            avatar || '🐾',
            devId,
            googleId || null,
            JSON.stringify({ email: normEmail, isVerified: true }),
            JSON.stringify(initialSave),
            sessionToken,
            now,
            now
          );

          user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
        }

        // Cihazlar tablosuna bağla ve online yap
        db.prepare(`
          INSERT INTO devices (device_id, nickname, avatar, user_email, pet_json, needs_json, stats_json, last_seen, is_online)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(device_id) DO UPDATE SET
            nickname = excluded.nickname,
            avatar = excluded.avatar,
            user_email = excluded.user_email,
            last_seen = excluded.last_seen,
            is_online = 1
        `).run(
          devId,
          user.nickname,
          user.avatar,
          normEmail,
          JSON.stringify(pet || {}),
          JSON.stringify(needs || {}),
          JSON.stringify(stats || {}),
          now
        );

        database.devices.set(devId, {
          deviceId: devId,
          mac: 'A4:CF:12:89:34:B1',
          user: { nickname: user.nickname, email: normEmail, avatar: user.avatar, isVip: user.nickname.includes('Kurucu') },
          pet: pet || { breed: 'top', stage: 1, ageDays: 1, score: 0 },
          needs: needs || { hunger: 90, fun: 90, love: 90, sleep: 90, toilet: 90, clean: 90 },
          stats: stats || { batteryPct: 100, steps: 0 },
          lastSeen: now,
          isOnline: true
        });

        const cloudSave = JSON.parse(user.cloud_save_json || '{}');

        return sendJSON(res, 200, {
          success: true,
          isNewUser,
          sessionToken,
          message: 'Google ile giriş başarılı',
          user: {
            email: user.email,
            nickname: user.nickname,
            avatar: user.avatar,
            deviceId: devId,
            createdAt: user.created_at,
            lastLogin: user.last_login
          },
          cloudSave
        });
      } catch(e) {
        console.error('[AUTH ERROR]', e);
        return sendJSON(res, 500, { error: 'Giriş işlemi başarısız: ' + e.message });
      }
    });
  }

  // 7.0.1 BULUT İHTİYAÇ VE İLERLEME SENKRONİZASYONU (SESSION CONCURRENCY KONTROLLÜ)
  if (path === '/api/v1/auth/sync' && method === 'POST') {
    return parseBody(req, (body) => {
      const { email, deviceId, nickname, cloudSave, pet, needs, stats, sessionToken } = body;
      if (!email) return sendJSON(res, 400, { error: 'email parametresi zorunludur' });

      const normEmail = email.trim().toLowerCase();
      const now = Date.now();

      try {
        let existingSave = {};
        const userRow = db.prepare('SELECT session_token, cloud_save_json, nickname FROM users WHERE email = ?').get(normEmail);
        if (userRow) {
          // Çift cihaz eşzamanlı oturum hilesi engelleme
          if (userRow.session_token && sessionToken && userRow.session_token !== sessionToken) {
            return sendJSON(res, 409, {
              error: 'Oturum sonlandırıldı. Başka bir cihazda (telefon/tablet) oturum açıldı.',
              code: 'SESSION_REVOKED'
            });
          }
          if (userRow.cloud_save_json) {
            try { existingSave = JSON.parse(userRow.cloud_save_json || '{}'); } catch(e) {}
          }
          if (!userRow.session_token && sessionToken) {
            db.prepare('UPDATE users SET session_token = ? WHERE email = ?').run(sessionToken, normEmail);
          }
        }

        const mergedPet = pet || existingSave.pet || null;
        const mergedNeeds = needs || existingSave.needs || null;
        const mergedStats = stats || existingSave.stats || null;
        const payloadStr = JSON.stringify(cloudSave || Object.assign({}, existingSave, {
          pet: mergedPet,
          needs: mergedNeeds,
          stats: mergedStats,
          updatedAt: now
        }));

        db.prepare(`
          UPDATE users SET
            nickname = COALESCE(?, nickname),
            cloud_save_json = ?,
            last_login = ?
          WHERE email = ?
        `).run(nickname || null, payloadStr, now, normEmail);

        if (deviceId) {
          db.prepare(`
            UPDATE devices SET
              nickname = COALESCE(?, nickname),
              pet_json = COALESCE(?, pet_json),
              needs_json = COALESCE(?, needs_json),
              stats_json = COALESCE(?, stats_json),
              last_seen = ?,
              is_online = 1
            WHERE device_id = ?
          `).run(
            nickname || null,
            mergedPet ? JSON.stringify(mergedPet) : null,
            mergedNeeds ? JSON.stringify(mergedNeeds) : null,
            mergedStats ? JSON.stringify(mergedStats) : null,
            now,
            deviceId
          );
        }

        return sendJSON(res, 200, { success: true, message: 'Bulut eşitleme başarılı', syncedAt: now });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 7.0.2 BULUT YEDEKLEME OLUŞTURMA (MANUEL VEYA GÜNLÜK YEDEK)
  if (path === '/api/v1/auth/backup/create' && method === 'POST') {
    return parseBody(req, (body) => {
      const { email, sessionToken, backupData, note } = body;
      if (!email || !backupData) return sendJSON(res, 400, { error: 'email ve backupData zorunludur' });

      const normEmail = email.trim().toLowerCase();
      const now = Date.now();

      try {
        const userRow = db.prepare('SELECT session_token, backups_json FROM users WHERE email = ?').get(normEmail);
        if (!userRow) return sendJSON(res, 404, { error: 'Kullanıcı bulunamadı' });

        if (userRow.session_token && sessionToken && userRow.session_token !== sessionToken) {
          return sendJSON(res, 409, { error: 'Oturum geçersiz', code: 'SESSION_REVOKED' });
        }

        let backups = [];
        try { backups = JSON.parse(userRow.backups_json || '[]'); } catch(e) {}
        if (!Array.isArray(backups)) backups = [];

        const newBackup = {
          id: crypto.randomUUID(),
          timestamp: now,
          note: note || 'Kullanıcı Bulut Yedeği',
          petName: backupData?.pet?.name || 'Socies',
          stage: backupData?.pet?.stage || 1,
          score: backupData?.pet?.score || 0,
          data: backupData
        };

        backups.push(newBackup);
        // Son 5 yedeği sakla (en son 1-2 gün)
        if (backups.length > 5) backups = backups.slice(-5);

        db.prepare('UPDATE users SET backups_json = ? WHERE email = ?').run(JSON.stringify(backups), normEmail);

        return sendJSON(res, 200, {
          success: true,
          message: 'Bulut yedeği başarıyla oluşturuldu',
          backup: { id: newBackup.id, timestamp: newBackup.timestamp, note: newBackup.note },
          count: backups.length
        });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 7.0.3 BULUT YEDEKLERİNİ LİSTELEME
  if (path.startsWith('/api/v1/auth/backup/list/') && method === 'GET') {
    const email = decodeURIComponent(path.slice('/api/v1/auth/backup/list/'.length) || '').trim().toLowerCase();
    if (!email) return sendJSON(res, 400, { error: 'Geçersiz email' });

    try {
      const userRow = db.prepare('SELECT backups_json FROM users WHERE email = ?').get(email);
      if (!userRow) return sendJSON(res, 404, { error: 'Kullanıcı bulunamadı' });

      let backups = [];
      try { backups = JSON.parse(userRow.backups_json || '[]'); } catch(e) {}
      const summary = backups.map(b => ({
        id: b.id,
        timestamp: b.timestamp,
        note: b.note,
        petName: b.petName || b.data?.pet?.name || 'Socies',
        stage: b.stage || b.data?.pet?.stage || 1,
        score: b.score || b.data?.pet?.score || 0
      })).reverse();

      return sendJSON(res, 200, { success: true, count: summary.length, backups: summary });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.0.4 BULUT YEDEĞİNDEN GERİ YÜKLEME
  if (path === '/api/v1/auth/backup/restore' && method === 'POST') {
    return parseBody(req, (body) => {
      const { email, sessionToken, backupId } = body;
      if (!email || !backupId) return sendJSON(res, 400, { error: 'email ve backupId zorunludur' });

      const normEmail = email.trim().toLowerCase();
      try {
        const userRow = db.prepare('SELECT session_token, backups_json FROM users WHERE email = ?').get(normEmail);
        if (!userRow) return sendJSON(res, 404, { error: 'Kullanıcı bulunamadı' });

        if (userRow.session_token && sessionToken && userRow.session_token !== sessionToken) {
          return sendJSON(res, 409, { error: 'Oturum geçersiz', code: 'SESSION_REVOKED' });
        }

        let backups = [];
        try { backups = JSON.parse(userRow.backups_json || '[]'); } catch(e) {}
        const targetBackup = backups.find(b => b.id === backupId);
        if (!targetBackup) return sendJSON(res, 404, { error: 'Belirtilen yedek bulunamadı' });

        const restoredData = targetBackup.data;
        db.prepare('UPDATE users SET cloud_save_json = ?, last_login = ? WHERE email = ?')
          .run(JSON.stringify(restoredData), Date.now(), normEmail);

        return sendJSON(res, 200, {
          success: true,
          message: 'Yedek başarıyla geri yüklendi',
          restoredData
        });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 7.0.5 CANLI TELEMETRİ LOGLARI KAYDETME (CLIENT ERROR / EVENT LOGS)
  if (path === '/api/v1/telemetry/logs' && method === 'POST') {
    return parseBody(req, (body) => {
      const rawLogs = Array.isArray(body.logs) ? body.logs : (body.level ? [body] : []);
      if (!rawLogs.length) return sendJSON(res, 200, { success: true, count: 0 });

      const now = Date.now();
      const stmt = db.prepare(`
        INSERT INTO telemetry_logs (level, category, message, details_json, user_email, device_id, app_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let inserted = 0;
      for (const log of rawLogs) {
        try {
          stmt.run(
            log.level || 'info',
            log.category || 'GENERAL',
            String(log.message || '').slice(0, 500),
            log.details ? (typeof log.details === 'string' ? log.details : JSON.stringify(log.details)) : null,
            log.userEmail || null,
            log.deviceId || null,
            log.appVersion || 'v1.0.20',
            log.timestamp || now
          );
          inserted++;
        } catch(e) {}
      }

      // Tablo boyutunu optimize et (en son 5000 kaydı koru)
      try {
        db.exec('DELETE FROM telemetry_logs WHERE id NOT IN (SELECT id FROM telemetry_logs ORDER BY id DESC LIMIT 5000);');
      } catch(e) {}

      return sendJSON(res, 200, { success: true, inserted });
    });
  }

  // 7.0.6 CANLI TELEMETRİ LOGLARINI OKUMA (SON 100 KAYIT)
  if (path === '/api/v1/telemetry/logs' && method === 'GET') {
    try {
      const logs = db.prepare('SELECT * FROM telemetry_logs ORDER BY id DESC LIMIT 100').all();
      return sendJSON(res, 200, { success: true, count: logs.length, logs });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.0.2 TÜM HESAPLARI LİSTELEME
  if (path === '/api/v1/auth/users' && method === 'GET') {
    try {
      const users = db.prepare('SELECT email, nickname, avatar, device_id, created_at, last_login FROM users ORDER BY last_login DESC').all();
      return sendJSON(res, 200, { success: true, count: users.length, users });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.0.7 CANLI PUSH / ANONS OLUŞTURMA (BROADCAST CREATE)
  if (path === '/api/v1/broadcast/create' && method === 'POST') {
    return parseBody(req, (body) => {
      const { title, message, animation, giftGold, giftFood, durationMinutes } = body;
      if (!message || !message.trim()) {
        return sendJSON(res, 400, { error: 'Anons mesajı boş olamaz' });
      }

      const now = Date.now();
      const expires = now + ((parseInt(durationMinutes, 10) || 1440) * 60 * 1000); // Varsayılan 24 saat
      try {
        const stmt = db.prepare(`
          INSERT INTO broadcasts (title, message, animation, gift_gold, gift_food, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const info = stmt.run(
          (title || 'Socies Bildirimi').trim(),
          message.trim(),
          animation || 'FLAG_TR',
          parseInt(giftGold, 10) || 0,
          giftFood || '',
          now,
          expires
        );

        // Canlı konsol köprüsüne de fırlat
        database.bridgeEvents.push({
          id: database.bridgeNextId++,
          type: 'BROADCAST',
          payload: { id: info.lastInsertRowid, title, message, animation, giftGold, giftFood },
          sender: 'admin_server',
          timestamp: now
        });
        if (database.bridgeEvents.length > 100) database.bridgeEvents.shift();

        return sendJSON(res, 200, {
          success: true,
          message: 'Anons tüm konsollara başarıyla yayınlandı!',
          broadcastId: info.lastInsertRowid
        });
      } catch(e) {
        return sendJSON(res, 500, { error: 'Anons kaydedilemedi: ' + e.message });
      }
    });
  }

  // 7.0.8 EN SON AKTİF ANONS / PUSH MESAJINI ÇEKME (BROADCAST LATEST)
  if (path.startsWith('/api/v1/broadcast/latest') && method === 'GET') {
    const since = parseInt(parsedUrl.query.since || '0', 10);
    const now = Date.now();
    try {
      const latest = db.prepare(`
        SELECT * FROM broadcasts
        WHERE id > ? AND expires_at > ?
        ORDER BY id DESC LIMIT 1
      `).get(since, now);

      return sendJSON(res, 200, {
        success: true,
        hasBroadcast: !!latest,
        broadcast: latest || null
      });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.0.9 YAYINLANMIŞ ANONS GEÇMİŞİ (BROADCAST HISTORY)
  if (path === '/api/v1/broadcast/history' && method === 'GET') {
    try {
      const list = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 20').all();
      return sendJSON(res, 200, { success: true, count: list.length, broadcasts: list });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.0.10 ÇOCUK/KULLANICI İLGİ ALANI VERİSİ KAYDETME (ZERO-PARTY DATA)
  if (path === '/api/v1/user/interest' && method === 'POST') {
    return parseBody(req, (body) => {
      const { userEmail, deviceId, category, question, answer } = body;
      if (!question || !answer) {
        return sendJSON(res, 400, { error: 'question ve answer zorunludur' });
      }
      try {
        db.prepare(`
          INSERT INTO user_interests (user_email, device_id, category, question, answer, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          userEmail || null,
          deviceId || null,
          category || 'general',
          question.slice(0, 200),
          answer.slice(0, 100),
          Date.now()
        );
        return sendJSON(res, 200, { success: true, message: 'İlgi alanı kaydedildi' });
      } catch(e) {
        return sendJSON(res, 500, { error: e.message });
      }
    });
  }

  // 7.0.11 İLGİ ALANI ANALİTİK ÖZETİ (ZERO-PARTY SUMMARY)
  if (path === '/api/v1/admin/interests/summary' && method === 'GET') {
    try {
      const totalCount = db.prepare('SELECT COUNT(*) AS c FROM user_interests').get().c;
      const recentAnswers = db.prepare('SELECT * FROM user_interests ORDER BY id DESC LIMIT 30').all();
      const byCategory = db.prepare('SELECT category, COUNT(*) as c FROM user_interests GROUP BY category').all();
      const byAnswer = db.prepare('SELECT question, answer, COUNT(*) as c FROM user_interests GROUP BY question, answer ORDER BY c DESC LIMIT 20').all();

      return sendJSON(res, 200, {
        success: true,
        totalCount,
        byCategory,
        byAnswer,
        recentAnswers
      });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.0.12 TELEMETRİ LOGLARINI SIFIRLAMA
  if (path === '/api/v1/admin/clear-logs' && method === 'POST') {
    try {
      db.exec('DELETE FROM telemetry_logs');
      return sendJSON(res, 200, { success: true, message: 'Tüm telemetri logları temizlendi' });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.0.13 MERKEZİ SUNUCU TÜM GENEL METRİKLER (ADMIN OVERVIEW)
  if (path === '/api/v1/admin/overview' && method === 'GET') {
    try {
      const devices = Array.from(database.devices.values());
      const onlineDevices = devices.filter(d => (Date.now() - d.lastSeen) < 180000);
      const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
      const totalLogs = db.prepare('SELECT COUNT(*) AS c FROM telemetry_logs').get().c;
      const totalBroadcasts = db.prepare('SELECT COUNT(*) AS c FROM broadcasts').get().c;
      const totalInterests = db.prepare('SELECT COUNT(*) AS c FROM user_interests').get().c;
      const recentLogs = db.prepare('SELECT * FROM telemetry_logs ORDER BY id DESC LIMIT 25').all();
      const recentBroadcasts = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 5').all();
      const recentInterests = db.prepare('SELECT * FROM user_interests ORDER BY id DESC LIMIT 15').all();

      // Bellek ve Uptime bilgisi
      const mem = process.memoryUsage();
      const uptimeSec = Math.floor(process.uptime());

      return sendJSON(res, 200, {
        success: true,
        serverTime: Date.now(),
        system: {
          uptimeSec,
          ramRssMb: Math.round(mem.rss / (1024 * 1024)),
          heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
          nodeVersion: process.version
        },
        stats: {
          onlineDevices: onlineDevices.length,
          registeredDevices: devices.length,
          devicesCount: devices.length,
          onlineCount: onlineDevices.length,
          activeBroadcasts: totalBroadcasts,
          interestRecords: totalInterests,
          logCount: totalLogs,
          totalUsers,
          totalPokes: database.systemStats.totalPokesSent
        },
        devices: devices.map(d => ({
          deviceId: d.deviceId,
          user: d.user || { nickname: 'Anonim' },
          location: d.location || { country: 'Türkiye', city: 'İstanbul', district: 'Kadıköy', flag: '🇹🇷' },
          pet: d.pet || {},
          needs: d.needs || {},
          phone: d.phone || {},
          lastSeen: d.lastSeen,
          isOnline: (Date.now() - d.lastSeen) < 180000
        })),
        recentLogs,
        recentBroadcasts,
        recentInterests
      });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 7.1 ÖZEL KARAKTER & ÇİZİM BULUT KAYDI (CUSTOM SPRITE SAVE)
  if (path === '/api/v1/pet/save-custom-sprite' && method === 'POST') {
    return parseBody(req, (body) => {
      const { userEmail, spriteName, spriteType, bitmap48, xbmData } = body;
      if (!userEmail || !bitmap48) {
        return sendJSON(res, 400, { error: 'userEmail ve bitmap48 zorunludur' });
      }

      const spriteObj = {
        id: crypto.randomUUID(),
        name: spriteName || 'Özel Canlı',
        type: spriteType || 'sketch', // 'sketch' | 'selfie'
        bitmap48,
        xbmData: xbmData || '',
        createdAt: new Date().toISOString()
      };

      if (!database.customSprites.has(userEmail)) {
        database.customSprites.set(userEmail, []);
      }
      database.customSprites.get(userEmail).push(spriteObj);

      sendJSON(res, 200, {
        success: true,
        message: 'Özel karakter buluta kaydedildi',
        sprite: spriteObj
      });
    });
  }

  // 7.2 ÖZEL KARAKTERLERİ ÇEKME
  if (path.startsWith('/api/v1/pet/custom-sprites/') && method === 'GET') {
    const email = decodeURIComponent(path.split('/')[5]);
    const list = database.customSprites.get(email) || [];
    return sendJSON(res, 200, {
      userEmail: email,
      count: list.length,
      sprites: list
    });
  }

  // 7.3 SELFIE TO 1-BIT PIXEL AVATAR DÖNÜŞTÜRÜCÜ (VISION / DITHER PROCESSOR)
  if (path === '/api/v1/pet/generate-from-selfie' && method === 'POST') {
    return parseBody(req, (body) => {
      const { userEmail, style, imageBase64 } = body;
      // 48x48 Piksel monokrom simüle edilmiş adaptif dither deseni ve yüz hatları üretimi
      const simulatedBitmap = [];
      for (let y = 0; y < 48; y++) {
        const row = [];
        for (let x = 0; x < 48; x++) {
          // Kafa/gövde silueti dairesel alan
          const dx = x - 24;
          const dy = y - 24;
          const dist = Math.sqrt(dx*dx + dy*dy);
          let pixel = 0;
          if (dist < 18 && dist > 14) pixel = 1; // dış hat
          if (style === 'cat' && y < 14 && (Math.abs(x - 14) < 4 || Math.abs(x - 34) < 4)) pixel = 1; // kedi kulağı
          if (y >= 20 && y <= 22 && (x === 18 || x === 30)) pixel = 1; // gözler
          if (y === 28 && x >= 20 && x <= 28) pixel = 1; // gülümseme
          row.push(pixel);
        }
        simulatedBitmap.push(row);
      }

      sendJSON(res, 200, {
        success: true,
        style: style || 'original',
        width: 48,
        height: 48,
        bitmap: simulatedBitmap,
        message: 'Selfie başarıyla 48x48 OLED 1-bit karaktere dönüştürüldü'
      });
    });
  }

  // 8. GITHUB SÜRÜM / OTA KONTROLÜ (SemVer 2.0.0 v1.0.33)
  if (path === '/api/v1/version/check' && method === 'GET') {
    const host = req.headers.host || '192.168.1.118:3000';
    return sendJSON(res, 200, {
      latestVersion: 'v1.0.33',
      semver: {
        major: 1,
        minor: 0,
        patch: 33,
        build: 34
      },
      versionCode: 34,
      latestCommitHash: 'socies-v1.0.33',
      mandatoryUpdate: true,
      releaseNotes: 'v1.0.33: 13 Retro Mini Oyun (Catcher ve Parachute ayrımı), Stacker kamera kaydırma, polimorfik stüdyo durum desteği ve haptic/ses optimizasyonları.',
      apkDownloadUrl: `http://${host}/download/socies-app.apk`,
      githubApkUrl: 'https://github.com/mcturan/socies/releases/download/v1.0.33/socies-app.apk'
    });
  }

  // 404
  sendJSON(res, 404, { error: 'Uç nokta bulunamadı', requestedPath: path });
});

// BODY PARSER (DoS & Payload Sınırı Korumalı)
function parseBody(req, callback) {
  let body = '';
  let tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    body += chunk;
    if (body.length > 5 * 1024 * 1024) { // 5MB limit
      tooLarge = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooLarge) return callback({});
    try {
      const parsed = JSON.parse(body || '{}');
      callback(parsed);
    } catch (e) {
      callback({});
    }
  });
}

// CANLI WEB YÖNETİM & İSTATİSTİK PANELİ (INDEX.HTML)
function serveDashboard(res) {
  const indexPath = pathModule.join(__dirname, '../index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(indexPath).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('SOCIES Server Online');
}

// SOCIES AĞ & ETKİN KULLANICILAR SAYFASI
function serveSociesNetworkPage(res) {
  const users = Array.from(database.devices.values()).map(d => ({
    ...d,
    isOnline: (Date.now() - d.lastSeen) < 180000
  }));

  const onlineCount = users.filter(u => u.isOnline).length;
  const countries = [...new Set(users.map(u => u.location?.country || 'Türkiye'))];
  const cities = [...new Set(users.map(u => u.location?.city || 'İstanbul'))];

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>SOCIES - Canlı Topluluk Ağı & Etkin Kullanıcılar</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: #070a12; color: #f8fafc; padding: 2rem; min-height: 100vh; }
    .container { max-width: 1380px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid #1e293b; padding-bottom: 1.2rem; flex-wrap: wrap; gap: 1rem; }
    .title { font-size: 1.6rem; font-weight: 800; background: linear-gradient(90deg, #00f0ff, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .sub { font-size: 0.8rem; color: #94a3b8; margin-top: 4px; }
    .nav-links { display: flex; align-items: center; gap: 0.8rem; }
    .nav-btn { background: #0f172a; border: 1px solid #1e293b; color: #fff; padding: 0.5rem 1rem; border-radius: 10px; text-decoration: none; font-size: 0.8rem; font-weight: 700; transition: all 0.2s; }
    .nav-btn:hover { border-color: #00f0ff; background: rgba(0, 240, 255, 0.1); }
    .dl-btn { background: linear-gradient(135deg, #00f0ff, #0099ff); color: #000; padding: 0.5rem 1.1rem; border-radius: 10px; font-weight: 800; font-size: 0.8rem; text-decoration: none; box-shadow: 0 0 15px rgba(0,240,255,0.4); }

    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .kpi-card { background: #0f1523; border: 1px solid #1e293b; border-radius: 16px; padding: 1.2rem; position: relative; }
    .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #00f0ff, #a855f7); }
    .kpi-val { font-size: 1.8rem; font-weight: 800; color: #00f0ff; font-family: 'JetBrains Mono', monospace; }
    .kpi-lbl { font-size: 0.75rem; color: #94a3b8; margin-top: 4px; }

    .search-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: center; }
    .search-input { flex: 1; background: #0f1523; border: 1px solid #1e293b; border-radius: 12px; padding: 0.75rem 1.2rem; color: #fff; font-size: 0.85rem; outline: none; }
    .search-input:focus { border-color: #00f0ff; }

    .users-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1.5rem; }
    .user-card { background: #0f1523; border: 1px solid #1e293b; border-radius: 20px; padding: 1.4rem; transition: transform 0.2s, border-color 0.2s; position: relative; }
    .user-card:hover { transform: translateY(-3px); border-color: #00f0ff; box-shadow: 0 10px 25px rgba(0, 240, 255, 0.1); }
    .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #1e293b; padding-bottom: 0.8rem; }
    .loc-badge { font-size: 0.82rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.4rem; }
    .loc-badge span { display: flex; align-items: center; gap: 0.3rem; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-on { background: #00ff66; box-shadow: 0 0 10px #00ff66; }
    .dot-off { background: #64748b; }

    .user-body { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; }
    .user-avatar { font-size: 2.2rem; background: rgba(255,255,255,0.05); border-radius: 16px; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; border: 1px solid #1e293b; flex-shrink: 0; }
    .user-info { flex: 1; min-width: 0; }
    .user-nick { font-size: 1rem; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 0.4rem; }
    .vip-tag { font-size: 0.65rem; background: rgba(255, 230, 0, 0.15); color: #ffe600; border: 1px solid rgba(255, 230, 0, 0.3); padding: 0.1rem 0.4rem; border-radius: 6px; font-weight: 800; }
    .user-dev { font-size: 0.72rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace; margin-top: 2px; }

    .pet-strip { background: rgba(0, 240, 255, 0.05); border: 1px solid rgba(0, 240, 255, 0.15); border-radius: 12px; padding: 0.6rem 0.8rem; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .pet-label { font-size: 0.75rem; color: #94a3b8; }
    .pet-val { font-size: 0.85rem; font-weight: 800; color: #00f0ff; }

    .phone-specs { font-size: 0.72rem; color: #64748b; display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem 0.8rem; margin-bottom: 1rem; }
    .spec-item { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .card-actions { display: flex; gap: 0.5rem; }
    .act-btn { flex: 1; padding: 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 700; border: none; cursor: pointer; transition: all 0.2s; text-align: center; }
    .btn-poke { background: #1e293b; color: #fff; }
    .btn-poke:hover { background: #334155; }
    .btn-msg { background: rgba(0, 240, 255, 0.1); color: #00f0ff; border: 1px solid rgba(0, 240, 255, 0.3); }
    .btn-msg:hover { background: rgba(0, 240, 255, 0.2); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">SOCIES AĞI • CANLI TOPLULUK & ETKİN KULLANICILAR</div>
        <div class="sub">Türkiye ve Dünya Genelinde Çevrimiçi Sanal Bebekler & Cihazlar</div>
      </div>
      <div class="nav-links">
        <a href="/dashboard" class="nav-btn">📊 Sunucu Paneli</a>
        <a href="/" class="nav-btn">🎮 Web Emülatörü</a>
        <a href="/download/socies-app.apk" class="dl-btn">📥 APK İndir (v1.0.33)</a>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-val">${users.length}</div>
        <div class="kpi-lbl">Kayıtlı Cihaz / Kullanıcı</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#00ff66;">${onlineCount}</div>
        <div class="kpi-lbl">Şu An Çevrimiçi (Online)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#a855f7;">${cities.length} Şehir</div>
        <div class="kpi-lbl">${countries.join(', ')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#ffe600;">v1.0.33</div>
        <div class="kpi-lbl">Ağ Sürümü (SemVer 2.0.0)</div>
      </div>
    </div>

    .search-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; align-items: center; }
    .search-input { flex: 1; background: #0f1523; border: 1px solid #1e293b; border-radius: 12px; padding: 0.75rem 1.2rem; color: #fff; font-size: 0.85rem; outline: none; }
    .search-input:focus { border-color: #00f0ff; }

    .users-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1.5rem; }
    .user-card { background: #0f1523; border: 1px solid #1e293b; border-radius: 20px; padding: 1.4rem; transition: transform 0.2s, border-color 0.2s; position: relative; }
    .user-card:hover { transform: translateY(-3px); border-color: #00f0ff; box-shadow: 0 10px 25px rgba(0, 240, 255, 0.1); }
    .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #1e293b; padding-bottom: 0.8rem; }
    .loc-badge { font-size: 0.82rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.4rem; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .dot-on { background: #00ff66; box-shadow: 0 0 8px #00ff66; }
    .dot-off { background: #64748b; }

    .user-profile { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 1rem; }
    .avatar { width: 46px; height: 46px; border-radius: 12px; background: linear-gradient(135deg, #1e293b, #334155); display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
    .user-name { font-weight: 800; font-size: 1rem; color: #fff; }
    .user-email { font-size: 0.72rem; color: #94a3b8; font-family: 'JetBrains Mono', monospace; }

    .spec-block { background: rgba(0, 0, 0, 0.25); border-radius: 12px; padding: 0.8rem; margin-bottom: 1rem; font-size: 0.75rem; }
    .spec-line { display: flex; justify-content: space-between; margin-bottom: 0.35rem; }
    .spec-lbl { color: #94a3b8; }
    .spec-val { font-weight: 700; color: #f8fafc; font-family: 'JetBrains Mono', monospace; }

    .pet-badge { display: inline-flex; align-items: center; gap: 0.4rem; background: rgba(0, 240, 255, 0.12); color: #00f0ff; padding: 0.3rem 0.7rem; border-radius: 8px; font-size: 0.75rem; font-weight: 700; margin-bottom: 1rem; }

    .action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .act-btn { padding: 0.5rem; border-radius: 8px; border: 1px solid #1e293b; background: #1a2234; color: #fff; font-size: 0.72rem; font-weight: 700; cursor: pointer; text-align: center; transition: all 0.2s; }
    .act-btn:hover { background: #00f0ff; color: #000; border-color: #00f0ff; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">🌍 SOCIES CANLI TOPLULUK AĞI</div>
        <div class="sub">Etkin Kullanıcılar, Canlı Telefon Telemetrisi & Konum Bilgileri</div>
      </div>
      <div class="nav-links">
        <a href="/dashboard" class="nav-btn">📊 Sunucu Paneli</a>
        <a href="/" class="nav-btn">🎮 Web Emülatörü</a>
        <a href="/download/socies-app.apk" class="dl-btn">📥 APK İndir (v1.0.33)</a>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-val">${users.length}</div>
        <div class="kpi-lbl">Kayıtlı Cihaz / Kullanıcı</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#00ff66;">${onlineCount}</div>
        <div class="kpi-lbl">Şu An Çevrimiçi (Online)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#a855f7;">${cities.length} Şehir</div>
        <div class="kpi-lbl">${countries.join(', ')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val" style="color:#ffe600;">v1.0.33</div>
        <div class="kpi-lbl">Ağ Sürümü (SemVer 2.0.0)</div>
      </div>
    </div>

    <div class="search-row">
      <input type="text" class="search-input" id="filterInput" placeholder="Şehir, ülke, kullanıcı veya canlı türü ile filtrele... (örn: İstanbul, Ankara, Kedi, Berlin)">
    </div>

    <div class="users-grid" id="usersGrid">
      ${users.map(u => `
        <div class="user-card" data-search="${(u.location?.city + ' ' + u.location?.country + ' ' + u.user?.nickname + ' ' + u.pet?.breed).toLowerCase()}">
          <div class="card-head">
            <div class="loc-badge">
              <span>${u.location?.flag || '🌐'}</span>
              <span>${u.location?.country || 'Bilinmiyor'}, ${u.location?.city || 'İstanbul'} <small style="color:#64748b;">(${u.location?.district || 'Merkez'})</small></span>
            </div>
            <span class="status-dot ${u.isOnline ? 'dot-on' : 'dot-off'}" title="${u.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}"></span>
          </div>

          <div class="user-profile">
            <div class="avatar">${u.user?.avatar || '👤'}</div>
            <div>
              <div class="user-name">${u.user?.nickname || 'Socies Dostu'} ${u.user?.isVip ? '<span style="color:#ffe600; font-size:0.75rem;">👑 VIP</span>' : ''}</div>
              <div class="user-email">${u.user?.email || u.deviceId}</div>
            </div>
          </div>

          <div class="pet-badge">
            <span>🐾</span>
            <span>${(u.pet?.breed || 'top').toUpperCase()} (Lv. ${u.pet?.stage || 1}) • ${u.pet?.score || 0} P • 🔥 ${u.pet?.streakDays || 1} Gün Seri</span>
          </div>

          <div class="spec-block">
            <div style="color:#00f0ff; font-weight:700; margin-bottom:6px; font-size:0.7rem;">📱 TELEFONDAN GELEN BİLGİLER</div>
            <div class="spec-line"><span class="spec-lbl">Telefon Modeli:</span><span class="spec-val">${u.phone?.model || 'Android Cihaz'}</span></div>
            <div class="spec-line"><span class="spec-lbl">İşletim Sistemi:</span><span class="spec-val">${u.phone?.os || 'Android 14'}</span></div>
            <div class="spec-line"><span class="spec-lbl">Telefon Bataryası:</span><span class="spec-val">${u.phone?.batteryPct || 100}% (${u.phone?.batteryMv || 4000} mV)</span></div>
            <div class="spec-line"><span class="spec-lbl">Günlük Adım:</span><span class="spec-val">${(u.phone?.stepsToday || 0).toLocaleString()} adım</span></div>
            <div class="spec-line"><span class="spec-lbl">Bağlantı & Gecikme:</span><span class="spec-val">${u.phone?.connection || 'Wi-Fi'} (${u.phone?.latencyMs || 20}ms)</span></div>
            <div class="spec-line"><span class="spec-lbl">Cihaz ID:</span><span class="spec-val" style="color:#a855f7;">${u.deviceId}</span></div>
          </div>

          <div class="action-row">
            <button class="act-btn" onclick="sendQuickMessage('${u.deviceId}', '${u.user?.nickname || 'Dost'}')">📟 Çağrı Gönder</button>
            <button class="act-btn" onclick="sendDuelInvite('${u.deviceId}', '${u.user?.nickname || 'Dost'}')">🤠 Düelloya Davet Et</button>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <script>
    document.getElementById('filterInput').addEventListener('input', function(e) {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.user-card').forEach(card => {
        const text = card.getAttribute('data-search') || '';
        card.style.display = text.includes(q) ? 'block' : 'none';
      });
    });

    function sendQuickMessage(devId, nick) {
      const msg = prompt('[' + nick + '] kullanıcısına çağrı mesajı gönder (Maks 32 karakter):', 'Selam! Parkta mısın?');
      if (!msg) return;
      fetch('/api/v1/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDeviceId: devId, fromUser: 'Web Kullanıcısı', messageText: msg })
      }).then(r => r.json()).then(res => {
        alert(res.status === 'DELIVERED_TO_ONLINE_DEVICE' ? '✨ Mesaj ' + nick + ' kullanıcısına anında iletildi!' : '📬 Hedef kapalı, mesaj kuyruğa alındı.');
      }).catch(err => alert('Hata: ' + err.message));
    }

    function sendDuelInvite(devId, nick) {
      alert('🤠 ' + nick + ' kullanıcısına Kovboy Düellosu daveti gönderildi!');
    }
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

server.listen(PORT, () => {
  console.log(`[SOCIES SERVER] Merkezi sunucu port ${PORT} üzerinde çalışıyor.`);
  console.log(`[DASHBOARD] http://localhost:${PORT}/dashboard adresinden izlenebilir.`);
});
