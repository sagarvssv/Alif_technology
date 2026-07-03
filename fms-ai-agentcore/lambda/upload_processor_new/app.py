import json
import os
import time
import boto3
from urllib.parse import unquote_plus

s3 = boto3.client("s3")
textract = boto3.client("textract")

OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]


def lambda_handler(event, context):
    print("Document upload event received")
    print(json.dumps(event))

    record = event["Records"][0]

    source_bucket = record["s3"]["bucket"]["name"]
    source_key = unquote_plus(record["s3"]["object"]["key"])

    print(f"Processing file: s3://{source_bucket}/{source_key}")

    start_response = textract.start_document_text_detection(
        DocumentLocation={
            "S3Object": {
                "Bucket": source_bucket,
                "Name": source_key,
            }
        }
    )

    job_id = start_response["JobId"]
    print(f"Textract Job Started: {job_id}")

    while True:
        result = textract.get_document_text_detection(JobId=job_id)
        status = result["JobStatus"]

        print(f"Textract Job Status: {status}")

        if status == "SUCCEEDED":
            break

        if status == "FAILED":
            raise Exception("Textract job failed")

        time.sleep(5)

    lines = []

    next_token = None

    while True:
        if next_token:
            result = textract.get_document_text_detection(
                JobId=job_id,
                NextToken=next_token
            )
        else:
            result = textract.get_document_text_detection(
                JobId=job_id
            )

        for block in result.get("Blocks", []):
            if block.get("BlockType") == "LINE":
                lines.append(block.get("Text", ""))

        next_token = result.get("NextToken")

        if not next_token:
            break

    extracted_text = "\n".join(lines)

    output_key = f"extracted-text/{source_key}.txt"

    s3.put_object(
        Bucket=OUTPUT_BUCKET,
        Key=output_key,
        Body=extracted_text.encode("utf-8"),
        ContentType="text/plain",
    )

    print(f"Extracted text saved to s3://{OUTPUT_BUCKET}/{output_key}")
    print(extracted_text[:1000])

    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": "Textract async processing completed",
            "source_bucket": source_bucket,
            "source_key": source_key,
            "output_bucket": OUTPUT_BUCKET,
            "output_key": output_key,
            "textract_job_id": job_id,
        }),
    }