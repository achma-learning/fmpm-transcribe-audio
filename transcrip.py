import os
from pydub import AudioSegment
from openai import OpenAI

client = OpenAI(api_key="sk-your-key-here")  # ← your key

INPUT_FOLDER  = r"C:\path\to\your\main_folder"   # ← change
OUTPUT_FOLDER = r"C:\path\to\output"              # ← change
CHUNK_MINUTES = 20

def split_audio(filepath, chunk_ms):
    audio = AudioSegment.from_mp3(filepath)
    audio = audio.set_channels(1)  # compress to mono
    return [audio[i:i+chunk_ms] for i in range(0, len(audio), chunk_ms)]

def transcribe_file(mp3_path, out_dir):
    filename = os.path.splitext(os.path.basename(mp3_path))[0]
    print(f"\n▶ Processing: {mp3_path}")

    chunks = split_audio(mp3_path, CHUNK_MINUTES * 60 * 1000)
    full_text = f"# {filename}\n\n"

    for i, chunk in enumerate(chunks):
        chunk_path = f"temp_chunk_{i}.mp3"
        chunk.export(chunk_path, format="mp3", bitrate="32k")
        print(f"  Chunk {i+1}/{len(chunks)}...")

        with open(chunk_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="fr"
            )
        full_text += result.text + "\n\n"
        os.remove(chunk_path)

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{filename}.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(full_text)
    print(f"  ✅ Saved: {out_path}")

# Recursively walk all subfolders
for root, dirs, files in os.walk(INPUT_FOLDER):
    mp3_files = [f for f in files if f.lower().endswith(".mp3")]
    if not mp3_files:
        continue

    # Mirror the subfolder structure in output
    relative_path = os.path.relpath(root, INPUT_FOLDER)
    out_dir = os.path.join(OUTPUT_FOLDER, relative_path)

    for fname in mp3_files:
        transcribe_file(os.path.join(root, fname), out_dir)

print("\n🎉 All files done!")




----

\\ update from ai
// Just update the filename construction line. Here's the relevant change://

pythondef transcribe_file(mp3_path, out_dir):
    filename = os.path.splitext(os.path.basename(mp3_path))[0]
    subfolder_name = os.path.basename(os.path.dirname(mp3_path))  # immediate parent folder
    output_name = f"raw-{filename}-{subfolder_name}"              # ← new naming pattern

    print(f"\n▶ Processing: {mp3_path}")

    chunks = split_audio(mp3_path, CHUNK_MINUTES * 60 * 1000)
    full_text = f"# {output_name}\n\n"

    for i, chunk in enumerate(chunks):
        chunk_path = f"temp_chunk_{i}.mp3"
        chunk.export(chunk_path, format="mp3", bitrate="32k")
        print(f"  Chunk {i+1}/{len(chunks)}...")

        with open(chunk_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="fr"
            )
        full_text += result.text + "\n\n"
        os.remove(chunk_path)

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{output_name}.md")   # ← uses new name
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(full_text)
    print(f"  ✅ Saved: {out_path}")
