"""
Generate realistic fake PHI data
Uses Faker library for names, addresses, etc.
"""
import random
import re
import string
import logging
from typing import Dict, Optional
import config

logger = logging.getLogger(__name__)

# Will install Faker library when needed
try:
    from faker import Faker
    fake = Faker('en_US')
except ImportError:
    fake = None
    logger.warning("Faker library not installed. Will install on first use.")


class PHIGenerator:
    """Generates realistic fake PHI data"""
    
    def __init__(self):
        self._ensure_faker()
        # Texas cities with ZIP codes and coordinates
        self.texas_locations = [
            {"city": "Houston", "zip": "77002", "lat": 29.7604, "lon": -95.3698},
            {"city": "Dallas", "zip": "75201", "lat": 32.7767, "lon": -96.7970},
            {"city": "Austin", "zip": "78701", "lat": 30.2672, "lon": -97.7431},
            {"city": "San Antonio", "zip": "78205", "lat": 29.4241, "lon": -98.4936},
            {"city": "Fort Worth", "zip": "76102", "lat": 32.7555, "lon": -97.3308},
            {"city": "El Paso", "zip": "79901", "lat": 31.7619, "lon": -106.4850},
            {"city": "Arlington", "zip": "76010", "lat": 32.7357, "lon": -97.1081},
            {"city": "Corpus Christi", "zip": "78401", "lat": 27.8006, "lon": -97.3964},
            {"city": "Plano", "zip": "75023", "lat": 33.0198, "lon": -96.6989},
            {"city": "Laredo", "zip": "78040", "lat": 27.5306, "lon": -99.4803},
        ]
        
        # Out-of-state options (for variety)
        self.other_locations = [
            {"city": "Phoenix", "state": "AZ", "zip": "85001", "lat": 33.4484, "lon": -112.0740},
            {"city": "Albuquerque", "state": "NM", "zip": "87101", "lat": 35.0844, "lon": -106.6504},
            {"city": "Oklahoma City", "state": "OK", "zip": "73102", "lat": 35.4676, "lon": -97.5164},
            {"city": "Little Rock", "state": "AR", "zip": "72201", "lat": 34.7465, "lon": -92.2896},
        ]
    
    def _ensure_faker(self):
        """Ensure Faker is installed"""
        global fake
        if fake is None:
            logger.info("Installing Faker library...")
            import subprocess
            subprocess.check_call(['pip', 'install', 'faker', '--break-system-packages', '-q'])
            from faker import Faker
            fake = Faker('en_US')
            logger.info("Faker library installed successfully")
    
    def generate_patient(self, original_dob: Optional[str] = None) -> Dict[str, str]:
        """Generate fake patient data"""
        first_name = fake.first_name()
        last_name = fake.last_name()
        
        # Generate DOB (keep similar age if original provided)
        if original_dob and len(original_dob) >= 8:
            try:
                # Parse original DOB (format: YYYYMMDD)
                year = int(original_dob[:4])
                # Keep within ±5 years
                fake_year = year + random.randint(-5, 5)
                fake_dob = fake.date_of_birth(minimum_age=0, maximum_age=100)
                fake_dob = fake_dob.replace(year=fake_year)
                fake_dob_str = fake_dob.strftime("%Y%m%d")
            except:
                fake_dob_str = fake.date_of_birth(minimum_age=18, maximum_age=90).strftime("%Y%m%d")
        else:
            fake_dob_str = fake.date_of_birth(minimum_age=18, maximum_age=90).strftime("%Y%m%d")
        
        # Generate SSN
        fake_ssn = fake.ssn()
        
        logger.debug(f"Generated patient: {first_name} {last_name}, DOB: {fake_dob_str}")
        
        return {
            'first_name': first_name,
            'last_name': last_name,
            'dob': fake_dob_str,
            'ssn': fake_ssn
        }
    
    def generate_address(self, use_texas: bool = True) -> Dict[str, str]:
        """Generate fake address (primarily Texas-based)"""
        # Decide if using Texas or out-of-state
        if use_texas or random.random() > config.OUT_OF_STATE_PROBABILITY:
            # Use Texas location
            location = random.choice(self.texas_locations)
            state = config.DEFAULT_STATE
            city = location['city']
            zip_code = location['zip']
            lat = location['lat']
            lon = location['lon']
        else:
            # Use out-of-state location
            location = random.choice(self.other_locations)
            state = location['state']
            city = location['city']
            zip_code = location['zip']
            lat = location['lat']
            lon = location['lon']
        
        # Generate street address
        street = fake.street_address()
        
        logger.debug(f"Generated address: {street}, {city}, {state} {zip_code}")
        
        return {
            'street': street,
            'city': city,
            'state': state,
            'zip': zip_code,
            'latitude': lat,
            'longitude': lon
        }
    
    def generate_organization(self) -> Dict[str, str]:
        """Generate fake organization/facility data in one canonical shape."""
        org_types = [
            "Medical Center",
            "Hospital",
            "Health System",
            "Clinic",
            "Healthcare",
            "Regional Medical",
        ]
        facility_id = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=random.choice([3, 4])))
        org_name = f"{fake.city()} {random.choice(org_types)}"
        address_data = self.generate_address(use_texas=True)

        logger.debug(f"Generated organization: {org_name} ({facility_id})")

        return {
            'name': org_name,
            'facility_id': facility_id,
            'address': address_data
        }
    
    def generate_provider(self) -> Dict[str, str]:
        """Generate fake provider data"""
        first_name = fake.first_name()
        last_name = fake.last_name()
        
        # Generate fake NPI (10 digits)
        npi = ''.join([str(random.randint(0, 9)) for _ in range(10)])
        
        logger.debug(f"Generated provider: {first_name} {last_name}, NPI: {npi}")
        
        return {
            'first_name': first_name,
            'last_name': last_name,
            'npi': npi
        }
    
    def generate_phone(self) -> str:
        """Generate fake phone number"""
        # Texas area codes
        texas_area_codes = ['210', '214', '254', '281', '325', '361', '409', '432', 
                           '469', '512', '682', '713', '737', '806', '817', '830', 
                           '832', '903', '915', '936', '940', '956', '972', '979']
        
        area_code = random.choice(texas_area_codes)
        exchange = ''.join([str(random.randint(0, 9)) for _ in range(3)])
        number = ''.join([str(random.randint(0, 9)) for _ in range(4)])
        
        return f"({area_code}){exchange}-{number}"
    
    def generate_employer_name(self) -> str:
        """Generate fake employer/company name"""
        return f"{fake.company()} Corp"
    
    def generate_emr_name(self, original_emr: str) -> str:
        """
        Map EMR name to standard list for consistency
        Valid EMRs: EPIC, Cerner, eCW, Meditech, NetSmart
        """
        # Hash the original to get consistent mapping
        import hashlib
        hash_val = int(hashlib.sha256(original_emr.encode()).hexdigest(), 16)
        
        valid_emrs = ['EPIC', 'Cerner', 'eCW', 'Meditech', 'NetSmart']
        return valid_emrs[hash_val % len(valid_emrs)]
    
    @staticmethod
    def _normalize_mrn_prefix(org_prefix: Optional[str]) -> str:
        """Normalize MRN prefix to alphanumeric uppercase text."""
        prefix = (org_prefix or config.MRN_PREFIX or "MRN").upper()
        prefix = re.sub(r'[^A-Z0-9]+', '', prefix)
        return prefix or "MRN"

    def generate_mrn(self, original_mrn: str, org_prefix: Optional[str] = None) -> str:
        """
        Generate fake MRN with format: {ORG_PREFIX}-{RANDOM_SUFFIX}.
        Does not embed original MRN to avoid raw identifier leakage.
        """
        suffix_len = max(config.MRN_SUFFIX_LENGTH, 4)
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=suffix_len))
        fake_mrn = f"{self._normalize_mrn_prefix(org_prefix)}-{suffix}"

        logger.debug(f"Generated MRN: {original_mrn} -> {fake_mrn}")

        return fake_mrn
    
    def generate_email(self, first_name: str, last_name: str) -> str:
        """Generate fake email based on name"""
        return fake.email()
