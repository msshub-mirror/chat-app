import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import './App.css';

const API    = 'https://chat-app-backend-rqh4.onrender.com/api';
const SOCKET = 'https://chat-app-backend-rqh4.onrender.com';

// — 汎用オーバーレイ —
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

// — アカウント情報オーバーレイ —
function AccountOverlay({ isOpen, onClose, token, onNicknameChange, onIconChange }) {
  const [info, setInfo] = useState({ username:'', nickname:'', icon_url:'' });
  useEffect(() => {
    if (!isOpen) return;
    axios.get(`${API}/me`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r => setInfo(r.data))
      .catch(console.error);
  }, [isOpen, token]);

  const save = async () => {
    await axios.put(`${API}/me/nickname`, { nickname: info.nickname }, {
      headers:{ Authorization:`Bearer ${token}` }
    });
    await axios.put(`${API}/me/icon`, { iconUrl: info.icon_url }, {
      headers:{ Authorization:`Bearer ${token}` }
    });
    onNicknameChange(info.nickname);
    onIconChange(info.icon_url);
    onClose();
  };

  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>アカウント情報</h2>
      <p>ユーザー名: {info.username}</p>
      <label>ニックネーム</label><br/>
      <input
        value={info.nickname}
        onChange={e => setInfo({ ...info, nickname: e.target.value })}
      /><br/>
      <label>アイコン URL</label><br/>
      <input
        value={info.icon_url}
        onChange={e => setInfo({ ...info, icon_url: e.target.value })}
      /><br/>
      <button onClick={save}>保存</button>
    </Overlay>
  );
}

// — ユーザー詳細オーバーレイ —
function UserDetailOverlay({ isOpen, onClose, token, userId }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (!isOpen || !userId) return;
    axios.get(`${API}/users/${userId}`, {
      headers:{ Authorization:`Bearer ${token}` }
    })
    .then(r => setUser(r.data))
    .catch(console.error);
  }, [isOpen, userId, token]);
  if (!user) return null;
  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>ユーザー詳細</h2>
      <img
        src={user.icon_url || '/default-avatar.png'}
        className="detail-avatar"
        alt="avatar"
      />
      <p>ユーザー名: {user.username}</p>
      <p>ニックネーム: {user.nickname}</p>
    </Overlay>
  );
}

// — 設定オーバーレイ —
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
      { headers: { Authorization:`Bearer ${token}` } }
    );
    alert('パスワードを変更しました');
  };
  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>設定</h2>
      <div>
        <h3>テーマ</h3>
        <select value={theme} onChange={e=>setTheme(e.target.value)}>
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
          onChange={e=>setOldPw(e.target.value)}
        /><br/>
        <input
          type="password"
          placeholder="新しいパスワード"
          value={newPw}
          onChange={e=>setNewPw(e.target.value)}
        /><br/>
        <button onClick={changePw}>変更</button>
      </div>
    </Overlay>
  );
}

// — 招待オーバーレイ —
function InviteOverlay({ isOpen, onClose, inviteToken }) {
  if (!inviteToken) return null;
  const link = `${window.location.origin}/?invite=${inviteToken}`;
  return (
    <Overlay isOpen={isOpen} onClose={onClose}>
      <h2>招待リンク</h2>
      <input readOnly value={link} style={{width:'100%'}}/>
      <button onClick={()=>navigator.clipboard.writeText(link)}>コピー</button>
    </Overlay>
  );
}

