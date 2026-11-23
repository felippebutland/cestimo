/**
 * Consulta em duas etapas: envia a lista e acompanha o resultado, aguentando quedas de rede
 * (comuns em celular). Se a conexão cair, o navegador volta a perguntar pelo mesmo id.
 */

export class JobExpiredError extends Error {}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * @param {string} list
 * @param {{ fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<{ id: string, total: number }>}
 */
export async function submitJob(list, { fetchFn = (...a) => fetch(...a) } = {}) {
  let res;
  try {
    res = await fetchFn('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ list }) });
  } catch {
    throw new Error('Não consegui enviar a lista: a conexão foi interrompida. Tente de novo.');
  }
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status} do servidor.`);
  return { id: data.id, total: data.total };
}

/**
 * @param {string} id
 * @param {{
 *   fetchFn?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   pollMs?: number,
 *   maxNetworkFailures?: number,
 *   onProgress?: (done: number, total: number) => void,
 *   onReconnecting?: (failures: number) => void,
 * }} [opts]
 */
export async function waitForJob(id, opts = {}) {
  const { fetchFn = (...a) => fetch(...a), sleep = defaultSleep, pollMs = 1500, maxNetworkFailures = 40, onProgress, onReconnecting } = opts;
  let failures = 0;
  for (;;) {
    let res;
    let data;
    try {
      res = await fetchFn(`/api/jobs/${id}`, { cache: 'no-store' });
      data = await readJson(res);
      if (res.ok && data === null) throw new Error('resposta ilegível');
    } catch {
      failures += 1;
      if (failures > maxNetworkFailures) throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
      onReconnecting?.(failures);
      await sleep(Math.min(1000 * failures, 5000));
      continue;
    }
    if (failures > 0) {
      failures = 0;
      onReconnecting?.(0);
    }
    if (res.status === 404) throw new JobExpiredError(data?.error ?? 'A consulta expirou. Envie a lista de novo.');
    if (res.status === 429) {
      await sleep((Number(res.headers.get('retry-after')) || (pollMs * 2) / 1000) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status} do servidor.`);
    onProgress?.(data.done, data.total);
    if (data.status === 'done') return data.result;
    if (data.status === 'error') throw new Error(data.error ?? 'A consulta falhou. Tente de novo.');
    await sleep(pollMs);
  }
}
