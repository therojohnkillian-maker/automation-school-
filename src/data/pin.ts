/**
 * PINs keep people from opening each other's profiles by accident.
 * They are NOT security: anyone with the device can read browser storage.
 */
const enc = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export async function hashPin(pin: string, salt?: string) {
  const s = salt ?? [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { pinSalt: s, pinHash: await sha256Hex(`${s}:${pin}`) };
}

export async function checkPin(pin: string, salt: string, hash: string): Promise<boolean> {
  const r = await hashPin(pin, salt);
  return r.pinHash === hash;
}
