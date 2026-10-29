import { describe, it, expect } from 'vitest';
import { kundennummerText, pruefeNaechsteKundennummer } from './kundennummer';

describe('Kundennummer (K145, K146)', () => {
  it('kürzt nie, sondern füllt nur auf vier Stellen auf', () => {
    expect(kundennummerText(20)).toBe('M0020');
    expect(kundennummerText(9999)).toBe('M9999');
    expect(kundennummerText(11161)).toBe('M11161'); // früher „M1116“ (H18)
  });

  it('nimmt nur ganze Zahlen von 1 bis 999999, auch mit vorangestelltem M', () => {
    expect(pruefeNaechsteKundennummer('20')).toEqual({ wert: 20, fehler: null });
    expect(pruefeNaechsteKundennummer(' M0020 ')).toEqual({ wert: 20, fehler: null });
    for (const falsch of ['0', '-3', '1,5', 'abc', '', '1234567']) {
      expect(pruefeNaechsteKundennummer(falsch).wert).toBeNull();
    }
  });
});
