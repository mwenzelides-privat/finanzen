// Optionale Ende-zu-Ende-Verschlüsselung (AES-GCM 256, Schlüssel per PBKDF2 aus dem Passwort)
const te = new TextEncoder();
const td = new TextDecoder();

export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(salt), iterations: 310000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // nicht exportierbar – kann trotzdem in IndexedDB abgelegt werden
    ['encrypt', 'decrypt'],
  );
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encryptJSON(obj, key, salt) {
  let bytes = te.encode(JSON.stringify(obj));
  let z = false;
  if (typeof CompressionStream !== 'undefined') { bytes = await pipe(bytes, new CompressionStream('gzip')); z = true; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { enc: true, v: 1, z, salt, iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON(env, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
  let bytes = new Uint8Array(pt);
  if (env.z) bytes = await pipe(bytes, new DecompressionStream('gzip'));
  return JSON.parse(td.decode(bytes));
}
