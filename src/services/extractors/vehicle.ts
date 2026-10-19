import { readQuoteField } from './dom';

export function extractVehicleMake(root: ParentNode = document): string | undefined {
  return readQuoteField('Make', root);
}

export function extractVehicleModel(root: ParentNode = document): string | undefined {
  return readQuoteField('Model', root);
}

/** PartsCheck labels this field "Series" (e.g. trim level) — it's the closest match to "Variant". */
export function extractVehicleVariant(root: ParentNode = document): string | undefined {
  return readQuoteField('Series', root);
}

/** Rendered as an `<input>` value, not plain text — readQuoteField handles both. */
export function extractVin(root: ParentNode = document): string | undefined {
  return readQuoteField('VIN', root);
}

/** PartsCheck labels this field "Veh Reg". */
export function extractRegistration(root: ParentNode = document): string | undefined {
  return readQuoteField('Veh Reg', root);
}
