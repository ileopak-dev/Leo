#!/usr/bin/env python3
"""
CCD/CDA PHI Sanitization Tool
Sanitizes HL7 v3 CDA/CCD XML documents to remove PHI while maintaining context
"""
import os
import sys
import argparse
import logging
import random
from datetime import datetime
from pathlib import Path
from typing import List, Dict

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

import config
from src.sanitizer import CCDSanitizer
from src.database import PHIDatabase


def setup_logging(log_level: str = config.LOG_LEVEL):
    """Setup logging configuration"""
    # Create logs directory
    os.makedirs(config.LOG_DIR, exist_ok=True)

    # Configure logging
    log_file = os.path.join(config.LOG_DIR, 'sanitizer.log')

    # Create formatters
    formatter = logging.Formatter(config.LOG_FORMAT, datefmt=config.DATE_FORMAT)

    # File handler
    file_handler = logging.FileHandler(log_file)
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.DEBUG)

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(getattr(logging, log_level))

    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    root_logger.addHandler(file_handler)

    if config.CONSOLE_OUTPUT:
        root_logger.addHandler(console_handler)

    return logging.getLogger(__name__)


def get_input_files(input_dir: str, count: int = None, random_select: bool = False,
                   specific_files: List[str] = None) -> List[str]:
    """
    Get list of input CCD files to process

    Args:
        input_dir: Directory containing input files
        count: Number of files to process (None = all)
        random_select: If True, randomly select files
        specific_files: List of specific filenames to process

    Returns:
        List of file paths
    """
    if specific_files:
        return [os.path.join(input_dir, f) for f in specific_files]

    # Get all supported files - RECURSIVELY search subdirectories
    all_files = []
    for ext in config.SUPPORTED_EXTENSIONS:
        pattern = f"**/*{ext}"  # ** means recursive search
        all_files.extend(Path(input_dir).rglob(f"*{ext}"))

    # Convert to strings and filter out hidden files/directories
    all_files = [str(f) for f in all_files if not any(part.startswith('.') for part in Path(f).parts)]

    # Filter out already anonymized files (starting with ANON_)
    all_files = [f for f in all_files if not os.path.basename(f).startswith('ANON_')]

    if not all_files:
        return []

    # Select files
    if count is None:
        # Process all
        return all_files

    if random_select:
        # Random selection
        return random.sample(all_files, min(count, len(all_files)))
    else:
        # First N files (alphabetically)
        all_files.sort()
        return all_files[:count]


def generate_output_filename(input_path: str, document_type: str, input_dir: str) -> str:
    """
    Generate output filename with ANON_ prefix
    Forces output to CCD subdirectory for organization
    Format: CCD/ANON_{original_stem}.xml
    """
    # Build standardized XML output filename regardless of input extension.
    filename = os.path.basename(input_path)
    stem, _ = os.path.splitext(filename)
    output_filename = f"ANON_{stem}.xml"

    # Force output to CCD subdirectory
    return os.path.join("CCD", output_filename)


def write_manifest(run_id: str, files_processed: List[Dict], stats: Dict):
    """Write processing manifest file"""
    manifest_file = os.path.join(config.LOG_DIR, f"run_manifest_{run_id}.txt")

    with open(manifest_file, 'w') as f:
        f.write("=" * 60 + "\n")
        f.write("CCD/CDA PHI SANITIZATION RUN\n")
        f.write("=" * 60 + "\n\n")

        f.write(f"Run ID: {run_id}\n")
        f.write(f"Mode: {stats['mode']}\n")
        f.write(f"Root Directory: {config.ROOT_DIR}\n")
        f.write(f"Started: {stats['start_time']}\n")
        f.write(f"Completed: {stats['end_time']}\n")
        f.write(f"Duration: {stats['duration_seconds']} seconds\n\n")

        success_count = sum(1 for f in files_processed if f['status'] == 'success')
        fail_count = len(files_processed) - success_count

        f.write(f"FILES PROCESSED ({success_count} of {len(files_processed)} succeeded):\n\n")

        for i, file_info in enumerate(files_processed, 1):
            status_icon = "✓" if file_info['status'] == 'success' else "✗"

            f.write(f"{i}. {status_icon} {file_info['output_filename']}\n")
            f.write(f"   Original: {os.path.basename(file_info['input_path'])}\n")
            f.write(f"   Type: {file_info['message_type']}\n")
            f.write(f"   PHI Replaced: {file_info['phi_count']} elements\n")

            if file_info['status'] != 'success':
                f.write(f"   Error: {file_info.get('error', 'Unknown error')}\n")

            f.write("\n")

        # Database summary
        f.write("=" * 60 + "\n")
        f.write("DATABASE SUMMARY\n")
        f.write("=" * 60 + "\n")

        db_stats = stats.get('db_stats', {})
        f.write(f"Total Patients: {db_stats.get('patients', 0)}\n")
        f.write(f"Total Organizations: {db_stats.get('organizations', 0)}\n")
        f.write(f"Total Providers: {db_stats.get('providers', 0)}\n\n")

        # QA instructions
        f.write("=" * 60 + "\n")
        f.write("QA INSTRUCTIONS\n")
        f.write("=" * 60 + "\n")
        f.write("Compare these file pairs to verify PHI removal:\n\n")

        for i, file_info in enumerate(files_processed, 1):
            if file_info['status'] == 'success':
                f.write(f"{i}. {os.path.basename(file_info['input_path'])} → ")
                f.write(f"output/{file_info['output_filename']}\n")

        f.write("\n")

    return manifest_file


