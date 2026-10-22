"""Public JSON contracts. Domain validation and authorization remain authoritative."""
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

class ChatRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    message: str = Field(min_length=1, max_length=1000)

class ChatResponse(BaseModel):
    model_config = ConfigDict(extra='allow')
    answer: str
    products: list[Any] = Field(default_factory=list)

class HealthResponse(BaseModel):
    status: str
    service: str

class ErrorResponse(BaseModel):
    error: str
    requestId: str

class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    quoteToken: str | None = Field(default=None, max_length=8192)

class CurrencyQuoteRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    currency: str = Field(pattern=r'^[A-Z]{3}$')

def validate(model, data):
    from runtime import HttpError
    from pydantic import ValidationError
    try:
        return model.model_validate(data)
    except ValidationError:
        raise HttpError(400, 'Invalid request fields.') from None
