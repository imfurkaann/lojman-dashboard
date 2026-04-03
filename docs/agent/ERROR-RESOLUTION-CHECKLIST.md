# 🔍 HATA ÇÖZÜM KONTROL LİSTESİ (Priority Order)

**Kullanım**: Agent bu listeyi takip ederek hataları nokta-atışı çözmelidir.  
**Tamamlama**: Her item'ı çözdükten sonra ✅ ile işaretle.

**Meta Information**:
- **Last Updated**: April 3, 2026
- **Status**: v2.0 - Comprehensive with detailed guides
- **Reference Docs**: See copilot-instructions.md and .github/AGENTS.md
- **Entry Point**: docs/agent/INDEX.md

---

## PHASE 1: KRITIK HATALAR (P0) - BLAKER
Sistem başlangıcı ve auth sorunları.

### P0.1 - `req.session.user` Hardcode Sorunu
- **Sorun**: app.js veya routes'lar sırasında session'a hardcode user ataması
- **Etki**: Tüm requests admin gibi gösterilebilir
- **Dosya**: `app.js`, `routes/auth.js`
- **Arama Sorgusu**:
  ```javascript
  req.session.user = {
  ```
- **Kontrol Noktaları**:
  - [ ] Auth middleware doğru çalışıyor mu?
  - [ ] Login endpoint session atıyor mu?
  - [ ] Role-based routing ayarlanmış mı?
  - [ ] Test: Admin olmayan user login edebiliyor mu?
- **Fix**: `middleware/auth.js` kontrol et, session management düzelt

---

### P0.2 - Database Migration Hataları
- **Sorun**: Migrations sırasında schema eksik/yanlış
- **Etki**: Table/column not found, app crash
- **Dosya**: `database.js` (`initDatabase()`)
- **Kontrol Noktaları**:
  - [ ] DB_PATH env değişkeni set mi?
  - [ ] SQLite dosyası create olmuş mu?
  - [ ] Tüm foreign key constraints tanımlı mı?
  - [ ] Migration script hata vermezse durdur
- **Fix**: `database.js` → initDatabase() section'ı audit et

---

### P0.3 - Session/Auth Middleware Mount
- **Sorun**: Routes tanımlı ancak middleware ile korunmamış
- **Etki**: Protected routes public erişime açık
- **Dosya**: `app.js`, `routes/*.js`
- **Kontrol Noktaları**:
  - [ ] Express session config ayarlanmış mı?
  - [ ] Auth middleware exports ayarlanmış mı?
  - [ ] app.use() ile middleware mount edildi mi?
  - [ ] Routes doğru protect ediliyor mu?
- **Fix**: `middleware/auth.js` + `app.js` integration kontrol

---

## PHASE 2: YÜKSEK ÖNCELİKLİ HATALAR (P1) - MAJOR
Iş mantığı ve veri tutarlılığı sorunları.

### P1.1 - Personel-Oda-Zimmet Sync Hatası
- **Sorun**: Personel, oda, ve envanter sorunları arasında tutarsızlık
- **Etki**: Dummy zimmet sorunları, yanlış kapasiteler
- **Dosya**: `routes/personnel.js`, `routes/rooms.js`, `database.js`
- **Kontrol Noktaları**:
  - [ ] `syncRoomKeyStock()` hata yapıyor mu?
  - [ ] Key stock transactions atomic mı?
  - [ ] `syncHandoverIssuesForRoom()` tüm cases handle ediyor mu?
  - [ ] Zimmet sorunu çözüldüğünde inventory update oluyor mu?
- **Symptom Testler**:
  - [ ] Personel atanırken key stock azalıyor mu?
  - [ ] Personel çıkışta key stock artıyor mu?
  - [ ] Bozuk zimmet atanırken oda inventory güncellenmiyor mu?
- **Fix**: `database.js` sync fonksiyonları + transaction audit

---

### P1.2 - Fotoğraf Path Normalize Sorunları
- **Sorun**: Photo path'ler inconsistent format (\\, /, uploads/)
- **Etki**: Personel detayında foto görünmüyor, broken <img src>
- **Dosya**: `routes/personnel.js` (`normalizePhotoPath()`)
- **Kontrol Noktaları**:
  - [ ] Upload path standart mi? (`public/uploads/personnel/`)
  - [ ] Normalize fonksiyonu tüm formatları handle ediyor mu?
  - [ ] DB'deki photo_path leri migrate etmek gerekiyor mu?
  - [ ] Browser'da tarayıcı network tab'ında 404 var mı?
- **Fix**: `normalizePhotoPath()` refactor + Photo path migration script

---

