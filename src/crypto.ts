// Echo Tax Return — SSN Encryption (AES-256-GCM)
// Encrypts sensitive PII (SSNs) at rest in D1

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

async function getKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret.padEnd(32, '0').slice(0, 32)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('echo-tax-return-ssn'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt a plaintext SSN → base64 string (iv + ciphertext) */
export async function encryptSSN(plaintext: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encoded
  );
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return btoa(String.fromCharCode(...combined));
}

/** Decrypt a base64 encrypted SSN → plaintext */
export async function decryptSSN(encrypted: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

/** Mask SSN for display: ***-**-1234 */
export function maskSSN(ssn: string): string {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return '***-**-****';
  return `***-**-${digits.slice(-4)}`;
}
