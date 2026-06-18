export const CARRIERS = [
  "Progressive",
  "GEICO",
  "State Farm",
  "USAA",
  "Liberty Mutual",
  "Direct Auto",
  "National General",
  "Travelers",
  "Farmers",
  "Nationwide",
  "Auto-Owners",
  "Safeco",
  "Mercury",
  "Kemper",
  "AAA / Auto Club Group",
  "Amica",
  "The Hartford",
  "Allstate",
  "Other",
  "None",
] as const;

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
] as const;

export const DISPO_OPTIONS = [
  { value: "quoted", label: "Quoted" },
  { value: "sold", label: "Sold" },
  { value: "not_quoted", label: "Not Quoted" },
  { value: "voicemail", label: "VM" },
  { value: "follow_up", label: "Follow Up" },
  { value: "x_date", label: "X-Date" },
  { value: "already_has_allstate", label: "Has Allstate" },
  { value: "already_a_client", label: "Already a Client" },
  { value: "wrong_number", label: "Wrong Number" },
  { value: "dead", label: "Dead" },
  { value: "dnc", label: "DNC" },
] as const;

export type Dispo = (typeof DISPO_OPTIONS)[number]["value"];

// When a prospect is "Already a Client", agents pick which lines they already
// hold so the rest of the team knows what cross-sell opportunities remain.
export const EXISTING_CLIENT_LINE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "home", label: "Home" },
  { value: "renters", label: "Renters" },
  { value: "condo", label: "Condo" },
  { value: "umbrella", label: "Umbrella" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "boat", label: "Boat" },
  { value: "rv", label: "RV" },
  { value: "flood", label: "Flood" },
  { value: "golf_cart", label: "Golf Cart" },
  { value: "life", label: "Life" },
  { value: "atv", label: "ATV" },
  { value: "commercial", label: "Commercial" },
] as const;
export type ExistingClientLine = (typeof EXISTING_CLIENT_LINE_OPTIONS)[number]["value"];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  sales: "Sales Agent",
  vendor: "Vendor",
  telemarketer: "Telemarketer",
  pending: "Pending Approval",
};

// Vehicle years — next model year back to 1980
const _maxYear = new Date().getFullYear() + 1;
export const VEHICLE_YEARS: string[] = Array.from(
  { length: _maxYear - 1980 + 1 },
  (_, i) => String(_maxYear - i),
);

