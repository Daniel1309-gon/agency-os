import { defineConfig } from 'vitest/config';

// Unitarios: sin Postgres ni Redis. Todo lo que necesite infraestructura real
// vive en *.int.spec.ts y corre con vitest.integration.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.int.spec.ts', 'dist/**', 'node_modules/**'],
    // Los 5 s por defecto se quedan cortos para los tests de scrypt cuando la
    // maquina esta cargada: derivar la clave es lento a proposito. Un rojo por
    // reloj, y no por comportamiento, es peor que no tener la prueba.
    testTimeout: 20_000,
  },
});
