import type { BuildMonthSource } from '@/services/quoteCapture/buildDate';

// Learned "repairer description → ASA CAPS part number" pairs, captured from
// PartsCheck quote rows after DMS Upload has filled them (one ERA CSV line
// per PartsCheck line, by position).

/** Side parsed from the repairer's own text. BOTH = the line names both sides. */
export type Side = 'LH' | 'RH' | 'BOTH' | 'NONE';

/** One visible part row of PartsCheck's `#lineTable`, as read from the page. */
export interface QuoteRow {
  /** 1-based line number (PartsCheck's print order + 1). */
  rowNo: number;
  /** PartsCheck's `data-iteration`; 0 for the primary row of a line. */
  iteration: number;
  draftItemId: string;
  /** The repairer's original description (`data-parttext`). */
  repairerDescription: string;
  /** Bold ERA description shown once the row is filled (commas stripped, truncated). */
  eraDescription?: string;
  /** Part Number input as rendered by PartsCheck, '' when empty. */
  partNumber: string;
  /**
   * The description cell has the post-DMS-Upload structure
   * `<b>ERA DESCRIPTION</b><br/><i>repairer text</i>`, so the part number
   * came from ERA. Without it, a filled Part Number was typed in by the
   * repairer and is not a verified answer.
   */
  fromDmsUpload: boolean;
  qty?: number;
  listPrice?: number;
  buyPrice?: number;
  /** "Note for Purchaser" input. */
  note?: string;
}

/** Quote-level fields read alongside the rows. */
export interface QuoteContext {
  /** Stable key for this quote: PartsCheck's draftID, or the Reference as a fallback. */
  quoteKey: string;
  draftId?: string;
  /** PartsCheck "Reference" — the repairer's own job number. */
  reference?: string;
  /** PartsCheck "Quote Nr" — the ERA quote number once entered/uploaded. */
  eraQuoteNo?: string;
  vin?: string;
  make?: string;
  model?: string;
  /** PartsCheck "Model Nr" (often blank). */
  modelNr?: string;
  series?: string;
  registration?: string;
  /** PartsCheck "Mth/Yr", e.g. "12/2022". */
  mthYr?: string;
}

export interface QuoteMapping {
  /** `${quoteKey}::${rowNo}` (plus `.${iteration}` for non-primary rows). */
  id: string;
  quoteKey: string;
  draftId?: string;
  reference?: string;
  eraQuoteNo?: string;
  rowNo: number;
  iteration: number;
  draftItemId: string;

  repairerDescription: string;
  repairerNormalised: string;
  side: Side;

  partNumber: string;
  eraDescription?: string;
  qty?: number;
  listPrice?: number;
  buyPrice?: number;
  note?: string;

  /** Part number "NA" / "NOT APPLICABLE": no genuine part supplied. Never suggested. */
  noGenuinePart: boolean;
  /** MZ-prefixed part numbers are Mitsubishi accessories. */
  isAccessory: boolean;
  /** The ERA description names the opposite side to the repairer's text — a likely ERA ordering slip. */
  sideConflict: boolean;

  vin?: string;
  make?: string;
  model?: string;
  series?: string;
  modelNr?: string;
  registration?: string;
  mthYr?: string;
  /** From the ASA CAPS catalogue's vehicle record for this VIN, if known. */
  modelCode?: string;
  /** Vehicle build month (year * 12 + month), see services/quoteCapture/buildDate.ts. */
  buildMonth?: number;
  /** Where buildMonth came from: ASA CAPS productionFrom, or PartsCheck Mth/Yr. */
  buildMonthSource?: BuildMonthSource;
  /**
   * Set when this row verified a hidden (POSSIBLE) suggestion: the learned
   * link's id (services/quoteCapture/learning.ts). The row then counts in
   * suggestions only through that link, never through the usual rules.
   */
  learnedLinkId?: string;

  firstSeen: string;
  lastSeen: string;
}

/**
 * A part number the repairer typed into PartsCheck themselves before the
 * quote was priced (often a base-model or wrong number, sometimes free
 * text). Never a mapping or a suggestion; kept so it can be paired with the
 * verified number once the same quote is DMS-uploaded — correction pairs
 * for a later feature.
 */
export interface RepairerSuppliedPart {
  /** Same id scheme as QuoteMapping: `${quoteKey}::${rowNo}`. */
  id: string;
  quoteKey: string;
  draftId?: string;
  reference?: string;
  rowNo: number;
  iteration: number;
  draftItemId: string;
  repairerDescription: string;
  repairerNormalised: string;
  side: Side;
  /** What was in the Part Number box (uppercased, whitespace collapsed). */
  suppliedValue: string;
  /** Matches one of the ASA CAPS part-number patterns (vs free text like "TRITON BAGDE"). */
  looksLikePartNumber: boolean;
  vin?: string;
  make?: string;
  model?: string;
  /** Set once the same row is seen after DMS Upload. */
  verifiedPartNumber?: string;
  verifiedEraDescription?: string;
  verifiedNoGenuinePart?: boolean;
  /** The repairer's value equals the verified number (ignoring spaces). */
  matchesVerified?: boolean;
  linkedAt?: string;
  firstSeen: string;
  lastSeen: string;
}

/** What a capture saved, reported back to the PartsCheck panel. */
export interface QuoteCaptureResult {
  quoteKey: string;
  /** Verified rows saved as real mappings (excludes NA rows). */
  mappings: number;
  noGenuinePart: number;
  accessories: number;
  sideConflicts: QuoteMapping[];
  /** Visible requested lines on the page. */
  requestedLines: number;
  /** Rows filled by DMS Upload (including NA). */
  verifiedRows: number;
  /** Rows with a part number the repairer typed in — ignored as answers. */
  repairerSuppliedRows: number;
  /** Repairer-supplied values on this quote now paired with a verified number. */
  repairerSuppliedLinked: number;
  /** Hidden suggestions this quote's upload proved right / chose against (learning.ts). */
  learning?: { verified: number; nowConfirmed: number; contradicted: number };
}
