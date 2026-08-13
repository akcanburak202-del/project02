/**
 * Kimlik dogrulama: scrypt ile parola ozeti, bellekte oturum kayitlari.
 *
 * Oturumlar bellekte tutulur; sunucu yeniden baslatildiginda kullanicilar
 * tekrar giris yapar. Bu, tek sunuculu kurulum icin bilincli bir sadelik
 * tercihidir.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat
const sessions = new Map();

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  // Etkin kullanimda oturum suresi uzar.
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  return s;
}

export function destroySession(token) {
  if (token) sessions.delete(token);
}

/** Bir kullanicinin tum oturumlarini kapatir (parola degisimi, pasiflestirme). */
export function destroySessionsForUser(userId) {
  for (const [token, s] of sessions) {
    if (s.userId === userId) sessions.delete(token);
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const COOKIE_NAME = 'nobet_session';

export function sessionCookie(token, { secure = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
