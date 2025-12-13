// client/src/ws.js
export function createWsClient({ url, token, onEvent }) {
  let ws = null;
  let closedByUser = false;
  let retry = 0;

  // Queue messages until WS is OPEN
  const queue = [];
  const MAX_QUEUE = 300;

  function emit(evt) {
    try {
      onEvent?.(evt);
    } catch (e) {
      console.error("onEvent error:", e);
    }
  }

  function buildUrl() {
    const u = new URL(url);
    if (token) u.searchParams.set("token", token);
    return u.toString();
  }

  function flushQueue() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (queue.length) {
      ws.send(queue.shift());
    }
  }

  function connect() {
    const wsUrl = buildUrl();
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      retry = 0;
      emit({ type: "__open" });
      flushQueue();
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        emit(data);
      } catch {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      emit({ type: "__close" });

      if (closedByUser) return;
      retry += 1;
      const delay = Math.min(5000, 500 * retry);
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onerror usually followed by close; ensure close happens
      try {
        ws.close();
      } catch {}
    };
  }

  connect();

  return {
    isOpen() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    },
    send(obj) {
      const payload = JSON.stringify(obj);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        return true;
      }

      // queue when not open
      queue.push(payload);
      if (queue.length > MAX_QUEUE) queue.shift(); // drop oldest
      return false;
    },
    close() {
      closedByUser = true;
      try {
        ws?.close();
      } catch {}
    },
  };
}
