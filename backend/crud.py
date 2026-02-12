from sqlalchemy.orm import Session
from models import Product, PurchaseOrder, Material, StockIN, StockOUT, Invoice, HistoryLog
from schemas import ProductCreate, PurchaseOrderCreate

def create_product(db: Session, product: ProductCreate):
    db_product = Product(**product.dict(), is_active=True)
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product

def get_products(db: Session, skip: int = 0, limit: int = 100):
   return db.query(Product).offset(skip).limit(limit).all()

def create_po(db: Session, po: PurchaseOrderCreate):
    db_po = PurchaseOrder(**po.dict(), is_active=True)
    db.add(db_po)
    db.commit()
    db.refresh(db_po)
    return db_po

def get_pos(db: Session, skip: int = 0, limit: int = 100):
   return db.query(PurchaseOrder).offset(skip).limit(limit).all()

def log_history(db: Session, action: str, details: str, ref_type: str = None, ref_id: str = None):
    log = HistoryLog(action=action, details=details, ref_type=ref_type, ref_id=ref_id, by="Admin")
    db.add(log)
    db.commit()
    return log
