#!/usr/bin/env bash
# Regenerates the Play Store assets that this repo draws itself, and refuses to
# ship one at the wrong size. Play rejects a feature graphic that is not exactly
# 1024x500, and the rejection arrives days later, so the check is here.
#
#   assets/play/render.sh
#
# Screenshots are NOT rendered here: they are captured from the running app by
# scripts/play-screenshots.mjs, against supabase/seed/listing-seed.sql.
set -euo pipefail

cd "$(dirname "$0")"

CHROME="${CHROME:-$(command -v chromium || command -v chromium-browser || command -v google-chrome)}"
[ -n "$CHROME" ] || { echo "No chromium on PATH. Set CHROME=/path/to/chrome." >&2; exit 1; }

W=1024
H=500

# Rendered at 2x and supersampled down with LANCZOS, which is what keeps the
# small type crisp instead of merely large.
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 \
  --window-size="$W,$H" \
  --screenshot="feature-graphic.2x.png" \
  --virtual-time-budget=2000 \
  "file://$PWD/feature-graphic.html" >/dev/null 2>&1

python3 - "$W" "$H" <<'PY'
import sys
from PIL import Image

w, h = int(sys.argv[1]), int(sys.argv[2])
src = Image.open('feature-graphic.2x.png').convert('RGB')
if src.size != (w * 2, h * 2):
    raise SystemExit(f'headless render came out {src.size}, expected {(w*2, h*2)}')
src.resize((w, h), Image.LANCZOS).save('feature-graphic.png', optimize=True)
print(f'feature-graphic.png  {w}x{h}')
PY

rm -f feature-graphic.2x.png

# The gate. Every PNG that goes to Play gets its dimensions read back, not
# assumed: the feature graphic at exactly 1024x500, and each phone screenshot
# with both sides inside Play's 320..3840 window.
python3 - <<'PY'
import glob, sys
from PIL import Image

bad = []

fg = Image.open('feature-graphic.png')
if fg.size != (1024, 500):
    bad.append(f'feature-graphic.png is {fg.size}, must be 1024x500')

shots = sorted(glob.glob('screenshots/*.png'))
for path in shots:
    w, h = Image.open(path).size
    if not (320 <= w <= 3840 and 320 <= h <= 3840):
        bad.append(f'{path} is {w}x{h}, both sides must be 320..3840')
    print(f'{path}  {w}x{h}')

if len(shots) < 4:
    print(f'note: {len(shots)} screenshot(s) present, Play wants 2 and rewards 4')

if bad:
    print('\n'.join(bad), file=sys.stderr)
    sys.exit(1)
print('all assets are the size Play expects')
PY
