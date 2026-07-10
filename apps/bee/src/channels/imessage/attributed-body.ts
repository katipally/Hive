// macOS 13+ often stores message text only in the `attributedBody` typedstream
// blob (text column is NULL). Extract the plain string with the common
// length-prefixed heuristic (same shape openclaw handles).
export function extractAttributedText(buf: Buffer): string | null {
  const marker = buf.indexOf("NSString");
  if (marker === -1) return null;
  // after NSString there's a class marker, then 0x2b ('+'), then a length prefix
  let i = buf.indexOf(0x2b, marker);
  if (i === -1) return null;
  i += 1;
  if (i >= buf.length) return null;
  let len: number;
  let start: number;
  const b = buf[i]!;
  if (b === 0x81) {
    // 2-byte little-endian length follows
    len = buf.readUInt16LE(i + 1);
    start = i + 3;
  } else if (b === 0x82) {
    len = buf.readUInt32LE(i + 1) & 0xffffff;
    start = i + 4;
  } else {
    len = b;
    start = i + 1;
  }
  if (len <= 0 || start + len > buf.length) return null;
  const text = buf.subarray(start, start + len).toString("utf8");
  return text.length ? text : null;
}
