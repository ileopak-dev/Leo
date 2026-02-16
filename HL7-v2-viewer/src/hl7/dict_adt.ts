export type Hl7FieldDef = {
  label: string;
  definition: string;
  datatype?: string;
  example?: string;
};

export type Hl7SegmentDef = {
  segmentLabel: string;
  fields: Record<number, Hl7FieldDef>;
};

export const ADT_DICT: Record<string, Hl7SegmentDef> = {
  MSH: {
    segmentLabel: "Message Header",
    fields: {
      1: { label: "Field Separator", definition: "The delimiter used to separate fields in the message.", datatype: "ST", example: "|" },
      2: { label: "Encoding Characters", definition: "Four characters that define component/repetition/escape/subcomponent separators.", datatype: "ST", example: "^~\\&" },
      3: { label: "Sending Application", definition: "Application that sent the message.", datatype: "HD" },
      4: { label: "Sending Facility", definition: "Facility that sent the message.", datatype: "HD" },
      5: { label: "Receiving Application", definition: "Application intended to receive the message.", datatype: "HD" },
      6: { label: "Receiving Facility", definition: "Facility intended to receive the message.", datatype: "HD" },
      7: { label: "Date/Time of Message", definition: "Timestamp when the message was created.", datatype: "TS" },
      9: { label: "Message Type", definition: "Message code, trigger event, and structure (e.g., ADT^A04).", datatype: "MSG" },
      10:{ label: "Message Control ID", definition: "Unique identifier for this message instance.", datatype: "ST" },
      11:{ label: "Processing ID", definition: "Processing mode (P=Production, T=Test, D=Debug).", datatype: "PT" },
      12:{ label: "Version ID", definition: "HL7 v2 version used (e.g., 2.3.1, 2.5.1).", datatype: "VID" },
    }
  },

  EVN: {
    segmentLabel: "Event Type",
    fields: {
      1: { label: "Event Type Code", definition: "Trigger event code (e.g., A04).", datatype: "ID" },
      2: { label: "Recorded Date/Time", definition: "When the event was recorded.", datatype: "TS" },
      5: { label: "Operator ID", definition: "Person/system that recorded the event.", datatype: "XCN" },
    }
  },

  PID: {
    segmentLabel: "Patient Identification",
    fields: {
      1: { label: "Set ID - PID", definition: "Sequence number for PID segments.", datatype: "SI" },
      3: { label: "Patient Identifier List", definition: "List of identifiers (MRN, etc.) with assigning authority and identifier type.", datatype: "CX" },
      5: { label: "Patient Name", definition: "Patient legal name (family^given^middle^suffix…)", datatype: "XPN" },
      7: { label: "Date/Time of Birth", definition: "Patient birth date/time.", datatype: "TS" },
      8: { label: "Administrative Sex", definition: "Patient sex (F/M/U/etc.).", datatype: "IS" },
      10:{ label: "Race", definition: "Patient race (often coded).", datatype: "CE" },
      11:{ label: "Patient Address", definition: "Street/city/state/zip/country.", datatype: "XAD" },
      13:{ label: "Phone Number - Home", definition: "Primary phone number.", datatype: "XTN" },
      15:{ label: "Primary Language", definition: "Patient primary language.", datatype: "CE" },
      16:{ label: "Marital Status", definition: "Patient marital status.", datatype: "CE" },
    }
  },

  PV1: {
    segmentLabel: "Patient Visit",
    fields: {
      1: { label: "Set ID - PV1", definition: "Sequence number for PV1 segments.", datatype: "SI" },
      2: { label: "Patient Class", definition: "Encounter class (I=Inpatient, O=Outpatient, E=Emergency, etc.).", datatype: "IS" },
      3: { label: "Assigned Patient Location", definition: "Point of care^room^bed^facility…", datatype: "PL" },
      7: { label: "Attending Doctor", definition: "Attending provider.", datatype: "XCN" },
      19:{ label: "Visit Number", definition: "Encounter/visit identifier.", datatype: "CX" },
      44:{ label: "Admit Date/Time", definition: "When the patient was admitted.", datatype: "TS" },
      45:{ label: "Discharge Date/Time", definition: "When the patient was discharged.", datatype: "TS" },
    }
  },

  IN1: {
    segmentLabel: "Insurance",
    fields: {
      1: { label: "Set ID - IN1", definition: "Sequence number for IN1 segments.", datatype: "SI" },
      2: { label: "Insurance Plan ID", definition: "Plan identifier.", datatype: "CE" },
      3: { label: "Insurance Company ID", definition: "Payer identifier.", datatype: "CX" },
      4: { label: "Insurance Company Name", definition: "Payer/company name.", datatype: "XON" },
      16:{ label: "Name of Insured", definition: "Subscriber name.", datatype: "XPN" },
      17:{ label: "Insured's Relationship to Patient", definition: "Relationship of subscriber to patient.", datatype: "CE" },
      18:{ label: "Insured's Date of Birth", definition: "Subscriber DOB.", datatype: "TS" },
      36:{ label: "Policy Number", definition: "Subscriber/policy number.", datatype: "ST" },
    }
  },
};
