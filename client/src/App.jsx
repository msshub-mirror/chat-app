// client/src/App.jsx
import './App.css'
import React, { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import axios from 'axios'

const API    = 'http://localhost:4000/api'
const SOCKET = 'http://localhost:4000'

// 共通オーバーレイコンポーネント
function Overlay({ isOpen, onClose, children }) {
  if (!isOpen) return null
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// アカウント情報オーバーレイ
function AccountOverlay({ isOpen, onClose, token, onNicknameChange }) {
  const [info, setInfo] = useState({ username:'', nickname:'' })
  useEffect(() => {
    if (isOpen) {
      axios.get(`${API}/me`, {
        headers:{ Authorization:`Bearer ${token}` }
      }).then(r => setInfo(r.data))
    }
  }, [isOpen, token])

  const save = async () => {
    await axios.put(`${API}/me/nickname`,
      { nickname: info.nickname },
      { headers:{ Authorization:`Bearer ${token}` } }
    )
    onNicknameChange(info.nickname)
    onClose()
  }

  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>アカウント情報</h2>
      <p>ユーザー名: {info.username}</p>
      <label>ニックネーム</label><br/>
      <input
        value={info.nickname}
        onChange={e => setInfo({ ...info, nickname: e.target.value })}
      /><br/>
      <button onClick={save}>保存</button>
    </Overlay>
  )
}

// 設定オーバーレイ
function SettingsOverlay({ isOpen, onClose, token, applyTheme }) {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'line')
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')

  const saveTheme = () => {
    localStorage.setItem('theme', theme)
    applyTheme(theme)
    onClose()
  }
  const changePw = async () => {
    await axios.put(`${API}/me/password`,
      { oldPassword: oldPw, newPassword: newPw },
      { headers:{ Authorization:`Bearer ${token}` } }
    )
    alert('パスワードを変更しました')
  }

  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>設定</h2>
      <div>
        <h3>テーマ</h3>
        <select value={theme} onChange={e => setTheme(e.target.value)}>
          <option value="line">LINE風</option>
          <option value="discord">Discord風</option>
          <option value="x">X風</option>
        </select>
        <button onClick={saveTheme}>適用</button>
      </div>
      <div style={{ marginTop: '1em' }}>
        <h3>パスワード変更</h3>
        <input
          type="password"
          placeholder="現在のパスワード"
          value={oldPw}
          onChange={e => setOldPw(e.target.value)}
        /><br/>
        <input
          type="password"
          placeholder="新しいパスワード"
          value={newPw}
          onChange={e => setNewPw(e.target.value)}
        /><br/>
        <button onClick={changePw}>変更</button>
      </div>
    </Overlay>
  )
}

// 招待オーバーレイ
function InviteOverlay({ isOpen, onClose, token, roomId }) {
  const [mode, setMode]         = useState('username') // or 'link'
  const [username, setUsername] = useState('')
  const inviteLink = `${window.location.origin}/?invite=${roomId}`

  const inviteByName = async () => {
    await axios.post(`${API}/rooms/${roomId}/invite`,
      { username },
      { headers:{ Authorization:`Bearer ${token}` } }
    )
    alert('招待しました')
    onClose()
  }

  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>招待</h2>
      <div style={{ marginBottom:12 }}>
        <button onClick={()=>setMode('username')}>ユーザー名招待</button>
        <button onClick={()=>setMode('link')}>リンク招待</button>
      </div>
      {mode === 'username' ? (
        <>
          <input
            placeholder="ユーザー名を入力"
            value={username}
            onChange={e => setUsername(e.target.value)}
          /><br/>
          <button onClick={inviteByName}>招待</button>
        </>
      ) : (
        <>
          <p>このリンクで参加できます：</p>
          <input readOnly value={inviteLink} style={{ width:'100%' }}/><br/>
          <button onClick={()=>navigator.clipboard.writeText(inviteLink)}>
            リンクをコピー
          </button>
        </>
      )}
    </Overlay>
  )
}

