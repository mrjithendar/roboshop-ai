"""Bedrock Converse using the SDK's workload credential chain."""


def generate(config, system, prompt, max_tokens):
    import boto3
    from botocore.config import Config

    client = boto3.client(
        "bedrock-runtime",
        region_name=config["region"],
        config=Config(
            connect_timeout=3,
            read_timeout=8,
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
            "provider": "bedrock",
            "model": config["model"],
            "input_tokens": usage.get("inputTokens"),
            "output_tokens": usage.get("outputTokens"),
        }
    finally:
        client.close()
