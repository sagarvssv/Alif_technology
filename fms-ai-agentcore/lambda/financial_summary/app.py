import json
import os
import uuid
import boto3
import urllib.parse
from datetime import datetime, timezone
from decimal import Decimal

from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

TABLE_NAME = os.environ.get("DOCUMENTS_TABLE") or os.environ.get(
    "REPORTS_TABLE_NAME",
    "FmsAiAgentCoreReports",
)

OUTPUT_BUCKET = os.environ.get("OUTPUT_BUCKET")

table = dynamodb.Table(TABLE_NAME)

# Fixed namespace for document ids derived from the extracted-text key.
# Same S3 key -> same documentId, so a repeated S3 event can never create a
# second record for the same upload. (Every upload has a unique timestamp
# prefix, so different uploads still get different ids.)
DOCUMENT_ID_NAMESPACE = uuid.UUID("6f1c2a52-3b7e-4c8e-9a51-1d2f7c0e4b9a")

# DynamoDB items are capped at 400 KB. The text is stored in several fields
# for older readers, so we only keep as many copies as fit. The full text is
# always available in S3 at extracted_text_key.
ITEM_TEXT_BUDGET_BYTES = 330_000
TEXT_FIELDS_IN_PRIORITY = ["extractedText", "documentText", "reportMarkdown", "markdown"]


def json_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
        },
        "body": json.dumps(body, default=str),
    }


def read_s3_text(bucket, key):
    obj = s3.get_object(Bucket=bucket, Key=key)
    return obj["Body"].read().decode("utf-8", errors="replace")


def extract_text_from_event(event):
    print("EVENT:", json.dumps(event)[:3000])

    if "Records" in event:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

        print("S3_BUCKET:", bucket)
        print("S3_KEY:", key)

        text = read_s3_text(bucket, key)
        return text, bucket, key

    if "extractedText" in event:
        return event["extractedText"], None, None

    if "text" in event:
        return event["text"], None, None

    if "body" in event:
        try:
            body = json.loads(event["body"])
            if "extractedText" in body:
                return body["extractedText"], None, None
            if "text" in body:
                return body["text"], None, None
        except Exception:
            pass

    blocks = event.get("Blocks", [])
    lines = []

    for block in blocks:
        if block.get("BlockType") == "LINE" and block.get("Text"):
            lines.append(block["Text"])

    return "\n".join(lines), None, None


def infer_source_file(source_key):
    """extracted-text/uploads/123-Name.txt.txt -> 123-Name.txt

    FIX: only the trailing ".txt" (added by the upload processor) is
    removed. The old .replace(".txt", "") removed every occurrence, so an
    uploaded "Name.txt" became "Name" and could no longer be matched by
    file name."""
    if not source_key:
        return "manual-input"

    clean_key = source_key
    if clean_key.startswith("extracted-text/"):
        clean_key = clean_key[len("extracted-text/"):]
    if clean_key.endswith(".txt"):
        clean_key = clean_key[: -len(".txt")]

    parts = clean_key.split("/")
    return parts[-1] if parts else clean_key


def document_id_for(source_key):
    if source_key:
        return str(uuid.uuid5(DOCUMENT_ID_NAMESPACE, source_key))
    return str(uuid.uuid4())


def handler(event, context):
    try:
        document_text, source_bucket, source_key = extract_text_from_event(event)

        if not document_text or not document_text.strip():
            print("NO_TEXT_FOUND")
            return json_response(400, {"message": "No extracted document text found."})

        document_id = document_id_for(source_key)
        created_at = datetime.now(timezone.utc).isoformat()
        source_file = infer_source_file(source_key)

        print("DOCUMENT_TEXT_LENGTH:", len(document_text))
        print("TABLE_NAME:", TABLE_NAME)
        print("OUTPUT_BUCKET:", OUTPUT_BUCKET)
        print("SOURCE_FILE:", source_file)
        print("DOCUMENT_ID:", document_id)

        item = {
            "document_id": document_id,
            "reportId": document_id,
            "documentId": document_id,

            "created_at": created_at,
            "createdAt": created_at,
            "updated_at": created_at,
            "updatedAt": created_at,

            "status": "COMPLETED",
            "processingStatus": "COMPLETED",

            "report_type": "FINANCIAL_STATEMENT_UPLOAD",
            "reportType": "FINANCIAL_STATEMENT_UPLOAD",

            "company": "Alif Technology",
            "platform": "FMS AI AgentCore",

            "source_file": source_file,
            "sourceFile": source_file,
            "source_bucket": source_bucket or "",
            "sourceBucket": source_bucket or "",
            "source_key": source_key or "",
            "sourceKey": source_key or "",

            "extracted_text_bucket": source_bucket or "",
            "extractedTextBucket": source_bucket or "",
            "extracted_text_key": source_key or "",
            "extractedTextKey": source_key or "",

            "source_length_chars": Decimal(len(document_text)),
            "processed_length_chars": Decimal(len(document_text)),

            "sourceTextPreview": document_text[:2000],

            "summary_file": "",
            "summaryFile": "",
            "report_title": "Financial Statement Upload",
            "reportTitle": "Financial Statement Upload",

            "sectionCount": Decimal(0),
            "total_sections": Decimal(0),
            "expectedSectionCount": Decimal(0),
            "sections_completed": [],
        }

        # FIX: the old code stored up to four full copies whenever the text
        # was <= 300,000 characters, which exceeds DynamoDB's 400 KB item
        # limit for anything over ~95,000 characters, so large documents
        # silently failed to register. Store only the copies that fit.
        text_bytes = len(document_text.encode("utf-8"))
        stored_fields = []
        used = 0
        for field in TEXT_FIELDS_IN_PRIORITY:
            if used + text_bytes > ITEM_TEXT_BUDGET_BYTES:
                break
            item[field] = document_text
            stored_fields.append(field)
            used += text_bytes
        item["textInItem"] = len(stored_fields) > 0
        print("TEXT_FIELDS_STORED:", stored_fields or "none (full text is in S3 at extracted_text_key)")

        # FIX: register each upload exactly once. A repeated S3 event for the
        # same extracted-text file has the same documentId, so the condition
        # fails and the existing record is left untouched.
        try:
            table.put_item(Item=item, ConditionExpression="attribute_not_exists(document_id)")
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                print("ALREADY_REGISTERED:", document_id, "- duplicate event ignored")
                return json_response(200, {
                    "message": "Document already registered; duplicate event ignored.",
                    "document_id": document_id,
                    "reportId": document_id,
                    "status": "COMPLETED",
                    "source_file": source_file,
                })
            raise

        print("DOCUMENT_REGISTERED:", document_id)
        print("NO_REPORT_GENERATED")
        print("NO_BEDROCK_INVOKED")

        return json_response(
            200,
            {
                "message": "Document registered successfully. No 22-section report generated.",
                "document_id": document_id,
                "reportId": document_id,
                "status": "COMPLETED",
                "source_file": source_file,
                "source_key": source_key,
                "source_length_chars": len(document_text),
            },
        )

    except Exception as error:
        print("ERROR:", str(error))
        return json_response(
            500,
            {
                "message": "Document registration failed.",
                "error": str(error),
            },
        )


lambda_handler = handler