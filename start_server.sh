#!/bin/bash
# SOCIES CENTRAL SERVER RUNNER SCRIPT
# Port: 3000
# Dashboard: http://localhost:3000/dashboard

cd /home/turan/socies

echo "================================================="
echo "  SOCIES CENTRAL TELEMETRY HUB BAŞLATILIYOR..."
echo "  Port: 3000 | Sürüm: v1.0.4+5"
echo "  Web Paneli: http://localhost:3000/dashboard"
echo "================================================="

# Mevcut çalışan sunucu varsa sonlandır
EXISTING_PID=$(lsof -t -i:3000 2>/dev/null)
if [ ! -z "$EXISTING_PID" ]; then
  echo "[BİLGİ] Port 3000 üzerinde çalışan eski işlem (PID: $EXISTING_PID) kapatılıyor..."
  kill -9 $EXISTING_PID 2>/dev/null
  sleep 1
fi

exec /usr/bin/node /home/turan/socies/server/server.js
