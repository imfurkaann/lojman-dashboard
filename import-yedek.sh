#!/usr/bin/env bash
set -e

echo "==============================================="
echo "  LOJMAN DASHBOARD - YEDEK GERİ YÜKLEME (IMPORT)"
echo "==============================================="
echo ""

YEDEK_DIR="yedek"

if [ ! -d "$YEDEK_DIR" ]; then
  echo "❌ [HATA] '$YEDEK_DIR' klasörü bulunamadı!"
  exit 1
fi

echo "[1/5] Docker konteynerleri durduruluyor..."
docker compose down || true

echo "[2/5] Eski SQLite önbellek (WAL/SHM) dosyaları temizleniyor..."
rm -f data/lojman.db-wal data/lojman.db-shm

echo "[3/5] Veritabanı aktarılıyor (data/lojman.db)..."
mkdir -p data
if [ -f "$YEDEK_DIR/lojman.db" ]; then
  cp -f "$YEDEK_DIR/lojman.db" "data/lojman.db"
  echo "✅ lojman.db aktarıldı."
else
  echo "⚠️ yedek/lojman.db bulunamadı!"
fi

echo "[4/5] Görseller aktarılıyor (public/uploads)..."
mkdir -p public/uploads
if [ -d "$YEDEK_DIR/uploads" ]; then
  cp -rf "$YEDEK_DIR/uploads/." "public/uploads/"
  echo "✅ Görseller aktarıldı."
else
  echo "⚠️ yedek/uploads bulunamadı!"
fi

if [ -d "$YEDEK_DIR/whatsapp-auth" ]; then
  echo "WhatsApp oturumu aktarılıyor..."
  mkdir -p data/whatsapp-auth
  cp -rf "$YEDEK_DIR/whatsapp-auth/." "data/whatsapp-auth/"
fi

echo ""
echo "[5/5] Docker konteyneri başlatılıyor..."
docker compose up -d

echo ""
echo "==============================================="
echo "  ✅ YEDEK GERİ YÜKLEME TAMAMLANDI!"
echo "==============================================="
