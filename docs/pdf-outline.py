# Mở sẵn ngăn Bookmarks khi mở tệp PDF và ghi tiêu đề tài liệu.  python3 docs/pdf-outline.py <tệp.pdf>
import sys
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject
p = sys.argv[1]
w = PdfWriter(clone_from=PdfReader(p))
w._root_object[NameObject('/PageMode')] = NameObject('/UseOutlines')
w.add_metadata({'/Title': 'Mail Lite — Hướng dẫn sử dụng', '/Author': 'ngthhung'})
w.write(p)
