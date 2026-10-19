// Best-effort extraction of vehicle fields from the same clipboard text a
// VIN was found in. Never invents data: a field is only populated when
// something in the text plausibly matches it.
//
// Includes a dedicated parser for the real ASA CAPS (myasaweb.com) UI
// format, observed directly from the app. The breadcrumb's model segment
// varies a lot between vehicles, e.g.:
//   "ASX(MMAL) 2000 | LS(2WD),S-CVT"
//   "PAJERO SPORT(MMAL/MMTH) 2400DIESEL(4N15)/4WD M-LINE(4WD/5SEAT/7SEAT),8FA/T MMAL"
// so rather than over-fitting to one shape, only the model name and the
// chassis code(s) in the first parenthesis are pulled out structurally;
// everything else up to "VIN:" is kept verbatim as `variant` rather than
// guessed at. Tech info is a separate, stable line:
//   "Model: GA2W  Classification: XTSHR8  Option: M09
//    Exterior: X42A  Interior: 22X  From: 2010.12.3  To: 2010.12.3"
// ASA CAPS is Mitsubishi's Aftersales Support Application, so "Mitsubishi"
// is filled in as make only when this system-specific signature is present
// — that's a known constant of the source system, not a guess per vehicle.

const KNOWN_MAKES = [
  'MITSUBISHI',
  'TOYOTA',
  'NISSAN',
  'MAZDA',
  'HONDA',
  'SUBARU',
  'SUZUKI',
  'ISUZU',
  'FORD',
  'HOLDEN',
  'HYUNDAI',
  'KIA',
  'VOLKSWAGEN',
  'MERCEDES-BENZ',
  'MERCEDES',
  'BMW',
  'AUDI',
  'LEXUS',
  'JEEP',
  'RAM',
  'CHEVROLET',
  'GREAT WALL',
  'GWM',
  'LDV',
  'SSANGYONG',
  'RENAULT',
  'PEUGEOT',
  'VOLVO',
  'LAND ROVER',
  'JAGUAR',
  'MG',
  'HAVAL',
  'CHERY',
  'FIAT',
  'SKODA',
];

const TRANSMISSION_WORDS = /\b(automatic|auto|manual|cvt|tiptronic|s-cvt)\b/i;
const ENGINE_PATTERN = /\b\d(?:\.\d)?\s*L\b[^,\n]*?(?:diesel|petrol|turbo|hybrid|electric)?/i;
const ENGINE_KEYWORD_LINE = /\b(diesel|petrol|turbo diesel|hybrid|electric)\b/i;
const YEAR_PATTERN = /\b(19[5-9]\d|20[0-4]\d)\b/;

// ASA CAPS tech-info line: "Model: GA2W Classification: XTSHR8 Option: M09
// Exterior: X42A Interior: 22X From: 2010.12.3 To: 2010.12.3"
const ASA_TECH_INFO = new RegExp(
  'Model:\\s*(?<modelCode>\\S+)\\s*' +
    'Classification:\\s*(?<classification>\\S+)\\s*' +
    'Option:\\s*(?<option>\\S+)\\s*' +
    'Exterior:\\s*(?<exteriorColor>\\S+)\\s*' +
    'Interior:\\s*(?<interiorColor>\\S+)\\s*' +
    'From:\\s*(?<productionFrom>[\\d.]+)\\s*' +
    'To:\\s*(?<productionTo>[\\d.]+)',
  'i',
);

// ASA CAPS model breadcrumb, e.g. "ASX(MMAL) 2000 | LS(2WD),S-CVT" or
// "PAJERO SPORT(MMAL/MMTH) 2400DIESEL(4N15)/4WD M-LINE(4WD/5SEAT/7SEAT),8FA/T MMAL".
// Only the model name (can be multiple words) and the chassis code(s) in
// the first parenthesis are parsed structurally; the remainder up to a
// following "VIN:" label (same line or next) or end of line is kept
// verbatim as the variant, since its internal shape varies per model.
const ASA_MODEL_LINE = /\b([A-Z][A-Z0-9 -]{1,30}?)\(([A-Z0-9/]{2,20})\)\s*([^\n]+?)(?=\s+VIN:|$)/i;

