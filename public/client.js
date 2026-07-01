const state = {
  token: localStorage.getItem('token'),
  user: null,
  activePage: 'home',
  ws: null,
  currentRoom: 'public'
};

const pageButtons = document.querySelectorAll('[data-page]');
const pages = document.querySelectorAll('.page');
const statusText = document.getElementById('statusText');
const notificationList = document.getElementById('notificationList');
const loginButton = document.getElementById('loginButton');
const logoutButton = document.getElementById('logoutButton');
const actorLink = document.getElementById('actorLink');
const adminLink = document.getElementById('adminLink');
const messengerAccess = document.getElementById('messengerAccess');
const messengerApp = document.getElementById('messengerApp');
const messengerLocked = document.getElementById('messengerLocked');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const wallpaperButtons = document.querySelectorAll('.wallpaper-button');
const bookingForm = document.getElementById('bookingForm');
const actorPanel = document.getElementById('actorPanel');
const actorLocked = document.getElementById('actorLocked');
const actorContent = document.getElementById('actorContent');
const actorBoard = document.getElementById('actorBoard');
const actorMessagesEl = document.getElementById('actorMessages');
const actorChatForm = document.getElementById('actorChatForm');
const actorMessageInput = document.getElementById('actorMessageInput');
const authModal = document.getElementById('authModal');
const authForm = document.getElementById('authForm');
const authError = document.getElementById('authError');
const authClose = document.getElementById('authClose');
const authTabs = document.querySelectorAll('.tab-button');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const messengerRoleBadge = document.getElementById('messengerRoleBadge');
const bookingName = document.getElementById('bookingName');
const bookingDate = document.getElementById('bookingDate');
const bookingComment = document.getElementById('bookingComment');
const scenarioSelect = document.getElementById('scenarioSelect');
const adminLocked = document.getElementById('adminLocked');
const adminContent = document.getElementById('adminContent');
const statsGrid = document.getElementById('statsGrid');
const usersList = document.getElementById('usersList');
const bookingsList = document.getElementById('bookingsList');

let authMode = 'login';

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`/api${path}`, { ...options, headers });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Ошибка запроса');
  }

  return result;
}

function setPage(page) {
  state.activePage = page;
  pageButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.page === page);
  });

  pages.forEach((section) => {
    section.classList.toggle('active', section.id === page);
  });

  if (page === 'messenger') {
    renderMessenger();
  }
  if (page === 'actor') {
    renderActorArea();
  }
  if (page === 'admin') {
    renderAdminArea();
  }
}

function setUser(user, token) {
  state.user = user;
  if (token) {
    state.token = token;
    localStorage.setItem('token', token);
  }
  if (!user) {
    state.token = null;
    localStorage.removeItem('token');
  }
  updateHeader();
}

function updateHeader() {
  const isAuthorized = Boolean(state.user);
  if (!isAuthorized) {
    statusText.textContent = 'Не авторизованы';
    loginButton.hidden = false;
    logoutButton.hidden = true;
    actorLink.hidden = true;
    adminLink.hidden = true;
  } else {
    statusText.textContent = `Вы: ${state.user.username} (${state.user.role})`;
    loginButton.hidden = true;
    logoutButton.hidden = false;
    actorLink.hidden = state.user.role !== 'actor' && state.user.role !== 'admin' && state.user.role !== 'creator';
    adminLink.hidden = state.user.role !== 'admin' && state.user.role !== 'creator';
  }
}

async function loadUser() {
  if (!state.token) {
    setUser(null);
    return;
  }
  try {
    const result = await api('/user');
    setUser(result.user);
    await loadNotifications();
  } catch (err) {
    setUser(null);
  }
}

async function loadNotifications() {
  if (!state.user) {
    notificationList.innerHTML = '';
    return;
  }

  try {
    const result = await api('/notifications');
    notificationList.innerHTML = result.notifications?.length
      ? result.notifications.map((item) => `<div class="notification-item">${escapeHtml(item.text)}</div>`).join('')
      : '<div class="notification-item">Уведомлений нет.</div>';
  } catch (err) {
    notificationList.innerHTML = '<div class="notification-item">Не удалось загрузить уведомления.</div>';
  }
}

function showAuthModal() {
  authModal.classList.add('open');
  authError.hidden = true;
  authUsername.value = '';
  authPassword.value = '';
}

function hideAuthModal() {
  authModal.classList.remove('open');
}

function setAuthTab(tab) {
  authMode = tab;
  authTabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
}

