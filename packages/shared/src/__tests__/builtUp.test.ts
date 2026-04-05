import { describe, it, expect } from 'vitest';
import { classifyBuiltUp, getBuiltUpStyle } from '../logic/builtUp';

describe('Built-Up Classification', () => {
  it('should classify Call OI Increase (price ↑, OI ↑)', () => {
    const result = classifyBuiltUp(5, 10);
    expect(result).toBe('Call OI Increase');
  });

  it('should classify buy back (price ↑, OI ↓)', () => {
    const result = classifyBuiltUp(5, -10);
    expect(result).toBe('buy back');
  });

  it('should classify Put OI Increase (price ↓, OI ↑)', () => {
    const result = classifyBuiltUp(-5, 10);
    expect(result).toBe('Put OI Increase');
  });

  it('should classify profit booking (price ↓, OI ↓)', () => {
    const result = classifyBuiltUp(-5, -10);
    expect(result).toBe('profit booking');
  });

  it('should return null for insignificant changes with threshold', () => {
    const result = classifyBuiltUp(0.5, 0.5, {
      priceChangeThreshold: 1,
      oiChangeThreshold: 1,
    });
    expect(result).toBeNull();
  });

  it('should classify with zero threshold', () => {
    const result = classifyBuiltUp(0.1, 0.1);
    expect(result).toBe('Call OI Increase');
  });

  it('should handle edge case: zero price change', () => {
    const result = classifyBuiltUp(0, 10);
    expect(result).toBe('Put OI Increase');
  });

  it('should handle edge case: zero OI change', () => {
    const result = classifyBuiltUp(5, 0);
    expect(result).toBe('buy back');
  });

  it('should provide correct styles for each type', () => {
    const callOiStyle = getBuiltUpStyle('Call OI Increase');
    expect(callOiStyle.backgroundColor).toBe('#2e7d32');

    const buyBackStyle = getBuiltUpStyle('buy back');
    expect(buyBackStyle.backgroundColor).toBe('#81c784');

    const putOiStyle = getBuiltUpStyle('Put OI Increase');
    expect(putOiStyle.backgroundColor).toBe('#c62828');

    const profitStyle = getBuiltUpStyle('profit booking');
    expect(profitStyle.backgroundColor).toBe('#ef9a9a');
  });
});
