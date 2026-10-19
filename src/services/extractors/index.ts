import { extractCustomerAddress, extractCustomerCompany, extractCustomerPhone } from './customer';
import { extractReference, extractRequiredBy } from './metadata';
import { extractRequestedParts } from './parts';
import { extractRegistration, extractVehicleMake, extractVehicleModel, extractVehicleVariant, extractVin } from './vehicle';
import type { RfqData } from '@/types/rfq';

export function extractRfqData(root: ParentNode = document): RfqData {
  return {
    customer: {
      company: extractCustomerCompany(root),
      address: extractCustomerAddress(root),
      phone: extractCustomerPhone(root),
    },
    vehicle: {
      make: extractVehicleMake(root),
      model: extractVehicleModel(root),
      variant: extractVehicleVariant(root),
      vin: extractVin(root),
      registration: extractRegistration(root),
    },
    requestedParts: extractRequestedParts(root),
    reference: extractReference(root),
    requiredBy: extractRequiredBy(root),
  };
}

export * from './customer';
export * from './vehicle';
export * from './parts';
export * from './metadata';
