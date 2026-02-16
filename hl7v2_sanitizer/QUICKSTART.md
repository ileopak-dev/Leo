# HL7 v2.x PHI Sanitization Tool

Sanitizes HL7 v2.x pipe-delimited messages (ADT, ORU, MDM, VXU, TRN) to remove Protected Health Information while maintaining data context and relationships.

## What This Tool Does

**Processes:** HL7 v2.x pipe-delimited messages only  
**Does NOT Process:** XML files, CCD documents, HL7 v3 (use separate HL7 v3 sanitizer)

## Quick Start

```bash
# Install dependencies
pip3 install -r requirements.txt

# Test with 3 random files
python3 main.py --count 3 --random

# Process all files
python3 main.py
```

## Configuration

Edit `config.py`:
```python
ROOT_DIR = "/Users/leopak/Downloads/data/data"
```

## Output Structure

```
/Users/leopak/Downloads/data/data/
├── ADT/                    # Your original files
├── ORU/
├── output/                 # Sanitized files
│   ├── ADT/
│   │   └── ADT_A08_file.txt
│   └── ORU/
│       └── ORU_R01_file.txt
├── database/              # Consistency mapping
│   └── phi_mapping.db
└── logs/                  # Processing logs
    └── run_manifest_*.txt
```

## See Full Documentation

See README.md for complete documentation including:
- Supported message types
- All PHI elements sanitized
- QA procedures
- Troubleshooting

## License
Internal use only - Interstella Technology Inc.
