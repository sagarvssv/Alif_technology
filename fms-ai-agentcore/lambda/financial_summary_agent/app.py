import json
import os
import uuid
import boto3
import urllib.parse
from datetime import datetime, timezone
from decimal import Decimal

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

TABLE_NAME = os.environ.get("DOCUMENTS_TABLE") or os.environ.get(
    "REPORTS_TABLE_NAME",
    "FmsAiAgentCoreReports",
)

OUTPUT_BUCKET = os.environ.get("OUTPUT_BUCKET")

table = dynamodb.Table(TABLE_NAME)


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
    if not source_key:
        return "manual-input"

    clean_key = source_key.replace("extracted-text/", "")
    clean_key = clean_key.replace(".txt", "")

    parts = clean_key.split("/")
    return parts[-1] if parts else clean_key


def handler(event, context):
    try:
        document_text, source_bucket, source_key = extract_text_from_event(event)

        if not document_text or not document_text.strip():
            print("NO_TEXT_FOUND")
            return json_response(400, {"message": "No extracted document text found."})

        document_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        source_file = infer_source_file(source_key)

        print("DOCUMENT_TEXT_LENGTH:", len(document_text))
        print("TABLE_NAME:", TABLE_NAME)
        print("OUTPUT_BUCKET:", OUTPUT_BUCKET)
        print("SOURCE_FILE:", source_file)

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

        if len(document_text) <= 300000:
            item["documentText"] = document_text
            item["extractedText"] = document_text
            item["reportMarkdown"] = document_text
            item["markdown"] = document_text

        table.put_item(Item=item)

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