import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { IDatabase } from '../db/interface.js';

const JWT_SECRET = process.env.JWT_SECRET || 'desudn-default-jwt-secret-key-32chars';

export interface PublisherPayload {
  id: string;
  username: string;
  publicKey: string;
}

export class AuthService {
  constructor(private db: IDatabase) {}

  async registerPublisher(
    id: string,
    username: string,
    passwordPlain: string,
    publicKey: string
  ): Promise<{ token: string; publisher: PublisherPayload }> {
    const existing = await this.db.query('SELECT id FROM publishers WHERE username = $1', [username]);
    if (existing.length > 0) {
      throw new Error(`Publisher with username "${username}" already exists`);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(passwordPlain, salt);

    await this.db.query(
      'INSERT INTO publishers (id, username, password_hash, public_key) VALUES ($1, $2, $3, $4)',
      [id, username, passwordHash, publicKey]
    );

    const payload: PublisherPayload = { id, username, publicKey };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return { token, publisher: payload };
  }

  async login(username: string, passwordPlain: string): Promise<{ token: string; publisher: PublisherPayload }> {
    const rows = await this.db.query(
      'SELECT id, username, password_hash, public_key FROM publishers WHERE username = $1',
      [username]
    );

    if (rows.length === 0) {
      throw new Error('Invalid publisher credentials');
    }

    const publisher = rows[0];
    const isMatch = await bcrypt.compare(passwordPlain, publisher.password_hash);
    if (!isMatch) {
      throw new Error('Invalid publisher credentials');
    }

    const payload: PublisherPayload = {
      id: publisher.id,
      username: publisher.username,
      publicKey: publisher.public_key,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return { token, publisher: payload };
  }

  verifyToken(token: string): PublisherPayload {
    return jwt.verify(token, JWT_SECRET) as PublisherPayload;
  }
}
