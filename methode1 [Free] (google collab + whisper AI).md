Good choice — completely free, runs on Google's GPU (fast), no API key needed. Here's the full guide adapted for your case (French, batch files, .md output, your naming convention).

Step 1 — Setup Google Colab

Go to drive.google.com
Click New → More → Connect more apps → search Colaboratory → Install
Click New → More → Google Colaboratory
Click Runtime → Change runtime type → GPU → Save


Step 2 — Install Whisper
Paste this in the first cell and click ▶ Run:
python!pip install git+https://github.com/openai/whisper.git
!sudo apt update && sudo apt install ffmpeg -y

Step 3 — Mount your Google Drive
Upload your MP3 folders to Google Drive first, then run:
pythonfrom google.colab import drive
drive.mount('/content/drive')

Step 4 — Batch transcribe all files to .md
Paste this in a new cell — it handles your full folder structure and naming convention:
pythonimport os
import whisper

model = whisper.load_model("medium")  # good balance for French

INPUT_FOLDER  = "/content/drive/MyDrive/your-folder-name"   # ← change this
OUTPUT_FOLDER = "/content/drive/MyDrive/transcriptions"      # ← change this

os.makedirs(OUTPUT_FOLDER, exist_ok=True)

for root, dirs, files in os.walk(INPUT_FOLDER):
    mp3_files = [f for f in files if f.lower().endswith(".mp3")]
    if not mp3_files:
        continue

    relative_path = os.path.relpath(root, INPUT_FOLDER)
    out_dir = os.path.join(OUTPUT_FOLDER, relative_path)
    os.makedirs(out_dir, exist_ok=True)

    for fname in sorted(mp3_files):
        filepath = os.path.join(root, fname)
        filename = os.path.splitext(fname)[0]
        subfolder_name = os.path.basename(root)
        output_name = f"raw-{filename}-{subfolder_name}"

        print(f"▶ Transcribing: {fname}")
        result = model.transcribe(filepath, language="fr")

        out_path = os.path.join(out_dir, f"{output_name}.md")
        with open(out_path, "w") as f:
            f.write(f"# {output_name}\n\n")
            f.write(result["text"])

        print(f"  ✅ Saved: {output_name}.md\n")

print("🎉 All done!")

Important Notes
TopicDetailFree GPU limit~12h/day on free tier — enough for your 24h+ spread across 2–3 daysFile uploadUpload to Google Drive (not directly to Colab) — faster and files persistModelUse medium for French — large is better but slower on free GPUSession timeoutColab disconnects after ~90min idle — run in batches per subfolder if neededOutputFiles saved directly to your Google Drive, ready to download
The free GPU will transcribe roughly 1 hour of audio in ~5–10 minutes — your full 24h+ should finish in one long session or split across two days.
