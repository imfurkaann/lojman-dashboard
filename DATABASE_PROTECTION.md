## 🛡️ Lojman Dashboard - VERİTABANI KORUMA & GÜVENLİĞİ

### 📊 Veritabanı Yönetimi

Lojman Dashboard veritabanı **Docker volume'leri** ile yönetilir. Bu, verilerinizin güvenli ve kalıcı olmasını sağlar.

---

## ✅ Veri Koruma Mekanizmaları

### 1️⃣ **Docker Named Volumes**
Veritabanı `lojman-db-volume` adlı Docker volume'de saklanır:
- Container silinse bile veriler korunur
- Docker tarafından merkezi olarak yönetilir
- Kolay erişilebilinir

**Volumes location:**
```
Windows: C:\ProgramData\Docker\volumes\
```

### 2️⃣ **Otomatik Yeniden Başlatma**
Docker compose, container kilitlenirse otomatik yeniden başlatır:
```yaml
restart: unless-stopped
```

### 3️⃣ **Health Check**
Sistem her 30 saniyede bir kontrol edilir:
- Uygulamaya HTTP isteği yapılır
- Başarısızsa yeniden başlatılır
- Sistem sağlığı her zaman garanti edilir

---

## 🔄 Veritabanı Yedekleme

### Otomatik Yedekleme Oluşturma

**Schindule (Windows Task Scheduler):**

1. Windows'da `Task Scheduler` açın
2. `Create Basic Task` seçin
3. Ad: `Lojman DB Yedekle - Günlük`
4. Trigger: `Günlük, 23:00`
5. Action: `Program: backup-database.bat`
6. Working directory: Proje klasörü

**PowerShell ile kurulum (Admin):**
```powershell
# Scheduled task oluştur
$action = New-ScheduledTaskAction -Execute "C:\path\to\backup-database.bat"
$trigger = New-ScheduledTaskTrigger -Daily -At 23:00
Register-ScheduledTask -TaskName "LojmanDB-Yedek" -Action $action -Trigger $trigger
```

### Manuel Yedekleme

Proje klasöründe:
1. `backup-database.bat` dosyasına çift tıklayın
2. Yedek otomatik `backups/` klasörüne kaydedilecek

**Kayıt formatı:**
```
lojman.db.backup_2026-03-29_14-30-00.tar.gz
```

---

## 🔙 Veritabanı Geri Yükleme

### El ile Geri Yükleme

1. `restore-database.bat` dosyasına çift tıklayın
2. Geri yüklenecek backup dosyasını seçin
3. Onay verin
4. Sistem otomatik yeniden başlayacak

### Komut satırı ile:
```cmd
docker run --rm ^
  -v lojman_dashboard_lojman-db-volume:/data ^
  -v backups:/backup ^
  busybox sh -c "tar xzf /backup/DOSYA_ADI.tar.gz -C /data"
```

---

## 📋 Yedek Yönetimi

### Yedekler Nereye Kaydedilir?
```
project/backups/
```

### Dosya Adlandırması
```
lojman.db.backup_YYYY-MM-DD_HH-MM-SS.tar.gz
```

### Eski Yedekleri Temizleme
Depolama tasarrufu için 3 aydan eski yedekleri silebilirsiniz:
```powershell
Get-ChildItem backups\ -Filter "*.tar.gz" | Where-Object {$_.LastWriteTime -lt (Get-Date).AddMonths(-3)} | Remove-Item
```

---

## 🆘 Acil Durumlar

### Veritabanı Dosyası Bozuldu
1. Son çalışan backup'ı tryin: `restore-database.bat`
2. İşe yaramazsa sistem yöneticiye başvurun

### Volume Silinirse
```cmd
REM Volume'ü yeniden oluştur
docker volume create lojman_dashboard_lojman-db-volume

REM Backup'tan geri yükle
docker run --rm ^
  -v lojman_dashboard_lojman-db-volume:/data ^
  -v backups:/backup ^
  busybox tar xzf /backup/BACKUP_ADI.tar.gz -C /data
```

### Docker Tamamen Kaldırılırsa
1. Docker Desktop yeniden yüklenirse volumes kaybedilebilir
2. **Mutlaka önceden backup alın!**
3. Backup varsa restore-database.bat ile geri yaklın

---

## 🔐 Veri İlkesi

| Özellik | Durum |
|---------|-------|
| **Otomatik Backup** | ❌ Hazırlamaya açık |
| **Sürüm Kontrol** | Docker volumes (git'te yok) |
| **Şifreleme** | Standard SQLite (opsiyonel) |
| **Erişim Kontrolü** | Docker volume izinleri |
| **Yedek Saklama** | Elle yönetilir |

---

## 📞 Önemli Notlar

⚠️ **VERİTABANI ÖNEMLİ VERİLER İÇERİR**
- En az aylık manual backup yapın
- Eski backup'ları güvenli yerde saklayın
- Production ortamında günlük backup planlayın
- Geri yükleme testini düzenli yapın

---

**Son güncelleme:** 29.03.2026
