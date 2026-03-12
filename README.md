00. imaging this : recording everyday conversation with phone, then give it to ai to summurize and ]**build second brain** and store them in cloud storage ????
   + advantage never miss a info, but privacy ... (sometimes we laught ...) , so i think the best move is to if you want record then, cut and edit audio file to remove the noise / unneccessary part, then upload and save into cloud
   0. imaging eveing this : create a claude agent , to do this work with just two things : claude cowork -> installed in pc (put audio file in a folder), use use skill /transcribe-cours , this give you lesson by this , you can upload it to notebookLM
1. transcibe audio to .md format
2. ask ai how to transcribe audio, format of transcribing (time stanp) .... or what
3. use github desktop and host repo locally
4. use gemini-cli free to analyse file
---
+ 1. transcribe audio into raw_filename.md (which has identical to audio) +/- alternatevily do manual check if possible
+ 2a. give the raw_filename.md to ai (claude or gemini-cli), to structure them and build a good prompt to do this (you are a health care expert in medecine, rewrite this data base on ....)
+ 2b. give it to notebookLM to make audio file

---
if have time transcribe (different recording also from different years and organise them into folders)
alternatively add pdf or word of cours but no primary
---
if have time add Qe.md files (and analyse all that)
---
ai for transcribe : open ai whisper :
 + https://openai.com/fr-FR/index/whisper/
 + assembely AI https://www.assemblyai.com
 + TurboScribe.ai
 + Deepgram (Nova-2 Model)
---
# plan (here using : openAI whisper)
+ see this : https://www.youtube.com/watch?v=ABFqbY_rmEk
+ see this 2: https://www.youtube.com/watch?v=8SQV-B83tPU
  + guide : https://kevinstratvert.com/2023/01/19/best-free-speech-to-text-ai-whisper-ai/
+ transcribe : https://github.com/openai/whisper
claude ai suggested me to use, open-ai whisper api
1. install dependecy:
  + install python: https://www.python.org/downloads/
   + run this in cmd or terminal "pip install openai pydub"
  + install ffmpeg (https://www.gyan.dev/ffmpeg/builds/), run this in cmd or terminal, without coping the "" : "winget install ffmpeg"
