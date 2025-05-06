require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const FRONTEND_URL = process.env.FRONTEND_URL;
const pool   = new Pool({ connectionString: process.env.DATABASE_URL });

const storage = multer.diskStorage({
   destination: (_req, _file, cb) => cb(null, 'uploads'),
   filename: (_req, file, cb) => cb(null, uuidv4() + '-' + file.originalname)
 });
 const upload = multer({ storage });

 // 画像を配信
 app.use('/uploads', express.static('uploads'));

// CORS
const allowed = ['http://localhost:3000', FRONTEND_URL];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json());

// Socket.io
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
    const { rows } = await client.query(
      'INSERT INTO users(username,password_hash,nickname) VALUES($1,$2,$3) RETURNING id',
      [username, hash, nickname]
    );
    const userId = rows[0].id;
    // General ルーム自動作成 & 参加
    await client.query(`
      INSERT INTO rooms(name,created_by)
      SELECT 'General',0
      WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE name='General')
    `);
    const { rows: gr } = await client.query(
      `SELECT id FROM rooms WHERE name='General' LIMIT 1`
    );
    const generalId = gr[0].id;
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

// --- 自分情報取得 ---
app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT username,nickname,avatar_url FROM users WHERE id=$1',
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

// --- パスワード変更 ---
app.put('/api/me/password', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT password_hash FROM users WHERE id=$1', [req.userId]
  );
  if (!(await bcrypt.compare(req.body.oldPassword, rows[0].password_hash))) {
    return res.status(400).json({ error: '現在のパスワードが違います' });
  }
  const newHash = await bcrypt.hash(req.body.newPassword, 10);
  await pool.query(
    'UPDATE users SET password_hash=$1 WHERE id=$2',
    [newHash, req.userId]
  );
  res.sendStatus(204);
});

// --- ルーム一覧 ---
app.get('/api/rooms', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.name
     FROM rooms r
     JOIN participants p ON p.room_id = r.id
     WHERE p.user_id = $1
     ORDER BY r.id`,
    [req.userId]
  );
  res.json(rows);
});

// --- ルーム作成 ---
app.post('/api/rooms', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO rooms(name,created_by) VALUES($1,$2) RETURNING id,name',
      [req.body.name, req.userId]
    );
    await client.query(
      'INSERT INTO participants(room_id,user_id) VALUES($1,$2)',
      [rows[0].id, req.userId]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'ルーム作成失敗' });
  } finally {
    client.release();
  }
});

// --- 招待（ユーザー名 or リンク） ---
app.post('/api/rooms/:roomId/invite', auth, async (req, res) => {
  const u = await pool.query('SELECT id FROM users WHERE username=$1', [req.body.username]);
  if (!u.rows[0]) return res.status(404).json({ error: 'ユーザーが存在しません' });
  await pool.query(
    'INSERT INTO participants(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [req.params.roomId, u.rows[0].id]
  );
  res.sendStatus(204);
});
app.post('/api/rooms/:roomId/join', auth, async (req, res) => {
  await pool.query(
    'INSERT INTO participants(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [req.params.roomId, req.userId]
  );
  res.sendStatus(204);
});
app.post('/api/me/avatar', auth, upload.single('avatar'), async (req, res) => {
  const url = req.file ? `/uploads/${req.file.filename}` : null;
  if (!url) return res.status(400).json({ error: 'ファイルがありません' });
  await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [url, req.userId]);
  res.json({ avatar_url: url });
});


// --- メッセージ履歴取得（グループ＆DM共通） ---
app.get('/api/rooms/:roomId/messages', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.nickname, u.avatar_url, m.content, m.created_at
     FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.room_id = $1
     ORDER BY m.created_at ASC
     LIMIT 100`,
    [req.params.roomId]
  );
  res.json(rows);
});

