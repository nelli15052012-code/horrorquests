const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const creatorUsername = (process.env.CREATOR_USERNAME || 'creator').trim().toLowerCase();
const creatorPassword = (process.env.CREATOR_PASSWORD || 'creator123').trim();
const creatorInviteCode = (process.env.CREATOR_INVITE_CODE || 'creator-master').trim();

const users = [
  { id: 'creator', username: 'creator', password: creatorPassword, role: 'creator', invited: true, bookedAt: null, bookingStatus: 'approved', displayName: 'Создатель', avatarUrl: '', bio: 'Создатель проекта', backgroundUrl: '' },
  { id: 'admin', username: 'admin', password: 'admin123', role: 'admin', invited: true, bookedAt: null, bookingStatus: 'approved', displayName: 'Админ', avatarUrl: '', bio: 'Администратор', backgroundUrl: '' },
  { id: 'actor1', username: 'actor1', password: 'actorpass', role: 'actor', invited: true, bookedAt: null, bookingStatus: 'approved', displayName: 'Актёр', avatarUrl: '', bio: 'Сценарный актёр', backgroundUrl: '' }
];
const tokens = new Map();
const notifications = new Map();
const bookings = [];
const teamApplications = [];
const quests = [
  { id: 'quest-1', title: 'Похищение', description: 'Сюжет о пропавшем ребёнке и тайной в старом доме.', imageUrl: '/uploads/default-quest.svg' },
  { id: 'quest-2', title: 'Ночной эксперимент', description: 'Лабораторная история с паранормальными событиями.', imageUrl: '/uploads/default-quest.svg' }
];
const scheduleDays = [];
const rooms = {
  quest: { messages: [], wallpaper: 'night' },
  actor: { messages: [], wallpaper: 'night' },
  admin: { messages: [], wallpaper: 'night' }
};
const maxMessages = 200;

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

function isCreatorUser(user) {
  return Boolean(user && user.role === 'creator');
}

function canManageQuests(user) {
  return Boolean(user && (user.role === 'creator' || user.role === 'admin'));
}

function getPlayerMessengerAccess(user) {
  if (!user || user.role !== 'player') {
    return false;
  }
  if (user.bookingStatus !== 'approved' || !user.bookedAt) {
    return false;
  }
  const bookedAt = new Date(user.bookedAt);
  if (Number.isNaN(bookedAt.getTime())) {
    return false;
  }
  const now = new Date();
  const start = new Date(bookedAt);
  start.setMinutes(start.getMinutes() - 30);
  const end = new Date(bookedAt);
  end.setHours(end.getHours() + 2);
  return now >= start && now <= end;
}

function hasMessengerAccess(user) {
  return Boolean(user && (user.role === 'actor' || user.role === 'admin' || user.role === 'creator' || getPlayerMessengerAccess(user)));
}

function canManageRoles(user) {
  return isCreatorUser(user);
}

function getRoleLabel(role) {
  if (role === 'admin') return 'администратор';
  if (role === 'actor') return 'актёр';
  if (role === 'creator') return 'создатель';
  return 'игрок';
}

function getUserProfile(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role,
    invited: user.invited,
    bookedAt: user.bookedAt,
    bookingStatus: user.bookingStatus || null,
    avatarUrl: user.avatarUrl || '',
    backgroundUrl: user.backgroundUrl || '',
    bio: user.bio || '',
    access: hasMessengerAccess(user),
    canManageQuests: canManageQuests(user),
    canManageRoles: canManageRoles(user)
  };
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

function createScheduleLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: 'short' });
}

function ensureDefaultSchedule() {
  if (scheduleDays.length > 0) {
    return;
  }
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(base);
    day.setDate(base.getDate() + offset);
    const key = day.toISOString().slice(0, 10);
    scheduleDays.push({
      key,
      label: createScheduleLabel(key),
      slots: [
        { id: `${key}-19:00`, time: '19:00' },
        { id: `${key}-21:00`, time: '21:00' }
      ]
    });
  }
}

function findSlotById(slotId) {
  return scheduleDays.flatMap((day) => day.slots.map((slot) => ({ ...slot, dayKey: day.key }))).find((slot) => slot.id === slotId) || null;
}

