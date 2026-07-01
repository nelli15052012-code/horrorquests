const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const serverModule = require('../server');

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = await response.json();
  return { response, data };
}

test('creator can view stats and approve booking requests', async () => {
  const server = serverModule.server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const registerResult = await requestJson(baseUrl, '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: 'secret123' })
    });
    assert.equal(registerResult.response.status, 200);
    assert.equal(registerResult.data.success, true);

    const creatorLoginResult = await requestJson(baseUrl, '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'creator', password: 'creator123' })
    });
    assert.equal(creatorLoginResult.response.status, 200);

    const statsResult = await requestJson(baseUrl, '/api/stats', {
      headers: { Authorization: `Bearer ${creatorLoginResult.data.token}` }
    });
    assert.equal(statsResult.response.status, 200);
    assert.ok(statsResult.data.stats.totalUsers >= 1);

    const bookingResult = await requestJson(baseUrl, '/api/book', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${registerResult.data.token}`
      },
      body: JSON.stringify({
        date: '2030-01-01T20:00:00',
        scenario: 'Похищение',
        comment: 'Нужно участие в квесте'
      })
    });
    assert.equal(bookingResult.response.status, 200);
    assert.equal(bookingResult.data.success, true);

    const bookingsResult = await requestJson(baseUrl, '/api/admin/bookings', {
      headers: { Authorization: `Bearer ${creatorLoginResult.data.token}` }
    });
    assert.equal(bookingsResult.response.status, 200);
    assert.ok(bookingsResult.data.bookings.length >= 1);

    const booking = bookingsResult.data.bookings[0];
    const reviewResult = await requestJson(baseUrl, `/api/admin/bookings/${booking.id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creatorLoginResult.data.token}`
      },
      body: JSON.stringify({ action: 'approve' })
    });
    assert.equal(reviewResult.response.status, 200);
    assert.equal(reviewResult.data.success, true);

    const notificationsResult = await requestJson(baseUrl, '/api/notifications', {
      headers: { Authorization: `Bearer ${registerResult.data.token}` }
    });
    assert.equal(notificationsResult.response.status, 200);
    assert.ok(notificationsResult.data.notifications.some((item) => item.text.includes('одобрена')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
