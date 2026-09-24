"""Batch-copy the legacy cases out of the port ledger, one representative per (case, call).

    node -e "..." > /tmp/cases.json      # see tools/legacy-port.mjs for the ledger shape
    python3 tools/probe/moc-validity.py /tmp/cases.json

Reads a JSON array of `[label, source]` pairs, writes each to a scratch `.mo`, runs a moc over it,
and reports whether moc 2.0 accepts it. The point is to separate two things the port ledger reports
as one number: inputs the *new parser* refuses because the *language* refuses them, and inputs it
refuses that the language accepts — the latter being real gaps.

`moc`'s exit code is 0 for valid and invalid alike, so validity is judged by the presence of
`syntax error` in the output, which is the only signal that works.
"""

import json
import subprocess
import sys

MOC = "/tmp/mocnow/moc"
SCRATCH = "/tmp/mocoracle/t.mo"

cases = json.load(open(sys.argv[1]))
out = []
for label, src in cases:
    with open(SCRATCH, "w") as fh:
        fh.write(src)
    proc = subprocess.run(
        [MOC, "-dp", SCRATCH], capture_output=True, text=True
    )
    text = proc.stdout + proc.stderr
    bad = "syntax error" in text
    lines = text.strip().split("\n")
    detail = lines[1] if len(lines) > 1 and "syntax error" in lines[0] else (
        lines[0] if lines else ""
    )
    out.append({"label": label, "valid": not bad, "detail": detail[:120]})

if len(sys.argv) > 2:
    json.dump(out, open(sys.argv[2], "w"), indent=1)

for entry in out:
    mark = "VALID  " if entry["valid"] else "invalid"
    suffix = "" if entry["valid"] else "  " + entry["detail"]
    print(f"{mark} {entry['label']}{suffix}")
