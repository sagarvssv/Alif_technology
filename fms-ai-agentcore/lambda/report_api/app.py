import json
import os
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

TABLE_NAME = os.environ.get("DOCUMENTS_TABLE") or os.environ.get(
    "REPORTS_TABLE_NAME",
    "FmsAiAgentCoreReports"
)

OUTPUT_BUCKET = os.environ.get("OUTPUT_BUCKET")

table = dynamodb.Table(TABLE_NAME)

# Fields that can be large (extracted document text, full markdown reports).
# These are stripped out of LIST responses (GET /documents) to keep the
# payload small and fast for polling, but are still returned in full when
# fetching a SINGLE document by id (GET /documents/{id}) via
# get_document_by_id(), since that's the only place that content is needed.
HEAVY_FIELDS = [
    "extractedText",
    "extracted_text",
    "documentText",
    "document_text",
    "reportMarkdown",
    "report_markdown",
    "markdown",
    "sourceTextPreview",
    "source_text_preview",
]


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST"
        },
        "body": json.dumps(body, default=str)
    }


def normalize_item(item):
    if not item:
        return None

    normalized = dict(item)

    normalized["reportId"] = (
        item.get("reportId")
        or item.get("documentId")
        or item.get("document_id")
    )

    normalized["documentId"] = (
        item.get("documentId")
        or item.get("document_id")
        or item.get("reportId")
    )

    normalized["createdAt"] = (
        item.get("createdAt")
        or item.get("created_at")
    )

    normalized["sectionCount"] = (
        item.get("sectionCount")
        or item.get("sections_count")
        or item.get("total_sections")
        or len(item.get("sections_completed", []))
        or 0
    )

    normalized["expectedSectionCount"] = (
        item.get("expectedSectionCount")
        or 22
    )

    normalized["company"] = item.get("company") or "Alif Technology"
    normalized["platform"] = item.get("platform") or "FMS AI AgentCore"

    normalized["reportTitle"] = (
        item.get("reportTitle")
        or item.get("report_title")
        or "FMS AI AgentCore BRD Assessment Report"
    )

    normalized["summaryFile"] = (
        item.get("summaryFile")
        or item.get("summary_file")
    )

    return normalized


def strip_heavy_fields(item):
    """Return a shallow copy of item with large text fields removed.
    Used for list responses only — full content is still available via
    the single-document GET endpoint."""
    if not item:
        return item
    trimmed = dict(item)
    for field in HEAVY_FIELDS:
        trimmed.pop(field, None)
    return trimmed


def read_report_markdown(item):
    if not item:
        return ""

    if item.get("reportMarkdown"):
        return item.get("reportMarkdown")

    summary_file = (
        item.get("summaryFile")
        or item.get("summary_file")
    )

    if not summary_file or not OUTPUT_BUCKET:
        return ""

    try:
        s3_object = s3.get_object(
            Bucket=OUTPUT_BUCKET,
            Key=summary_file
        )

        content = s3_object["Body"].read().decode("utf-8")

        return content

    except Exception as error:
        print("S3 markdown read error:", str(error))
        return ""


def get_document_by_id(document_id):
    result = table.get_item(
        Key={
            "document_id": document_id
        }
    )

    return result.get("Item")


def scan_all_documents():
    scan_result = table.scan()
    items = scan_result.get("Items", [])

    while "LastEvaluatedKey" in scan_result:
        scan_result = table.scan(
            ExclusiveStartKey=scan_result["LastEvaluatedKey"]
        )
        items.extend(scan_result.get("Items", []))

    return items


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")

        if method == "OPTIONS":
            return response(200, {"message": "OK"})

        path_parameters = event.get("pathParameters") or {}
        query_parameters = event.get("queryStringParameters") or {}

        document_id = (
            path_parameters.get("document_id")
            or path_parameters.get("documentId")
            or path_parameters.get("reportId")
            or query_parameters.get("document_id")
            or query_parameters.get("documentId")
            or query_parameters.get("reportId")
        )

        # NOTE: "portal" is read but intentionally no longer used to decide
        # how MUCH of the list to return. It used to trigger a special case
        # that threw away everything except the single newest document,
        # which meant the frontend's upload-completion polling could NEVER
        # see a newly finished document once any other document existed —
        # it would spin forever ("stuck at 95%") no matter how long you
        # waited, because that one document was never the "latest" one.
        # All callers now get the FULL sorted list; only the heavy text
        # fields are stripped out (see strip_heavy_fields) to keep the
        # response small and fast.
        portal = query_parameters.get("portal", "user")

        if document_id:
            item = get_document_by_id(document_id)

            if not item:
                return response(404, {"message": "Report not found."})

            normalized = normalize_item(item)
            normalized["reportMarkdown"] = read_report_markdown(normalized)

            return response(
                200,
                {
                    "report": normalized,
                    "document": normalized
                }
            )

        reports = scan_all_documents()

        normalized_reports = [normalize_item(item) for item in reports]

        normalized_reports = sorted(
            normalized_reports,
            key=lambda item: item.get("createdAt") or "",
            reverse=True
        )

        lightweight_reports = [strip_heavy_fields(item) for item in normalized_reports]

        return response(
            200,
            {
                "reports": lightweight_reports
            }
        )

    except Exception as error:
        print("ERROR:", str(error))
        return response(
            500,
            {
                "message": "Reports API failed.",
                "error": str(error)
            }
        )


lambda_handler = handler