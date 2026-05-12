"""
musescore_converter.py  —  COMPATIBILITY SHIM

The original MuseScore CLI-based implementation has been replaced by a pure
Python implementation in ``local_score_converter.py``.

This file re-exports the full public API of the old module so that any code
that still does ``from musescore_converter import ...`` continues to work
without modification.

Do not add new logic here.  Use local_score_converter directly for new code.
"""

from local_score_converter import (  # noqa: F401  (re-export)
    ConversionError,
    MuseScoreNotInstalled,
    convert_to_musicxml,
    convert_to_pdf,
    is_available,
)

# Legacy attribute — old code could read musescore_converter.MUSESCORE_BIN.
# Always None now because there is no binary.
MUSESCORE_BIN: str | None = None