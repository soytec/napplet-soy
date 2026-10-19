import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { ConnectionCodec } from '../connections';

/** Per-owner authenticated encryption. The deployment key lives outside all owner
 * directories and runner inputs; moving a ciphertext to another owner fails closed. */
export function connectionVault(master: Uint8Array, owner: string): ConnectionCodec {
  if (master.byteLength !== 32 || !/^[a-f0-9]{64}$/.test(owner))
    throw new Error('A 32-byte deployment key and verified owner are required.');
  const context = Buffer.from('soy-studio-connections/v1:' + owner);
  const key = Buffer.from(hkdfSync('sha256', master, context, 'credentials', 32));
  return {
    encode(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(context);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return JSON.stringify({
        version: 1,
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      });
    },
    decode(value) {
      try {
        const envelope = JSON.parse(value);
        if (
          envelope.version !== 1 ||
          typeof envelope.data !== 'string' ||
          envelope.data.length > 350000
        )
          throw new Error();
        const nonce = Buffer.from(envelope.nonce, 'base64'),
          tag = Buffer.from(envelope.tag, 'base64');
        if (nonce.length !== 12 || tag.length !== 16) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAAD(context);
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(Buffer.from(envelope.data, 'base64')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        throw new Error('Cannot unlock this owner’s saved inference settings.');
      }
    },
  };
}
