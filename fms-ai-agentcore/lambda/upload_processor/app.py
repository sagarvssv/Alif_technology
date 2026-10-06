import csv
import io
import json
import os
import re
import time
import zipfile
from datetime import datetime, timedelta
from urllib.parse import unquote_plus
from xml.etree import ElementTree as ET

import boto3

s3 = boto3.client("s3")
textract = boto3.client("textract")

OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]

# ── What goes where ────────────────────────────────────────────────────
# Textract only reads PDF/TIFF/PNG/JPEG. Everything else is read here in
# Python and saved to exactly the same place Textract output goes
# (extracted-text/<source_key>.txt), so every later step is unchanged.
TEXTRACT_TYPES = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
DIRECT_TYPES = {".xlsx", ".xlsm", ".xls", ".csv", ".txt", ".docx"}

# Keep very large spreadsheets from overwhelming the AI.
MAX_ROWS_PER_SHEET = 5000
MAX_TOTAL_CHARS = 400_000
TEXTRACT_MAX_WAIT_SECONDS = 270  # stay inside the 300 s Lambda timeout


class UnsupportedFile(Exception):
    """A file we can never read. Not retried: retrying cannot help."""


# ════════════════════════════════════════════════════════════════════════
# Entry point
# ════════════════════════════════════════════════════════════════════════

def lambda_handler(event, context):
    print("Document upload event received")
    print(json.dumps(event))

    results = []
    for record in event.get("Records", []):
        source_bucket = record["s3"]["bucket"]["name"]
        source_key = unquote_plus(record["s3"]["object"]["key"])
        source_etag = (record["s3"]["object"].get("eTag") or "").strip('"')
        results.append(process_one(source_bucket, source_key, source_etag))

    return {"statusCode": 200, "body": json.dumps({"results": results})}


def process_one(source_bucket, source_key, source_etag):
    print(f"Processing file: s3://{source_bucket}/{source_key}")
    output_key = f"extracted-text/{source_key}.txt"

    # S3 can deliver the same event more than once, and failed runs are
    # retried. If this exact upload (same ETag) was already extracted, do
    # nothing, so the output file is never re-written for the same upload.
    if source_etag and already_extracted(output_key, source_etag):
        print(f"Already extracted (same ETag {source_etag}); skipping duplicate event.")
        return {"source_key": source_key, "output_key": output_key, "skipped": "duplicate event"}

    ext = os.path.splitext(source_key)[1].lower()
    try:
        if ext in TEXTRACT_TYPES:
            method = "textract"
            text = extract_with_textract(source_bucket, source_key)
        elif ext in DIRECT_TYPES:
            method = f"direct:{ext}"
            data = s3.get_object(Bucket=source_bucket, Key=source_key)["Body"].read()
            text = extract_direct(ext, data)
        elif ext == ".doc":
            raise UnsupportedFile(
                "Old Word format (.doc) is not supported. Please save the file as .docx or PDF and upload again."
            )
        else:
            raise UnsupportedFile(f"File type '{ext or 'unknown'}' is not supported.")
    except UnsupportedFile as err:
        # Logged clearly and NOT re-raised, so Lambda does not retry a file
        # that can never succeed.
        print(f"[UNSUPPORTED] {source_key}: {err}")
        return {"source_key": source_key, "error": str(err), "unsupported": True}

    text = truncate(text)
    if not text.strip():
        print(f"[WARNING] No text could be extracted from {source_key}.")

    s3.put_object(
        Bucket=OUTPUT_BUCKET,
        Key=output_key,
        Body=text.encode("utf-8"),
        ContentType="text/plain",
        Metadata={"source-etag": source_etag, "extraction-method": method},
    )
    print(f"Extracted text saved to s3://{OUTPUT_BUCKET}/{output_key} ({method}, {len(text)} chars)")
    print(text[:1000])
    return {"source_key": source_key, "output_key": output_key, "method": method, "chars": len(text)}


def already_extracted(output_key, source_etag):
    try:
        head = s3.head_object(Bucket=OUTPUT_BUCKET, Key=output_key)
    except Exception:
        return False
    return head.get("Metadata", {}).get("source-etag") == source_etag


def truncate(text):
    if len(text) <= MAX_TOTAL_CHARS:
        return text
    return text[:MAX_TOTAL_CHARS] + f"\n\n[Truncated: document text exceeded {MAX_TOTAL_CHARS:,} characters.]"


