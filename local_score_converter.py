"""
local_score_converter.py

Converts MuseScore (.mscz / .mscx) files to MusicXML or PDF without any
MuseScore CLI, GUI binary, subprocess call, or OS-level installation.

Strategy
--------
MSCZ → MusicXML
    .mscz files are ZIP archives.  The score is stored inside as a .mscx file
    (plain XML).  We extract it with Python's built-in ``zipfile`` module.
    .mscx files are already plain XML — returned as-is.

MusicXML / MSCX → PDF
    Rendered via the ``verovio`` Python binding (pip install verovio).
    Verovio is a self-contained C++ engraving library; its Python wheel
    bundles the binary, so no additional OS-level install is needed.

Compatibility
-------------
This module exposes the same public API as the old musescore_converter.py so
that every existing import site works without modification:

    convert_to_musicxml(mscz_bytes, source_ext=".mscz") -> bytes
    convert_to_pdf(mscz_bytes, source_ext=".mscz")      -> bytes
    is_available()                                       -> bool
    ConversionError                                      (exception class)
    MuseScoreNotInstalled                                (legacy shim, never raised)

Works on Render.com, Docker, Linux, macOS, and Windows with no extra software.
"""

from __future__ import annotations

import zipfile
from io import BytesIO


# ── Exceptions ────────────────────────────────────────────────────────────────

class ConversionError(RuntimeError):
    """Raised when a conversion step fails."""


class MuseScoreNotInstalled(RuntimeError):
    """
    Legacy compatibility shim retained so that any existing
    ``except MuseScoreNotInstalled`` blocks continue to compile and run.
    This exception is never raised by the new pure-Python implementation.
    """


# ── Public API ────────────────────────────────────────────────────────────────

def is_available() -> bool:
    """
    Always returns True — conversion is handled in pure Python and requires
    no external installation.  Retained for drop-in API compatibility with
    the old musescore_converter module.
    """
    return True


def convert_to_musicxml(mscz_bytes: bytes, source_ext: str = ".mscz") -> bytes:
    """
    Return MusicXML / MSCX bytes for the supplied MuseScore file.

    Parameters
    ----------
    mscz_bytes  : raw bytes of the .mscz or .mscx file
    source_ext  : ``'.mscz'``  — compressed ZIP archive (standard MuseScore export)
                  ``'.mscx'``  — uncompressed XML (returned as-is)

    Returns
    -------
    UTF-8 encoded MusicXML / MSCX bytes.

    Raises
    ------
    ConversionError
        If the archive is corrupt, not a valid ZIP, or contains no .mscx entry.
    """
    ext = source_ext.lower()

    if ext == ".mscx":
        # Already uncompressed XML — pass straight through.
        return mscz_bytes

    if ext == ".mscz":
        try:
            with zipfile.ZipFile(BytesIO(mscz_bytes)) as zf:
                # MuseScore names the embedded .mscx after the original file
                # title, so we scan all entries rather than hard-coding a name.
                for name in zf.namelist():
                    if name.endswith(".mscx"):
                        return zf.read(name)
        except zipfile.BadZipFile as exc:
            raise ConversionError(
                f"The uploaded file is not a valid .mscz archive: {exc}"
            ) from exc
        except Exception as exc:
            raise ConversionError(
                f"Failed to extract .mscx from .mscz archive: {exc}"
            ) from exc

        raise ConversionError(
            "No .mscx file was found inside the .mscz archive. "
            "The file may be corrupt or produced by an unsupported MuseScore version."
        )

    raise ConversionError(
        f"Unsupported source extension '{source_ext}'. "
        "Expected '.mscz' (compressed) or '.mscx' (uncompressed XML)."
    )


def convert_to_pdf(mscz_bytes: bytes, source_ext: str = ".mscz") -> bytes:
    """
    Convert a MuseScore file to PDF using the Verovio engraving library.

    Requires ``verovio`` to be installed::

        pip install verovio

    Parameters
    ----------
    mscz_bytes  : raw bytes of the .mscz or .mscx file
    source_ext  : ``'.mscz'`` or ``'.mscx'``

    Returns
    -------
    PDF bytes.

    Raises
    ------
    ConversionError
        If Verovio is not installed, cannot parse the score, or produces an
        empty result.
    """
    # Step 1 — extract MusicXML / MSCX content.
    xml_bytes = convert_to_musicxml(mscz_bytes, source_ext=source_ext)

    # Step 2 — require verovio (optional dependency).
    try:
        import verovio  # type: ignore
    except ImportError as exc:
        raise ConversionError(
            "PDF rendering requires the verovio package. "
            "Install it with: pip install verovio"
        ) from exc

    # Step 3 — render to PDF.
    try:
        tk = verovio.toolkit()
        tk.setOptions({
            "pageWidth": 2100,        # A4 portrait at 72 dpi
            "pageHeight": 2970,
            "spacingStaff": 8,
            "spacingSystem": 12,
            "scale": 40,
            "adjustPageHeight": True,
        })

        ok = tk.loadData(xml_bytes.decode("utf-8", errors="replace"))
        if not ok:
            raise ConversionError(
                "Verovio could not parse the MusicXML/MSCX data. "
                "The score may use features not supported by Verovio."
            )

        pdf_bytes = tk.renderToPDF()
        if not pdf_bytes:
            raise ConversionError(
                "Verovio produced an empty PDF. "
                "The score may be empty or use unsupported notation."
            )

        return pdf_bytes

    except ConversionError:
        raise
    except Exception as exc:
        raise ConversionError(f"Verovio PDF rendering failed: {exc}") from exc