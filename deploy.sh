#!/usr/bin/env bash
set -e

echo "==============================================="
echo "  LOJMAN DASHBOARD - DEPLOYMENT (http://162.19.242.35:3001)"
echo "==============================================="
echo ""

echo "[1/3] Git reposu güncelleniyor..."
git pull origin main

echo "[2/3] Docker imajı ve konteynerleri güncelleniyor..."
docker compose down
docker compose up -d --build

echo "[3/3] Konteyner durumu kontrol ediliyor..."
docker compose ps

echo ""
echo "==============================================="
echo "  ✅ DAĞITIM TAMAMLANDI!"
echo "  🌐 Canlı Adres: http://162.19.242.35:3001"
echo "==============================================="
