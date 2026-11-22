#!/bin/bash
# MiniMax Music 3 batch: 4 генерации, лирика из файлов на B
set -u
export CUDACXX=/usr/local/cuda/bin/nvcc
export LD_LIBRARY_PATH=/home/badai/briix-media/minimax/audio.cpp/build:/usr/local/cuda/lib64
CLI=/home/badai/briix-media/minimax/audio.cpp/build/bin/audiocpp_cli
MM=/home/badai/briix-media/minimax/models
B=/home/badai/briix-media/minimax/mm-batch

run() {
  local name="$1" capfile="$2" lyrfile="$3" dur="$4" tag="$5"
  local cap; cap=$(cat "$capfile")
  local lyr; lyr=$(cat "$lyrfile")
  echo "=== RUN $name $(date +%H:%M:%S)"
  timeout 2400 "$CLI" --task gen --family minimax_music3 --model "$MM" --backend cuda \
    --text "$cap" \
    --request-option "lyrics=$lyr" \
    --request-option "duration_sec=$dur" \
    --request-option "num_inference_steps=30" \
    --out "/tmp/mm-$tag.wav" 2>&1 | tail -2
  ls -la "/tmp/mm-$tag.wav" 2>/dev/null || echo "FAILED $name"
}

mkdir -p "$B"
cat > "$B/cap-youare.txt" <<'C1'
tempo changes, dynamic r&b, atmospheric vocals, falsetto singing, emotional male vocals, contemporary r&b, synth-heavy production, moody atmosphere, sensual vocals, urban nightlife, romantic darkness, electronic soul, haunting melodies, dreamy soundscapes, modern r&b production, emotional depth
C1
cat > "$B/cap-cosmos.txt" <<'C2'
psychedelic 70s, vintage synth, wah guitar, analog bass, mellow drums, phaser, reverb, delay, cosmic atmosphere, steady groove 90 BPM, deep rough brawny male vocal, aggressive yet beautiful male whisper in intro and outro, harmonized backing vocals, vibrant colors, dreamy melodies
C2
cat > "$B/cap-okna.txt" <<'C3'
fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric, warm beat, 170bpm
C3
cat > "$B/cap-lights.txt" <<'C4'
fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric
C4

run "You are here" "$B/cap-youare.txt" "$B/mm-batch-lyr-orig-youare.txt" 200 youare
run "Cosmic Vibes 1973" "$B/cap-cosmos.txt" "$B/mm-batch-lyr-orig-cosmos.txt" 210 cosmos
run "Тысячи Окон" "$B/cap-okna.txt" "$B/mm-batch-lyr-orig-okna.txt" 196 okna
run "A Thousand Lights" "$B/cap-lights.txt" "$B/mm-batch-lyr-thousand-lights.txt" 196 lights
echo "MM-BATCH DONE"