### P1.3 - Duplicate Helper Logics
- **Sorun**: `personnel.js` ve `rooms.js`'de aynı fonksiyonlar tekrar yazılı
- **Etki**: State diverge, capacity hesaplama farklı
- **Dosya**: 
  - `routes/personnel.js`: `isRoomAtCapacity()`, `getAvailableRooms()`
  - `routes/rooms.js`: Aynı fonksiyonlar
- **Kontrol Noktaları**:
  - [ ] Helper fonksiyonları identify et (grep)
  - [ ] Farklı implementations tespit et
  - [ ] Merkeze almak mümkün mü?
- **Fix**: Shared helpers module oluştur, `lib/room-helpers.js`

---

### P1.4 - Large Migration Blocks
- **Sorun**: `database.js`'deki dev.exec() blokları çok büyük
- **Etki**: Migration hata sırasında veri tarafsızlığı riski
- **Dosya**: `database.js` (initDatabase section)
- **Kontrol Noktaları**:
  - [ ] Her table creation ayrı mı?
  - [ ] Hata sırasında rollback mü yoksa partial state mı?
  - [ ] Index ve constraint'ler defined mi?
- **Fix**: SQL migrations'ı separate dosyalara bölünüştür

---

## PHASE 3: ORTA ÖNCELİKLİ HATALAR (P2) - MEDIUM
Performans ve edge-case sorunları.

### P2.1 - Reports Export Performance
- **Sorun**: Büyük veri setlerinde Excel export çok yavaş
- **Etki**: Timeout, UI hang
- **Dosya**: `routes/reports.js`
- **Kontrol Noktaları**:
  - [ ] Memory leak var mı (streaming?)?
  - [ ] Pagination yapılıyor mu?
  - [ ] Batch process ediyor mu?
- **Test**: 10k+ personel ile export test et

---

### P2.2 - Session Dependent logActivity
- **Sorun**: `logActivity(...)` session.user.id assume ediyor
- **Etki**: Session null ise logActivity crash edebilir
- **Dosya**: `database.js` + `routes/*.js`
- **Kontrol Noktaları**:
  - [ ] logActivity null user handle ediyor mu?
  - [ ] Tüm route handlers getSafeUserId() kullanıyor mu?
- **Fix**: Safe wrapper function yap

---

### P2.3 - Socket.IO Broadcast Inconsistencies
- **Sorun**: Emit event'leri tüm client'lara ulaşmıyor
- **Etki**: Real-time updates stale kaliyor
- **Dosya**: `app.js` (socket emit), `routes/*.js` (emit calls)
- **Kontrol Noktaları**:
  - [ ] Socket connection active mi?
  - [ ] Event name'ler consistent mi?
  - [ ] Network firewall blocking mi (Docker)?
- **Test**: Container'dan websocket connection test et

---

## PHASE 4: QA VE REGRESSION
Final validation ve test.

### P3.1 - Integration Test Suite
- [ ] Auth flow: login → protected resource → logout
- [ ] Personnel Workflow: Create → Assign Room → Checkout → Reassign
- [ ] Room Handover: Check broken items → Resolve → Verify
- [ ] Reports: Generate → Export → Verify data

### P3.2 - Regression Tests
- [ ] Personel ekle → fotoğraf upload
- [ ] Oda tahsis → key stock sync
- [ ] Zimmet sorun kayıt → artı zimmet sorun çöz
- [ ] Rapor üret → Excel export

### P3.3 - Stress Tests
- [ ] 100+ personel ile capacity test
- [ ] 50+ oda sorun kaydı ile archive test
- [ ] 1000+ log entry ile report export performans

---

## PHASE 5: DEPLOYMENT
Production-ready kontroller.

### Pre-Deployment Checklist
- [ ] Environment variables: DB_PATH, PORT, NODE_ENV
- [ ] Database schema current mi?
- [ ] Docker build clean pass mi?
- [ ] All routes mounted and protected?
- [ ] Static files (photos, CSS, JS) serve ediyor mu?
- [ ] Socket.IO CORS allow ediyor mu?
- [ ] Log rotation ayarlanmış mı?

---

## NOTES FOR AGENTS

**Workflow**:
1. P0 hataları fix et → RESTART APP
2. P1 hataları fix et → TEST ALL FLOWS
3. P2 hataları fix et → PERFORMANCE TEST
4. QA & Regression → DEPLOYMENT

**For Each Bug**:
1. Read critical-bugs-detailed.md
2. Use test-validation-matrix.md
3. Check provided code snippets
4. Run command sequences in terminal
5. Verify with integration tests
6. Update this checklist ✅

**Example Agent Flow**:
```
Agent: P0.1 hatasını oku → TERMINAL: grep "req.session.user =" app.js routes/auth.js
→ Analiz → CODE EDIT → Terminal test → Update checklist ✅
```
