"""O-CUT duration adapter. The adjacent original worker remains unmodified."""
import sys
import worker as legacy

# YuE2 VAE uses 1,920 samples per frame at 48 kHz: 25 tokens/second.
# 420 seconds needs 10,500 tokens, above the original UI worker's 9,000 cap.
# The installed pipeline still enforces its own 24,576-token context limit.
legacy.LIMITS["maxTokens"] = (500, 10500, int)
legacy.LIMITS["minTokens"] = (0, 10499, int)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    legacy.Worker().run()
