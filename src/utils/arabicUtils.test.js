import { describe, it, expect } from 'vitest';
import {
  splitArabicWords,
  splitArabicChars,
  normalizeArabic,
  isQalqala,
  getMaddType,
} from './arabicUtils';

describe('arabicUtils Unit Tests', () => {
  it('splits Arabic text into words correctly', () => {
    const text = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
    const words = splitArabicWords(text);
    expect(words.length).toBe(4);
    expect(words[0]).toBe('بِسْمِ');
  });

  it('splits Arabic word into character clusters with diacritics', () => {
    const word = 'بِسْمِ';
    const chars = splitArabicChars(word);
    expect(chars.length).toBe(3);
    expect(chars[0]).toBe('بِ');
    expect(chars[1]).toBe('سْ');
    expect(chars[2]).toBe('مِ');
  });

  it('normalizes Arabic text by removing diacritics and hamzas', () => {
    const text = 'أَلَمْ تَرَ كَيْفَ';
    const normalized = normalizeArabic(text);
    expect(normalized).toBe('الم تر كيف');
  });

  it('detects Qalqala letters with sukun correctly', () => {
    const chars = ['ق', 'ْ', 'ل', 'ْ'];
    expect(isQalqala(chars, 0)).toBe(true);
    expect(isQalqala(chars, 2)).toBe(false);
  });

  it('identifies madd letters', () => {
    const chars = ['ق', 'َ', 'ا', 'ل', 'َ'];
    expect(getMaddType(chars, 2)).toBe('normal');
  });
});
