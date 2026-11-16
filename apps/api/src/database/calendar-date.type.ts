import { Type } from '@mikro-orm/core';

/**
 * Maps a PostgreSQL `date` column to the `YYYY-MM-DD` string the API uses.
 *
 * node-postgres parses `date` values into `Date` objects at local midnight. The
 * application works with calendar dates (schedules, licence expiry), never with
 * an instant, so the value is normalised back to a plain calendar string. Writing
 * still sends the string unchanged, which PostgreSQL casts to `date`.
 */
export class CalendarDateType extends Type<string | null, string | null> {
  getColumnType(): string {
    return 'date';
  }

  convertToDatabaseValue(value: string | null): string | null {
    return value;
  }

  convertToJSValue(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
  }
}
