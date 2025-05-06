require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { Pool } = require('pg');
const cors     = require('cors');

const app    = express();
const server = http.createServer(app);
const FRONTEND_URL = process.env.FRONTEND_URL;
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

// CORS 設定
const allowed = ['http://localhost:3000', FRONTEND_URL];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true
}));
app.use(express.json());

// Socket.io 設定
const io = new Server(server, {
  cors: {
    origin: allowed,
    methods: ['GET','POST'],
    credentials: true
  }
});

// 認証ミドルウェア
const auth = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: '未認証' });
  const token = h.split(' ')[1];
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = p.userId;
    next();
  } catch {
    res.status(401).json({ error: 'トークン無効' });
  }
};

// --- 会員登録 ---
app.post('/api/register', async (req, res) => {
  const { username, password, nickname } = req.body;
  if (!/^[A-Za-z0-9]+$/.test(username)) {
    return res.status(400).json({ error: 'ユーザー名は英数字のみ使用可' });
  }
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ユーザー作成
    const { rows } = await client.query(
      'INSERT INTO users(username,password_hash,nickname) VALUES($1,$2,$3) RETURNING id',
      [username, hash, nickname]
    );
    const userId = rows[0].id;
    // Generalルーム作成（存在しなければ）＋参加
    await client.query(`
      INSERT INTO rooms(name,created_by)
      SELECT 'General',0
      WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE name='General')
    `);
    const gr = await client.query(
      `SELECT id FROM rooms WHERE name='General' LIMIT 1`
    );
    const generalId = gr.rows[0].id;
    await client.query(
      'INSERT INTO participants(room_id,user_id) VALUES($1,$2)',
      [generalId, userId]
    );
    await client.query('COMMIT');
    res.sendStatus(201);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: '登録失敗' });
  } finally {
    client.release();
  }
});

// --- ログイン ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query(
      'SELECT id,password_hash,nickname FROM users WHERE username=$1',
      [username]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: '認証失敗' });
    }
    const token = jwt.sign(
      { userId: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '内部エラー' });
  }
});

// --- 自分情報取得（icon_url含む） ---
app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT username,nickname,icon_url FROM users WHERE id=$1',
    [req.userId]
  );
  res.json(rows[0]);
});

// --- ニックネーム更新 ---
app.put('/api/me/nickname', auth, async (req, res) => {
  await pool.query(
    'UPDATE users SET nickname=$1 WHERE id=$2',
    [req.body.nickname, req.userId]
  );
  res.sendStatus(204);
});

// --- アイコンURL更新 ---
app.put('/api/me/icon', auth, async (req, res) => {
  await pool.query(
    'UPDATE users SET icon_url=$1 WHERE id=$2',
    [req.body.iconUrl, req.userId]
  );
  res.sendStatus(204);
});

// --- 他ユーザー詳細取得 ---
app.get('/api/users/:id', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id,username,nickname,icon_url FROM users WHERE id=$1',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'ユーザーが存在しません' });
  res.json(rows[0]);
});

// --- ルーム一覧取得 ---
app.get('/api/rooms', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id,r.name
     FROM rooms r
     JOIN participants p ON p.room_id=r.id
     WHERE p.user_id=$1
     ORDER BY r.id`,
    [req.userId]
  );
  res.json(rows);
});

// --- ルーム作成（invite_token付き） ---
app.post('/api/rooms', auth, async (req, res) => {
  // 16文字ランダム英数字
  const token = [...Array(16)].map(()=>Math.random().toString(36)[2]).join('');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO rooms(name,created_by,invite_token) VALUES($1,$2,$3) RETURNING id,name,invite_token',
      [req.body.name, req.userId, token]
    );
    const room = rows[0];
    await client.query(
      'INSERT INTO participants(room_id,user_id) VALUES($1,$2)',
      [room.id, req.userId]
    );
    await client.query('COMMIT');
    res.status(201).json(room);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'ルーム作成失敗' });
  } finally {
    client.release();
  }
});

// --- ルーム情報取得（invite_token含む） ---
app.get('/api/rooms/:roomId', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id,name,invite_token FROM rooms WHERE id=$1',
    [req.params.roomId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'ルームが存在しません' });
  res.json(rows[0]);
});

// --- トークンで参加 ---
app.post('/api/rooms/join-by-token', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id FROM rooms WHERE invite_token=$1',
    [req.body.token]
  );
  if (!rows[0]) return res.status(404).json({ error: '招待リンク無効' });
  const roomId = rows[0].id;
  await pool.query(
    'INSERT INTO participants(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [roomId, req.userId]
  );
  res.json({ roomId });
});

// --- グループ／DM共通：招待（ユーザー名） ---
app.post('/api/rooms/:roomId/invite', auth, async (req, res) => {
  const u = await pool.query('SELECT id FROM users WHERE username=$1', [req.body.username]);
  if (!u.rows[0]) return res.status(404).json({ error: 'ユーザーが存在しません' });
  await pool.query(
    'INSERT INTO participants(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [req.params.roomId, u.rows[0].id]
  );
  res.sendStatus(204);
});

// --- メッセージ履歴取得（icon_url含む） ---
app.get('/api/rooms/:roomId/messages', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.nickname, u.icon_url,
            m.content, m.created_at
     FROM messages m
     JOIN users u ON u.id=m.user_id
     WHERE m.room_id=$1
     ORDER BY m.created_at ASC
     LIMIT 100`,
    [req.params.roomId]
  );
  res.json(rows);
});

// --- フレンド申請・承認/拒否・一覧 ---
// （省略せず既存のまま動作）

// --- DMルーム作成／取得 ---
app.post('/api/rooms/dm', auth, async (req, res) => {
  // （既存のまま）
});

// --- Socket.io 認証 & イベント ---
io.use((socket, next) => {
  try {
    const p = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
    socket.userId = p.userId;
    next();
  } catch {
    next(new Error('認証エラー'));
  }
});
io.on('connection', socket => {
  socket.on('joinRoom', async roomId => {
    const { rows } = await pool.query(
      'SELECT 1 FROM participants WHERE room_id=$1 AND user_id=$2',
      [roomId, socket.userId]
    );
    if (rows.length) socket.join(`room_${roomId}`);
    else socket.emit('errorMessage','参加権限がありません');
  });
  socket.on('chatMessage', async ({ roomId, content }) => {
    await pool.query(
      'INSERT INTO messages(user_id,room_id,content) VALUES($1,$2,$3)',
      [socket.userId, roomId, content]
    );
    // 送信者の最新 nickname・icon_url を取得してブロードキャスト
    const u = await pool.query(
      'SELECT nickname,icon_url FROM users WHERE id=$1',
      [socket.userId]
    );
    io.to(`room_${roomId}`).emit('chatMessage', {
      user_id: socket.userId,
      nickname: u.rows[0].nickname,
      icon_url: u.rows[0].icon_url,
      content,
      roomId,
      created_at: new Date()
    });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
