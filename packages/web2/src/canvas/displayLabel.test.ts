import { describe, expect, it } from 'vitest';

import { displayLabel, shortBoardLabel, distinctiveShortLabels } from './displayLabel';

describe('displayLabel', () => {
  it('title-cases kebab and snake ids', () => {
    expect(displayLabel('api')).toBe('Api');
    expect(displayLabel('order-service')).toBe('Order Service');
    expect(displayLabel('redis_cache')).toBe('Redis Cache');
  });

  it('leaves prose and mixed case alone', () => {
    expect(displayLabel('Checkout API')).toBe('Checkout API');
    expect(displayLabel('Gateway')).toBe('Gateway');
  });

  it('keeps filenames literal', () => {
    expect(displayLabel('app.ts')).toBe('app.ts');
    expect(displayLabel('routes.ts')).toBe('routes.ts');
  });
});

describe('shortBoardLabel', () => {
  it('keeps the first word for far-zoom cards', () => {
    expect(shortBoardLabel('order-service')).toBe('Order');
    expect(shortBoardLabel('Checkout API')).toBe('Checkout');
  });

  it('ellipsises a single long token', () => {
    expect(shortBoardLabel('supercalifragilistic', 8)).toBe('Superca…');
  });
});

describe('distinctiveShortLabels — the word that differs is the title (P1 audit)', () => {
  it('drops a family word shared by 3+ siblings, keeps it for outsiders', () => {
    const labels = [
      'hoppscotch-backend',
      'hoppscotch-app',
      'hoppscotch-sh-admin',
      'hoppscotch-old-backend',
      'cli',
      'common',
    ];
    const m = distinctiveShortLabels(labels);
    expect(m.get('hoppscotch-backend')).toBe('Backend');
    expect(m.get('hoppscotch-app')).toBe('App');
    expect(m.get('hoppscotch-sh-admin')).toBe('Sh Admin');
    // One level only: "Old Backend" must NOT collapse to "Backend" — that
    // would collide the old family with the new one.
    expect(m.get('hoppscotch-old-backend')).toBe('Old Backend');
    expect(m.get('cli')).toBe('Cli');
  });

  it('a label that IS the family word alone keeps it', () => {
    const m = distinctiveShortLabels(['acme', 'acme-api', 'acme-web', 'acme-worker']);
    expect(m.get('acme')).toBe('Acme');
    expect(m.get('acme-api')).toBe('Api');
  });

  it('fewer than 3 sharers: nothing is stripped', () => {
    const m = distinctiveShortLabels(['acme-api', 'acme-web', 'billing']);
    expect(m.get('acme-api')).toBe('Acme Api');
  });

  it('caps at maxChars with an ellipsis', () => {
    const m = distinctiveShortLabels(['a-very-long-multi-word-service-name'], 14);
    const v = m.get('a-very-long-multi-word-service-name')!;
    expect(v.length).toBeLessThanOrEqual(14);
    expect(v.endsWith('…')).toBe(true);
  });
});