// Comprehensive makes/models catalog (US market, current + recent legacy nameplates).
// Ram trucks intentionally appear under both Dodge (pre-2010 + colloquial) and Ram (2010+).
export const VEHICLE_MODELS_BY_MAKE: Record<string, string[]> = {
  Acura: ["ILX", "TLX", "RLX", "RSX", "TSX", "TL", "RDX", "MDX", "ZDX", "Integra", "NSX"],
  "Alfa Romeo": ["Giulia", "Stelvio", "Tonale", "4C", "8C"],
  "Aston Martin": ["DB11", "DB12", "Vantage", "DBX", "DBS"],
  Audi: [
    "A3", "S3", "RS3", "A4", "S4", "RS4", "A5", "S5", "RS5", "A6", "S6", "RS6",
    "A7", "S7", "RS7", "A8", "S8", "Q3", "RS Q3", "Q4 e-tron", "Q5", "SQ5",
    "Q7", "SQ7", "Q8", "SQ8", "RS Q8", "e-tron", "e-tron GT", "TT", "R8",
  ],
  Bentley: ["Continental GT", "Flying Spur", "Bentayga", "Mulsanne"],
  BMW: [
    "1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series",
    "7 Series", "8 Series", "M2", "M3", "M4", "M5", "M8",
    "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM",
    "Z3", "Z4", "i3", "i4", "i5", "i7", "iX", "iX1", "iX3",
  ],
  Buick: [
    "Encore", "Encore GX", "Envision", "Enclave", "Envista",
    "Regal", "LaCrosse", "Verano", "Cascada", "Lucerne", "Century",
  ],
  Cadillac: [
    "ATS", "CT4", "CT5", "CT6", "CTS", "STS", "XTS", "DTS", "ELR",
    "XT4", "XT5", "XT6", "SRX", "Escalade", "Escalade ESV", "Escalade IQ", "Lyriq",
  ],
  Chevrolet: [
    "Spark", "Sonic", "Cruze", "Cobalt", "Malibu", "Impala", "SS", "Volt", "Bolt EV", "Bolt EUV",
    "Camaro", "Corvette", "Trax", "Trailblazer", "Equinox", "Equinox EV",
    "Blazer", "Blazer EV", "Traverse", "Tahoe", "Suburban", "HHR", "Captiva",
    "Colorado", "Avalanche", "S10",
    "Silverado 1500", "Silverado 2500", "Silverado 3500", "Silverado EV",
    "Express", "City Express",
  ],
  Chrysler: ["200", "300", "Sebring", "PT Cruiser", "Pacifica", "Voyager", "Town & Country", "Aspen", "Crossfire"],
  Dodge: [
    "Avenger", "Caliber", "Dart", "Neon",
    "Charger", "Challenger", "Magnum", "Viper",
    "Nitro", "Journey", "Durango",
    "Caravan", "Grand Caravan",
    "Dakota",
    "Ram 1500", "Ram 2500", "Ram 3500",
  ],
  Fiat: ["500", "500L", "500X", "124 Spider"],
  Ford: [
    "Fiesta", "Focus", "Fusion", "Taurus", "C-Max", "Mustang", "Mustang Mach-E",
    "EcoSport", "Escape", "Edge", "Bronco", "Bronco Sport",
    "Explorer", "Flex", "Expedition", "Expedition Max",
    "Ranger", "Maverick", "F-150", "F-150 Lightning",
    "F-250", "F-350", "F-450", "Super Duty",
    "Transit", "Transit Connect", "E-Series", "E-Transit",
    "Crown Victoria", "Five Hundred", "Freestar", "Freestyle",
  ],
  Genesis: ["G70", "G80", "G90", "GV60", "GV70", "GV80"],
  GMC: [
    "Terrain", "Acadia", "Yukon", "Yukon XL", "Envoy",
    "Canyon", "Sierra 1500", "Sierra 2500", "Sierra 3500",
    "Hummer EV Pickup", "Hummer EV SUV",
    "Savana",
  ],
  Honda: [
    "Fit", "Civic", "Civic Type R", "Insight", "Accord", "Crosstour", "Clarity",
    "HR-V", "CR-V", "Passport", "Pilot", "Ridgeline", "Element",
    "Odyssey", "S2000", "Prelude",
  ],
  Hyundai: [
    "Accent", "Elantra", "Veloster", "Sonata", "Azera", "Genesis",
    "Venue", "Kona", "Tucson", "Santa Fe", "Santa Cruz", "Palisade", "Nexo",
    "Ioniq", "Ioniq 5", "Ioniq 6",
  ],
  Infiniti: ["Q40", "Q50", "Q60", "Q70", "M37", "M56", "G25", "G35", "G37", "QX30", "QX50", "QX55", "QX56", "QX60", "QX70", "QX80"],
  Jaguar: ["XE", "XF", "XJ", "F-Type", "E-Pace", "F-Pace", "I-Pace"],
  Jeep: [
    "Renegade", "Compass", "Patriot", "Liberty",
    "Cherokee", "Grand Cherokee", "Grand Cherokee L", "Grand Cherokee 4xe",
    "Wrangler", "Wrangler 4xe", "Gladiator", "Wagoneer", "Grand Wagoneer", "Commander",
  ],
  Kia: [
    "Rio", "Forte", "K5", "Optima", "Stinger", "Cadenza", "K900",
    "Soul", "Seltos", "Niro", "Sportage", "Sorento", "Telluride",
    "EV6", "EV9", "Carnival", "Sedona",
  ],
  "Land Rover": [
    "Defender", "Discovery", "Discovery Sport", "Freelander",
    "Range Rover", "Range Rover Sport", "Range Rover Velar", "Range Rover Evoque",
  ],
  Lexus: [
    "IS", "ES", "GS", "LS", "HS", "CT", "RC", "LC",
    "UX", "NX", "RX", "GX", "LX", "LFA", "TX",
  ],
  Lincoln: ["MKZ", "MKS", "MKC", "MKT", "MKX", "Continental", "Corsair", "Nautilus", "Aviator", "Navigator", "Town Car"],
  Maserati: ["Ghibli", "Quattroporte", "Levante", "Grecale", "GranTurismo", "MC20"],
  Mazda: [
    "Mazda2", "Mazda3", "Mazda5", "Mazda6", "MX-5 Miata", "MX-30", "RX-8",
    "CX-3", "CX-30", "CX-5", "CX-50", "CX-7", "CX-9", "CX-90",
    "Tribute", "Protege",
  ],
  "Mercedes-Benz": [
    "A-Class", "B-Class", "C-Class", "CLA", "CLK", "CLS", "E-Class", "S-Class",
    "GLA", "GLB", "GLC", "GLE", "GLS", "GL", "ML", "G-Class",
    "SL", "SLC", "SLK", "AMG GT", "EQA", "EQB", "EQC", "EQE", "EQS", "EQV",
    "Sprinter", "Metris",
  ],
  Mini: ["Cooper", "Cooper Clubman", "Cooper Countryman", "Cooper Paceman", "Cooper Coupe"],
  Mitsubishi: ["Mirage", "Lancer", "Galant", "Eclipse", "Eclipse Cross", "Outlander", "Outlander Sport", "Outlander PHEV", "i-MiEV"],
  Nissan: [
    "Versa", "Sentra", "Altima", "Maxima", "Leaf", "Cube", "Juke", "Murano CrossCabriolet",
    "Kicks", "Rogue", "Rogue Sport", "Murano", "Ariya", "Pathfinder", "Armada", "Xterra",
    "Frontier", "Titan", "Titan XD", "NV200", "NV1500", "NV2500", "NV3500", "Quest", "GT-R", "370Z", "350Z", "Z",
  ],
  Polestar: ["1", "2", "3", "4"],
  Porsche: ["911", "718 Boxster", "718 Cayman", "Panamera", "Macan", "Cayenne", "Taycan"],
  Ram: ["1500", "1500 Classic", "2500", "3500", "4500", "5500", "ProMaster", "ProMaster City"],
  Rivian: ["R1T", "R1S"],
  Saturn: ["Ion", "Aura", "Sky", "Outlook", "Vue"],
  Scion: ["xA", "xB", "xD", "tC", "iQ", "FR-S", "iA", "iM"],
  Smart: ["Fortwo", "Forfour"],
  Subaru: [
    "Impreza", "WRX", "STI", "BRZ", "Legacy", "Tribeca",
    "Crosstrek", "Forester", "Outback", "Ascent", "Solterra",
  ],
  Suzuki: ["SX4", "Kizashi", "Grand Vitara", "XL7", "Aerio", "Forenza", "Reno"],
  Tesla: ["Model 3", "Model Y", "Model S", "Model X", "Cybertruck", "Roadster"],
  Toyota: [
    "Yaris", "Corolla", "Corolla Cross", "Corolla iM", "Matrix",
    "Camry", "Avalon", "Prius", "Prius Prime", "Prius c", "Prius v", "Mirai",
    "GR86", "GR Corolla", "GR Supra", "Supra", "Celica", "MR2",
    "C-HR", "RAV4", "RAV4 Prime", "Venza", "Highlander", "Grand Highlander",
    "4Runner", "Sequoia", "Land Cruiser", "FJ Cruiser",
    "Tacoma", "Tundra", "Sienna", "bZ4X",
  ],
  Volkswagen: [
    "Jetta", "Jetta GLI", "Passat", "Arteon", "CC", "Eos",
    "Golf", "Golf GTI", "Golf R", "Golf SportWagen", "Rabbit", "Beetle",
    "Taos", "Tiguan", "Atlas", "Atlas Cross Sport", "Touareg",
    "ID.4", "ID.7", "ID. Buzz", "Routan",
  ],
  Volvo: ["S60", "S80", "S90", "V60", "V90", "C30", "C40 Recharge", "C70", "XC40", "XC60", "XC70", "XC90", "EX30", "EX90"],
  Other: ["Other"],
};

