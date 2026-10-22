"""Bedrock Converse using the SDK's workload credential chain."""


def generate(config, system, prompt, max_tokens, timeout=None):
    import boto3
    from botocore.config import Config

    client = boto3.client(
        "bedrock-runtime",
        region_name=config["region"],
        config=Config(
            connect_timeout=min(3, timeout / 3) if timeout is not None else 3,
            read_timeout=timeout * 2 / 3 if timeout is not None else 8,
            retries={"total_max_attempts": 1},
            max_pool_connections=2,
            ignore_configured_endpoint_urls=True,
        ),
    )
    try:
        response = client.converse(
            modelId=config["model"],
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": max_tokens},
        )
        output = "\n".join(
            item["text"]
            for item in response["output"]["message"]["content"]
            if "text" in item
        )
        usage = response.get("usage", {})
        return {
            "answer": output,
            "refused": response.get("stopReason") in ("guardrail_intervened", "content_filtered"),
            "provider": "bedrock",
            "model": config["model"],
            "input_tokens": usage.get("inputTokens"),
            "output_tokens": usage.get("outputTokens"),
            "cache_read_input_tokens": usage.get("cacheReadInputTokens"),
            "cache_write_input_tokens": usage.get("cacheWriteInputTokens"),
        }
    finally:
        client.close()
