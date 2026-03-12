#!/usr/bin/env python3
"""
Transcription Launcher
GUI to configure and run the transcription script.
"""

import os
import re
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────────────────────────
HARDCODED_API_KEY = "sk-your-key-here"   # ← pre-fill if you want
TRANSCRIBE_SCRIPT = "transcribe_all.py"  # path to your transcription script (same folder by default)
# ─────────────────────────────────────────────────────────────────────────────


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Transcription Launcher")
        self.resizable(False, False)
        self.configure(bg="#1e1e2e", padx=30, pady=24)

        # ── Fonts & Colors ────────────────────────────────────────────────────
        self.BG        = "#1e1e2e"
        self.CARD      = "#2a2a3e"
        self.ACCENT    = "#7c6af7"
        self.ACCENT2   = "#5a4fcf"
        self.FG        = "#e0e0f0"
        self.FG_DIM    = "#888899"
        self.GREEN     = "#4caf82"
        self.RED       = "#e06c75"
        self.FONT      = ("Segoe UI", 10)
        self.FONT_BOLD = ("Segoe UI", 10, "bold")
        self.FONT_LG   = ("Segoe UI", 13, "bold")
        self.FONT_SM   = ("Segoe UI", 9)

        # ── State ─────────────────────────────────────────────────────────────
        self.api_mode        = tk.StringVar(value="manual")  # "manual" | "hardcoded"
        self.api_key_var     = tk.StringVar()
        self.save_key_var    = tk.StringVar(value="no")      # "yes" | "no"
        self.input_folder    = tk.StringVar()
        self.output_folder   = tk.StringVar()

        self._build_ui()

    # ── UI ────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        self._section("🔑  API Key", 0)
        self._api_section()
        self._divider(row=7)
        self._section("📁  Folders", 8)
        self._folder_section()
        self._divider(row=14)
        self._run_button()

    def _section(self, title, row):
        tk.Label(self, text=title, font=self.FONT_LG,
                 bg=self.BG, fg=self.FG).grid(
            row=row, column=0, columnspan=3, sticky="w", pady=(10, 4))

    def _divider(self, row):
        ttk.Separator(self, orient="horizontal").grid(
            row=row, column=0, columnspan=3, sticky="ew", pady=12)

    # ── API section ───────────────────────────────────────────────────────────

    def _api_section(self):
        # Radio buttons
        radio_frame = tk.Frame(self, bg=self.BG)
        radio_frame.grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 6))

        style_radio = {"bg": self.BG, "fg": self.FG, "font": self.FONT,
                       "activebackground": self.BG, "activeforeground": self.ACCENT,
                       "selectcolor": self.ACCENT, "cursor": "hand2"}

        tk.Radiobutton(radio_frame, text="Enter API key manually",
                       variable=self.api_mode, value="manual",
                       command=self._on_api_mode_change, **style_radio).pack(side="left", padx=(0, 20))

        tk.Radiobutton(radio_frame, text="Use hardcoded API key",
                       variable=self.api_mode, value="hardcoded",
                       command=self._on_api_mode_change, **style_radio).pack(side="left")

        # Manual input card (visible by default)
        self.manual_frame = tk.Frame(self, bg=self.CARD, padx=14, pady=12)
        self.manual_frame.grid(row=2, column=0, columnspan=3, sticky="ew", pady=(0, 4))

        tk.Label(self.manual_frame, text="Paste your OpenAI API key:",
                 font=self.FONT, bg=self.CARD, fg=self.FG_DIM).pack(anchor="w")

        key_row = tk.Frame(self.manual_frame, bg=self.CARD)
        key_row.pack(fill="x", pady=(4, 0))

        self.key_entry = tk.Entry(key_row, textvariable=self.api_key_var,
                                  show="•", font=self.FONT, width=52,
                                  bg="#12121e", fg=self.FG, insertbackground=self.FG,
                                  relief="flat", bd=0)
        self.key_entry.pack(side="left", ipady=7, padx=(0, 8))

        self.eye_btn = tk.Button(key_row, text="👁", font=self.FONT_SM,
                                 bg=self.CARD, fg=self.FG_DIM, relief="flat",
                                 cursor="hand2", command=self._toggle_key_visibility)
        self.eye_btn.pack(side="left")

        # Save key prompt
        self.save_frame = tk.Frame(self, bg=self.BG)
        self.save_frame.grid(row=3, column=0, columnspan=3, sticky="w", pady=(2, 0))

        tk.Label(self.save_frame, text="Update API key in transcribe script?",
                 font=self.FONT, bg=self.BG, fg=self.FG).pack(side="left", padx=(0, 14))

        save_style = {"bg": self.BG, "fg": self.FG, "font": self.FONT,
                      "activebackground": self.BG, "selectcolor": self.GREEN,
                      "cursor": "hand2"}

        tk.Radiobutton(self.save_frame, text="Yes", variable=self.save_key_var,
                       value="yes", **save_style).pack(side="left", padx=(0, 10))
        tk.Radiobutton(self.save_frame, text="No", variable=self.save_key_var,
                       value="no", **save_style).pack(side="left")

        # Hardcoded key info (hidden by default)
        self.hardcoded_frame = tk.Frame(self, bg=self.CARD, padx=14, pady=10)
        self.hardcoded_label = tk.Label(self.hardcoded_frame,
                                        text=f"Using key: {self._mask(HARDCODED_API_KEY)}",
                                        font=self.FONT, bg=self.CARD, fg=self.GREEN)
        self.hardcoded_label.pack(anchor="w")

        # Status label
        self.api_status = tk.Label(self, text="", font=self.FONT_SM,
                                   bg=self.BG, fg=self.GREEN)
        self.api_status.grid(row=5, column=0, columnspan=3, sticky="w")

    def _on_api_mode_change(self):
        mode = self.api_mode.get()
        if mode == "manual":
            self.hardcoded_frame.grid_forget()
            self.manual_frame.grid(row=2, column=0, columnspan=3, sticky="ew", pady=(0, 4))
            self.save_frame.grid(row=3, column=0, columnspan=3, sticky="w", pady=(2, 0))
        else:
            self.manual_frame.grid_forget()
            self.save_frame.grid_forget()
            self.hardcoded_frame.grid(row=2, column=0, columnspan=3, sticky="ew", pady=(0, 4))

    def _toggle_key_visibility(self):
        current = self.key_entry.cget("show")
        self.key_entry.config(show="" if current == "•" else "•")

    def _mask(self, key):
        if len(key) <= 8:
            return "••••••••"
        return key[:5] + "••••••••" + key[-4:]

    # ── Folder section ────────────────────────────────────────────────────────

    def _folder_section(self):
        lbl_style  = {"font": self.FONT, "bg": self.BG, "fg": self.FG_DIM, "anchor": "w"}
        entry_style = {"font": self.FONT, "bg": "#12121e", "fg": self.FG,
                       "insertbackground": self.FG, "relief": "flat", "bd": 0, "width": 44}
        btn_style  = {"font": self.FONT_SM, "bg": self.ACCENT, "fg": "white",
                      "relief": "flat", "cursor": "hand2", "padx": 10, "pady": 4}

        # Input folder
        tk.Label(self, text="Input folder (contains your MP3s):", **lbl_style).grid(
            row=9, column=0, columnspan=3, sticky="w", pady=(0, 3))

        input_row = tk.Frame(self, bg=self.BG)
        input_row.grid(row=10, column=0, columnspan=3, sticky="w", pady=(0, 10))

        tk.Entry(input_row, textvariable=self.input_folder, **entry_style).pack(
            side="left", ipady=7, padx=(0, 8))
        tk.Button(input_row, text="Browse", command=self._browse_input, **btn_style).pack(side="left")

        # Output folder
        tk.Label(self, text="Output folder (where .md files will be saved):", **lbl_style).grid(
            row=11, column=0, columnspan=3, sticky="w", pady=(0, 3))

        output_row = tk.Frame(self, bg=self.BG)
        output_row.grid(row=12, column=0, columnspan=3, sticky="w", pady=(0, 4))

        tk.Entry(output_row, textvariable=self.output_folder, **entry_style).pack(
            side="left", ipady=7, padx=(0, 8))
        tk.Button(output_row, text="Browse", command=self._browse_output, **btn_style).pack(side="left")

    def _browse_input(self):
        folder = filedialog.askdirectory(title="Select input folder")
        if folder:
            self.input_folder.set(folder)
            # Auto-suggest output folder
            if not self.output_folder.get():
                self.output_folder.set(str(Path(folder).parent / (Path(folder).name + "_transcribed")))

    def _browse_output(self):
        folder = filedialog.askdirectory(title="Select output folder")
        if folder:
            self.output_folder.set(folder)

    # ── Run button ────────────────────────────────────────────────────────────

    def _run_button(self):
        self.run_btn = tk.Button(self, text="▶  Start Transcription",
                                 font=("Segoe UI", 11, "bold"),
                                 bg=self.ACCENT, fg="white", relief="flat",
                                 cursor="hand2", padx=20, pady=10,
                                 command=self._on_run)
        self.run_btn.grid(row=16, column=0, columnspan=3, pady=(6, 0))

        self.run_status = tk.Label(self, text="", font=self.FONT_SM,
                                   bg=self.BG, fg=self.GREEN)
        self.run_status.grid(row=17, column=0, columnspan=3, pady=(6, 0))

    # ── Logic ─────────────────────────────────────────────────────────────────

    def _get_api_key(self):
        if self.api_mode.get() == "hardcoded":
            return HARDCODED_API_KEY
        return self.api_key_var.get().strip()

    def _validate(self):
        key = self._get_api_key()
        if not key or key == "sk-your-key-here":
            messagebox.showerror("Missing API Key", "Please enter a valid OpenAI API key.")
            return False
        if not self.input_folder.get():
            messagebox.showerror("Missing Folder", "Please select an input folder.")
            return False
        if not self.output_folder.get():
            messagebox.showerror("Missing Folder", "Please select an output folder.")
            return False
        if not Path(self.input_folder.get()).exists():
            messagebox.showerror("Invalid Folder", "Input folder does not exist.")
            return False
        return True

    def _update_script_key(self, key):
        """Patch the API key inside transcribe_all.py"""
        script_path = Path(TRANSCRIBE_SCRIPT)
        if not script_path.exists():
            # Try same folder as this launcher
            script_path = Path(__file__).parent / TRANSCRIBE_SCRIPT

        if not script_path.exists():
            messagebox.showwarning("Script Not Found",
                f"Could not find '{TRANSCRIBE_SCRIPT}' to update.\nKey was NOT saved.")
            return False

        content = script_path.read_text(encoding="utf-8")
        # Replace the api_key= line
        new_content = re.sub(
            r'(api_key\s*=\s*["\']).*?(["\'])',
            lambda m: m.group(1) + key + m.group(2),
            content,
            count=1
        )
        if new_content == content:
            messagebox.showwarning("Pattern Not Found",
                "Could not find 'api_key=' in the script. Key was NOT saved.")
            return False

        script_path.write_text(new_content, encoding="utf-8")
        return True

    def _on_run(self):
        if not self._validate():
            return

        key = self._get_api_key()

        # Save key to script if requested
        if self.api_mode.get() == "manual" and self.save_key_var.get() == "yes":
            success = self._update_script_key(key)
            if success:
                self.api_status.config(text="✅  API key updated in transcribe script.", fg=self.GREEN)
            else:
                self.api_status.config(text="⚠️  Could not update key in script.", fg=self.RED)

        # Write a temp config file for the transcription script to pick up
        config_path = Path(__file__).parent / ".transcribe_config"
        config_path.write_text(
            f"API_KEY={key}\n"
            f"INPUT_FOLDER={self.input_folder.get()}\n"
            f"OUTPUT_FOLDER={self.output_folder.get()}\n",
            encoding="utf-8"
        )

        self.run_status.config(
            text=f"✅  Config saved. Run transcribe_all.py to start.", fg=self.GREEN)

        messagebox.showinfo(
            "Ready to Transcribe",
            f"Configuration saved!\n\n"
            f"Input:  {self.input_folder.get()}\n"
            f"Output: {self.output_folder.get()}\n\n"
            f"Now run transcribe_all.py to start transcription."
        )


if __name__ == "__main__":
    app = App()
    app.mainloop()