# ════════════════════════════════════════════════════════════════════════
# Textract (PDF and images) — same behaviour as before
# ════════════════════════════════════════════════════════════════════════

def extract_with_textract(bucket, key):
    start = textract.start_document_text_detection(
        DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
    )
    job_id = start["JobId"]
    print(f"Textract Job Started: {job_id}")

    waited = 0
    while True:
        result = textract.get_document_text_detection(JobId=job_id)
        status = result["JobStatus"]
        print(f"Textract Job Status: {status}")
        if status == "SUCCEEDED":
            break
        if status == "FAILED":
            raise Exception(f"Textract job failed: {result.get('StatusMessage', 'no reason given')}")
        if waited >= TEXTRACT_MAX_WAIT_SECONDS:
            raise Exception(f"Textract job {job_id} still running after {waited}s")
        time.sleep(5)
        waited += 5

    lines = []
    next_token = None
    while True:
        if next_token:
            result = textract.get_document_text_detection(JobId=job_id, NextToken=next_token)
        else:
            result = textract.get_document_text_detection(JobId=job_id)
        for block in result.get("Blocks", []):
            if block.get("BlockType") == "LINE":
                lines.append(block.get("Text", ""))
        next_token = result.get("NextToken")
        if not next_token:
            break
    return "\n".join(lines)


# ════════════════════════════════════════════════════════════════════════
# Direct readers (no Textract)
# ════════════════════════════════════════════════════════════════════════

def extract_direct(ext, data):
    try:
        if ext in (".xlsx", ".xlsm"):
            return read_xlsx(data)
        if ext == ".xls":
            return read_xls(data)
        if ext == ".csv":
            return read_csv(data)
        if ext == ".txt":
            return decode_text(data)
        if ext == ".docx":
            return read_docx(data)
    except UnsupportedFile:
        raise
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as err:
        raise UnsupportedFile(f"The file could not be read as {ext} (it may be damaged or password-protected): {err}")
    raise UnsupportedFile(f"No reader for {ext}")


def decode_text(data):
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def fmt_row(values):
    cells = ["" if v is None else str(v).strip() for v in values]
    while cells and cells[-1] == "":
        cells.pop()
    return " | ".join(cells)


def read_csv(data):
    text = decode_text(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    lines = []
    for i, row in enumerate(csv.reader(io.StringIO(text), dialect)):
        if i >= MAX_ROWS_PER_SHEET:
            lines.append(f"[Truncated: only the first {MAX_ROWS_PER_SHEET} rows are included.]")
            break
        line = fmt_row(row)
        if line:
            lines.append(line)
    return "\n".join(lines)


# ── XLSX (Office Open XML) — standard library only ──────────────────────
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
BUILTIN_DATE_FORMATS = {14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47}


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref or "")
    if not letters:
        return None
    n = 0
    for ch in letters.group(0):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _excel_date(serial):
    try:
        value = float(serial)
    except (TypeError, ValueError):
        return serial
    base = datetime(1899, 12, 30) + timedelta(days=value)
    return base.strftime("%Y-%m-%d") if value == int(value) else base.strftime("%Y-%m-%d %H:%M")


