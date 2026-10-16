import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ElementTree

content = sys.stdin.buffer.read(20_000_001)
if len(content) > 20_000_000:
    raise ValueError('Document too large')
if sys.argv[1] == '.pdf':
    import fitz
    document = fitz.open(stream=content, filetype='pdf')
    parts = []
    length = 0
    for page in document:
        text = page.get_text()
        parts.append(text)
        length += len(text)
        if length > 20000:
            break
    result = '\n'.join(parts)
    output = {'text': result[:20000], 'pages': len(document), 'truncated': length > 20000 or len(parts) < len(document), 'needs_ocr': not result.strip()}
    document.close()
elif sys.argv[1] == '.docx':
    with zipfile.ZipFile(io.BytesIO(content)) as document:
        member = document.getinfo('word/document.xml')
        if member.file_size > 5_000_000:
            raise ValueError('Expanded document too large')
        xml = document.read(member)
        if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
            raise ValueError('Unsafe XML declarations')
        root = ElementTree.fromstring(xml)
        result = '\n'.join(''.join(paragraph.itertext()) for paragraph in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
        output = {'text': result[:20000], 'truncated': len(result) > 20000}
else:
    raise ValueError('Unsupported format')
print(json.dumps(output, ensure_ascii=False))
