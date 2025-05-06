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
const allowed = [
  'http://localhost:3000',
  process.env.FRONTEND_URL,       // Render などに設定した本番フロントのURL
];
const io = new Server(server, {
  cors: {
    origin:  [ 'http://localhost:3000', FRONTEND_URL ],
    methods: ['GET','POST'],
    credentials: true
  }
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
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

// — DMルーム作成 or 取得 —
app.post('/api/rooms/dm', auth, async (req, res) => {
  const peerId = req.body.peerId
  const u1 = Math.min(req.userId, peerId)
  const u2 = Math.max(req.userId, peerId)
  // 友達かチェック
  const fr = await pool.query(
    'SELECT 1 FROM friendships WHERE user1=$1 AND user2=$2',
    [u1, u2]
  )
  if (!fr.rows.length) {
    return res.status(403).json({ error:'友達のみDM可' })
  }
  const roomName = `dm_${u1}_${u2}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 既存ルームがあれば取得、なければ作成
    const { rows: ex } = await client.query(
      'SELECT id FROM rooms WHERE name=$1',
      [roomName]
    )
    let roomId
    if (ex.length) {
      roomId = ex[0].id
    } else {
      const { rows: ins } = await client.query(
        'INSERT INTO rooms(name,created_by) VALUES($1,$2) RETURNING id',
        [roomName, u1]
      )
      roomId = ins[0].id
      await client.query(
        'INSERT INTO participants(room_id,user_id) VALUES($1,$2),($1,$3)',
        [roomId, u1, u2]
      )
    }
    await client.query('COMMIT')
    res.json({ id: roomId })
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(e)
    res.status(500).json({ error:'DMルーム作成失敗' })
  } finally {
    client.release()
  }
})

// — メッセージ履歴取得（グループ＋DM共通） —
app.get('/api/rooms/:roomId/messages', auth, async (req, res) => {
  const { roomId } = req.params
  const { rows } = await pool.query(
    `SELECT u.nickname, m.content, m.created_at
     FROM messages m
     JOIN users u ON u.id=m.user_id
     WHERE m.room_id=$1
     ORDER BY m.created_at ASC
     LIMIT 100`,
    [roomId]
  )
  res.json(rows)
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
// --- 友だち申請作成 ---
app.post('/api/friend-requests', auth, async (req, res) => {
  const { username } = req.body;
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE username=$1',
    [username]
  );
  if (!rows[0]) return res.status(404).json({ error: 'ユーザーが存在しません' });
  const recipient = rows[0].id;
  if (recipient === req.userId) return res.status(400).json({ error:'自分には申請できません' });
  try {
    await pool.query(
      `INSERT INTO friend_requests(requester,recipient) VALUES($1,$2)`,
      [req.userId, recipient]
    );
    res.sendStatus(201);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error:'既に申請済みです' });
    throw e;
  }
});

// --- 受信中の申請一覧取得 ---
app.get('/api/friend-requests', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT fr.id, u.id AS requester_id, u.username, u.nickname, fr.created_at
     FROM friend_requests fr
     JOIN users u ON u.id=fr.requester
     WHERE fr.recipient=$1 AND fr.status='pending'
     ORDER BY fr.created_at ASC`,
    [req.userId]
  );
  res.json(rows);
});

// --- 申請を承認 ---
app.put('/api/friend-requests/:id/accept', auth, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT requester,recipient FROM friend_requests WHERE id=$1 AND recipient=$2 AND status=$3',
      [id, req.userId, 'pending']
    );
    if (!rows[0]) return res.status(404).json({ error:'申請が見つからないか、権限がありません' });
    const { requester, recipient } = rows[0];
    // 双方向に friendship 登録
    const [u1, u2] = requester < recipient ? [requester, recipient] : [recipient, requester];
    await client.query(
      'INSERT INTO friendships(user1,user2) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [u1, u2]
    );
    // リクエストをクローズ
    await client.query(
      'UPDATE friend_requests SET status=$1 WHERE id=$2',
      ['accepted', id]
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

// --- 申請を無視 (削除) ---
app.delete('/api/friend-requests/:id', auth, async (req, res) => {
  const { id } = req.params;
  await pool.query(
    'DELETE FROM friend_requests WHERE id=$1 AND recipient=$2',
    [id, req.userId]
  );
  res.sendStatus(204);
});

// --- 友だち一覧取得 ---
app.get('/api/friends', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.nickname
     FROM friendships f
     JOIN users u ON (u.id = CASE WHEN f.user1=$1 THEN f.user2 ELSE f.user1 END)
     WHERE f.user1=$1 OR f.user2=$1`,
    [req.userId]
  );
  res.json(rows);
});


// — Socket.io —
io.use((socket, next) => {
  try {
    const p = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET)
    socket.userId = p.userId
    socket.nickname = p.nickname
    next()
  } catch {
    next(new Error('認証エラー'))
  }
})

io.on('connection', socket => {
  console.log(`🔌 user ${socket.userId} connected`)

  socket.on('joinRoom', async roomId => {
    const { rows } = await pool.query(
      'SELECT 1 FROM participants WHERE room_id=$1 AND user_id=$2',
      [roomId, socket.userId]
    )
    if (rows.length) {
      socket.join(`room_${roomId}`)
    } else {
      socket.emit('errorMessage','参加権限がありません')
    }
  })

  socket.on('chatMessage', async ({ roomId, content }) => {
    await pool.query(
      'INSERT INTO messages(user_id,room_id,content) VALUES($1,$2,$3)',
      [socket.userId, roomId, content]
    )
    const { rows } = await pool.query(
      'SELECT nickname FROM users WHERE id=$1',
      [socket.userId]
    )
    io.to(`room_${roomId}`).emit('chatMessage', {
      nickname: rows[0].nickname,
      content,
      roomId,
      created_at: new Date()
    })
  })
})

const PORT = process.env.PORT || 4000
server.listen(PORT, () =>
  console.log(`Server listening on ${PORT}`)
)
