function bytesFrom(value) {
  const text = String(value || '');
  const pad = '='.repeat((4 - (text.length % 4)) % 4);
  const b64 = (text + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bytesTo(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function publicKey(options) {
  const out = { ...options, challenge: bytesFrom(options.challenge) };
  if (options.user) out.user = { ...options.user, id: bytesFrom(options.user.id) };
  if (options.allowCredentials) {
    out.allowCredentials = options.allowCredentials.map((row) => ({ ...row, id: bytesFrom(row.id) }));
  }
  return out;
}

function pack(cred, creating) {
  const body = {
    id: cred.id,
    clientDataJSON: bytesTo(cred.response.clientDataJSON),
  };
  if (creating) body.attestationObject = bytesTo(cred.response.attestationObject);
  else {
    body.authenticatorData = bytesTo(cred.response.authenticatorData);
    body.signature = bytesTo(cred.response.signature);
  }
  return body;
}

export function passkeysAvailable() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext;
}

export async function createPasskey(options) {
  if (!passkeysAvailable()) throw new Error('Passkeys need a secure page, such as localhost or https');
  const cred = await navigator.credentials.create({ publicKey: publicKey(options) });
  if (!cred) throw new Error('Passkey was cancelled');
  return pack(cred, true);
}

export async function getPasskey(options) {
  if (!passkeysAvailable()) throw new Error('Passkeys need a secure page, such as localhost or https');
  const cred = await navigator.credentials.get({ publicKey: publicKey(options) });
  if (!cred) throw new Error('Passkey was cancelled');
  return pack(cred, false);
}
