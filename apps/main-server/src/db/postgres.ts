import pg from 'pg';
import { IDatabase } from './interface.js';

export class PostgresDatabase implements IDatabase {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
