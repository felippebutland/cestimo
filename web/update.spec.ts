import { describe, it, expect } from 'vitest';
import { updateAction } from './update.js';

describe('updateAction (o que fazer quando sai uma versão nova do app)', () => {
  it('primeira instalação do service worker: não faz nada (ainda não havia versão antiga)', () => {
    expect(updateAction({ hadController: false, hasResult: false, loading: false })).toBe('ignore');
  });
  it('tela vazia e sem busca em andamento: recarrega sozinho', () => {
    expect(updateAction({ hadController: true, hasResult: false, loading: false })).toBe('reload');
  });
  it('com resultado na tela: não perde o trabalho, só oferece atualizar', () => {
    expect(updateAction({ hadController: true, hasResult: true, loading: false })).toBe('offer');
  });
  it('buscando: não interrompe, oferece atualizar', () => {
    expect(updateAction({ hadController: true, hasResult: false, loading: true })).toBe('offer');
  });
});
