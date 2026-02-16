"""Compatibility wrapper to use shared database core across v2 and v3 projects."""

import sys
from pathlib import Path

# Shared package lives one level above both projects: /Users/leopak/Downloads/sanitizer_core
_shared_parent = Path(__file__).resolve().parents[2]
if str(_shared_parent) not in sys.path:
    sys.path.insert(0, str(_shared_parent))

from sanitizer_core.database import PHIDatabase  # noqa: E402

__all__ = ["PHIDatabase"]
