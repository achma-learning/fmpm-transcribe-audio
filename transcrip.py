#!/usr/bin/env python3
"""
Audio Transcription Script (French) — OpenAI Whisper API
Transcribes all MP3 files in a folder (and subfolders) to .md files,
maintaining the same folder structure.
"""

import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from pydub import AudioSegment
from openai import OpenAI

# ─────────────────────────────────────────────
#  ✏️  EDIT THESE IF YOU USE "Hardcoded paths"
HARDCODED_INPUT  = r"C:\path\to\your\audio_folder"
HARDCODED_OUTPUT = r"C:\path\to\your\output_folder"
OPENAI_API_KEY   = "sk-your-key-here"
# ─────────────────────────────────────────────

CHUNK_MINUTES = 20
client = OpenAI(api_key=OPENAI_API_KEY)


# ───────────────────────────── TRANSCRIPTION LOGIC ─────────────────────────────

def split_audio(filepath, chunk_ms):
    audio = AudioSegment.from_mp3(filepath)
    audio = audio.set_channels(1)  # mono
    return [audio[i:i + chunk_ms] for i in range(0, len(audio), chunk_ms)]


def transcribe_file(mp3_path, out_dir, log):
    filename        = os.path.splitext(os.path.basename(mp3_path))[0]
    subfolder_name  = os.path.basename(os.path.dirname(mp3_path))
    output_name     = f"raw-{filename}-{subfolder_name}"

    log(f"\n▶  Processing: {mp3_path}")

    chunks    = split_audio(mp3_path, CHUNK_MINUTES * 60 * 1000)
    full_text = f"# {output_name}\n\n"

    for i, chunk in enumerate(chunks):
        chunk_path = f"temp_chunk_{i}.mp3"
        chunk.export(chunk_path, format="mp3", bitrate="32k")
        log(f"   Chunk {i + 1}/{len(chunks)}...")

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
    log(f"   ✅ Saved: {out_path}")


def run_transcription(input_folder, output_folder, log):
    mp3_files = []
    for root, _, files in os.walk(input_folder):
        for fname in files:
            if fname.lower().endswith(".mp3"):
                mp3_files.append(os.path.join(root, fname))

    if not mp3_files:
        log("⚠️  No MP3 files found in the selected folder.")
        return

    log(f"Found {len(mp3_files)} MP3 file(s). Starting transcription...\n")

    success, failed = 0, 0

    for mp3_path in sorted(mp3_files):
        # Mirror subfolder structure in output
        relative_path = os.path.relpath(os.path.dirname(mp3_path), input_folder)
        out_dir       = os.path.join(output_folder, relative_path)

        try:
            transcribe_file(mp3_path, out_dir, log)
            success += 1
        except Exception as e:
            log(f"   ✗ Failed: {mp3_path}\n     Error: {e}")
            failed += 1

    log("\n" + "=" * 60)
    log(f"Done!  ✅ {success} succeeded   ✗ {failed} failed   📁 {len(mp3_files)} total")
    log("=" * 60)


