const javascriptEntryPoint = /\.(?:c|m)?js$/i;

// pnpm exposes its entry point through npm_execpath. A Node-based install points at a JavaScript
// file that must run through Node; the standalone @pnpm/exe install points at a native executable
// that must be spawned directly.
export function pnpmInvocation(entryPoint, args, nodePath = process.execPath) {
  if (!entryPoint) {
    throw new Error('Run this command through pnpm so the pinned package manager can be reused.');
  }

  return javascriptEntryPoint.test(entryPoint)
    ? { command: nodePath, args: [entryPoint, ...args] }
    : { command: entryPoint, args };
}
