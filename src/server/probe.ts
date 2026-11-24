import type { PriceSource } from '../domain/types.js';

export type ProbeResult = 'ok' | 'falha';

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tempo esgotado')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

/**
 * Teste sintético: uma busca fixa em cada loja, uma de cada vez. "ok" = veio ao menos um produto;
 * vazio, erro ou tempo esgotado = "falha". Serve para notar que uma loja mudou o site mesmo sem ninguém usando o app.
 */
export async function runProbe(
  sources: PriceSource[],
  term: string,
  record: (source: string, result: ProbeResult) => void,
  timeoutMs = 60_000,
): Promise<void> {
  for (const s of sources) {
    const result = await withTimeout(s.search(term), timeoutMs).then(
      (offers): ProbeResult => (offers.length > 0 ? 'ok' : 'falha'),
      (): ProbeResult => 'falha',
    );
    record(s.name, result);
  }
}
