#!/bin/bash
set -u
export CUDACXX=/usr/local/cuda/bin/nvcc
export LD_LIBRARY_PATH=/home/badai/briix-media/llama.cpp/build:/usr/local/cuda/lib64
TTS=/home/badai/briix-media/llama.cpp/build/bin/llama-tts
M=/home/badai/briix-media/yue2/models/YuE2-3B-Q8_0.gguf
MM=/home/badai/briix-media/yue2/models/mmproj-YuE2-3B-BF16.gguf
run() {
  local tag="$1"; local songfile="$2"
  echo "=== RUN $tag $(date +%H:%M:%S)"
  timeout 2400 "$TTS" -m "$M" -mm "$MM" -f "$songfile" --output "/tmp/yue2-$tag.wav" 2>&1 | tail -2
  ls -la "/tmp/yue2-$tag.wav" 2>/dev/null || echo "FAILED $tag"
}
run "cosmos" /tmp/yue2-cosmos.txt
run "youare" /tmp/yue2-youare.txt
echo "YUE2-RETRY DONE"
