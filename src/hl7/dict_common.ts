export type Hl7FieldDef = {
  label: string;
  definition: string;
  datatype?: string;
};

export type Hl7SegmentDef = {
  segmentLabel: string;
  fields: Record<number, Hl7FieldDef>;
};

export const COMMON_DICT: Record<string, Hl7SegmentDef> = {
  MSH: {
    segmentLabel: "Message Header",
    fields: {
      1: { label: "Field Separator", definition: "Delimiter used to separate fields.", datatype: "ST" },
      2: { label: "Encoding Characters", definition: "Component/repetition/escape/subcomponent separators.", datatype: "ST" },
      3: { label: "Sending Application", definition: "Application that sent the message.", datatype: "HD" },
      4: { label: "Sending Facility", definition: "Facility that sent the message.", datatype: "HD" },
      5: { label: "Receiving Application", definition: "Intended receiving application.", datatype: "HD" },
      6: { label: "Receiving Facility", definition: "Intended receiving facility.", datatype: "HD" },
      7: { label: "Date/Time of Message", definition: "Timestamp message was created.", datatype: "TS" },
      9: { label: "Message Type", definition: "Message code^trigger^structure (e.g., ORU^R01).", datatype: "MSG" },
      10: { label: "Message Control ID", definition: "Unique identifier for this message instance.", datatype: "ST" },
      11: { label: "Processing ID", definition: "P=Production, T=Test, D=Debug.", datatype: "PT" },
      12: { label: "Version ID", definition: "HL7 v2 version used.", datatype: "VID" },
    },
  },

  PID: {
    segmentLabel: "Patient Identification",
    fields: {
      1: { label: "Set ID - PID", definition: "Sequence number for PID segments.", datatype: "SI" },
      3: { label: "Patient Identifier List", definition: "Identifiers (MRN, etc.) with assigning authority/type.", datatype: "CX" },
      5: { label: "Patient Name", definition: "Name (family^given^middle^suffix…).", datatype: "XPN" },
      7: { label: "Date/Time of Birth", definition: "Patient birth date/time.", datatype: "TS" },
      8: { label: "Administrative Sex", definition: "Patient sex.", datatype: "IS" },
      10: { label: "Race", definition: "Patient race.", datatype: "CE" },
      11: { label: "Patient Address", definition: "Address.", datatype: "XAD" },
      13: { label: "Phone Number - Home", definition: "Home/primary phone.", datatype: "XTN" },
      15: { label: "Primary Language", definition: "Patient primary language.", datatype: "CE" },
      16: { label: "Marital Status", definition: "Marital status.", datatype: "CE" },
    },
  },

  PV1: {
    segmentLabel: "Patient Visit",
    fields: {
      1: { label: "Set ID - PV1", definition: "Sequence number for PV1 segments.", datatype: "SI" },
      2: { label: "Patient Class", definition: "I/O/E/etc.", datatype: "IS" },
      3: { label: "Assigned Patient Location", definition: "Point of care^room^bed^facility…", datatype: "PL" },
      7: { label: "Attending Doctor", definition: "Attending provider.", datatype: "XCN" },
      19: { label: "Visit Number", definition: "Encounter/visit identifier.", datatype: "CX" },
      44: { label: "Admit Date/Time", definition: "Admit date/time.", datatype: "TS" },
      45: { label: "Discharge Date/Time", definition: "Discharge date/time.", datatype: "TS" },
    },
  },

  NK1: {
    segmentLabel: "Next of Kin",
    fields: {
      1: { label: "Set ID - NK1", definition: "Sequence number.", datatype: "SI" },
      2: { label: "Name", definition: "Next of kin name.", datatype: "XPN" },
      3: { label: "Relationship", definition: "Relationship to patient.", datatype: "CE" },
      5: { label: "Phone Number", definition: "Phone number.", datatype: "XTN" },
    },
  },

  ORC: {
    segmentLabel: "Common Order",
    fields: {
      1: { label: "Order Control", definition: "Order action code (e.g., NW, RE, CA).", datatype: "ID" },
      2: { label: "Placer Order Number", definition: "Placer-assigned order id.", datatype: "EI" },
      3: { label: "Filler Order Number", definition: "Filler-assigned order id.", datatype: "EI" },
      9: { label: "Date/Time of Transaction", definition: "Transaction timestamp.", datatype: "TS" },
      12: { label: "Ordering Provider", definition: "Provider who ordered.", datatype: "XCN" },
    },
  },

  OBR: {
    segmentLabel: "Observation Request",
    fields: {
      1: { label: "Set ID - OBR", definition: "Sequence number.", datatype: "SI" },
      4: { label: "Universal Service ID", definition: "Service/test requested.", datatype: "CE" },
      7: { label: "Observation Date/Time", definition: "Relevant observation time.", datatype: "TS" },
      16: { label: "Ordering Provider", definition: "Provider who ordered.", datatype: "XCN" },
      22: { label: "Results Rpt/Status Chng Date/Time", definition: "Results reported time.", datatype: "TS" },
      25: { label: "Result Status", definition: "Status (F, P, C, etc.).", datatype: "ID" },
    },
  },

  OBX: {
    segmentLabel: "Observation Result",
    fields: {
      1: { label: "Set ID - OBX", definition: "Sequence number.", datatype: "SI" },
      2: { label: "Value Type", definition: "Datatype of OBX-5 (e.g., NM, ST, CE, ED).", datatype: "ID" },
      3: { label: "Observation Identifier", definition: "What is being measured/observed.", datatype: "CE" },
      5: { label: "Observation Value", definition: "The result value.", datatype: "varies" },
      6: { label: "Units", definition: "Units for numeric values.", datatype: "CE" },
      7: { label: "Reference Range", definition: "Reference range.", datatype: "ST" },
      8: { label: "Abnormal Flags", definition: "Abnormal flag(s).", datatype: "IS" },
      11: { label: "Observation Result Status", definition: "Result status.", datatype: "ID" },
      14: { label: "Date/Time of the Observation", definition: "Observation timestamp.", datatype: "TS" },
    },
  },

  NTE: {
    segmentLabel: "Notes and Comments",
    fields: {
      1: { label: "Set ID - NTE", definition: "Sequence number.", datatype: "SI" },
      3: { label: "Comment", definition: "Free-text note/comment.", datatype: "FT" },
    },
  },

  TXA: {
    segmentLabel: "Document Notification",
    fields: {
      2: { label: "Document Type", definition: "Type of document.", datatype: "IS" },
      12: { label: "Activity Date/Time", definition: "Document activity timestamp.", datatype: "TS" },
      13: { label: "Primary Activity Provider Code/Name", definition: "Provider associated with document activity.", datatype: "XCN" },
    },
  },

  RXA: {
    segmentLabel: "Pharmacy/Treatment Administration",
    fields: {
      3: { label: "Date/Time Start of Administration", definition: "Administration start time.", datatype: "TS" },
      5: { label: "Administered Code", definition: "Drug/vaccine administered.", datatype: "CE" },
      6: { label: "Administered Amount", definition: "Amount administered.", datatype: "NM" },
      7: { label: "Administered Units", definition: "Units for amount.", datatype: "CE" },
      9: { label: "Administration Notes", definition: "Notes/remarks.", datatype: "CE" },
    },
  },

  RXR: {
    segmentLabel: "Pharmacy/Treatment Route",
    fields: {
      1: { label: "Route", definition: "Route of administration.", datatype: "CE" },
      2: { label: "Administration Site", definition: "Body site.", datatype: "CE" },
    },
  },

  RXE: {
    segmentLabel: "Pharmacy/Treatment Encoded Order",
    fields: {
      2: { label: "Give Code", definition: "Drug ordered.", datatype: "CE" },
      3: { label: "Give Amount - Minimum", definition: "Dose amount.", datatype: "NM" },
      5: { label: "Give Units", definition: "Dose units.", datatype: "CE" },
      21: { label: "Pharmacy/Treatment Supplier's Verbatim", definition: "Free-text drug description.", datatype: "ST" },
    },
  },

  TQ1: {
    segmentLabel: "Timing/Quantity",
    fields: {
      7: { label: "Start Date/Time", definition: "When timing starts.", datatype: "TS" },
      8: { label: "End Date/Time", definition: "When timing ends.", datatype: "TS" },
      9: { label: "Priority", definition: "Priority.", datatype: "CE" },
    },
  },

  PR1: {
    segmentLabel: "Procedures",
    fields: {
      1: { label: "Set ID - PR1", definition: "Sequence number.", datatype: "SI" },
      3: { label: "Procedure Code", definition: "Procedure identifier.", datatype: "CE" },
      5: { label: "Procedure Date/Time", definition: "When the procedure occurred.", datatype: "TS" },
      11: { label: "Surgeon", definition: "Surgeon/provider.", datatype: "XCN" },
    },
  },
};
