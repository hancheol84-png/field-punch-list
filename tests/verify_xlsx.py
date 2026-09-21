"""Validate generated OOXML entirely in memory; no spreadsheet fixture files."""
import io
import sys
import zipfile
import xml.etree.ElementTree as ET
from openpyxl import load_workbook
payload = sys.stdin.buffer.read()
with zipfile.ZipFile(io.BytesIO(payload)) as z:
    assert z.testzip() is None
    for name in z.namelist():
        ET.fromstring(z.read(name))
        if name.startswith('xl/worksheets/'):
            assert b'<f>' not in z.read(name)
wb = load_workbook(io.BytesIO(payload))
assert wb.sheetnames[0] == '전체'
assert len(wb.sheetnames) >= 2
assert len({s.lower() for s in wb.sheetnames}) == len(wb.sheetnames)
for ws in wb:
    assert ws.max_column == 7
    assert [ws.cell(4,c).value for c in range(1,8)] == ['점검일','동','코어','호수','위치','공종','내용']
    assert ws.freeze_panes == 'A5'
    assert ws.page_setup.fitToWidth == 1
    assert 'A1:G1' in ws.merged_cells
    for row in ws.iter_rows(min_row=5):
        for cell in row:
            assert cell.data_type != 'f'
if '--fixture' in sys.argv:
    ws=wb['전체']
    assert [ws.cell(i,4).value for i in range(5,9)] == ['1501','1401','1503','1401']
    assert ws['G5'].value == ' =1+1\t줄\n보수 <&> "따옴표"'
    assert ws['A5'].value == '날짜 미상'
    assert ws['B2'].value == '샘플현장'
    assert ws['G2'].value == '점검자 A'
print('ZIP CRC, XML, openpyxl, sheets, headers, string cells, print layout: OK')
