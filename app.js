const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { initDatabase } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = Number(process.env.PORT || 3000);

// Veritabanını başlat
initDatabase();

// EJS template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Socket.IO
const verboseSocketLogs = process.env.SOCKET_LOGS === '1';
io.on('connection', (socket) => {
  if (verboseSocketLogs) {
    console.log('İstemci bağlandı:', socket.id);
  }
  
  socket.on('disconnect', () => {
    if (verboseSocketLogs) {
      console.log('İstemci ayrıldı:', socket.id);
    }
  });
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// io'yu app.locals'a kaydet
app.locals.io = io;

// Basarili veri degisikliklerinde tum istemcilere genel guncelleme eventi yayinla.
app.use((req, res, next) => {
  const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((req.method || '').toUpperCase());
  if (!isMutatingMethod) {
    return next();
  }

  const requestPath = String(req.path || req.originalUrl || '').toLowerCase();
  const skipLiveRefreshBroadcast = requestPath.endsWith('/demirbas-sorun-coz');

  res.on('finish', () => {
    // Yalnizca basarili yanitlardan sonra yayinla.
    const skipByHeader = String(res.getHeader('X-Skip-Live-Refresh') || '').toLowerCase() === '1';
    if (!skipLiveRefreshBroadcast && !skipByHeader && res.statusCode >= 200 && res.statusCode < 400 && req.app && req.app.locals && req.app.locals.io) {
      req.app.locals.io.emit('app:data-changed', {
        method: req.method,
        path: req.originalUrl || req.url,
        ts: Date.now()
      });
    }
  });

  next();
});

// Global template değişkenleri
app.use((req, res, next) => {
  res.locals.user = {
    id: null,
    username: 'system',
    fullName: 'Sistem',
    role: 'system'
  };
  res.locals.currentPath = req.path;
  next();
});

// Route'lar
// Application routes (no authentication)
app.use('/dashboard', require('./routes/dashboard'));
app.use('/odalar', require('./routes/rooms'));
app.use('/personel', require('./routes/personnel'));
app.use('/giris-cikis', require('./routes/entries'));
app.use('/rapor-olustur', require('./routes/reports'));
app.use('/gecmis', require('./routes/history'));
app.use('/esya-takip', require('./routes/equipment'));
app.use('/ziyaretciler', require('./routes/visitors'));
app.use('/yangin-alarm', require('./routes/alarms'));

// Legacy auth URL compatibility
app.get('/giris', (req, res) => res.redirect('/dashboard'));
app.post('/giris', (req, res) => res.redirect('/dashboard'));
app.get('/cikis', (req, res) => res.redirect('/dashboard'));

// Ana sayfa yönlendirmesi
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`[HATA] Port ${PORT} zaten kullanımda.`);
    console.error('[INFO] Docker konteyneri çalışıyorsa önce `docker compose down` komutunu çalıştırın.');
    console.error('[INFO] Alternatif olarak farklı port ile başlatın: PowerShell -> `$env:PORT=3001; npm start`');
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`Lojman Dashboard çalışıyor: http://localhost:${PORT}`);
});

module.exports = { app, io, server };
