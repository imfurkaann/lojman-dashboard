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
const PORT = 3000;

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

// io'yu app.locals'a kaydet
app.locals.io = io;

// Global template değişkenleri
app.use((req, res, next) => {
  res.locals.user = { id: 1, fullName: 'Sistem', role: 'admin' };
  res.locals.currentPath = req.path;
  // Route'larda req.session.user kullanan yerler için
  req.session = { user: { id: 1, fullName: 'Sistem', role: 'admin' } };
  next();
});

// Route'lar
app.use('/dashboard', require('./routes/dashboard'));
app.use('/odalar', require('./routes/rooms'));
app.use('/personel', require('./routes/personnel'));
app.use('/giris-cikis', require('./routes/entries'));
app.use('/gecmis', require('./routes/history'));
app.use('/esya-takip', require('./routes/equipment'));
app.use('/ziyaretciler', require('./routes/visitors'));
app.use('/yangin-alarm', require('./routes/alarms'));
app.use('/kullanicilar', require('./routes/users'));

// Ana sayfa yönlendirmesi
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

server.listen(PORT, () => {
  console.log(`Lojman Dashboard çalışıyor: http://localhost:${PORT}`);
});

module.exports = { app, io, server };
