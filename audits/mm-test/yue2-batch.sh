#!/bin/bash
set -u
export CUDACXX=/usr/local/cuda/bin/nvcc
export LD_LIBRARY_PATH=/home/badai/briix-media/llama.cpp/build:/usr/local/cuda/lib64
TTS=/home/badai/briix-media/llama.cpp/build/bin/llama-tts
MODEL=/home/badai/briix-media/yue2/models/YuE2-3B-Q8_0.gguf
MMPROJ=/home/badai/briix-media/yue2/models/mmproj-YuE2-3B-BF16.gguf
LYR=/home/badai/briix-media/minimax/mm-batch

run() {
  local tag="$1" prompt_file="$2" lyrics_file="$3" maxlines="$4"
  {
    echo "[Tags]"
    echo "$2"
  } > /dev/null # placeholder, real content below
  local prompt="$2"
  {
    echo "[Tags]"
    echo "$prompt"
    echo "[Lyrics]"
    head -"$maxlines" "$lyrics_file"
  } > "/tmp/yue2-$tag.txt"
  echo "=== RUN $tag $(date +%H:%M:%S)"
  timeout 2400 "$TTS" -m "$MODEL" -mm "$MMPROJ" -f "/tmp/yue2-$tag.txt" --output "/tmp/yue2-$tag.wav" 2>&1 | tail -2
  ls -la "/tmp/yue2-$tag.wav" 2>/dev/null || echo "FAILED $tag"
}

run "okna" "fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric, warm beat, 170bpm" "$LYR/mm-batch-lyr-orig-okna.txt" 14
run "cosmos" "psychedelic 70s, vintage synth, wah guitar, analog bass, mellow drums, phaser, reverb, delay, cosmic atmosphere, steady groove 90 BPM, deep rough brawny male vocal, harmonized backing vocals, vibrant colors, dreamy melodies" "$LYR/mm-batch-lyr-orig-cosmos.txt" 16
run "youare" "tempo changes, dynamic r&b, atmospheric vocals, falsetto singing, emotional male vocals, contemporary r&b, synth-heavy production, moody atmosphere, urban nightlife, electronic soul, haunting melodies" "$LYR/mm-batch-lyr-orig-youare.txt" 18
echo "YUE2-BATCH DONE"
