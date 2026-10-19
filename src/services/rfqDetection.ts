/**
 * Confirmed against a real `price-quote.php` export: the URL path is
 * `/appV2/price-quote.php`, and the page always renders a "Vehicle Info"
 * panel and a `#lineTable` of requested parts. Checking both the URL and
 * these DOM markers (rather than either alone) avoids false positives on
 * other PartsCheck pages that might reuse one of these pieces.
 */
export function isRfqPage(location: Location = window.location, root: ParentNode = document): boolean {
  const isPriceQuotePath = /\/price-quote\.php/i.test(location.pathname);
  if (!isPriceQuotePath) return false;

  const hasLineTable = root.querySelector('#lineTable') !== null;
  const hasVehicleInfoPanel = Array.from(root.querySelectorAll('.quoteTitleBar')).some(
    (el) => el.textContent?.trim() === 'Vehicle Info',
  );

  return hasLineTable && hasVehicleInfoPanel;
}
