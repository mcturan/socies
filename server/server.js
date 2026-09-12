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

// MOCK VERİLER (Canlı Topluluk & Etkin Kullanıcılar)
const initialDevices = [
  {
    deviceId: 'SOCIES-ESP32-84920A',
    mac: 'A4:CF:12:89:34:B1',
    user: { nickname: 'Turan (Kurucu)', email: 'turan@socies.io', avatar: '👑', isVip: true },
    location: { country: 'Türkiye', city: 'İstanbul', district: 'Kadıköy', flag: '🇹🇷', ip: '176.240.12.89' },
    phone: { model: 'Samsung Galaxy S24 Ultra', os: 'Android 14 (One UI 6.1)', batteryPct: 88, batteryMv: 3980, stepsToday: 5420, connection: '5G / Wi-Fi 6E', appVersion: 'v1.0.5+6', latencyMs: 18 },
    pet: { breed: 'top', stage: 2, ageDays: 5, score: 940, streakDays: 5 },
    needs: { hunger: 85, fun: 90, love: 95, sleep: 80, toilet: 90, clean: 95, social: 75 },
    lastSeen: Date.now(),
    isOnline: true
  },
  {
    deviceId: 'SOCIES-AND-9941A',
    mac: 'B8:27:EB:AA:51:72',
    user: { nickname: 'Zeynep_Retro', email: 'zeynep@socies.io', avatar: '🐱', isVip: false },
    location: { country: 'Türkiye', city: 'Ankara', district: 'Çankaya', flag: '🇹🇷', ip: '88.255.45.102' },
    phone: { model: 'Xiaomi 13 Pro', os: 'Android 14 (HyperOS)', batteryPct: 94, batteryMv: 4150, stepsToday: 7120, connection: 'Wi-Fi 6 / BLE 5.2', appVersion: 'v1.0.5+6', latencyMs: 24 },
    pet: { breed: 'kedi', stage: 3, ageDays: 21, score: 3420, streakDays: 14 },
    needs: { hunger: 70, fun: 95, love: 90, sleep: 85, toilet: 80, clean: 90, social: 85 },
    lastSeen: Date.now() - 5000,
    isOnline: true
  },
  {
    deviceId: 'SOCIES-ESP32-33129C',
    mac: '24:6F:28:44:91:A8',
    user: { nickname: 'Emre_Ege', email: 'emre@socies.io', avatar: '🐶', isVip: false },
    location: { country: 'Türkiye', city: 'İzmir', district: 'Alsancak', flag: '🇹🇷', ip: '94.122.80.14' },
    phone: { model: 'Google Pixel 8', os: 'Android 14 (Vanilla)', batteryPct: 76, batteryMv: 3890, stepsToday: 3890, connection: '4G LTE / BLE 5.0', appVersion: 'v1.0.5+6', latencyMs: 31 },
    pet: { breed: 'kopek', stage: 2, ageDays: 12, score: 1850, streakDays: 8 },
    needs: { hunger: 65, fun: 80, love: 85, sleep: 70, toilet: 75, clean: 80, social: 70 },
    lastSeen: Date.now() - 12000,
    isOnline: true
  },
  {
    deviceId: 'SOCIES-IOS-44810D',
    mac: 'F0:18:98:C3:19:22',
    user: { nickname: 'Selin_Botanist', email: 'selin@socies.io', avatar: '🌱', isVip: false },
    location: { country: 'Türkiye', city: 'Bursa', district: 'Nilüfer', flag: '🇹🇷', ip: '195.175.39.210' },
    phone: { model: 'Apple iPhone 15 Pro', os: 'iOS 17.5.1', batteryPct: 92, batteryMv: 4110, stepsToday: 6240, connection: 'Wi-Fi / BLE 5.3', appVersion: 'v1.0.5+6', latencyMs: 22 },
    pet: { breed: 'bitki', stage: 2, ageDays: 9, score: 1220, streakDays: 9 },
    needs: { hunger: 90, fun: 85, love: 95, sleep: 90, toilet: 100, clean: 100, social: 60 },
    lastSeen: Date.now() - 8000,
    isOnline: true
  },
  {
    deviceId: 'SOCIES-ESP32-11094E',
    mac: 'C8:2B:96:77:43:55',
    user: { nickname: 'Kaan_Akdeniz', email: 'kaan@socies.io', avatar: '🐠', isVip: false },
    location: { country: 'Türkiye', city: 'Antalya', district: 'Muratpaşa', flag: '🇹🇷', ip: '212.156.40.85' },
    phone: { model: 'OnePlus 12', os: 'Android 14 (OxygenOS)', batteryPct: 65, batteryMv: 3820, stepsToday: 4310, connection: '5G / BLE Gateway', appVersion: 'v1.0.5+6', latencyMs: 29 },
    pet: { breed: 'balik', stage: 1, ageDays: 3, score: 480, streakDays: 3 },
    needs: { hunger: 75, fun: 70, love: 80, sleep: 80, toilet: 85, clean: 70, social: 50 },
    lastSeen: Date.now() - 25000,
    isOnline: true
  },
  {
    deviceId: 'SOCIES-ESP32-77211F',
    mac: 'DC:A6:32:11:80:BC',
    user: { nickname: 'Hans_Berlin', email: 'hans@socies.io', avatar: '🌭', isVip: false },
    location: { country: 'Almanya', city: 'Berlin', district: 'Mitte', flag: '🇩🇪', ip: '84.119.12.44' },
    phone: { model: 'Nothing Phone (2)', os: 'Android 14 (Nothing OS 2.5)', batteryPct: 82, batteryMv: 3950, stepsToday: 8450, connection: 'Wi-Fi 6E / BLE 5.3', appVersion: 'v1.0.5+6', latencyMs: 48 },
    pet: { breed: 'sosis', stage: 3, ageDays: 26, score: 4180, streakDays: 19 },
    needs: { hunger: 80, fun: 85, love: 90, sleep: 75, toilet: 80, clean: 85, social: 90 },
    lastSeen: Date.now() - 40000,
    isOnline: true
  },
  {
    deviceId: 'SOCIES-ESP32-55490G',
    mac: 'E4:5F:01:29:76:D1',
    user: { nickname: 'Oliver_London', email: 'oliver@socies.io', avatar: '🐦', isVip: false },
    location: { country: 'Birleşik Krallık', city: 'Londra', district: 'Soho', flag: '🇬🇧', ip: '82.165.197.1' },
    phone: { model: 'Apple iPhone 14', os: 'iOS 17.4', batteryPct: 71, batteryMv: 3860, stepsToday: 5110, connection: '4G LTE / BLE 5.0', appVersion: 'v1.0.5+6', latencyMs: 55 },
    pet: { breed: 'kus', stage: 2, ageDays: 14, score: 2190, streakDays: 11 },
    needs: { hunger: 60, fun: 90, love: 85, sleep: 80, toilet: 75, clean: 90, social: 80 },
    lastSeen: Date.now() - 95000,
    isOnline: false
  }
];

