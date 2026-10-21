/**
 * Vocabulary used to normalise repairer descriptions on PartsCheck, so that
 * "L/H/F GUARD W/ARCH MOULD" and "LEFT FRONT FENDER WHEEL ARCH MOULDING"
 * reduce to the same words. Kept in its own file so it can grow as new
 * repairer shorthand turns up — add entries here, not in normalise.ts.
 *
 * Everything is matched against UPPERCASE text.
 */

/**
 * Side-plus-position shorthand, rewritten before anything else so the
 * slash isn't lost. "L/R" is handled separately in normalise.ts: as a
 * prefix it means left-rear, anywhere else it may mean "left and right".
 */
export const SIDE_COMPOUNDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b([LR])\/H\/F\b/g, ' $1H FRONT '],
  [/\b([LR])\/H\/R\b/g, ' $1H REAR '],
  [/\b([LR])HF\b/g, ' $1H FRONT '],
  [/\b([LR])HR\b/g, ' $1H REAR '],
  [/\b([LR])\/H\b/g, ' $1H '],
  [/\b([LR])\/HAND\b/g, ' $1H '],
  [/\bLEFT HAND\b/g, ' LH '],
  [/\bRIGHT HAND\b/g, ' RH '],
  [/\b([LR])HS\b/g, ' $1H '],
  // "L/F", "R/F" (and LF/RF): left/right front. "R/R": right rear (rear
  // right reads the same).
  [/\b([LR])\/F\b/g, ' $1H FRONT '],
  [/\b([LR])F\b/g, ' $1H FRONT '],
  [/\bR\/R\b/g, ' RH REAR '],
];

/**
 * A single letter and a slash in front of a word, after the compounds and
 * PHRASE_SYNONYMS (F/LAMP, R/BAR...) have been rewritten: "L/" can only be
 * left and "F/" only front, but "R/" could be rear or right
 * ("R/LOWER CONTROL ARM"), so it makes the wording unclear.
 */
export const LETTER_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bL\/(?=[A-Z])/g, ' LH '],
  [/\bF\/(?=[A-Z])/g, ' FRONT '],
  [/\bR\/(?=[A-Z])/g, ' UNCLEAR '],
];

/**
 * Leftover single letters (and LR) after all the rewriting: position or side
 * shorthand we couldn't read. Never matched as words; they make the line's
 * wording unclear.
 */
export const UNREADABLE_TOKENS: ReadonlySet<string> = new Set(['L', 'R', 'F', 'LR']);

/** Words that only carry the side; removed from the normalised text once the side is parsed. */
export const LEFT_TOKENS: ReadonlySet<string> = new Set(['LH', 'LEFT']);
export const RIGHT_TOKENS: ReadonlySet<string> = new Set(['RH', 'RIGHT']);

/**
 * Position words (after synonym mapping). A "similar wording" match must have
 * exactly the same ones: a FRONT liner is never a REAR liner.
 */
export const POSITION_TOKENS: ReadonlySet<string> = new Set([
  'FRONT',
  'REAR',
  'UPPER',
  'LOWER',
  'INNER',
  'OUTER',
  'CENTRE',
]);

/** Multi-word or slashed shorthand, rewritten before punctuation is stripped. */
export const PHRASE_SYNONYMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bB\/BAR\b/g, ' BUMPER '],
  [/\bF\/BAR\b/g, ' FRONT BUMPER '],
  [/\bR\/BAR\b/g, ' REAR BUMPER '],
  [/\bBAR COVER\b/g, ' BUMPER '],
  [/\bBUMPER BAR\b/g, ' BUMPER '],
  [/\bW\/ARCH\b/g, ' WHEEL ARCH '],
  [/\bH\/LAMP\b/g, ' HEADLAMP '],
  [/\bHEAD LAMP\b/g, ' HEADLAMP '],
  [/\bHEAD LIGHT\b/g, ' HEADLAMP '],
  [/\bT\/LAMP\b/g, ' TAILLAMP '],
  [/\bTAIL LAMP\b/g, ' TAILLAMP '],
  [/\bTAIL LIGHT\b/g, ' TAILLAMP '],
  [/\bF\/LAMP\b/g, ' FOGLAMP '],
  [/\bFOG LAMP\b/g, ' FOGLAMP '],
  [/\bFOG LIGHT\b/g, ' FOGLAMP '],
  [/\bW\/SHIELD\b/g, ' WINDSCREEN '],
  [/\bW\/SCREEN\b/g, ' WINDSCREEN '],
  [/\bWEATHER ?SH(?:IE|EI)LD\b/g, ' WEATHERSHIELD '],
  [/\bQ\/PANEL\b/g, ' QUARTER PANEL '],
  [/\bS\/STEP\b/g, ' SIDE STEP '],
  [/\bW\/HOUSE\b/g, ' WHEELHOUSE '],
  [/\bWHEEL HOUSE\b/g, ' WHEELHOUSE '],
];

/** Single-word abbreviations and spelling variants → one canonical word. */
export const TOKEN_SYNONYMS: Readonly<Record<string, string>> = {
  FR: 'FRONT',
  FRT: 'FRONT',
  RR: 'REAR',
  MOULD: 'MOULDING',
  MLDG: 'MOULDING',
  MLD: 'MOULDING',
  MOLDING: 'MOULDING',
  MOLD: 'MOULDING',
  FENDER: 'GUARD',
  GRD: 'GUARD',
  BUMP: 'BUMPER',
  BUMPR: 'BUMPER',
  FACE: 'BUMPER', // ERA's "FACE,FR BUMPER" is the bumper bar cover
  QTR: 'QUARTER',
  ASSY: 'ASSEMBLY',
  ASSEM: 'ASSEMBLY',
  ASM: 'ASSEMBLY',
  LWR: 'LOWER',
  UPR: 'UPPER',
  INR: 'INNER',
  OTR: 'OUTER',
  OUTSIDE: 'OUTER',
  INSIDE: 'INNER',
  DR: 'DOOR',
  PNL: 'PANEL',
  BRKT: 'BRACKET',
  BRK: 'BRACKET',
  REINF: 'REINFORCEMENT',
  REINFORCE: 'REINFORCEMENT',
  GRILL: 'GRILLE',
  MIRR: 'MIRROR',
  WHL: 'WHEEL',
  CTRL: 'CONTROL',
  SUSP: 'SUSPENSION',
  RAD: 'RADIATOR',
  COND: 'CONDENSER',
  ABSORB: 'ABSORBER',
  SHEILD: 'SHIELD',
  SPLASHGUARD: 'SPLASH GUARD',
  HDL: 'HANDLE',
  HNDL: 'HANDLE',
  EMB: 'EMBLEM',
  BADGE: 'EMBLEM',
  SENSR: 'SENSOR',
  CAM: 'CAMERA',
  HSG: 'HOUSING',
  CTR: 'CENTRE',
  CENTER: 'CENTRE',
};
