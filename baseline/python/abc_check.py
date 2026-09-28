"""Checks a score against YuE2's native ABC dialect for the app.

Reads the ABC text on stdin and prints one JSON object: either the facts the app
shows (length, note counts, chords) or the checker's own message saying where the
score breaks the rules. The rules themselves are the official validator's
(abc_tools.py, bundled from the YuE2 repository); nothing here relaxes them.
"""

import json
import sys

from abc_tools import AbcError, parse


def main() -> int:
    text = sys.stdin.buffer.read().decode("utf-8-sig").replace("\r\n", "\n")
    try:
        score = parse(text)
    except AbcError as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 0
    vocal, ins = score.voices["Vocal"], score.voices["Ins"]
    print(json.dumps({
        "ok": True,
        "bpm": score.bpm,
        "seconds": round(float(vocal.time * 60 / score.bpm), 1),
        "measures": len(vocal.bars),
        "vocalNotes": len(vocal.notes),
        "insNotes": len(ins.notes),
        "chords": len(vocal.chords),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