async function loginOrRegister(event) {
  event.preventDefault();
  const username = authUsername.value.trim();
  const password = authPassword.value.trim();
  if (!username || !password) return;

  try {
    const result = await api(authMode === 'login' ? '/login' : '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setUser(result.user, result.token);
    await loadNotifications();
    hideAuthModal();
    renderMessenger();
    setPage('home');
  } catch (err) {
    authError.hidden = false;
    authError.textContent = err.message;
  }
}

function logout() {
  setUser(null);
  notificationList.innerHTML = '';
  if (state.ws) {
    state.ws.close();
  }
}

function renderMessenger() {
  if (!state.user) {
    messengerAccess.textContent = 'Войдите, чтобы получить доступ к мессенджеру.';
    messengerAccess.hidden = false;
    messengerApp.hidden = true;
    messengerLocked.hidden = true;
    return;
  }

  if (!state.user.access) {
    messengerAccess.hidden = true;
    messengerApp.hidden = true;
    messengerLocked.hidden = false;
    return;
  }

  messengerAccess.hidden = true;
  messengerApp.hidden = false;
  messengerLocked.hidden = true;
  messengerRoleBadge.textContent = state.user.role === 'admin' ? 'Админ' : state.user.role === 'actor' ? 'Актёр' : 'Игрок';
  startChat('public');
}

function renderActorArea() {
  if (!state.user || (state.user.role !== 'actor' && state.user.role !== 'admin' && state.user.role !== 'creator')) {
    actorLocked.hidden = false;
    actorContent.hidden = true;
    return;
  }

  actorLocked.hidden = true;
  actorContent.hidden = false;
  loadActorBoard();
  startActorChat();
}

function renderAdminArea() {
  if (!state.user || (state.user.role !== 'admin' && state.user.role !== 'creator')) {
    adminLocked.hidden = false;
    adminContent.hidden = true;
    return;
  }

  adminLocked.hidden = true;
  adminContent.hidden = false;
  loadAdminData();
}

async function loadActorBoard() {
  try {
    const result = await api('/actor-board');
    actorBoard.innerHTML = result.board.length
      ? result.board.map((item) => `<li>${item.username} — ${new Date(item.bookedAt).toLocaleString('ru-RU')} (${item.status || '—'})</li>`).join('')
      : '<li>Нет активных записей.</li>';
  } catch (err) {
    actorBoard.innerHTML = `<li>Ошибка загрузки данных: ${err.message}</li>`;
  }
}

async function loadAdminData() {
  try {
    const [statsResult, usersResult, bookingsResult, notificationsResult] = await Promise.all([
      api('/stats').catch(() => ({ success: false, stats: null })),
      api('/admin/users').catch(() => ({ success: false, users: [] })),
      api('/admin/bookings').catch(() => ({ success: false, bookings: [] })),
      api('/notifications').catch(() => ({ success: false, notifications: [] }))
    ]);

    if (statsResult.success && statsResult.stats) {
      statsGrid.innerHTML = [
        ['Всего пользователей', statsResult.stats.totalUsers],
        ['Игроки', statsResult.stats.players],
        ['Ожидают', statsResult.stats.pendingBookings],
        ['Одобрено', statsResult.stats.approvedBookings],
        ['Отклонено', statsResult.stats.rejectedBookings]
      ].map(([label, value]) => `<div class="stats-card"><h4>${label}</h4><p>${value}</p></div>`).join('');
    } else {
      statsGrid.innerHTML = '<div class="stats-card"><h4>Статистика</h4><p>Недоступно</p></div>';
    }

    usersList.innerHTML = usersResult.users.length
      ? usersResult.users.map((item) => `<li>${item.username} — ${item.role} • ${item.bookingStatus || 'без заявки'}</li>`).join('')
      : '<li>Нет пользователей.</li>';

    bookingsList.innerHTML = bookingsResult.bookings.length
      ? bookingsResult.bookings.map((item) => `
          <li>
            <strong>${escapeHtml(item.username)}</strong> — ${escapeHtml(item.scenario)}<br />
            <span>${new Date(item.date).toLocaleString('ru-RU')}</span><br />
            <span>${escapeHtml(item.comment || 'Без комментария')}</span><br />
            <span>Статус: ${escapeHtml(item.status)}</span>
            ${item.status === 'pending' ? `<button class="button admin-action admin-action--approve" data-action="approve" data-id="${item.id}">Одобрить</button><button class="button admin-action admin-action--reject" data-action="reject" data-id="${item.id}">Отклонить</button>` : ''}
          </li>`).join('')
      : '<li>Нет заявок.</li>';

    const notificationList = notificationsResult.notifications?.length
      ? notificationsResult.notifications.map((item) => `<div class="notification-item">${escapeHtml(item.text)}</div>`).join('')
      : '<div class="notification-item">Уведомлений нет.</div>';
    bookingsList.insertAdjacentHTML('beforeend', `<li><strong>Уведомления</strong><div class="notification-list">${notificationList}</div></li>`);

    bookingsList.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => reviewBooking(button.dataset.id, button.dataset.action));
    });
  } catch (err) {
    bookingsList.innerHTML = `<li>Ошибка загрузки админки: ${err.message}</li>`;
  }
}

