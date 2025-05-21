import * as jose from 'jose';

export function decodeJWT(token: string) {
  const decoded = jose.decodeJwt(token);
  return decoded;
}
