#!/usr/bin/env python3
"""Экспорт-конвейер issue briix-studio#37: WAV-мастер -> MP3 320 (ID3v2.4) + M4A.

Теги:
- MP3 (ID3v2.4): TIT2/TPE1/TALB/TCON, COMM, USLT (лирика), TXXX briix_prompt,
  APIC (обложка, front cover). ffmpeg пишет лирику как TXXX=USLT (проверено
  20.11: ffprobe показывает TXXX, не USLT), поэтому честный USLT ставит mutagen.
- M4A: ©lyr (лирика, ffmpeg), ©gen (жанр), freeform ----:com.briix:prompt
  (промт), covr (обложка; ffmpeg кладёт её через attached_pic, здесь --
  страховочная досадка, если covr отсутствует).

ffmpeg обязателен (FFMPEG/FFPROBE передаются из bff). mutagen опционален:
без него MP3 получает ID3v2.4 через флаги ffmpeg (лирика деградирует в
TXXX=USLT, freeform-промт в M4A недоступен) — HAS_MUTAGEN=False фиксируется
в health-статусе конвейера, чтобы статус был честным.
"""
import subprocess
from pathlib import Path

try:
    import mutagen
    from mutagen.id3 import (ID3, APIC, COMM, TALB, TCON, TIT2, TPE1, TXXX,
                             USLT)
    from mutagen.mp4 import MP4, MP4Cover, MP4FreeForm
    HAS_MUTAGEN = True
except ImportError:
    HAS_MUTAGEN = False

GENRE = "Generative Music"
PROMPT_DESC = "briix_prompt"
FREEFORM_PROMPT = ("com.briix", "prompt")  # ----:com.briix:prompt


def pipeline_status():
    """Честный статус возможностей конвейера (для /health и API)."""
    return {"mutagen": HAS_MUTAGEN,
            "mp3_uslt": HAS_MUTAGEN,
            "m4a_freeform_prompt": HAS_MUTAGEN}


def _run(cmd, timeout):
    return subprocess.run([str(c) for c in cmd], stdout=subprocess.DEVNULL,
                          stderr=subprocess.PIPE, timeout=timeout)


def build_mp3(ffmpeg, wav, out, tmp, bitrate="320k", timeout=180):
    """WAV -> MP3 320k (libmp3lame, ID3v2.4). Базовые теги пишет ffmpeg,
    полный набор (USLT/TXXX/APIC) добавляет tag_mp3(). True при успехе."""
    wav, out, tmp = Path(wav), Path(out), Path(tmp)
    base = ["-metadata", f"album={GENRE}", "-metadata", f"genre={GENRE}"]
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-i", wav] + base + [
        "-c:a", "libmp3lame", "-b:a", bitrate, "-id3v2_version", "4",
        "-write_id3v1", "0", str(tmp)]
    try:
        r = _run(cmd, timeout)
        if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
            tmp.replace(out)
            return True
    except (subprocess.TimeoutExpired, OSError):
        pass
    Path(tmp).unlink(missing_ok=True)
    return False


def tag_mp3(path, title, artist, album, comment, lyrics, prompt, cover):
    """ID3v2.4: USLT лирика, TXXX briix_prompt, APIC обложка, TIT2/TPE1/TCON.
    Переписывает теги начисто (детерминированный набор). True при успехе."""
    if not HAS_MUTAGEN:
        return False
    try:
        tags = ID3()
        tags.setall("TIT2", [TIT2(encoding=3, text=title)])
        tags.setall("TPE1", [TPE1(encoding=3, text=artist)])
        tags.setall("TALB", [TALB(encoding=3, text=album)])
        tags.setall("TCON", [TCON(encoding=3, text=GENRE)])
        tags.setall("COMM", [COMM(encoding=3, lang="rus", desc="", text=comment)])
        if lyrics:
            tags.setall("USLT", [USLT(encoding=3, lang="eng", desc="", text=lyrics)])
        if prompt:
            tags.setall("TXXX", [TXXX(encoding=3, desc=PROMPT_DESC, text=prompt)])
        if cover:
            tags.setall("APIC", [APIC(encoding=3, mime="image/png", type=3,
                                      desc="Cover", data=cover)])
        tags.save(path, v2_version=4)
        return True
    except Exception:
        return False


def tag_m4a(path, title, artist, lyrics, prompt, cover):
    """M4A atoms: ©lyr, ©gen, freeform ----:com.briix:prompt; covr досаживается,
    если ffmpeg-муксер его не положил. True при успехе."""
    if not HAS_MUTAGEN:
        return False
    try:
        mp4 = MP4(path)
        if lyrics:
            mp4["\xa9lyr"] = [lyrics]
        mp4["\xa9gen"] = [GENRE]
        if title:
            mp4["\xa9nam"] = [title]
        if artist:
            mp4["\xa9ART"] = [artist]
        if prompt:
            mean, name = FREEFORM_PROMPT
            mp4[f"----:{mean}:{name}"] = [MP4FreeForm(prompt.encode("utf-8"))]
        if cover and not mp4.get("covr"):
            mp4["covr"] = [MP4Cover(cover, imageformat=MP4Cover.FORMAT_PNG)]
        mp4.save()
        return True
    except Exception:
        return False
