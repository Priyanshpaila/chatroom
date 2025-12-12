export function createChatSocket({ url, onEvent }) {
  let ws = null;
  let closedByUser = false;
  let retry = 0;

  function connect() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      retry = 0;
      onEvent({ type: "__open" });
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onEvent(data);
      } catch {
        // ignore invalid
      }
    };

    ws.onclose = () => {
      onEvent({ type: "__close" });

      if (closedByUser) return;

      retry += 1;
      const delay = Math.min(5000, 500 * retry);
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  connect();

  return {
    send(obj) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(obj));
      return true;
    },
    close() {
      closedByUser = true;
      try { ws.close(); } catch {}
    }
  };
}
