import json
import os

import boto3


AWS_REGION = os.environ.get("AWS_REGION", "eu-central-1")

BEDROCK_MODEL_ID = (
    os.environ.get("BEDROCK_MODEL_ID")
    or os.environ.get("MODEL_ID")
    or "eu.anthropic.claude-sonnet-4-6"
)

_bedrock_runtime = None


def get_bedrock_runtime():
    global _bedrock_runtime
    if _bedrock_runtime is None:
        _bedrock_runtime = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    return _bedrock_runtime


def invoke_claude(system_prompt, user_prompt, max_tokens=3000, temperature=0.2):
    payload = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system_prompt,
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": user_prompt}],
            }
        ],
    }

    response = get_bedrock_runtime().invoke_model(
        modelId=BEDROCK_MODEL_ID,
        body=json.dumps(payload),
        contentType="application/json",
        accept="application/json",
    )

    response_body = json.loads(response["body"].read())
    return response_body["content"][0]["text"]


def clean_json(text):
    if not text:
        return "{}"

    cleaned = text.strip()

    if cleaned.startswith("```json"):
        cleaned = cleaned.replace("```json", "", 1).strip()

    if cleaned.startswith("```"):
        cleaned = cleaned.replace("```", "", 1).strip()

    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()

    return cleaned


def invoke_claude_json(system_prompt, user_prompt, max_tokens=1000, temperature=0):
    raw = invoke_claude(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return json.loads(clean_json(raw))