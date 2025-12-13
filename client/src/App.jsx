import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  const timerRef = useRef(null);

  const show = useCallback((message, type = "info") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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

  // rooms + chat state
  const [rooms, setRooms] = useState([]);
  const [discoverRooms, setDiscoverRooms] = useState([]);

  const [activeRoomId, setActiveRoomId] = useState("");
  const activeRoomIdRef = useRef("");
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  const [online, setOnline] = useState([]);
  const [typing, setTyping] = useState("");

  const [messages, setMessages] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [msgText, setMsgText] = useState("");

  const sockRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);

  // create room
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomVisibility, setNewRoomVisibility] = useState("public");
  const [newRoomPassword, setNewRoomPassword] = useState("");

  // join private
  const [joinCode, setJoinCode] = useState("");
  const [joinPass, setJoinPass] = useState("");

  // DM
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState([]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // ---- rooms loader (stable) ----
  const refreshRooms = useCallback(async () => {
    const r = await api.rooms();
    setRooms(r.rooms || []);
    setDiscoverRooms(r.discover || []);

    // Select first room if none selected
    if (!activeRoomIdRef.current && r.rooms?.length) {
      setActiveRoomId(r.rooms[0].id);
    }
  }, []);

  // throttle room refreshes to avoid hammering the server on every message
  const refreshTimerRef = useRef(null);
  const requestRoomsRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(async () => {
      refreshTimerRef.current = null;
      try {
        await refreshRooms();
      } catch {
        // ignore
      }
    }, 350);
  }, [refreshRooms]);

  // boot: if token exists, load me
  useEffect(() => {
    if (!token) return;
    api
      .me()
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
    refreshRooms().catch((e) => show(e.message || "Failed to load rooms", "error"));
  }, [me, refreshRooms, show]);

  // keep active room valid if you left/deleted
  useEffect(() => {
    if (!me) return;
    if (!activeRoomId) return;
    const exists = rooms.some((r) => r.id === activeRoomId);
    if (!exists) {
      setActiveRoomId(rooms[0]?.id || "");
    }
  }, [rooms, activeRoomId, me]);

  // ---- connect WS ONCE (per login) ----
  useEffect(() => {
    if (!me || !token) return;

    sockRef.current?.close();

    const sock = createWsClient({
      url: WS_URL,
      token,
      onEvent: (evt) => {
        const currentRoom = activeRoomIdRef.current;

        if (evt.type === "__open") {
          if (currentRoom) sock.send({ type: "join", roomId: currentRoom });
          return;
        }

        if (evt.type === "__close") {
          setOnline([]);
          setTyping("");
          return;
        }

        if (evt.type === "ready") return;

        if (evt.type === "presence") {
          if (evt.roomId === currentRoom) setOnline(evt.online || []);
          return;
        }

        if (evt.type === "typing") {
          if (evt.roomId !== currentRoom) return;
          setTyping(evt.isTyping ? `${evt.name} is typing...` : "");
          return;
        }

        if (evt.type === "message") {
          // If message is for another room, only update room list preview
          if (evt.message?.roomId !== currentRoom) {
            requestRoomsRefresh();
            return;
          }
          setMessages((p) => [...p, evt.message]);
          requestRoomsRefresh();
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
  }, [me, token, requestRoomsRefresh, show]);

  // ---- when active room changes: WS join + load history ----
  useEffect(() => {
    if (!me || !activeRoomId) return;

    setMessages([]);
    setNextBefore(null);
    setOnline([]);
    setTyping("");

    // join over WS
    sockRef.current?.send({ type: "join", roomId: activeRoomId });

    api
      .messages(activeRoomId, { limit: 50 })
      .then((r) => {
        setMessages(r.messages || []);
        setNextBefore(r.nextBefore || null);
        scrollToBottom();
      })
      .catch((e) => show(e.message || "Failed to load messages", "error"));
  }, [activeRoomId, me, scrollToBottom, show]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, typing, scrollToBottom]);

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
    setDiscoverRooms([]);
    setActiveRoomId("");
    setMessages([]);
    setOnline([]);
    setTyping("");
    sockRef.current?.close();
    sockRef.current = null;
  }

  function onTypingChange(v) {
    setMsgText(v);
    if (!activeRoomId) return;

    sockRef.current?.send({ type: "typing", roomId: activeRoomId, isTyping: true });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sockRef.current?.send({ type: "typing", roomId: activeRoomId, isTyping: false });
    }, 600);
  }

  function sendMessage(e) {
    e.preventDefault();
    const t = msgText.trim();
    if (!t) return;

    if (!activeRoomId) {
      show("Select a room first", "error");
      return;
    }

    sockRef.current?.send({ type: "send", roomId: activeRoomId, text: t });
    setMsgText("");
    sockRef.current?.send({ type: "typing", roomId: activeRoomId, isTyping: false });
  }

  async function createRoom() {
    const n = newRoomName.trim();
    if (n.length < 2) return show("Room name min 2 chars", "error");
    if (newRoomVisibility === "private" && newRoomPassword.trim().length < 4) {
      return show("Private room password min 4 chars", "error");
    }
    try {
      const r = await api.createRoom({ name: n, visibility: newRoomVisibility, password: newRoomPassword });
      setNewRoomName("");
      setNewRoomPassword("");
      await refreshRooms();
      setActiveRoomId(r.room.id);
      if (newRoomVisibility === "private") {
        show(`Private room created. Share code: ${r.room.id}`, "ok");
      } else {
        show("Room created", "ok");
      }
    } catch (e) {
      show(e.message || "Failed to create room", "error");
    }
  }

  async function joinPublicRoom(roomId) {
    try {
      await api.joinRoom(roomId);
      await refreshRooms();
      setActiveRoomId(roomId);
      show("Joined room", "ok");
    } catch (e) {
      show(e.message || "Failed to join room", "error");
    }
  }

  async function joinPrivateRoom() {
    const code = joinCode.trim();
    const pass = joinPass.trim();
    if (!code) return show("Enter room code", "error");
    if (pass.length < 4) return show("Enter room password", "error");
    try {
      await api.joinRoom(code, { password: pass });
      setJoinCode("");
      setJoinPass("");
      await refreshRooms();
      setActiveRoomId(code);
      show("Joined private room", "ok");
    } catch (e) {
      show(e.message || "Failed to join private room", "error");
    }
  }

  async function leaveActiveRoom() {
    if (!activeRoomId) return;
    try {
      await api.leaveRoom(activeRoomId);
      await refreshRooms();
      show("Left room", "ok");
    } catch (e) {
      show(e.message || "Failed to leave room", "error");
    }
  }

  async function deleteActiveRoom() {
    if (!activeRoomId) return;
    try {
      await api.deleteRoom(activeRoomId);
      await refreshRooms();
      show("Room deleted", "ok");
    } catch (e) {
      show(e.message || "Failed to delete room", "error");
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

  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId) || null, [rooms, activeRoomId]);
  const canDelete = activeRoom?.type === "group" && activeRoom?.role === "owner";
  const canLeave = !!activeRoomId && (!canDelete || activeRoom?.type !== "group");

  if (!token || !me) {
    return (
      <div className="page">
        <div className="authCard">
          <div className="brand">
            <div className="logoDot" />
            <div>
              <div className="brandTitle">Chat WS Pro</div>
              <div className="brandSub">Rooms + DMs + history + private rooms</div>
            </div>
          </div>

          <div className="tabs">
            <button className={authMode === "login" ? "tab active" : "tab"} onClick={() => setAuthMode("login")}>
              Login
            </button>
            <button
              className={authMode === "register" ? "tab active" : "tab"}
              onClick={() => setAuthMode("register")}
            >
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
          <button
            className="ghostBtn"
            onClick={() => refreshRooms().catch((e) => show(e.message || "Refresh failed", "error"))}
          >
            Refresh
          </button>
          <button className="dangerBtn" onClick={logout}>
            Logout
          </button>
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
            <div className="row" style={{ marginTop: 8 }}>
              <select value={newRoomVisibility} onChange={(e) => setNewRoomVisibility(e.target.value)}>
                <option value="public">Public</option>
                <option value="private">Private (password)</option>
              </select>
              {newRoomVisibility === "private" ? (
                <input
                  value={newRoomPassword}
                  onChange={(e) => setNewRoomPassword(e.target.value)}
                  placeholder="Room password"
                  type="password"
                />
              ) : (
                <div className="muted" style={{ padding: "10px 0" }}>
                  Visible in Discover
                </div>
              )}
            </div>
            {newRoomVisibility === "private" ? (
              <div className="muted" style={{ marginTop: 6 }}>
                Share room <b>code</b> (room ID) + password to invite.
              </div>
            ) : null}
          </div>

          <div className="section">
            <div className="sectionTitle">Join private room</div>
            <div className="row">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Room code (ID)" />
              <button onClick={joinPrivateRoom}>Join</button>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input value={joinPass} onChange={(e) => setJoinPass(e.target.value)} placeholder="Password" type="password" />
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
                    <span className="roomType">
                      {r.type.toUpperCase()}
                      {r.type === "group" && r.visibility === "private" ? " • PRIVATE" : ""}
                    </span>
                  </div>
                  <div className="roomSub">
                    {r.lastMessage ? (
                      <>
                        <span className="roomLast">
                          {r.lastMessage.senderName}: {r.lastMessage.text}
                        </span>
                        <span className="roomTime">{fmtTime(r.lastMessage.createdAt)}</span>
                      </>
                    ) : (
                      <span className="roomMuted">No messages yet</span>
                    )}
                  </div>
                </button>
              ))}
              {!rooms.length ? <div className="muted">No rooms yet. Create one or start a DM.</div> : null}
            </div>
          </div>

          {discoverRooms.length ? (
            <div className="section">
              <div className="sectionTitle">Discover rooms (public)</div>
              <div className="roomList">
                {discoverRooms.map((r) => (
                  <div key={r.id} className="roomItem">
                    <div className="roomTop">
                      <span className="roomTitle">{r.title}</span>
                      <span className="roomType">PUBLIC</span>
                    </div>
                    <div className="roomSub">
                      <span className="roomMuted">Not joined</span>
                      <button className="ghostBtn" onClick={() => joinPublicRoom(r.id)}>
                        Join
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <main className="chat">
          <div className="chatHeader">
            <div>
              <div className="chatTitle">{activeRoom?.title || "Select a room"}</div>
              <div className="chatMeta">
                Online: <b>{online.length}</b>
                {typing ? <span className="typing">{typing}</span> : null}
                {activeRoom?.type === "group" && activeRoom?.code ? (
                  <span className="metaChip">
                    Code: <code>{activeRoom.code}</code>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="chatActions">
              <button className="ghostBtn" onClick={loadMore} disabled={!nextBefore || loadingMore}>
                {loadingMore ? "Loading..." : nextBefore ? "Load older" : "No more"}
              </button>
              {canLeave ? (
                <button className="ghostBtn" onClick={leaveActiveRoom} disabled={!activeRoomId}>
                  Leave
                </button>
              ) : null}
              {canDelete ? (
                <button className="dangerBtn" onClick={deleteActiveRoom} disabled={!activeRoomId}>
                  Delete
                </button>
              ) : null}
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
