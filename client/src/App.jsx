import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';

// 追加: デフォルトアバター
const DEFAULT_AVATAR = 'https://placehold.co/40x40?text=👤';

const API    = 'https://chat-app-backend-rqh4.onrender.com/api';
const SOCKET = 'https://chat-app-backend-rqh4.onrender.com';

/* ===================== 共通オーバーレイ ===================== */
function Overlay({ isOpen, onClose, children }) {
  if (!isOpen) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ===================== ユーザー詳細オーバーレイ ===================== */
function UserDetailOverlay({ isOpen, onClose, user }) {
  if (!isOpen || !user) return null;
  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <img src={user.avatar_url || DEFAULT_AVATAR} alt="avatar" style={{ width: 96, height: 96, borderRadius: '50%' }} />
      <h2 style={{ margin: '0.5em 0 0' }}>{user.nickname}</h2>
      <p style={{ color: '#666', margin: 0 }}>@{user.username}</p>
    </Overlay>
  );
}

/* ===================== アカウント設定オーバーレイ ===================== */
function AccountOverlay({ isOpen, onClose, token, onUpdateMe }) {
  const [info, setInfo] = useState({ username: '', nickname: '', avatar_url: '' });
  const [file, setFile] = useState(null);
  useEffect(() => {
    if (!isOpen) return;
    axios.get(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })
         .then(r => setInfo(r.data))
         .catch(console.error);
  }, [isOpen, token]);

  // ニックネーム保存
  const save = async () => {
    await axios.put(`${API}/me/nickname`, { nickname: info.nickname }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    onUpdateMe({ ...info });
    onClose();
  };

  // アバターアップロード
  const uploadAvatar = async () => {
    if (!file) return alert('画像を選択してください');
    const fd = new FormData();
    fd.append('avatar', file);
    const { data } = await axios.post(`${API}/me/avatar`, fd, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setInfo(prev => ({ ...prev, avatar_url: data.avatar_url }));
    onUpdateMe({ ...info, avatar_url: data.avatar_url });
  };

  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>アカウント情報</h2>
      <img
        src={info.avatar_url || DEFAULT_AVATAR}
        alt="avatar"
        style={{ width: 64, height: 64, borderRadius: '50%' }}
      />
      <div style={{ marginTop: 8 }}>
        <input type="file" accept="image/*" onChange={e => setFile(e.target.files[0])} />
        <button onClick={uploadAvatar}>アップロード</button>
      </div>
      <p>ユーザー名: {info.username}</p>
      <label>ニックネーム</label><br/>
      <input
        value={info.nickname}
        onChange={e => setInfo({ ...info, nickname: e.target.value })}
      /><br/>
      <button onClick={save}>保存</button>
    </Overlay>
  );
}

/* ===================== 既存: 設定 / 招待 / フレンド管理オーバーレイ ===================== */
// ・・・既存の SettingsOverlay, InviteOverlay, FriendOverlay コンポーネントは変更なし・・・
/* （元のコードをそのまま残しています） */

/* ++++++++++ 省略せず元の SettingsOverlay, InviteOverlay, FriendOverlay コンポーネントをここに貼り付ける ++++++++++ */
/*   - コードが長いため、ここでは割愛していますが、v1.0.0-App.jsx の該当部分をそのまま保持してください   */

// --- 設定オーバーレイ ---
function SettingsOverlay({ isOpen, onClose, token, applyTheme }) {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'line');
  const [oldPw, setOldPw] = useState(''), [newPw, setNewPw] = useState('');
  const saveTheme = () => {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    onClose();
  };
  const changePw = async () => {
    await axios.put(`${API}/me/password`,
      { oldPassword: oldPw, newPassword: newPw },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    alert('パスワードを変更しました');
  };
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
  );
}

// --- 招待オーバーレイ ---
function InviteOverlay({ isOpen, onClose, token, roomId }) {
  if (!roomId) return null;
  const [mode, setMode] = useState('username');
  const [username, setUsername] = useState('');
  const inviteLink = `${window.location.origin}/?invite=${roomId}`;
  const inviteByName = async () => {
    await axios.post(`${API}/rooms/${roomId}/invite`,
      { username },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    alert('招待しました');
    onClose();
  };
  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>招待</h2>
      <button onClick={() => setMode('username')}>ユーザー名で招待</button>
      <button onClick={() => setMode('link')}>リンクで招待</button>
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
          <input readOnly value={inviteLink} style={{ width: '100%' }}/><br/>
          <button onClick={() => navigator.clipboard.writeText(inviteLink)}>
            コピー
          </button>
        </>
      )}
    </Overlay>
  );
}