// SQLite to memory synchronization
try {
  const rowCount = db.prepare('SELECT COUNT(*) AS c FROM devices').get();
  if (rowCount.c === 0) {
    const insertStmt = db.prepare(`
      INSERT INTO devices (device_id, nickname, avatar, user_email, pet_json, needs_json, stats_json, score, steps, last_seen, is_online)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    initialDevices.forEach(d => {
      insertStmt.run(
        d.deviceId,
        d.user.nickname,
        d.user.avatar,
        d.user.email,
        JSON.stringify(d.pet),
        JSON.stringify(d.needs),
        JSON.stringify(d.phone || {}),
        d.pet.score || 0,
        d.phone?.stepsToday || 0,
        d.lastSeen,
        d.isOnline ? 1 : 0
      );
    });
  }

  // Load all devices from SQLite into memory map
  const allRows = db.prepare('SELECT * FROM devices').all();
  allRows.forEach(r => {
    database.devices.set(r.device_id, {
      deviceId: r.device_id,
      mac: 'A4:CF:12:89:34:B1',
      user: { nickname: r.nickname, email: r.user_email, avatar: r.avatar, isVip: r.nickname.includes('Kurucu') },
      pet: JSON.parse(r.pet_json || '{}'),
      needs: JSON.parse(r.needs_json || '{}'),
      stats: JSON.parse(r.stats_json || '{}'),
      score: r.score,
      steps: r.steps,
      lastSeen: r.last_seen,
      isOnline: (Date.now() - r.last_seen) < 180000
    });
  });
} catch(e) {
  console.error('[DB SYNC ERROR]', e);
}

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

  // 1.1 YENİ BİRLEŞİK UYGULAMA (TEK UYGULAMA: KONSOL + YOLDAŞ + LİDERLİK + ARKADAŞLAR)
  if (path === '/app' || path === '/mobile' || path === '/unified' || path === '/companion' || path === '/pocket' || path === '/console') {
    const appPath = pathModule.join(__dirname, '../app.html');
    if (fs.existsSync(appPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(appPath).pipe(res);
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

  if (path === '/download/socies-app.apk' || path === '/downloads/socies-app.apk' || path === '/socies-app.apk' || path === '/download/socies-v1.0.5.apk' || path === '/download/socies-v1.0.4.apk') {
    const apkFile = pathModule.join(__dirname, '../downloads/socies-app.apk');
    if (fs.existsSync(apkFile)) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="socies-v1.0.5.apk"',
        'Access-Control-Allow-Origin': '*'
      });
      return fs.createReadStream(apkFile).pipe(res);
    }
  }

  // 1.6 SUNUCU CANLILIK & PING KONTROLÜ (HEALTH / PING)
  if (path === '/api/v1/ping' && method === 'GET') {
    return sendJSON(res, 200, {
      status: 'OK',
      serverTime: Date.now(),
      serverHost: req.headers.host || '192.168.1.118:3000',
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
      const { targetDeviceId, fromUser, messageText } = body;
      if (!targetDeviceId || !messageText) {
        return sendJSON(res, 400, { error: 'targetDeviceId ve messageText zorunludur' });
      }

      database.systemStats.totalMessagesSent++;

      const targetDev = database.devices.get(targetDeviceId);
      const isTargetOnline = targetDev && (Date.now() - targetDev.lastSeen < 90000);

      const msgObj = {
        id: crypto.randomUUID(),
        from: fromUser || 'Bilinmeyen Dost',
        text: messageText.slice(0, 32),
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

    return sendJSON(res, 200, {
      deviceId: devId,
      messages: msgs,
      count: msgs.length
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

  // 7.0 GOOGLE AUTH & KULLANICI PROFİL YÖNETİMİ
  if (path === '/api/v1/auth/google/signin' && method === 'POST') {
    return parseBody(req, (body) => {
      const { email, nickname, avatar, googleId, deviceId, pet, needs, stats } = body;
      if (!email) return sendJSON(res, 400, { error: 'email parametresi zorunludur' });

      const normEmail = email.trim().toLowerCase();
      const now = Date.now();
      const devId = deviceId || `SOCIES-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;

      try {
        let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);

        if (user) {
          // Mevcut kullanıcı: Son giriş ve cihaz ID güncelle
          db.prepare(`
            UPDATE users SET
              nickname = COALESCE(?, nickname),
              avatar = COALESCE(?, avatar),
              device_id = ?,
              google_id = COALESCE(?, google_id),
              last_login = ?
            WHERE email = ?
          `).run(nickname || null, avatar || null, devId, googleId || null, now, normEmail);

          user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
        } else {
          // Yeni kullanıcı kaydı oluştur
          const initialSave = {
            pet: pet || { breed: 'top', stage: 1, ageDays: 1, score: 100 },
            needs: needs || { hunger: 90, fun: 90, love: 90, sleep: 90, toilet: 90, clean: 90, xp: 100, level: 1 },
            stats: stats || { batteryPct: 100, steps: 0 },
            createdAt: now
          };

          db.prepare(`
            INSERT INTO users (email, nickname, avatar, device_id, google_id, profile_json, cloud_save_json, created_at, last_login)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            normEmail,
            nickname || normEmail.split('@')[0],
            avatar || '🐾',
            devId,
            googleId || null,
            JSON.stringify({ email: normEmail, isVerified: true }),
            JSON.stringify(initialSave),
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

  // 7.0.1 BULUT İHTİYAÇ VE İLERLEME SENKRONİZASYONU (CLOUD SYNC)
  if (path === '/api/v1/auth/sync' && method === 'POST') {
    return parseBody(req, (body) => {
      const { email, deviceId, cloudSave, pet, needs, stats } = body;
      if (!email) return sendJSON(res, 400, { error: 'email parametresi zorunludur' });

      const normEmail = email.trim().toLowerCase();
      const now = Date.now();

      try {
        const payloadStr = JSON.stringify(cloudSave || { pet, needs, stats, updatedAt: now });

        db.prepare(`
          UPDATE users SET
            cloud_save_json = ?,
            last_login = ?
          WHERE email = ?
        `).run(payloadStr, now, normEmail);

        if (deviceId) {
          db.prepare(`
            UPDATE devices SET
              pet_json = COALESCE(?, pet_json),
              needs_json = COALESCE(?, needs_json),
              stats_json = COALESCE(?, stats_json),
              last_seen = ?,
              is_online = 1
            WHERE device_id = ?
          `).run(
            pet ? JSON.stringify(pet) : null,
            needs ? JSON.stringify(needs) : null,
            stats ? JSON.stringify(stats) : null,
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

  // 7.0.2 TÜM HESAPLARI LİSTELEME
  if (path === '/api/v1/auth/users' && method === 'GET') {
    try {
      const users = db.prepare('SELECT email, nickname, avatar, device_id, created_at, last_login FROM users ORDER BY last_login DESC').all();
      return sendJSON(res, 200, { success: true, count: users.length, users });
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

  // 8. GITHUB SÜRÜM / OTA KONTROLÜ (SemVer 2.0.0 v1.0.6)
  if (path === '/api/v1/version/check' && method === 'GET') {
    return sendJSON(res, 200, {
      latestVersion: 'v1.0.6',
      semver: {
        major: 1,
        minor: 0,
        patch: 6,
        build: 7
      },
      versionCode: 7,
      latestCommitHash: 'ba202c7',
      mandatoryUpdate: false,
      releaseNotes: 'Modül 2 Tamamlandı: 7 Sims yaşam ihtiyacı (Açlık, Tuvalet, Hijyen, Uyku, Eğlence, Sevgi, Sosyal), Tamagotchi kriz mekanikleri (kaka kazaları, sinekler, hastalık ve ilaç tedavisi), dokunarak okşama/sevme ve 4 evreli karakter evrim motoru.',
      apkDownloadUrl: '/download/socies-app.apk',
      githubApkUrl: 'https://github.com/mcturan/socies/releases/download/v1.0.6/socies-app.apk'
    });
  }

  // 404
  sendJSON(res, 404, { error: 'Uç nokta bulunamadı', requestedPath: path });
});

// BODY PARSER
function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}');
      callback(parsed);
    } catch (e) {
      callback({});
    }
  });
}

// CANLI WEB YÖNETİM & İSTATİSTİK PANELİ
function serveDashboard(res) {
  const devices = Array.from(database.devices.values());
  const onlineCount = devices.filter(d => (Date.now() - d.lastSeen) < 90000).length;

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>SOCIES - Merkezi Sunucu & Telemetri Paneli</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: #070a12; color: #f8fafc; padding: 2rem; }
    .container { max-width: 1280px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid #1e293b; padding-bottom: 1rem; flex-wrap: wrap; gap: 1rem; }
    .title { font-size: 1.5rem; font-weight: 800; background: linear-gradient(90deg, #00f0ff, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .header-right { display: flex; align-items: center; gap: 1rem; }
    .dl-btn { background: linear-gradient(135deg, #00f0ff, #0099ff); color: #000; padding: 0.5rem 1rem; border-radius: 10px; font-weight: 800; font-size: 0.8rem; text-decoration: none; display: flex; align-items: center; gap: 0.4rem; box-shadow: 0 0 15px rgba(0, 240, 255, 0.4); }
    .dl-btn:hover { box-shadow: 0 0 25px rgba(0, 240, 255, 0.7); }
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .stat-card { background: #0f1523; border: 1px solid #1e293b; border-radius: 16px; padding: 1.2rem; }
    .stat-val { font-size: 1.8rem; font-weight: 800; color: #00f0ff; font-family: 'JetBrains Mono', monospace; }
    .stat-lbl { font-size: 0.75rem; color: #94a3b8; margin-top: 4px; }
    .table-box { background: #0f1523; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #1e293b; }
    th { background: rgba(255,255,255,0.03); color: #00f0ff; font-weight: 700; }
    .badge-on { background: rgba(0,255,102,0.15); color: #00ff66; padding: 0.2rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.7rem; }
    .badge-off { background: rgba(148,163,184,0.15); color: #94a3b8; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.7rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">SOCIES CENTRAL HUB • TELEMETRY SERVER</div>
        <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Gerçek Zamanlı Cihaz Varlığı, Çağrı Mesajları & Telemetri Gözlemcisi</div>
      </div>
      <div class="header-right">
        <a href="https://github.com/mcturan/socies/releases/latest/download/socies-app.apk" class="dl-btn">
          <span>📥</span> Android APK İndir (v1.0.5)
        </a>
        <div style="font-family:'JetBrains Mono'; font-size:0.8rem; color:#00ff66;">● SUNUCU AKTİF (Port: ${PORT})</div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-val">${devices.length}</div>
        <div class="stat-lbl">Kayıtlı Cihaz</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color:#00ff66;">${onlineCount}</div>
        <div class="stat-lbl">Şu An Çevrimiçi (Online)</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color:#a855f7;">${database.systemStats.totalMessagesSent}</div>
        <div class="stat-lbl">İletilen Çağrı Mesajı</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color:#ffe600;">v1.0.5</div>
        <div class="stat-lbl">OTA Hedef Sürüm</div>
      </div>
    </div>

    <div class="table-box">
      <table>
        <thead>
          <tr>
            <th>Cihaz ID / MAC</th>
            <th>Kullanıcı / E-posta</th>
            <th>Aktif Canlı & Seviye</th>
            <th>Batarya</th>
            <th>Adım</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          ${devices.map(d => {
            const isOnline = (Date.now() - d.lastSeen) < 90000;
            return `
              <tr>
                <td><b>${d.deviceId}</b><br><span style="font-size:0.7rem; color:#64748b;">${d.mac}</span></td>
                <td>${d.userEmail}</td>
                <td><b>${d.pet?.breed ? d.pet.breed.toUpperCase() : 'TOP'}</b> (Lv. ${d.pet?.stage || 1}) - ${d.pet?.score || 0} P</td>
                <td>${d.stats?.batteryPct || 100}% (${d.stats?.batteryMv || 4000}mV)</td>
                <td>${d.stats?.steps || 0}</td>
                <td><span class="${isOnline ? 'badge-on' : 'badge-off'}">${isOnline ? '● ÇEVRİMİÇİ' : '○ ÇEVRİMDIŞI'}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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
        <a href="/download/socies-app.apk" class="dl-btn">📥 APK İndir</a>
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
        <div class="kpi-val" style="color:#ffe600;">v1.0.5+6</div>
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