export const VEHICLE_MAKES: string[] = Object.keys(VEHICLE_MODELS_BY_MAKE);

export type Vehicle = { year: string; make: string; model: string };

export const LEAD_TYPES = [
  { value: "auto", label: "Auto" },
  { value: "home", label: "Home" },
  { value: "both", label: "Auto + Home" },
  { value: "umbrella", label: "Umbrella" },
  { value: "flood", label: "Flood" },
  { value: "boat", label: "Boat" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "golf_cart", label: "Golf Cart" },
  { value: "rv", label: "RV" },
] as const;
export type LeadType = (typeof LEAD_TYPES)[number]["value"];

export const LEAD_SOURCES = [
  { value: "internet", label: "Internet" },
  { value: "referral", label: "Referral" },
  { value: "cold_call", label: "Cold Call" },
  { value: "live_transfer", label: "Live Transfer" },
  { value: "aged", label: "Aged" },
  { value: "other", label: "Other" },
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number]["value"];

export const SCRIPT_TYPES = [
  { value: "aged", label: "Aged" },
  { value: "winback", label: "Winback" },
  { value: "live_transfer", label: "Live Transfer" },
  { value: "web_lead", label: "Web Lead" },
  { value: "referral", label: "Referral" },
  { value: "cold_call", label: "Cold Call" },
  { value: "cross_sell", label: "Cross-sell" },
  { value: "renewal", label: "Renewal" },
  { value: "anchorline", label: "Anchorline" },
  { value: "requote", label: "Requote" },
  { value: "missed_transfer", label: "Missed Transfer" },
] as const;
export type ScriptType = (typeof SCRIPT_TYPES)[number]["value"];

