"""
Database management for PHI mapping
Maintains consistent mapping between real PHI and sanitized data
"""
import sqlite3
import hashlib
import logging
from typing import Any, Dict, Optional

try:
    import config as _project_config
except ImportError:  # pragma: no cover - shared core may be used outside project trees
    _project_config = None

logger = logging.getLogger(__name__)
_DEFAULT_DB_PATH = getattr(_project_config, "DB_FILE", None)


class PHIDatabase:
    """Manages SQLite database for PHI mapping"""
    
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or _DEFAULT_DB_PATH
        if not self.db_path:
            raise ValueError("db_path is required when config.DB_FILE is unavailable")
        self.conn = None
        self._ensure_database_exists()
    
    def _ensure_database_exists(self):
        """Create database and tables if they don't exist"""
        import os
        db_dir = os.path.dirname(self.db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._create_tables()
        logger.info(f"Database initialized: {self.db_path}")
    
    def _create_tables(self):
        """Create all database tables"""
        cursor = self.conn.cursor()
        
        # Patients table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_name_hash TEXT UNIQUE NOT NULL,
                fake_first_name TEXT NOT NULL,
                fake_last_name TEXT NOT NULL,
                fake_dob TEXT NOT NULL,
                fake_ssn TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Organizations table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_org_hash TEXT UNIQUE NOT NULL,
                fake_org_name TEXT NOT NULL,
                fake_org_id TEXT,
                fake_address TEXT NOT NULL,
                fake_city TEXT NOT NULL,
                fake_state TEXT NOT NULL,
                fake_zip TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Providers table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS providers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_provider_hash TEXT UNIQUE NOT NULL,
                fake_first_name TEXT NOT NULL,
                fake_last_name TEXT NOT NULL,
                fake_npi TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Patient-Organization-MRN mapping
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS patient_org_mrn (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                org_id INTEGER NOT NULL,
                original_mrn_hash TEXT NOT NULL,
                fake_mrn TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(id),
                FOREIGN KEY (org_id) REFERENCES organizations(id),
                UNIQUE(patient_id, org_id)
            )
        """)
        
        # Create indexes for faster lookups
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_patients_hash 
            ON patients(original_name_hash)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_orgs_hash 
            ON organizations(original_org_hash)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_providers_hash 
            ON providers(original_provider_hash)
        """)

        # Backward-compatible schema migration for existing databases.
        self._ensure_organization_schema(cursor)
        
        self.conn.commit()
        logger.debug("Database tables created/verified")

    def _ensure_organization_schema(self, cursor):
        """Ensure organizations table has columns required by current code."""
        cursor.execute("PRAGMA table_info(organizations)")
        columns = {row[1] for row in cursor.fetchall()}
        if "fake_org_id" not in columns:
            cursor.execute("ALTER TABLE organizations ADD COLUMN fake_org_id TEXT")

    @staticmethod
    def _stable_org_id(org_hash: str) -> str:
        """Generate a deterministic org identifier from the org hash."""
        return f"ORG-{org_hash[:8].upper()}"
    
    @staticmethod
    def hash_value(value: str) -> str:
        """Create SHA256 hash of a value"""
        return hashlib.sha256(value.encode('utf-8')).hexdigest()

    def _organization_hash(self, original_name: str, original_identity: str = "") -> str:
        """Build the canonical hash key for organization mappings."""
        source_identity = original_identity or original_name
        return self.hash_value(f"{original_name}|{source_identity}")

    def _normalize_org_payload(self, org_data: Dict[str, Any], org_hash: str) -> Dict[str, Any]:
        """Normalize organization payloads from both v2 and v3 sanitizers."""
        address = org_data.get('address')
        if isinstance(address, dict):
            street = address.get('street', '')
            city = address.get('city', '')
            state = address.get('state', '')
            zip_code = address.get('zip', '')
            latitude = address.get('latitude')
            longitude = address.get('longitude')
        else:
            street = org_data.get('address') or org_data.get('street', '')
            city = org_data.get('city', '')
            state = org_data.get('state', '')
            zip_code = org_data.get('zip', '')
            latitude = org_data.get('latitude')
            longitude = org_data.get('longitude')

        return {
            'name': org_data.get('name', ''),
            'fake_org_id': (
                org_data.get('org_id')
                or org_data.get('facility_id')
                or self._stable_org_id(org_hash)
            ),
            'street': street,
            'city': city,
            'state': state,
            'zip': zip_code,
            'latitude': latitude,
            'longitude': longitude,
        }
    
    def get_or_create_patient(self, original_name: str, original_dob: str, 
                              fake_data: Dict[str, str]) -> int:
        """
        Get existing patient or create new one
        Returns patient_id
        """
        # Create hash from name + DOB for uniqueness
        hash_value = self.hash_value(f"{original_name}|{original_dob}")
        
        cursor = self.conn.cursor()
        cursor.execute("SELECT id FROM patients WHERE original_name_hash = ?", (hash_value,))
        result = cursor.fetchone()
        
        if result:
            logger.debug(f"Found existing patient: {hash_value[:8]}...")
            return result['id']
        
        # Create new patient
        cursor.execute("""
            INSERT INTO patients (original_name_hash, fake_first_name, fake_last_name, 
                                 fake_dob, fake_ssn)
            VALUES (?, ?, ?, ?, ?)
        """, (hash_value, fake_data['first_name'], fake_data['last_name'],
              fake_data['dob'], fake_data['ssn']))
        
        self.conn.commit()
        patient_id = cursor.lastrowid
        logger.info(f"Created new patient: {fake_data['first_name']} {fake_data['last_name']}")
        return patient_id
    
    def get_patient_by_hash(self, name_hash: str) -> Optional[Dict[str, str]]:
        """Get patient data by hash"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT fake_first_name, fake_last_name, fake_dob, fake_ssn 
            FROM patients WHERE original_name_hash = ?
        """, (name_hash,))
        result = cursor.fetchone()
        
        if result:
            # Return with same keys as generator for consistency
            return {
                'first_name': result['fake_first_name'],
                'last_name': result['fake_last_name'],
                'dob': result['fake_dob'],
                'ssn': result['fake_ssn']
            }
        return None
    
    def get_or_create_organization(self, original_org_name: str, original_identity: str,
                                   fake_data: Dict[str, str]) -> int:
        """Get existing organization or create new one"""
        hash_value = self._organization_hash(original_org_name, original_identity)
        
        cursor = self.conn.cursor()
        cursor.execute("SELECT id FROM organizations WHERE original_org_hash = ?", (hash_value,))
        result = cursor.fetchone()
        
        if result:
            logger.debug(f"Found existing organization: {hash_value[:8]}...")
            return result['id']
        
        normalized = self._normalize_org_payload(fake_data, hash_value)

        # Create new organization
        cursor.execute("""
            INSERT INTO organizations (original_org_hash, fake_org_name, fake_org_id, fake_address,
                                      fake_city, fake_state, fake_zip, latitude, longitude)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            hash_value,
            normalized['name'],
            normalized['fake_org_id'],
            normalized['street'],
            normalized['city'],
            normalized['state'],
            normalized['zip'],
            normalized['latitude'],
            normalized['longitude'],
        ))
        
        self.conn.commit()
        org_id = cursor.lastrowid
        logger.info(f"Created new organization: {normalized['name']}")
        return org_id
    
    def get_or_create_provider(self, original_name: str, original_npi: str,
                               fake_data: Dict[str, str]) -> int:
        """Get existing provider or create new one"""
        hash_value = self.hash_value(f"{original_name}|{original_npi}")
        
        cursor = self.conn.cursor()
        cursor.execute("SELECT id FROM providers WHERE original_provider_hash = ?", (hash_value,))
        result = cursor.fetchone()
        
        if result:
            logger.debug(f"Found existing provider: {hash_value[:8]}...")
            return result['id']
        
        # Create new provider
        cursor.execute("""
            INSERT INTO providers (original_provider_hash, fake_first_name, 
                                  fake_last_name, fake_npi)
            VALUES (?, ?, ?, ?)
        """, (hash_value, fake_data['first_name'], fake_data['last_name'], 
              fake_data['npi']))
        
        self.conn.commit()
        provider_id = cursor.lastrowid
        logger.info(f"Created new provider: {fake_data['first_name']} {fake_data['last_name']}")
        return provider_id
    
    def save_provider(self, provider_key: str, provider_data: Dict[str, str]) -> int:
        """Save provider mapping"""
        hash_value = self.hash_value(provider_key)
        
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO providers (original_provider_hash, fake_first_name, 
                                  fake_last_name, fake_npi)
            VALUES (?, ?, ?, ?)
        """, (hash_value, provider_data['first_name'], provider_data['last_name'], 
              provider_data.get('npi', '')))
        
        self.conn.commit()
        provider_id = cursor.lastrowid
        logger.info(f"Saved provider: {provider_data['first_name']} {provider_data['last_name']}")
        return provider_id
    
    def get_provider_by_hash(self, provider_key: str) -> Optional[Dict[str, str]]:
        """Get provider data by hash"""
        hash_value = self.hash_value(provider_key)
        
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT fake_first_name, fake_last_name, fake_npi
            FROM providers WHERE original_provider_hash = ?
        """, (hash_value,))
        result = cursor.fetchone()
        
        if result:
            return {
                'first_name': result['fake_first_name'],
                'last_name': result['fake_last_name'],
                'npi': result['fake_npi']
            }
        
        return None
    
    
    def get_or_create_mrn(self, patient_id: int, org_id: int, 
                         original_mrn: str, fake_mrn: str) -> str:
        """Get existing MRN mapping or create new one"""
        mrn_hash = self.hash_value(original_mrn)
        
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT fake_mrn FROM patient_org_mrn 
            WHERE patient_id = ? AND org_id = ?
        """, (patient_id, org_id))
        result = cursor.fetchone()
        
        if result:
            existing_mrn = result['fake_mrn']
            # Upgrade legacy mappings that still include raw original MRN tokens.
            if original_mrn and existing_mrn and original_mrn in existing_mrn:
                cursor.execute("""
                    UPDATE patient_org_mrn
                    SET original_mrn_hash = ?, fake_mrn = ?
                    WHERE patient_id = ? AND org_id = ?
                """, (mrn_hash, fake_mrn, patient_id, org_id))
                self.conn.commit()
                logger.info(
                    f"Upgraded legacy MRN mapping for patient_id={patient_id}, org_id={org_id}"
                )
                return fake_mrn

            logger.debug(f"Found existing MRN mapping: {existing_mrn}")
            return existing_mrn
        
        # Create new mapping
        cursor.execute("""
            INSERT INTO patient_org_mrn (patient_id, org_id, original_mrn_hash, fake_mrn)
            VALUES (?, ?, ?, ?)
        """, (patient_id, org_id, mrn_hash, fake_mrn))
        
        self.conn.commit()
        logger.info(f"Created new MRN mapping: {fake_mrn}")
        return fake_mrn
    
    def save_organization(self, original_name: str, org_data: Dict[str, str], original_identity: str = "") -> int:
        """Save organization mapping"""
        org_hash = self._organization_hash(original_name, original_identity)
        normalized = self._normalize_org_payload(org_data, org_hash)
        
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO organizations 
            (original_org_hash, fake_org_name, fake_org_id, fake_address, fake_city, fake_state, fake_zip, latitude, longitude)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            org_hash,
            normalized['name'],
            normalized['fake_org_id'],
            normalized['street'],
            normalized['city'],
            normalized['state'],
            normalized['zip'],
            normalized['latitude'],
            normalized['longitude'],
        ))
        
        self.conn.commit()
        org_id = cursor.lastrowid
        logger.info(f"Saved organization: {normalized['name']} (ID: {org_id})")
        return org_id
    
    def get_organization_by_hash(self, original_name: str, original_identity: str = "") -> Optional[Dict[str, str]]:
        """Get organization data by hash"""
        org_hash = self._organization_hash(original_name, original_identity)
        
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT id, fake_org_name, fake_org_id, fake_address, fake_city, fake_state, fake_zip
            FROM organizations WHERE original_org_hash = ?
        """, (org_hash,))
        result = cursor.fetchone()
        
        if result:
            facility_id = result['fake_org_id'] or self._stable_org_id(org_hash)
            if not result['fake_org_id']:
                cursor.execute(
                    "UPDATE organizations SET fake_org_id = ? WHERE id = ?",
                    (facility_id, result['id'])
                )
                self.conn.commit()
            
            return {
                'name': result['fake_org_name'],
                'facility_id': facility_id,
                'address': {
                    'street': result['fake_address'],
                    'city': result['fake_city'],
                    'state': result['fake_state'],
                    'zip': result['fake_zip']
                }
            }
        
        return None

    def get_organization_id_by_hash(self, original_name: str, original_identity: str = "") -> Optional[int]:
        """Get database organization row id for a source org key."""
        org_hash = self._organization_hash(original_name, original_identity)
        cursor = self.conn.cursor()
        cursor.execute("SELECT id FROM organizations WHERE original_org_hash = ?", (org_hash,))
        result = cursor.fetchone()
        return result['id'] if result else None
    
    def get_stats(self) -> Dict[str, int]:
        """Get database statistics"""
        cursor = self.conn.cursor()
        
        stats = {}
        cursor.execute("SELECT COUNT(*) as count FROM patients")
        stats['patients'] = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM organizations")
        stats['organizations'] = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM providers")
        stats['providers'] = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM patient_org_mrn")
        stats['mrn_mappings'] = cursor.fetchone()['count']
        
        return stats
    
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            logger.debug("Database connection closed")
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
