const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { initDatabase } = require('./database');
const authMiddleware = require('./middleware/auth');

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
io.on('connection', (socket) => {
  console.log('İstemci bağlandı:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('İstemci ayrıldı:', socket.id);
  });
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Express-session middleware (auth system)
const sessionDbPath = process.env.DB_PATH 
  ? path.join(path.dirname(process.env.DB_PATH), 'sessions.db')
  : path.join(__dirname, 'sessions.db');

app.use(session({
  store: new SqliteStore({ db: sessionDbPath }),
  secret: process.env.SESSION_SECRET || 'dev-secret-key-for-lojman-dashboard',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, 
    httpOnly: true, 
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// io'yu app.locals'a kaydet
app.locals.io = io;

// Basarili veri degisikliklerinde tum istemcilere genel guncelleme eventi yayinla.
app.use((req, res, next) => {
  const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((req.method || '').toUpperCase());
  if (!isMutatingMethod) {
    return next();
  }

  res.on('finish', () => {
    // Yalnizca basarili yanitlardan sonra yayinla.
    if (res.statusCode >= 200 && res.statusCode < 400 && req.app && req.app.locals && req.app.locals.io) {
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
  res.locals.user = req.session.user || { id: null, fullName: 'Konuk', role: null };
  res.locals.currentPath = req.path;
  next();
});

// Route'lar
// Auth routes (no middleware - login page accessible to all)
app.use('/', require('./routes/auth'));

// Protected routes (require authentication)
app.use('/dashboard', authMiddleware, require('./routes/dashboard'));
app.use('/odalar', authMiddleware, require('./routes/rooms'));
app.use('/personel', authMiddleware, require('./routes/personnel'));
app.use('/giris-cikis', authMiddleware, require('./routes/entries'));
app.use('/rapor-olustur', authMiddleware, require('./routes/reports'));
app.use('/gecmis', authMiddleware, require('./routes/history'));
app.use('/esya-takip', authMiddleware, require('./routes/equipment'));
app.use('/ziyaretciler', authMiddleware, require('./routes/visitors'));
app.use('/yangin-alarm', authMiddleware, require('./routes/alarms'));
app.use('/kullanicilar', authMiddleware, require('./routes/users'));

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
