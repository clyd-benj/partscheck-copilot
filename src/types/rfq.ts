export interface RequestedPart {
  /** PartsCheck's own `data-draft_item_id`, stable for the life of the RFQ. */
  id: string;
  description: string;
}

export interface CustomerInfo {
  company?: string;
  address?: string;
  phone?: string;
}

export interface VehicleInfo {
  make?: string;
  model?: string;
  variant?: string;
  vin?: string;
  registration?: string;
}

export interface RfqData {
  customer: CustomerInfo;
  vehicle: VehicleInfo;
  requestedParts: RequestedPart[];
  /** PartsCheck's "Reference" field under General Info — the repairer's own job/reference number. */
  reference?: string;
  /** PartsCheck's "Required By" field — the date/time the quote is due back. */
  requiredBy?: string;
}
