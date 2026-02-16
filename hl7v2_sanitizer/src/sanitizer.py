"""
PHI Sanitizer - Main orchestration (HL7 v2.x only)
Coordinates parsing, PHI extraction, fake data generation, and replacement
"""
import re
import logging
from typing import Dict, List, Tuple, Optional
from pathlib import Path

from src.hl7_parser import HL7Parser
from src.phi_generator import PHIGenerator
from src.database import PHIDatabase

logger = logging.getLogger(__name__)


class PHISanitizer:
    """Main PHI sanitization orchestrator"""
    
    def __init__(self, db_path: str):
        self.db = PHIDatabase(db_path)
        self.generator = PHIGenerator()
        self.phi_replaced_count = 0
    
    def sanitize_file(self, input_path: str, output_path: str) -> Dict:
        """
        Sanitize a single HL7 v2.x file
        Returns processing statistics
        """
        logger.info(f"Processing: {input_path}")
        
        # Read file
        with open(input_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # Process HL7 v2.x message
        message_type, sanitized_content, stats = self._sanitize_hl7(content)
        
        # Write sanitized file
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(sanitized_content)
        
        logger.info(f"Sanitized {stats['phi_count']} PHI elements")
        logger.info(f"Output: {output_path}")
        
        return {
            'message_type': message_type,
            'phi_count': stats['phi_count'],
            'status': 'success'
        }
    
    def _sanitize_hl7(self, content: str) -> Tuple[str, str, Dict]:
        """Sanitize HL7 v2.x message"""
        parser = HL7Parser(content)
        message_type = parser.message_type or "UNKNOWN"
        
        # Extract PHI
        phi_data = parser.extract_phi()
        
        # Track replacements for full-text search
        text_replacements = []
        phi_count = 0

        # Process organizations first so MRN mapping can key on a stable org id.
        primary_org_db_id, primary_org_prefix, org_phi_count = self._sanitize_organizations(
            parser, phi_data['organizations']
        )
        phi_count += org_phi_count

        # Process patients
        for patient in phi_data['patients']:
            # Get or create fake patient data
            original_name = f"{patient['last_name']}^{patient['first_name']}"
            original_dob = patient.get('dob', '')
            
            patient_hash = self.db.hash_value(f"{original_name}|{original_dob}")
            existing = self.db.get_patient_by_hash(patient_hash)
            
            if existing:
                fake_patient = existing
                patient_id = self.db.get_or_create_patient(
                    original_name, original_dob, fake_patient
                )
            else:
                fake_patient = self.generator.generate_patient(original_dob)
                # Create in database
                patient_id = self.db.get_or_create_patient(
                    original_name, original_dob, fake_patient
                )
            
            # Replace in structured fields
            if patient.get('last_name'):
                parser.replace_field('PID', 5, fake_patient['last_name'], component_num=1)
                text_replacements.append((patient['last_name'], fake_patient['last_name']))
                phi_count += 1
            
            if patient.get('first_name'):
                parser.replace_field('PID', 5, fake_patient['first_name'], component_num=2)
                text_replacements.append((patient['first_name'], fake_patient['first_name']))
                phi_count += 1
            
            # Replace DOB
            if patient.get('dob'):
                parser.replace_field('PID', 7, fake_patient['dob'])
                phi_count += 1
            
            # Replace SSN
            if patient.get('ssn'):
                parser.replace_field('PID', 19, fake_patient['ssn'])
                phi_count += 1
            
            # Replace MRN
            if patient.get('mrn'):
                original_mrn = patient['mrn']
                generated_mrn = self.generator.generate_mrn(
                    original_mrn, org_prefix=primary_org_prefix
                )
                fake_mrn = generated_mrn
                if patient_id and primary_org_db_id:
                    fake_mrn = self.db.get_or_create_mrn(
                        patient_id, primary_org_db_id, original_mrn, generated_mrn
                    )
                parser.replace_field('PID', 3, fake_mrn)
                phi_count += 1
            
            # Replace address
            if patient.get('address'):
                fake_address = self.generator.generate_address()
                if patient['address'].get('street'):
                    parser.replace_field('PID', 11, fake_address['street'], component_num=1)
                    phi_count += 1
                if patient['address'].get('city'):
                    parser.replace_field('PID', 11, fake_address['city'], component_num=3)
                    phi_count += 1
                if patient['address'].get('state'):
                    parser.replace_field('PID', 11, fake_address['state'], component_num=4)
                    phi_count += 1
                if patient['address'].get('zip'):
                    parser.replace_field('PID', 11, fake_address['zip'], component_num=5)
                    phi_count += 1
            
            # Replace phones
            if patient.get('phones'):
                fake_phone = self.generator.generate_phone()
                parser.replace_field('PID', 13, fake_phone)
                phi_count += 1
        
        # Process contacts (NK1)
        for i, contact in enumerate(phi_data['contacts']):
            if contact.get('last_name'):
                fake_contact = self.generator.generate_patient()
                fake_name = f"{fake_contact['last_name']}^{fake_contact['first_name']}"
                parser.replace_field('NK1', 2, fake_name, instance=i)
                text_replacements.append((contact['last_name'], fake_contact['last_name']))
                text_replacements.append((contact['first_name'], fake_contact['first_name']))
                phi_count += 1
            
            # NK1-4: Address (street^city^state^zip)
            if contact.get('address'):
                fake_address = self.generator.generate_address()
                # Replace entire address field
                fake_addr_str = f"{fake_address['street']}^^{fake_address['city']}^{fake_address['state']}^{fake_address['zip']}^USA"
                parser.replace_field('NK1', 4, fake_addr_str, instance=i)
                phi_count += 1
            
            # NK1-5: Phone
            if contact.get('phone'):
                fake_phone = self.generator.generate_phone()
                parser.replace_field('NK1', 5, fake_phone, instance=i)
                phi_count += 1
        
        # Process providers
        for provider in phi_data['providers']:
            if provider.get('last_name'):
                # Check if we already have this provider in the database
                provider_hash_key = f"{provider.get('last_name', '')}^{provider.get('first_name', '')}"
                fake_provider = self.db.get_provider_by_hash(provider_hash_key)
                
                if not fake_provider:
                    # Generate new fake provider and save to database
                    fake_provider = self.generator.generate_provider()
                    self.db.save_provider(provider_hash_key, fake_provider)
                
                # Track for text replacement in free text
                text_replacements.append((provider['last_name'], fake_provider['last_name']))
                if provider.get('first_name'):
                    text_replacements.append((provider['first_name'], fake_provider['first_name']))
                phi_count += 1
        
        # MSH-3: Sending Application (EMR type) - map to standard EMR names
        if 'MSH' in parser.segments:
            sending_app = parser.get_field('MSH', 3, 0)
            if sending_app:
                fake_emr = self.generator.generate_emr_name(sending_app)
                parser.replace_field('MSH', 3, fake_emr)
                phi_count += 1
            
            # MSH-5 & MSH-6: Receiving Application/Facility - hardcode to "IS" (Interstella)
            parser.replace_field('MSH', 5, 'IS')
            parser.replace_field('MSH', 6, 'IS')
            phi_count += 2
        
        # Process IN1 (Insurance) segments - addresses and phone numbers
        if 'IN1' in parser.segments:
            for i in range(len(parser.segments['IN1'])):
                # IN1-5: Insurance Company Address
                fake_address = self.generator.generate_address()
                fake_addr = f"{fake_address['street']}^^{fake_address['city']}^{fake_address['state']}^{fake_address['zip']}"
                parser.replace_field('IN1', 5, fake_addr, instance=i)
                phi_count += 1
                
                # IN1-6: Insurance Company Phone
                fake_phone = self.generator.generate_phone()
                parser.replace_field('IN1', 6, fake_phone, instance=i)
                phi_count += 1
                
                # IN1-19: Insured's Address (often same as patient but could be different)
                parser.replace_field('IN1', 19, fake_addr, instance=i)
                phi_count += 1
                
                # IN1-43: Insured's Employer/School Address
                parser.replace_field('IN1', 43, fake_addr, instance=i)
                phi_count += 1
        
        # Process IN2 (Insurance Additional Info) segments - phones and employer
        if 'IN2' in parser.segments:
            for i in range(len(parser.segments['IN2'])):
                # IN2-63: Insured's Phone (Home)
                fake_phone = self.generator.generate_phone()
                parser.replace_field('IN2', 63, fake_phone, instance=i)
                phi_count += 1
                
                # IN2-64: Insured's Employer Phone
                fake_employer_phone = self.generator.generate_phone()
                parser.replace_field('IN2', 64, fake_employer_phone, instance=i)
                phi_count += 1
                
                # IN2-72: Insured's Employer Name (replace with generic)
                fake_employer = self.generator.generate_employer_name()
                parser.replace_field('IN2', 72, fake_employer, instance=i)
                phi_count += 1
        
        # Process GT1 (Guarantor) segments - addresses
        if 'GT1' in parser.segments:
            for i in range(len(parser.segments['GT1'])):
                # GT1-5: Guarantor Address
                fake_address = self.generator.generate_address()
                fake_addr = f"{fake_address['street']}"
                parser.replace_field('GT1', 5, fake_addr, instance=i)
                phi_count += 1
        
        # Convert back to string
        sanitized_content = parser.to_string()
        
        sanitized_content = self._apply_text_replacements(sanitized_content, text_replacements)
        sanitized_content = self._apply_pattern_sanitization(sanitized_content)
        
        stats = {'phi_count': phi_count}
        return message_type, sanitized_content, stats

    def _sanitize_organizations(self, parser: HL7Parser,
                                organizations: List[Dict]) -> Tuple[Optional[int], str, int]:
        """Map organizations and apply stable facility replacements."""
        phi_count = 0
        primary_org_db_id = None
        primary_org_prefix = ""

        for org in organizations:
            org_name = (org.get('name') or '').strip()
            if not org_name:
                continue

            org_identity = org_name
            fake_org = self.db.get_organization_by_hash(org_name, org_identity)
            if not fake_org:
                fake_org = self.generator.generate_organization()
                self.db.save_organization(org_name, fake_org, original_identity=org_identity)
                fake_org = self.db.get_organization_by_hash(org_name, org_identity)
            if not fake_org:
                continue

            org_db_id = self.db.get_organization_id_by_hash(org_name, org_identity)
            if primary_org_db_id is None and org_db_id:
                primary_org_db_id = org_db_id
                primary_org_prefix = fake_org.get('facility_id', '')

            if org.get('type') == 'sending_facility':
                parser.replace_field('MSH', 4, fake_org['facility_id'])
                if org_db_id:
                    # Prefer sending facility as the MRN org prefix anchor.
                    primary_org_db_id = org_db_id
                    primary_org_prefix = fake_org.get('facility_id', '')
                phi_count += 1
            elif org.get('type') == 'servicing_facility':
                parser.replace_field('PV1', 39, fake_org['facility_id'])
                phi_count += 1

        if primary_org_db_id is None:
            fallback_name = "UNKNOWN_ORG"
            fallback_identity = "UNKNOWN_ORG"
            fallback_org = self.db.get_organization_by_hash(fallback_name, fallback_identity)
            if not fallback_org:
                fallback_org = self.generator.generate_organization()
                self.db.save_organization(
                    fallback_name,
                    fallback_org,
                    original_identity=fallback_identity,
                )
            primary_org_db_id = self.db.get_organization_id_by_hash(
                fallback_name, fallback_identity
            )
            if fallback_org:
                primary_org_prefix = fallback_org.get('facility_id', '')

        return primary_org_db_id, primary_org_prefix, phi_count

    @staticmethod
    def _apply_text_replacements(content: str, text_replacements: List[Tuple[str, str]]) -> str:
        """Apply case-insensitive literal text replacements."""
        result = content
        for original, fake in text_replacements:
            if original and len(original) > 2:
                result = re.sub(re.escape(original), fake, result, flags=re.IGNORECASE)
        return result

    def _apply_pattern_sanitization(self, content: str) -> str:
        """Apply regex and dictionary based PHI hardening for free text."""
        sanitized_content = re.sub(
            r'\b[A-Z][A-Z\s&\-\.]+\s+(SCHOOL|COLLEGE|UNIVERSITY|ACADEMY|INSTITUTE)\b',
            'GENERIC EDUCATIONAL INSTITUTION',
            content,
        )

        def replace_address(match):
            addr = self.generator.generate_address()
            return f"{addr['street']}"

        sanitized_content = re.sub(
            r'\b\d{1,5}\s+[A-Z][A-Za-z\s]+\s+(AVE|AVENUE|RD|ROAD|ST|STREET|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|WAY|PKWY|PARKWAY)\b',
            replace_address,
            sanitized_content,
        )

        ny_to_tx_cities = {
            'SYRACUSE': 'HOUSTON',
            'Syracuse': 'Houston',
            'SAN ANTONIO': 'DALLAS',
            'San Antonio': 'Dallas',
            'ROCHESTER': 'AUSTIN',
            'Rochester': 'Austin',
            'ALBANY': 'FORT WORTH',
            'Albany': 'Fort Worth',
            'BUFFALO': 'EL PASO',
            'Buffalo': 'El Paso',
            'FULTON': 'ARLINGTON',
            'Fulton': 'Arlington',
            'DOBBS FERRY': 'PLANO',
            'Dobbs Ferry': 'Plano',
            'GREENWICH': 'CORPUS CHRISTI',
            'Greenwich': 'Corpus Christi',
            'BALDWINSVILLE': 'LAREDO',
            'Baldwinsville': 'Laredo',
            'LIVONIA': 'AMARILLO',
            'Livonia': 'Amarillo',
        }
        for ny_city, tx_city in ny_to_tx_cities.items():
            sanitized_content = sanitized_content.replace(ny_city, tx_city)

        sanitized_content = re.sub(r'\bSJSY\b', 'TXMC', sanitized_content)
        sanitized_content = re.sub(r'\bSJHS\b', 'TXHC', sanitized_content)
        sanitized_content = re.sub(r'\bDr\.?\s+([A-Z][a-z]+)\b', 'Dr. Smith', sanitized_content)
        sanitized_content = re.sub(r'\bNY\s+1\d{4}\b', 'TX 78205', sanitized_content)
        sanitized_content = re.sub(r'\(315\)', '(210)', sanitized_content)
        sanitized_content = re.sub(r'\b315\b', '210', sanitized_content)

        return sanitized_content
    
    
    def close(self):
        """Close database connection"""
        self.db.close()