// サイドバー
function Sidebar({ isOpen, rooms, currentRoom, onRoomChange, onCreateRoom }) {
  return (
    <nav className={`sidebar ${isOpen?'open':''}`}>
      <button onClick={onCreateRoom}>＋ルーム作成</button>
      <ul>
        {rooms.map(r=>(
          <li key={r.id}
              className={r.id===currentRoom?'active':''}
              onClick={()=>onRoomChange(r.id)}>
            {r.name}
          </li>
        ))}
      </ul>
    </nav>
  )
}

// メインアプリ
export default function App() {
  const [token, setToken]             = useState(localStorage.getItem('token'))
  const [view, setView]               = useState(token?'chat':'login')
  const [loginUser, setLoginUser]     = useState('')
  const [loginPw, setLoginPw]         = useState('')
  const [regUser, setRegUser]         = useState('')
  const [regPw, setRegPw]             = useState('')
  const [regNick, setRegNick]         = useState('')
  const [rooms, setRooms]             = useState([])
  const [currentRoom, setCurrentRoom] = useState(null)
  const [chat, setChat]               = useState([])
  const [socket, setSocket]           = useState(null)
  const [msg, setMsg]                 = useState('')
  const [isSidebarOpen, setSidebar]   = useState(true)
  const [isAccOpen, setAccOpen]       = useState(false)
  const [isSetOpen, setSetOpen]       = useState(false)
  const [isInvOpen, setInvOpen]       = useState(false)
  const [theme, setTheme]             = useState(localStorage.getItem('theme')||'line')

  const bottomRef      = useRef(null)
  const currentRoomRef = useRef(currentRoom)

  // テーマ適用
  useEffect(() => {
    document.body.className = `theme-${theme}`
  }, [theme])

  // URL invite パラメータで自動参加・遷移
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const inv = p.get('invite')
    if (view==='chat' && token && inv) {
      axios.post(`${API}/rooms/${inv}/join`, {}, {
        headers:{ Authorization:`Bearer ${token}` }
      }).then(() => setCurrentRoom(Number(inv)))
        .finally(() => {
          p.delete('invite')
          window.history.replaceState({},'',window.location.pathname)
        })
    }
  }, [view, token])

  // ルーム一覧取得（General を除外）
  useEffect(() => {
    if (view==='chat' && token) {
      axios.get(`${API}/rooms`, {
        headers:{ Authorization:`Bearer ${token}` }
      }).then(r => {
        const filtered = r.data.filter(rm => rm.name !== 'General')
        setRooms(filtered)
        if (currentRoom===null && filtered.length) {
          setCurrentRoom(filtered[0].id)
        }
      })
    }
  }, [view, token])

  // currentRoom を ref に同期
  useEffect(() => {
    currentRoomRef.current = currentRoom
  }, [currentRoom])

  // Socket.io 接続＆リスナー
  useEffect(() => {
    if (view==='chat' && token) {
      const s = io(SOCKET, { auth:{ token } })
      s.on('connect', () => {
        if (currentRoomRef.current != null) {
          s.emit('joinRoom', currentRoomRef.current)
        }
      })
      s.on('chatMessage', data => {
        if (data.roomId === currentRoomRef.current) {
          setChat(prev => [...prev, data])
        }
      })
      setSocket(s)
      return () => s.disconnect()
    }
  }, [view, token])

  // ルーム切替時 join と履歴取得
  useEffect(() => {
    if (view==='chat' && socket && currentRoom != null) {
      socket.emit('joinRoom', currentRoom)
      axios.get(`${API}/rooms/${currentRoom}/messages`, {
        headers:{ Authorization:`Bearer ${token}` }
      }).then(r => setChat(r.data))
    }
  }, [currentRoom, view, socket, token])

  // 自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [chat])

  // ステートクリア
  const clearState = () => {
    setRooms([])
    setCurrentRoom(null)
    setChat([])
    if (socket) socket.disconnect()
    setSocket(null)
  }

  // ハンドラ
  const handleLogin = async () => {
    clearState()
    const { data } = await axios.post(`${API}/login`, {
      username:loginUser, password:loginPw
    })
    localStorage.setItem('token', data.token)
    setToken(data.token)
    setView('chat')
  }
  const handleRegister = async () => {
    await axios.post(`${API}/register`, {
      username:regUser, password:regPw, nickname:regNick
    })
    alert('登録完了！ログインしてください')
    setView('login')
  }
  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setView('login')
    clearState()
  }
  const send = () => {
    if (socket && msg && currentRoom != null) {
      socket.emit('chatMessage',{ roomId:currentRoom, content:msg })
      setMsg('')
    }
  }
  const handleCreateRoom = async () => {
    const name = prompt('新しいルーム名を入力')
    if (!name) return
    const { data } = await axios.post(`${API}/rooms`, { name }, {
      headers:{ Authorization:`Bearer ${token}` }
    })
    setRooms(prev => prev.concat(data))
    setCurrentRoom(data.id)
  }

  // レンダリング
  if (view==='login') {
    return (
      <div className="form">
        <h2>ログイン</h2>
        <input placeholder="ユーザー名" value={loginUser}
               onChange={e=>setLoginUser(e.target.value)}/> <br/>
        <input type="password" placeholder="パスワード" value={loginPw}
               onChange={e=>setLoginPw(e.target.value)}/> <br/>
        <button onClick={handleLogin}>ログイン</button>
        <p>アカウントがない方は
          <button onClick={()=>setView('register')}>登録</button>
        </p>
      </div>
    )
  }
  if (view==='register') {
    return (
      <div className="form">
        <h2>会員登録</h2>
        <input placeholder="ユーザー名" value={regUser}
               onChange={e=>setRegUser(e.target.value)}/> <br/>
        <input placeholder="ニックネーム" value={regNick}
               onChange={e=>setRegNick(e.target.value)}/> <br/>
        <input type="password" placeholder="パスワード" value={regPw}
               onChange={e=>setRegPw(e.target.value)}/> <br/>
        <button onClick={handleRegister}>登録</button>
        <p>アカウントがある方は
          <button onClick={()=>setView('login')}>ログイン</button>
        </p>
      </div>
    )
  }

  return (
    <div className="app-container">
      <header className="header">
        <button onClick={()=>setSidebar(o=>!o)}>☰</button>
        <h1>チャットルーム</h1>
        <div className="header-buttons">
          <button onClick={()=>setAccOpen(true)}>アカウント</button>
          <button onClick={()=>setSetOpen(true)}>設定</button>
          <button onClick={()=>setInvOpen(true)}>招待</button>
          <button onClick={handleCreateRoom}>＋ルーム作成</button>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      <Sidebar
        isOpen={isSidebarOpen}
        rooms={rooms}
        currentRoom={currentRoom}
        onRoomChange={setCurrentRoom}
        onCreateRoom={handleCreateRoom}
      />

      <main className={`main ${isSidebarOpen?'shifted':''}`}>
        <div className="chat-box">
          {chat.map((c,i)=>(
            <div key={i}>
              <strong>{c.nickname}</strong>: {c.content}
            </div>
          ))}
          <div ref={bottomRef}/>
        </div>
        <div className="input-area">
          <input
            placeholder="メッセージを入力..."
            value={msg}
            onChange={e=>setMsg(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&send()}
          />
          <button onClick={send}>送信</button>
        </div>
      </main>

      <AccountOverlay
        isOpen={isAccOpen}
        onClose={()=>setAccOpen(false)}
        token={token}
        onNicknameChange={()=>{}}
      />
      <SettingsOverlay
        isOpen={isSetOpen}
        onClose={()=>setSetOpen(false)}
        token={token}
        applyTheme={t=>setTheme(t)}
      />
      <InviteOverlay
        isOpen={isInvOpen}
        onClose={()=>setInvOpen(false)}
        token={token}
        roomId={currentRoom}
      />
    </div>
  )
}
