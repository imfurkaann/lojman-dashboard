# Known Bug Hotspots

Bu liste, bug cozum sirasinda once bakilmasi gereken alanlari onceliklendirir.

## P0 - Kritik
1. app.js: request bazinda sabit req.session.user atanmasi
- Etki: gercek auth anlamsizlasir, tum islemler admin gibi gorunur.

2. app.js + routes/auth.js: auth route mount eksikligi
- Etki: login endpointleri route dosyasinda olsa da uygulamada kullanima alinmayabilir.

## P1 - Yuksek
3. routes/personnel.js ve routes/rooms.js: duplicate helper mantiklari
- Etki: kapasite/anahtar limiti hesaplamasinda davranis sapmasi.

4. routes/personnel.js: normalizePhotoPath ve upload path standardizasyonu
- Etki: foto URL kirilmalari, ortamlar arasi farkli path davranisi.

5. database.js: buyuk migration bloklari
- Etki: yarim kalan migrationlarda veri butunlugu riski.

6. session bagimli logActivity cagrilari
- Etki: session beklenmedik durumda null ise route hata verebilir.

## P2 - Orta
7. public/js/app.js: sidebar davranisi sadece belirli DOM id varsayimi ile calisiyor.
8. reports export akislarinda buyuk veri setlerinde performans baskisi.
9. personel/oda cikis ve anahtar stok senkronunda edge-case tutarsizliklari.

## Hata Ayiklama Stratejisi
1. Once auth/session akisini netlestir.
2. Sonra personel-oda-envanter bagli akislarini test et.
3. Son olarak migration ve rapor performansi konularini ele al.
