import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { errorText } from './load-text';

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');

describe('errorText', () => {
  it("says the TV's storage is full (step 39s1), in English and Arabic", () => {
    expect(errorText(en.t, 'storage', null)).toBe("There isn't enough storage left on this TV for Lablo to save this list.");
    expect(errorText(ar.t, 'storage', null)).toBe('لا توجد مساحة تخزين كافية على هذا التلفزيون ليحفظ لابلو هذه القائمة.');
    // The same for a file from the phone.
    expect(errorText(en.t, 'storage', null, true)).toBe(errorText(en.t, 'storage', null));
  });

  it('keeps "something went wrong" for what it has no words for', () => {
    expect(errorText(en.t, 'other', null)).toBe('Something went wrong. Try again.');
    expect(errorText(en.t, 'empty', null)).toBe('The playlist has no channels.');
  });
});