async function reviewBooking(bookingId, action) {
  try {
    const result = await api(`/admin/bookings/${bookingId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action })
    });
    alert(result.message);
    await loadAdminData();
  } catch (err) {
    alert(err.message);
  }
}

function createMessageItem(message) {
  const item = document.createElement('div');
  item.className = 'message';
  item.innerHTML = `
    <div class="message__meta">
      <span>${escapeHtml(message.name)}</span>
      <span>${new Date(message.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    <div class="message__text">${escapeHtml(message.text)}</div>
  `;
  return item;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function connectWebSocket(room, messageContainer) {
  if (!state.token) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/?token=${encodeURIComponent(state.token)}&room=${encodeURIComponent(room)}`;

  if (state.ws) {
    state.ws.close();
  }

  const socket = new WebSocket(url);
  state.ws = socket;
  messageContainer.innerHTML = '';

  socket.addEventListener('open', () => {
    const item = document.createElement('div');
    item.className = 'message message--system';
    item.innerHTML = `<div class="message__text">Соединение с ${room === 'actor' ? 'актёрским' : 'общим'} чатом установлено.</div>`;
    messageContainer.appendChild(item);
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'init' && Array.isArray(payload.messages)) {
        payload.messages.forEach((message) => messageContainer.appendChild(createMessageItem(message)));
        messageContainer.scrollTop = messageContainer.scrollHeight;
        return;
      }
      if (payload.type === 'message') {
        messageContainer.appendChild(createMessageItem(payload));
        messageContainer.scrollTop = messageContainer.scrollHeight;
      }
    } catch (err) {
      console.error('Ошибка обработки сообщения:', err);
    }
  });

  socket.addEventListener('close', () => {
    const item = document.createElement('div');
    item.className = 'message message--system';
    item.innerHTML = `<div class="message__text">Соединение закрыто.</div>`;
    messageContainer.appendChild(item);
  });

  socket.addEventListener('error', () => {
    const item = document.createElement('div');
    item.className = 'message message--system';
    item.innerHTML = `<div class="message__text">Ошибка WebSocket.</div>`;
    messageContainer.appendChild(item);
  });
}

function startChat(room) {
  state.currentRoom = room;
  connectWebSocket(room, messagesEl);
}

function startActorChat() {
  connectWebSocket('actor', actorMessagesEl);
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const text = messageInput.value.trim();
  if (!text) return;
  state.ws.send(JSON.stringify({ type: 'message', text }));
  messageInput.value = '';
});

actorChatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const text = actorMessageInput.value.trim();
  if (!text) return;
  state.ws.send(JSON.stringify({ type: 'message', text }));
  actorMessageInput.value = '';
});

bookingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.user) {
    showAuthModal();
    return;
  }

  const date = bookingDate.value;
  const scenario = scenarioSelect.value;
  const comment = bookingComment.value.trim();

  try {
    const result = await api('/book', { method: 'POST', body: JSON.stringify({ date, scenario, comment }) });
    alert(result.message);
    state.user.bookingStatus = 'pending';
    state.user.access = false;
    renderMessenger();
  } catch (err) {
    alert(err.message);
  }
});

authTabs.forEach((button) => {
  button.addEventListener('click', () => setAuthTab(button.dataset.tab));
});

authForm.addEventListener('submit', loginOrRegister);
authClose.addEventListener('click', hideAuthModal);
logoutButton.addEventListener('click', logout);
loginButton.addEventListener('click', showAuthModal);

pageButtons.forEach((button) => {
  button.addEventListener('click', () => setPage(button.dataset.page));
});

document.querySelectorAll('.hero-actions button').forEach((button) => {
  button.addEventListener('click', () => setPage(button.dataset.page));
});

wallpaperButtons.forEach((button) => {
  button.addEventListener('click', () => {
    document.body.dataset.wallpaper = button.dataset.wallpaper;
  });
});

window.addEventListener('load', async () => {
  await loadUser();
  setPage('home');
  setAuthTab('login');
});

window.addEventListener('beforeunload', () => {
  if (state.ws) {
    state.ws.close();
  }
});
