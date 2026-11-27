import { dayKey } from '../history.js';

/**
 * A rotina diária deve rodar agora? Roda uma vez por dia local, a partir de `hour`, mesmo que o app tenha ficado fora do ar na hora marcada.
 * Com `windowHours`, só roda dentro da janela (rotina pesada: reiniciar o app à tarde não pode disparar a coleta).
 */
export function dueToday(o: { now: number; utcOffsetMinutes: number; hour: number; lastRunDay: string | null; windowHours?: number }): { due: boolean; day: string } {
  const day = dayKey(o.now, o.utcOffsetMinutes);
  const localHour = new Date(o.now + o.utcOffsetMinutes * 60_000).getUTCHours();
  const inWindow = o.windowHours === undefined || localHour < o.hour + o.windowHours;
  return { due: localHour >= o.hour && inWindow && o.lastRunDay !== day, day };
}
