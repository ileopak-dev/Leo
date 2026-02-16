# HL7 v2.x PHI Sanitization Tool

Sanitizes HL7 v2.x pipe-delimited messages (ADT, ORU, MDM, VXU, TRN) to remove Protected Health Information while maintaining data context and relationships.

## What This Tool Does

**Processes:** HL7 v2.x pipe-delimited messages only  
**Does NOT Process:** XML files, CCD documents, HL7 v3 (use separate HL7 v3 sanitizer)

## Quick Start

```bash
# Install dependencies
pip3 install -r requirements.txt

# Configure your data directory
# Edit config.py and set: ROOT_DIR = "/path/to/your/data"

# Test with 3 random files
python3 main.py --count 3 --random

# Process all files
python3 main.py

# Fresh start (delete database for new mappings)
python3 main.py --clean-db
```

## Automatic Cleanup

**Each run automatically deletes:**
- Previous `output/` directory
- Previous `logs/` directory

**Database is preserved** across runs for consistent mappings unless you use `--clean-db`

## Command Options

```bash
# Process all files (default)
python3 main.py

# Process N random files  
python3 main.py --count 5 --random

# Process first N files (alphabetically)
python3 main.py --count 5

# Process specific files
python3 main.py --files ADT/file1.txt ORU/file2.txt

# Fresh start - delete database
python3 main.py --clean-db

# Dry run (show what would be processed)
python3 main.py --count 3 --dry-run

# Verbose debug output
python3 main.py --count 2 --verbose
```

## Configuration

Edit `config.py`:

```python
ROOT_DIR = "/Users/leopak/Downloads/data/data"
```

The tool will:
- Read files from subdirectories (ADT/, ORU/, MDM/, etc.)
- **Delete previous `output/` and `logs/` directories**
- Create fresh `output/`, `database/`, `logs/` subdirectories
- Preserve folder structure in output

## What Gets Sanitized

### Patient Data (PID Segment)
- Names → Realistic fake names
- MRN → `TX-{original}-{suffix}` format
- DOB → Similar age range
- SSN → Fake SSN
- Addresses → Real TX addresses with geocoding
- Phone numbers → TX area codes

### Providers
- Names in EVN, PV1, ORC, OBR → Fake names
- Stored in database for consistency

### Organizations/Facilities
- **MSH-3 (EMR)**: Mapped to valid EMR (EPIC, Cerner, eCW, Meditech, NetSmart)
- **MSH-4 (Facility)**: Replaced with fake facility ID
- **MSH-5 & MSH-6**: Hardcoded to "IS" (Interstella)
- Facility codes in text → Replaced (SJSY → TXMC)

### Next of Kin (NK1)
- Names, addresses, phones → Fake data

### Insurance (IN1/IN2)
- Addresses, phones, employer names → Fake data

### Guarantor (GT1)
- Addresses → Fake data

### Geographic References
- Syracuse, Fulton, etc. → TX cities
- San Antonio → Dallas (when it's real PHI)
- NY zip codes → TX zip codes
- 315 area code → TX area codes

### Free Text Patterns
- "Dr [Name]" → "Dr. Smith"
- School names → "GENERIC EDUCATIONAL INSTITUTION"
- Street addresses → Fake TX addresses

## Output Structure

```
/Users/leopak/Downloads/data/data/
├── ADT/                    # Your original files
├── ORU/
├── output/                 # ⚠️ DELETED each run
│   ├── ADT/
│   │   └── ADT_A08_file.txt
│   └── ORU/
│       └── ORU_R01_file.txt
├── database/              # ✅ Preserved (unless --clean-db)
│   └── phi_mapping.db
└── logs/                  # ⚠️ DELETED each run
    ├── sanitizer.log
    └── run_manifest_*.txt
```

## Database Consistency

The SQLite database ensures:
- Same patient → Same fake identity across ALL messages
- Same provider → Same fake provider
- Same organization → Same fake facility

**Database is preserved** between runs unless you use `--clean-db`

To start completely fresh:
```bash
python3 main.py --clean-db
```

## Message Type Detection

Automatically detects message types from MSH segment:
- Checks MSH-9 (standard)
- Checks MSH-10 (non-standard)
- Checks MSH-11 (extreme non-standard)
- Validates against: ADT, ORU, MDM, VXU, TRN
- Falls back to "UNKNOWN" if not detected

Handles both MSH formats:
- `MSH|^~\&|EPIC|...` (with pipe)
- `MSH^~\&|EPIC|...` (without pipe)

## Supported Message Types

- **ADT** (Admit/Discharge/Transfer)
- **ORU** (Observation/Lab Results)
- **MDM** (Medical Document Management)
- **VXU** (Vaccination Updates)
- **TRN** (Transcription)

## Quality Assurance

Each run creates a manifest in `logs/run_manifest_*.txt` showing:
- Files processed
- Message types
- PHI elements replaced
- Database statistics

Compare input and output files to verify PHI removal.

## Troubleshooting

### No files found
Check `ROOT_DIR` in config.py matches your data location

### Database issues
Use `--clean-db` to start fresh with new mappings

### Processing errors
Check `logs/sanitizer.log` for detailed error messages

## Technical Details

- **Language:** Python 3.9+
- **Dependencies:** faker
- **Database:** SQLite
- **Message Format:** HL7 v2.x pipe-delimited
- **Versions Supported:** 2.3, 2.3.1, 2.4, 2.5, 2.7, etc.

## License

Internal use only - Interstella Technology Inc.
