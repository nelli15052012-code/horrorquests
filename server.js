const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static('public'));

const users = [
  { id: 'creator', username: 'creator', password: 'creator123', role: 'creator', invited: true, bookedAt: null, bookingStatus: 'approved' },
  { id: 'admin', username: 'admin', password: 'admin123', role: 'admin', invited: true, bookedAt: null, bookingStatus: 'approved' },
  { id: 'actor1', username: 'actor1', password: 'actorpass', role: 'actor', invited: true, bookedAt: null, bookingStatus: 'approved' }
];
const tokens = new Map();
const messages = { public: [], actor: [] };
const bookings = [];
const notifications = new Map();
const maxMessages = 200;
const accessWindowMs = 1000 * 60 * 60 * 4;

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sendJson(res, payload) {
  res.json(payload);
}

function getUserByToken(token) {
  if (!token) return null;
  const userId = tokens.get(token);
  return users.find((user) => user.id === userId) || null;
}

function getUserById(userId) {
  return users.find((user) => user.id === userId) || null;
}

function getUserProfile(user) {
  return {
    username: user.username,
    role: user.role,
    invited: user.invited,
    bookedAt: user.bookedAt,
    bookingStatus: user.bookingStatus || null,
    access: hasMessengerAccess(user)
  };
}

function hasMessengerAccess(user) {
  if (!user) return false;
  if (user.role === 'actor' || user.role === 'admin' || user.role === 'creator') return true;
  if (user.invited) return true;
  if (user.bookingStatus === 'approved' && user.bookedAt) return true;
  if (user.bookedAt) {
    const bookingTime = new Date(user.bookedAt).getTime();
    const delta = Math.abs(Date.now() - bookingTime);
    return delta <= accessWindowMs || (bookingTime > Date.now() && bookingTime - Date.now() <= accessWindowMs);
  }
  return false;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const user = getUserByToken(token);

  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  req.user = user;
  next();
}

function ensureAdminAccess(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'creator') {
    return res.status(403).json({ success: false, error: 'Доступ только для администраторов.' });
  }
  next();
}

function addNotification(userId, text, type = 'info') {
  const list = notifications.get(userId) || [];
  const notification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    type,
    createdAt: new Date().toISOString()
  };
  list.unshift(notification);
  notifications.set(userId, list);
  return notification;
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.trim().length < 2 || password.trim().length < 4) {
    return res.status(400).json({ success: false, error: 'Введите корректные имя и пароль.' });
  }

  const normalized = username.trim().toLowerCase();
  if (users.some((item) => item.username.toLowerCase() === normalized)) {
    return res.status(400).json({ success: false, error: 'Такой пользователь уже существует.' });
  }

  const newUser = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username: username.trim(),
    password: password.trim(),
    role: 'player',
    invited: false,
    bookedAt: null,
    bookingStatus: null
  };
  users.push(newUser);

  const token = createToken();
  tokens.set(token, newUser.id);

  return sendJson(res, {
    success: true,
    token,
    user: getUserProfile(newUser)
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find((item) => item.username.toLowerCase() === String(username).trim().toLowerCase());

  if (!user || user.password !== String(password).trim()) {
    return res.status(401).json({ success: false, error: 'Неверные имя или пароль.' });
  }

  const token = createToken();
  tokens.set(token, user.id);

  return sendJson(res, {
    success: true,
    token,
    user: getUserProfile(user)
  });
});

app.get('/api/user', authMiddleware, (req, res) => {
  return sendJson(res, {
    success: true,
    user: getUserProfile(req.user)
  });
});

