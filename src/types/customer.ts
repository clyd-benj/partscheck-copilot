export interface CustomerRecord {
  customerNumber: string;
  name: string;
  address: string;
}

export interface CustomerMatch extends CustomerRecord {
  /** 0-100, derived from Fuse.js's match score (lower score = better match). */
  confidence: number;
}

export interface CustomerDbMeta {
  importedAt: string;
  sourceFileName: string;
}
