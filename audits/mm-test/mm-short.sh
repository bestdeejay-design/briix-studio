#!/bin/bash
# MiniMax короткие версии (60-90с): You are here, Cosmic Vibes, A Thousand Lights
set -u
export CUDACXX=/usr/local/cuda/bin/nvcc
export LD_LIBRARY_PATH=/home/badai/briix-media/minimax/audio.cpp/build:/usr/local/cuda/lib64
CLI=/home/badai/briix-media/minimax/audio.cpp/build/bin/audiocpp_cli
MM=/home/badai/briix-media/minimax/models
B=/home/badai/briix-media/minimax/mm-batch

run() {
  local tag="$1" capfile="$2" lyrfile="$3" dur="$4" lines="$5"
  local cap; cap=$(cat "$capfile")
  local lyr; lyr=$(head -$lines "$lyrfile")
  echo "=== RUN $tag $(date +%H:%M:%S)"
  timeout 900 "$CLI" --task gen --family minimax_music3 --model "$MM" --backend cuda \
    --text "$cap" --request-option "lyrics=$lyr" \
    --request-option "duration_sec=$dur" --request-option "num_inference_steps=30" \
    --out "/tmp/mm-short-$tag.wav" 2>&1 | tail -1
  ls -la "/tmp/mm-short-$tag.wav" 2>/dev/null || echo "FAILED $tag"
}

run "youare" "$B/cap-youare.txt" "$B/mm-batch-lyr-orig-youare.txt" 80 12
run "cosmos" "$B/cap-cosmos.txt" "$B/mm-batch-lyr-orig-cosmos.txt" 80 12
run "lights" "$B/cap-lights.txt" "$B/mm-batch-lyr-thousand-lights.txt" 80 12
echo "SHORT-BATCH DONE"