// --- フレンド管理オーバーレイ ---
function FriendOverlay({ isOpen, onClose, token, onChat }) {
  const [username, setUsername] = useState('');
  const [incoming, setIncoming] = useState([]);
  const [friends, setFriends]   = useState([]);
  useEffect(() => {
    if (!isOpen) return;
    axios.get(`${API}/friend-requests`, { headers: { Authorization: `Bearer ${token}` } })
         .then(r => setIncoming(r.data)).catch(console.error);
    axios.get(`${API}/friends`, { headers: { Authorization: `Bearer ${token}` } })
         .then(r => setFriends(r.data)).catch(console.error);
  }, [isOpen, token]);
  const sendReq = async () => {
    try {
      await axios.post(`${API}/friend-requests`, { username }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('申請送信');
      setUsername('');
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
  };
  const respond = async (id, accept) => {
    const url = `${API}/friend-requests/${id}` + (accept ? '/accept' : '');
    const method = accept ? 'put' : 'delete';
    try {
      await axios({ method, url, headers: { Authorization: `Bearer ${token}` } });
      // 再取得
      const [iq, fr] = await Promise.all([
        axios.get(`${API}/friend-requests`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/friends`,          { headers: { Authorization: `Bearer ${token}` } })
      ]);
      setIncoming(iq.data);
      setFriends(fr.data);
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
  };
  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>フレンド管理</h2>
      <div>
        <h3>申請を送る</h3>
        <input
          placeholder="ユーザー名"
          value={username}
          onChange={e => setUsername(e.target.value)}
        /><button onClick={sendReq}>送信</button>
      </div>
      <div style={{ marginTop:20 }}>
        <h3>受信中の申請</h3>
        {incoming.length ? incoming.map(r => (
          <div key={r.id}>
            {r.nickname}(@{r.username})
            <button onClick={() => respond(r.id,true)}>承認</button>
            <button onClick={() => respond(r.id,false)}>無視</button>
          </div>
        )) : <p>なし</p>}
      </div>
      <div style={{ marginTop:20 }}>
        <h3>フレンド一覧</h3>
        {friends.length ? friends.map(f => (
          <div key={f.id}>
            {f.nickname}(@{f.username})
            <button onClick={() => onChat(f.id)}>チャット</button>
          </div>
        )) : <p>なし</p>}
      </div>
    </Overlay>
  );
}

/* ===================== サイドバー ===================== */
// v1.0.0 と変更なし

function Sidebar({ isOpen, rooms, friends, friendsOpen, setFriendsOpen, onRoomChange, onCreateRoom, currentRoom }) {
  return (
    <nav className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-content">
        <button onClick={onCreateRoom}>＋ルーム作成</button>
        <ul className="rooms-list">
          {rooms.map(r => (
            <li
              key={r.id}
              className={r.id === currentRoom ? 'active' : ''}
              onClick={() => onRoomChange(r.id)}
            >
              {r.name}
            </li>
          ))}
        </ul>
      </div>
      <div className="friends-section">
        <div className="friends-toggle" onClick={() => setFriendsOpen(o => !o)}>
          フレンドチャット {friendsOpen ? '▼' : '▶︎'}
        </div>
        {friendsOpen && (
          <ul className="friends-list">
            {friends.map(f => (
              <li
                key={f.id}
                className={f.dmId === currentRoom ? 'active' : ''}
                onClick={() => onRoomChange(f.dmId)}
              >
                {f.nickname}
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

/* ===================== メインアプリ ===================== */
export default function App() {
  /* -------- State -------- */
  const [token, setToken]             = useState(localStorage.getItem('token'));
  const [view, setView]               = useState(token ? 'chat' : 'login');
  const [loginUser, setLoginUser]     = useState('');
  const [loginPw, setLoginPw]         = useState('');
  const [regUser, setRegUser]         = useState('');
  const [regPw, setRegPw]             = useState('');
  const [regNick, setRegNick]         = useState('');
  const [me, setMe]                   = useState({ username: '', nickname: '', avatar_url: '' });
  const [rooms, setRooms]             = useState([]);
  const [friends, setFriends]         = useState([]);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [chat, setChat]               = useState([]);
  const [socket, setSocket]           = useState(null);
  const [msg, setMsg]                 = useState('');
  const [isSidebarOpen, setSidebar]   = useState(true);
  const [isAccOpen, setAccOpen]       = useState(false);
  const [isSetOpen, setSetOpen]       = useState(false);
  const [isInvOpen, setInvOpen]       = useState(false);
  const [isFriendMgmtOpen, setFriendMgmtOpen] = useState(false);
  const [detailUser, setDetailUser]   = useState(null); // 追加: ユーザー詳細表示
  const [theme, setTheme]             = useState(localStorage.getItem('theme') || 'line');
  const bottomRef = useRef(null);

  /* -------- テーマ適用 -------- */
  useEffect(() => { document.body.className = `theme-${theme}`; }, [theme]);

  /* -------- Socket.io 接続 -------- */
  useEffect(() => {
    if (view !== 'chat' || !token) return;
    const s = io(SOCKET, { auth: { token }, transports: ['websocket'] });
    s.on('chatMessage', data => {
      if (data.roomId === currentRoom) setChat(prev => [...prev, data]);
    });
    setSocket(s);
    return () => s.disconnect();
  }, [view, token, currentRoom]);

  /* -------- ルーム & フレンド取得 -------- */
  useEffect(() => {
    if (view !== 'chat' || !token) return;
    const headers = { Authorization: `Bearer ${token}` };
    axios.get(`${API}/me`, { headers }).then(r => setMe(r.data));
    axios.get(`${API}/rooms`, { headers })
         .then(r => setRooms(r.data.filter(rm => rm.name !== 'General' && !rm.name.startsWith('dm_'))));
    axios.get(`${API}/friends`, { headers }).then(r => setFriends(r.data));
  }, [view, token]);

  /* -------- DM ルーム ID プリフェッチ -------- */
  useEffect(() => {
    if (!socket || !friends.length) return;
    friends.forEach((f, idx) => {
      axios.post(`${API}/rooms/dm`, { peerId: f.id }, { headers: { Authorization: `Bearer ${token}` } })
           .then(r => setFriends(prev => { const cp = [...prev]; cp[idx].dmId = r.data.id; return cp; }));
    });
  }, [friends, socket]);

  /* -------- ルーム切替 -------- */
  useEffect(() => {
    if (!socket || currentRoom == null) return;
    socket.emit('joinRoom', currentRoom);
    axios.get(`${API}/rooms/${currentRoom}/messages`, { headers: { Authorization: `Bearer ${token}` } })
         .then(r => setChat(r.data));
  }, [currentRoom, socket, token]);

  /* -------- 自動スクロール -------- */
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  /* -------- ユーティリティ -------- */
  const renderMessage = text => text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part);

  const clearState = () => { setRooms([]); setCurrentRoom(null); setChat([]); socket?.disconnect(); setSocket(null); };

  /* -------- 認証 -------- */
  const handleLogin = async () => {
    clearState();
    try {
      const { data } = await axios.post(`${API}/login`, { username: loginUser, password: loginPw });
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setView('chat');
    } catch (err) { alert('ログイン失敗: ' + (err.response?.data?.error || err.message)); }
  };
  const handleRegister = async () => {
    clearState();
    try {
      await axios.post(`${API}/register`, { username: regUser, password: regPw, nickname: regNick });
      alert('登録完了！ログインしてください');
      setView('login');
    } catch (err) { alert('登録失敗: ' + (err.response?.data?.error || err.message)); }
  };
  const handleLogout = () => { localStorage.removeItem('token'); setView('login'); setToken(null); clearState(); };

  /* -------- メッセージ送信 -------- */
  const sendMessage = () => {
    if (!msg || currentRoom == null) return;
    socket.emit('chatMessage', { roomId: currentRoom, content: msg });
    setMsg('');
  };

  /* -------- ルーム作成 -------- */
  const createRoom = async () => {
    const name = prompt('新しいルーム名を入力');
    if (!name) return;
    const { data } = await axios.post(`${API}/rooms`, { name }, { headers: { Authorization: `Bearer ${token}` } });
    setRooms(prev => [...prev, data]);
    setCurrentRoom(data.id);
  };

  /* -------- DM 開始 -------- */
  const startDM = peerId => {
    const fm = friends.find(f => f.id === peerId);
    if (fm?.dmId) setCurrentRoom(fm.dmId);
  };

  /* ===================== レンダリング ===================== */
  if (view === 'login') {
    return (
      <div className="form">
        <h2>ログイン</h2>
        <input placeholder="ユーザー名" value={loginUser} onChange={e => setLoginUser(e.target.value)} /><br/>
        <input type="password" placeholder="パスワード" value={loginPw} onChange={e => setLoginPw(e.target.value)} /><br/>
        <button onClick={handleLogin}>ログイン</button>
        <p>アカウントがない方は <button onClick={() => setView('register')}>登録</button></p>
      </div>
    );
  }

  if (view === 'register') {
    return (
      <div className="form">
        <h2>会員登録</h2>
        <input placeholder="ユーザー名" value={regUser} onChange={e => setRegUser(e.target.value)} /><br/>
        <input placeholder="ニックネーム" value={regNick} onChange={e => setRegNick(e.target.value)} /><br/>
        <input type="password" placeholder="パスワード" value={regPw} onChange={e => setRegPw(e.target.value)} /><br/>
        <button onClick={handleRegister}>登録</button>
        <p>アカウントがある方は <button onClick={() => setView('login')}>ログイン</button></p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* ---------- ヘッダー ---------- */}
      <header className="header">
        <button onClick={() => setSidebar(o => !o)}>☰</button>
        <h1>チャットルーム</h1>
        <div className="header-buttons">
          <button onClick={() => setAccOpen(true)}>アカウント</button>
          <button onClick={() => setFriendMgmtOpen(true)}>フレンド管理</button>
          <button onClick={() => setSetOpen(true)}>設定</button>
          <button onClick={() => setInvOpen(true)} disabled={currentRoom == null}>招待</button>
          <button onClick={createRoom}>＋ルーム作成</button>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      {/* ---------- サイドバー ---------- */}
      <Sidebar
        isOpen={isSidebarOpen}
        rooms={rooms}
        friends={friends}
        friendsOpen={friendsOpen}
        setFriendsOpen={setFriendsOpen}
        onRoomChange={setCurrentRoom}
        onCreateRoom={createRoom}
        currentRoom={currentRoom}
      />

      {/* ---------- チャット本体 ---------- */}
      <main className={`main ${isSidebarOpen ? 'shifted' : ''}`}>
        <div className="chat-box">
          {chat.map((c, i) => (
            <div className="msg" key={i}>
              <img
                className="avatar"
                src={c.avatar_url || DEFAULT_AVATAR}
                alt="avatar"
                onClick={() => setDetailUser(c)}
              />
              <div className="msg-body">
                <div className="name">{c.nickname}</div>
                <div className="text">{renderMessage(c.content)}</div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="input-area">
          <input
            placeholder="メッセージを入力…"
            value={msg}
            onChange={e => setMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
          />
          <button onClick={sendMessage}>送信</button>
        </div>
      </main>

      {/* ---------- 各種オーバーレイ ---------- */}
      <AccountOverlay
        isOpen={isAccOpen}
        onClose={() => setAccOpen(false)}
        token={token}
        onUpdateMe={u => setMe(u)}
      />
      <SettingsOverlay
        isOpen={isSetOpen}
        onClose={() => setSetOpen(false)}
        token={token}
        applyTheme={t => setTheme(t)}
      />
      <InviteOverlay
        isOpen={isInvOpen}
        onClose={() => setInvOpen(false)}
        token={token}
        roomId={currentRoom}
      />
      <FriendOverlay
        isOpen={isFriendMgmtOpen}
        onClose={() => setFriendMgmtOpen(false)}
        token={token}
        onChat={startDM}
      />
    </div>
      <UserDetailOverlay
        isOpen={!!detailUser}
        onClose={() => setDetailUser(null)}
        user={detailUser}
      />
    </div>
  );
}
