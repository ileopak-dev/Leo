"""
HL7 v2.x Message Parser
Handles pipe-delimited HL7 messages (ADT, ORU, MDM, VXU, TRN)
"""
import re
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class HL7Field:
    """Represents an HL7 field location"""
    segment: str
    field_num: int
    component_num: int = 0
    value: str = ""


class HL7Parser:
    """Parse HL7 v2.x pipe-delimited messages"""
    
    def __init__(self, message: str):
        self.raw_message = message
        self.segments = {}
        self.message_type = None
        self.version = None
        self._parse()
    
    def _parse(self):
        """Parse message into segments"""
        lines = self.raw_message.strip().split('\n')
        
        for line in lines:
            if not line.strip():
                continue
            
            # Split by pipe, but handle MSH specially (MSH has encoding chars in position 1-2)
            if line.startswith('MSH'):
                segment_name = 'MSH'
                # MSH can be in two formats:
                # Format 1: MSH|^~\&|field3|field4... (pipe after MSH)
                # Format 2: MSH^~\&|field3|field4... (NO pipe, encoding chars attached to MSH)
                
                parts = line.split('|')
                
                if parts[0] == 'MSH':
                    # Format 1: MSH|^~\&|...
                    # parts = ['MSH', '^~\&', 'field3', ...]
                    # Build: ['MSH', '|', '^~\&', 'field3', ...]
                    if len(parts) > 1:
                        fields = ['MSH', '|', parts[1]] + parts[2:]
                    else:
                        fields = ['MSH', '|', '^~\\&']
                else:
                    # Format 2: MSH^~\&|...
                    # parts[0] = 'MSH^~\&', parts[1] = 'field3', ...
                    # Extract encoding chars and build: ['MSH', '|', '^~\&', 'field3', ...]
                    encoding_chars = parts[0][3:] if len(parts[0]) > 3 else '^~\\&'
                    fields = ['MSH', '|', encoding_chars] + parts[1:]
            else:
                parts = line.split('|')
                segment_name = parts[0]
                fields = parts
            
            # Store segment (handle multiple instances like NK1, IN1)
            if segment_name not in self.segments:
                self.segments[segment_name] = []
            self.segments[segment_name].append(fields)
        
        # Extract message type and version
        self._extract_metadata()
        
        logger.debug(f"Parsed HL7 message: {self.message_type} v{self.version}")
        logger.debug(f"Segments found: {list(self.segments.keys())}")
    
    def _extract_metadata(self):
        """Extract message type and version from MSH"""
        if 'MSH' in self.segments:
            msh = self.segments['MSH'][0]
            
            # Valid HL7 v2.x message types we support
            valid_types = ['ADT', 'ORU', 'MDM', 'VXU', 'TRN']
            
            # MSH-9: Message Type (e.g., ADT^A08) - standard position
            # Some systems put it in MSH-10 or MSH-11, so check multiple positions
            msg_type_field = None
            
            # Try MSH-9, MSH-10, MSH-11 in order, looking for valid message types
            for field_num in [9, 10, 11]:
                if len(msh) > field_num and msh[field_num]:
                    candidate = str(msh[field_num])
                    # Check if it contains a valid message type
                    if '^' in candidate:
                        msg_prefix = candidate.split('^')[0]
                        if msg_prefix in valid_types:
                            msg_type_field = candidate
                            if field_num != 9:
                                logger.debug(f"Non-standard MSH: message type found in MSH-{field_num} instead of MSH-9")
                            break
            
            if msg_type_field:
                if '^' in msg_type_field:
                    parts = msg_type_field.split('^')
                    self.message_type = f"{parts[0]}^{parts[1]}"
                else:
                    self.message_type = msg_type_field
            else:
                # Could not detect valid message type
                logger.warning("Could not detect valid message type from MSH segment")
                self.message_type = "UNKNOWN"
            
            # MSH-12 or MSH-13: Version (e.g., 2.3.1) - position may vary
            # Try both positions due to non-standard messages
            for ver_pos in [12, 13, 14]:
                if len(msh) > ver_pos and msh[ver_pos]:
                    ver_str = str(msh[ver_pos])
                    # Check if it looks like a version (contains dots)
                    if '.' in ver_str and ver_str[0].isdigit():
                        self.version = ver_str
                        break
    
    def get_field(self, segment: str, field_num: int, component_num: int = 0, 
                  instance: int = 0) -> Optional[str]:
        """
        Get field value from message
        segment: Segment name (e.g., 'PID')
        field_num: Field number (1-based)
        component_num: Component number within field (0 = entire field)
        instance: Which instance of repeating segment (0-based)
        """
        if segment not in self.segments:
            return None
        
        if instance >= len(self.segments[segment]):
            return None
        
        seg_data = self.segments[segment][instance]
        
        if field_num >= len(seg_data):
            return None
        
        field_value = seg_data[field_num]
        
        # If component requested, split by ^
        if component_num > 0 and '^' in field_value:
            components = field_value.split('^')
            if component_num <= len(components):
                return components[component_num - 1]
            return None
        
        return field_value
    
    def get_all_instances(self, segment: str) -> List[List[str]]:
        """Get all instances of a repeating segment"""
        return self.segments.get(segment, [])
    
    def extract_phi(self) -> Dict[str, any]:
        """
        Extract all PHI from the message
        Returns structured PHI data
        """
        phi_data = {
            'patients': [],
            'providers': [],
            'organizations': [],
            'contacts': []
        }
        
        # Extract patient data from PID
        if 'PID' in self.segments:
            patient = self._extract_patient_from_pid()
            if patient:
                phi_data['patients'].append(patient)
        
        # Extract contacts from NK1
        if 'NK1' in self.segments:
            for nk1 in self.get_all_instances('NK1'):
                contact = self._extract_contact_from_nk1(nk1)
                if contact:
                    phi_data['contacts'].append(contact)
        
        # Extract providers from PV1, OBR, etc.
        providers = self._extract_providers()
        phi_data['providers'].extend(providers)
        
        # Extract organizations
        orgs = self._extract_organizations()
        phi_data['organizations'].extend(orgs)
        
        logger.info(f"Extracted PHI: {len(phi_data['patients'])} patients, "
                   f"{len(phi_data['providers'])} providers, "
                   f"{len(phi_data['organizations'])} organizations")
        
        return phi_data
    
    def _extract_patient_from_pid(self) -> Optional[Dict]:
        """Extract patient information from PID segment"""
        # PID-3: Patient ID (MRN)
        mrn = self.get_field('PID', 3, 0)
        if '^' in mrn:
            mrn = mrn.split('^')[0]  # Take first component
        
        # PID-5: Patient Name (Last^First^Middle)
        name = self.get_field('PID', 5, 0)
        last_name = self.get_field('PID', 5, 1) or ""
        first_name = self.get_field('PID', 5, 2) or ""
        middle_name = self.get_field('PID', 5, 3) or ""
        
        # PID-7: Date of Birth (YYYYMMDD)
        dob = self.get_field('PID', 7, 0)
        
        # PID-11: Address
        street = self.get_field('PID', 11, 1) or ""
        city = self.get_field('PID', 11, 3) or ""
        state = self.get_field('PID', 11, 4) or ""
        zip_code = self.get_field('PID', 11, 5) or ""
        
        # PID-13: Phone numbers
        phones = []
        phone = self.get_field('PID', 13, 0)
        if phone:
            phones.append(phone)
        
        # PID-19: SSN
        ssn = self.get_field('PID', 19, 0)
        
        patient = {
            'mrn': mrn,
            'first_name': first_name,
            'last_name': last_name,
            'middle_name': middle_name,
            'full_name': name,
            'dob': dob,
            'ssn': ssn,
            'address': {
                'street': street,
                'city': city,
                'state': state,
                'zip': zip_code
            },
            'phones': phones
        }
        
        logger.debug(f"Extracted patient: {last_name}, {first_name} | MRN: {mrn}")
        
        return patient
    
    def _extract_contact_from_nk1(self, nk1_segment: List[str]) -> Optional[Dict]:
        """Extract next-of-kin/contact from NK1 segment"""
        if len(nk1_segment) < 2:
            return None
        
        # NK1-2: Name
        name = nk1_segment[2] if len(nk1_segment) > 2 else ""
        if '^' in name:
            parts = name.split('^')
            last_name = parts[0] if len(parts) > 0 else ""
            first_name = parts[1] if len(parts) > 1 else ""
        else:
            last_name = name
            first_name = ""
        
        # NK1-4: Address
        address = nk1_segment[4] if len(nk1_segment) > 4 else ""
        
        # NK1-5: Phone
        phone = nk1_segment[5] if len(nk1_segment) > 5 else ""
        
        return {
            'first_name': first_name,
            'last_name': last_name,
            'full_name': name,
            'address': address,
            'phone': phone
        }
    
    def _extract_providers(self) -> List[Dict]:
        """Extract provider information from various segments"""
        providers = []
        
        # PV1-7: Attending Doctor
        # PV1-8: Referring Doctor
        # PV1-9: Consulting Doctor
        if 'PV1' in self.segments:
            for field_num in [7, 8, 9, 17]:  # Common provider fields
                provider_field = self.get_field('PV1', field_num, 0)
                if provider_field and '^' in provider_field:
                    provider = self._parse_provider_field(provider_field)
                    if provider:
                        providers.append(provider)
        
        # OBR: Ordering provider, result copier
        if 'OBR' in self.segments:
            for obr in self.get_all_instances('OBR'):
                if len(obr) > 16:
                    provider = self._parse_provider_field(obr[16])
                    if provider:
                        providers.append(provider)
        
        return providers
    
    def _parse_provider_field(self, field: str) -> Optional[Dict]:
        """Parse provider from field like: ID^Last^First^MI^^^^^NPI"""
        if not field or '^' not in field:
            return None
        
        parts = field.split('^')
        
        provider_id = parts[0] if len(parts) > 0 else ""
        last_name = parts[1] if len(parts) > 1 else ""
        first_name = parts[2] if len(parts) > 2 else ""
        
        # NPI often in position 9 or later
        npi = ""
        for i in range(8, len(parts)):
            if parts[i] and parts[i].isdigit() and len(parts[i]) == 10:
                npi = parts[i]
                break
        
        if last_name or first_name:
            return {
                'provider_id': provider_id,
                'first_name': first_name,
                'last_name': last_name,
                'npi': npi,
                'full_field': field
            }
        
        return None
    
    def _extract_organizations(self) -> List[Dict]:
        """Extract organization/facility information"""
        orgs = []
        
        # MSH-4: Sending Facility
        sending_facility = self.get_field('MSH', 4, 0)
        if sending_facility:
            orgs.append({
                'name': sending_facility,
                'type': 'sending_facility'
            })
        
        # PV1-3: Assigned Patient Location (includes facility)
        # PV1-39: Servicing Facility
        if 'PV1' in self.segments:
            facility = self.get_field('PV1', 39, 0)
            if facility:
                orgs.append({
                    'name': facility,
                    'type': 'servicing_facility'
                })
        
        return orgs
    
    def replace_field(self, segment: str, field_num: int, new_value: str, 
                     component_num: int = 0, instance: int = 0):
        """Replace a field value in the message"""
        if segment not in self.segments:
            return
        
        if instance >= len(self.segments[segment]):
            return
        
        seg_data = self.segments[segment][instance]
        
        if field_num >= len(seg_data):
            return
        
        if component_num == 0:
            # Replace entire field
            seg_data[field_num] = new_value
        else:
            # Replace component
            field_value = seg_data[field_num]
            components = field_value.split('^')
            if component_num <= len(components):
                components[component_num - 1] = new_value
                seg_data[field_num] = '^'.join(components)
    
    def to_string(self) -> str:
        """Convert parsed message back to HL7 string"""
        lines = []
        
        for segment_name in self.segments:
            for seg_data in self.segments[segment_name]:
                if segment_name == 'MSH':
                    # Special handling for MSH
                    # MSH structure: ['MSH', '|', '^~\&', 'field3', 'field4', ...]
                    # Output: MSH|^~\&|field3|field4|...
                    line = seg_data[0] + seg_data[1] + seg_data[2] + '|' + '|'.join(seg_data[3:])
                else:
                    line = '|'.join(seg_data)
                lines.append(line)
        
        return '\n'.join(lines)
