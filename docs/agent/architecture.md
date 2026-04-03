# Architecture

## Tech Stack
- Runtime: Node.js + Express
- Template: EJS
- DB: better-sqlite3 (SQLite)
- Realtime: Socket.IO
- Upload: multer
- Export: exceljs

## Ana Akis
1. app.js Express serveri baslatir.
2. initDatabase() startup aninda sema/migration calistirir.
3. Route modulleri istekleri alir ve DB sorgulari yapar.
4. EJS view render edilir veya redirect donebilir.
5. Bazi islemler Socket.IO ile report:refresh event'i yayar.

## Kritik Katmanlar
- app.js:
  - global middleware sirasi
  - static serving (public)
  - route mount noktasi
  - 404 ve server error handling
- routes/*:
  - domain mantigi (oda, personel, envanter, rapor)
- database.js:
  - tablo olusumu, migration, helper fonksiyonlar
- middleware/*:
  - auth kontrolu ve TC sifreleme yardimcilari

## Dikkat Gerektiren Mimari Noktalar
- app.js icinde session nesnesi request bazinda sabit admin olarak atanmis.
- routes/auth.js mevcut olmasina ragmen app.js icinde route olarak mount edilmemis.
- auth middleware dosyasi var ancak route seviyesinde zorunlu uygulama gorunmuyor.
- personnel.js ve rooms.js icinde benzer helper fonksiyonlar ciftli olarak bulunuyor.

## Realtime Notlari
- Socket.IO baglantisi app.js tarafinda aciliyor.
- rooms/personnel kaynakli degisikliklerde report:refresh eventleri emit ediliyor.
- Event semasi sade; auth bazli kanal ayrimi yok.
