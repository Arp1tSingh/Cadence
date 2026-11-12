const SMALL = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

const ORDINAL_SMALL = [
  'zeroth',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
] as const;

const ORDINAL_TENS: Record<number, string> = {
  20: 'twentieth',
  30: 'thirtieth',
  40: 'fortieth',
  50: 'fiftieth',
  60: 'sixtieth',
  70: 'seventieth',
  80: 'eightieth',
  90: 'ninetieth',
};

const SCALES: ReadonlyArray<{ value: number; name: string }> = [
  { value: 1_000_000_000, name: 'billion' },
  { value: 1_000_000, name: 'million' },
  { value: 1_000, name: 'thousand' },
];

const CURRENCIES: Record<
  string,
  { major: [string, string]; minor: [string, string] }
> = {
  $: { major: ['dollar', 'dollars'], minor: ['cent', 'cents'] },
  '£': { major: ['pound', 'pounds'], minor: ['penny', 'pence'] },
  '€': { major: ['euro', 'euros'], minor: ['cent', 'cents'] },
  '¥': { major: ['yen', 'yen'], minor: ['sen', 'sen'] },
};

function under1000(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;

  if (hundreds > 0) parts.push(`${SMALL[hundreds]} hundred`);
  if (remainder > 0) {
    if (remainder < 20) {
      parts.push(SMALL[remainder]);
    } else {
      const tens = Math.floor(remainder / 10);
      const ones = remainder % 10;
      parts.push(ones > 0 ? `${TENS[tens]}-${SMALL[ones]}` : TENS[tens]);
    }
  }

  return parts.join(' ');
}

export function integerToWords(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `minus ${integerToWords(Math.abs(value))}`;

  const n = Math.floor(value);
  if (n === 0) return 'zero';
  if (n > 999_999_999_999) return String(n);

  const parts: string[] = [];
  let remainder = n;

  for (const scale of SCALES) {
    const count = Math.floor(remainder / scale.value);
    if (count > 0) {
      parts.push(`${under1000(count)} ${scale.name}`);
      remainder %= scale.value;
    }
  }

  if (remainder > 0) parts.push(under1000(remainder));
  return parts.join(' ');
}

export function digitsToWords(digits: string): string {
  return digits
    .split('')
    .map((digit) => SMALL[Number(digit)] ?? digit)
    .join(' ');
}

export function yearToWords(year: number): string {
  if (year % 1000 === 0 || year < 1100 || year > 2099) return integerToWords(year);

  const high = Math.floor(year / 100);
  const low = year % 100;

  if (low === 0) return `${under1000(high)} hundred`;
  if (low < 10) return `${under1000(high)} oh ${SMALL[low]}`;
  return `${under1000(high)} ${under1000(low)}`;
}

export function ordinalToWords(value: number): string {
  const n = Math.floor(value);
  if (n < 0) return `minus ${ordinalToWords(Math.abs(n))}`;
  if (n < ORDINAL_SMALL.length) return ORDINAL_SMALL[n];
  if (n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const ones = n % 10;
    return ones === 0 ? ORDINAL_TENS[tens] : `${TENS[tens / 10]}-${ORDINAL_SMALL[ones]}`;
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const remainder = n % 100;
    return remainder === 0
      ? `${SMALL[hundreds]} hundredth`
      : `${SMALL[hundreds]} hundred ${ordinalToWords(remainder)}`;
  }

  const finalPart = n % 100;
  if (finalPart === 0) return `${integerToWords(n)}th`;
  return `${integerToWords(n - finalPart)} ${ordinalToWords(finalPart)}`;
}

function expandNumberCore(core: string): string {
  if (/^0\d/.test(core)) return digitsToWords(core);
  if (core.includes('.')) {
    const [whole, fraction] = core.split('.');
    const wholeWords = integerToWords(Number(whole || '0'));
    return `${wholeWords} point ${digitsToWords(fraction ?? '')}`.trim();
  }

  const numeric = Number(core.replaceAll(',', ''));
  if (!Number.isFinite(numeric)) return core;

  if (/^\d{4}$/.test(core) && numeric >= 1100 && numeric <= 2099) {
    return yearToWords(numeric);
  }

  return integerToWords(numeric);
}

function currencyWords(symbol: string, whole: string, fraction?: string): string {
  const currency = CURRENCIES[symbol];
  if (!currency) return `${whole} ${fraction ?? ''}`.trim();

  const majorAmount = Number(whole.replaceAll(',', ''));
  const majorLabel = majorAmount === 1 ? currency.major[0] : currency.major[1];
  const parts = [`${integerToWords(majorAmount)} ${majorLabel}`];

  if (fraction && Number(fraction) > 0) {
    const cents = Number(fraction.padEnd(2, '0'));
    const minorLabel = cents === 1 ? currency.minor[0] : currency.minor[1];
    parts.push(`${integerToWords(cents)} ${minorLabel}`);
  }

  return parts.join(' and ');
}

