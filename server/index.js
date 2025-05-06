require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { Pool } = require('pg')
const cors = require('cors')

const app = express()
const server = http.createServer(app)
const FRONTEND_URL = process.env.FRONTEND_URL;  // Render の環境変数で設定しておく
const io = new Server(server, {
  cors: {
    origin:  [ 'http://localhost:3000', FRONTEND_URL ],
    methods: ['GET','POST'],
    credentials: true
  }
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

app.use(cors())
app.use(express.json())

// 認証ミドルウェア
const auth = (req, res, next) => {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: '未認証' })
  const token = header.split(' ')[1]
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.userId   = payload.userId
    req.nickname = payload.nickname
    next()
  } catch {
    res.status(401).json({ error: 'トークン無効' })
  }
}

// 会員登録
app.post('/api/register', async (req, res) => {
  const { username, password, nickname } = req.body
  if (!/^[A-Za-z0-9]+$/.test(username)) {
    return res.status(400).json({ error: 'ユーザー名は英数字のみ使用可' })
  }
  const hash = await bcrypt.hash(password, 10)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'INSERT INTO users(username,password_hash,nickname) VALUES($1,$2,$3) RETURNING id',
      [username, hash, nickname]
    )
    const userId = rows[0].id
    // デフォルトルーム"General"に参加
    // SELECT の前に…
await client.query(
  `INSERT INTO rooms(name, created_by)
   SELECT 'General', 0
   WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE name='General')`
)

// その後で id を取る
const { rows: rs } = await client.query(
  `SELECT id FROM rooms WHERE name='General' LIMIT 1`
)
const generalId = rs[0].id

    await client.query(
      'INSERT INTO participants(room_id,user_id) VALUES($1,$2)',
      [generalId, userId]
    )
    await client.query('COMMIT')
    res.sendStatus(201)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(e)
    res.status(500).json({ error: '登録失敗' })
  } finally {
    client.release()
  }
})

// ログイン
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query(
      'SELECT id,password_hash,nickname FROM users WHERE username=$1',
      [username]
    );
    const user = rows[0];
    // ユーザーがいない or パスワード不一致
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: '認証失敗' });
    }
    const token = jwt.sign(
      { userId: user.id, nickname: user.nickname },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({ token });
  } catch (e) {
    console.error('LOGIN ERROR:', e);
    return res.status(500).json({ error: e.message || '内部エラー' });
  }
});


// 自分情報取得
app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT username,nickname FROM users WHERE id=$1',
    [req.userId]
  )
  res.json(rows[0])
})

// ニックネーム更新
app.put('/api/me/nickname', auth, async (req, res) => {
  const { nickname } = req.body
  await pool.query(
    'UPDATE users SET nickname=$1 WHERE id=$2',
    [nickname, req.userId]
  )
  res.sendStatus(204)
})

// パスワード変更
app.put('/api/me/password', auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body
  const { rows } = await pool.query(
    'SELECT password_hash FROM users WHERE id=$1',
    [req.userId]
  )
  if (!(await bcrypt.compare(oldPassword, rows[0].password_hash))) {
    return res.status(400).json({ error: '現在のパスワードが違います' })
  }
  const hash = await bcrypt.hash(newPassword, 10)
  await pool.query(
    'UPDATE users SET password_hash=$1 WHERE id=$2',
    [hash, req.userId]
  )
  res.sendStatus(204)
})

// ルーム一覧取得
app.get('/api/rooms', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.name
     FROM rooms r
     JOIN participants p ON p.room_id = r.id
     WHERE p.user_id = $1
     ORDER BY r.id`,
    [req.userId]
  )
  res.json(rows)
})

// ルーム作成 & 自動参加
app.post('/api/rooms', auth, async (req, res) => {
  const { name } = req.body
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'INSERT INTO rooms(name,created_by) VALUES($1,$2) RETURNING id,name',
      [name, req.userId]
    )
    const room = rows[0]
    await client.query(
      'INSERT INTO participants(room_id,user_id) VALUES($1,$2)',
      [room.id, req.userId]
    )
    await client.query('COMMIT')
    res.status(201).json(room)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(e)
    res.status(500).json({ error: 'ルーム作成失敗' })
  } finally {
    client.release()
  }
})

// ルーム参加者一覧取得
app.get(
  '/api/rooms/:roomId/participants',
  auth,
  async (req, res) => {
    const { roomId } = req.params
    const { rows } = await pool.query(
      `SELECT u.id,u.username,u.nickname
       FROM participants p
       JOIN users u ON u.id=p.user_id
       WHERE p.room_id=$1`,
      [roomId]
    )
    res.json(rows)
  }
)

// ルーム招待
app.post(
  '/api/rooms/:roomId/invite',
  auth,
  async (req, res) => {
    const { roomId } = req.params
    const { username } = req.body
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE username=$1',
      [username]
    )
    if (!rows[0]) {
      return res.status(404).json({ error: 'ユーザーが存在しません' })
    }
    await pool.query(
      'INSERT INTO participants(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [roomId, rows[0].id]
    )
    res.sendStatus(204)
  }
)
// リンクから参加
app.post('/api/rooms/:roomId/join', auth, async (req, res) => {
  const { roomId } = req.params
  await pool.query(
    'INSERT INTO participants(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [roomId, req.userId]
  )
  res.sendStatus(204)
})

// ルーム内メッセージ履歴取得
app.get(
  '/api/rooms/:roomId/messages',
  auth,
  async (req, res) => {
    const { roomId } = req.params
    const { rows } = await pool.query(
      `SELECT u.nickname,m.content,m.created_at
       FROM messages m
       JOIN users u ON u.id=m.user_id
       WHERE m.room_id=$1
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [roomId]
    )
    res.json(rows)
  }
)

// --- Socket.io ---
io.use((socket, next) => {
  try {
    const p = jwt.verify(
      socket.handshake.auth.token,
      process.env.JWT_SECRET
    )
    socket.userId   = p.userId
    socket.nickname = p.nickname
    next()
  } catch {
    next(new Error('認証エラー'))
  }
})

io.on('connection', (socket) => {
  console.log(`🔌 ${socket.nickname} connected`)

  // ルーム参加
  socket.on('joinRoom', async (roomId) => {
    const { rows } = await pool.query(
      'SELECT 1 FROM participants WHERE room_id=$1 AND user_id=$2',
      [roomId, socket.userId]
    )
    if (rows.length) {
      socket.join(`room_${roomId}`)
    } else {
      socket.emit('errorMessage', 'このルームには参加していません')
    }
  })

  // メッセージ受信・保存・配信
  socket.on('chatMessage', async ({ roomId, content }) => {
    await pool.query(
      'INSERT INTO messages(user_id,room_id,content) VALUES($1,$2,$3)',
      [socket.userId, roomId, content]
    )
    const { rows } = await pool.query(
      'SELECT nickname FROM users WHERE id=$1',
      [socket.userId]
    )
    const nickname = rows[0].nickname
    io.to(`room_${roomId}`).emit('chatMessage', {
      nickname,
      content,
      roomId,
      created_at: new Date()
    })
  })

  socket.on('disconnect', () => {
    console.log(`❎ ${socket.nickname} disconnected`)
  })
})

const PORT = process.env.PORT || 4000
server.listen(PORT, () =>
  console.log(`Server listening on ${PORT}`)
)