// --- フレンド申請 & 承認/拒否 & 一覧 ---
app.post('/api/friend-requests', auth, async (req, res) => {
  const u = await pool.query('SELECT id FROM users WHERE username=$1', [req.body.username]);
  if (!u.rows[0]) return res.status(404).json({ error: 'ユーザーが存在しません' });
  if (u.rows[0].id === req.userId) return res.status(400).json({ error: '自分には申請できません' });
  try {
    await pool.query(
      'INSERT INTO friend_requests(requester,recipient) VALUES($1,$2)',
      [req.userId, u.rows[0].id]
    );
    res.sendStatus(201);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: '既に申請済みです' });
    throw e;
  }
});
app.get('/api/friend-requests', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT fr.id, u.username, u.nickname
     FROM friend_requests fr
     JOIN users u ON u.id = fr.requester
     WHERE fr.recipient = $1 AND fr.status = 'pending'
     ORDER BY fr.created_at`,
    [req.userId]
  );
  res.json(rows);
});
app.put('/api/friend-requests/:id/accept', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT requester FROM friend_requests WHERE id=$1 AND recipient=$2 AND status=$3',
      [req.params.id, req.userId, 'pending']
    );
    if (!rows[0]) return res.status(404).json({ error: '申請が見つかりません' });
    const [u1,u2] = rows[0].requester < req.userId
      ? [rows[0].requester, req.userId]
      : [req.userId, rows[0].requester];
    await client.query(
      'INSERT INTO friendships(user1,user2) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [u1, u2]
    );
    await client.query(
      'UPDATE friend_requests SET status=$1 WHERE id=$2',
      ['accepted', req.params.id]
    );
    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});
app.delete('/api/friend-requests/:id', auth, async (req, res) => {
  await pool.query(
    'DELETE FROM friend_requests WHERE id=$1 AND recipient=$2',
    [req.params.id, req.userId]
  );
  res.sendStatus(204);
});
app.get('/api/friends', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.nickname
     FROM friendships f
     JOIN users u ON (
       u.id = CASE WHEN f.user1=$1 THEN f.user2 ELSE f.user1 END
     )
     WHERE f.user1=$1 OR f.user2=$1`,
    [req.userId]
  );
  res.json(rows);
});

// --- DMルーム作成／取得 ---
app.post('/api/rooms/dm', auth, async (req, res) => {
  const peerId = req.body.peerId;
  const [u1,u2] = peerId < req.userId
    ? [peerId, req.userId]
    : [req.userId, peerId];
  // 友達チェック
  const fr = await pool.query(
    'SELECT 1 FROM friendships WHERE user1=$1 AND user2=$2',
    [u1, u2]
  );
  if (!fr.rows.length) return res.status(403).json({ error: '友達のみDM可' });
  const roomName = `dm_${u1}_${u2}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = await client.query(
      'SELECT id FROM rooms WHERE name=$1',
      [roomName]
    );
    let roomId;
    if (ex.rows.length) {
      roomId = ex.rows[0].id;
    } else {
      const ins = await client.query(
        'INSERT INTO rooms(name,created_by) VALUES($1,$2) RETURNING id',
        [roomName, u1]
      );
      roomId = ins.rows[0].id;
      await client.query(
        'INSERT INTO participants(room_id,user_id) VALUES($1,$2),($1,$3)',
        [roomId, u1, u2]
      );
    }
    await client.query('COMMIT');
    res.json({ id: roomId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'DMルーム作成失敗' });
  } finally {
    client.release();
  }
});

// --- Socket.io 認証 & イベント ---
io.use((socket, next) => {
  try {
    const p = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
    socket.userId   = p.userId;
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
    else socket.emit('errorMessage', '参加権限がありません');
  });
  socket.on('chatMessage', async ({ roomId, content }) => {
    await pool.query(
      'INSERT INTO messages(user_id,room_id,content) VALUES($1,$2,$3)',
      [socket.userId, roomId, content]
    );
    const nick = (await pool.query(
      'SELECT nickname FROM users WHERE id=$1',
      [socket.userId]
    )).rows[0].nickname;
    io.to(`room_${roomId}`).emit('chatMessage', {
      nickname: nick,
      content,
      roomId,
      created_at: new Date()
    });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
