"""Isolated FastAPI demonstration: no database, payment, or fulfilment writes."""
from typing import Annotated, Literal
import json
import os
import time
import secrets
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(
    title="RoboShop FastAPI Demo",
    version="1.0.0",
    description="Sample data only. Explore products and calculate a sample estimate; no orders or payments are created.",
)


@app.middleware("http")
async def request_logging(request, call_next):
    started=time.monotonic(); status=500; request_id=secrets.token_hex(16)
    try:
        response=await call_next(request)
        status=response.status_code
        response.headers['X-Request-ID']=request_id
        return response
    finally:
        route=getattr(request.scope.get('route'), 'path', 'other')
        level = 'WARN' if status >= 400 else 'INFO'
        threshold = {'DEBUG':10,'INFO':20,'WARN':30,'ERROR':40}.get(os.getenv('LOG_LEVEL','INFO').upper(),20)
        if (route not in ('/health','/ready') or status >= 400) and (30 if status >= 400 else 20) >= threshold:
            print(json.dumps({'timestamp':datetime.now(timezone.utc).isoformat(), 'service':'fastapi-demo',
                'level':'WARN' if status >= 400 else 'INFO', 'event':'request_completed',
                'method':request.method,'route':route,'status':status,'requestId':request_id,
                'errorCode':f'HTTP_{status}' if status >= 400 else 'OK',
                'durationMs':round((time.monotonic()-started)*1000)}),flush=True)


class Product(BaseModel):
    sku: str
    name: str
    price_minor: int = Field(description="Illustrative price in paise, not a merchant offer")
    currency: Literal["INR"] = "INR"
    sample: Literal[True] = True


# Fixtures are owned by this demo, not imported from commerce services.
SAMPLES = (
    Product(sku="SAMPLE-ROVER", name="Sample learning rover", price_minor=49900),
    Product(sku="SAMPLE-ARM", name="Sample robot arm", price_minor=79900),
)


def get_products() -> tuple[Product, ...]:
    """Dependency injection: tests can substitute a fixture provider."""
    return SAMPLES


Catalogue = Annotated[tuple[Product, ...], Depends(get_products)]


class EstimateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sku: str = Field(min_length=1, max_length=64, examples=["SAMPLE-ROVER"])
    quantity: int = Field(strict=True, ge=1, le=20, examples=[2])


class Estimate(BaseModel):
    sku: str
    quantity: int
    subtotal_minor: int
    currency: Literal["INR"] = "INR"
    sample: Literal[True] = True
    notice: str = "Illustrative subtotal only; not a checkout quote. No order or payment created."


@app.get("/health", tags=["Health"])
@app.get("/ready", tags=["Health"])
async def health() -> dict[str, str]:
    # This demonstration has no external dependencies.
    return {"status": "ok", "service": "fastapi-demo"}


@app.get("/products", response_model=list[Product], tags=["Demo catalogue"])
def products(catalogue: Catalogue, q: Annotated[str, Query(max_length=100)] = ""):
    """Filter sample products by name (case insensitive)."""
    return [p for p in catalogue if q.casefold() in p.name.casefold()]


@app.get("/products/{sku}", response_model=Product, tags=["Demo catalogue"])
def product(sku: str, catalogue: Catalogue):
    for item in catalogue:
        if item.sku == sku:
            return item
    raise HTTPException(status_code=404, detail="Sample product not found")


@app.post("/estimates", response_model=Estimate, tags=["Demo calculation"])
def estimate(body: EstimateRequest, catalogue: Catalogue):
    """Demonstrate validated JSON and integer-money arithmetic without side effects."""
    item = product(body.sku, catalogue)
    return Estimate(sku=item.sku, quantity=body.quantity, subtotal_minor=item.price_minor * body.quantity)
