const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { promisify } = require('util');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);
const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_PREFIX = 'scrypt';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return [PASSWORD_PREFIX, salt, derivedKey.toString('hex')].join(':');
}

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await runAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const userColumns = await allAsync('PRAGMA table_info(users)');
  const userColumnNames = userColumns.map((column) => column.name);
  if (!userColumnNames.includes('password_hash')) {
    await runAsync('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  if (userColumnNames.includes('password')) {
    const legacyUsers = await allAsync('SELECT id, password, password_hash FROM users');
    for (const user of legacyUsers) {
      if (!user.password_hash && user.password) {
        await runAsync('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(user.password), user.id]);
      }
    }

    await runAsync('PRAGMA foreign_keys = OFF');
    await runAsync(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await runAsync(`
      INSERT INTO users_new (id, name, email, phone, password_hash, role, created_at)
      SELECT id, name, email, phone, password_hash, role, created_at FROM users
    `);
    await runAsync('DROP TABLE users');
    await runAsync('ALTER TABLE users_new RENAME TO users');
    await runAsync('PRAGMA foreign_keys = ON');
  }

  await runAsync(`
    CREATE TABLE IF NOT EXISTS houses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      capacity_min INTEGER NOT NULL CHECK (capacity_min > 0),
      capacity_max INTEGER NOT NULL CHECK (capacity_max > 0),
      area INTEGER,
      type TEXT,
      features TEXT,
      image TEXT,
      image_alt TEXT,
      popularity INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      house_id INTEGER NOT NULL,
      guest_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      guests INTEGER NOT NULL CHECK (guests > 0),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'cancelled')),
      total_price INTEGER,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(house_id) REFERENCES houses(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      author TEXT NOT NULL,
      city TEXT,
      rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'contact',
      status TEXT NOT NULL DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS restaurant_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      guest_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      guests INTEGER NOT NULL CHECK (guests > 0),
      hotel_guest INTEGER DEFAULT 0 CHECK (hotel_guest IN (0, 1)),
      discount INTEGER DEFAULT 0 CHECK (discount >= 0),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'cancelled', 'completed', 'seated')),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  const usersCount = await getAsync('SELECT COUNT(*) as count FROM users');
  if (usersCount.count === 0) {
    await runAsync(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES
       (?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?)`,
      [
        'Дмитрий В.',
        'admin@baikalnest.ru',
        '+7 999 123-45-67',
        await hashPassword('admin123'),
        'admin',
        'Александр Петров',
        'alex.p@example.com',
        '+7 900 123-45-67',
        await hashPassword('user123'),
        'user'
      ]
    );
  }

  const housesCount = await getAsync('SELECT COUNT(*) as count FROM houses');
  if (housesCount.count === 0) {
    const houses = [
      ['u-vody', 'У воды', 'Первая линия', 'Домик у самого берега Байкала с террасой, панорамными окнами и спокойной атмосферой для отдыха вдвоем.', 6900, 2, 4, 46, 'water', '2-4 гостя,терраса,вид на Байкал', '/img/nearwater.png', 'Домик у воды', 95],
      ['v-lesu', 'В лесу', 'Среди сосен', 'Тихий домик среди хвойного леса для тех, кто хочет отключиться от города и слышать только природу.', 5400, 2, 3, 38, 'forest', '2-3 гостя,лесной вид,тишина', '/img/in-the-forest.png', 'Домик в лесу', 82],
      ['panoramnyj', 'Панорамный домик', 'Вид на Байкал', 'Уютный домик с панорамными окнами и видом на Байкал. Идеален для спокойного отдыха на природе.', 8200, 2, 4, 58, 'panoramic', '2-4 гостя,вид на Байкал,личная терраса,Wi-Fi,полная кухня', '/img/panoramniy.png', 'Панорамный домик', 100],
      ['semejnyj', 'Семейный', 'Простор', 'Большой теплый дом для семьи или компании с общей гостиной, кухней и местом для вечерних посиделок.', 9800, 4, 6, 120, 'family', '4-6 гостей,детская зона,просторная гостиная', '/img/semeyniy.png', 'Семейный домик', 91],
      ['s-kaminom', 'С камином', 'Живой огонь', 'Атмосферный домик с камином, мягкой зоной отдыха и большими окнами на зимний лес.', 7500, 2, 4, 52, 'fireplace', 'камин,2-4 гостя,зимний уют', '/img/s-kaminom.png', 'Домик с камином', 79],
      ['s-saunoj', 'С сауной', 'Spa & wellness', 'Домик с личной сауной и купелью для восстановления после прогулок по берегу Байкала.', 9200, 2, 4, 60, 'sauna', 'личная сауна,2-4 гостя,купель', '/img/s-saunoy.png', 'Домик с сауной', 88],
      ['mini-domik', 'Мини-домик', 'Для двоих', 'Компактный домик для короткой поездки, где есть все необходимое для отдыха на Байкале.', 4500, 1, 2, 25, 'mini', '1-2 гостя,25 м2,вид на горы', '/img/mini-house.png', 'Мини-домик', 73],
      ['dlya-kompanii', 'Для компании', 'Эксклюзив', 'Просторный коттедж для большой компании с несколькими спальнями, гостиной и зоной отдыха.', 12500, 8, 12, 180, 'company', '8-12 гостей,большая гостиная,панорама', '/img/for-company.png', 'Домик для компании', 84]
    ];

    for (const house of houses) {
      await runAsync(
        `INSERT INTO houses
         (slug, title, subtitle, description, price, capacity_min, capacity_max, area, type, features, image, image_alt, popularity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        house
      );
    }
  }

  const reviewsCount = await getAsync('SELECT COUNT(*) as count FROM reviews');
  if (reviewsCount.count === 0) {
    const reviews = [
      ['Анна', 'Иркутск', 5, 'Отдыхали в домике на выходных — все очень понравилось! Домик уютный, чистый и теплый, внутри есть все необходимое.', 'approved'],
      ['Дмитрий', 'Улан-Удэ', 5, 'Провели выходные в этом прекрасном месте. Стильный домик, удобная мебель, кухня с посудой и техникой.', 'approved'],
      ['Мария К.', 'Иркутск', 5, 'Потрясающее место для перезагрузки. Вид на Байкал из окна просто завораживает.', 'pending'],
      ['Алексей Т.', 'Красноярск', 4, 'Все отлично, но дорога до базы заняла больше времени, чем ожидали. В остальном отдых супер.', 'pending']
    ];
    for (const review of reviews) {
      await runAsync(
        'INSERT INTO reviews (author, city, rating, text, status) VALUES (?, ?, ?, ?, ?)',
        review
      );
    }
  }

  const bookingsCount = await getAsync('SELECT COUNT(*) as count FROM bookings');
  if (bookingsCount.count === 0) {
    await runAsync(
      `INSERT INTO bookings
       (user_id, house_id, guest_name, phone, email, start_date, end_date, guests, status, total_price, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [2, 3, 'Александр Петров', '+7 900 123-45-67', 'alex.p@example.com', '2026-10-12', '2026-10-15', 2, 'confirmed', 20700, 'Хочу домик с видом на Байкал']
    );
    await runAsync(
      `INSERT INTO bookings
       (user_id, house_id, guest_name, phone, email, start_date, end_date, guests, status, total_price, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [2, 1, 'Александр Петров', '+7 900 123-45-67', 'alex.p@example.com', '2026-11-20', '2026-11-22', 2, 'new', 13800, 'Ждем подтверждения']
    );
  }

  const pastBookingsCount = await getAsync("SELECT COUNT(*) as count FROM bookings WHERE end_date < date('now')");
  if (pastBookingsCount.count === 0) {
    await runAsync(
      `INSERT INTO bookings
       (user_id, house_id, guest_name, phone, email, start_date, end_date, guests, status, total_price, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [2, 2, 'Александр Петров', '+7 900 123-45-67', 'alex.p@example.com', '2026-03-10', '2026-03-12', 2, 'confirmed', 10800, 'Прошлая поездка']
    );
  }

  const imageUpdates = [
    ['u-vody', '/img/nearwater.png'],
    ['v-lesu', '/img/in-the-forest.png'],
    ['panoramnyj', '/img/panoramniy.png'],
    ['semejnyj', '/img/semeyniy.png'],
    ['s-kaminom', '/img/s-kaminom.png'],
    ['s-saunoj', '/img/s-saunoy.png'],
    ['mini-domik', '/img/mini-house.png'],
    ['dlya-kompanii', '/img/for-company.png']
  ];
  for (const [slug, image] of imageUpdates) {
    await runAsync('UPDATE houses SET image = ? WHERE slug = ?', [image, slug]);
  }
}

module.exports = {
  db,
  initDb,
  runAsync,
  getAsync,
  allAsync
};
