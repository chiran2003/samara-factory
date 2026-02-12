from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, Date, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    code = Column(String, unique=True, index=True, nullable=False)
    rate = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)

    materials = relationship("Material", back_populates="product", cascade="all, delete-orphan")
    pos = relationship("PurchaseOrder", back_populates="product")
    outs = relationship("StockOUT", back_populates="product")


class Material(Base):
    __tablename__ = "materials"

    id = Column(String, primary_key=True, index=True)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

    product = relationship("Product", back_populates="materials")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String, primary_key=True, index=True)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    po_no = Column(String, unique=True, index=True, nullable=False)
    po_qty = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

    product = relationship("Product", back_populates="pos")
    ins = relationship("StockIN", back_populates="po", cascade="all, delete-orphan")
    outs = relationship("StockOUT", back_populates="po")


class StockIN(Base):
    __tablename__ = "stock_ins"

    id = Column(String, primary_key=True, index=True)
    po_id = Column(String, ForeignKey("purchase_orders.id"), nullable=False)
    date = Column(Date, nullable=False)
    qty = Column(Integer, nullable=False)
    note = Column(String, nullable=True)
    edited = Column(Boolean, default=False)

    po = relationship("PurchaseOrder", back_populates="ins")


class StockOUT(Base):
    __tablename__ = "stock_outs"

    id = Column(String, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    po_id = Column(String, ForeignKey("purchase_orders.id"), nullable=False)
    qty = Column(Integer, nullable=False)
    note = Column(String, nullable=True)
    invoice_id = Column(String, ForeignKey("invoices.id"), nullable=True)

    product = relationship("Product", back_populates="outs")
    po = relationship("PurchaseOrder", back_populates="outs")
    invoice = relationship("Invoice", back_populates="outs")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(String, primary_key=True, index=True)
    invoice_no = Column(String, unique=True, index=True, nullable=False)
    date = Column(Date, nullable=False)
    status = Column(String, default="Draft")  # Draft, Ready, Printed
    print_count = Column(Integer, default=0)

    outs = relationship("StockOUT", back_populates="invoice")


class HistoryLog(Base):
    __tablename__ = "history_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    ts = Column(DateTime, default=datetime.utcnow)
    action = Column(String, nullable=False)
    by = Column(String, default="Admin")
    details = Column(Text, nullable=True)
    ref_type = Column(String, nullable=True)  # e.g., 'product', 'invoice'
    ref_id = Column(String, nullable=True)
