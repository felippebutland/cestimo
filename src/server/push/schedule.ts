import { dayKey } from '../history.js';

/** A rotina diária deve rodar agora? Roda uma vez por dia local, a partir de `hour`, mesmo que o app tenha ficado fora do ar na hora marcada. */
export function dueToday(o: { now: number; utcOffsetMinutes: number; hour: number; lastRunDay: string | null }): { due: boolean; day: string } {
  const day = dayKey(o.now, o.utcOffsetMinutes);
  const localHour = new Date(o.now + o.utcOffsetMinutes * 60_000).getUTCHours();
  return { due: localHour >= o.hour && o.lastRunDay !== day, day };
}
