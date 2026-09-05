import { getTableName, type Table } from 'drizzle-orm';
import type { DatabaseService } from '../../database/database.service.js';

/**
 * Doble de repositorio para los unitarios (PLAN.md §9). No interpreta la
 * clausula `where` — eso seria reimplementar Postgres y probar la
 * reimplementacion. Lo que hace es responder por tabla y registrar lo escrito,
 * que es lo que interesa verificar en las reglas de negocio: a quien se le
 * niega, que se audita, con que numeros se liquida.
 *
 * Las consultas cuyo filtrado sea la regla bajo prueba van en *.int.spec.ts,
 * contra Postgres de verdad.
 */

interface TableState {
  findFirst: unknown;
  findMany: unknown[];
  selectRows: unknown[];
  returning: unknown[];
  failure: Error | null;
  inserted: unknown[];
  updated: unknown[];
}

function emptyState(): TableState {
  return { findFirst: undefined, findMany: [], selectRows: [], returning: [], failure: null, inserted: [], updated: [] };
}

export interface TableStub {
  /** Respuesta de `db.query.<tabla>.findFirst`. */
  findFirst(value: unknown): TableStub;
  /** Respuesta de `db.query.<tabla>.findMany`. */
  findMany(rows: unknown[]): TableStub;
  /** Filas que devuelve `db.select(...).from(<tabla>)`. */
  select(rows: unknown[]): TableStub;
  /** Filas que devuelve `.returning()` en insert y update. */
  returning(rows: unknown[]): TableStub;
  /** Hace fallar el proximo insert, para simular un constraint de Postgres. */
  failsWith(error: Error): TableStub;
}

export interface FakeDatabase {
  /** Se pasa tal cual donde el servicio espera un DatabaseService. */
  service: DatabaseService;
  /** Configura las respuestas de una tabla, por su nombre SQL. */
  stub(name: string): TableStub;
  /** Valores pasados a `.values()` sobre esa tabla, en orden. */
  inserted(name: string): unknown[];
  /** Valores pasados a `.set()` sobre esa tabla, en orden. */
  updated(name: string): unknown[];
  /** Cuantas transacciones se abrieron. */
  transactions(): number;
}

export function createFakeDatabase(): FakeDatabase {
  const states = new Map<string, TableState>();
  let transactionCount = 0;

  const state = (name: string): TableState => {
    let found = states.get(name);
    if (!found) {
      found = emptyState();
      states.set(name, found);
    }
    return found;
  };

  const stateOf = (table: Table): TableState => state(getTableName(table));

  const thenable = <T>(produce: () => T | Promise<T>) => ({
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(produce)
        .then(resolve, reject),
  });

  const selectBuilder = () => {
    let rows: unknown[] = [];
    const builder = {
      from(table: Table) {
        rows = stateOf(table).selectRows;
        return builder;
      },
      where: () => builder,
      limit: () => builder,
      offset: () => builder,
      orderBy: () => builder,
      groupBy: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      ...thenable(() => rows),
    };
    return builder;
  };

  const insertBuilder = (table: Table) => {
    const current = stateOf(table);
    const result = {
      returning: () => thenable(() => {
        if (current.failure) throw current.failure;
        return current.returning;
      }),
      onConflictDoNothing: () => result,
      onConflictDoUpdate: () => result,
      ...thenable(() => {
        if (current.failure) throw current.failure;
        return current.returning;
      }),
    };
    return {
      values(value: unknown) {
        current.inserted.push(value);
        return result;
      },
    };
  };

  const updateBuilder = (table: Table) => {
    const current = stateOf(table);
    const afterWhere = {
      returning: () => thenable(() => current.returning),
      ...thenable(() => current.returning),
    };
    return {
      set(value: unknown) {
        current.updated.push(value);
        return {
          where: () => afterWhere,
          returning: () => thenable(() => current.returning),
          ...thenable(() => current.returning),
        };
      },
    };
  };

  // `db.query.<clave>` usa la clave camelCase del schema de Drizzle, no el
  // nombre SQL. El Proxy traduce una por otra para que los tests declaren
  // siempre el nombre de la tabla.
  const queryProxy = new Proxy(
    {},
    {
      get(_target, property: string) {
        const name = property.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
        return {
          findFirst: async () => state(name).findFirst,
          findMany: async () => state(name).findMany,
        };
      },
    },
  );

  const db: Record<string, unknown> = {
    query: queryProxy,
    select: () => selectBuilder(),
    insert: (table: Table) => insertBuilder(table),
    update: (table: Table) => updateBuilder(table),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      return callback(db);
    },
  };

  return {
    service: {
      db,
      withRequestContext: async (_userId: string, _roleCode: string, callback: () => Promise<unknown>) => callback(),
    } as unknown as DatabaseService,
    stub(name: string): TableStub {
      const current = state(name);
      const stub: TableStub = {
        findFirst(value) {
          current.findFirst = value;
          return stub;
        },
        findMany(rows) {
          current.findMany = rows;
          return stub;
        },
        select(rows) {
          current.selectRows = rows;
          return stub;
        },
        returning(rows) {
          current.returning = rows;
          return stub;
        },
        failsWith(error) {
          current.failure = error;
          return stub;
        },
      };
      return stub;
    },
    inserted: (name: string) => state(name).inserted,
    updated: (name: string) => state(name).updated,
    transactions: () => transactionCount,
  };
}
