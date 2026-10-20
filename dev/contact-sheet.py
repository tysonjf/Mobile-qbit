#!/usr/bin/env python3

# Combines screenshots into one image, handy to review a whole tour at once.
# Needs Pillow (pip install pillow).
#
# Usage: python3 contact-sheet.py <output.png> <columns> <scale> <image> [<image> ...]
#   e.g. python3 contact-sheet.py sheet.png 4 0.5 .cache/shots/390x844/*.png

import sys

from PIL import Image, ImageDraw

output, columns, scale = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
images = []
for path in sys.argv[4:]:
    image = Image.open(path).convert("RGB")
    images.append((path.rsplit("/", 1)[-1][:-4], image.resize((int(image.width * scale), int(image.height * scale)))))

width = max(image.width for _, image in images)
height = max(image.height for _, image in images)
rows = (len(images) + columns - 1) // columns
sheet = Image.new("RGB", (columns * (width + 10), rows * (height + 30)), "white")
draw = ImageDraw.Draw(sheet)
for index, (name, image) in enumerate(images):
    x = (index % columns) * (width + 10)
    y = (index // columns) * (height + 30)
    draw.text((x + 4, y + 4), name, fill="black")
    sheet.paste(image, (x, y + 22))
    draw.rectangle([x, y + 22, x + image.width - 1, y + 22 + image.height - 1], outline="red")
sheet.save(output)
