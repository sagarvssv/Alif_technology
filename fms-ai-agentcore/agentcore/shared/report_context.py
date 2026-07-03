import json
import os

import boto3
from botocore.exceptions import ClientError


AWS_REGION = os.environ.get("AWS_REGION", "eu-central-1")
DOCUMENT_BUCKET = os.environ.get(
    "CLIENT_DOCUMENT_BUCKET",
    "fmsaiagentcorestack-fmsclientdocumentsbucket29833c-m5dhp94vhgo6",
)

_s3 = None


def get_s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", region_name=AWS_REGION)
    return _s3


def get_report_context(report_id=None, direct_context=None):
    """
    Priority:
    1. direct_context (already extracted by Lambda)
    2. report JSON stored in S3
    3. empty string
    """

    if direct_context:
        return direct_context

    if not report_id:
        return ""

    try:
        response = get_s3().get_object(
            Bucket=DOCUMENT_BUCKET,
            Key=f"reports/{report_id}.json",
        )

        body = response["Body"].read().decode("utf-8")

        try:
            report = json.loads(body)
            return json.dumps(report, indent=2)
        except Exception:
            return body

    except ClientError as e:
        print(f"Report context not found: {e}", flush=True)
        return ""

    except Exception as e:
        print(f"Report context error: {e}", flush=True)
        return ""


def build_context_summary(context, max_chars=12000):
    """
    Reduce context size before sending to Claude.
    """

    if not context:
        return "No uploaded document context available."

    context = str(context).strip()

    if len(context) <= max_chars:
        return context

    return context[:max_chars] + "\n\n...[truncated]..."


def extract_company_name(context):
    if not context:
        return None

    keywords = [
        "company",
        "entity",
        "client",
        "organization",
    ]

    lower = context.lower()

    for keyword in keywords:
        idx = lower.find(keyword)
        if idx >= 0:
            return context[idx:idx + 120]

    return None


def extract_financial_year(context):
    if not context:
        return None

    import re

    years = re.findall(r"20\d{2}", context)

    if years:
        return years[0]

    return None