const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function verifyHmac(
  payload: ArrayBuffer,
  received: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const normalized = received.startsWith("sha256=") ? received.slice(7) : received;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const signature = Uint8Array.from(normalized.match(/.{2}/g) ?? [], (part) =>
    Number.parseInt(part, 16),
  );
  return crypto.subtle.verify("HMAC", key, signature, payload);
}

export async function encryptPayload(
  payload: ArrayBuffer,
  base64Key: string,
): Promise<{ body: ArrayBuffer; nonce: string }> {
  const rawKey = Uint8Array.from(atob(base64Key), (character) => character.charCodeAt(0));
  if (rawKey.byteLength !== 32) throw new Error("Payload master key must decode to 32 bytes.");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  return {
    body: await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, payload),
    nonce: btoa(String.fromCharCode(...nonce)),
  };
}
