#!/bin/bash
# YuE2: 4 песни владельца (дословные промты+лирики), short-режим, по одной за раз
set -u
export CUDACXX=/usr/local/cuda/bin/nvcc
export LD_LIBRARY_PATH=/home/badai/briix-media/llama.cpp/build:/usr/local/cuda/lib64
TTS=/home/badai/briix-media/llama.cpp/build/bin/llama-tts
M=/home/badai/briix-media/yue2/models/YuE2-3B-Q8_0.gguf
MM=/home/badai/briix-media/yue2/models/mmproj-YuE2-3B-BF16.gguf
B=/home/badai/briix-media/minimax/mm-batch

run() {
  local tag="$1" prompt="$2" lyrfile="$3" maxlines="$4"
  {
    echo "[Tags]"
    echo "$prompt"
    echo "[Lyrics]"
    head -"$maxlines" "$lyrfile"
  } > "/tmp/yue2-$tag.txt"
  echo "=== RUN $tag $(date +%H:%M:%S)"
  timeout 2400 "$TTS" -m "$M" -mm "$MM" -f "/tmp/yue2-$tag.txt" -n 2048 --output "/tmp/yue2-$tag.wav" 2>&1 | tail -2
  ls -la "/tmp/yue2-$tag.wav" 2>/dev/null || echo "FAILED $tag"
}

run "okna" "fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric, warm beat, 170bpm" "$B/mm-batch-lyr-orig-okna.txt" 12
run "lights" "fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric" "$B/mm-batch-lyr-thousand-lights.txt" 12
run "youare" "tempo changes, dynamic r&b, atmospheric vocals, falsetto singing, emotional male vocals, contemporary r&b, synth-heavy production, moody atmosphere, urban nightlife, electronic soul, haunting melodies" "$B/mm-batch-lyr-orig-youare.txt" 16
run "cosmos" "psychedelic 70s, vintage synth, wah guitar, analog bass, mellow drums, phaser, reverb, delay, cosmic atmosphere, steady groove 90 BPM, deep rough brawny male vocal, harmonized backing vocals, vibrant colors, dreamy melodies" "$B/mm-batch-lyr-orig-cosmos.txt" 16
echo "YUE2-OWNER-BATCH DONE"
