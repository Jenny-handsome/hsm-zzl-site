const encoder = new TextEncoder();
const NATIVE_ITERATIONS = 120000;
const FALLBACK_ITERATIONS = 20000;

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  const hex = String(value || "").trim();
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function blockIndexBytes(index) {
  return new Uint8Array([
    (index >>> 24) & 255,
    (index >>> 16) & 255,
    (index >>> 8) & 255,
    index & 255
  ]);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function hmacSha256Key(password) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(String(password)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function hmacSha256(key, data) {
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(signature);
}

async function pbkdf2Native(password, salt, iterations, bitLength) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    bitLength
  );
  return new Uint8Array(bits);
}

async function pbkdf2Fallback(password, salt, iterations, byteLength) {
  const key = await hmacSha256Key(password);
  const blocks = [];
  let generated = 0;
  for (let block = 1; generated < byteLength; block += 1) {
    let u = await hmacSha256(key, concatBytes(salt, blockIndexBytes(block)));
    const t = new Uint8Array(u);
    for (let i = 1; i < iterations; i += 1) {
      u = await hmacSha256(key, u);
      for (let j = 0; j < t.length; j += 1) t[j] ^= u[j];
    }
    blocks.push(t);
    generated += t.length;
  }

  const out = new Uint8Array(generated);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out.slice(0, byteLength);
}

async function derivePasswordBytes(password, salt, iterations, byteLength) {
  try {
    return await pbkdf2Native(password, salt, iterations, byteLength * 8);
  } catch {
    return pbkdf2Fallback(password, salt, Math.min(iterations, FALLBACK_ITERATIONS), byteLength);
  }
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(hash));
}

export async function createPasswordHash(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  try {
    const hash = await pbkdf2Native(password, salt, NATIVE_ITERATIONS, 256);
    return `pbkdf2_sha256$${NATIVE_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
  } catch {
    const hash = await pbkdf2Fallback(password, salt, FALLBACK_ITERATIONS, 32);
    return `pbkdf2_sha256$${FALLBACK_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
  }
}

export async function verifyPassword(password, storedHash) {
  const [scheme, iterationText, saltText, hashText] = String(storedHash || "").split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationText || !saltText || !hashText) return false;
  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations < 10000) return false;

  const salt = hexToBytes(saltText);
  const expected = hexToBytes(hashText);
  const actual = await derivePasswordBytes(password, salt, iterations, expected.length);
  return timingSafeEqual(actual, expected);
}
