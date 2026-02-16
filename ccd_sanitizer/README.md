# CCD/CDA PHI Sanitization Tool

Sanitizes HL7 v3 CDA/CCD XML documents to remove Protected Health Information while maintaining data context and relationships.

## What This Tool Does

**Processes:** HL7 v3 CDA/CCD XML documents only
**Does NOT Process:** HL7 v2 pipe-delimited messages (use separate HL7 v2 sanitizer)

## Quick Start

```bash
# Install dependencies
pip3 install -r requirements.txt

# Configure your CCD data directory
# Edit config.py and set: ROOT_DIR = "/path/to/your/CCD/files"

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
python3 main.py --files file1.xml file2.xml

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
ROOT_DIR = "/Users/leopak/Downloads/data/CCD"
```

The tool will:
- Read CCD XML files from the directory
- **Delete previous `output/` and `logs/` directories**
- Create fresh `output/`, `database/`, `logs/` subdirectories
- Preserve folder structure in output

## What Gets Sanitized

### Patient Data (recordTarget)
- Patient ID (MRN) → `TX-{original}-{suffix}` format
- Names → Realistic fake names
- DOB → Coarsened to year only
- Addresses → Real TX addresses
- Phone numbers → TX area codes
- Email → Fake email addresses

### Guardians/Parents
- Names → Fake names
- Addresses → Fake addresses
- Phone numbers → Fake numbers

### Providers/Authors
- Names → Fake provider names
- NPI → Fake NPI numbers
- Addresses → Fake addresses
- Phone numbers → Fake numbers
- Stored in database for consistency

### Organizations/Facilities
- Organization names → Fake facility names
- Addresses → Fake TX addresses
- Phone numbers → Fake numbers

### Dates (Safe Harbor Compliance)
- All dates coarsened to **year only** (YYYY)
- birthTime: 20190815 → 2019
- effectiveTime: 20210301 → 2021
- Maintains temporal relationships while removing specific dates

## Output Structure

```
/Users/leopak/Downloads/data/CCD/
├── original_file1.xml      # Your original CCD files
├── original_file2.xml
├── output/                 # ⚠️ DELETED each run
│   ├── ANON_original_file1.xml
│   └── ANON_original_file2.xml
├── database/              # ✅ Preserved (unless --clean-db)
│   └── phi_mapping.db
└── logs/                  # ⚠️ DELETED each run
    ├── sanitizer.log
    └── run_manifest_*.txt
```

## Database Consistency

The SQLite database ensures:
- Same patient → Same fake identity across ALL documents
- Same provider → Same fake provider
- Same organization → Same fake facility

**Database is preserved** between runs unless you use `--clean-db`

To start completely fresh:
```bash
python3 main.py --clean-db
```

## Document Type Detection

Automatically detects CDA document types:
- CCD (Continuity of Care Document)
- CDA (Clinical Document Architecture)
- CCDA (Consolidated CDA)

Uses templateId to identify document type.

## Supported Document Types

- **CCD** (Continuity of Care Document)
- **CDA** (Clinical Document Architecture - generic)
- **CCDA** (Consolidated CDA)

## Quality Assurance

Each run creates a manifest in `logs/run_manifest_*.txt` showing:
- Files processed
- Document types
- PHI elements replaced
- Database statistics

Compare input and output files to verify PHI removal.

## Troubleshooting

### No files found
Check `ROOT_DIR` in config.py matches your CCD file location

### Database issues
Use `--clean-db` to start fresh with new mappings

### Processing errors
Check `logs/sanitizer.log` for detailed error messages

### XML parsing errors
Ensure files are valid HL7 v3 CDA/CCD XML documents

## Technical Details

- **Language:** Python 3.9+
- **Dependencies:** faker
- **Database:** SQLite
- **Document Format:** HL7 v3 CDA/CCD XML
- **Standards:** HL7 v3, HIPAA Safe Harbor compliance

## Safe Harbor Compliance

This tool follows HIPAA Safe Harbor de-identification guidelines:

✓ **Names** - Replaced with fake names
✓ **Geographic subdivisions** - Replaced with TX locations (ZIP codes preserved for 3-digit only)
✓ **Dates** - All dates coarsened to year only
✓ **Phone/Fax** - Replaced with fake TX numbers
✓ **Email** - Replaced with fake emails
✓ **Medical record numbers** - Transformed to TX-{original}-{suffix}
✓ **Account numbers** - Replaced with fake IDs
✓ **Device IDs** - Organization IDs replaced
✓ **URLs** - Email/web addresses replaced

## License

Internal use only - Interstella Technology Inc.
