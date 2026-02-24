// Echo Tax Return — TypeScript Interfaces
// All D1 table types, request/response shapes, and env bindings

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;
  ENGINE_RUNTIME: Fetcher;
  SHARED_BRAIN: Fetcher;
  ENVIRONMENT: string;
  COMMANDER_EMAIL: string;
  ENGINE_RUNTIME_URL: string;
  SHARED_BRAIN_URL: string;
  ECHO_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  SSN_ENCRYPTION_KEY: string;
}

// ─── D1 Table Types ──────────────────────────────────────────

export type FilingStatus = 'single' | 'married_joint' | 'married_separate' | 'head_of_household' | 'widow';

export type ReturnStatus = 'intake' | 'documents' | 'calculating' | 'review' | 'filed' | 'accepted' | 'rejected';

export type DocType = 'w2' | '1099_int' | '1099_div' | '1099_nec' | '1099_misc' | '1099_b' | '1099_r' | '1099_ssa' | '1099_g' | 'receipt' | 'other';

export type IncomeCategory = 'wages' | 'interest' | 'dividends' | 'business' | 'capital_gains' | 'rental' | 'retirement' | 'social_security' | 'unemployment' | 'other';

export type DeductionCategory = 'medical' | 'salt' | 'mortgage_interest' | 'charitable' | 'business_expense' | 'student_loan' | 'ira' | 'hsa' | 'se_tax' | 'alimony' | 'educator' | 'other';

export type DeductionMethod = 'standard' | 'itemized';

export interface Client {
  id: string;
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  ssn_encrypted: string | null;
  dob: string | null;
  phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  filing_status: FilingStatus | null;
  created_at: string;
  updated_at: string;
}

export interface TaxReturn {
  id: string;
  client_id: string;
  tax_year: number;
  status: ReturnStatus;
  total_income: number;
  adjusted_gross_income: number;
  taxable_income: number;
  total_tax: number;
  total_payments: number;
  refund_or_owed: number;
  deduction_method: DeductionMethod | null;
  preparer_ptin: string | null;
  filed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaxDocument {
  id: string;
  return_id: string;
  doc_type: DocType;
  issuer_name: string | null;
  r2_key: string | null;
  ocr_text: string | null;
  parsed_data: string | null;
  status: 'uploaded' | 'processing' | 'parsed' | 'verified' | 'error';
  created_at: string;
}

export interface IncomeItem {
  id: string;
  return_id: string;
  document_id: string | null;
  category: IncomeCategory;
  description: string | null;
  amount: number;
  tax_withheld: number;
  form_line: string | null;
}

export interface Deduction {
  id: string;
  return_id: string;
  category: DeductionCategory;
  description: string | null;
  amount: number;
  schedule: string | null;
  form_line: string | null;
}

export interface Dependent {
  id: string;
  return_id: string;
  first_name: string | null;
  last_name: string | null;
  ssn_encrypted: string | null;
  dob: string | null;
  relationship: string | null;
  months_lived: number;
  qualifies_ctc: number;
  qualifies_odc: number;
}

export interface Payment {
  id: string;
  client_id: string;
  return_id: string | null;
  amount: number;
  stripe_session_id: string | null;
  status: 'pending' | 'completed' | 'refunded';
  created_at: string;
}

export interface Optimization {
  id: string;
  return_id: string;
  engine_id: string | null;
  category: 'deduction' | 'credit' | 'strategy' | 'timing';
  suggestion: string;
  potential_savings: number | null;
  confidence: number | null;
  doctrine_source: string | null;
  created_at: string;
}

// ─── Request Types ───────────────────────────────────────────

export interface CreateClientRequest {
  email?: string;
  first_name: string;
  last_name: string;
  ssn?: string;
  dob?: string;
  phone?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  filing_status?: FilingStatus;
}

export interface UpdateClientRequest extends Partial<CreateClientRequest> {}

export interface CreateReturnRequest {
  client_id: string;
  tax_year: number;
  preparer_ptin?: string;
}

export interface AddIncomeRequest {
  document_id?: string;
  category: IncomeCategory;
  description?: string;
  amount: number;
  tax_withheld?: number;
  form_line?: string;
}

export interface AddDeductionRequest {
  category: DeductionCategory;
  description?: string;
  amount: number;
  schedule?: string;
  form_line?: string;
}

export interface AddDependentRequest {
  first_name: string;
  last_name: string;
  ssn?: string;
  dob?: string;
  relationship?: string;
  months_lived?: number;
  qualifies_ctc?: boolean;
  qualifies_odc?: boolean;
}

// ─── Response Types ──────────────────────────────────────────

export interface TaxCalculation {
  return_id: string;
  tax_year: number;
  filing_status: FilingStatus;
  income_summary: {
    wages: number;
    interest: number;
    dividends: number;
    business: number;
    capital_gains: number;
    rental: number;
    retirement: number;
    social_security: number;
    other: number;
    total: number;
  };
  adjustments: {
    student_loan: number;
    ira: number;
    hsa: number;
    se_tax: number;
    educator: number;
    alimony: number;
    total: number;
  };
  agi: number;
  deductions: {
    standard: number;
    itemized: number;
    method: DeductionMethod;
    amount: number;
  };
  qbi_deduction: number;
  taxable_income: number;
  tax_bracket_detail: BracketDetail[];
  regular_tax: number;
  credits: {
    ctc: number;
    eitc: number;
    education: number;
    other: number;
    total: number;
  };
  other_taxes: {
    se_tax: number;
    amt: number;
    total: number;
  };
  total_tax: number;
  payments: {
    withholding: number;
    estimated: number;
    total: number;
  };
  refund_or_owed: number;
}

export interface BracketDetail {
  rate: number;
  range_start: number;
  range_end: number;
  taxable_in_bracket: number;
  tax_in_bracket: number;
}

export interface EngineOptimization {
  engine_id: string;
  domain: string;
  suggestions: Array<{
    category: string;
    suggestion: string;
    potential_savings: number;
    confidence: number;
    doctrine_source: string;
  }>;
}

export interface FormLine {
  line: string;
  description: string;
  amount: number;
}

export interface Form1040 {
  tax_year: number;
  filing_status: FilingStatus;
  taxpayer: {
    first_name: string;
    last_name: string;
    address: string;
  };
  dependents: Array<{ name: string; relationship: string }>;
  lines: FormLine[];
  schedules: {
    schedule_1?: FormLine[];
    schedule_2?: FormLine[];
    schedule_3?: FormLine[];
    schedule_a?: FormLine[];
    schedule_c?: FormLine[];
    schedule_se?: FormLine[];
  };
}