def cleanup_previous_run(output_subdirs=None):
    """Delete only selected output subdirectories from previous runs."""
    import shutil

    if output_subdirs is None:
        output_subdirs = []

    # Delete only targeted output subdirectories.
    for subdir in sorted(set(output_subdirs)):
        target = os.path.join(config.OUTPUT_DIR, subdir)
        if os.path.exists(target):
            print(f"Cleaning up previous output subdirectory: {target}")
            shutil.rmtree(target)

    print()


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Sanitize CCD/CDA XML files to remove PHI while maintaining context'
    )

    parser.add_argument('--count', type=int, default=None,
                       help='Number of files to process (default: all)')

    parser.add_argument('--random', action='store_true',
                       help='Randomly select files (default: alphabetical order)')

    parser.add_argument('--files', nargs='+', default=None,
                       help='Specific files to process')

    parser.add_argument('--dry-run', action='store_true',
                       help='Show what would be processed without actually doing it')

    parser.add_argument('--verbose', action='store_true',
                       help='Enable verbose DEBUG logging')

    parser.add_argument('--clean-db', action='store_true',
                       help='Delete database before starting (fresh mappings)')

    args = parser.parse_args()

    # Clean database if requested
    if args.clean_db:
        if os.path.exists(config.DB_FILE):
            print(f"Deleting database for fresh start: {config.DB_FILE}")
            os.remove(config.DB_FILE)
            print()

    # Setup logging
    log_level = 'DEBUG' if args.verbose else config.LOG_LEVEL
    logger = setup_logging(log_level)

    logger.info("=" * 60)
    logger.info("CCD/CDA PHI SANITIZATION TOOL")
    logger.info("=" * 60)

    # Create run ID
    run_id = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    start_time = datetime.now()

    # Get input files
    input_files = get_input_files(
        config.INPUT_DIR,
        count=args.count,
        random_select=args.random,
        specific_files=args.files
    )

    if not input_files:
        logger.error(f"No CCD/CDA files found in {config.INPUT_DIR}")
        return 1

    # Determine mode
    if args.count:
        mode = f"{'RANDOM' if args.random else 'FIRST'} selection ({args.count} files)"
    elif args.files:
        mode = f"SPECIFIC files ({len(args.files)} files)"
    else:
        mode = f"ALL files ({len(input_files)} files)"

    logger.info(f"Mode: {mode}")
    logger.info(f"Input directory: {config.INPUT_DIR}")
    logger.info(f"Output directory: {config.OUTPUT_DIR}")
    logger.info(f"Files to process: {len(input_files)}")

    if args.dry_run:
        logger.info("\n*** DRY RUN MODE - No files will be modified ***\n")
        logger.info("Files that would be processed:")
        for i, f in enumerate(input_files, 1):
            logger.info(f"  {i}. {os.path.basename(f)}")
        return 0

    # Clean up previous run output for CCD only.
    cleanup_previous_run(output_subdirs=["CCD"])

    # Create output directory
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)
    os.makedirs(config.DB_DIR, exist_ok=True)

    # Initialize sanitizer
    sanitizer = CCDSanitizer(config.DB_FILE)

    # Process files
    files_processed = []

    for i, input_path in enumerate(input_files, 1):
        logger.info(f"\n[{i}/{len(input_files)}] Processing: {os.path.basename(input_path)}")

        try:
            result = sanitizer.sanitize_file(input_path, "temp_output.xml")

            # Generate proper output filename (preserves subdirectory structure)
            output_filename = generate_output_filename(input_path, result['message_type'], config.INPUT_DIR)
            output_path = os.path.join(config.OUTPUT_DIR, output_filename)

            # Create subdirectories in output if needed
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # Move temp file to proper location
            os.rename("temp_output.xml", output_path)

            files_processed.append({
                'input_path': input_path,
                'output_path': output_path,
                'output_filename': output_filename,
                'message_type': result['message_type'],
                'phi_count': result['phi_count'],
                'status': 'success'
            })

            logger.info(f"✓ Success: {output_filename}")

        except Exception as e:
            logger.error(f"✗ Failed: {str(e)}", exc_info=True)
            files_processed.append({
                'input_path': input_path,
                'output_path': '',
                'output_filename': os.path.basename(input_path),
                'message_type': 'UNKNOWN',
                'phi_count': 0,
                'status': 'failed',
                'error': str(e)
            })

    # Get database stats
    db_stats = sanitizer.db.get_stats()

    # Close sanitizer
    sanitizer.close()

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    # Write manifest
    stats = {
        'mode': mode,
        'start_time': start_time.strftime("%Y-%m-%d %H:%M:%S"),
        'end_time': end_time.strftime("%Y-%m-%d %H:%M:%S"),
        'duration_seconds': int(duration),
        'db_stats': db_stats
    }

    manifest_file = write_manifest(run_id, files_processed, stats)

    # Summary
    success_count = sum(1 for f in files_processed if f['status'] == 'success')
    fail_count = len(files_processed) - success_count

    logger.info("\n" + "=" * 60)
    logger.info("PROCESSING COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total files: {len(files_processed)}")
    logger.info(f"Successful: {success_count}")
    logger.info(f"Failed: {fail_count}")
    logger.info(f"Duration: {int(duration)} seconds")
    logger.info(f"\nManifest: {manifest_file}")
    logger.info(f"Database: {config.DB_FILE}")
    logger.info("=" * 60)

    return 0 if fail_count == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
