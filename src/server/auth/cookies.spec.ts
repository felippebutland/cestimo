import { describe, it, expect } from 'vitest';
import { parseCookies, serializeCookie } from './cookies.js';

describe('parseCookies', () => {
  it('lê vários cookies e decodifica valores', () => {
    expect(parseCookies('a=1; b=x%20y;  c=3')).toEqual({ a: '1', b: 'x y', c: '3' });
  });
  it('vazio ou ausente = objeto vazio; ignora partes sem "="', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('lixo; a=1')).toEqual({ a: '1' });
  });
});

describe('serializeCookie', () => {
  it('HttpOnly, SameSite=Lax, Path e Max-Age; Secure quando pedido', () => {
    expect(serializeCookie('s', 'v', { maxAgeSec: 60, secure: true })).toBe('s=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure');
    expect(serializeCookie('s', 'v', { maxAgeSec: 60, secure: false })).toBe('s=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax');
  });
  it('apagar = Max-Age 0', () => {
    expect(serializeCookie('s', '', { maxAgeSec: 0, secure: true })).toContain('Max-Age=0');
  });
});