app.post('/api/book', authMiddleware, (req, res) => {
  const { date, scenario, comment } = req.body;
  const bookingDate = new Date(date);

  if (Number.isNaN(bookingDate.getTime())) {
    return res.status(400).json({ success: false, error: 'Введите корректную дату и время.' });
  }

  const booking = {
    id: `booking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: req.user.id,
    username: req.user.username,
    scenario: String(scenario || '').trim() || 'Без названия',
    comment: String(comment || '').trim(),
    date: bookingDate.toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewNote: ''
  };

  req.user.bookedAt = null;
  req.user.bookingStatus = 'pending';
  req.user.invited = false;
  bookings.push(booking);

  return sendJson(res, {
    success: true,
    message: 'Ваша заявка отправлена. Администратор рассмотрит её в ближайшее время.',
    booking
  });
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  return sendJson(res, {
    success: true,
    notifications: notifications.get(req.user.id) || []
  });
});

app.get('/api/stats', authMiddleware, (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ success: false, error: 'Статистика доступна только создателю сайта.' });
  }

  const stats = {
    totalUsers: users.length,
    players: users.filter((item) => item.role === 'player').length,
    admins: users.filter((item) => item.role === 'admin' || item.role === 'creator').length,
    pendingBookings: bookings.filter((item) => item.status === 'pending').length,
    approvedBookings: bookings.filter((item) => item.status === 'approved').length,
    rejectedBookings: bookings.filter((item) => item.status === 'rejected').length,
    recentBookings: bookings.slice(-5).map((item) => ({
      id: item.id,
      username: item.username,
      scenario: item.scenario,
      status: item.status,
      createdAt: item.createdAt
    }))
  };

  return sendJson(res, { success: true, stats });
});

app.get('/api/admin/users', authMiddleware, ensureAdminAccess, (req, res) => {
  const usersList = users.map((item) => ({
    id: item.id,
    username: item.username,
    role: item.role,
    invited: item.invited,
    bookingStatus: item.bookingStatus || null,
    bookedAt: item.bookedAt
  }));

  return sendJson(res, { success: true, users: usersList });
});

app.get('/api/admin/bookings', authMiddleware, ensureAdminAccess, (req, res) => {
  const list = bookings
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((item) => ({
      ...item,
      user: getUserById(item.userId)
        ? { username: getUserById(item.userId).username, role: getUserById(item.userId).role }
        : null
    }));

  return sendJson(res, { success: true, bookings: list });
});

app.post('/api/admin/bookings/:id/review', authMiddleware, ensureAdminAccess, (req, res) => {
  const { action } = req.body;
  const booking = bookings.find((item) => item.id === req.params.id);

  if (!booking) {
    return res.status(404).json({ success: false, error: 'Заявка не найдена.' });
  }

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Некорректное действие.' });
  }

  const targetUser = getUserById(booking.userId);
  if (!targetUser) {
    return res.status(404).json({ success: false, error: 'Пользователь не найден.' });
  }

  if (action === 'approve') {
    booking.status = 'approved';
    targetUser.bookingStatus = 'approved';
    targetUser.bookedAt = booking.date;
    targetUser.invited = true;
    booking.reviewedAt = new Date().toISOString();
    booking.reviewNote = 'Подтверждено администратором';
    addNotification(targetUser.id, `Ваша заявка на квест «${booking.scenario}» одобрена.`, 'success');
  } else {
    booking.status = 'rejected';
    targetUser.bookingStatus = 'rejected';
    targetUser.bookedAt = null;
    targetUser.invited = false;
    booking.reviewedAt = new Date().toISOString();
    booking.reviewNote = 'Отклонено администратором';
    addNotification(targetUser.id, `Ваша заявка на квест «${booking.scenario}» отклонена.`, 'warning');
  }

  return sendJson(res, {
    success: true,
    booking,
    message: action === 'approve' ? 'Заявка одобрена.' : 'Заявка отклонена.'
  });
});

app.post('/api/invite', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'creator') {
    return res.status(403).json({ success: false, error: 'Только администратор может отправлять приглашения.' });
  }

  const { username } = req.body;
  const target = users.find((item) => item.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!target) {
    return res.status(404).json({ success: false, error: 'Пользователь не найден.' });
  }

  target.invited = true;

  return sendJson(res, { success: true, message: `Пользователь ${target.username} получил приглашение.` });
});

app.get('/api/actor-board', authMiddleware, (req, res) => {
  if (req.user.role !== 'actor' && req.user.role !== 'admin' && req.user.role !== 'creator') {
    return res.status(403).json({ success: false, error: 'Доступ закрыт.' });
  }

  const board = users
    .filter((item) => item.role === 'player' && item.bookedAt)
    .map((item) => ({
      username: item.username,
      bookedAt: item.bookedAt,
      invited: item.invited,
      status: item.bookingStatus || null
    }));

  return sendJson(res, { success: true, board });
});

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const room = url.searchParams.get('room') || 'public';
    const user = getUserByToken(token);

    if (!user) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    if (room === 'actor' && user.role !== 'actor' && user.role !== 'admin' && user.role !== 'creator') {
      ws.close(1008, 'Forbidden');
      return;
    }

    if (room === 'public' && !hasMessengerAccess(user)) {
      ws.close(1008, 'No access');
      return;
    }

    ws.user = user;
    ws.room = room;
    ws.send(JSON.stringify({ type: 'init', messages: messages[room] }));

    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data);
        if (payload.type !== 'message' || typeof payload.text !== 'string') return;

        const chatMessage = {
          type: 'message',
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: user.username,
          text: payload.text.trim().slice(0, 1000),
          time: new Date().toISOString(),
          room
        };

        messages[room].push(chatMessage);
        if (messages[room].length > maxMessages) {
          messages[room].shift();
        }

        const broadcast = JSON.stringify(chatMessage);
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN && client.room === room) {
            client.send(broadcast);
          }
        });
      } catch (err) {
        console.error('Invalid chat payload', err);
      }
    });
  } catch (err) {
    console.error('WebSocket connection error', err);
    ws.close(1011, 'Server error');
  }
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Horror chat quest site listening on http://localhost:${port}`);
  });
}

module.exports = { app, server };