#!/usr/bin/env python3
"""
Refined CCD Sanitizer Validation - focuses on precise patient-level PHI checks
and correctly categorizes findings.
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

pass_count = 0
fail_count = 0
warn_count = 0

def P(msg):
    global pass_count
    pass_count += 1
    print(f"  [PASS] {msg}")

def F(msg):
    global fail_count
    fail_count += 1
    print(f"  [FAIL] {msg}")

def W(msg):
    global warn_count
    warn_count += 1
    print(f"  [WARN] {msg}")

def get_ns(root):
    m = re.match(r'\{(.+?)\}', root.tag)
    return m.group(1) if m else ''

def tag(ns, name):
    return f"{{{ns}}}{name}" if ns else name

def get_patient_role(root, ns):
    """Get the first patientRole element (the actual patient)."""
    for pr in root.iter(tag(ns, "patientRole")):
        return pr
    return None

def get_patient_name(pr, ns):
    """Extract patient given + family from patientRole > patient > name."""
    patient = pr.find(tag(ns, "patient"))
    if patient is None:
        return None, None
    name_el = patient.find(tag(ns, "name"))
    if name_el is None:
        return None, None
    givens = [g.text for g in name_el.findall(tag(ns, "given")) if g.text]
    family = None
    fam_el = name_el.find(tag(ns, "family"))
    if fam_el is not None and fam_el.text:
        family = fam_el.text
    return givens, family

def get_patient_dob(pr, ns):
    patient = pr.find(tag(ns, "patient"))
    if patient is None:
        return None
    bt = patient.find(tag(ns, "birthTime"))
    if bt is not None:
        return bt.get("value")
    return None

def get_patient_mrn(pr, ns):
    for id_el in pr.findall(tag(ns, "id")):
        ext = id_el.get("extension")
        if ext and not ext.startswith("00000000"):
            return ext
    return None

def get_patient_addr(pr, ns):
    addr = pr.find(tag(ns, "addr"))
    if addr is None:
        return {}
    result = {}
    for field in ["streetAddressLine", "city", "state", "postalCode"]:
        el = addr.find(tag(ns, field))
        if el is not None and el.text:
            result[field] = el.text
    return result

def get_patient_phone(pr, ns):
    for tel in pr.findall(tag(ns, "telecom")):
        val = tel.get("value", "")
        if val.startswith("tel:"):
            return val
    return None

def get_author_names(root, ns):
    """Extract author/performer names (providers)."""
    names = set()
    for ap_tag in ["assignedPerson"]:
        for person in root.iter(tag(ns, ap_tag)):
            # Skip if this is inside recordTarget (the patient)
            name_el = person.find(tag(ns, "name"))
            if name_el is not None:
                parts = []
                for g in name_el.findall(tag(ns, "given")):
                    if g.text and len(g.text) > 1:
                        parts.append(g.text)
                f = name_el.find(tag(ns, "family"))
                if f is not None and f.text:
                    parts.append(f.text)
                if parts:
                    names.add(" ".join(parts))
    return names

def get_org_names(root, ns):
    orgs = set()
    for org_tag in ["representedOrganization", "representedCustodianOrganization",
                     "providerOrganization", "serviceProviderOrganization"]:
        for org in root.iter(tag(ns, org_tag)):
            name_el = org.find(tag(ns, "name"))
            if name_el is not None and name_el.text:
                orgs.add(name_el.text)
    return orgs


def load(path):
    tree = ET.parse(path)
    root = tree.getroot()
    ns = get_ns(root)
    return root, ns


# ============================================================
print("=" * 72)
print("CHECK 1: PATIENT PHI VALIDATION (3 files)")
print("=" * 72)
for fname in FILES[:3]:
    print(f"\n  --- {fname} ---")
    o_root, o_ns = load(os.path.join(ORIG_DIR, fname))
    a_root, a_ns = load(os.path.join(ANON_DIR, f"ANON_{fname}"))

    o_pr = get_patient_role(o_root, o_ns)
    a_pr = get_patient_role(a_root, a_ns)

    # Name
    o_given, o_family = get_patient_name(o_pr, o_ns)
    a_given, a_family = get_patient_name(a_pr, a_ns)
    print(f"    Patient Name:  {' '.join(o_given or [])} {o_family}  ->  {' '.join(a_given or [])} {a_family}")
    if o_family and a_family and o_family != a_family:
        P(f"Family name changed: {o_family} -> {a_family}")
    else:
        F(f"Family name NOT changed: {o_family} -> {a_family}")
    if o_given and a_given and o_given[0] != a_given[0]:
        P(f"Given name changed: {o_given[0]} -> {a_given[0]}")
    elif o_given and a_given:
        F(f"Given name NOT changed: {o_given[0]} -> {a_given[0]}")

    # MRN
    o_mrn = get_patient_mrn(o_pr, o_ns)
    a_mrn = get_patient_mrn(a_pr, a_ns)
    print(f"    MRN:           {o_mrn}  ->  {a_mrn}")
    if o_mrn != a_mrn:
        P(f"MRN changed: {o_mrn} -> {a_mrn}")
    else:
        F(f"MRN NOT changed")

    # DOB
    o_dob = get_patient_dob(o_pr, o_ns)
    a_dob = get_patient_dob(a_pr, a_ns)
    print(f"    DOB:           {o_dob}  ->  {a_dob}")
    if o_dob != a_dob:
        P(f"DOB changed: {o_dob} -> {a_dob}")
    else:
        F(f"DOB NOT changed")

    # Address
    o_addr = get_patient_addr(o_pr, o_ns)
    a_addr = get_patient_addr(a_pr, a_ns)
    print(f"    Address:       {o_addr}  ->  {a_addr}")
    if o_addr.get("streetAddressLine") != a_addr.get("streetAddressLine"):
        P(f"Street changed: {o_addr.get('streetAddressLine')} -> {a_addr.get('streetAddressLine')}")
    else:
        F(f"Street NOT changed")
    if o_addr.get("city") != a_addr.get("city"):
        P(f"City changed: {o_addr.get('city')} -> {a_addr.get('city')}")
    else:
        F(f"City NOT changed")

    # Phone
    o_phone = get_patient_phone(o_pr, o_ns)
    a_phone = get_patient_phone(a_pr, a_ns)
    print(f"    Phone:         {o_phone}  ->  {a_phone}")
    if o_phone != a_phone:
        P(f"Phone changed: {o_phone} -> {a_phone}")
    else:
        F(f"Phone NOT changed")


# ============================================================
print("\n" + "=" * 72)
print("CHECK 2: PROVIDER PHI VALIDATION (2 files)")
print("=" * 72)
for fname in FILES[3:5]:
    print(f"\n  --- {fname} ---")
    o_root, o_ns = load(os.path.join(ORIG_DIR, fname))
    a_root, a_ns = load(os.path.join(ANON_DIR, f"ANON_{fname}"))

    o_provs = get_author_names(o_root, o_ns)
    a_provs = get_author_names(a_root, a_ns)

    print(f"    Original providers ({len(o_provs)}): {sorted(o_provs)[:10]}...")
    print(f"    Sanitized providers ({len(a_provs)}): {sorted(a_provs)[:10]}...")

    leaked = o_provs & a_provs
    not_leaked = o_provs - a_provs
    if len(not_leaked) > 0:
        print(f"    Changed ({len(not_leaked)}): {sorted(not_leaked)[:5]}...")
    if leaked:
        # Filter out generic names like "Provider", "Director", "Historical"
        real_leaked = {n for n in leaked if n.lower() not in ("provider", "director", "historical", "him", "peer")}
        if real_leaked:
            F(f"Provider names leaked ({len(real_leaked)}): {sorted(real_leaked)[:8]}")
        else:
            P(f"Provider names changed (only generic labels remain: {leaked})")
    else:
        P(f"All provider names changed")


# ============================================================
print("\n" + "=" * 72)
print("CHECK 3: ORGANIZATION PHI VALIDATION (2 files)")
print("=" * 72)
for fname in [FILES[0], FILES[5]]:
    print(f"\n  --- {fname} ---")
    o_root, o_ns = load(os.path.join(ORIG_DIR, fname))
    a_root, a_ns = load(os.path.join(ANON_DIR, f"ANON_{fname}"))

    o_orgs = get_org_names(o_root, o_ns)
    a_orgs = get_org_names(a_root, a_ns)

    print(f"    Original orgs: {o_orgs}")
    print(f"    Sanitized orgs: {a_orgs}")

    leaked = o_orgs & a_orgs
    if leaked:
        F(f"Organization names leaked: {leaked}")
    else:
        P(f"All org names changed")


# ============================================================
print("\n" + "=" * 72)
print("CHECK 4: DATE COARSENING VALIDATION (3 files)")
print("=" * 72)
for fname in FILES[:3]:
    print(f"\n  --- {fname} ---")
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")
    with open(anon_path, "r") as f:
        content = f.read()

    # Full dates: 8+ digit values
    full_dates = re.findall(r'value="(\d{8,14})"', content)
    year_dates = re.findall(r'value="(\d{4})"', content)

    print(f"    Year-only dates: {len(year_dates)}")
    print(f"    Full dates remaining: {len(full_dates)}")
    if full_dates:
        # Show unique ones
        unique_full = sorted(set(full_dates))
        print(f"    Residual full dates: {unique_full}")
        F(f"Date coarsening incomplete - {len(unique_full)} unique full dates remain: {unique_full}")
    else:
        P(f"All dates coarsened to year-only")

    # Also check original for comparison
    orig_path = os.path.join(ORIG_DIR, fname)
    with open(orig_path, "r") as f:
        orig_content = f.read()
    orig_full = set(re.findall(r'value="(\d{8,14})"', orig_content))
    print(f"    (Original had {len(orig_full)} unique full-precision date values)")


# ============================================================
print("\n" + "=" * 72)
print("CHECK 5: XML WELL-FORMEDNESS (all 10 files)")
print("=" * 72)
for fname in FILES:
    anon_path = os.path.join(ANON_DIR, f"ANON_{fname}")
    try:
        ET.parse(anon_path)
        P(f"{fname[:12]}... valid XML")
    except ET.ParseError as e:
        F(f"{fname[:12]}... INVALID XML: {e}")


# ============================================================
print("\n" + "=" * 72)
print("CHECK 6: PHI LEAKAGE CHECK (3 files) - Patient-specific PHI only")
print("=" * 72)
for fname in FILES[:3]:
    print(f"\n  --- {fname} ---")
    o_root, o_ns = load(os.path.join(ORIG_DIR, fname))
    a_root, a_ns = load(os.path.join(ANON_DIR, f"ANON_{fname}"))

    o_pr = get_patient_role(o_root, o_ns)
    o_given, o_family = get_patient_name(o_pr, o_ns)
    o_mrn = get_patient_mrn(o_pr, o_ns)
    o_addr = get_patient_addr(o_pr, o_ns)
    o_phone = get_patient_phone(o_pr, o_ns)
    o_dob = get_patient_dob(o_pr, o_ns)

    with open(os.path.join(ANON_DIR, f"ANON_{fname}"), "r") as f:
        anon_text = f.read()

    leaked = []

    # Check patient family name (most identifying)
    if o_family and o_family in anon_text:
        leaked.append(f"Family name '{o_family}'")

    # Check patient first given name (skip middle initials)
    if o_given and len(o_given) > 0 and len(o_given[0]) > 1:
        if o_given[0] in anon_text:
            leaked.append(f"Given name '{o_given[0]}'")

    # Check MRN (the raw number, not within TX- prefix)
    if o_mrn:
        # Check if MRN appears outside of the TX- format
        # Remove all TX-{mrn}-... occurrences and see if raw MRN still there
        scrubbed = re.sub(r'TX-' + re.escape(o_mrn) + r'-\w+', '', anon_text)
        if o_mrn in scrubbed:
            leaked.append(f"Raw MRN '{o_mrn}'")

    # Check street address
    if o_addr.get("streetAddressLine"):
        if o_addr["streetAddressLine"] in anon_text:
            leaked.append(f"Street '{o_addr['streetAddressLine']}'")

    # Check phone digits
    if o_phone:
        digits = re.sub(r'[^0-9]', '', o_phone)
        if len(digits) >= 7 and digits[-10:] in anon_text:
            leaked.append(f"Phone '{digits[-10:]}'")

    # Check full DOB
    if o_dob and len(o_dob) >= 8 and o_dob in anon_text:
        leaked.append(f"Full DOB '{o_dob}'")

    if leaked:
        F(f"PHI leaked: {', '.join(leaked)}")
    else:
        P(f"No patient PHI leakage detected")
    print(f"    Checked: family={o_family}, given={o_given[0] if o_given else 'N/A'}, "
          f"MRN={o_mrn}, street={o_addr.get('streetAddressLine','N/A')}, phone={o_phone}")


# ============================================================
print("\n" + "=" * 72)
print("CHECK 7: MRN FORMAT CHECK - TX-{original}-{suffix} (all 10 files)")
print("=" * 72)
for fname in FILES:
    o_root, o_ns = load(os.path.join(ORIG_DIR, fname))
    a_root, a_ns = load(os.path.join(ANON_DIR, f"ANON_{fname}"))

    o_pr = get_patient_role(o_root, o_ns)
    a_pr = get_patient_role(a_root, a_ns)

    o_mrn = get_patient_mrn(o_pr, o_ns)
    a_mrn = get_patient_mrn(a_pr, a_ns)

    if not o_mrn:
        W(f"{fname[:12]}... no MRN in original")
        continue

    pattern = rf'^TX-{re.escape(o_mrn)}-[A-Za-z0-9]+$'
    if a_mrn and re.match(pattern, a_mrn):
        P(f"{fname[:12]}... {o_mrn} -> {a_mrn}")
    else:
        F(f"{fname[:12]}... Expected TX-{o_mrn}-{{suffix}}, got: {a_mrn}")


# ============================================================
print("\n" + "=" * 72)
print("SUMMARY")
print("=" * 72)
print(f"  PASSED:   {pass_count}")
print(f"  FAILED:   {fail_count}")
print(f"  WARNINGS: {warn_count}")
print(f"  TOTAL:    {pass_count + fail_count + warn_count}")
if fail_count == 0:
    print("\n  ** ALL CHECKS PASSED **")
else:
    print(f"\n  ** {fail_count} CHECK(S) FAILED - SEE DETAILS ABOVE **")
print()
