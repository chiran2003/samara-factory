from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, date

# --- Product ---
class ProductBase(BaseModel):
    name: str
    code: str
    rate: float

class ProductCreate(ProductBase):
    pass

class Product(ProductBase):
    id: str
    is_active: bool
    # materials will be loaded separately or via relationship if needed

    class Config:
        orm_mode = True

# --- Material ---
class MaterialBase(BaseModel):
    name: str

class MaterialCreate(MaterialBase):
    product_id: str

class Material(MaterialBase):
    id: str
    product_id: str
    is_active: bool

    class Config:
        orm_mode = True

# --- PO ---
class PurchaseOrderBase(BaseModel):
    product_id: str
    po_no: str
    po_qty: int

class PurchaseOrderCreate(PurchaseOrderBase):
    pass

class PurchaseOrder(PurchaseOrderBase):
    id: str
    created_at: datetime
    is_active: bool

    class Config:
        orm_mode = True

# --- Stock IN ---
class StockINBase(BaseModel):
    po_id: str
    date: date
    qty: int
    note: Optional[str] = None

class StockINCreate(StockINBase):
    pass

class StockIN(StockINBase):
    id: str
    edited: bool

    class Config:
        orm_mode = True

# --- Stock OUT ---
class StockOUTBase(BaseModel):
    product_id: str
    po_id: str
    date: date
    qty: int
    note: Optional[str] = None

class StockOUTCreate(StockOUTBase):
    pass

class StockOUT(StockOUTBase):
    id: str
    invoice_id: Optional[str] = None

    class Config:
        orm_mode = True

# --- Invoice ---
class InvoiceBase(BaseModel):
    invoice_no: str
    date: date
    status: str = "Draft"

class InvoiceCreate(BaseModel):
    out_ids: List[str]  # IDs of StockOUTs to invoice

class Invoice(InvoiceBase):
    id: str
    print_count: int
    # outs: List[StockOUT] = []

    class Config:
        orm_mode = True

# --- History ---
class HistoryLog(BaseModel):
    id: int
    ts: datetime
    action: str
    by: str
    details: str
    ref_type: Optional[str] = None
    ref_id: Optional[str] = None

    class Config:
        orm_mode = True
