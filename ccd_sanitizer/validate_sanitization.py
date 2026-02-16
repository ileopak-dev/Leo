#!/usr/bin/env python3
"""
Comprehensive CCD Sanitizer Validation Script
Validates that PHI was properly sanitized across 10 CCD files.
"""

import xml.etree.ElementTree as ET
import re
import os
import sys

ORIG_DIR = "/Users/leopak/Downloads/data/data/CCD"
ANON_DIR = "/Users/leopak/Downloads/data/data/output/CCD"

FILES = [
    "b6b7a6c2-f120-4bd2-a439-8b45ebafff5b.txt",
    "bd808fb0-97f2-4f79-9e32-4cf5b07e12c5.txt",
    "44164987-160b-49ca-9679-2419debc68e7.txt",
    "98758146-17d9-4b36-9ffe-fb49d8f01fbf.txt",
    "bca71562-ce42-4c5a-ae32-b8a574393f71.txt",
    "30c619d1-e9db-4cfe-a7a9-28e3a3cab0e7.txt",
    "e2ae20c7-8ab7-4e3e-8caf-d91730675345.txt",
    "aeeabbde-a976-4b7d-b1f8-73c47c5532e2.txt",
    "58256129-f8e6-4684-85e2-cbb88fef213e.txt",
    "3f1f1de3-baac-449f-8eda-3fbd05b79b72.txt",
]

NS = {"hl7": "urn:hl7-org:v3"}

results = []

def record(check, subcheck, status, detail=""):
    results.append((check, subcheck, status, detail))
    icon = "PASS" if status else "FAIL"
    print(f"  [{icon}] {subcheck}")
    if detail:
        for line in detail.strip().split("\n"):
            print(f"         {line}")

def parse_xml(path):
    """Parse CCD XML, handling namespace prefixes."""
    tree = ET.parse(path)
    root = tree.getroot()
    # Detect namespace
    ns_match = re.match(r'\{(.+?)\}', root.tag)
    ns = {"hl7": ns_match.group(1)} if ns_match else {}
    return root, ns

def extract_patient_phi(root, ns):
    """Extract patient PHI from a CCD XML tree."""
    phi = {}
    prefix = "hl7:" if ns else ""

    # Patient name
    for given in root.iter(f"{{{ns.get('hl7', '')}}}given" if ns else "given"):
        phi.setdefault("given_names", []).append(given.text)
    for family in root.iter(f"{{{ns.get('hl7', '')}}}family" if ns else "family"):
        phi.setdefault("family_names", []).append(family.text)

    # MRN - look for id under patientRole
    for pr in root.iter(f"{{{ns.get('hl7', '')}}}patientRole" if ns else "patientRole"):
        for id_elem in pr.findall(f"{{{ns.get('hl7', '')}}}id" if ns else "id"):
            ext = id_elem.get("extension")
            if ext and not ext.startswith("00000000"):
                phi.setdefault("mrns", []).append(ext)
                break
        break

    # DOB
    for bt in root.iter(f"{{{ns.get('hl7', '')}}}birthTime" if ns else "birthTime"):
        phi["dob"] = bt.get("value")
        break

    # Address
    for addr in root.iter(f"{{{ns.get('hl7', '')}}}streetAddressLine" if ns else "streetAddressLine"):
        phi["street"] = addr.text
        break
    for city in root.iter(f"{{{ns.get('hl7', '')}}}city" if ns else "city"):
        phi["city"] = city.text
        break
    for state in root.iter(f"{{{ns.get('hl7', '')}}}state" if ns else "state"):
        phi["state"] = state.text
        break
    for postal in root.iter(f"{{{ns.get('hl7', '')}}}postalCode" if ns else "postalCode"):
        phi["zip"] = postal.text
        break

    # Phone
    for tel in root.iter(f"{{{ns.get('hl7', '')}}}telecom" if ns else "telecom"):
        val = tel.get("value", "")
        if val.startswith("tel:"):
            phi["phone"] = val
            break

    return phi

def extract_provider_names(root, ns):
    """Extract provider/author/performer names."""
    names = set()
    tag_ns = ns.get('hl7', '')

    # Look for assignedPerson, assignedAuthor, etc.
    for person_tag in ["assignedPerson", "associatedPerson", "informationRecipient"]:
        for person in root.iter(f"{{{tag_ns}}}{person_tag}" if tag_ns else person_tag):
            for given in person.iter(f"{{{tag_ns}}}given" if tag_ns else "given"):
                if given.text:
                    names.add(given.text)
            for family in person.iter(f"{{{tag_ns}}}family" if tag_ns else "family"):
                if family.text:
                    names.add(family.text)
    return names

