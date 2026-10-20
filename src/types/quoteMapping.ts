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
  /** Part Number input, '' when the row hasn't been filled yet. */
  partNumber: string;
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

  firstSeen: string;
  lastSeen: string;
}

/** What a capture saved, reported back to the PartsCheck panel. */
export interface QuoteCaptureResult {
  quoteKey: string;
  /** Rows saved as real mappings (excludes NA rows). */
  mappings: number;
  noGenuinePart: number;
  accessories: number;
  sideConflicts: QuoteMapping[];
  /** Visible requested lines on the page. */
  requestedLines: number;
  /** Rows with a Part Number filled in (including NA). */
  filledRows: number;
}
