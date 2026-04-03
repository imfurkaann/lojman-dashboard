# Troubleshooting Matrix

## App Acilmiyor
- Local:
  - PORT cakismasini kontrol et.
  - npm install sonra npm start dene.
- Docker:
  - docker compose up --build ile yeniden baslat.
  - container loglarinda startup ve migration hatalarini kontrol et.

## DB Sorunlari
- Belirti: startup crash, migration hatasi, tablo/kolon bulunamadi
- Kontrol:
  - DB_PATH dogru mu?
  - volume mount dogru mu?
  - sqlite dosyasi yazilabilir mi?

## Foto Goruntulenmiyor
- Belirti: personel detayda kirik gorsel
- Kontrol:
  - public/uploads/personnel icinde dosya var mi?
  - DB'deki photo_path hangi formatta?
  - normalizePhotoPath ciktisi tarayicida ulasilabilir mi?

## Auth Beklendigi Gibi Calismiyor
- Belirti: login/rol etkisiz
- Kontrol:
  - app.js icinde req.session hardcode kontrolu
  - routes/auth.js mount edilmis mi?
  - middleware/auth route'larda kullaniliyor mu?

## Raporlar ve Socket.IO
- Belirti: rapor ekrani stale kaliyor
- Kontrol:
  - report:refresh event emit edilen kod yollari
  - browser tarafinda socket baglantisi
  - container/network tarafinda websocket engeli

## Hizli Komutlar
- Local run: npm start
- Docker run: docker compose up -d --build
- Docker logs: docker logs lojman-dashboard
- Stop: docker compose down