def extract_org_names(root, ns):
    """Extract organization names."""
    orgs = set()
    tag_ns = ns.get('hl7', '')
    for org in root.iter(f"{{{tag_ns}}}representedOrganization" if tag_ns else "representedOrganization"):
        for name in org.iter(f"{{{tag_ns}}}name" if tag_ns else "name"):
            if name.text:
                orgs.add(name.text)
    # Also check custodian org
    for org in root.iter(f"{{{tag_ns}}}representedCustodianOrganization" if tag_ns else "representedCustodianOrganization"):
        for name in org.iter(f"{{{tag_ns}}}name" if tag_ns else "name"):
            if name.text:
                orgs.add(name.text)
    return orgs


# ============================================================
# CHECK 1: Patient PHI Validation (3 files)
# ============================================================
print("=" * 70)
print("CHECK 1: PATIENT PHI VALIDATION")
print("=" * 70)

phi_files = FILES[:3]
for fname in phi_files:
    print(f"\n  File: {fname}")
    orig_path = os.path.join(ORIG_DIR, fname)
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")

    orig_root, orig_ns = parse_xml(orig_path)
    anon_root, anon_ns = parse_xml(anon_path)

    orig_phi = extract_patient_phi(orig_root, orig_ns)
    anon_phi = extract_patient_phi(anon_root, anon_ns)

    # Check each field
    for field in ["given_names", "family_names", "mrns", "dob", "street", "city", "phone"]:
        orig_val = orig_phi.get(field, "N/A")
        anon_val = anon_phi.get(field, "N/A")
        if orig_val == "N/A":
            continue
        changed = orig_val != anon_val
        detail = f"Original: {orig_val} -> Sanitized: {anon_val}"
        record("Patient PHI", f"{fname[:8]}... {field}", changed, detail)


# ============================================================
# CHECK 2: Provider PHI Validation (2 files)
# ============================================================
print("\n" + "=" * 70)
print("CHECK 2: PROVIDER PHI VALIDATION")
print("=" * 70)

provider_files = FILES[:2]
for fname in provider_files:
    print(f"\n  File: {fname}")
    orig_path = os.path.join(ORIG_DIR, fname)
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")

    orig_root, orig_ns = parse_xml(orig_path)
    anon_root, anon_ns = parse_xml(anon_path)

    orig_providers = extract_provider_names(orig_root, orig_ns)
    anon_providers = extract_provider_names(anon_root, anon_ns)

    if not orig_providers:
        print(f"    (No provider names found in original)")
        continue

    leaked = orig_providers & anon_providers
    changed = len(leaked) == 0
    detail = f"Original providers: {orig_providers}\nSanitized providers: {anon_providers}\nLeaked: {leaked if leaked else 'None'}"
    record("Provider PHI", f"{fname[:8]}... providers changed", changed, detail)


# ============================================================
# CHECK 3: Organization PHI Validation (2 files)
# ============================================================
print("\n" + "=" * 70)
print("CHECK 3: ORGANIZATION PHI VALIDATION")
print("=" * 70)

org_files = FILES[2:4]
for fname in org_files:
    print(f"\n  File: {fname}")
    orig_path = os.path.join(ORIG_DIR, fname)
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")

    orig_root, orig_ns = parse_xml(orig_path)
    anon_root, anon_ns = parse_xml(anon_path)

    orig_orgs = extract_org_names(orig_root, orig_ns)
    anon_orgs = extract_org_names(anon_root, anon_ns)

    if not orig_orgs:
        print(f"    (No org names found in original)")
        continue

    leaked = orig_orgs & anon_orgs
    changed = len(leaked) == 0
    detail = f"Original orgs: {orig_orgs}\nSanitized orgs: {anon_orgs}\nLeaked: {leaked if leaked else 'None'}"
    record("Org PHI", f"{fname[:8]}... orgs changed", changed, detail)


# ============================================================
# CHECK 4: Date Coarsening Validation (3 files)
# ============================================================
print("\n" + "=" * 70)
print("CHECK 4: DATE COARSENING VALIDATION")
print("=" * 70)

date_files = FILES[:3]
for fname in date_files:
    print(f"\n  File: {fname}")
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")
    with open(anon_path, "r") as f:
        content = f.read()

    # Find all value="..." attributes that look like dates
    # Full dates would be 8+ digits (YYYYMMDD or YYYYMMDDHHMMSS)
    full_dates = re.findall(r'value="(\d{8,14})"', content)
    # Year-only dates (4 digits exactly)
    year_dates = re.findall(r'value="(\d{4})"', content)
    # Also check for partial dates like YYYYMM (6 digits)
    partial_dates = re.findall(r'value="(\d{5,7})"', content)

    no_full_dates = len(full_dates) == 0 and len(partial_dates) == 0
    detail = f"Year-only dates found: {len(year_dates)}\nFull dates still present (FAIL if >0): {full_dates[:10]}\nPartial dates (FAIL if >0): {partial_dates[:10]}"
    record("Date Coarsening", f"{fname[:8]}... dates coarsened", no_full_dates, detail)


