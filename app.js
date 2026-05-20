const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { initDatabase, db } = require('./database');
const whatsappService = require('./services/whatsapp-service');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const fs = require('fs');

function normalizeStr(v) {
  if (typeof v !== 'string') return v;
  try { return v.normalize('NFC'); } catch (e) { return v; }
}

const app = express();
// When running behind a reverse proxy (nginx), trust the proxy so req.protocol is correct
app.set('trust proxy', true);
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
let PORT = Number(process.env.PORT || 3000);
// When running integration tests inside ephemeral containers the test harness
// sets PORT=0 which can lead to a race where server.address() is not yet
// available for the test. Allow forcing a stable port in the container via
// DOCKER_TEST_FIX=1 so tests run reliably in CI/docker dev.
if (process.env.DOCKER_TEST_FIX === '1' && PORT === 0) {
  PORT = 3000;
}

// HTTP Keep-Alive tuning for long-lived WhatsApp connections
server.keepAliveTimeout = 120000; // 120 seconds (was 5s default)
server.headersTimeout = 125000; // 125 seconds (must be > keepAliveTimeout)

// Veritabanını başlat
initDatabase();
whatsappService.ensureEquipmentReminderScheduler();

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

// Ensure a default admin user exists in DB (ENV: ADMIN_USER, ADMIN_PASS)
(function ensureDefaultAdminInDb() {
  try {
    const username = normalizeStr(process.env.ADMIN_USER || 'admin');
    const password = normalizeStr(process.env.ADMIN_PASS || 'admin');
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      INSERT INTO users (username, password, full_name, role, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(username) DO UPDATE SET
        password = excluded.password,
        full_name = excluded.full_name,
        role = excluded.role
    `).run(username, hash, 'Admin', 'admin');
    console.log('[AUTH] Varsayılan admin hazırlandı (DB):', username);
  } catch (e) {
    console.error('Default admin creation failed:', e.message);
  }
})();

// Session middleware
// Use SQLite-backed session store so sessions survive server restarts
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : '/data';
fs.mkdirSync(dataDir, { recursive: true });
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: dataDir,
    concurrentDB: true
  }),
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Authentication helpers
function findUserByUsername(username) {
  const norm = normalizeStr(String(username || ''));
  try {
    return db.prepare('SELECT id, username, password as passwordHash, full_name as fullName, role FROM users WHERE username = ? COLLATE NOCASE OR username = ?').get(norm, String(username || ''));
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  // In CI/dev container tests we may want to bypass auth to exercise routes.
  if (process.env.DISABLE_AUTH_FOR_TESTS === '1') return next();
  if (req.session && req.session.user) return next();
  // Save original url to return after login
  req.session.returnTo = req.originalUrl || req.url;
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (process.env.DISABLE_AUTH_FOR_TESTS === '1') return next();
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).render('403', { message: 'Erişim reddedildi' });
}

// io'yu app.locals'a kaydet
app.locals.io = io;

// Basarili veri degisikliklerinde tum istemcilere genel guncelleme eventi yayinla.
app.use((req, res, next) => {
  const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((req.method || '').toUpperCase());
  if (!isMutatingMethod) {
    return next();
  }

  const requestPath = String(req.path || req.originalUrl || '').toLowerCase();
  const skipLiveRefreshBroadcast = requestPath.startsWith('/whatsapp') || requestPath.endsWith('/demirbas-sorun-coz');

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
  res.locals.user = req.session && req.session.user ? req.session.user : {
    id: null,
    username: 'system',
    fullName: 'Sistem',
    role: 'system'
  };
  res.locals.currentPath = req.path;
  next();
});

// Login routes
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const normUsername = normalizeStr(String(username || ''));
  const normPassword = normalizeStr(String(password || ''));

  const user = findUserByUsername(normUsername);
  if (!user) {
    return res.render('login', { error: 'Geçersiz kullanıcı adı veya şifre' });
  }

  // Backwards-compatible password check: try normalized password first, then raw password
  let ok = false;
  try {
    ok = bcrypt.compareSync(normPassword, String(user.passwordHash || ''));
  } catch (_) { ok = false; }
  if (!ok) {
    try {
      ok = bcrypt.compareSync(String(password || ''), String(user.passwordHash || ''));
    } catch (_) { ok = ok || false; }
  }
  if (!ok) {
    return res.render('login', { error: 'Geçersiz kullanıcı adı veya şifre' });
  }

  req.session.user = { id: user.id, username: user.username, fullName: user.fullName || user.username, role: user.role || 'user' };
  const redirectTo = req.session.returnTo || '/dashboard';
  delete req.session.returnTo;
  return res.redirect(redirectTo);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

// Route'lar (kimlik doğrulama gerektirir)
app.use('/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/odalar', requireAuth, require('./routes/rooms'));
app.use('/personel', requireAuth, require('./routes/personnel'));
app.use('/giris-cikis', requireAuth, require('./routes/entries'));
app.use('/rapor-olustur', requireAuth, require('./routes/reports'));
app.use('/gecmis', requireAuth, require('./routes/history'));
app.use('/notlar', requireAuth, require('./routes/notes'));
app.use('/esya-takip', requireAuth, require('./routes/equipment'));
app.use('/ziyaretciler', requireAuth, require('./routes/visitors'));
app.use('/yangin-alarm', requireAuth, require('./routes/alarms'));
// WhatsApp API endpoints can remain public for callbacks if necessary
app.use('/whatsapp', require('./routes/whatsapp'));

// Admin-only user management
app.use('/users', requireAuth, requireAdmin, require('./routes/user-management'));

// Legacy auth URL compatibility -> redirect to new routes
app.get('/giris', (req, res) => res.redirect('/login'));
app.post('/giris', (req, res) => res.redirect('/login'));
app.get('/cikis', (req, res) => res.redirect('/logout'));

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

server.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
    if (localIP !== 'localhost') break;
  }
  
  console.log(`Lojman Dashboard çalışıyor:`);
  console.log(`  Yerel: http://localhost:${PORT}`);
  console.log(`  Ağ: http://${localIP}:${PORT}`);
});

module.exports = { app, io, server };
