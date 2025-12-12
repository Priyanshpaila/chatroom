import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChatSocket } from "./ws";
import "./styles.css";

function fmt(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const wsBase = import.meta.env.VITE_WS_URL || "ws://localhost:4000/ws";

  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("global");
  const [connected, setConnected] = useState(false);

  const [online, setOnline] = useState([]);
  const [typing, setTyping] = useState("");
  const [messages, setMessages] = useState([]);

  const [text, setText] = useState("");

  const sockRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);

  const wsUrl = useMemo(() => {
    const n = (name || "guest").trim() || "guest";
    return `${wsBase}?name=${encodeURIComponent(n)}`;
  }, [wsBase, name]);

  useEffect(() => {
    // connect socket
    sockRef.current?.close();
    setConnected(false);
    setMessages([]);
    setOnline([]);
    setTyping("");

    const sock = createChatSocket({
      url: wsUrl,
      onEvent: (evt) => {
        if (evt.type === "__open") {
          setConnected(true);
          sock.send({ type: "join", roomId });
          return;
        }
        if (evt.type === "__close") {
          setConnected(false);
          return;
        }

        if (evt.type === "history") {
          setMessages(Array.isArray(evt.messages) ? evt.messages : []);
          return;
        }

        if (evt.type === "message") {
          if (evt.message) setMessages((p) => [...p, evt.message]);
          return;
        }

        if (evt.type === "presence") {
          setOnline(Array.isArray(evt.online) ? evt.online : []);
          return;
        }

        if (evt.type === "typing") {
          if (!evt.isTyping) return setTyping("");
          setTyping(`${evt.name} is typing...`);
          return;
        }

        if (evt.type === "error") {
          console.warn(evt.message);
          return;
        }
      }
    });

    sockRef.current = sock;

    return () => sock.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function joinRoom() {
    setMessages([]);
    setOnline([]);
    setTyping("");
    sockRef.current?.send({ type: "join", roomId });
  }

  function sendMessage(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;

    sockRef.current?.send({ type: "send", text: t });
    setText("");
    sockRef.current?.send({ type: "typing", isTyping: false });
  }

  function onChangeText(v) {
    setText(v);

    sockRef.current?.send({ type: "typing", isTyping: true });

    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sockRef.current?.send({ type: "typing", isTyping: false });
    }, 600);
  }

  return (
    <div className="page">
      <div className="card">
        <header className="header">
          <div className="title">Chat (Express + WebSocket + MongoDB)</div>
          <div className={`pill ${connected ? "ok" : "bad"}`}>
            {connected ? "Connected" : "Disconnected"}
          </div>
        </header>

        <div className="controls">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ashu"
            />
          </label>

          <label>
            Room
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="global"
            />
          </label>

          <button onClick={joinRoom}>Join</button>
        </div>

        <div className="main">
          <div className="chat">
            <div className="log">
              {messages.map((m) => (
                <div key={m.id} className="line">
                  <span className="ts">[{fmt(m.createdAt)}]</span>{" "}
                  <span className="sender">{m.sender}</span>:{" "}
                  <span className="text">{m.text}</span>
                </div>
              ))}
              {typing ? <div className="typing">{typing}</div> : null}
              <div ref={bottomRef} />
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <input
                value={text}
                onChange={(e) => onChangeText(e.target.value)}
                placeholder="Type a message…"
              />
              <button type="submit">Send</button>
            </form>
          </div>

          <aside className="sidebar">
            <div className="sideTitle">Online ({online.length})</div>
            <div className="onlineList">
              {online.map((u, idx) => (
                <div className="onlineUser" key={`${u.name}_${idx}`}>
                  <span className="dot" />
                  <span className="name">{u.name}</span>
                </div>
              ))}
              {!online.length ? (
                <div className="muted">No users online</div>
              ) : null}
            </div>

            <div className="hint">
              Tip: open in two tabs and join the same room.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
