import hl7Dictionary from "hl7-dictionary";

type ExternalField = {
  datatype?: string;
  desc?: string;
  opt?: number | string;
};

type ExternalSegment = {
  desc?: string;
  fields?: ExternalField[];
};

type ExternalDefinition = {
  segments?: Record<string, ExternalSegment>;
};

const DEFINITIONS = ((hl7Dictionary as { definitions?: Record<string, ExternalDefinition> })?.definitions ??
  {}) as Record<string, ExternalDefinition>;
const SUPPORTED_VERSIONS = Object.keys(DEFINITIONS);
const DEFAULT_VERSION = "2.5.1";

export function resolveAuthoritativeVersion(rawVersion: string): string {
  const v = rawVersion.trim();
  if (!v) return DEFAULT_VERSION;
  if (DEFINITIONS[v]) return v;

  const majorMinorMatch = v.match(/^(\d+\.\d+)/);
  const majorMinor = majorMinorMatch ? majorMinorMatch[1] : "";
  if (majorMinor) {
    const exactMajorMinor = SUPPORTED_VERSIONS.find((x) => x === majorMinor);
    if (exactMajorMinor) return exactMajorMinor;

    const closestPatch = SUPPORTED_VERSIONS.find((x) => x.startsWith(majorMinor + "."));
    if (closestPatch) return closestPatch;
  }

  const majorMatch = v.match(/^(\d+)/);
  const major = majorMatch ? majorMatch[1] : "";
  if (major) {
    const closestMajor = SUPPORTED_VERSIONS.find((x) => x.startsWith(major + "."));
    if (closestMajor) return closestMajor;
  }

  return DEFAULT_VERSION;
}

export function getAuthoritativeSegmentLabel(version: string, segment: string): string | null {
  const def = DEFINITIONS[version];
  const seg = def?.segments?.[segment];
  const label = seg?.desc?.trim();
  return label || null;
}

export function getAuthoritativeFieldDef(
  version: string,
  segment: string,
  fieldIndex: number
): { label: string; definition: string; datatype?: string } | null {
  const def = DEFINITIONS[version];
  const seg = def?.segments?.[segment];
  const field = seg?.fields?.[fieldIndex - 1];
  const label = field?.desc?.trim();
  if (!label) return null;
  return {
    label,
    definition: label,
    datatype: field?.datatype,
  };
}

export function getAuthoritativeRequiredFieldIndexes(version: string, segment: string): number[] {
  const def = DEFINITIONS[version];
  const seg = def?.segments?.[segment];
  if (!seg?.fields?.length) return [];

  const required: number[] = [];
  seg.fields.forEach((field, idx) => {
    const opt = field?.opt;
    if (opt === 2 || (typeof opt === "string" && opt.trim().toUpperCase() === "R")) {
      required.push(idx + 1);
    }
  });
  return required;
}
