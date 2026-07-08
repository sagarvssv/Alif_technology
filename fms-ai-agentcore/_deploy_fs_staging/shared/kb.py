import json
import os

import boto3
from botocore.exceptions import ClientError


AWS_REGION = os.environ.get("AWS_REGION", "eu-central-1")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "1ZCVTUEAH8")

_bedrock_agent_runtime = None


def get_bedrock_agent_runtime():
    global _bedrock_agent_runtime
    if _bedrock_agent_runtime is None:
        _bedrock_agent_runtime = boto3.client(
            "bedrock-agent-runtime",
            region_name=AWS_REGION,
        )
    return _bedrock_agent_runtime


def retrieve_from_kb(query_text, number_of_results=8):
    if not query_text:
        return "", []

    try:
        response = get_bedrock_agent_runtime().retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            retrievalQuery={"text": query_text},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": number_of_results,
                }
            },
        )

        chunks = []
        citations = []

        for index, item in enumerate(response.get("retrievalResults", []), start=1):
            citation_id = f"S{index}"
            text = item.get("content", {}).get("text", "")
            location = item.get("location", {})
            source = extract_source(location)

            if not text:
                continue

            chunks.append(f"[{citation_id}] {text}")

            citations.append(
                {
                    "id": citation_id,
                    "source": source,
                    "text": text[:1000],
                    "score": item.get("score"),
                    "location": location,
                }
            )

        return "\n\n".join(chunks), citations

    except ClientError as exc:
        print("Knowledge Base retrieval failed:", str(exc), flush=True)
        return "", []

    except Exception as exc:
        print("Knowledge Base retrieval error:", str(exc), flush=True)
        return "", []


def extract_source(location):
    if not location:
        return "Knowledge Base"

    if "s3Location" in location:
        return location["s3Location"].get("uri", "S3 Knowledge Base document")

    if "webLocation" in location:
        return location["webLocation"].get("url", "Web Knowledge Base document")

    if "confluenceLocation" in location:
        return location["confluenceLocation"].get(
            "url",
            "Confluence Knowledge Base document",
        )

    if "sharePointLocation" in location:
        return location["sharePointLocation"].get(
            "url",
            "SharePoint Knowledge Base document",
        )

    return json.dumps(location)


def format_citations(citations):
    if not citations:
        return "No citations available."

    lines = []

    for citation in citations:
        citation_id = citation.get("id", "")
        source = citation.get("source", "Knowledge Base")
        text = citation.get("text", "")

        lines.append(
            f"[{citation_id}] Source: {source}\n"
            f"Excerpt: {text}"
        )

    return "\n\n".join(lines)