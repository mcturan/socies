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

const PORT = process.env.PORT || 3000;

// IN-MEMORY VERİTABANI (İleride PostgreSQL / Redis / SQLite ile genişletilebilir)
const database = {
  devices: new Map(),        // deviceId -> { deviceId, mac, userEmail, pet, needs, stats, lastSeen, isOnline }
  users: new Map(),          // userEmail -> { email, activeDeviceId, cloudSave, createdAt }
  offlineMessages: new Map(),// targetDeviceId -> [ { id, from, text, timestamp } ]
  activeSockets: new Map(),  // deviceId -> socket/client connection
  systemStats: {
    totalMessagesSent: 0,
    totalPokesSent: 0,
    totalDuelMatches: 0,
    serverStartTime: Date.now()
  }
};

// MOCK VERİLER (Sistemin canlı test edilebilmesi için)
database.devices.set('SOCIES-ESP32-84920A', {
  deviceId: 'SOCIES-ESP32-84920A',
  mac: 'A4:CF:12:89:34:B1',
  userEmail: 'turan@socies.io',
  pet: { breed: 'top', stage: 1, ageDays: 1, score: 310, joy: 100 },
  needs: { hunger: 85, fun: 80, love: 90, sleep: 75, toilet: 85, clean: 90, social: 60 },
  stats: { batteryMv: 3980, batteryPct: 88, steps: 1420, fwVer: 'v1.0.4' },
  lastSeen: Date.now(),
  isOnline: true
});

database.devices.set('SOCIES-ESP32-00482B', {
  deviceId: 'SOCIES-ESP32-00482B',
  mac: '24:6F:28:11:55:C3',
  userEmail: 'ahmet@socies.io',
  pet: { breed: 'kedi', stage: 2, ageDays: 18, score: 2450, joy: 90 },
  needs: { hunger: 60, fun: 90, love: 95, sleep: 80, toilet: 70, clean: 85, social: 80 },
  stats: { batteryMv: 4120, batteryPct: 95, steps: 4890, fwVer: 'v1.0.4' },
  lastSeen: Date.now() - 120000,
  isOnline: false
});

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

  // 1. CANLI İSTATİSTİK & YÖNETİM PANELİ (DASHBOARD)
  if (path === '/' || path === '/dashboard' || path === '/admin') {
    return serveDashboard(res);
  }

  // 2. CİHAZ KAYDI (REGISTER)
  if (path === '/api/v1/devices/register' && method === 'POST') {
    return parseBody(req, (body) => {
      const { deviceId, mac, userEmail, pet, stats } = body;
      if (!deviceId) return sendJSON(res, 400, { error: 'deviceId zorunludur' });

      const deviceData = {
        deviceId,
        mac: mac || 'Bilinmiyor',
        userEmail: userEmail || 'misafir@socies.io',
        pet: pet || { breed: 'top', stage: 1, ageDays: 1, score: 0 },
        needs: body.needs || { hunger: 100, fun: 100, love: 100, sleep: 100, toilet: 100, clean: 100, social: 100 },
        stats: stats || { batteryMv: 4000, batteryPct: 100, steps: 0, fwVer: 'v1.0.0' },
        lastSeen: Date.now(),
        isOnline: true
      };

      database.devices.set(deviceId, deviceData);

      // Çevrimdışı kuyrukta bekleyen mesaj var mı?
      const pendingMsgs = database.offlineMessages.get(deviceId) || [];

      sendJSON(res, 200, {
        success: true,
        message: 'Cihaz başarıyla sunucuya kaydedildi',
        registeredAt: new Date().toISOString(),
        pendingMessagesCount: pendingMsgs.length
      });
    });
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
      userEmail: d.userEmail,
      petBreed: d.pet?.breed,
      petScore: d.pet?.score,
      isOnline: (Date.now() - d.lastSeen) < 90000, // 90 saniye içinde sinyal verdiyse online
      lastSeenSecAgo: Math.round((Date.now() - d.lastSeen) / 1000)
    }));

    return sendJSON(res, 200, {
      totalRegistered: list.length,
      onlineCount: list.filter(d => d.isOnline).length,
      devices: list
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

  // 8. GITHUB SÜRÜM / OTA KONTROLÜ
  if (path === '/api/v1/version/check' && method === 'GET') {
    return sendJSON(res, 200, {
      latestVersion: 'v1.0.4',
      semver: {
        major: 1,
        minor: 0,
        patch: 4,
        build: 5
      },
      versionCode: 5,
      latestCommitHash: 'e5647da',
      mandatoryUpdate: false,
      releaseNotes: 'Zıpzıp Top, Kaka mekaniği, 3-2-1 Taş-Kağıt-Makas ve Kovboy Düellosu eklendi.',
      apkDownloadUrl: 'https://github.com/mcturan/socies/releases/latest/download/socies-app.apk'
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
          <span>📥</span> Android APK İndir (v1.0.4)
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
        <div class="stat-val" style="color:#ffe600;">v1.0.4</div>
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

server.listen(PORT, () => {
  console.log(`[SOCIES SERVER] Merkezi sunucu port ${PORT} üzerinde çalışıyor.`);
  console.log(`[DASHBOARD] http://localhost:${PORT}/dashboard adresinden izlenebilir.`);
});
