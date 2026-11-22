#!/bin/bash
# MiniMax кусочная генерация: каждая песня = куски по 90с (по секциям лирики), склейка ffmpeg
set -u
export CUDACXX=/usr/local/cuda/bin/nvcc
export LD_LIBRARY_PATH=/home/badai/briix-media/minimax/audio.cpp/build:/usr/local/cuda/lib64
CLI=/home/badai/briix-media/minimax/audio.cpp/build/bin/audiocpp_cli
MM=/home/badai/briix-media/minimax/models
B=/home/badai/briix-media/minimax/mm-batch
FF=$(command -v ffmpeg || echo /home/badai/ffmpeg/ffmpeg)

gen_chunk() {
  local tag="$1" capfile="$2" lyrfile="$3" startline="$4" endline="$5" dur="$6"
  local cap; cap=$(cat "$capfile")
  # вырезать секцию лирики по строкам
  local lyr; lyr=$(sed -n "${startline},${endline}p" "$lyrfile")
  timeout 900 "$CLI" --task gen --family minimax_music3 --model "$MM" --backend cuda \
    --text "$cap" --request-option "lyrics=$lyr" \
    --request-option "duration_sec=$dur" --request-option "num_inference_steps=30" \
    --out "/tmp/mm-chunk-$tag.wav" 2>&1 | tail -1
  ls "/tmp/mm-chunk-$tag.wav" 2>/dev/null
}

# Тысячи Окон: лирика 952 симв (~30 строк) — 2 куска по ~15 строк
L="$B/mm-batch-lyr-orig-okna.txt"
total=$(wc -l < "$L"); half=$((total/2))
echo "== Тысячи Окон chunk1"
c1=$(gen_chunk okna1 "$B/cap-okna.txt" "$L" 1 $((half+2)) 90)
echo "== Тысячи Окон chunk2"
c2=$(gen_chunk okna2 "$B/cap-okna.txt" "$L" $((half+3)) $total 90)
if [ -n "$c1" ] && [ -n "$c2" ]; then
  "$FF" -y -i "$c1" -i "$c2" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" /tmp/mm-okna-full.wav 2>&1 | tail -1
  ls -la /tmp/mm-okna-full.wav
fi
echo "OKNA DONE"
