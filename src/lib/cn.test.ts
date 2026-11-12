import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins conditional class names', () => {
    expect(cn('flex', undefined, { 'items-center': true })).toBe('flex items-center');
  });

  it('resolves conflicting Tailwind utilities', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