def _number(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return text
    return str(int(value)) if value == int(value) and abs(value) < 1e15 else repr(value)


def read_xlsx(data):
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = set(zf.namelist())

    shared = []
    if "xl/sharedStrings.xml" in names:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))

    # Which cell styles are dates
    date_styles = set()
    if "xl/styles.xml" in names:
        styles = ET.fromstring(zf.read("xl/styles.xml"))
        custom_date_ids = set()
        for nf in styles.findall("m:numFmts/m:numFmt", NS):
            code = re.sub(r'"[^"]*"|\[[^\]]*\]', "", nf.get("formatCode", "")).lower()
            if re.search(r"[dmy]", code) and not re.fullmatch(r"[0#.,%\s]*", code):
                custom_date_ids.add(int(nf.get("numFmtId")))
        for i, xf in enumerate(styles.findall("m:cellXfs/m:xf", NS)):
            fmt_id = int(xf.get("numFmtId", "0"))
            if fmt_id in BUILTIN_DATE_FORMATS or fmt_id in custom_date_ids:
                date_styles.add(i)

    # Sheet names in workbook order → their XML files
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    targets = {r.get("Id"): r.get("Target") for r in rels.findall("rel:Relationship", NS)}

    out = []
    for sheet in workbook.findall("m:sheets/m:sheet", NS):
        name = sheet.get("name")
        target = targets.get(sheet.get(f"{{{NS['r']}}}id"), "")
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        if path not in names:
            continue
        out.append(f"=== Sheet: {name} ===")
        root = ET.fromstring(zf.read(path))
        row_count = 0
        for row in root.iter(f"{{{NS['m']}}}row"):
            if row_count >= MAX_ROWS_PER_SHEET:
                out.append(f"[Truncated: only the first {MAX_ROWS_PER_SHEET} rows of this sheet are included.]")
                break
            values = {}
            for c in row.findall("m:c", NS):
                col = _col_index(c.get("r"))
                if col is None:
                    col = len(values)
                cell_type = c.get("t")
                v = c.find("m:v", NS)
                raw = v.text if v is not None else None
                if cell_type == "s" and raw is not None:
                    value = shared[int(raw)] if int(raw) < len(shared) else ""
                elif cell_type == "inlineStr":
                    value = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
                elif cell_type == "b":
                    value = "TRUE" if raw == "1" else "FALSE"
                elif cell_type in ("str", "e"):
                    value = raw or ""
                elif raw is None:
                    f = c.find("m:f", NS)
                    value = f"={f.text}" if f is not None and f.text else ""
                elif int(c.get("s", "0")) in date_styles:
                    value = _excel_date(raw)
                else:
                    value = _number(raw)
                values[col] = value
            if values:
                line = fmt_row([values.get(i, "") for i in range(max(values) + 1)])
                if line:
                    out.append(line)
                    row_count += 1
        out.append("")
    return "\n".join(out).strip()


# ── XLS (legacy Excel) — needs the xlrd package bundled in the zip ──────
def read_xls(data):
    try:
        import xlrd
    except ImportError:
        raise UnsupportedFile("Legacy .xls support is not installed on the server. Please save as .xlsx and upload again.")
    try:
        book = xlrd.open_workbook(file_contents=data)
    except Exception as err:
        raise UnsupportedFile(f"The .xls file could not be read (it may be damaged or password-protected): {err}")
    out = []
    for sheet in book.sheets():
        out.append(f"=== Sheet: {sheet.name} ===")
        for r in range(min(sheet.nrows, MAX_ROWS_PER_SHEET)):
            values = []
            for c in range(sheet.ncols):
                cell = sheet.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_DATE:
                    try:
                        dt = xlrd.xldate.xldate_as_datetime(cell.value, book.datemode)
                        values.append(dt.strftime("%Y-%m-%d") if dt.time() == datetime.min.time() else dt.strftime("%Y-%m-%d %H:%M"))
                    except Exception:
                        values.append(cell.value)
                elif cell.ctype == xlrd.XL_CELL_NUMBER:
                    values.append(_number(cell.value))
                elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                    values.append("TRUE" if cell.value else "FALSE")
                else:
                    values.append(cell.value)
            line = fmt_row(values)
            if line:
                out.append(line)
        if sheet.nrows > MAX_ROWS_PER_SHEET:
            out.append(f"[Truncated: only the first {MAX_ROWS_PER_SHEET} rows of this sheet are included.]")
        out.append("")
    return "\n".join(out).strip()


# ── DOCX — standard library only ────────────────────────────────────────
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _paragraph_text(p):
    parts = []
    for node in p.iter():
        if node.tag == W + "t":
            parts.append(node.text or "")
        elif node.tag == W + "tab":
            parts.append("\t")
        elif node.tag in (W + "br", W + "cr"):
            parts.append("\n")
    return "".join(parts).strip()


def read_docx(data):
    zf = zipfile.ZipFile(io.BytesIO(data))
    body = ET.fromstring(zf.read("word/document.xml")).find(W + "body")
    out = []
    for block in body:
        if block.tag == W + "p":
            text = _paragraph_text(block)
            if text:
                out.append(text)
        elif block.tag == W + "tbl":
            for tr in block.iter(W + "tr"):
                cells = [" ".join(filter(None, (_paragraph_text(p) for p in tc.iter(W + "p"))))
                         for tc in tr.findall(W + "tc")]
                line = fmt_row(cells)
                if line:
                    out.append(line)
            out.append("")
    return "\n".join(out).strip()