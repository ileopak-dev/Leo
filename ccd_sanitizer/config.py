"""
CCD/CDA PHI Sanitization Configuration
"""
import os

# Root directory - user's data folder containing CCD files
# Updated to share database with HL7 v2 sanitizer
ROOT_DIR = "/Users/leopak/Downloads/data/data"
CCD_DIR = os.path.join(ROOT_DIR, "CCD")

# Paths (shared with HL7 v2 sanitizer for consistency)
INPUT_DIR = CCD_DIR  # CCD XML files in data/data/CCD/
OUTPUT_DIR = os.path.join(ROOT_DIR, "output")  # Shared output directory
DB_DIR = os.path.join(ROOT_DIR, "database")    # Shared database directory
LOG_DIR = os.path.join(ROOT_DIR, "logs")       # Shared log directory

# Database
DB_FILE = os.path.join(DB_DIR, "phi_mapping.db")

# Processing defaults
DEFAULT_MODE = "all"  # No params = process everything
MANIFEST_FORMAT = "txt"  # Simple text file only

# MRN format
MRN_PREFIX = "TX"  # Texas-based prefix
MRN_SUFFIX_LENGTH = 4  # Random alphanumeric suffix length

# Geographic defaults
DEFAULT_STATE = "TX"  # Texas as base state
ALLOW_OUT_OF_STATE = True  # Allow some data from other states
OUT_OF_STATE_PROBABILITY = 0.1  # 10% chance of out-of-state data

# Logging
LOG_LEVEL = "INFO"  # DEBUG, INFO, WARNING, ERROR, CRITICAL
CONSOLE_OUTPUT = True
LOG_FORMAT = "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# File extensions to process (HL7 v3 CDA/CCD - XML format)
SUPPORTED_EXTENSIONS = ['.xml', '.txt']  # CCD files may be .txt or .xml

# CDA/CCD Document types we handle
SUPPORTED_DOCUMENT_TYPES = ['CCD', 'CDA', 'CCDA']

# CDA Namespaces (HL7 v3)
CDA_NAMESPACE = {
    'hl7': 'urn:hl7-org:v3',
    'xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'sdtc': 'urn:hl7-org:sdtc'
}

# XPath patterns for PHI elements
XPATH_PATTERNS = {
    # Patient demographics
    'patient_id': './/hl7:recordTarget//hl7:id',
    'patient_name': './/hl7:recordTarget//hl7:name',
    'patient_birthtime': './/hl7:recordTarget//hl7:birthTime',
    'patient_gender': './/hl7:recordTarget//hl7:administrativeGenderCode',
    'patient_address': './/hl7:recordTarget//hl7:addr',
    'patient_telecom': './/hl7:recordTarget//hl7:telecom',

    # Providers/Authors
    'provider_name': './/hl7:assignedAuthor//hl7:name',
    'provider_id': './/hl7:assignedAuthor//hl7:id',
    'provider_addr': './/hl7:assignedAuthor//hl7:addr',
    'provider_telecom': './/hl7:assignedAuthor//hl7:telecom',

    # Organizations
    'org_name': './/hl7:representedOrganization//hl7:name',
    'org_id': './/hl7:representedOrganization//hl7:id',
    'org_addr': './/hl7:representedOrganization//hl7:addr',
    'org_telecom': './/hl7:representedOrganization//hl7:telecom',

    # Document metadata
    'doc_id': './/hl7:id[@root]',
    'doc_effectiveTime': './/hl7:effectiveTime',
}
