#!/usr/bin/env bash
# ⏩ نسخة طويلة من مقطع Loop (للتلفزيون أو للبث) — من غير تحويل تاني، فالجودة هي هي وبتخلص في ثواني.
# بيشتغل على أي جهاز عليه ffmpeg (لينكس / ماك / سيرفر VPS).
#   الاستخدام:  bash tools/loop-long.sh مقطع.mp4 [الدقايق=60] [ملف_الناتج]
#   مثال:       bash tools/loop-long.sh ayat_loop.mp4 120
set -euo pipefail
in="${1:?اكتب اسم ملف المقطع: bash tools/loop-long.sh clip.mp4 60}"
mins="${2:-60}"
out="${3:-${in%.*}_${mins}min.mp4}"
command -v ffmpeg >/dev/null || { echo "❌ ffmpeg مش متسطّب (على أوبونتو: sudo apt install ffmpeg)"; exit 1; }
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
# عدد دورات كامل (عشان آخر الفيديو يخلص في نهاية دورة، مش في نصها)
reps=$(awk -v d="$dur" -v m="$mins" 'BEGIN { r = int(m * 60 / d + 0.5); if (r < 1) r = 1; print r }')
total=$(awk -v d="$dur" -v r="$reps" 'BEGIN { printf "%.3f", d * r }')
echo "المقطع ${dur} ثانية × ${reps} دورة = ${total} ثانية → ${out}"
ffmpeg -hide_banner -loglevel error -stats -stream_loop $((reps - 1)) -i "$in" -c copy -t "$total" -movflags +faststart "$out"
echo "✅ اتعمل: ${out}"