function getSchedule() {
  ensureDefaultSchedule();
  const bookedKeys = new Set(bookings.filter((item) => item.status === 'approved').map((item) => item.slotKey));
  return scheduleDays.map((day) => ({
    key: day.key,
    label: day.label,
    slots: day.slots.map((slot) => ({
      id: slot.id,
      time: slot.time,
      status: bookedKeys.has(slot.id) ? 'booked' : 'available'
    }))
  }));
}

function getRoomAccess(user, roomName) {
  if (roomName === 'actor') {
    return user.role === 'actor' || user.role === 'admin' || user.role === 'creator';
  }
  if (roomName === 'admin') {
    return user.role === 'admin' || user.role === 'creator';
  }
  return hasMessengerAccess(user);
}

function broadcastRoom(roomName, payload) {
  const raw = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.room === roomName) {
      client.send(raw);
    }
  });
}

function storeUpload(base64Data, originalName) {
  const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Некорректный файл.');
  }

  const extension = path.extname(originalName) || '.bin';
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(uploadsDir, `${fileId}${extension}`);
  fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
  return `/uploads/${fileId}${extension}`;
}

app.post('/api/register', (req, res) => {
  const { username, password, inviteCode } = req.body;
  if (!username || !password || String(username).trim().length < 2 || String(password).trim().length < 4) {
    return res.status(400).json({ success: false, error: 'Введите корректные имя и пароль.' });
  }

  const trimmedUsername = String(username).trim();
  const normalized = trimmedUsername.toLowerCase();
  const providedInviteCode = String(inviteCode || '').trim();
  const isCreatorRegistration = normalized === creatorUsername || providedInviteCode === creatorInviteCode;

  if (isCreatorRegistration) {
    const existingCreator = users.find((item) => item.id === 'creator' || item.username.toLowerCase() === creatorUsername);
    if (existingCreator) {
      existingCreator.password = String(password).trim();
      existingCreator.displayName = 'Создатель';
      existingCreator.role = 'creator';
      existingCreator.invited = true;
      existingCreator.bookingStatus = 'approved';
      const token = createToken();
      tokens.set(token, existingCreator.id);
      return sendJson(res, { success: true, token, user: getUserProfile(existingCreator) });
    }
  }

  if (users.some((item) => item.username.toLowerCase() === normalized)) {
    return res.status(400).json({ success: false, error: 'Такой пользователь уже существует.' });
  }

  const newUser = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username: trimmedUsername,
    password: String(password).trim(),
    role: isCreatorRegistration ? 'creator' : 'player',
    invited: true,
    bookedAt: null,
    bookingStatus: isCreatorRegistration ? 'approved' : null,
    displayName: trimmedUsername,
    avatarUrl: '',
    bio: ''
  };
  users.push(newUser);

  const token = createToken();
  tokens.set(token, newUser.id);

  return sendJson(res, { success: true, token, user: getUserProfile(newUser) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find((item) => item.username.toLowerCase() === String(username).trim().toLowerCase());

  if (!user || user.password !== String(password).trim()) {
    return res.status(401).json({ success: false, error: 'Неверные имя или пароль.' });
  }

  const token = createToken();
  tokens.set(token, user.id);

  return sendJson(res, { success: true, token, user: getUserProfile(user) });
});

app.get('/api/user', authMiddleware, (req, res) => {
  return sendJson(res, { success: true, user: getUserProfile(req.user) });
});

app.post('/api/profile', authMiddleware, (req, res) => {
  const { displayName, bio, avatarUrl, backgroundUrl } = req.body;

  if (typeof displayName === 'string' && displayName.trim()) {
    req.user.displayName = displayName.trim();
  }
  if (typeof bio === 'string') {
    req.user.bio = bio.trim();
  }
  if (typeof avatarUrl === 'string') {
    req.user.avatarUrl = avatarUrl;
  }
  if (typeof backgroundUrl === 'string') {
    req.user.backgroundUrl = backgroundUrl;
  }

  return sendJson(res, { success: true, user: getUserProfile(req.user) });
});

app.post('/api/upload', authMiddleware, (req, res) => {
  const { fileName, mimeType, dataUrl } = req.body;
  if (!dataUrl || !mimeType || !fileName) {
    return res.status(400).json({ success: false, error: 'Файл не передан.' });
  }

  try {
    const url = storeUpload(dataUrl, fileName);
    return sendJson(res, { success: true, url });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  return sendJson(res, { success: true, notifications: notifications.get(req.user.id) || [] });
});

app.get('/api/quests', (req, res) => {
  return sendJson(res, { success: true, quests });
});

app.post('/api/quests', authMiddleware, (req, res) => {
  if (!canManageQuests(req.user)) {
    return res.status(403).json({ success: false, error: 'Только администраторы и создатель могут управлять квестами.' });
  }

  const { title, description, imageUrl } = req.body;
  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Заполните название и описание.' });
  }

  const quest = { id: `quest-${Date.now()}`, title: title.trim(), description: description.trim(), imageUrl: imageUrl || '/uploads/default-quest.svg' };
  quests.push(quest);
  return sendJson(res, { success: true, quest });
});

app.put('/api/quests/:id', authMiddleware, (req, res) => {
  if (!canManageQuests(req.user)) {
    return res.status(403).json({ success: false, error: 'Только администраторы и создатель могут управлять квестами.' });
  }

  const quest = quests.find((item) => item.id === req.params.id);
  if (!quest) {
    return res.status(404).json({ success: false, error: 'Квест не найден.' });
  }

  const { title, description, imageUrl } = req.body;
  if (typeof title === 'string' && title.trim()) quest.title = title.trim();
  if (typeof description === 'string') quest.description = description.trim();
  if (typeof imageUrl === 'string' && imageUrl.trim()) quest.imageUrl = imageUrl;

  return sendJson(res, { success: true, quest });
});

app.delete('/api/quests/:id', authMiddleware, (req, res) => {
  if (!canManageQuests(req.user)) {
    return res.status(403).json({ success: false, error: 'Только администраторы и создатель могут управлять квестами.' });
  }

  const questIndex = quests.findIndex((item) => item.id === req.params.id);
  if (questIndex === -1) {
    return res.status(404).json({ success: false, error: 'Квест не найден.' });
  }

  quests.splice(questIndex, 1);
  return sendJson(res, { success: true });
});

app.get('/api/schedule', (req, res) => {
  return sendJson(res, { success: true, schedule: getSchedule() });
});

app.get('/api/admin/schedule', authMiddleware, ensureAdminAccess, (req, res) => {
  return sendJson(res, { success: true, schedule: getSchedule() });
});

app.post('/api/admin/schedule/days', authMiddleware, ensureAdminAccess, (req, res) => {
  const { date, slots } = req.body;
  if (!date || !Date.parse(`${date}T00:00:00`)) {
    return res.status(400).json({ success: false, error: 'Укажите корректную дату.' });
  }
  const dayKey = String(date).slice(0, 10);
  if (scheduleDays.some((day) => day.key === dayKey)) {
    return res.status(400).json({ success: false, error: 'Дата уже существует в расписании.' });
  }
  const slotTimes = Array.isArray(slots) && slots.length > 0 ? slots : ['19:00', '21:00'];
  scheduleDays.push({
    key: dayKey,
    label: createScheduleLabel(dayKey),
    slots: [...new Set(slotTimes.filter((time) => typeof time === 'string').map((time) => time.trim()))].map((time) => ({ id: `${dayKey}-${time}`, time }))
  });
  return sendJson(res, { success: true, schedule: getSchedule() });
});

app.delete('/api/admin/schedule/days/:dayKey', authMiddleware, ensureAdminAccess, (req, res) => {
  const dayKey = req.params.dayKey;
  const day = scheduleDays.find((item) => item.key === dayKey);
  if (!day) {
    return res.status(404).json({ success: false, error: 'Дата не найдена.' });
  }
  const bookedKeys = new Set(bookings.filter((item) => item.status === 'approved').map((item) => item.slotKey));
  if (day.slots.some((slot) => bookedKeys.has(slot.id))) {
    return res.status(400).json({ success: false, error: 'Нельзя удалить дату с подтверждёнными слотами.' });
  }
  const index = scheduleDays.findIndex((item) => item.key === dayKey);
  scheduleDays.splice(index, 1);
  return sendJson(res, { success: true, schedule: getSchedule() });
});

app.post('/api/admin/schedule/slots', authMiddleware, ensureAdminAccess, (req, res) => {
  const { dayKey, time } = req.body;
  if (!dayKey || !time) {
    return res.status(400).json({ success: false, error: 'Укажите дату и время слота.' });
  }
  const day = scheduleDays.find((item) => item.key === dayKey);
  if (!day) {
    return res.status(404).json({ success: false, error: 'Дата не найдена.' });
  }
  const normalizedTime = String(time).trim();
  const slotId = `${dayKey}-${normalizedTime}`;
  if (day.slots.some((slot) => slot.id === slotId)) {
    return res.status(400).json({ success: false, error: 'Такой слот уже существует.' });
  }
  day.slots.push({ id: slotId, time: normalizedTime });
  return sendJson(res, { success: true, schedule: getSchedule() });
});

app.put('/api/admin/schedule/slots/:slotId', authMiddleware, ensureAdminAccess, (req, res) => {
  const { slotId } = req.params;
  const { date, time } = req.body;
  const existingSlot = findSlotById(slotId);
  if (!existingSlot) {
    return res.status(404).json({ success: false, error: 'Слот не найден.' });
  }
  const bookedKeys = new Set(bookings.filter((item) => item.status === 'approved').map((item) => item.slotKey));
  if (bookedKeys.has(slotId)) {
    return res.status(400).json({ success: false, error: 'Нельзя изменять подтверждённый слот.' });
  }
  const newDate = date ? String(date).slice(0, 10) : existingSlot.dayKey;
  const newTime = time ? String(time).trim() : existingSlot.time;
  const newSlotId = `${newDate}-${newTime}`;
  const day = scheduleDays.find((item) => item.key === existingSlot.dayKey);
  if (!day) {
    return res.status(500).json({ success: false, error: 'Внутренняя ошибка расписания.' });
  }
  const targetDay = scheduleDays.find((item) => item.key === newDate);
  if (!targetDay) {
    return res.status(404).json({ success: false, error: 'Новая дата не найдена.' });
  }
  if (targetDay.slots.some((slot) => slot.id === newSlotId)) {
    return res.status(400).json({ success: false, error: 'Слот с таким временем уже существует.' });
  }
  const slotIndex = day.slots.findIndex((slot) => slot.id === slotId);
  if (slotIndex === -1) {
    return res.status(500).json({ success: false, error: 'Слот не найден в расписании.' });
  }
  day.slots.splice(slotIndex, 1);
  targetDay.slots.push({ id: newSlotId, time: newTime });
  return sendJson(res, { success: true, schedule: getSchedule() });
});

app.delete('/api/admin/schedule/slots/:slotId', authMiddleware, ensureAdminAccess, (req, res) => {
  const { slotId } = req.params;
  const bookedKeys = new Set(bookings.filter((item) => item.status === 'approved').map((item) => item.slotKey));
  if (bookedKeys.has(slotId)) {
    return res.status(400).json({ success: false, error: 'Нельзя удалять подтверждённый слот.' });
  }
  const slot = findSlotById(slotId);
  if (!slot) {
    return res.status(404).json({ success: false, error: 'Слот не найден.' });
  }
  const day = scheduleDays.find((item) => item.key === slot.dayKey);
  if (!day) {
    return res.status(500).json({ success: false, error: 'Внутренняя ошибка расписания.' });
  }
  day.slots = day.slots.filter((item) => item.id !== slotId);
  return sendJson(res, { success: true, schedule: getSchedule() });
});

app.post('/api/book', authMiddleware, (req, res) => {
  const { slotKey, scenario, comment, date } = req.body;
  let resolvedSlotKey = slotKey;
  let resolvedDate = '';
  let resolvedTime = '19:00';

  if (!resolvedSlotKey && typeof date === 'string' && date.trim()) {
    const parsedDate = new Date(date);
    if (!Number.isNaN(parsedDate.getTime())) {
      const hh = String(parsedDate.getHours()).padStart(2, '0');
      const mm = String(parsedDate.getMinutes()).padStart(2, '0');
      resolvedTime = `${hh}:${mm}`;
      resolvedDate = parsedDate.toISOString().slice(0, 10);
      resolvedSlotKey = `${resolvedDate}-${resolvedTime}`;
    }
  }

  const schedule = getSchedule();
  const slot = schedule.flatMap((day) => day.slots).find((item) => item.id === resolvedSlotKey);

  if (!slot || slot.status === 'booked') {
    return res.status(400).json({ success: false, error: 'Выбранное время уже занято или недоступно.' });
  }

  const booking = {
    id: `booking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: req.user.id,
    username: req.user.username,
    scenario: String(scenario || '').trim() || 'Без названия',
    comment: String(comment || '').trim(),
    slotKey: resolvedSlotKey,
    date: resolvedDate || resolvedSlotKey.slice(0, 10),
    time: resolvedTime || resolvedSlotKey.slice(11),
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewNote: ''
  };

  req.user.bookedAt = null;
  req.user.bookingStatus = 'pending';
  req.user.invited = false;
  bookings.push(booking);

  return sendJson(res, { success: true, message: 'Заявка отправлена. После одобрения время будет отмечено как занятое.', booking });
});

app.get('/api/stats', authMiddleware, (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ success: false, error: 'Статистика доступна только создателю сайта.' });
  }

  const stats = {
    totalUsers: users.length,
    players: users.filter((item) => item.role === 'player').length,
    actors: users.filter((item) => item.role === 'actor').length,
    admins: users.filter((item) => item.role === 'admin' || item.role === 'creator').length,
    pendingBookings: bookings.filter((item) => item.status === 'pending').length,
    approvedBookings: bookings.filter((item) => item.status === 'approved').length,
    rejectedBookings: bookings.filter((item) => item.status === 'rejected').length,
    recentBookings: bookings.slice(-5).map((item) => ({ id: item.id, username: item.username, scenario: item.scenario, status: item.status, createdAt: item.createdAt }))
  };

  return sendJson(res, { success: true, stats });
});

app.get('/api/admin/users', authMiddleware, ensureAdminAccess, (req, res) => {
  return sendJson(res, { success: true, users: users.map((item) => ({ id: item.id, username: item.username, role: item.role, invited: item.invited, bookingStatus: item.bookingStatus || null, displayName: item.displayName || item.username, avatarUrl: item.avatarUrl || '' })) });
});

app.post('/api/admin/users/:id/role', authMiddleware, (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ success: false, error: 'Только создатель может управлять правами администраторов.' });
  }

  const target = getUserById(req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, error: 'Пользователь не найден.' });
  }

  if (target.id === 'creator') {
    return res.status(403).json({ success: false, error: 'Нельзя изменить права создателя.' });
  }

  const { role } = req.body;
  const nextRole = role === 'admin' ? 'admin' : role === 'actor' ? 'actor' : 'player';
  target.role = nextRole;
  target.invited = nextRole !== 'player';
  target.bookingStatus = nextRole === 'player' ? null : (target.bookingStatus || 'approved');

  addNotification(target.id, `Ваш статус обновлён: ${getRoleLabel(nextRole)}.`, 'info');
  return sendJson(res, { success: true, user: getUserProfile(target) });
});

app.get('/api/admin/bookings', authMiddleware, ensureAdminAccess, (req, res) => {
  const list = bookings.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return sendJson(res, { success: true, bookings: list });
});

app.post('/api/admin/bookings/:id/review', authMiddleware, ensureAdminAccess, (req, res) => {
  const { action } = req.body;
  const booking = bookings.find((item) => item.id === req.params.id);

  if (!booking) {
    return res.status(404).json({ success: false, error: 'Заявка не найдена.' });
  }

  const targetUser = getUserById(booking.userId);
  if (!targetUser) {
    return res.status(404).json({ success: false, error: 'Пользователь не найден.' });
  }

  if (action === 'approve') {
    booking.status = 'approved';
    targetUser.bookingStatus = 'approved';
    targetUser.bookedAt = `${booking.date}T${booking.time}`;
    targetUser.invited = true;
    booking.reviewedAt = new Date().toISOString();
    booking.reviewNote = 'Подтверждено';
    addNotification(targetUser.id, `Ваша заявка на квест «${booking.scenario}» одобрена.`, 'success');
  } else {
    booking.status = 'rejected';
    targetUser.bookingStatus = 'rejected';
    targetUser.bookedAt = null;
    targetUser.invited = false;
    booking.reviewedAt = new Date().toISOString();
    booking.reviewNote = 'Отклонено';
    addNotification(targetUser.id, `Ваша заявка на квест «${booking.scenario}» отклонена.`, 'warning');
  }

  return sendJson(res, { success: true, booking, message: action === 'approve' ? 'Заявка одобрена.' : 'Заявка отклонена.' });
});

app.get('/api/team-applications', authMiddleware, ensureAdminAccess, (req, res) => {
  return sendJson(res, { success: true, applications: teamApplications });
});

app.post('/api/team-applications', authMiddleware, (req, res) => {
  const { name, role, experience, message } = req.body;
  if (!name || !role || !message) {
    return res.status(400).json({ success: false, error: 'Заполните обязательные поля.' });
  }

  const application = {
    id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: req.user.id,
    applicantName: name.trim(),
    role: role.trim(),
    experience: experience || '',
    message: message.trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  teamApplications.push(application);
  addNotification(req.user.id, 'Ваша заявка на участие в команде отправлена. Ожидайте решения.', 'info');
  broadcastRoom('admin', { type: 'system', text: `Новая заявка на участие от ${application.applicantName}` });

  return sendJson(res, { success: true, application });
});

app.post('/api/admin/team-applications/:id/review', authMiddleware, ensureAdminAccess, (req, res) => {
  const { action } = req.body;
  const application = teamApplications.find((item) => item.id === req.params.id);
  if (!application) {
    return res.status(404).json({ success: false, error: 'Заявка не найдена.' });
  }

  if (action === 'approve') {
    const user = getUserById(application.userId);
    if (user) {
      user.role = 'actor';
      user.invited = true;
      user.displayName = application.applicantName;
      addNotification(user.id, 'Ваша заявка в команду принята. Теперь вы актёр.', 'success');
    }
    application.status = 'approved';
    return sendJson(res, { success: true, application });
  }

  application.status = 'rejected';
  const user = getUserById(application.userId);
  if (user) {
    addNotification(user.id, 'Ваша заявка в команду отклонена.', 'warning');
  }
  return sendJson(res, { success: true, application });
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

  const board = users.filter((item) => item.role === 'player' && item.bookedAt).map((item) => ({ username: item.username, bookedAt: item.bookedAt, invited: item.invited, status: item.bookingStatus || null }));
  return sendJson(res, { success: true, board });
});

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const room = url.searchParams.get('room') || 'quest';
    const user = getUserByToken(token);

    if (!user) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    if (!getRoomAccess(user, room)) {
      ws.close(1008, 'Forbidden');
      return;
    }

    ws.user = user;
    ws.room = room;
    const initialMessages = (room === 'quest' && user.role === 'player') ? [] : rooms[room].messages;
    ws.send(JSON.stringify({ type: 'init', messages: initialMessages, wallpaper: rooms[room].wallpaper }));

    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data);
        if (payload.type === 'wallpaper') {
          if (user.role !== 'actor' && user.role !== 'admin' && user.role !== 'creator') {
            return;
          }
          rooms[room].wallpaper = payload.wallpaper;
          broadcastRoom(room, { type: 'wallpaper', wallpaper: rooms[room].wallpaper });
          return;
        }

        if (payload.type !== 'message') {
          return;
        }

        const chatMessage = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: payload.kind || 'text',
          name: user.username,
          displayName: user.displayName || user.username,
          role: user.role,
          avatarUrl: user.avatarUrl || '',
          text: typeof payload.text === 'string' ? payload.text.trim().slice(0, 1000) : '',
          media: payload.media || null,
          time: new Date().toISOString(),
          room
        };

        rooms[room].messages.push(chatMessage);
        if (rooms[room].messages.length > maxMessages) {
          rooms[room].messages.shift();
        }

        broadcastRoom(room, chatMessage);
      } catch (error) {
        console.error('Invalid chat payload', error);
      }
    });
  } catch (error) {
    console.error('WebSocket connection error', error);
    ws.close(1011, 'Server error');
  }
});

if (require.main === module) {
  const host = process.env.HOST || 'horrorchatsite.local';
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, host, () => {
    console.log(`Horror chat quest site listening on http://${host}:${port}`);
  });
}

module.exports = { server, app, wss };

module.exports = { app, server };