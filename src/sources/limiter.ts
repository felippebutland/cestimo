import { withTimeout } from '../domain/timeout.js';

/** Limita a concorrência. O timeout (opcional) só começa depois que a vaga é obtida. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return async function run<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    await acquire();
    try {
      return await (timeoutMs === undefined ? fn() : withTimeout(fn(), timeoutMs));
    } finally {
      release();
    }
  };
}
