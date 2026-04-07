import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { OAuth2Client } from 'google-auth-library';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Health check before anything else
app.get('/health', (req, res) => res.send('OK'));
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DB_PATH = process.env.DATABASE_URL || './database.sqlite';

// Security and Logging
app.use(helmet({
  contentSecurityPolicy: false, // Required for Google Sign-In button
}));

// CORS Configuration
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: IS_PRODUCTION ? allowedOrigins : true,
  credentials: true
}));

app.use(express.json());
app.use(IS_PRODUCTION ? morgan('combined') : morgan('dev'));

const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Database connection error:", err);
  else console.log(`Connected to SQLite Database at ${DB_PATH}`);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    googleId TEXT UNIQUE,
    email TEXT,
    name TEXT,
    avatar TEXT,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    contributions INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 1,
    lastActive TEXT,
    nativeLanguage TEXT DEFAULT 'English',
    learningLanguages TEXT DEFAULT 'Italian',
    theme TEXT DEFAULT 'default'
  )`);
  
  // Migration for theme if it doesn't exist
  db.run("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'default'", (err) => { });

  db.run(`CREATE TABLE IF NOT EXISTS source_texts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT,
    automatedItalian TEXT,
    submitterId INTEGER,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sourceId INTEGER,
    italian TEXT,
    translatedBy INTEGER,
    upvotes INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sourceId) REFERENCES source_texts(id),
    FOREIGN KEY(translatedBy) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS translation_votes (
    userId INTEGER,
    translationId INTEGER,
    voteType INTEGER,
    PRIMARY KEY (userId, translationId)
  )`);

  db.get("SELECT COUNT(*) AS count FROM source_texts", (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO source_texts (english, automatedItalian) VALUES (?, ?)");
      stmt.run("The quick brown fox jumps over the lazy dog.", "La veloce volpe marrone salta sul cane pigro.");
      stmt.run("Could I please get a cup of coffee?", "Potrei avere una tazza di caffè, per favore?");
      stmt.run("I think this application is quite wonderful.", "Penso che questa applicazione sia davvero meravigliosa.");
      stmt.run("Learning new languages creates bridges across the world.", "Imparare nuove lingue crea ponti in tutto il mondo.");
      stmt.finalize();
    }
  });
});

async function verifyGoogleToken(token) {
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    return ticket.getPayload();
  } catch (error) {
    if (GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID_HERE") {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    }
    return null;
  }
}

const authGuard = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const payload = await verifyGoogleToken(token);
  if (!payload && !token.startsWith('guest_token_')) return res.status(401).json({ error: "Invalid token" });

  const searchId = token.startsWith('guest_token_') ? null : payload.sub;
  const query = token.startsWith('guest_token_') ? "SELECT * FROM users WHERE googleId LIKE 'guest_%' AND id = (SELECT id FROM users WHERE googleId LIKE 'guest_%' ORDER BY id DESC LIMIT 1)" : "SELECT * FROM users WHERE googleId = ?";
  const params = token.startsWith('guest_token_') ? [] : [searchId];

  db.get(query, params, (err, user) => {
    if (err || !user) return res.status(404).json({ error: "User not found" });

    const today = new Date().toISOString().split('T')[0];
    if (user.lastActive !== today) {
      let newStreak = user.streak;
      if (user.lastActive) {
        const last = new Date(user.lastActive);
        const now = new Date(today);
        const diffDays = Math.round((now - last) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) newStreak += 1;
        else if (diffDays > 1) newStreak = 1;
      }
      db.run("UPDATE users SET lastActive = ?, streak = ? WHERE id = ?", [today, newStreak, user.id]);
      user.streak = newStreak;
    }
    req.user = user;
    next();
  });
};

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing credential token" });
  const payload = await verifyGoogleToken(credential);
  if (!payload) return res.status(401).json({ error: "Invalid Google Token" });

  const { sub: googleId, email, name, picture: avatar } = payload;
  const today = new Date().toISOString().split('T')[0];

  db.get("SELECT * FROM users WHERE googleId = ?", [googleId], (err, user) => {
    if (user) {
      db.run("UPDATE users SET avatar = ? WHERE id = ?", [avatar, user.id]);
      user.avatar = avatar;
      res.json({ token: credential, user });
    } else {
      db.run("INSERT INTO users (googleId, email, name, avatar, lastActive) VALUES (?, ?, ?, ?, ?)",
        [googleId, email, name, avatar, today], function (err) {
          db.get("SELECT * FROM users WHERE id = ?", [this.lastID], (err, newUser) => {
            res.json({ token: credential, user: newUser });
          });
        });
    }
  });
});

app.post('/api/auth/guest', (req, res) => {
  const guestCredential = "guest_token_" + Date.now();
  const guestId = "guest_" + Math.random().toString(36).substring(7);
  const today = new Date().toISOString().split('T')[0];

  db.run("INSERT INTO users (googleId, email, name, avatar, lastActive) VALUES (?, ?, ?, ?, ?)",
    [guestId, "guest@example.com", "Guest Explorer", "", today], function (err) {
      db.get("SELECT * FROM users WHERE id = ?", [this.lastID], (err, newUser) => {
        res.json({ token: guestCredential, user: newUser });
      });
    });
});

app.get('/api/profile', authGuard, (req, res) => {
  db.get("SELECT COUNT(*) AS total FROM user_translations", (err, row) => {
    req.user.globalTranslations = row ? row.total : 0;
    res.json(req.user);
  });
});

app.post('/api/profile/edit', authGuard, (req, res) => {
  const { name, nativeLanguage, learningLanguages } = req.body;
  db.run("UPDATE users SET name = ?, nativeLanguage = ?, learningLanguages = ? WHERE id = ?",
    [name, nativeLanguage, learningLanguages, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.get('/api/leaderboard', (req, res) => {
  db.all("SELECT id, name, xp as score, avatar, level FROM users ORDER BY xp DESC LIMIT 10", (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/tasks/pending', authGuard, (req, res) => {
  db.get(`
    SELECT s.* FROM source_texts s 
    LEFT JOIN user_translations u ON s.id = u.sourceId AND u.translatedBy = ? 
    WHERE u.id IS NULL LIMIT 1
  `, [req.user.id], (err, row) => {
    if (!row) {
      db.get("SELECT * FROM source_texts ORDER BY RANDOM() LIMIT 1", (err, fallback) => res.json(fallback));
    } else {
      res.json(row);
    }
  });
});

app.post('/api/translations', authGuard, (req, res) => {
  const { sourceId, text } = req.body;
  db.run("INSERT INTO user_translations (sourceId, italian, translatedBy) VALUES (?, ?, ?)",
    [sourceId, text, req.user.id], function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const newXp = req.user.xp + 50;
      const newLevel = Math.floor(newXp / 500) + 1;
      const newContributions = req.user.contributions + 1;

      db.run("UPDATE users SET xp = ?, level = ?, contributions = ? WHERE id = ?",
        [newXp, newLevel, newContributions, req.user.id], (err) => {
          res.json({ success: true, newXp, contributions: newContributions });
        });
    });
});

app.get('/api/reviews', authGuard, (req, res) => {
  db.all(`
    SELECT u.id, u.italian AS translatedText, s.english AS sourceText, usr.name, usr.avatar, u.upvotes 
    FROM user_translations u 
    JOIN source_texts s ON u.sourceId = s.id 
    JOIN users usr ON u.translatedBy = usr.id
    WHERE u.translatedBy != ?
    ORDER BY u.createdAt DESC LIMIT 10
  `, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(`SELECT translationId FROM translation_votes WHERE userId = ?`, [req.user.id], (err, votedRows) => {
      const votedIds = votedRows ? votedRows.map(v => v.translationId) : [];
      const result = rows.map(r => ({ ...r, hasVoted: votedIds.includes(r.id) }));
      res.json(result);
    });
  });
});

app.post('/api/translations/:id/vote', authGuard, (req, res) => {
  const transId = req.params.id;
  db.run("INSERT INTO translation_votes (userId, translationId, voteType) VALUES (?, ?, 1)", [req.user.id, transId], function (err) {
    if (err) return res.status(400).json({ success: false, message: "Already voted" });
    db.run("UPDATE user_translations SET upvotes = upvotes + 1 WHERE id = ?", [transId]);
    db.get("SELECT translatedBy FROM user_translations WHERE id = ?", [transId], (err, t) => {
      if (t) db.run("UPDATE users SET xp = xp + 10 WHERE id = ?", [t.translatedBy]);
    });
    res.json({ success: true });
  });
});

app.post('/api/shop/buy', authGuard, (req, res) => {
  const { cost, itemName } = req.body;
  if (req.user.xp < cost) return res.status(400).json({ error: "Insufficient XP" });
  const newXp = req.user.xp - cost;
  if (itemName === 'streak_freeze') {
    db.run("UPDATE users SET xp = ? WHERE id = ?", [newXp, req.user.id], (err) => {
      if (err) return res.status(500).json({ error: "Purchase Failed" });
      res.json({ success: true, newXp, message: "Streak Freeze unlocked!" });
    });
  } else if (itemName === 'golden_name') {
    db.run("UPDATE users SET xp = ?, theme = ? WHERE id = ?", [newXp, 'golden', req.user.id], (err) => {
      if (err) return res.status(500).json({ error: "Purchase Failed" });
      res.json({ success: true, newXp, message: "Golden Theme enabled!" });
    });
  } else {
    res.status(400).json({ error: "Item not recognized" });
  }
});

// Production Routing
app.use(express.static(path.join(__dirname, 'dist')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kinetic Scholar Live on port ${PORT} (on 0.0.0.0)`);
});
