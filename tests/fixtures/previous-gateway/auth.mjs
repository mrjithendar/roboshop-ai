import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, text } from './runtime.mjs';
const scrypt = promisify(derive);
const digest = value => createHash('sha256').update(value).digest('hex');
const lifetime = 8 * 60 * 60 * 1000;
export const publicUser = user => ({ id: user._id, email: user.email, name: user.name, role: user.role, disabled: user.disabled === true });
export function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HttpError(400, 'Enter a valid email address.');
  return value.trim().toLowerCase();
}
export function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new HttpError(400, 'Use a password of 12–128 characters.');
  return value;
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(passwordInput(password), salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [, salt, expected] = encoded.split(':');
  const hash = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  const bytes = Buffer.from(expected, 'hex');
  return bytes.length === hash.length && timingSafeEqual(hash, bytes);
}
export function cookieToken(req) { return /(?:^|;\s*)rs_auth=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]; }
export function authCookie(res, token, secure) {
  const cookie = `rs_auth=${token || ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? lifetime / 1000 : 0}${secure ? '; Secure' : ''}`;
  res.setHeader('set-cookie', [...(res.getHeader('set-cookie') || []), cookie]);
}
export function requireRole(user, roles = ['customer', 'admin', 'superadmin']) {
  if (!user) throw new HttpError(401, 'Please log in to continue.');
  if (!roles.includes(user.role)) throw new HttpError(403, 'You do not have permission to perform this action.');
  return user;
}
export class Auth {
  constructor(db) { this.db = db; this.users = db.collection('users'); this.sessions = db.collection('auth_sessions'); this.activeHashes = 0; }
  async initialize() {
    await this.users.createIndex({ email: 1 }, { unique: true });
    await this.users.createIndex({ role: 1 }, { unique: true, partialFilterExpression: { role: 'superadmin' }, name: 'one_superadmin' });
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.sessions.createIndex({ userId: 1 });
    await this.db.collection('auth_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    this.dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  }
  async hashWork(fn) {
    if (this.activeHashes >= 4) throw new HttpError(429, 'Authentication is busy. Please try again shortly.');
    this.activeHashes++;
    try { return await fn(); } finally { this.activeHashes--; }
  }
  async limit(address) {
    const window = Math.floor(Date.now() / 900000);
    const result = await this.db.collection('auth_limits').findOneAndUpdate(
      { _id: digest(`${address}:${window}`) },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * 900000) } },
      { upsert: true, returnDocument: 'after' });
    if (result.count > 20) throw new HttpError(429, 'Too many login attempts. Please try again later.');
  }
  async register(data) {
    if (Object.keys(data).some(key => !['name', 'email', 'password'].includes(key))) throw new HttpError(400, 'Only name, email and password are accepted.');
    const user = { _id: randomUUID(), name: text(data.name, 'Name', 100), email: emailAddress(data.email), role: 'customer', disabled: false, version: 1, createdAt: new Date(), passwordHash: await this.hashWork(() => hashPassword(data.password)) };
    try { await this.users.insertOne(user); }
    catch (error) { if (error.code === 11000) throw new HttpError(409, 'Unable to register this email. Try logging in instead.'); throw error; }
    return user;
  }
  async login(data) {
    const email = emailAddress(data.email);
    if (typeof data.password !== 'string' || data.password.length > 128) throw new HttpError(401, 'Invalid email or password.');
    const user = await this.users.findOne({ email });
    const valid = await this.hashWork(() => verifyPassword(data.password, user?.passwordHash || this.dummyHash));
    if (!valid || !user || user.disabled) throw new HttpError(401, 'Invalid email or password.');
    return user;
  }
  async issue(user) {
    const token = randomBytes(32).toString('hex');
    await this.sessions.insertOne({ _id: digest(token), userId: user._id, version: user.version, expiresAt: new Date(Date.now() + lifetime) });
    return token;
  }
  async current(token) {
    if (!token) return null;
    const session = await this.sessions.findOne({ _id: digest(token), expiresAt: { $gt: new Date() } });
    if (!session) return null;
    const user = await this.users.findOne({ _id: session.userId, disabled: { $ne: true }, version: session.version });
    return user ? publicUser(user) : null;
  }
  async logout(token) { if (token) await this.sessions.deleteOne({ _id: digest(token) }); }
  async changeUser(actor, id, data) {
    requireRole(actor, ['superadmin']);
    if (Object.keys(data).some(key => !['role', 'disabled'].includes(key)) || !['customer', 'admin'].includes(data.role) || typeof data.disabled !== 'boolean') throw new HttpError(400, 'Choose customer/admin and an enabled/disabled status.');
    const user = await this.users.findOneAndUpdate({ _id: id, role: { $ne: 'superadmin' } }, { $set: { role: data.role, disabled: data.disabled }, $inc: { version: 1 } }, { returnDocument: 'after' });
    if (!user) throw new HttpError(409, 'User not found or the protected super admin cannot be changed here.');
    await this.sessions.deleteMany({ userId: id });
    return publicUser(user);
  }
  async bootstrap({ email, password, name }) {
    if (await this.users.findOne({ role: 'superadmin' })) throw new HttpError(409, 'A super admin already exists. No account was changed.');
    const user = { _id: randomUUID(), email: emailAddress(email), name: text(name || 'Super Admin', 'Name', 100), role: 'superadmin', disabled: false, version: 1, createdAt: new Date(), passwordHash: await hashPassword(password) };
    try { await this.users.insertOne(user); }
    catch (error) { if (error.code === 11000) throw new HttpError(409, 'Super admin or email already exists. No account was changed.'); throw error; }
    return publicUser(user);
  }
}
