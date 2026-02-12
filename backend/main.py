from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from datetime import date, datetime
from uuid import uuid4

from database import engine, get_db, Base
from models import Product, Material, PurchaseOrder, StockIN, StockOUT, Invoice, HistoryLog
import schemas

app = FastAPI(title="Samara Industry Factory System API")

# --- CORS ---
origins = [
    "*", # Allow all origins for simplicity in development
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables
Base.metadata.create_all(bind=engine)

def gen_id():
    return str(uuid4())

# --- Logging Helper ---
def log_history(db: Session, action: str, details: str, ref_type: str = None, ref_id: str = None):
    log = HistoryLog(ts=datetime.utcnow(), action=action, details=details, ref_type=ref_type, ref_id=ref_id, by="Admin")
    db.add(log)
    db.commit()

from datetime import datetime

# --- Products ---
@app.post("/products/", response_model=schemas.Product)
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db)):
    db_product = Product(id=gen_id(), **product.dict(), is_active=True)
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    log_history(db, "Product Created", f"Product {product.name} ({product.code}) created", "product", db_product.id)
    return db_product

@app.get("/products/", response_model=List[schemas.Product])
def read_products(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(Product).filter(Product.is_active == True).offset(skip).limit(limit).all()

@app.put("/products/{product_id}", response_model=schemas.Product)
def update_product(product_id: str, product: schemas.ProductCreate, db: Session = Depends(get_db)):
    db_product = db.query(Product).filter(Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    old_val = f"{db_product.name} ({db_product.code})"
    for key, value in product.dict().items():
        setattr(db_product, key, value)
    
    db.commit()
    db.refresh(db_product)
    log_history(db, "Product Updated", f"Product updated from {old_val} to {product.name} ({product.code})", "product", product_id)
    return db_product

@app.delete("/products/{product_id}")
def delete_product(product_id: str, db: Session = Depends(get_db)):
    db_product = db.query(Product).filter(Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    
    db_product.is_active = False
    db.commit()
    log_history(db, "Product Deleted", f"Product {db_product.name} ({db_product.code}) deleted", "product", product_id)
    return {"ok": True}

# --- Materials ---
@app.post("/materials/", response_model=schemas.Material)
def create_material(material: schemas.MaterialCreate, db: Session = Depends(get_db)):
    db_mat = Material(id=gen_id(), **material.dict(), is_active=True)
    db.add(db_mat)
    db.commit()
    db.refresh(db_mat)
    log_history(db, "Material Added", f"Material {material.name} added", "material", db_mat.id)
    return db_mat

@app.get("/products/{product_id}/materials/", response_model=List[schemas.Material])
def read_materials(product_id: str, db: Session = Depends(get_db)):
    return db.query(Material).filter(Material.product_id == product_id, Material.is_active == True).all()

@app.delete("/materials/{material_id}")
def delete_material(material_id: str, db: Session = Depends(get_db)):
    db_mat = db.query(Material).filter(Material.id == material_id).first()
    if not db_mat:
        raise HTTPException(status_code=404, detail="Material not found")
    
    db_mat.is_active = False
    db.commit()
    log_history(db, "Material Deleted", f"Material {db_mat.name} deleted", "material", material_id)
    return {"ok": True}

# --- POs ---
@app.post("/pos/", response_model=schemas.PurchaseOrder)
def create_po(po: schemas.PurchaseOrderCreate, db: Session = Depends(get_db)):
    # Check if PO exists
    exists = db.query(PurchaseOrder).filter(PurchaseOrder.po_no == po.po_no).first()
    if exists:
        raise HTTPException(status_code=400, detail="PO Number already exists")
        
    db_po = PurchaseOrder(id=gen_id(), **po.dict(),  created_at=datetime.utcnow(), is_active=True)
    db.add(db_po)
    db.commit()
    db.refresh(db_po)
    log_history(db, "PO Created", f"PO {po.po_no} (Qty {po.po_qty}) created", "po", db_po.id)
    return db_po

@app.get("/pos/", response_model=List[schemas.PurchaseOrder])
def read_pos(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(PurchaseOrder).filter(PurchaseOrder.is_active == True).offset(skip).limit(limit).all()

# --- Stock IN ---
@app.post("/ins/", response_model=schemas.StockIN)
def create_stock_in(stock_in: schemas.StockINCreate, db: Session = Depends(get_db)):
    db_in = StockIN(id=gen_id(), **stock_in.dict(), edited=False)
    db.add(db_in)
    db.commit()
    db.refresh(db_in)
    
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == stock_in.po_id).first()
    po_no = po.po_no if po else "Unknown PO"
    
    log_history(db, "Stock IN Added", f"IN Qty {stock_in.qty} for PO {po_no}", "stock_in", db_in.id)
    return db_in

@app.get("/pos/{po_id}/ins/", response_model=List[schemas.StockIN])
def read_stock_ins(po_id: str, db: Session = Depends(get_db)):
    return db.query(StockIN).filter(StockIN.po_id == po_id).all()

@app.put("/ins/{in_id}", response_model=schemas.StockIN)
def update_stock_in(in_id: str, stock_in: schemas.StockINCreate, db: Session = Depends(get_db)):
    db_in = db.query(StockIN).filter(StockIN.id == in_id).first()
    if not db_in:
        raise HTTPException(status_code=404, detail="Stock IN entry not found")
        
    old_qty = db_in.qty
    
    # Check if reducing stock would make OUT > IN for this PO
    if stock_in.qty < old_qty:
        # Calculate total IN excluding this one + new qty
        total_in_others = db.query(StockIN).filter(StockIN.po_id == db_in.po_id, StockIN.id != in_id).all()
        sum_in = sum(i.qty for i in total_in_others) + stock_in.qty
        
        # Calculate total OUT
        total_out = db.query(StockOUT).filter(StockOUT.po_id == db_in.po_id).all()
        sum_out = sum(o.qty for o in total_out)
        
        if sum_in < sum_out:
            raise HTTPException(status_code=400, detail=f"Cannot reduce Stock IN to {stock_in.qty}. Total OUT is {sum_out}, which would exceed total IN {sum_in}.")

    db_in.date = stock_in.date
    db_in.qty = stock_in.qty
    db_in.note = stock_in.note
    db_in.edited = True
    
    db.commit()
    db.refresh(db_in)
    log_history(db, "Stock IN Updated", f"IN updated from {old_qty} to {stock_in.qty}", "stock_in", in_id)
    return db_in

@app.delete("/ins/{in_id}")
def delete_stock_in(in_id: str, db: Session = Depends(get_db)):
    db_in = db.query(StockIN).filter(StockIN.id == in_id).first()
    if not db_in:
        raise HTTPException(status_code=404, detail="Stock IN entry not found")

    # Validate stock usage
    total_in_others = db.query(StockIN).filter(StockIN.po_id == db_in.po_id, StockIN.id != in_id).all()
    sum_in = sum(i.qty for i in total_in_others)
    
    total_out = db.query(StockOUT).filter(StockOUT.po_id == db_in.po_id).all()
    sum_out = sum(o.qty for o in total_out)
    
    if sum_in < sum_out:
        raise HTTPException(status_code=400, detail=f"Cannot delete Stock IN. Remaining IN ({sum_in}) would be less than Total OUT ({sum_out}).")

    db.delete(db_in) # Hard delete or soft? Let's do hard since it's a mistake correction.
    db.commit()
    log_history(db, "Stock IN Deleted", f"IN entry of {db_in.qty} deleted", "stock_in", in_id)
    return {"ok": True}

# --- Stock OUT ---
@app.post("/outs/", response_model=schemas.StockOUT)
def create_stock_out(stock_out: schemas.StockOUTCreate, db: Session = Depends(get_db)):
    # Validate available stock
    total_in = db.query(StockIN).filter(StockIN.po_id == stock_out.po_id).all()
    sum_in = sum(i.qty for i in total_in)
    
    total_out = db.query(StockOUT).filter(StockOUT.po_id == stock_out.po_id).all()
    sum_out = sum(o.qty for o in total_out)
    
    available = sum_in - sum_out
    if stock_out.qty > available:
        raise HTTPException(status_code=400, detail=f"Insufficient stock. Available: {available}, Requested: {stock_out.qty}")

    db_out = StockOUT(id=gen_id(), **stock_out.dict(), invoice_id=None)
    db.add(db_out)
    db.commit()
    db.refresh(db_out)
    
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == stock_out.po_id).first()
    po_no = po.po_no if po else "Unknown PO"
    
    log_history(db, "Stock OUT Added", f"OUT Qty {stock_out.qty} for PO {po_no}", "stock_out", db_out.id)
    return db_out

@app.get("/outs/", response_model=List[schemas.StockOUT])
def read_stock_outs(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(StockOUT).order_by(StockOUT.date.desc()).offset(skip).limit(limit).all()

# --- Invoices ---
@app.post("/invoices/", response_model=schemas.Invoice)
def create_invoice(invoice_req: schemas.InvoiceCreate, db: Session = Depends(get_db)):
    # 1. Generate Invoice No (simple logic for now, ideally count + 1 from DB)
    count = db.query(Invoice).count() + 1
    inv_no = f"SI-{str(count).zfill(5)}"
    
    # 2. Create Invoice
    db_inv = Invoice(
        id=gen_id(), 
        invoice_no=inv_no, 
        date=datetime.utcnow().date(), 
        status="Draft", 
        print_count=0
    )
    db.add(db_inv)
    db.commit()
    
    # 3. Associate OUTs
    out_ids = invoice_req.out_ids
    # Verify no OUTs already invoiced
    outs = db.query(StockOUT).filter(StockOUT.id.in_(out_ids)).all()
    for o in outs:
        if o.invoice_id:
             raise HTTPException(status_code=400, detail=f"Stock OUT {o.id} is already invoiced.")
        o.invoice_id = db_inv.id
    
    db.commit()
    db.refresh(db_inv)
    
    log_history(db, "Invoice Created", f"Invoice {inv_no} created with {len(out_ids)} items", "invoice", db_inv.id)
    return db_inv

@app.get("/invoices/", response_model=List[schemas.Invoice])
def read_invoices(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(Invoice).order_by(Invoice.date.desc()).offset(skip).limit(limit).all()

@app.put("/invoices/{invoice_id}/status")
def update_invoice_status(invoice_id: str, status_val: str, db: Session = Depends(get_db)):
    db_inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not db_inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
        
    old_status = db_inv.status
    db_inv.status = status_val
    if status_val == "Printed":
        db_inv.print_count += 1
        
    db.commit()
    log_history(db, "Invoice Status Changed", f"Invoice {db_inv.invoice_no} status: {old_status} -> {status_val}", "invoice", invoice_id)
    return {"ok": True, "status": status_val, "print_count": db_inv.print_count}

@app.post("/invoices/{invoice_id}/items", response_model=schemas.Invoice)
def add_invoice_items(invoice_id: str, item_update: schemas.InvoiceUpdateItems, db: Session = Depends(get_db)):
    db_inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not db_inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
        
    if db_inv.status == "Printed":
         raise HTTPException(status_code=400, detail="Cannot edit a Printed invoice.")

    outs = db.query(StockOUT).filter(StockOUT.id.in_(item_update.out_ids)).all()
    for o in outs:
        if o.invoice_id and o.invoice_id != invoice_id:
             raise HTTPException(status_code=400, detail=f"Stock OUT {o.id} is already in another invoice.")
        o.invoice_id = invoice_id
    
    db.commit()
    db.refresh(db_inv)
    log_history(db, "Invoice Updated", f"Added {len(outs)} items to Invoice {db_inv.invoice_no}", "invoice", invoice_id)
    return db_inv

@app.delete("/invoices/{invoice_id}/items/{out_id}")
def remove_invoice_item(invoice_id: str, out_id: str, db: Session = Depends(get_db)):
    db_inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not db_inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if db_inv.status == "Printed":
         raise HTTPException(status_code=400, detail="Cannot edit a Printed invoice.")

    db_out = db.query(StockOUT).filter(StockOUT.id == out_id, StockOUT.invoice_id == invoice_id).first()
    if not db_out:
        raise HTTPException(status_code=404, detail="Item not found in this invoice")
        
    db_out.invoice_id = None
    db.commit()
    log_history(db, "Invoice Updated", f"Removed item from Invoice {db_inv.invoice_no}", "invoice", invoice_id)
    return {"ok": True}
# --- History ---
@app.get("/history/", response_model=List[schemas.HistoryLog])
def read_history(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(HistoryLog).order_by(HistoryLog.ts.desc()).offset(skip).limit(limit).all()
