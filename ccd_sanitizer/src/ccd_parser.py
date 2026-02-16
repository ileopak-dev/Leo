"""
CDA/CCD XML Parser
Handles HL7 v3 Clinical Document Architecture (CDA) XML documents
"""
import xml.etree.ElementTree as ET
import logging
from typing import Dict, List, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


# CDA namespace
NS = {'hl7': 'urn:hl7-org:v3'}


@dataclass
class CCDPatient:
    """Patient information from CCD"""
    mrn: str = ""
    first_name: str = ""
    last_name: str = ""
    middle_name: str = ""
    dob: str = ""
    gender: str = ""
    street: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""
    phone: str = ""
    email: str = ""


@dataclass
class CCDProvider:
    """Provider/Author information from CCD"""
    id: str = ""
    first_name: str = ""
    last_name: str = ""
    npi: str = ""
    address: str = ""
    phone: str = ""


@dataclass
class CCDOrganization:
    """Organization/Facility information from CCD"""
    id: str = ""
    name: str = ""
    address: str = ""
    phone: str = ""


class CCDParser:
    """Parse HL7 v3 CDA/CCD XML documents"""

    def __init__(self, xml_content: str):
        self.xml_content = xml_content
        self.root = None
        self.document_type = None
        self._parse()

    def _parse(self):
        """Parse XML content"""
        try:
            self.root = ET.fromstring(self.xml_content)
            logger.debug("Successfully parsed CCD XML")

            # Detect document type
            self._detect_document_type()

        except ET.ParseError as e:
            logger.error(f"Failed to parse XML: {e}")
            raise

    def _detect_document_type(self):
        """Detect CDA document type from templateId"""
        # Look for CCD templateId: 2.16.840.1.113883.10.20.1
        template_ids = self.root.findall('.//hl7:templateId', NS)

        for tid in template_ids:
            root_attr = tid.get('root', '')
            if '2.16.840.1.113883.10.20.1' in root_attr:
                self.document_type = 'CCD'
                logger.debug(f"Detected document type: CCD")
                return

        # Default to CDA if no specific type found
        self.document_type = 'CDA'
        logger.debug(f"Detected document type: CDA (generic)")

    def get_namespace_tag(self, tag: str) -> str:
        """Get fully qualified namespace tag"""
        return f"{{urn:hl7-org:v3}}{tag}"

    def extract_phi(self) -> Dict[str, any]:
        """
        Extract all PHI from the CCD document
        Returns structured PHI data
        """
        phi_data = {
            'patients': [],
            'providers': [],
            'organizations': [],
            'guardians': []
        }

        # Extract patient data
        patient = self._extract_patient()
        if patient:
            phi_data['patients'].append(patient)

        # Extract guardians/contacts
        guardians = self._extract_guardians()
        phi_data['guardians'].extend(guardians)

        # Extract providers/authors
        providers = self._extract_providers()
        phi_data['providers'].extend(providers)

        # Extract organizations
        orgs = self._extract_organizations()
        phi_data['organizations'].extend(orgs)

        logger.info(f"Extracted PHI: {len(phi_data['patients'])} patients, "
                   f"{len(phi_data['providers'])} providers, "
                   f"{len(phi_data['organizations'])} organizations, "
                   f"{len(phi_data['guardians'])} guardians")

        return phi_data

    def _extract_patient(self) -> Optional[CCDPatient]:
        """Extract patient information from recordTarget"""
        patient_data = CCDPatient()

        # Find recordTarget section
        record_target = self.root.find('.//hl7:recordTarget', NS)
        if not record_target:
            logger.warning("No recordTarget found in CCD")
            return None

        # Patient ID (MRN)
        id_elem = record_target.find('.//hl7:id', NS)
        if id_elem is not None:
            patient_data.mrn = id_elem.get('extension', '')

        # Patient Name
        name_elem = record_target.find('.//hl7:patient/hl7:name', NS)
        if name_elem is not None:
            given = name_elem.find('hl7:given', NS)
            family = name_elem.find('hl7:family', NS)

            if given is not None and given.text:
                patient_data.first_name = given.text
            if family is not None and family.text:
                patient_data.last_name = family.text

        # Birth date
        birth_elem = record_target.find('.//hl7:patient/hl7:birthTime', NS)
        if birth_elem is not None:
            patient_data.dob = birth_elem.get('value', '')

        # Gender
        gender_elem = record_target.find('.//hl7:patient/hl7:administrativeGenderCode', NS)
        if gender_elem is not None:
            patient_data.gender = gender_elem.get('code', '')

        # Address
        addr_elem = record_target.find('.//hl7:addr', NS)
        if addr_elem is not None:
            street_elem = addr_elem.find('hl7:streetAddressLine', NS)
            city_elem = addr_elem.find('hl7:city', NS)
            state_elem = addr_elem.find('hl7:state', NS)
            zip_elem = addr_elem.find('hl7:postalCode', NS)

            if street_elem is not None and street_elem.text:
                patient_data.street = street_elem.text
            if city_elem is not None and city_elem.text:
                patient_data.city = city_elem.text
            if state_elem is not None and state_elem.text:
                patient_data.state = state_elem.text
            if zip_elem is not None and zip_elem.text:
                patient_data.zip = zip_elem.text

        # Phone/Email
        telecom_elems = record_target.findall('.//hl7:telecom', NS)
        for telecom in telecom_elems:
            value = telecom.get('value', '')
            if value.startswith('tel:'):
                patient_data.phone = value.replace('tel:', '')
            elif value.startswith('mailto:'):
                patient_data.email = value.replace('mailto:', '')

        logger.debug(f"Extracted patient: {patient_data.last_name}, {patient_data.first_name} | MRN: {patient_data.mrn}")

        return patient_data

    def _extract_guardians(self) -> List[Dict]:
        """Extract guardian/parent information"""
        guardians = []

        # Find guardian elements
        guardian_elems = self.root.findall('.//hl7:guardian', NS)

        for guardian in guardian_elems:
            guardian_data = {}

            # Name
            name_elem = guardian.find('hl7:guardianPerson/hl7:name', NS)
            if name_elem is not None:
                given = name_elem.find('hl7:given', NS)
                family = name_elem.find('hl7:family', NS)

                guardian_data['first_name'] = given.text if given is not None and given.text else ""
                guardian_data['last_name'] = family.text if family is not None and family.text else ""

            # Address
            addr_elem = guardian.find('hl7:addr', NS)
            if addr_elem is not None:
                street = addr_elem.find('hl7:streetAddressLine', NS)
                guardian_data['address'] = street.text if street is not None and street.text else ""

            # Phone
            telecom = guardian.find('hl7:telecom', NS)
            if telecom is not None:
                value = telecom.get('value', '')
                if value.startswith('tel:'):
                    guardian_data['phone'] = value.replace('tel:', '')

            if guardian_data:
                guardians.append(guardian_data)

        return guardians

    def _extract_providers(self) -> List[CCDProvider]:
        """Extract provider/author information"""
        providers = []

        # Find all author elements
        author_elems = self.root.findall('.//hl7:author', NS)

        for author in author_elems:
            provider = CCDProvider()

            # Provider ID
            id_elem = author.find('.//hl7:assignedAuthor/hl7:id', NS)
            if id_elem is not None:
                provider.id = id_elem.get('extension', '')
                # Check for NPI
                if id_elem.get('root', '') == '2.16.840.1.113883.4.6':
                    provider.npi = id_elem.get('extension', '')

            # Provider Name
            name_elem = author.find('.//hl7:assignedAuthor/hl7:assignedPerson/hl7:name', NS)
            if name_elem is not None:
                given = name_elem.find('hl7:given', NS)
                family = name_elem.find('hl7:family', NS)

                if given is not None and given.text:
                    provider.first_name = given.text
                if family is not None and family.text:
                    provider.last_name = family.text

            # Address
            addr_elem = author.find('.//hl7:assignedAuthor/hl7:addr', NS)
            if addr_elem is not None:
                street = addr_elem.find('hl7:streetAddressLine', NS)
                provider.address = street.text if street is not None and street.text else ""

            # Phone
            telecom = author.find('.//hl7:assignedAuthor/hl7:telecom', NS)
            if telecom is not None:
                value = telecom.get('value', '')
                if value.startswith('tel:'):
                    provider.phone = value.replace('tel:', '')

            if provider.first_name or provider.last_name:
                providers.append(provider)

        return providers

    def _extract_organizations(self) -> List[CCDOrganization]:
        """Extract organization/facility information"""
        orgs = []

        # Find all representedOrganization elements
        org_elems = self.root.findall('.//hl7:representedOrganization', NS)

        for org_elem in org_elems:
            org = CCDOrganization()

            # Organization ID
            id_elem = org_elem.find('hl7:id', NS)
            if id_elem is not None:
                org.id = id_elem.get('extension', '')

            # Organization Name
            name_elem = org_elem.find('hl7:name', NS)
            if name_elem is not None and name_elem.text:
                org.name = name_elem.text

            # Address
            addr_elem = org_elem.find('hl7:addr', NS)
            if addr_elem is not None:
                street = addr_elem.find('hl7:streetAddressLine', NS)
                org.address = street.text if street is not None and street.text else ""

            # Phone
            telecom = org_elem.find('hl7:telecom', NS)
            if telecom is not None:
                value = telecom.get('value', '')
                if value.startswith('tel:'):
                    org.phone = value.replace('tel:', '')

            if org.name or org.id:
                orgs.append(org)

        return orgs

    def replace_element_text(self, xpath: str, new_text: str, namespace: dict = NS):
        """Replace text content of XML element(s)"""
        elements = self.root.findall(xpath, namespace)
        for elem in elements:
            elem.text = new_text

    def replace_element_attribute(self, xpath: str, attr_name: str, new_value: str, namespace: dict = NS):
        """Replace attribute value of XML element(s)"""
        elements = self.root.findall(xpath, namespace)
        for elem in elements:
            elem.set(attr_name, new_value)

    def to_string(self) -> str:
        """Convert XML tree back to string"""
        return ET.tostring(self.root, encoding='unicode', method='xml')
