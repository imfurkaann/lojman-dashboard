## 🚀 Lojman Dashboard - Başlangıç Rehberi

### ⚙️ Ön Gereksinimler

1. **Docker Desktop Yükleme** (Windows 10/11)
   - https://www.docker.com/products/docker-desktop adresinden indirin
   - Kurulum sırasında varsayılan ayarları seçin
   - Bilgisayarı yeniden başlatın

### ▶️ Uygulamayı Başlatma

Proje klasöründe şu 2 dosyayı göreceksiniz:
- **`start-dashboard.bat`** ← Uygulamayı başlatmak için
- **`stop-dashboard.bat`** ← Uygulamayı durdurmak için

#### Başlatma Adımları:
1. `start-dashboard.bat` dosyasına **çift tıklayın**
2. Komut penceresi açılacak ve:
   - Docker Desktop başlayacak (eğer kapalıysa)
   - Sistem ayağa kalkacak
   - Tarayıcı otomatik açılacak
3. Uygulama `http://localhost:3000` adresinde çalışmaya başlayacak

#### Durdurmak İçin:
- `stop-dashboard.bat` dosyasına **çift tıklayın**
- Sistemi kapatacak

### 📌 Başlangıç Bilgileri

| Adres | Açıklama |
|-------|----------|
| `http://localhost:3000` | Uygulamanın ana adresi |

### ⚠️ Docker Yüklü Değilse?

Script açıldığında şu hatayı verirse:
```
[HATA] Docker Desktop sistemde yüklü değil!
```

1. https://www.docker.com/products/docker-desktop adresinden Docker Desktop'ı indirin
2. Kurulum yapın ve bilgisayarı yeniden başlatın
3. Tekrar deneyin

### 🔍 Sorun Giderme

**"Port 3000 zaten kullanımda" hatası alıyorsanız:**
```
Komut İsteminde (cmd) şu yazın:
netstat -ano | findstr :3000
```

Daha sonra:
```
taskkill /PID <PID> /F
```
(PID yerine bulduğunuz numarayı yazın)

### 📦 El ile Kontrolü (İleri Kullanıcılar İçin)

Windows Komut İsteminde (cmd) yazdığınız komutlar:

**Başlat:**
```cmd
docker compose up -d
```

**Durdur:**
```cmd
docker compose down
```

**Logları Görüntüle:**
```cmd
docker compose logs -f
```

---

Herhangi bir sorunla karşılaştığınızda, komut penceresindeki mesajları okuyun veya sistem yöneticisine danışın.
