import { useEffect, useRef } from "react";

type DashEvent = { type: string; [k: string]: unknown };

// Subscribe to hive dashboard events. onEvent gets every broadcast;
// optional onStatus reports connection state.
export function useDashSocket(onEvent: (e: DashEvent) => void, onStatus?: (online: boolean) => void): void {
  const cb = useRef(onEvent);
  const st = useRef(onStatus);
  cb.current = onEvent;
  st.current = onStatus;
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 500;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/dash`);
      ws.onopen = () => {
        backoff = 500;
        st.current?.(true);
      };
      ws.onmessage = (e) => {
        try {
          cb.current(JSON.parse(e.data));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        st.current?.(false);
        if (closed) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10_000);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);
}
