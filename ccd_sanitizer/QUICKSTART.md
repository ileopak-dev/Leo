# CCD Sanitizer - Quick Start Guide

## 5-Minute Setup

### 1. Install Dependencies
```bash
cd /Users/leopak/Downloads/ccd_sanitizer
pip3 install -r requirements.txt
```

### 2. Configure Your CCD Directory
Edit `config.py`:
```python
ROOT_DIR = "/Users/leopak/Downloads/data/CCD"
```

### 3. Test with Sample Files
```bash
# Process 3 random CCD files
python3 main.py --count 3 --random
```

### 4. Check Results
```
/Users/leopak/Downloads/data/CCD/
├── output/              # Sanitized CCD files with ANON_ prefix
├── logs/                # Processing logs and manifest
└── database/            # Mapping database for consistency
```

## Common Commands

```bash
# Process all CCD files
python3 main.py

# Process 10 random files
python3 main.py --count 10 --random

# Process specific files
python3 main.py --files patient1.xml patient2.xml

# See what would be processed (no changes)
python3 main.py --count 5 --dry-run

# Fresh start with new mappings
python3 main.py --clean-db

# Verbose output for debugging
python3 main.py --verbose --count 2
```

## Output Files

Each CCD file is sanitized and saved with `ANON_` prefix:
- `patient_ccd.xml` → `output/ANON_patient_ccd.xml`

## What Gets Replaced

✓ Patient names, MRNs, addresses, phones
✓ Guardian/parent information
✓ Provider names, NPIs, addresses
✓ Organization names and addresses
✓ All dates coarsened to year-only (Safe Harbor)

## Verification

1. Check `logs/run_manifest_*.txt` for processing summary
2. Compare original vs sanitized files
3. Review `logs/sanitizer.log` for details

## Database Consistency

The database ensures:
- **Same patient** = Same fake identity across all documents
- **Same provider** = Same fake name across all documents
- **Same facility** = Same fake name across all documents

Database persists between runs unless you use `--clean-db`

## Need Help?

- Check `logs/sanitizer.log` for errors
- Use `--verbose` flag for detailed output
- Verify `ROOT_DIR` in `config.py` is correct
