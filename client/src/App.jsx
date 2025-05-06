import './App.css'
import React, { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import axios from 'axios'

const API    = 'https://chat-app-backend-rqh4.onrender.com/api'
const SOCKET = 'https://chat-app-backend-rqh4.onrender.com'

// — 共通オーバーレイコンポーネント —
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

// — アカウント情報オーバーレイ —
function AccountOverlay({ isOpen, onClose, token, onNicknameChange }) {
  const [info, setInfo] = useState({ username:'', nickname:'' })
  useEffect(() => {
    if (isOpen) {
      axios.get(`${API}/me`, { headers:{ Authorization:`Bearer ${token}` } })
           .then(r => setInfo(r.data))
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

// — 設定オーバーレイ —
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
      <div style={{ marginTop:'1em' }}>
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

// — 招待オーバーレイ —
function InviteOverlay({ isOpen, onClose, token, roomId }) {
  if (!roomId) return null
  const [mode, setMode] = useState('username')
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
        <button onClick={()=>setMode('username')}>ユーザー名で招待</button>
        <button onClick={()=>setMode('link')}>リンクで招待</button>
      </div>
      {mode==='username' ? (
        <>
          <input
            placeholder="ユーザー名を入力"
            value={username}
            onChange={e=>setUsername(e.target.value)}
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

// — フレンド管理オーバーレイ —
function FriendOverlay({ isOpen, onClose, token, onChat }) {
  const [username, setUsername] = useState('')
  const [incoming, setIncoming] = useState([])
  const [friends, setFriends]   = useState([])

  useEffect(()=>{
    if(!isOpen) return
    axios.get(`${API}/friend-requests`, { headers:{ Authorization:`Bearer ${token}` } })
         .then(r=>setIncoming(r.data))
    axios.get(`${API}/friends`, { headers:{ Authorization:`Bearer ${token}` } })
         .then(r=>setFriends(r.data))
  },[isOpen, token])

  const sendReq = async () => {
    try {
      await axios.post(`${API}/friend-requests`,
        { username },
        { headers:{ Authorization:`Bearer ${token}` } }
      )
      alert('申請送信')
      setUsername('')
    } catch(e){
      alert(e.response?.data?.error||e.message)
    }
  }

  const respond = async (id, accept) => {
    const url = `${API}/friend-requests/${id}` + (accept?'/accept':'')
    const method = accept? 'put' : 'delete'
    try {
      await axios({ method, url, headers:{ Authorization:`Bearer ${token}` } })
      // 再取得
      const [iq, fr] = await Promise.all([
        axios.get(`${API}/friend-requests`,{ headers:{ Authorization:`Bearer ${token}` }}),
        axios.get(`${API}/friends`,{ headers:{ Authorization:`Bearer ${token}` }})
      ])
      setIncoming(iq.data)
      setFriends(fr.data)
    } catch(e){
      alert(e.response?.data?.error||e.message)
    }
  }

  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>フレンド管理</h2>
      <div>
        <h3>申請を送る</h3>
        <input
          placeholder="ユーザー名"
          value={username}
          onChange={e=>setUsername(e.target.value)}
        />
        <button onClick={sendReq}>送信</button>
      </div>
      <div style={{ marginTop:20 }}>
        <h3>受信中の申請</h3>
        {incoming.length
          ? incoming.map(r=>(
              <div key={r.id} className="friend-request">
                {r.nickname} (@{r.username})
                <button onClick={()=>respond(r.id,true)}>承認</button>
                <button onClick={()=>respond(r.id,false)}>無視</button>
              </div>
            ))
          : <p>申請はありません</p>
        }
      </div>
      <div style={{ marginTop:20 }}>
        <h3>フレンド一覧</h3>
        {friends.length
          ? friends.map(f=>(
              <div key={f.id} className="friend-item">
                {f.nickname} (@{f.username})
                <button onClick={()=>onChat(f.id)}>チャット</button>
              </div>
            ))
          : <p>フレンドなし</p>
        }
      </div>
    </Overlay>
  )
}

// — サイドバー —
function Sidebar({
  isOpen, rooms, friends, friendsOpen, setFriendsOpen,
  onRoomChange, onCreateRoom
}) {
  return (
    <nav className={`sidebar ${isOpen?'open':''}`}>
      <button onClick={onCreateRoom}>＋ルーム作成</button>
      <ul>
        {rooms.map(r=>(
          <li key={r.id}
              className={r.id===r.current?'active':''}
              onClick={()=>onRoomChange(r.id)}>
            {r.name}
          </li>
        ))}
        <li className="header"
            onClick={()=>setFriendsOpen(o=>!o)}>
          フレンドチャット {friendsOpen?'▼':'▶'}
        </li>
        {friendsOpen && friends.map(f=>(
          <li key={f.id}
              onClick={()=>onRoomChange({ dm:true, peerId:f.id })}>
            {f.nickname}
          </li>
        ))}
      </ul>
    </nav>
  )
}

// — メインコンポーネント —
export default function App() {
  const [token, setToken]             = useState(localStorage.getItem('token'))
  const [view, setView]               = useState(token?'chat':'login')
  const [loginUser, setLoginUser]     = useState('')
  const [loginPw, setLoginPw]         = useState('')
  const [regUser, setRegUser]         = useState('')
  const [regPw, setRegPw]             = useState('')
  const [regNick, setRegNick]         = useState('')
  const [rooms, setRooms]             = useState([])
  const [friends, setFriends]         = useState([])
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [currentRoom, setCurrentRoom] = useState(null)
  const [chat, setChat]               = useState([])
  const [socket, setSocket]           = useState(null)
  const [msg, setMsg]                 = useState('')
  const [isSidebarOpen, setSidebar]   = useState(true)
  const [isAccOpen, setAccOpen]       = useState(false)
  const [isSetOpen, setSetOpen]       = useState(false)
  const [isInvOpen, setInvOpen]       = useState(false)
  const [isFriendMgmtOpen, setFriendMgmtOpen] = useState(false)
  const [theme, setTheme]             = useState(localStorage.getItem('theme')||'line')

  const bottomRef      = useRef(null)
  const currentRef     = useRef(currentRoom)

  // ページ全体の背景カラー適用
  useEffect(()=>{ document.body.className = `theme-${theme}` },[theme])

  // ローム一覧取得
  useEffect(()=>{
    if(view==='chat'&&token){
      axios.get(`${API}/rooms`,{ headers:{Authorization:`Bearer ${token}`} })
           .then(r=>setRooms(r.data.filter(rm=>rm.name!=='General')))
      axios.get(`${API}/friends`,{ headers:{Authorization:`Bearer ${token}`} })
           .then(r=>setFriends(r.data))
    }
  },[view,token])

  // invite URL 自動参加
  useEffect(()=>{
    const p = new URLSearchParams(window.location.search)
    const inv = p.get('invite')
    if(view==='chat'&&token&&inv){
      axios.post(`${API}/rooms/${inv}/join`,{},{
        headers:{Authorization:`Bearer ${token}`}
      }).then(()=>setCurrentRoom(Number(inv)))
        .finally(()=>{
          p.delete('invite')
          window.history.replaceState({},'',window.location.pathname)
        })
    }
  },[view,token])

  // socket.io 接続
  useEffect(()=>{
    if(view==='chat'&&token){
      const s = io(SOCKET,{ auth:{ token } })
      setSocket(s)
      return ()=>s.disconnect()
    }
  },[view,token])

  // room 変更時の参加＆履歴取得
  useEffect(()=>{
    if(view==='chat'&&socket&&currentRoom!=null){
      const joinAndLoad = async () => {
        let rid = currentRoom
        // DM起点
        if(typeof currentRoom==='object' && currentRoom.dm){
          const { data } = await axios.post(
            `${API}/rooms/dm`,
            { peerId: currentRoom.peerId },
            { headers:{ Authorization:`Bearer ${token}` } }
          )
          rid = data.id
        }
        // join
        socket.emit('joinRoom', rid)
        // 履歴
        const res = await axios.get(
          `${API}/rooms/${rid}/messages`,
          { headers:{ Authorization:`Bearer ${token}` } }
        )
        setChat(res.data)
      }
      joinAndLoad().catch(console.error)
    }
  },[currentRoom,view,socket,token])

  // 自動スクロール
  useEffect(()=>{
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  },[chat])

  // メッセージ内リンク検出
  const renderMessage = text => {
    return text.split(/(https?:\/\/[^\s]+)/g).map((part,i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
        : part
    )
  }

  const clearState = () => {
    setRooms([]); setFriends([]); setChat([])
    if(socket) socket.disconnect(); setSocket(null)
  }

  // Handlers
  const handleLogin = async () => {
    clearState()
    try {
      const { data } = await axios.post(`${API}/login`,{
        username:loginUser, password:loginPw
      })
      localStorage.setItem('token', data.token)
      setToken(data.token); setView('chat')
    } catch (err) {
      alert('ログインに失敗しました: ' + (err.response?.data?.error||err.message))
    }
  }
  const handleRegister = async () => {
    clearState()
    try {
      await axios.post(`${API}/register`,{
        username:regUser, password:regPw, nickname:regNick
      })
      alert('登録完了！ログインしてください')
      setView('login')
    } catch (err) {
      alert('登録に失敗しました: ' + (err.response?.data?.error||err.message))
    }
  }
  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null); setView('login'); clearState()
  }
  const send = () => {
    if(socket&&msg&&currentRoom!=null){
      // いまの currentRoom がオブジェクト(dm)なら、POST /api/rooms/dmで取得した numeric rid に join しているので
      // socket.emit には履歴取得済みの rid を渡せば OK
      socket.emit('chatMessage',{ roomId: currentRoom, content: msg })
      setMsg('')
    }
  }
  const handleCreateRoom = async () => {
    const name = prompt('新しいルーム名を入力')
    if(!name) return
    const { data } = await axios.post(
      `${API}/rooms`,
      { name },
      { headers:{ Authorization:`Bearer ${token}` } }
    )
    setRooms(prev=>[...prev,data])
    setCurrentRoom(data.id)
  }
  const handleRoomChange = rm => {
    setChat([])       // 一旦クリア
    setCurrentRoom(rm)
  }
  const openFriendChat = peerId => {
    handleRoomChange({ dm:true, peerId })
    setFriendsOpen(false)
  }

  // Render
  if(view==='login') {
    return (
      <div className="form">
        <h2>ログイン</h2>
        <input placeholder="ユーザー名" value={loginUser}
               onChange={e=>setLoginUser(e.target.value)}/><br/>
        <input type="password" placeholder="パスワード" value={loginPw}
               onChange={e=>setLoginPw(e.target.value)}/><br/>
        <button onClick={handleLogin}>ログイン</button>
        <p>
          アカウントがない方は
          <button onClick={()=>setView('register')}>登録</button>
        </p>
      </div>
    )
  }
  if(view==='register'){
    return (
      <div className="form">
        <h2>会員登録</h2>
        <input placeholder="ユーザー名" value={regUser}
               onChange={e=>setRegUser(e.target.value)}/><br/>
        <input placeholder="ニックネーム" value={regNick}
               onChange={e=>setRegNick(e.target.value)}/><br/>
        <input type="password" placeholder="パスワード" value={regPw}
               onChange={e=>setRegPw(e.target.value)}/><br/>
        <button onClick={handleRegister}>登録</button>
        <p>
          アカウントがある方は
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
          <button onClick={()=>setFriendMgmtOpen(true)}>フレンド管理</button>
          <button onClick={()=>setSetOpen(true)}>設定</button>
          <button
            onClick={()=>currentRoom && setInvOpen(true)}
            disabled={!currentRoom}
          >
            招待
          </button>
          <button onClick={handleCreateRoom}>＋ルーム作成</button>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      <Sidebar
        isOpen={isSidebarOpen}
        rooms={rooms}
        friends={friends}
        friendsOpen={friendsOpen}
        setFriendsOpen={setFriendsOpen}
        onRoomChange={handleRoomChange}
        onCreateRoom={handleCreateRoom}
      />

      <main className={`main ${isSidebarOpen?'shifted':''}`}>
        <div className="chat-box">
          {chat.map((c,i)=>(
            <div key={i}>
              <strong>{c.nickname}</strong>: {renderMessage(c.content)}
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
      <FriendOverlay
        isOpen={isFriendMgmtOpen}
        onClose={()=>setFriendMgmtOpen(false)}
        token={token}
        onChat={openFriendChat}
      />
    </div>
  )
}
