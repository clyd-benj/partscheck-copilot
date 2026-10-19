import { describe, it, expect } from "vitest";
import { extractVehicleFields } from "@/services/asacaps/vehicle-extract";
import { fixture } from "./fixtures";

describe("extractVehicleFields", () => {
  it("extracts make/model/variant/year/engine/transmission from generic text", () => {
    const fields = extractVehicleFields(
      fixture("vehicle-with-vin-and-fields.txt"),
      "JMFXTGF8WLJ003875"
    );
    expect(fields.make).toBe("Mitsubishi");
    expect(fields.model).toBe("Triton");
    expect(fields.variant).toBe("GLX-R");
    expect(fields.year).toBe("2019");
    expect(fields.transmission).toBe("Automatic");
  });

  it("extracts only the VIN when no other info is present", () => {
    const fields = extractVehicleFields(fixture("vehicle-vin-only.txt"), "JMFXTGF8WLJ003875");
    expect(fields.make).toBeUndefined();
    expect(fields.model).toBeUndefined();
  });

  it("parses the real ASA CAPS breadcrumb format", () => {
    const fields = extractVehicleFields(fixture("vehicle-asa-caps-real.txt"), "JMFXTGA2WBZ003283");
    expect(fields.make).toBe("Mitsubishi");
    expect(fields.model).toBe("ASX");
    expect(fields.chassisCode).toBe("MMAL");
    expect(fields.variant).toBe("2000 | LS(2WD),S-CVT");
    expect(fields.modelCode).toBe("GA2W");
    expect(fields.classification).toBe("XTSHR8");
    expect(fields.option).toBe("M09");
    expect(fields.exteriorColor).toBe("X42A");
    expect(fields.interiorColor).toBe("22X");
    expect(fields.productionFrom).toBe("2010.12.3");
    expect(fields.productionTo).toBe("2010.12.3");
    expect(fields.year).toBe("2010");
    expect(fields.transmission).toBe("S-cvt");
  });

  it("parses a richer ASA CAPS breadcrumb with a multi-word model and slash-separated chassis codes", () => {
    const fields = extractVehicleFields(fixture("vehicle-asa-caps-pajero.txt"), "MMAJLKL10MH013928");
    expect(fields.make).toBe("Mitsubishi");
    expect(fields.model).toBe("PAJERO SPORT");
    expect(fields.chassisCode).toBe("MMAL/MMTH");
    expect(fields.variant).toBe("2400DIESEL(4N15)/4WD M-LINE(4WD/5SEAT/7SEAT),8FA/T MMAL");
    expect(fields.modelCode).toBe("KS1W");
    expect(fields.classification).toBe("GUMFPR8");
    expect(fields.option).toBe("N87");
    expect(fields.exteriorColor).toBe("X08A");
    expect(fields.interiorColor).toBe("09J");
    expect(fields.productionFrom).toBe("2016.6.2");
    expect(fields.productionTo).toBe("2016.6.2");
    expect(fields.year).toBe("2016");
  });
});
