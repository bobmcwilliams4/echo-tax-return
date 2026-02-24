-- Echo Tax Return — D1 Schema
-- Database: echo-tax-return (0720791f-bc13-49c2-a75d-18ba13ffe1e3)

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  ssn_encrypted TEXT,
  dob TEXT,
  phone TEXT,
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  filing_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  tax_year INTEGER NOT NULL,
  status TEXT DEFAULT 'intake',
  total_income REAL DEFAULT 0,
  adjusted_gross_income REAL DEFAULT 0,
  taxable_income REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  total_payments REAL DEFAULT 0,
  refund_or_owed REAL DEFAULT 0,
  deduction_method TEXT,
  preparer_ptin TEXT,
  filed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  doc_type TEXT NOT NULL,
  issuer_name TEXT,
  r2_key TEXT,
  ocr_text TEXT,
  parsed_data TEXT,
  status TEXT DEFAULT 'uploaded',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  document_id TEXT REFERENCES documents(id),
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  tax_withheld REAL DEFAULT 0,
  form_line TEXT
);

CREATE TABLE IF NOT EXISTS deductions (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  schedule TEXT,
  form_line TEXT
);

CREATE TABLE IF NOT EXISTS dependents (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  first_name TEXT,
  last_name TEXT,
  ssn_encrypted TEXT,
  dob TEXT,
  relationship TEXT,
  months_lived INTEGER DEFAULT 12,
  qualifies_ctc INTEGER DEFAULT 0,
  qualifies_odc INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  return_id TEXT REFERENCES returns(id),
  amount REAL NOT NULL,
  stripe_session_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS optimizations (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  engine_id TEXT,
  category TEXT,
  suggestion TEXT NOT NULL,
  potential_savings REAL,
  confidence REAL,
  doctrine_source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_returns_client_id ON returns(client_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_tax_year ON returns(tax_year);
CREATE INDEX IF NOT EXISTS idx_documents_return_id ON documents(return_id);
CREATE INDEX IF NOT EXISTS idx_income_items_return_id ON income_items(return_id);
CREATE INDEX IF NOT EXISTS idx_deductions_return_id ON deductions(return_id);
CREATE INDEX IF NOT EXISTS idx_dependents_return_id ON dependents(return_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_optimizations_return_id ON optimizations(return_id);
