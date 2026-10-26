import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { RateLimiter, clientIp } from '../src/limits';

describe('limites', () => {
  it('compte les événements sur une fenêtre glissante', () => {
    const limiter = new RateLimiter(2, 1000);
    expect([limiter.allow('a', 0), limiter.allow('a', 10), limiter.allow('a', 20)]).toEqual([true, true, false]);
    expect(limiter.allow('b', 20)).toBe(true);
    expect(limiter.allow('a', 1005)).toBe(true);
  });

  it("prend l'adresse ajoutée par le proxy, pas celles envoyées par le client", () => {
    const request = (headers: Record<string, string>) =>
      ({ headers, socket: { remoteAddress: '10.0.0.1' } }) as unknown as IncomingMessage;
    expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(request({}))).toBe('10.0.0.1');
  });
});
