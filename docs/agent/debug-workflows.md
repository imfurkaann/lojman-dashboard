# Debug Workflows for Agents

## Workflow 1: Session/Auth Bug
1. app.js middleware sirasini oku.
2. req.session atamalarini tum kodda ara.
3. routes/auth.js mount durumunu dogrula.
4. En az degisiklikle auth akisini duzelt.
5. Dashboard, users, personnel akislarini regresyon acisindan test et.

## Workflow 2: Personnel-Room Inconsistency
1. Problemli personel id ve room id ile akis cikar.
2. rooms.js + personnel.js helper farklarini karsilastir.
3. room_inventory ve personnel status kayitlarini birlikte kontrol et.
4. Cakisan kosullari tek helper altinda birlestir.
5. room status, key stock ve issue kayitlari icin after-state dogrula.

## Workflow 3: Photo Path Failure
1. DB photo_path degerini al.
2. normalizePhotoPath cikisini hesapla.
3. public klasoru altinda dosyanin fiziksel varligini kontrol et.
4. Docker ise volume ve mount path kontrolu yap.
5. Tek format path standardi belirle ve backward-compat adimi ekle.

## Workflow 4: Migration Incident
1. Hata veren migration blokunu izole et.
2. Etkilenen tablo icin backup alinmadan degisiklik yapma.
3. Migrations'i transaction ile calisacak sekilde parcala.
4. Post-migration tutarlilik sorgulari calistir.
5. Rollback notlarini ve recovery adimlarini belgeye ekle.

## Workflow 5: Route-Level 500 Error
1. Hata endpointini belirle.
2. Req body/params/session bagimliliklarini kontrol et.
3. DB sorgularini tek tek replay et.
4. Null checks ve user-facing hata mesajlarini netlestir.
5. Ayni endpoint icin minimum bir negatif test senaryosu ekle.
