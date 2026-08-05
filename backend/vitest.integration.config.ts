import { defineConfig } from 'vitest/config';

// Integracion contra Postgres y Redis reales (PLAN.md §9): los invariantes de §4
// son constraints de exclusion y politicas RLS, que solo existen en Postgres.
//
// fileParallelism queda apagado a proposito: todos los archivos comparten la
// misma base de datos de prueba y cada uno la trunca en su beforeEach. Con
// paralelismo, un archivo borraria las filas que otro acaba de insertar.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.spec.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    globalSetup: ['src/test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