# ───────────────────────────── GUI ─────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Whisper Transcriber — French")
        self.resizable(False, False)
        self.configure(bg="#1e1e2e", padx=24, pady=20)

        self.mode = tk.IntVar(value=2)   # 2 = manual (default)

        self._build_ui()

    # ── layout ──────────────────────────────────────────────────

    def _build_ui(self):
        fg     = "#cdd6f4"
        accent = "#89b4fa"
        dim    = "#6c7086"
        bg     = "#1e1e2e"
        card   = "#313244"

        # Title
        tk.Label(self, text="🎙  Whisper Transcriber", font=("Segoe UI", 15, "bold"),
                 bg=bg, fg=accent).pack(anchor="w", pady=(0, 16))

        # ── Mode selector ────────────────────────────────────────
        mode_frame = tk.LabelFrame(self, text=" Path Mode ", font=("Segoe UI", 9),
                                   bg=bg, fg=dim, bd=1, relief="groove",
                                   padx=12, pady=10)
        mode_frame.pack(fill="x", pady=(0, 14))

        for val, label, desc in [
            (1, "Hardcoded paths", f"  {HARDCODED_INPUT}"),
            (2, "Choose manually", "  Browse folders via dialog  ← default"),
        ]:
            row = tk.Frame(mode_frame, bg=bg)
            row.pack(anchor="w", pady=3)
            tk.Radiobutton(row, text=label, variable=self.mode, value=val,
                           command=self._on_mode_change,
                           font=("Segoe UI", 10, "bold"), bg=bg, fg=fg,
                           selectcolor=card, activebackground=bg,
                           activeforeground=accent).pack(side="left")
            tk.Label(row, text=desc, font=("Segoe UI", 8),
                     bg=bg, fg=dim).pack(side="left", padx=(6, 0))

        # ── Manual path pickers ──────────────────────────────────
        self.picker_frame = tk.Frame(self, bg=bg)
        self.picker_frame.pack(fill="x", pady=(0, 14))

        self.input_var  = tk.StringVar()
        self.output_var = tk.StringVar()

        self._folder_row(self.picker_frame, "📂  Input folder  (MP3s):",
                         self.input_var,  self._browse_input)
        self._folder_row(self.picker_frame, "💾  Output folder (.md):",
                         self.output_var, self._browse_output)

        # ── Start button ─────────────────────────────────────────
        self.start_btn = tk.Button(
            self, text="▶  Start Transcription",
            font=("Segoe UI", 11, "bold"),
            bg=accent, fg="#1e1e2e", activebackground="#74c7ec",
            relief="flat", cursor="hand2", padx=16, pady=8,
            command=self._start
        )
        self.start_btn.pack(fill="x", pady=(0, 14))

        # ── Log area ─────────────────────────────────────────────
        log_frame = tk.Frame(self, bg=bg)
        log_frame.pack(fill="both", expand=True)

        tk.Label(log_frame, text="Log", font=("Segoe UI", 9),
                 bg=bg, fg=dim).pack(anchor="w")

        self.log_box = tk.Text(log_frame, height=16, width=72,
                               bg="#11111b", fg=fg, insertbackground=fg,
                               font=("Consolas", 9), relief="flat",
                               state="disabled", wrap="word")
        self.log_box.pack(side="left", fill="both", expand=True)

        sb = tk.Scrollbar(log_frame, command=self.log_box.yview, bg=card)
        sb.pack(side="right", fill="y")
        self.log_box.configure(yscrollcommand=sb.set)

        # Init state
        self._on_mode_change()

    def _folder_row(self, parent, label, var, cmd):
        bg    = "#1e1e2e"
        fg    = "#cdd6f4"
        card  = "#313244"
        accent= "#89b4fa"

        tk.Label(parent, text=label, font=("Segoe UI", 9),
                 bg=bg, fg=fg).pack(anchor="w", pady=(6, 2))

        row = tk.Frame(parent, bg=bg)
        row.pack(fill="x")

        entry = tk.Entry(row, textvariable=var, font=("Consolas", 9),
                         bg=card, fg=fg, insertbackground=fg,
                         relief="flat", bd=4)
        entry.pack(side="left", fill="x", expand=True)

        tk.Button(row, text="Browse", font=("Segoe UI", 9),
                  bg=accent, fg="#1e1e2e", activebackground="#74c7ec",
                  relief="flat", cursor="hand2", padx=10,
                  command=cmd).pack(side="left", padx=(6, 0))

    # ── callbacks ───────────────────────────────────────────────

    def _on_mode_change(self):
        state = "normal" if self.mode.get() == 2 else "disabled"
        for child in self.picker_frame.winfo_children():
            self._set_state(child, state)

    def _set_state(self, widget, state):
        try:
            widget.configure(state=state)
        except tk.TclError:
            pass
        for child in widget.winfo_children():
            self._set_state(child, state)

    def _browse_input(self):
        path = filedialog.askdirectory(title="Select folder containing MP3 files")
        if path:
            self.input_var.set(path)

    def _browse_output(self):
        path = filedialog.askdirectory(title="Select output folder for .md files")
        if path:
            self.output_var.set(path)

    def _log(self, msg):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")
        self.update_idletasks()

    def _start(self):
        if self.mode.get() == 1:
            input_folder  = HARDCODED_INPUT
            output_folder = HARDCODED_OUTPUT
        else:
            input_folder  = self.input_var.get().strip()
            output_folder = self.output_var.get().strip()

        if not input_folder or not output_folder:
            messagebox.showerror("Missing paths", "Please select both input and output folders.")
            return

        if not os.path.exists(input_folder):
            messagebox.showerror("Invalid path", f"Input folder does not exist:\n{input_folder}")
            return

        self.start_btn.configure(state="disabled", text="⏳  Running...")
        self._log(f"Input:  {input_folder}")
        self._log(f"Output: {output_folder}")

        try:
            run_transcription(input_folder, output_folder, self._log)
        except Exception as e:
            self._log(f"\n❌ Unexpected error: {e}")
        finally:
            self.start_btn.configure(state="normal", text="▶  Start Transcription")


# ───────────────────────────── ENTRY POINT ─────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
