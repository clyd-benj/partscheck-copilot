import Fuse from 'fuse.js';
import type { CustomerMatch, CustomerRecord } from '@/types/customer';

const MAX_RESULTS = 3;
/**
 * Only an exact (or near-as-good-as-exact) match is trustworthy enough to
 * hand a customer number off — a wrong guess bills the wrong account. Only
 * the single best match is ever shown, and only once it clears this bar.
 */
const CONFIDENCE_THRESHOLD = 100;

/**
 * Company name is the primary search signal, address a secondary one via
 * key weighting — NOT concatenated into the query string. Fuse.js matches
 * one query string against each key independently, so a combined
 * "company + address" query matches neither field fully and produces
 * artificially low scores even for an exact match on both. Querying with
 * the company name alone (falling back to address if there's no company)
 * still benefits from the address field through the weighted keys below.
 */
export function findCustomerMatches(
  query: { company?: string; address?: string },
  customers: CustomerRecord[],
): CustomerMatch[] {
  if (customers.length === 0) return [];

  const searchTerm = query.company ?? query.address;
  if (!searchTerm) return [];

  const fuse = new Fuse(customers, {
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'address', weight: 0.3 },
    ],
    includeScore: true,
    threshold: 0.6,
    ignoreLocation: true,
  });

  return fuse.search(searchTerm, { limit: MAX_RESULTS }).map((result) => ({
    ...result.item,
    confidence: Math.round((1 - (result.score ?? 1)) * 100),
  }));
}

export function isConfidentMatch(match: CustomerMatch): boolean {
  return match.confidence >= CONFIDENCE_THRESHOLD;
}
