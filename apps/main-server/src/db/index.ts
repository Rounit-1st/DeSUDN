import { IDatabase } from './interface.js';
import { PostgresDatabase } from './postgres.js';
import { MemoryDatabase } from './memory.js';

let dbInstance: IDatabase | null = null;

export async function getDatabase(): Promise<IDatabase> {
  if (dbInstance) return dbInstance;

  const url = process.env.DATABASE_URL;
  if (url && !process.env.USE_MEMORY_DB) {
    try {
      const pgDb = new PostgresDatabase(url);
      // Quick test query
      await pgDb.query('SELECT 1');
      console.log('Connected to PostgreSQL database successfully.');
      dbInstance = pgDb;
      return dbInstance;
    } catch (err: any) {
      console.warn(
        `PostgreSQL not accessible (${err.message}). Using in-memory database fallback for seamless execution.`
      );
    }
  }

  dbInstance = new MemoryDatabase();
  return dbInstance;
}

export { IDatabase };
