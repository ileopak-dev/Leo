export const sampleBundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    { resource: { resourceType: "Patient", id: "p1",
      name: [{ given: ["John"], family: "Doe" }],
      gender: "male",
      birthDate: "1958-01-01",
      identifier: [{ system: "urn:mrn", value: "MRN-102938" }]
    }},
    { resource: { resourceType: "Condition", id: "c1",
      clinicalStatus: { coding: [{ code: "active" }] },
      code: { text: "Hypertension" },
      onsetDateTime: "2022-03-01"
    }},
    { resource: { resourceType: "Condition", id: "c2",
      clinicalStatus: { coding: [{ code: "active" }] },
      code: { text: "Type 2 Diabetes" },
      onsetDateTime: "2019-06-10"
    }},
    { resource: { resourceType: "MedicationRequest", id: "m1",
      status: "active",
      authoredOn: "2026-02-05",
      medicationCodeableConcept: { text: "Lisinopril 10 mg daily" }
    }},
    { resource: { resourceType: "AllergyIntolerance", id: "a1",
      criticality: "high",
      code: { text: "Penicillin" }
    }},
    { resource: { resourceType: "Encounter", id: "e1",
      period: { start: "2026-02-01T09:10:00Z" },
      class: { code: "EMER" },
      type: [{ text: "Emergency Department" }]
    }},
    { resource: { resourceType: "Observation", id: "o_sys",
      category: [{ coding: [{ code: "vital-signs" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "8480-6", display: "BP Systolic" }] },
      effectiveDateTime: "2026-02-10T14:00:00Z",
      valueQuantity: { value: 162, unit: "mmHg" }
    }},
    { resource: { resourceType: "Observation", id: "o_dia",
      category: [{ coding: [{ code: "vital-signs" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "8462-4", display: "BP Diastolic" }] },
      effectiveDateTime: "2026-02-10T14:00:00Z",
      valueQuantity: { value: 96, unit: "mmHg" }
    }}
  ]
};
