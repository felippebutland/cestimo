const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repete UMA vez quando a loja diz que está passando por um problema momentâneo (ex.: banco do site lotado).
 * Qualquer outro erro falha na hora: não insistimos em bloqueios nem em páginas que mudaram.
 */
export async function retryOnTransient<T>(
  fn: () => Promise<T>,
  opts: { isTransient: (e: unknown) => boolean; delayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!opts.isTransient(e)) throw e;
    await (opts.sleep ?? defaultSleep)(opts.delayMs ?? 2500);
    return fn();
  }
}