// Extra coverage lines beyond Auto and Home — each line tracks its own
// dispo, quoted premium, agent notes, and (when sold) fires a sale event.
export type LineType = "motorcycle" | "boat" | "umbrella" | "flood" | "golf_cart" | "rv" | "auto" | "home";

export type LineFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "checkbox" | "address";
  placeholder?: string;
};

export const LINE_TYPE_META: Record<
  LineType,
  { label: string; fields: LineFieldDef[] }
> = {
  motorcycle: {
    label: "Motorcycle",
    fields: [
      { key: "year", label: "Year", type: "text", placeholder: "2022" },
      { key: "make", label: "Make", type: "text", placeholder: "Harley-Davidson" },
      { key: "model", label: "Model", type: "text", placeholder: "Street Glide" },
      { key: "vin", label: "VIN", type: "text" },
    ],
  },
  boat: {
    label: "Boat",
    fields: [
      { key: "year", label: "Year", type: "text" },
      { key: "make", label: "Make", type: "text" },
      { key: "model", label: "Model", type: "text" },
      { key: "length_ft", label: "Length (ft)", type: "number" },
      { key: "hp", label: "Horsepower", type: "number" },
      { key: "hull_type", label: "Hull type", type: "text" },
    ],
  },
  umbrella: {
    label: "Umbrella",
    fields: [
      { key: "coverage_limit", label: "Coverage limit ($)", type: "number", placeholder: "1000000" },
      { key: "underlying_carrier", label: "Underlying carrier", type: "text" },
      { key: "property_address", label: "Property address", type: "address" },
    ],
  },
  flood: {
    label: "Flood",
    fields: [
      { key: "property_address", label: "Property address", type: "address" },
      { key: "flood_zone", label: "Flood zone", type: "text", placeholder: "X / AE / VE" },
      { key: "elevation_certificate", label: "Elevation certificate", type: "checkbox" },
    ],
  },
  golf_cart: {
    label: "Golf Cart",
    fields: [
      { key: "year", label: "Year", type: "text" },
      { key: "make", label: "Make", type: "text" },
      { key: "model", label: "Model", type: "text" },
      { key: "vin", label: "VIN/Serial", type: "text" },
    ],
  },
  rv: {
    label: "RV",
    fields: [
      { key: "year", label: "Year", type: "text", placeholder: "2022" },
      { key: "make", label: "Make", type: "text", placeholder: "Winnebago" },
      { key: "model", label: "Model", type: "text" },
      { key: "class", label: "Class", type: "text", placeholder: "A / B / C" },
      { key: "length_ft", label: "Length (ft)", type: "number" },
      { key: "vin", label: "VIN", type: "text" },
    ],
  },
  auto: {
    label: "Auto",
    fields: [
      { key: "current_carrier", label: "Current carrier", type: "text" },
      { key: "num_vehicles", label: "# of vehicles", type: "number", placeholder: "1" },
      { key: "vehicle_summary", label: "Vehicles (year/make/model)", type: "text" },
    ],
  },
  home: {
    label: "Home",
    fields: [
      { key: "current_home_carrier", label: "Current carrier", type: "text" },
      { key: "year_built", label: "Year built", type: "number" },
      { key: "dwelling_value", label: "Dwelling value ($)", type: "number" },
      { key: "property_address", label: "Property address", type: "address" },
    ],
  },
};

export const LINE_TYPES = Object.keys(LINE_TYPE_META) as LineType[];

export type LeadLine = {
  line_id: string;
  type: LineType;
  details: Record<string, unknown>;
  dispo: string | null;
  quoted_premium: number | null;
  claimed_by: string | null;
  sold_at: string | null;
  agent_notes: string | null;
};

export const HOME_CARRIERS = [
  "Citizens",
  "State Farm",
  "Allstate",
  "USAA",
  "Progressive",
  "Universal",
  "Tower Hill",
  "Heritage",
  "American Integrity",
  "Federated National",
  "Florida Peninsula",
  "People's Trust",
  "Security First",
  "Farmers",
  "Nationwide",
  "Liberty Mutual",
  "Travelers",
  "Chubb",
  "The Hartford",
  "Other",
  "None",
] as const;

export const CONSTRUCTION_TYPES = [
  "Frame",
  "Masonry / CBS",
  "Brick",
  "Stucco",
  "Superior (concrete)",
  "Mixed",
  "Other",
] as const;

export const ROOF_TYPES = [
  "Asphalt Shingle",
  "Architectural Shingle",
  "Metal",
  "Tile",
  "Concrete Tile",
  "Clay Tile",
  "Flat / Built-up",
  "Wood Shake",
  "Slate",
  "Other",
] as const;

// Format raw digits as (xxx) xxx-xxxx
export function formatPhone(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function isValidUsPhone(input: string): boolean {
  const d = input.replace(/\D/g, "");
  return d.length === 10;
}