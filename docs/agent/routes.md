# Route Catalog

## Mount Points (app.js)

- /dashboard -> routes/dashboard
- /notlar -> routes/notes
- /odalar -> routes/rooms
- /personel -> routes/personnel
- /giris-cikis -> routes/entries
- /rapor-olustur -> routes/reports
- /gecmis -> routes/history
- /esya-takip -> routes/equipment
- /ziyaretciler -> routes/visitors
- /yangin-alarm -> routes/alarms
- /kullanicilar -> routes/users

Not: routes/auth.js icin app.js tarafinda mount gorunmuyor.

## Endpoint Ozeti

- routes/dashboard.js
  - GET /
- routes/rooms.js
  - GET /
  - POST /
  - GET /:id
  - POST /:id/personel-ata
  - POST /:id/guncelle
  - POST /:id/musaitlik-guncelle
  - POST /:id/sil
  - POST /:id/sorun-ekle
  - POST /:id/demirbas-sorun-ekle
  - POST /:id/demirbas-sorun-coz
  - POST /:id/sorun/:issueId/guncelle
  - POST /:id/sorun/:issueId/sil
  - POST /:id/envanter-ekle
  - POST /:id/envanter/:itemId/guncelle
  - POST /:id/envanter/:itemId/sil
  - POST /:id/envanter/:itemId/eksik
  - POST /:id/personel-ekle
- routes/personnel.js
  - GET /
  - POST /:id/oda-ata
  - POST /ekle
  - POST /ekle-ve-ata
  - GET /:id
  - POST /:id/guncelle
  - POST /:id/oda-degistir
  - POST /:id/cikis
  - POST /:id/sil
  - POST /:id/sikayet-ekle
  - POST /:id/sikayet/:complaintId/duzenle
  - POST /:id/sikayet/:complaintId/sil
- routes/entries.js
  - GET /
  - POST /ekle
  - POST /:id/guncelle
  - POST /:id/sil
- routes/equipment.js
  - GET /
  - POST /ekle
  - POST /:id/durum
  - POST /esya-ekle
  - POST /esya-sil
  - POST /:id/iade
  - POST /:id/kayip
  - POST /:id/sil
- routes/reports.js
  - GET /
  - GET /anahtar-eksikleri
  - GET /anlik-konaklayanlar
  - GET /oda-sorunlari
  - GET /oda-sorunlari/excel
  - GET /anahtar-eksikleri/excel
  - GET /anlik-konaklayanlar/excel
  - GET /personel-sikayetleri
  - GET /personel-sikayetleri/excel
- routes/history.js
  - GET /
- routes/users.js
  - GET /
  - POST /ekle
  - POST /:id/sifre-degistir
  - POST /:id/sil
- routes/visitors.js
  - GET /
  - POST /ekle
  - POST /:id/cikis
  - POST /:id/guncelle
- routes/alarms.js
  - GET /
  - POST /ekle
  - POST /:id/sil
- routes/auth.js
  - GET /giris
  - POST /giris
  - GET /cikis

## Debug Ipuclari

- Session'a bagli logActivity cagrilari bircok route'ta var; req.session.user yoksa hata riski yuksek.
- personnel ve rooms route'lari en fazla yan etkiye sahip moduller.
- POST /rooms ve POST /personel akislarinda oda kapasite ve anahtar stogu bir arada etkilenir.
