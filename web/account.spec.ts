import { describe, it, expect } from 'vitest';
import { accountView, firstName, loginFailed } from './account.js';

describe('accountView', () => {
  it('login desligado no servidor: não mostra nada', () => {
    expect(accountView({ authEnabled: false, user: null })).toEqual({ mode: 'hidden' });
    expect(accountView({ authEnabled: false, user: { name: 'Ana' } })).toEqual({ mode: 'hidden' });
  });
  it('login ligado e ninguém entrou: convite para entrar', () => {
    expect(accountView({ authEnabled: true, user: null })).toEqual({ mode: 'login', label: 'Entrar com Google' });
  });
  it('logado: mostra o primeiro nome', () => {
    expect(accountView({ authEnabled: true, user: { name: 'Ana Maria Souza' } })).toEqual({ mode: 'user', label: 'Ana' });
  });
});

describe('firstName', () => {
  it('primeira palavra, sem espaços sobrando; vazio vira "Você"', () => {
    expect(firstName('  Ana Maria ')).toBe('Ana');
    expect(firstName('')).toBe('Você');
  });
});

describe('loginFailed', () => {
  it('detecta ?login=erro na barra de endereço', () => {
    expect(loginFailed('?login=erro')).toBe(true);
    expect(loginFailed('?a=1&login=erro')).toBe(true);
    expect(loginFailed('')).toBe(false);
    expect(loginFailed('?login=ok')).toBe(false);
  });
});
