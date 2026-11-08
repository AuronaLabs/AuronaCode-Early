"""Build the wordmark subset. Requires fonttools[woff]; source uses SIL OFL."""
from pathlib import Path
from shutil import copyfile
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "node_modules/@fontsource/righteous"
OUTPUT = ROOT / "public/fonts"
TEXT = "Aurona Code"

OUTPUT.mkdir(parents=True, exist_ok=True)
font = TTFont(SOURCE / "files/righteous-latin-400-normal.woff2")
options = subset.Options()
options.flavor = "woff2"
options.recalc_timestamp = False
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=TEXT)
subsetter.subset(font)
# Righteous is a Reserved Font Name under OFL. Rename the modified font.
names = {1: "Aurona Brand", 2: "Regular", 3: "AuronaBrand-Subset-1",
         4: "Aurona Brand Regular", 6: "AuronaBrand-Regular",
         16: "Aurona Brand", 17: "Regular"}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.save(OUTPUT / "aurona-brand.woff2")
copyfile(SOURCE / "LICENSE", OUTPUT / "OFL-Righteous.txt")
assert set(font.getBestCmap()) == {ord(char) for char in TEXT}
print(f"Brand subset: {(OUTPUT / 'aurona-brand.woff2').stat().st_size} bytes")
