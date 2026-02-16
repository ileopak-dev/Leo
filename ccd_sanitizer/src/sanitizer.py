"""
CCD/CDA PHI Sanitizer
Sanitizes HL7 v3 CDA/CCD XML documents to remove PHI
"""
import logging
import os
import re
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Set

from .ccd_parser import CCDParser
from .phi_generator import PHIGenerator
from .database import PHIDatabase

logger = logging.getLogger(__name__)


class CCDSanitizer:
    """Main CCD sanitization engine"""

    def __init__(self, db_path: str):
        self.db = PHIDatabase(db_path)
        self.phi_gen = PHIGenerator()
        self.ns = {'hl7': 'urn:hl7-org:v3'}
        # Cache original org name -> fake org for narrative consistency within run.
        self._org_name_cache = {}

    def sanitize_file(self, input_path: str, output_path: str) -> Dict[str, Any]:
        """
        Sanitize a CCD file

        Args:
            input_path: Path to input CCD XML file
            output_path: Path to save sanitized file

        Returns:
            Dict with processing results
        """
        logger.info(f"Sanitizing CCD file: {os.path.basename(input_path)}")

        # Read input file
        with open(input_path, 'r', encoding='utf-8', errors='ignore') as f:
            xml_content = f.read()

        # Parse CCD
        try:
            parser = CCDParser(xml_content)
        except Exception as e:
            logger.error(f"Failed to parse CCD: {e}")
            raise

        # Extract PHI
        phi_data = parser.extract_phi()

        # Track PHI replacements
        phi_count = 0

        # Collect original patient/provider names for free-text scrubbing
        original_names = set()
        original_names.update(self._collect_all_person_names(parser))
        original_org_names = self._collect_all_org_names(parser)

        # Resolve a primary organization key for stable MRN-per-org mapping.
        primary_org_name = ""
        primary_org_identity = ""
        ns_uri = 'urn:hl7-org:v3'
        primary_org_elem = parser.root.find(f'.//{{{ns_uri}}}representedOrganization')
        if primary_org_elem is not None:
            primary_name_elem = primary_org_elem.find(f'{{{ns_uri}}}name')
            primary_id_elem = primary_org_elem.find(f'{{{ns_uri}}}id')
            if primary_name_elem is not None and primary_name_elem.text and primary_name_elem.text.strip():
                primary_org_name = primary_name_elem.text.strip()
            elif primary_id_elem is not None:
                primary_org_name = (
                    primary_id_elem.get('extension')
                    or primary_id_elem.get('root')
                    or ""
                )
            primary_org_identity = self._build_org_identity(primary_id_elem)

        if not primary_org_name:
            for org in phi_data['organizations']:
                if org.name or org.id:
                    primary_org_name = org.name or org.id
                    primary_org_identity = org.id or org.name or ""
                    break
        if not primary_org_name:
            primary_org_name = "UNKNOWN_ORG"
            primary_org_identity = "UNKNOWN_ORG"

        primary_org = self._get_or_create_fake_org(primary_org_name, primary_org_identity)
        primary_org_prefix = primary_org.get('facility_id', '')
        primary_org_db_id = self.db.get_organization_id_by_hash(
            primary_org_name, primary_org_identity
        )

        # Sanitize patient data (recordTarget only - specific mapping)
        if phi_data['patients']:
            patient = phi_data['patients'][0]
            # Collect original names before sanitizing
            if patient.first_name:
                original_names.add(patient.first_name)
            if patient.last_name:
                original_names.add(patient.last_name)
            if patient.middle_name:
                original_names.add(patient.middle_name)
            patient_result = self._sanitize_patient(
                parser, patient, primary_org_db_id, primary_org_prefix
            )
            phi_count += patient_result['count']
            fake_patient = patient_result['fake_patient']
            narrative_patient_map = patient_result['narrative_map']
            mrn_pair = patient_result['mrn_pair']
        else:
            fake_patient = None
            narrative_patient_map = {}
            mrn_pair = None

        # Collect original guardian names
        for guardian in phi_data['guardians']:
            if guardian.get('first_name'):
                original_names.add(guardian['first_name'])
            if guardian.get('last_name'):
                original_names.add(guardian['last_name'])

        # Collect original provider names
        for provider in phi_data['providers']:
            if provider.first_name:
                original_names.add(provider.first_name)
            if provider.last_name:
                original_names.add(provider.last_name)

        # Collect original org names extracted by parser
        for org in phi_data['organizations']:
            if org.name:
                original_org_names.add(org.name)

        # Sanitize ALL person names globally (not just recordTarget)
        phi_count += self._sanitize_all_person_names(parser, phi_data)

        # Sanitize ALL addresses globally
        phi_count += self._sanitize_all_addresses(parser)

        # Sanitize ALL telecom globally
        phi_count += self._sanitize_all_telecom(parser)

        # Sanitize ALL organizations globally (all org-like elements)
        phi_count += self._sanitize_all_organizations(parser)

        # Sanitize dates (coarsen to year only) - including <value xsi:type="TS">
        phi_count += self._sanitize_dates(parser)

        # Sanitize free-text narrative blocks
        if original_names or original_org_names:
            phi_count += self._sanitize_narrative_text(
                parser,
                original_names,
                original_org_names,
                fake_patient,
                narrative_patient_map,
                mrn_pair
            )

        # Write sanitized output
        sanitized_xml = parser.to_string()

        # Add XML declaration
        if not sanitized_xml.startswith('<?xml'):
            sanitized_xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + sanitized_xml

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(sanitized_xml)

        logger.info(f"✓ Sanitized {phi_count} PHI elements")

        return {
            'message_type': parser.document_type or 'CCD',
            'phi_count': phi_count,
            'status': 'success'
        }

    def _sanitize_patient(self, parser: CCDParser, patient_data,
                          primary_org_db_id: int, primary_org_prefix: str) -> Dict[str, Any]:
        """Sanitize patient information in recordTarget"""
        count = 0

        # Get or create fake patient data in database
        original_name = f"{patient_data.last_name}^{patient_data.first_name}"
        name_hash = self.db.hash_value(f"{original_name}|{patient_data.dob}")

        # Check if patient exists
        existing = self.db.get_patient_by_hash(name_hash)

        if existing:
            fake_patient = existing
            patient_id = self.db.get_or_create_patient(
                original_name, patient_data.dob, fake_patient
            )
        else:
            # Generate new fake patient
            fake_patient = self.phi_gen.generate_patient(patient_data.dob)
            # Create in database
            patient_id = self.db.get_or_create_patient(
                original_name, patient_data.dob, fake_patient
            )

        # Generate address
        if 'address' not in fake_patient:
            fake_patient['address'] = self.phi_gen.generate_address()

        # Replace patient ID (MRN)
        fake_mrn = ""
        id_elems = parser.root.findall('.//hl7:recordTarget//hl7:id', self.ns)
        for elem in id_elems:
            if elem.get('extension'):
                original_mrn = elem.get('extension')
                generated_mrn = self.phi_gen.generate_mrn(
                    original_mrn, org_prefix=primary_org_prefix
                )
                mapped_mrn = generated_mrn
                if patient_id and primary_org_db_id:
                    mapped_mrn = self.db.get_or_create_mrn(
                        patient_id, primary_org_db_id, original_mrn, generated_mrn
                    )
                elem.set('extension', mapped_mrn)
                if not fake_mrn:
                    fake_mrn = mapped_mrn
                count += 1
                logger.debug(f"Replaced patient MRN: {original_mrn} -> {mapped_mrn}")

        # Replace patient name
        name_elems = parser.root.findall('.//hl7:recordTarget//hl7:patient/hl7:name', self.ns)
        for name_elem in name_elems:
            given_elem = name_elem.find('hl7:given', self.ns)
            family_elem = name_elem.find('hl7:family', self.ns)

            if given_elem is not None:
                given_elem.text = fake_patient['first_name']
                count += 1

            if family_elem is not None:
                family_elem.text = fake_patient['last_name']
                count += 1

            logger.debug(f"Replaced patient name with: {fake_patient['first_name']} {fake_patient['last_name']}")

        # Replace patient address
        addr_elems = parser.root.findall('.//hl7:recordTarget//hl7:addr', self.ns)
        for addr_elem in addr_elems:
            count += self._replace_address_fields(addr_elem, fake_patient['address'])

        # Replace phone/email
        telecom_elems = parser.root.findall('.//hl7:recordTarget//hl7:telecom', self.ns)
        for telecom in telecom_elems:
            count += self._replace_telecom(telecom, fake_patient['first_name'], fake_patient['last_name'])

        # Build targeted replacements for narrative free text.
        # These come from the original patient plus the just-generated fake values.
        narrative_map = {}
        if patient_data.first_name and fake_patient.get('first_name'):
            narrative_map[patient_data.first_name] = fake_patient['first_name']
        if patient_data.last_name and fake_patient.get('last_name'):
            narrative_map[patient_data.last_name] = fake_patient['last_name']
        if patient_data.first_name and patient_data.last_name and fake_patient.get('first_name') and fake_patient.get('last_name'):
            original_space = f"{patient_data.first_name} {patient_data.last_name}"
            fake_space = f"{fake_patient['first_name']} {fake_patient['last_name']}"
            narrative_map[original_space] = fake_space
            original_comma = f"{patient_data.last_name}, {patient_data.first_name}"
            fake_comma = f"{fake_patient['last_name']}, {fake_patient['first_name']}"
            narrative_map[original_comma] = fake_comma

        if patient_data.street and fake_patient['address'].get('street'):
            narrative_map[patient_data.street] = fake_patient['address']['street']
        if patient_data.city and fake_patient['address'].get('city'):
            narrative_map[patient_data.city] = fake_patient['address']['city']
        if patient_data.state and fake_patient['address'].get('state'):
            narrative_map[patient_data.state] = fake_patient['address']['state']
        if patient_data.zip and fake_patient['address'].get('zip'):
            narrative_map[patient_data.zip] = fake_patient['address']['zip']

        mrn_pair = None
        if patient_data.mrn and fake_mrn:
            mrn_pair = (patient_data.mrn, fake_mrn)

        return {
            'count': count,
            'fake_patient': fake_patient,
            'narrative_map': narrative_map,
            'mrn_pair': mrn_pair,
        }

    def _sanitize_all_person_names(self, parser: CCDParser, phi_data) -> int:
        """Sanitize ALL person name elements in the entire document,
        except recordTarget (already handled by _sanitize_patient)."""
        count = 0

        # Build set of recordTarget name elements to skip
        record_target_names = set()
        for elem in parser.root.findall('.//hl7:recordTarget//hl7:name', self.ns):
            record_target_names.add(elem)

        # Find ALL <name> elements with <given> or <family> children anywhere in doc
        all_name_elems = parser.root.findall('.//hl7:name', self.ns)

        for name_elem in all_name_elems:
            if name_elem in record_target_names:
                continue

            given = name_elem.find('hl7:given', self.ns)
            family = name_elem.find('hl7:family', self.ns)

            # Only process if it has structured name parts (person names)
            if given is None and family is None:
                continue

            # Generate a fake name for this person
            fake_person = self.phi_gen.generate_patient()

            if given is not None and given.text:
                given.text = fake_person['first_name']
                count += 1
            if family is not None and family.text:
                family.text = fake_person['last_name']
                count += 1

            # Also handle prefix/suffix if present
            prefix = name_elem.find('hl7:prefix', self.ns)
            if prefix is not None and prefix.text:
                prefix.text = ""
                count += 1

        # Also handle unstructured <name> elements (just text, no given/family children)
        for name_elem in all_name_elems:
            if name_elem in record_target_names:
                continue
            given = name_elem.find('hl7:given', self.ns)
            family = name_elem.find('hl7:family', self.ns)
            if given is not None or family is not None:
                continue  # Already handled above
            # Plain text name (e.g., <name>John Smith</name>)
            if name_elem.text and name_elem.text.strip():
                # Skip if this looks like an organization name (handled separately)
                parent_tag = ''
                # We can't easily get parent in ElementTree, so just replace
                # Organization names will be handled by _sanitize_all_organizations
                pass

        return count

    @staticmethod
    def _build_org_identity(id_elem) -> str:
        """Build a stable org identity from CCD id root/extension pair."""
        if id_elem is None:
            return ""
        extension = (id_elem.get('extension') or '').strip()
        root = (id_elem.get('root') or '').strip()
        if root and extension:
            return f"{root}|{extension}"
        if extension:
            return f"EXT:{extension}"
        if root:
            return f"ROOT:{root}"
        return ""

    def _sanitize_all_addresses(self, parser: CCDParser) -> int:
        """Sanitize ALL address elements in the entire document,
        except recordTarget (already handled)."""
        count = 0

        # Build set of recordTarget addr elements to skip
        record_target_addrs = set()
        for elem in parser.root.findall('.//hl7:recordTarget//hl7:addr', self.ns):
            record_target_addrs.add(elem)

        # Find ALL <addr> elements anywhere in doc
        all_addr_elems = parser.root.findall('.//hl7:addr', self.ns)

        for addr_elem in all_addr_elems:
            if addr_elem in record_target_addrs:
                continue

            # Only replace if it has address content
            street = addr_elem.find('hl7:streetAddressLine', self.ns)
            city = addr_elem.find('hl7:city', self.ns)
            if street is not None or city is not None:
                fake_addr = self.phi_gen.generate_address()
                count += self._replace_address_fields(addr_elem, fake_addr)

        return count

    def _sanitize_all_telecom(self, parser: CCDParser) -> int:
        """Sanitize ALL telecom elements in the entire document,
        except recordTarget (already handled)."""
        count = 0

        # Build set of recordTarget telecom elements to skip
        record_target_telecoms = set()
        for elem in parser.root.findall('.//hl7:recordTarget//hl7:telecom', self.ns):
            record_target_telecoms.add(elem)

        # Find ALL <telecom> elements anywhere in doc
        all_telecom_elems = parser.root.findall('.//hl7:telecom', self.ns)

        for telecom in all_telecom_elems:
            if telecom in record_target_telecoms:
                continue
            count += self._replace_telecom(telecom)

        return count

    def _collect_all_person_names(self, parser: CCDParser) -> Set[str]:
        """Collect person names from structured and unstructured <name> nodes."""
        names = set()
        ns_uri = 'urn:hl7-org:v3'

        for name_elem in parser.root.findall(f'.//{{{ns_uri}}}name', self.ns):
            givens = [g.text.strip() for g in name_elem.findall(f'{{{ns_uri}}}given') if g.text and g.text.strip()]
            family_elem = name_elem.find(f'{{{ns_uri}}}family')
            family = family_elem.text.strip() if family_elem is not None and family_elem.text and family_elem.text.strip() else ""

            # Structured names
            if givens or family:
                for g in givens:
                    if len(g) >= 2:
                        names.add(g)
                if family and len(family) >= 2:
                    names.add(family)
                if family and givens:
                    names.add(f"{givens[0]} {family}")
                    names.add(f"{family}, {givens[0]}")
                continue

            # Unstructured names
            raw_text = (name_elem.text or "").strip()
            if len(raw_text) >= 3 and any(ch.isalpha() for ch in raw_text):
                names.add(raw_text)

        return names

    def _collect_all_org_names(self, parser: CCDParser) -> Set[str]:
        """Collect all organization/facility names from org-like elements."""
        org_names = set()
        ns_uri = 'urn:hl7-org:v3'
        org_tag_suffixes = [
            'representedOrganization',
            'representedCustodianOrganization',
            'serviceProviderOrganization',
            'providerOrganization',
            'wholeOrganization',
            'manufacturerOrganization',
            'scopingOrganization',
            'playingEntity',
        ]

        for suffix in org_tag_suffixes:
            for org_elem in parser.root.findall(f'.//{{{ns_uri}}}{suffix}', self.ns):
                name_elem = org_elem.find(f'{{{ns_uri}}}name')
                if name_elem is not None and name_elem.text and name_elem.text.strip():
                    org_names.add(name_elem.text.strip())

        return org_names

    def _sanitize_all_organizations(self, parser: CCDParser) -> int:
        """Sanitize ALL organization-like elements in the entire document.
        Covers representedOrganization, representedCustodianOrganization,
        serviceProviderOrganization, providerOrganization, wholeOrganization,
        manufacturerOrganization, scopingOrganization, etc."""
        count = 0

        # Match all organization-like element tags
        org_tag_suffixes = [
            'representedOrganization',
            'representedCustodianOrganization',
            'serviceProviderOrganization',
            'providerOrganization',
            'wholeOrganization',
            'manufacturerOrganization',
            'scopingOrganization',
        ]

        # Use the namespace-aware tag format
        ns_uri = 'urn:hl7-org:v3'
        processed_orgs = set()

        for suffix in org_tag_suffixes:
            org_elems = parser.root.findall(f'.//{{{ns_uri}}}{suffix}', self.ns)

            for org_elem in org_elems:
                if id(org_elem) in processed_orgs:
                    continue
                processed_orgs.add(id(org_elem))

                # Resolve org identity from first id element using root+extension tuple.
                original_org_id = ""
                first_id_elem = org_elem.find(f'{{{ns_uri}}}id')
                if first_id_elem is not None:
                    original_org_id = (
                        first_id_elem.get('extension')
                        or first_id_elem.get('root')
                        or ""
                    )
                org_identity = self._build_org_identity(first_id_elem)

                # Replace organization name
                name_elem = org_elem.find(f'{{{ns_uri}}}name')
                original_name = ""
                if name_elem is not None and name_elem.text and name_elem.text.strip():
                    original_name = name_elem.text.strip()
                else:
                    original_name = original_org_id or "UNKNOWN_ORG"

                if not org_identity:
                    org_identity = original_org_id or original_name
                fake_org = self._get_or_create_fake_org(original_name, org_identity)
                self._org_name_cache.setdefault(original_name, fake_org)

                if name_elem is not None and name_elem.text and name_elem.text.strip():
                    name_elem.text = fake_org['name']
                    count += 1

                # Replace organization ids with stable mapped org id.
                for id_elem in org_elem.findall(f'{{{ns_uri}}}id'):
                    old_ext = id_elem.get('extension')
                    if old_ext != fake_org['facility_id']:
                        id_elem.set('extension', fake_org['facility_id'])
                        count += 1

                # Replace organization address
                addr_elem = org_elem.find(f'{{{ns_uri}}}addr')
                if addr_elem is not None:
                    street = addr_elem.find(f'{{{ns_uri}}}streetAddressLine')
                    city = addr_elem.find(f'{{{ns_uri}}}city')
                    if street is not None or city is not None:
                        fake_addr = self.phi_gen.generate_address()
                        count += self._replace_address_fields(addr_elem, fake_addr)

                # Replace organization telecom
                telecom = org_elem.find(f'{{{ns_uri}}}telecom')
                if telecom is not None:
                    count += self._replace_telecom(telecom)

        # Also handle healthCareFacility/location names
        for facility_elem in parser.root.findall(f'.//{{{ns_uri}}}healthCareFacility', self.ns):
            if id(facility_elem) in processed_orgs:
                continue
            processed_orgs.add(id(facility_elem))
            loc = facility_elem.find(f'{{{ns_uri}}}location')
            if loc is not None:
                name_elem = loc.find(f'{{{ns_uri}}}name')
                if name_elem is not None and name_elem.text and name_elem.text.strip():
                    original_name = name_elem.text.strip()
                    fake_org = self._get_or_create_fake_org(original_name, original_name)
                    self._org_name_cache.setdefault(original_name, fake_org)
                    name_elem.text = fake_org['name']
                    count += 1

        return count

    def _get_or_create_fake_org(self, original_name: str, original_identity: str = "") -> Dict:
        """Get or create a fake organization using the database for consistency."""
        existing = self.db.get_organization_by_hash(original_name, original_identity)
        if existing:
            return existing

        # Generate new
        fake_org_data = self.phi_gen.generate_organization()
        if isinstance(fake_org_data.get('address'), dict):
            addr = fake_org_data['address']
            db_data = {
                'name': fake_org_data['name'],
                'facility_id': fake_org_data.get('facility_id', ''),
                'address': addr.get('street', ''),
                'city': addr.get('city', ''),
                'state': addr.get('state', ''),
                'zip': addr.get('zip', ''),
                'latitude': addr.get('latitude'),
                'longitude': addr.get('longitude')
            }
        else:
            db_data = fake_org_data

        self.db.get_or_create_organization(original_name, original_identity, db_data)
        created = self.db.get_organization_by_hash(original_name, original_identity)
        if created:
            return created

        fallback_hash = self.db.hash_value(f"{original_name}|{original_identity}")
        return {
            'name': db_data['name'],
            'facility_id': f"ORG-{fallback_hash[:8].upper()}",
            'address': {
                'street': db_data.get('address', ''),
                'city': db_data.get('city', ''),
                'state': db_data.get('state', ''),
                'zip': db_data.get('zip', '')
            }
        }

    def _sanitize_dates(self, parser: CCDParser) -> int:
        """Coarsen all dates to year-only for privacy.
        Handles standard date tags AND <value xsi:type="TS"> elements."""
        count = 0

        # Standard date element tags
        date_tags = ['birthTime', 'effectiveTime', 'time', 'low', 'high', 'center']

        for tag in date_tags:
            date_elems = parser.root.findall(f'.//hl7:{tag}', self.ns)

            for elem in date_elems:
                value = elem.get('value')
                if value and len(value) > 4:
                    # Coarsen to year only (first 4 characters)
                    year_only = value[:4]
                    elem.set('value', year_only)
                    count += 1
                    logger.debug(f"Coarsened date: {value} -> {year_only}")

        # Handle <value xsi:type="TS" value="YYYYMMDD"/> elements
        xsi_ns = 'http://www.w3.org/2001/XMLSchema-instance'
        all_value_elems = parser.root.findall('.//hl7:value', self.ns)

        for elem in all_value_elems:
            xsi_type = elem.get(f'{{{xsi_ns}}}type', '')
            if xsi_type == 'TS':
                value = elem.get('value', '')
                if value and len(value) > 4:
                    year_only = value[:4]
                    elem.set('value', year_only)
                    count += 1
                    logger.debug(f"Coarsened TS value: {value} -> {year_only}")

        return count

    def _sanitize_narrative_text(self, parser: CCDParser,
                                  original_names: Set[str],
                                  original_org_names: Set[str],
                                  fake_patient: Dict,
                                  narrative_patient_map: Dict[str, str],
                                  mrn_pair) -> int:
        """Scrub patient names and org names from free-text narrative blocks."""
        count = 0

        # Build replacement map: original -> fake
        replacements = {}
        replacements.update(narrative_patient_map or {})

        # Add patient name replacements
        if fake_patient:
            for name in original_names:
                if len(name) >= 2:  # Skip very short names to avoid false positives
                    replacements[name] = fake_patient.get('first_name', 'REDACTED')

        # For org names, replace with generic
        for org_name in original_org_names:
            if len(org_name) >= 3:
                fake_org = self._org_name_cache.get(org_name)
                if not fake_org:
                    fake_org = self._get_or_create_fake_org(org_name, org_name)
                replacements[org_name] = fake_org['name']

        if not replacements:
            return 0

        # Sort by length (longest first) to avoid partial replacements
        sorted_originals = sorted(replacements.keys(), key=len, reverse=True)

        # Build a case-insensitive regex pattern
        pattern = re.compile(
            '|'.join(re.escape(name) for name in sorted_originals),
            re.IGNORECASE
        )

        def replace_match(match):
            matched_text = match.group(0)
            # Find the original key (case-insensitive)
            for original in sorted_originals:
                if matched_text.lower() == original.lower():
                    return replacements[original]
            return matched_text

        # Walk all elements and replace text content
        count += self._walk_and_replace_text(parser.root, pattern, replace_match)

        # Replace raw MRN occurrences in narrative text while preserving TX-{mrn}-suffix.
        if mrn_pair:
            original_mrn, fake_mrn = mrn_pair
            mrn_pattern = re.compile(
                rf'(?<!TX-){re.escape(original_mrn)}(?!-[A-Za-z0-9])'
            )
            count += self._walk_and_replace_text(
                parser.root, mrn_pattern, lambda _: fake_mrn
            )

        return count

    def _walk_and_replace_text(self, element, pattern, replace_func) -> int:
        """Recursively walk XML tree and replace text matching pattern."""
        count = 0

        # Replace in element's direct text
        if element.text and pattern.search(element.text):
            new_text = pattern.sub(replace_func, element.text)
            if new_text != element.text:
                element.text = new_text
                count += 1

        # Replace in element's tail text
        if element.tail and pattern.search(element.tail):
            new_tail = pattern.sub(replace_func, element.tail)
            if new_tail != element.tail:
                element.tail = new_tail
                count += 1

        # Recurse into children
        for child in element:
            count += self._walk_and_replace_text(child, pattern, replace_func)

        return count

    def _replace_address_fields(self, addr_elem, fake_addr: Dict) -> int:
        """Replace address sub-elements with fake data. Returns count of replacements."""
        count = 0
        ns_uri = 'urn:hl7-org:v3'

        street_elem = addr_elem.find(f'{{{ns_uri}}}streetAddressLine')
        city_elem = addr_elem.find(f'{{{ns_uri}}}city')
        state_elem = addr_elem.find(f'{{{ns_uri}}}state')
        zip_elem = addr_elem.find(f'{{{ns_uri}}}postalCode')
        country_elem = addr_elem.find(f'{{{ns_uri}}}country')

        if street_elem is not None and street_elem.text:
            street_elem.text = fake_addr.get('street', fake_addr.get('address', ''))
            count += 1
        if city_elem is not None and city_elem.text:
            city_elem.text = fake_addr.get('city', '')
            count += 1
        if state_elem is not None and state_elem.text:
            state_elem.text = fake_addr.get('state', '')
            count += 1
        if zip_elem is not None and zip_elem.text:
            zip_elem.text = fake_addr.get('zip', '')
            count += 1

        return count

    def _replace_telecom(self, telecom, first_name: str = '', last_name: str = '') -> int:
        """Replace a telecom element's value. Returns count of replacements."""
        value = telecom.get('value', '')
        if value.startswith('tel:') or value.startswith('fax:'):
            fake_phone = self.phi_gen.generate_phone()
            prefix = 'tel:' if value.startswith('tel:') else 'fax:'
            telecom.set('value', f"{prefix}{fake_phone}")
            return 1
        elif value.startswith('mailto:'):
            fake_email = self.phi_gen.generate_email(
                first_name or 'user', last_name or 'name'
            )
            telecom.set('value', f"mailto:{fake_email}")
            return 1
        elif value.startswith('http:') or value.startswith('https:'):
            telecom.set('value', 'https://www.example.com')
            return 1
        return 0

    def close(self):
        """Close database connection"""
        self.db.close()
