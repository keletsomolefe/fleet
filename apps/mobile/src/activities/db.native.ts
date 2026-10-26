import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import type { Sql } from "../tracking/queue";
import { activityQueue, schema } from "./queue";
let opening: Promise<ReturnType<typeof activityQueue>> | undefined;
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
export function activityOutbox() {
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync("fleet-activities-v1.db");
    await db.execAsync(schema);
    return activityQueue(adapter(db), Crypto.randomUUID);
  })().catch((e) => {
    opening = undefined;
    throw e;
  });
  return opening;
}
