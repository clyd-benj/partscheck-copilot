import { readQuoteField } from './dom';

/** PartsCheck's "Reference" field under General Info — the repairer's own job/reference number. */
export function extractReference(root: ParentNode = document): string | undefined {
  return readQuoteField('Reference', root);
}

/** PartsCheck's "Required By" field — the date/time the quote is due back. */
export function extractRequiredBy(root: ParentNode = document): string | undefined {
  return readQuoteField('Required By', root);
}
