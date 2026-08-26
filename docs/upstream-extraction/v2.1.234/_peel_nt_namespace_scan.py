from pathlib import Path

data = Path(
    r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe"
).read_bytes()
d233 = Path(
    r"C:/Users/Administrator/AppData/Local/Temp/official-233/plat/package/claude.exe"
).read_bytes()

needles = [
    b"containsVulnerableUncPath",
    b"vulnerableUnc",
    b"NT-namespace",
    b"nt namespace",
    b"\\??\\",
    b"\\\\??\\",
    b"/??/",
    b"isNtPath",
    b"isDevicePath",
    b"rejectNt",
    b"device path",
]

for n in needles:
    print(
        repr(n),
        "234",
        data.count(n),
        "233",
        d233.count(n),
        "first234",
        data.find(n),
    )
