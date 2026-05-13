const express = require('express');
const session = require('express-session');
const NodeCache = require('node-cache');
const {
  initDb,
  runAsync,
  getAsync,
  allAsync
} = require('./db');

const app = express();
const cache = new NodeCache({ stdTTL: 30 });
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', `${__dirname}/views`);

app.use(express.static(`${__dirname}/public`));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: 'baikal-nest-course-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 2 }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.path = req.path;
  res.locals.success = req.query.success;
  res.locals.error = req.query.error;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login?error=admin');
  }
  next();
}

function parseFeatures(value) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function nightsBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) && diff > 0 ? diff : 1;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('ru-RU');
}

function statusLabel(status) {
  const labels = {
    new: 'Ожидает подтверждения',
    confirmed: 'Подтверждена',
    paid: 'Оплачено',
    cancelled: 'Отменена',
    completed: 'Завершена',
    pending: 'На модерации',
    approved: 'Одобрен',
    rejected: 'Отклонен',
    seated: 'Гость пришел'
  };
  return labels[status] || status;
}

function monthString(year, monthIndex) {
  const date = new Date(year, monthIndex, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function getHouses() {
  let houses = cache.get('houses');
  if (!houses) {
    houses = await allAsync('SELECT * FROM houses ORDER BY popularity DESC');
    houses = houses.map((house) => ({ ...house, featuresList: parseFeatures(house.features) }));
    cache.set('houses', houses);
  }
  return houses;
}

async function getApprovedReviews() {
  let reviews = cache.get('approvedReviews');
  if (!reviews) {
    reviews = await allAsync("SELECT * FROM reviews WHERE status = 'approved' ORDER BY created_at DESC");
    cache.set('approvedReviews', reviews);
  }
  return reviews;
}

app.get('/', async (req, res) => {
  const houses = await getHouses();
  const reviews = await getApprovedReviews();
  res.render('home', {
    title: 'Baikal Nest',
    houses: houses.slice(0, 5),
    reviews
  });
});

app.get('/catalog', async (req, res) => {
  const houses = await getHouses();
  let filtered = [...houses];
  const guests = req.query.guests || '';
  const type = req.query.type || '';
  const sort = req.query.sort || 'popular';

  if (guests) {
    const [min, max] = guests.split('-').map(Number);
    filtered = filtered.filter((house) => {
      if (guests === '6+') return house.capacity_max >= 6;
      return house.capacity_max >= min && house.capacity_min <= max;
    });
  }

  if (type) filtered = filtered.filter((house) => house.type === type);
  if (sort === 'price') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'capacity') filtered.sort((a, b) => b.capacity_max - a.capacity_max);

  res.render('catalog', {
    title: 'Домики',
    houses: filtered,
    filters: { guests, type, sort }
  });
});

app.get('/houses/:slug', async (req, res) => {
  const house = await getAsync('SELECT * FROM houses WHERE slug = ?', [req.params.slug]);
  if (!house) return res.status(404).render('404', { title: 'Домик не найден' });
  res.render('house', {
    title: house.title,
    house: { ...house, featuresList: parseFeatures(house.features) }
  });
});

app.get('/reviews', async (req, res) => {
  const reviews = await getApprovedReviews();
  res.render('reviews', { title: 'Отзывы', reviews });
});

app.get('/contacts', (req, res) => {
  res.render('contacts', { title: 'Контакты' });
});

app.get('/about', (req, res) => {
  res.render('about', { title: 'О нас' });
});

app.get('/restaurant', (req, res) => {
  res.render('restaurant', { title: 'Ресторан' });
});

app.post('/restaurant/bookings', async (req, res) => {
  const { guest_name, phone, booking_date, booking_time, guests, hotel_guest, comment = '' } = req.body;
  if (!guest_name || !phone || !booking_date || !booking_time || !guests) {
    return res.redirect('/restaurant?error=form');
  }
  const isHotelGuest = hotel_guest === 'on' ? 1 : 0;
  await runAsync(
    `INSERT INTO restaurant_bookings
     (user_id, guest_name, phone, booking_date, booking_time, guests, hotel_guest, discount, status, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.session.user?.id || null, guest_name, phone, booking_date, booking_time, Number(guests), isHotelGuest, isHotelGuest ? 10 : 0, 'new', comment]
  );
  res.redirect('/restaurant?success=restaurant');
});

app.post('/contact', async (req, res) => {
  const { name, phone, message, source = 'contact' } = req.body;
  if (!name || !phone || !message) return res.redirect(`${req.get('referer') || '/contacts'}?error=form`);
  await runAsync(
    'INSERT INTO contact_messages (name, phone, message, source) VALUES (?, ?, ?, ?)',
    [name, phone, message, source]
  );
  res.redirect(`${req.get('referer') || '/contacts'}?success=message`);
});

app.post('/reviews', async (req, res) => {
  const { author, city = '', rating = 5, text } = req.body;
  if (!author || !text) return res.redirect('/reviews?error=form');
  await runAsync(
    'INSERT INTO reviews (user_id, author, city, rating, text, status) VALUES (?, ?, ?, ?, ?, ?)',
    [req.session.user?.id || null, author, city, Math.min(Number(rating) || 5, 5), text, 'pending']
  );
  cache.del('pendingReviews');
  res.redirect('/reviews?success=review');
});

app.post('/bookings', async (req, res) => {
  const { house_id, guest_name, phone, email = '', start_date, end_date, guests, message = '' } = req.body;
  if (!house_id || !guest_name || !phone || !start_date || !end_date || !guests) {
    return res.redirect(req.get('referer') || '/catalog?error=form');
  }

  const house = await getAsync('SELECT * FROM houses WHERE id = ?', [house_id]);
  if (!house) return res.redirect('/catalog?error=house');
  const total = house.price * nightsBetween(start_date, end_date);

  await runAsync(
    `INSERT INTO bookings
     (user_id, house_id, guest_name, phone, email, start_date, end_date, guests, status, total_price, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.session.user?.id || null, house_id, guest_name, phone, email, start_date, end_date, Number(guests), 'new', total, message]
  );
  cache.del('bookings');
  res.redirect('/account?success=booking');
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Вход в аккаунт' });
});

app.post('/login', async (req, res) => {
  const { email, password, role } = req.body;
  const user = await getAsync('SELECT * FROM users WHERE email = ? AND password = ?', [email, password]);
  if (!user) return res.redirect('/login?error=login');
  if (role === 'admin' && user.role !== 'admin') return res.redirect('/login?error=not_admin');
  if (role === 'user' && user.role === 'admin') return res.redirect('/login?error=not_guest');
  req.session.user = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
  res.redirect(user.role === 'admin' ? '/admin' : '/account');
});

app.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.redirect('/login?error=form');
  try {
    const result = await runAsync(
      'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone, password, 'user']
    );
    req.session.user = { id: result.lastID, name, email, phone, role: 'user' };
    res.redirect('/account');
  } catch (err) {
    res.redirect('/login?error=exists');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/account', requireAuth, async (req, res) => {
  if (req.session.user.role === 'admin') return res.redirect('/admin');
  const tab = req.query.tab === 'past' ? 'past' : 'active';
  const today = new Date().toISOString().slice(0, 10);
  const bookings = await allAsync(
    `SELECT bookings.*, houses.title, houses.slug, houses.image
     FROM bookings
     JOIN houses ON houses.id = bookings.house_id
     WHERE bookings.user_id = ?
     ORDER BY bookings.start_date DESC`,
    [req.session.user.id]
  );
  const activeBookings = bookings.filter((booking) => booking.end_date >= today);
  const pastBookings = bookings.filter((booking) => booking.end_date < today);
  const reviews = await allAsync('SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
  res.render('account', {
    title: 'Мои бронирования',
    bookings: tab === 'past' ? pastBookings : activeBookings,
    activeCount: activeBookings.length,
    pastCount: pastBookings.length,
    tab,
    reviews,
    formatDate,
    statusLabel
  });
});

app.post('/account/profile', requireAuth, async (req, res) => {
  const { name, phone } = req.body;
  await runAsync('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone, req.session.user.id]);
  req.session.user.name = name;
  req.session.user.phone = phone;
  res.redirect('/account?success=profile');
});

app.get('/admin', requireAdmin, async (req, res) => {
  const [housesCount, bookingsCount, reviewsCount, usersCount] = await Promise.all([
    getAsync('SELECT COUNT(*) as count FROM houses'),
    getAsync('SELECT COUNT(*) as count FROM bookings'),
    getAsync('SELECT COUNT(*) as count FROM reviews'),
    getAsync('SELECT COUNT(*) as count FROM users')
  ]);
  const recentBookings = await allAsync(
    `SELECT bookings.*, houses.title
     FROM bookings JOIN houses ON houses.id = bookings.house_id
     ORDER BY bookings.created_at DESC LIMIT 3`
  );
  const pendingReviews = await allAsync("SELECT * FROM reviews WHERE status = 'pending' ORDER BY created_at DESC LIMIT 4");
  res.render('admin-dashboard', {
    title: 'Админка',
    stats: {
      houses: housesCount.count,
      bookings: bookingsCount.count,
      reviews: reviewsCount.count,
      users: usersCount.count
    },
    recentBookings,
    pendingReviews,
    formatDate,
    statusLabel
  });
});

app.get('/admin/bookings', requireAdmin, async (req, res) => {
  const bookings = await allAsync(
    `SELECT bookings.*, houses.title
     FROM bookings JOIN houses ON houses.id = bookings.house_id
     ORDER BY bookings.created_at DESC`
  );
  res.render('admin-bookings', { title: 'Бронирования', bookings, formatDate, statusLabel });
});

app.get('/admin/restaurant', requireAdmin, async (req, res) => {
  const bookings = await allAsync('SELECT * FROM restaurant_bookings ORDER BY booking_date DESC, booking_time DESC');
  res.render('admin-restaurant', { title: 'Брони ресторана', bookings, formatDate, statusLabel });
});

app.post('/admin/restaurant/:id/status', requireAdmin, async (req, res) => {
  await runAsync(
    'UPDATE restaurant_bookings SET booking_date = ?, booking_time = ?, status = ? WHERE id = ?',
    [req.body.booking_date, req.body.booking_time, req.body.status, req.params.id]
  );
  res.redirect('/admin/restaurant');
});

app.post('/admin/restaurant/:id/delete', requireAdmin, async (req, res) => {
  await runAsync('DELETE FROM restaurant_bookings WHERE id = ?', [req.params.id]);
  res.redirect('/admin/restaurant');
});

app.post('/admin/bookings/:id/status', requireAdmin, async (req, res) => {
  await runAsync(
    'UPDATE bookings SET start_date = ?, end_date = ?, status = ? WHERE id = ?',
    [req.body.start_date, req.body.end_date, req.body.status, req.params.id]
  );
  cache.del('bookings');
  res.redirect('/admin/bookings');
});

app.post('/admin/bookings/:id/delete', requireAdmin, async (req, res) => {
  await runAsync('DELETE FROM bookings WHERE id = ?', [req.params.id]);
  cache.del('bookings');
  res.redirect('/admin/bookings');
});

app.get('/admin/reviews', requireAdmin, async (req, res) => {
  const reviews = await allAsync("SELECT * FROM reviews WHERE status = 'pending' ORDER BY created_at DESC");
  res.render('admin-reviews', { title: 'Отзывы на модерации', reviews });
});

app.post('/admin/reviews/:id/status', requireAdmin, async (req, res) => {
  await runAsync('UPDATE reviews SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  cache.del('approvedReviews');
  cache.del('pendingReviews');
  res.redirect(req.get('referer') || '/admin/reviews');
});

app.get('/admin/calendar', requireAdmin, async (req, res) => {
  const monthParam = req.query.month || new Date().toISOString().slice(0, 7);
  const [year, month] = monthParam.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const days = Array.from({ length: end.getDate() }, (_, index) => index + 1);
  const prevMonth = monthString(year, month - 2);
  const nextMonth = monthString(year, month);
  const houses = await allAsync('SELECT * FROM houses ORDER BY id LIMIT 8');
  const bookings = await allAsync(
    `SELECT bookings.*, houses.title
     FROM bookings JOIN houses ON houses.id = bookings.house_id
     WHERE bookings.end_date >= ? AND bookings.start_date <= ?
     ORDER BY bookings.start_date`,
    [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
  );
  res.render('admin-calendar', {
    title: 'Календарь бронирований',
    houses,
    bookings,
    days,
    monthParam,
    monthTitle: start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    prevMonth,
    nextMonth
  });
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Страница не найдена' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Baikal Nest started on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database init error:', err);
    process.exit(1);
  });
