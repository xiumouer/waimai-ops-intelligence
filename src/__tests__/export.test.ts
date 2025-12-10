import { describe, it, expect } from 'vitest';
import { toCSV } from '../utils/export';

describe('toCSV', () => {
  it('returns empty string for empty rows', () => {
    expect(toCSV([])).toBe('');
  });

  it('generates CSV with default headers and proper escaping', () => {
    const rows = [
      { name: 'Alice', note: 'Hello' },
      { name: 'Bob', note: 'He said "Hi"' },
      { name: 'Charlie', note: 'comma,inside' }
    ];
    const csv = toCSV(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('name,note');
    expect(lines[1]).toBe('Alice,Hello');
    expect(lines[2]).toBe('Bob,"He said ""Hi"""');
    expect(lines[3]).toBe('Charlie,"comma,inside"');
  });

  it('uses provided headers for column order', () => {
    const rows = [ { a: 1, b: 2 } ];
    const csv = toCSV(rows, ['b','a']);
    expect(csv.split('\n')[0]).toBe('b,a');
    expect(csv.split('\n')[1]).toBe('2,1');
  });
});