// — フレンド管理オーバーレイ —
function FriendOverlay({ isOpen, onClose, token, onChat }) {
  const [username, setUsername] = useState('');
  const [incoming, setIncoming] = useState([]);
  const [friends, setFriends]   = useState([]);
  useEffect(() => {
    if (!isOpen) return;
    axios.get(`${API}/friend-requests`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>setIncoming(r.data))
      .catch(console.error);
    axios.get(`${API}/friends`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>setFriends(r.data))
      .catch(console.error);
  }, [isOpen, token]);
  const sendReq = async () => {
    try {
      await axios.post(`${API}/friend-requests`, { username }, {
        headers:{ Authorization:`Bearer ${token}` }
      });
      alert('申請送信');
      setUsername('');
    } catch (e) {
      alert(e.response?.data?.error||e.message);
    }
  };
  const respond = async (id, accept) => {
    const url = `${API}/friend-requests/${id}` + (accept?'/accept':'');
    const method = accept?'put':'delete';
    try {
      await axios({ method, url, headers:{ Authorization:`Bearer ${token}` } });
      const [iq, fr] = await Promise.all([
        axios.get(`${API}/friend-requests`,{ headers:{ Authorization:`Bearer ${token}` }}),
        axios.get(`${API}/friends`,         { headers:{ Authorization:`Bearer ${token}` }})
      ]);
      setIncoming(iq.data);
      setFriends(fr.data);
    } catch (e) {
      alert(e.response?.data?.error||e.message);
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
          onChange={e=>setUsername(e.target.value)}
        />
        <button onClick={sendReq}>送信</button>
      </div>
      <div style={{marginTop:20}}>
        <h3>受信中の申請</h3>
        {incoming.length
          ? incoming.map(r=>(
              <div key={r.id}>
                {r.nickname}(@{r.username})
                <button onClick={()=>respond(r.id,true)}>承認</button>
                <button onClick={()=>respond(r.id,false)}>無視</button>
              </div>
            ))
          : <p>なし</p>
        }
      </div>
      <div style={{marginTop:20}}>
        <h3>フレンド一覧</h3>
        {friends.length
          ? friends.map(f=>(
              <div key={f.id}>
                {f.nickname}(@{f.username})
                <button onClick={()=>onChat(f.id)}>チャット</button>
              </div>
            ))
          : <p>なし</p>
        }
      </div>
    </Overlay>
  );
}

// — サイドバー —
function Sidebar({
  isOpen, rooms, friends, friendsOpen, setFriendsOpen,
  onRoomChange, onCreateRoom, currentRoom
}) {
  return (
    <nav className={`sidebar ${isOpen?'open':''}`}>
      <div className="sidebar-content">
        <button onClick={onCreateRoom}>＋ルーム作成</button>
        <ul className="rooms-list">
          {rooms.map(r=>(
            <li key={r.id}
                className={r.id===currentRoom?'active':''}
                onClick={()=>onRoomChange(r.id)}>
              {r.name}
            </li>
          ))}
        </ul>
      </div>
      <div className="friends-section">
        <div className="friends-toggle" onClick={()=>setFriendsOpen(o=>!o)}>
          フレンドチャット {friendsOpen?'▼':'▶︎'}
        </div>
        {friendsOpen && (
          <ul className="friends-list">
            {friends.map(f=>(
              <li key={f.id}
                  className={f.dmId===currentRoom?'active':''}
                  onClick={()=>onRoomChange(f.dmId)}>
                {f.nickname}
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

// — メインコンポーネント —
export default function App() {
  const [token,setToken]     = useState(localStorage.getItem('token'));
  const [view,setView]       = useState(token?'chat':'login');
  const [loginUser,setLoginUser]=useState(''),[loginPw,setLoginPw]=useState('');
  const [regUser,setRegUser] = useState(''),[regPw,setRegPw]=useState('');
  const [regNick,setRegNick] = useState('');
  const [rooms,setRooms]     = useState([]);
  const [friends,setFriends] = useState([]);
  const [friendsOpen,setFriendsOpen]=useState(false);
  const [currentRoom,setCurrentRoom]=useState(null);
  const [inviteToken,setInviteToken]=useState(null);
  const [chat,setChat]       = useState([]);
  const [socket,setSocket]   = useState(null);
  const [msg,setMsg]         = useState('');
  const [theme,setTheme]     = useState(localStorage.getItem('theme')||'line');
  const [isAccOpen,setAccOpen]=useState(false);
  const [isSetOpen,setSetOpen]=useState(false);
  const [isInvOpen,setInvOpen]=useState(false);
  const [isFriendMgmtOpen,setFriendMgmtOpen]=useState(false);
  const [userDetailId,setUserDetailId]=useState(null);
  const [isUserDetailOpen,setUserDetailOpen]=useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const bottomRef = useRef(null);

  // テーマ適用
  useEffect(()=>{ document.body.className=`theme-${theme}` },[theme]);

  // 招待リンクがあればトークンで参加
  useEffect(()=>{
    if(view==='chat'&&token){
      const url = new URL(window.location.href);
      const inv = url.searchParams.get('invite');
      if(inv){
        axios.post(`${API}/rooms/join-by-token`,{ token:inv },{
          headers:{ Authorization:`Bearer ${token}` }
        })
        .then(r=> setCurrentRoom(r.data.roomId))
        .catch(console.error)
        .finally(()=>{
          url.searchParams.delete('invite');
          window.history.replaceState({},'',url.toString());
        });
      }
    }
  },[view,token]);

  // Socket.io 接続
  useEffect(()=>{
    if(view==='chat'&&token){
      const s = io(SOCKET, { auth:{ token }, transports:['websocket'] });
      s.on('chatMessage',data=>{
        if(data.roomId===currentRoom) setChat(prev=>[...prev,data]);
      });
      setSocket(s);
      return()=>s.disconnect();
    }
  },[view,token,currentRoom]);

  // ルーム & フレンド一覧取得
  useEffect(()=>{
    if(view==='chat'&&token){
      axios.get(`${API}/rooms`,{headers:{Authorization:`Bearer ${token}`}})
        .then(r=>setRooms(r.data.filter(r=>r.name!=='General')));
      axios.get(`${API}/friends`,{headers:{Authorization:`Bearer ${token}`}})
        .then(r=>setFriends(r.data.map(f=>({...f,dmId:null}))));
    }
  },[view,token]);

  // フレンドDMルームID取得
  useEffect(()=>{
    if(socket&&friends.length){
      friends.forEach((f,i)=>{
        axios.post(`${API}/rooms/dm`,{ peerId:f.id },{
          headers:{ Authorization:`Bearer ${token}` }
        }).then(r=>{
          setFriends(prev=>{
            const a=[...prev]; a[i].dmId=r.data.id; return a;
          });
        }).catch(()=>{});
      });
    }
  },[friends,socket,token]);

  // ルーム切替時：join + 履歴 + invite token 取得
  useEffect(()=>{
    if(socket&&currentRoom!=null){
      (async()=>{
        socket.emit('joinRoom',currentRoom);
        const msgRes = await axios.get(`${API}/rooms/${currentRoom}/messages`,{
          headers:{ Authorization:`Bearer ${token}` }
        });
        setChat(msgRes.data);
        const infoRes = await axios.get(`${API}/rooms/${currentRoom}`,{
          headers:{ Authorization:`Bearer ${token}` }
        });
        setInviteToken(infoRes.data.invite_token);
      })().catch(console.error);
    }
  },[currentRoom,socket,token]);

  // 自動スクロール
  useEffect(()=>{
    bottomRef.current?.scrollIntoView({ behavior:'smooth' });
  },[chat]);

  // メッセージ表示用
  const renderMessage = text => text.split(/(https?:\/\/[^\s]+)/g).map((p,i)=>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
      : p
  );

  // Handlers
  const clearState = () => {
    setRooms([]); setCurrentRoom(null); setChat([]);
    socket?.disconnect(); setSocket(null);
  };
  const handleLogin=async()=>{
    clearState();
    try{
      const { data } = await axios.post(`${API}/login`,{
        username:loginUser,password:loginPw
      });
      localStorage.setItem('token',data.token);
      setToken(data.token); setView('chat');
    }catch(e){
      alert('ログイン失敗:'+ (e.response?.data?.error||e.message));
    }
  };
  const handleRegister=async()=>{
    clearState();
    try{
      await axios.post(`${API}/register`,{
        username:regUser,password:regPw,nickname:regNick
      });
      alert('登録完了！ログインしてください');
      setView('login');
    }catch(e){
      alert('登録失敗:'+ (e.response?.data?.error||e.message));
    }
  };
  const handleLogout=()=>{
    localStorage.removeItem('token');
    setView('login'); setToken(null);
    clearState();
  };
  const sendMessage=()=>{
    if(!msg||currentRoom==null) return;
    socket.emit('chatMessage',{ roomId:currentRoom, content:msg });
    setMsg('');
  };
  const createRoom=async()=>{
    const name = prompt('新しいルーム名を入力');
    if(!name) return;
    const { data } = await axios.post(`${API}/rooms`,{ name },{
      headers:{ Authorization:`Bearer ${token}` }
    });
    setRooms(prev=>[...prev,data]);
    setCurrentRoom(data.id);
  };
  const startDM = peerId => {
    const fm = friends.find(f=>f.id===peerId);
    if(fm?.dmId) setCurrentRoom(fm.dmId);
  };

  // --- Render ---
  if(view==='login'){
    return (
      <div className="form">
        <h2>ログイン</h2>
        <input placeholder="ユーザー名" value={loginUser}
               onChange={e=>setLoginUser(e.target.value)}/><br/>
        <input type="password" placeholder="パスワード" value={loginPw}
               onChange={e=>setLoginPw(e.target.value)}/><br/>
        <button onClick={handleLogin}>ログイン</button>
        <p>アカウントがない方は
          <button onClick={()=>setView('register')}>登録</button>
        </p>
      </div>
    );
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
        <p>アカウントがある方は
          <button onClick={()=>setView('login')}>ログイン</button>
        </p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <button onClick={()=>setIsSidebarOpen(o=>!o)}>☰</button>
        <h1>チャットルーム</h1>
        <div className="header-buttons">
          <button onClick={()=>setAccOpen(true)}>アカウント</button>
          <button onClick={()=>setFriendMgmtOpen(true)}>フレンド管理</button>
          <button onClick={()=>setSetOpen(true)}>設定</button>
          <button onClick={()=>setInvOpen(true)} disabled={currentRoom==null}>
            招待
          </button>
          <button onClick={createRoom}>＋ルーム作成</button>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

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

      <main className={`main ${isSidebarOpen?'shifted':''}`}>
        <div className="chat-box">
          {chat.map((c,i)=>(
            <div key={i} className="message">
              <img
                src={c.icon_url||'/default-avatar.png'}
                className="message-avatar"
                alt="avatar"
                onClick={()=>{ setUserDetailId(c.user_id); setUserDetailOpen(true); }}
              />
              <div className="message-body">
                <div className="message-header">{c.nickname}</div>
                <div className="message-text">{renderMessage(c.content)}</div>
              </div>
            </div>
          ))}
          <div ref={bottomRef}/>
        </div>
        <div className="input-area">
          <input
            placeholder="メッセージを入力…"
            value={msg}
            onChange={e=>setMsg(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&sendMessage()}
          />
          <button onClick={sendMessage}>送信</button>
        </div>
      </main>

      <AccountOverlay
        isOpen={isAccOpen}
        onClose={()=>setAccOpen(false)}
        token={token}
        onNicknameChange={()=>{}}
        onIconChange={()=>{}}
      />
      <UserDetailOverlay
        isOpen={isUserDetailOpen}
        onClose={()=>setUserDetailOpen(false)}
        token={token}
        userId={userDetailId}
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
        inviteToken={inviteToken}
      />
      <FriendOverlay
        isOpen={isFriendMgmtOpen}
        onClose={()=>setFriendMgmtOpen(false)}
        token={token}
        onChat={startDM}
      />
    </div>
  );
}
