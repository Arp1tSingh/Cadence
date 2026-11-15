import { describe, expect, it } from 'vitest';
import { illustrationForPage } from './illustrations';

const illustrations = [
  { pageIndex: 17, path: 'illustrations/book/18.jpg' },
  { pageIndex: 41, path: 'illustrations/book/42.jpg' },
];

describe('illustrationForPage', () => {
  it('reveals the artwork on the page after the active text page', () => {
    expect(illustrationForPage(illustrations, 16)).toEqual(illustrations[0]);
    expect(illustrationForPage(illustrations, 40)).toEqual(illustrations[1]);
  });

  it('does not reveal artwork on the same page or later pages', () => {
    expect(illustrationForPage(illustrations, 17)).toBeUndefined();
    expect(illustrationForPage(illustrations, 15)).toBeUndefined();
    expect(illustrationForPage(illustrations, undefined)).toBeUndefined();
    expect(illustrationForPage(undefined, 16)).toBeUndefined();
    expect(illustrationForPage([], 16)).toBeUndefined();
  });
});