export interface ExtractedVehicleFields {
  make?: string;
  model?: string;
  variant?: string;
  year?: string;
  engine?: string;
  transmission?: string;
  modelCode?: string;
  chassisCode?: string;
  classification?: string;
  option?: string;
  exteriorColor?: string;
  interiorColor?: string;
  productionFrom?: string;
  productionTo?: string;
}

function extractAsaCapsFields(text: string): ExtractedVehicleFields {
  const fields: ExtractedVehicleFields = {};

  const techMatch = text.match(ASA_TECH_INFO);
  if (techMatch?.groups) {
    fields.make = 'Mitsubishi'; // ASA CAPS is a Mitsubishi-only system
    fields.modelCode = techMatch.groups.modelCode;
    fields.classification = techMatch.groups.classification;
    fields.option = techMatch.groups.option;
    fields.exteriorColor = techMatch.groups.exteriorColor;
    fields.interiorColor = techMatch.groups.interiorColor;
    fields.productionFrom = techMatch.groups.productionFrom;
    fields.productionTo = techMatch.groups.productionTo;

    const yearFromProd = techMatch.groups.productionFrom?.match(/^(\d{4})/);
    if (yearFromProd) fields.year = yearFromProd[1];
  }

  const modelLineMatch = text.match(ASA_MODEL_LINE);
  if (modelLineMatch) {
    fields.make = fields.make ?? 'Mitsubishi';
    fields.model = modelLineMatch[1].trim();
    fields.chassisCode = modelLineMatch[2];
    const variant = modelLineMatch[3].trim();
    if (variant) fields.variant = variant;
    const transMatch = variant.match(TRANSMISSION_WORDS);
    if (transMatch) fields.transmission = capitalise(transMatch[1]);
  }

  return fields;
}

export function extractVehicleFields(text: string, vin: string): ExtractedVehicleFields {
  const asaFields = extractAsaCapsFields(text);
  const generic = extractGenericVehicleFields(text, vin);

  // ASA-specific matches take priority since they come from a known,
  // reliable structure; generic heuristics fill in any remaining gaps.
  return { ...generic, ...asaFields };
}

function extractGenericVehicleFields(text: string, vin: string): ExtractedVehicleFields {
  const fields: ExtractedVehicleFields = {};
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const vinUpper = vin.toUpperCase();

  for (const line of lines) {
    if (line.toUpperCase().includes(vinUpper)) continue;

    if (!fields.year) {
      const yearMatch = line.match(YEAR_PATTERN);
      if (yearMatch) fields.year = yearMatch[1];
    }

    if (!fields.transmission) {
      const transMatch = line.match(TRANSMISSION_WORDS);
      if (transMatch) fields.transmission = capitalise(transMatch[1]);
    }

    if (!fields.engine) {
      const engineMatch = line.match(ENGINE_PATTERN);
      if (engineMatch) {
        fields.engine = engineMatch[0].trim();
      } else if (ENGINE_KEYWORD_LINE.test(line) && line.length < 40) {
        fields.engine = line;
      }
    }

    if (!fields.make) {
      const upperLine = line.toUpperCase();
      const foundMake = KNOWN_MAKES.find((make) => upperLine.includes(make));
      if (foundMake) {
        fields.make = capitaliseMake(foundMake);
        const rest = line
          .replace(new RegExp(foundMake, 'i'), '')
          .trim()
          .replace(/^[-,:]\s*/, '');
        if (rest) {
          const parts = rest.split(/\s+/);
          fields.model = parts[0];
          if (parts.length > 1) {
            fields.variant = parts.slice(1).join(' ');
          }
        }
      }
    }
  }

  return fields;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function capitaliseMake(make: string): string {
  if (make === 'BMW' || make === 'MG' || make === 'GWM') return make;
  return make
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
