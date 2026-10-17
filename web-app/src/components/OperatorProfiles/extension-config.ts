const chromeExtensionIdPattern = /^[a-p]{32}$/;

export function resolveExtensionId(value: unknown): string {
  if (typeof value !== 'string' || !chromeExtensionIdPattern.test(value)) {
    throw new Error('La extensión segura no está configurada en este equipo.');
  }
  return value;
}
