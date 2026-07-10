// Parse a fetch Response body as Server-Sent Events, yielding {event, data} frames.
export async function* parseSSE(
  res: Response,
): AsyncGenerator<{ event: string; data: string }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event = "message";
  let data = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        if (data) yield { event, data: data.replace(/\n$/, "") };
        event = "message";
        data = "";
      } else if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data += line.slice(5).trim() + "\n";
      }
      // lines starting with ":" are comments; ignore
    }
  }
  if (data) yield { event, data: data.replace(/\n$/, "") };
}
