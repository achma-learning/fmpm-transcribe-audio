#!/usr/bin/env python3
"""
Transcription Script
Reads config from .transcribe_config (written by transcribe_launcher.py)
or falls back to the values hardcoded below.
"""

import os
from pathlib import Path
from pydub import AudioSegment
from openai import OpenAI

# ── CONFIG DEFAULTS (fallback if launcher not used) ───────────────────────────
API_KEY       = "sk-your-key-here"   # ← updated by launcher if you choose "yes"
INPUT_FOLDER  = r"C:\path\to\your\main_folder"
OUTPUT_FOLDER = r"C:\path\to\output"
CHUNK_MINUTES = 20
# ─────────────────────────────────────────────────────────────────────────────


def load_config():
    """Load config written by the launcher GUI, if available."""
    global API_KEY, INPUT_FOLDER, OUTPUT_FOLDER
    config_path = Path(__file__).parent / ".transcribe_config"
    if config_path.exists():
        for line in config_path.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                if k.strip() == "API_KEY":
                    API_KEY = v.strip()
                elif k.strip() == "INPUT_FOLDER":
                    INPUT_FOLDER = v.strip()
                elif k.strip() == "OUTPUT_FOLDER":
                    OUTPUT_FOLDER = v.strip()
        print("✅  Config loaded from launcher.")
    else:
        print("ℹ️  No launcher config found — using hardcoded values.")


def split_audio(filepath, chunk_ms):
    audio = AudioSegment.from_mp3(filepath)
    audio = audio.set_channels(1)  # mono
    return [audio[i:i + chunk_ms] for i in range(0, len(audio), chunk_ms)]


def transcribe_file(mp3_path, out_dir, client):
    filename        = os.path.splitext(os.path.basename(mp3_path))[0]
    subfolder_name  = os.path.basename(os.path.dirname(mp3_path))
    output_name     = f"raw-{filename}-{subfolder_name}"

    print(f"\n▶  Processing: {mp3_path}")

    chunks    = split_audio(mp3_path, CHUNK_MINUTES * 60 * 1000)
    full_text = f"# {output_name}\n\n"

    for i, chunk in enumerate(chunks):
        chunk_path = f"temp_chunk_{i}.mp3"
        chunk.export(chunk_path, format="mp3", bitrate="32k")
        print(f"   Chunk {i + 1}/{len(chunks)}...")

        with open(chunk_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="fr"
            )
        full_text += result.text + "\n\n"
        os.remove(chunk_path)

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{output_name}.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(full_text)
    print(f"   ✅  Saved: {out_path}")


def main():
    load_config()

    client     = OpenAI(api_key=API_KEY)
    input_path = Path(INPUT_FOLDER)

    print(f"\n📂  Input:  {INPUT_FOLDER}")
    print(f"📂  Output: {OUTPUT_FOLDER}\n")

    for root, dirs, files in os.walk(input_path):
        mp3_files = [f for f in files if f.lower().endswith(".mp3")]
        if not mp3_files:
            continue

        relative_path = os.path.relpath(root, input_path)
        out_dir       = os.path.join(OUTPUT_FOLDER, relative_path)

        for fname in sorted(mp3_files):
            transcribe_file(os.path.join(root, fname), out_dir, client)

    print("\n🎉  All files transcribed!")


if __name__ == "__main__":
    main()
