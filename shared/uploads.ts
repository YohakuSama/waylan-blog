// Image uploads from the admin. The browser and the Worker derive the same
// path from the bytes, so the editor can reference an image before it is saved
// and the Worker can verify it. SVG is refused: it can carry script.

export const MAX_IMAGE = 5 * 1024 * 1024;

const kinds: [string, (b: Uint8Array) => boolean][] = [
  ["png", (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)],
  ["jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["gif", (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a"],
  ["webp", (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP"],
  ["avif", (b) => ascii(b, 4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(b, 8, 12))],
];
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** File extension for a supported raster image, judged by content, not name. */
export const imageKind = (bytes: Uint8Array) =>
  kinds.find(([, test]) => test(bytes))?.[0] ?? null;

/** Site path of an uploaded image: /images/<content hash>.<ext>. */
export async function uploadPath(bytes: Uint8Array) {
  const kind = imageKind(bytes);
  if (!kind) return null;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
  const hex = Array.from(digest.subarray(0, 8), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  return `/images/${hex}.${kind}`;
}

export const UPLOAD_PATH = /^\/images\/[0-9a-f]{16}\.(png|jpg|gif|webp|avif)$/;

export const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromBase64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
