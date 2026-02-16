export type Hl7Separators = {
  field: string; component: string; repetition: string; escape: string; subcomponent: string;
};

export type Hl7Field = {
  fieldIndex: number; // 1-based HL7 field index (MSH is special)
  raw: string;
  reps: string[];
};

export type Hl7Segment = {
  name: string;
  index: number;
  raw: string;
  fields: Hl7Field[];
};

export type Hl7Message = {
  raw: string;
  separators: Hl7Separators;
  segments: Hl7Segment[];
  errors: string[];
};

function normalizeNewlines(raw: string): string {
  return raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
}

function getSeparatorsFromMSH(mshLine: string): Hl7Separators {
  const fieldSep = mshLine[3] ?? "|";
  const enc = mshLine.slice(4, 8);
  const component = enc[0] ?? "^";
  const repetition = enc[1] ?? "~";
  const escape = enc[2] ?? "\\";
  const subcomponent = enc[3] ?? "&";
  return { field: fieldSep, component, repetition, escape, subcomponent };
}

export function parseHl7(rawInput: string): Hl7Message {
  const errors: string[] = [];
  const raw = normalizeNewlines(rawInput).trimEnd();
  if (!raw.trim()) return { raw: "", separators: { field: "|", component: "^", repetition: "~", escape: "\\", subcomponent: "&" }, segments: [], errors };

  const lines = raw.split("\r").filter(Boolean);

  const mshLine = lines.find(l => l.startsWith("MSH"));
  if (!mshLine) errors.push("Missing MSH segment (required). Using default separators.");

  const separators = mshLine ? getSeparatorsFromMSH(mshLine) : { field: "|", component: "^", repetition: "~", escape: "\\", subcomponent: "&" };

  const segments: Hl7Segment[] = lines.map((line, idx) => {
    const name = line.slice(0, 3);
    const parts = line.split(separators.field);

    const fields: Hl7Field[] = [];
    if (name === "MSH") {
      // Represent MSH-1 (field separator) explicitly.
      fields.push({ fieldIndex: 1, raw: separators.field, reps: [separators.field] });
      for (let i = 1; i < parts.length; i++) {
        const fieldIndex = i + 1; // because MSH-1 inserted
        const rawField = parts[i] ?? "";
        fields.push({ fieldIndex, raw: rawField, reps: rawField.split(separators.repetition) });
      }
    } else {
      for (let i = 1; i < parts.length; i++) {
        const fieldIndex = i; // non-MSH fields are direct
        const rawField = parts[i] ?? "";
        fields.push({ fieldIndex, raw: rawField, reps: rawField.split(separators.repetition) });
      }
    }

    return { name, index: idx, raw: line, fields };
  });

  return { raw, separators, segments, errors };
}
