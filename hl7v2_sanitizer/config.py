"""
PHI Sanitization Configuration
"""
import os

# Root directory - user's data folder
ROOT_DIR = "/Users/leopak/Downloads/data/data"

# Paths (create output, database, logs subdirectories)
INPUT_DIR = ROOT_DIR  # Files directly in root
OUTPUT_DIR = os.path.join(ROOT_DIR, "output")
DB_DIR = os.path.join(ROOT_DIR, "database")
LOG_DIR = os.path.join(ROOT_DIR, "logs")

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

# File extensions to process (HL7 v2.x only - pipe-delimited)
SUPPORTED_EXTENSIONS = ['.txt', '.hl7']

# HL7 v2.x Message types we handle
SUPPORTED_MESSAGE_TYPES = ['ADT', 'ORU', 'MDM', 'VXU', 'TRN']
