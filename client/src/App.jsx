import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api";
import { createWsClient } from "./ws";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000/ws";

function fmtTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function useToast() {
  const [toast, setToast] = useState(null);
  function show(message, type = "info") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }
  return { toast, show };
}

export default function App() {
  const { toast, show } = useToast();

  const [authMode, setAuthMode] = useState("login"); // login | register
  const [token, setTok] = useState(getToken());
  const [me, setMe] = useState(null);

  // auth form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // chat state
  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [online, setOnline] = useState([]);
  const [typing, setTyping] = useState("");

  const [messages, setMessages] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [msgText, setMsgText] = useState("");

  const sockRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);

  // create room / dm
  const [newRoomName, setNewRoomName] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState([]);

  // boot: if token exists, load me
  useEffect(() => {
    if (!token) return;
    api.me()
      .then((r) => setMe(r.user))
      .catch(() => {
        setMe(null);
        setTok("");
        clearToken();
      });
  }, [token]);

  // load rooms after me
  useEffect(() => {
    if (!me) return;
    refreshRooms();
  }, [me]);

  async function refreshRooms() {
    try {
      const r = await api.rooms();
      setRooms(r.rooms || []);
      if (!activeRoomId && r.rooms?.length) setActiveRoomId(r.rooms[0].id);
    } catch (e) {
      show(e.message || "Failed to load rooms", "error");
    }
  }

  // connect WS when logged in
  useEffect(() => {
    if (!me || !token) return;

    sockRef.current?.close();

    const sock = createWsClient({
      url: WS_URL,
      token,
      onEvent: (evt) => {
        if (evt.type === "__open") return;
        if (evt.type === "__close") return;

        if (evt.type === "ready") return;

        if (evt.type === "presence") {
          if (evt.roomId === activeRoomId) setOnline(evt.online || []);
          return;
        }

        if (evt.type === "typing") {
          if (evt.roomId !== activeRoomId) return;
          setTyping(evt.isTyping ? `${evt.name} is typing...` : "");
          return;
        }

        if (evt.type === "message") {
          if (evt.message?.roomId !== activeRoomId) {
            // refresh rooms list to update last message
            refreshRooms();
            return;
          }
          setMessages((p) => [...p, evt.message]);
          refreshRooms();
          return;
        }

        if (evt.type === "error") {
          show(evt.message || "WS error", "error");
          return;
        }
      },
    });

    sockRef.current = sock;

    return () => sock.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, token, activeRoomId]);

  // join active room + load history
  useEffect(() => {
    if (!me || !activeRoomId) return;

    setMessages([]);
    setNextBefore(null);
    setOnline([]);
    setTyping("");

    sockRef.current?.send({ type: "join", roomId: activeRoomId });

    api.messages(activeRoomId, { limit: 50 })
      .then((r) => {
        setMessages(r.messages || []);
        setNextBefore(r.nextBefore || null);
        scrollToBottom();
      })
      .catch((e) => show(e.message || "Failed to load messages", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, me]);

  function scrollToBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages, typing]);

  async function loadMore() {
    if (!activeRoomId || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.messages(activeRoomId, { before: nextBefore, limit: 50 });
      if (r.messages?.length) {
        setMessages((p) => [...r.messages, ...p]);
        setNextBefore(r.nextBefore || null);
      } else {
        setNextBefore(null);
      }
    } catch (e) {
      show(e.message || "Failed to load older messages", "error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function onSubmitAuth(e) {
    e.preventDefault();
    try {
      if (authMode === "register") {
        const r = await api.register({ name, email, password });
        setToken(r.token);
        setTok(r.token);
        setMe(r.user);
        show("Registered successfully", "ok");
      } else {
        const r = await api.login({ email, password });
        setToken(r.token);
        setTok(r.token);
        setMe(r.user);
        show("Logged in", "ok");
      }
    } catch (e2) {
      show(e2.message || "Auth failed", "error");
    }
  }

  function logout() {
    clearToken();
    setTok("");
    setMe(null);
    setRooms([]);
    setActiveRoomId("");
    setMessages([]);
  }

  function onTypingChange(v) {
    setMsgText(v);
    sockRef.current?.send({ type: "typing", isTyping: true });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sockRef.current?.send({ type: "typing", isTyping: false });
    }, 600);
  }

  function sendMessage(e) {
    e.preventDefault();
    const t = msgText.trim();
    if (!t) return;
    sockRef.current?.send({ type: "send", text: t });
    setMsgText("");
    sockRef.current?.send({ type: "typing", isTyping: false });
  }

  async function createRoom() {
    const n = newRoomName.trim();
    if (n.length < 2) return show("Room name min 2 chars", "error");
    try {
      const r = await api.createRoom(n);
      setNewRoomName("");
      await refreshRooms();
      setActiveRoomId(r.room.id);
      show("Room created", "ok");
    } catch (e) {
      show(e.message || "Failed to create room", "error");
    }
  }

  async function searchUsers() {
    const q = userSearch.trim();
    if (!q) return setUserResults([]);
    try {
      const r = await api.users(q);
      setUserResults(r.users || []);
    } catch (e) {
      show(e.message || "Search failed", "error");
    }
  }

  async function startDm(userId) {
    try {
      const r = await api.dmRoom(userId);
      await refreshRooms();
      setActiveRoomId(r.room.id);
      setUserSearch("");
      setUserResults([]);
      show("DM ready", "ok");
    } catch (e) {
      show(e.message || "Failed to start DM", "error");
    }
  }

  async function clearChat() {
    if (!activeRoomId) return;
    try {
      await api.clearRoom(activeRoomId);
      setMessages([]);
      setNextBefore(null);
      show("Chat cleared (for you)", "ok");
    } catch (e) {
      show(e.message || "Failed to clear chat", "error");
    }
  }

  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId) || null, [rooms, activeRoomId]);

  if (!token || !me) {
    return (
      <div className="page">
        <div className="authCard">
          <div className="brand">
            <div className="logoDot" />
            <div>
              <div className="brandTitle">Chat WS Pro</div>
              <div className="brandSub">Secure rooms + DMs + persistence</div>
            </div>
          </div>

          <div className="tabs">
            <button className={authMode === "login" ? "tab active" : "tab"} onClick={() => setAuthMode("login")}>
              Login
            </button>
            <button className={authMode === "register" ? "tab active" : "tab"} onClick={() => setAuthMode("register")}>
              Register
            </button>
          </div>

          <form className="authForm" onSubmit={onSubmitAuth}>
            {authMode === "register" ? (
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </label>
            ) : null}

            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
            </label>

            <label>
              Password
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" />
            </label>

            <button type="submit" className="primaryBtn">
              {authMode === "register" ? "Create account" : "Login"}
            </button>

            <div className="hint">
              Server: <code>{import.meta.env.VITE_API_URL || "http://localhost:4000"}</code>
            </div>
          </form>
        </div>

        {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="left">
          <div className="brandMini">
            <div className="logoDot" />
            <span>Chat WS Pro</span>
          </div>
          <div className="meTag">
            <span className="meName">{me.name}</span>
            <span className="meEmail">{me.email}</span>
          </div>
        </div>
        <div className="right">
          <button className="ghostBtn" onClick={refreshRooms}>Refresh</button>
          <button className="dangerBtn" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="section">
            <div className="sectionTitle">Create room</div>
            <div className="row">
              <input value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="e.g. Team" />
              <button onClick={createRoom}>Create</button>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">Start DM</div>
            <div className="row">
              <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search users..." />
              <button onClick={searchUsers}>Search</button>
            </div>
            {userResults.length ? (
              <div className="results">
                {userResults.map((u) => (
                  <button key={u.id} className="resultItem" onClick={() => startDm(u.id)}>
                    <div className="resultName">{u.name}</div>
                    <div className="resultEmail">{u.email}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="section">
            <div className="sectionTitle">Rooms</div>
            <div className="roomList">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  className={r.id === activeRoomId ? "roomItem active" : "roomItem"}
                  onClick={() => setActiveRoomId(r.id)}
                >
                  <div className="roomTop">
                    <span className="roomTitle">{r.title}</span>
                    <span className="roomType">{r.type.toUpperCase()}</span>
                  </div>
                  <div className="roomSub">
                    {r.lastMessage ? (
                      <>
                        <span className="roomLast">{r.lastMessage.senderName}: {r.lastMessage.text}</span>
                        <span className="roomTime">{fmtTime(r.lastMessage.createdAt)}</span>
                      </>
                    ) : (
                      <span className="roomMuted">No messages yet</span>
                    )}
                  </div>
                </button>
              ))}
              {!rooms.length ? <div className="muted">No rooms. Create one or start a DM.</div> : null}
            </div>
          </div>
        </aside>

        <main className="chat">
          <div className="chatHeader">
            <div>
              <div className="chatTitle">{activeRoom?.title || "Select a room"}</div>
              <div className="chatMeta">
                Online: <b>{online.length}</b> {typing ? <span className="typing">{typing}</span> : null}
              </div>
            </div>
            <div className="chatActions">
              <button className="ghostBtn" onClick={loadMore} disabled={!nextBefore || loadingMore}>
                {loadingMore ? "Loading..." : nextBefore ? "Load older" : "No more"}
              </button>
              <button className="dangerBtn" onClick={clearChat} disabled={!activeRoomId}>
                Clear chat
              </button>
            </div>
          </div>

          <div className="chatBody">
            {messages.map((m) => (
              <div key={m.id} className={m.senderId === me.id ? "msg me" : "msg"}>
                <div className="bubble">
                  <div className="meta">
                    <span className="sender">{m.senderId === me.id ? "You" : m.senderName}</span>
                    <span className="time">{fmtTime(m.createdAt)}</span>
                  </div>
                  <div className="text">{m.text}</div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form className="composer" onSubmit={sendMessage}>
            <input
              value={msgText}
              onChange={(e) => onTypingChange(e.target.value)}
              placeholder="Write a message..."
              disabled={!activeRoomId}
            />
            <button type="submit" className="primaryBtn" disabled={!activeRoomId}>
              Send
            </button>
          </form>
        </main>
      </div>

      {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}