# ============================================================
# CHECK 5: XML Well-Formedness (all 10 files)
# ============================================================
print("\n" + "=" * 70)
print("CHECK 5: XML WELL-FORMEDNESS")
print("=" * 70)

for fname in FILES:
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")
    try:
        ET.parse(anon_path)
        record("XML Valid", f"{fname[:8]}... valid XML", True)
    except ET.ParseError as e:
        record("XML Valid", f"{fname[:8]}... valid XML", False, f"Parse error: {e}")


# ============================================================
# CHECK 6: PHI Leakage Check (3 files)
# ============================================================
print("\n" + "=" * 70)
print("CHECK 6: PHI LEAKAGE CHECK")
print("=" * 70)

leakage_files = FILES[:3]
for fname in leakage_files:
    print(f"\n  File: {fname}")
    orig_path = os.path.join(ORIG_DIR, fname)
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")

    orig_root, orig_ns = parse_xml(orig_path)
    orig_phi = extract_patient_phi(orig_root, orig_ns)

    with open(anon_path, "r") as f:
        anon_content = f.read()

    # Build list of PHI strings to check
    phi_strings = []
    for name in orig_phi.get("given_names", []):
        if name:
            phi_strings.append(name)
    for name in orig_phi.get("family_names", []):
        if name:
            phi_strings.append(name)
    for mrn in orig_phi.get("mrns", []):
        if mrn:
            phi_strings.append(mrn)
    if orig_phi.get("phone"):
        # Extract just the number
        phone_num = re.sub(r'[^0-9]', '', orig_phi["phone"])
        if len(phone_num) >= 7:
            phi_strings.append(phone_num[-10:])  # last 10 digits
    if orig_phi.get("street"):
        phi_strings.append(orig_phi["street"])

    leaked = []
    for phi_str in phi_strings:
        if phi_str and phi_str in anon_content:
            leaked.append(phi_str)

    no_leakage = len(leaked) == 0
    detail = f"Checked PHI strings: {phi_strings}\nLeaked into sanitized file: {leaked if leaked else 'None'}"
    record("PHI Leakage", f"{fname[:8]}... no PHI leakage", no_leakage, detail)


# ============================================================
# CHECK 7: MRN Format Check (all 10 files)
# ============================================================
print("\n" + "=" * 70)
print("CHECK 7: MRN FORMAT CHECK (TX-{{original}}-{{suffix}})")
print("=" * 70)

for fname in FILES:
    orig_path = os.path.join(ORIG_DIR, fname)
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")

    orig_root, orig_ns = parse_xml(orig_path)
    anon_root, anon_ns = parse_xml(anon_path)

    orig_phi = extract_patient_phi(orig_root, orig_ns)
    anon_phi = extract_patient_phi(anon_root, anon_ns)

    orig_mrns = orig_phi.get("mrns", [])
    anon_mrns = anon_phi.get("mrns", [])

    if not orig_mrns:
        record("MRN Format", f"{fname[:8]}... MRN format", True, "No MRN found in original")
        continue

    if not anon_mrns:
        record("MRN Format", f"{fname[:8]}... MRN format", False, f"Original MRN {orig_mrns} but no MRN in sanitized")
        continue

    orig_mrn = orig_mrns[0]
    anon_mrn = anon_mrns[0]

    # Check TX-{original}-{suffix} format
    pattern = rf'^TX-{re.escape(orig_mrn)}-[A-Za-z0-9]+$'
    matches = bool(re.match(pattern, anon_mrn))
    detail = f"Original MRN: {orig_mrn}\nSanitized MRN: {anon_mrn}\nExpected pattern: TX-{orig_mrn}-{{suffix}}"
    record("MRN Format", f"{fname[:8]}... MRN format", matches, detail)


# ============================================================
# SUMMARY
# ============================================================
print("\n" + "=" * 70)
print("VALIDATION SUMMARY")
print("=" * 70)

total = len(results)
passed = sum(1 for _, _, s, _ in results if s)
failed = sum(1 for _, _, s, _ in results if not s)

print(f"\n  Total checks: {total}")
print(f"  PASSED: {passed}")
print(f"  FAILED: {failed}")

if failed > 0:
    print("\n  FAILED CHECKS:")
    for check, subcheck, status, detail in results:
        if not status:
            print(f"    - [{check}] {subcheck}")
            if detail:
                for line in detail.strip().split("\n"):
                    print(f"      {line}")

print()
sys.exit(0 if failed == 0 else 1)