function clockWords(hourText: string, minuteText: string, meridiem?: string): string {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  let suffix = '';

  if (meridiem) {
    const isPm = /^p/i.test(meridiem);
    suffix = isPm ? 'P M' : 'A M';
    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;
  }

  const hourWords = integerToWords(hour);
  if (minute === 0) return `${hourWords} o'clock${suffix ? ` ${suffix}` : ''}`;
  if (minute < 10) return `${hourWords} oh ${integerToWords(minute)}${suffix ? ` ${suffix}` : ''}`;
  return `${hourWords} ${integerToWords(minute)}${suffix ? ` ${suffix}` : ''}`;
}

const SPEECH_ABBREVIATIONS: Record<string, string> = {
  'mr.': 'Mister',
  'mrs.': 'Missus',
  'ms.': 'Miss',
  'dr.': 'Doctor',
  'prof.': 'Professor',
  'jr.': 'Junior',
  'sr.': 'Senior',
  'vs.': 'versus',
  'etc.': 'et cetera',
  'e.g.': 'for example',
  'i.e.': 'that is',
  'no.': 'number',
  'vol.': 'volume',
  'ch.': 'chapter',
  'fig.': 'figure',
  'a.m.': 'A M',
  'p.m.': 'P M',
  'u.s.': 'U S',
  'u.k.': 'U K',
  'inc.': 'Incorporated',
  'ltd.': 'Limited',
  'co.': 'Company',
  'capt.': 'Captain',
  'col.': 'Colonel',
  'gen.': 'General',
  'lt.': 'Lieutenant',
  'sgt.': 'Sergeant',
  'rev.': 'Reverend',
  'hon.': 'Honorable',
  'pres.': 'President',
  'gov.': 'Governor',
  'sen.': 'Senator',
  'rep.': 'Representative',
  'mt.': 'Mount',
  'ft.': 'Fort',
  'ave.': 'Avenue',
  'blvd.': 'Boulevard',
  'rd.': 'Road',
};

/**
 * Expands a single display token into the text that should be spoken.
 * Display text is never modified; this is only used to build TTS spans.
 */
export function expandTokenForSpeech(token: string): string {
  if (!token) return token;

  const abbreviation = SPEECH_ABBREVIATIONS[token.toLowerCase()];
  if (abbreviation) return abbreviation;

  if (/^(?:[A-Z]\.){2,}$/.test(token)) {
    return token.replaceAll('.', ' ').trim().split(/\s+/).join(' ');
  }

  if (token === '&') return 'and';
  if (token === '+') return 'plus';
  if (token === '%') return 'percent';
  if (token === '=') return 'equals';
  if (token === '@') return 'at';
  if (token === '#') return 'number';
  if (token === '—' || token === '–') return ',';

  const ordinalMatch = /^(\d+(?:,\d{3})*)(st|nd|rd|th)$/i.exec(token);
  if (ordinalMatch) {
    return `${ordinalToWords(Number(ordinalMatch[1].replaceAll(',', '')))}`;
  }

  const clockMatch = /^(\d{1,2}):(\d{2})(\s*[ap]\.?m\.?)?$/i.exec(token);
  if (clockMatch) {
    return clockWords(clockMatch[1], clockMatch[2], clockMatch[3]);
  }

  const currencyMatch = /^([$£€¥])(\d+(?:,\d{3})*)(?:\.(\d{1,2}))?([.,!?;:)]*)$/u.exec(token);
  if (currencyMatch) {
    const [, symbol, whole, fraction, trailing] = currencyMatch;
    return `${currencyWords(symbol, whole, fraction)}${trailing}`;
  }

  const percentMatch = /^(\d+(?:,\d{3})*(?:\.\d+)?)%([.,!?;:)]*)$/u.exec(token);
  if (percentMatch) {
    const [, number, trailing] = percentMatch;
    return `${expandNumberCore(number)} percent${trailing}`;
  }

  const degreeMatch = /^(-?\d+(?:\.\d+)?)°([CF])([.,!?;:)]*)$/u.exec(token);
  if (degreeMatch) {
    const [, number, scale, trailing] = degreeMatch;
    const unit = scale.toUpperCase() === 'C' ? 'Celsius' : 'Fahrenheit';
    return `${expandNumberCore(number)} degrees ${unit}${trailing}`;
  }

  const numberMatch = /^([^\d]*)(\d+(?:,\d{3})*(?:\.\d+)?)([^\d]*)$/u.exec(token);
  if (
    numberMatch &&
    /^[\p{P}\p{S}]*$/u.test(numberMatch[1]) &&
    /^[\p{P}\p{S}]*$/u.test(numberMatch[3])
  ) {
    return `${numberMatch[1]}${expandNumberCore(numberMatch[2])}${numberMatch[3]}`;
  }

  if (token.includes('—') || token.includes('–')) {
    return token.replaceAll(/\s*[—–]\s*/g, ', ');
  }

  return token;
}
