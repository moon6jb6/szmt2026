import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_lib as L, inspect_audio as IA
PUB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'public', 'audio')
def sheet(ids, out, title):
    items = []
    for i in ids:
        x, sr = IA.load_any(os.path.join(PUB, i + '.ogg'))
        items.append((i, x, sr))
    IA.spectrogram_png(items, out, title)
    print('wrote', out)
sheet(['click-roster','click-letters','click-flag','click-photo','click-testimony','click-message'],
      os.path.join(L.OUT_DIR, 'sheet_carriers.png'), 'six carriers (delivered ogg)')
sheet(['drone-ending-names','drone-ending-letters','drone-ending-flag','drone-ending-photo','drone-ending-testimony','drone-ending-message'],
      os.path.join(L.OUT_DIR, 'sheet_drones.png'), 'six ending drones (delivered ogg)')
sheet(['rain-light','rain-heavy','snow-wind','river','crowd-whisper','room-tone','tape-hiss','flag-flap','radio-static'],
      os.path.join(L.OUT_DIR, 'sheet_loops.png'), 'nine ambience loops (delivered ogg)')
