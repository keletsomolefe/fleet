import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { queue, schema, type Sql } from "./queue";
let opening: Promise<ReturnType<typeof queue>> | undefined;
function adapter(db: SQLite.SQLiteDatabase): Sql {
  return {
    exec: async (sql) => {
      await db.execAsync(sql);
    },
    run: async (sql, ...args) => {
      await db.runAsync(sql, args);
    },
    first: (sql, ...args) => db.getFirstAsync(sql, args),
    all: (sql, ...args) => db.getAllAsync(sql, args),
    transaction: async (action) => {
      let result!: Awaited<ReturnType<typeof action>>;
      await db.withExclusiveTransactionAsync(async (tx) => {
        result = await action(adapter(tx));
      });
      return result;
    },
  };
}
export function outbox() {
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync("fleet-location-v1.db");
    await db.execAsync(schema);
    return queue(adapter(db), Crypto.randomUUID);
  })().catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}
