#!/usr/bin/env python3
import subprocess, os, time
BASE=os.path.expanduser("~/Projects/briix-studio-build/audits/mm-test")
def sshb(cmd, timeout=2600):
    r = subprocess.run(["ssh","-o","BatchMode=yes","fonotext-stand",
        f"ssh -o BatchMode=yes badai@10.10.0.98 '{cmd}'"], capture_output=True, text=True, timeout=timeout)
    return r.stdout, r.stderr
CAPS = {
 "You are here": ("tempo changes, dynamic r&b, atmospheric vocals, falsetto singing, emotional male vocals, contemporary r&b, synth-heavy production, moody atmosphere, sensual vocals, urban nightlife, romantic darkness, electronic soul, haunting melodies, dreamy soundscapes, modern r&b production, emotional depth", "lyr-orig-youare.txt", 200, 51001),
 "Cosmic Vibes of 1973": ("psychedelic 70s, vintage synth, wah guitar, analog bass, mellow drums, phaser, reverb, delay, cosmic atmosphere, steady groove 90 BPM, deep rough brawny male vocal, aggressive yet beautiful male whisper in intro and outro, harmonized backing vocals, vibrant colors, dreamy melodies", "lyr-orig-cosmos.txt", 210, 51002),
 "Тысячи Окон": ("fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric, warm beat, 170bpm", "lyr-orig-okna.txt", 196, 51003),
 "A Thousand Lights Тысячи окон Legendary": ("fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric", "lyr-thousand-lights.txt", 196, 51004),
}
OUT=os.path.expanduser("~/Downloads/briix-ab")
CLI="/home/badai/briix-media/minimax/audio.cpp/build/bin/audiocpp_cli"
for name,(cap,lyrf,dur,seed) in CAPS.items():
    lyr=open(f"{BASE}/{lyrf}").read().strip().replace("'","'\\''").replace("\n","\\n")
    cap2=cap.replace("'","'\\''")
    cmd=f'''export CUDACXX=/usr/local/cuda/bin/nvcc LD_LIBRARY_PATH=/home/badai/briix-media/minimax/audio.cpp/build:/usr/local/cuda/lib64; timeout 2400 {CLI} --task gen --family minimax_music3 --model /home/badai/briix-media/minimax/models --backend cuda --text '{cap2}' --request-option "lyrics={lyr}" --request-option duration_sec={dur} --request-option num_inference_steps=30 --out /tmp/mm-{seed}.wav 2>&1 | tail -3; ls -la /tmp/mm-{seed}.wav'''
    print("RUN", name, flush=True)
    out,err=sshb(cmd)
    print((out or "")[-300:], (err or "")[-150:], flush=True)
    r=subprocess.run(["ssh","-o","BatchMode=yes","fonotext-stand",
        f"ssh -o BatchMode=yes badai@10.10.0.98 'cat /tmp/mm-{seed}.wav'"], capture_output=True, timeout=600)
    fn=f"minimax-music3 v1 — {name} (оригинал-промт).wav"
    open(os.path.join(OUT,fn),"wb").write(r.stdout)
    print("DELIVERED", fn, len(r.stdout), flush=True)
print("ALL MINIMAX DONE", flush=True)
