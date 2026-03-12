#!/usr/bin/env python3
"""
Video to Audio Converter
Converts all videos in a folder (and subfolders) to audio files,
maintaining the same folder structure.
"""

import os
import subprocess
from pathlib import Path

# Supported video formats
VIDEO_EXTENSIONS = {'.mkv', '.mp4', '.webm', '.avi', '.mov', '.flv', '.wmv', '.m4v', '.mpeg', '.mpg'}

def check_ffmpeg():
    """Check if ffmpeg is installed"""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def convert_video_to_audio(video_path, audio_path):
    """Convert a single video file to audio using ffmpeg"""
    try:
        # Create the output directory if it doesn't exist
        audio_path.parent.mkdir(parents=True, exist_ok=True)

        # Convert video to audio (mp3 format, 32kbps mono — optimized for speech/Whisper)
        # -vn:      no video stream
        # -b:a 32k: 32kbps bitrate (sufficient for speech transcription)
        # -ac 1:    mono channel (halves file size, no quality loss for speech)
        # -y:       overwrite output if exists
        command = [
            'ffmpeg',
            '-i', str(video_path),
            '-vn',
            '-acodec', 'libmp3lame',
            '-b:a', '32k',
            '-ac', '1',
            '-y',
            str(audio_path)
        ]

        print(f"Converting: {video_path.name} -> {audio_path.name}")

        result = subprocess.run(
            command,
            capture_output=True,
            text=True
        )

        if result.returncode == 0:
            print(f"✓ Successfully converted: {video_path.name}")
            return True
        else:
            print(f"✗ Error converting {video_path.name}: {result.stderr}")
            return False

    except Exception as e:
        print(f"✗ Exception converting {video_path.name}: {str(e)}")
        return False

def process_folder(input_folder, output_folder):
    """Process all videos in the folder and subfolders"""
    input_path = Path(input_folder)
    output_path = Path(output_folder)

    if not input_path.exists():
        print(f"Error: Input folder '{input_folder}' does not exist!")
        return

    # Find all video files recursively — handles uppercase extensions (.MP4, .MKV, etc.)
    video_files = []
    for ext in VIDEO_EXTENSIONS:
        video_files.extend(
            p for p in input_path.rglob(f'*{ext}')
            if p.suffix.lower() == ext
        )

    if not video_files:
        print("No video files found in the specified folder!")
        return

    print(f"\nFound {len(video_files)} video file(s)")
    print(f"Output folder: {output_folder}\n")

    # Convert each video
    success_count = 0
    failed_count = 0

    for video_file in sorted(video_files):
        # Calculate relative path from input folder
        relative_path = video_file.relative_to(input_path)

        # Create corresponding audio path (change extension to .mp3)
        audio_file = output_path / relative_path.with_suffix('.mp3')

        # Convert the video
        if convert_video_to_audio(video_file, audio_file):
            success_count += 1
        else:
            failed_count += 1

        print()  # Empty line for readability

    # Summary
    print("=" * 60)
    print(f"Conversion complete!")
    print(f"Successfully converted: {success_count}")
    print(f"Failed:                 {failed_count}")
    print(f"Total:                  {len(video_files)}")
    print("=" * 60)

def main():
    """Main function"""
    print("=" * 60)
    print("Video to Audio Converter")
    print("=" * 60)
    print()

    # Check if ffmpeg is installed
    if not check_ffmpeg():
        print("Error: ffmpeg is not installed!")
        print("Please install ffmpeg first:")
        print("  - Ubuntu/Debian: sudo apt install ffmpeg")
        print("  - macOS:         brew install ffmpeg")
        print("  - Windows:       https://ffmpeg.org/download.html")
        return

    # Get input folder from user
    input_folder = input("Enter the path to the folder containing videos: ").strip()

    # Remove quotes if present (common when copying paths on Windows)
    input_folder = input_folder.strip('"').strip("'")

    if not input_folder:
        print("Error: No folder path provided!")
        return

    input_path = Path(input_folder)

    if not input_path.exists():
        print(f"Error: Folder '{input_folder}' does not exist!")
        return

    # Output folder = input folder name + "_audio"
    output_folder = f"{input_folder}_audio"

    print(f"\nInput folder:  {input_folder}")
    print(f"Output folder: {output_folder}")

    # Confirm with user
    confirm = input("\nProceed with conversion? (y/n): ").strip().lower()

    if confirm != 'y':
        print("Conversion cancelled.")
        return

    print()

    # Process the folder
    process_folder(input_folder, output_folder)

if __name__ == "__main__":
    main()
