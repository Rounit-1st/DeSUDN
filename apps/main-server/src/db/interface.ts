export interface IDatabase {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  close(): Promise<void>;
}
