export const ITEM_TYPES = [
  { value: 'laptop', label: 'Laptop' },
  { value: 'desktop_pc', label: 'Desktop PC' },
  { value: 'mobile_phone', label: 'Mobile Phone' },
  { value: 'printer', label: 'Printer' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'networking', label: 'Networking Equipment' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'software', label: 'Software' },
  { value: 'internet', label: 'Internet' },
  { value: 'repairs', label: 'Repairs' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'cloud', label: 'Cloud Services' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'other', label: 'Other' },
] as const;

export const PAYMENT_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
] as const;

export const APPROVAL_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
] as const;

export type ExpenditureLine = {
  id?: number;
  line_no?: number;
  item_name: string;
  description?: string | null;
  item_type: string;
  brand?: string | null;
  model?: string | null;
  quantity: number | string;
  unit_price_lkr: number | string;
  discount_lkr?: number | string;
  tax_lkr?: number | string;
  line_total_lkr?: number;
  counts_as_physical?: boolean;
  warranty_info?: string | null;
  linked_asset_type?: string | null;
  linked_asset_id?: number | null;
};

export type ExpenditureHeader = {
  id: number;
  reference_no: string;
  expense_date: string;
  company_id: number;
  company_code?: string;
  company_short?: string;
  location_id?: number | null;
  location_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
  supplier_display?: string | null;
  invoice_no?: string | null;
  po_capex_ref?: string | null;
  expense_category?: string | null;
  payment_status: string;
  payment_date?: string | null;
  amount_paid_lkr?: number;
  approval_status: string;
  is_voided?: boolean;
  remarks?: string | null;
  warranty_notes?: string | null;
  subtotal_lkr?: number;
  discount_total_lkr?: number;
  tax_total_lkr?: number;
  total_lkr?: number;
  outstanding_lkr?: number;
  line_count?: number;
  attachment_count?: number;
  lines?: ExpenditureLine[];
  line_items?: ExpenditureLine[];
  items_preview?: string | null;
  items_short?: string | null;
  physical_qty?: number;
  company_label?: string | null;
  attachments?: {
    id: number;
    doc_type: string;
    file_name: string;
    file_size?: number;
    created_at?: string;
  }[];
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ExpenditureListSummary = {
  total_spend: number;
  outstanding: number;
  transaction_count: number;
  physical_qty: number;
  by_company: {
    company_code: string;
    company_label: string;
    transaction_count: number;
    total_spend: number;
    outstanding: number;
    physical_qty: number;
  }[];
};

/** Asset row pulled from inventory into expenditure (price + acquired/purchase date). */
export type InventoryImportAsset = {
  asset_category: string;
  asset_id: number;
  asset_tag: string;
  item_name: string;
  item_type: string;
  brand?: string | null;
  model?: string | null;
  purchase_amount_lkr?: number | null;
  purchase_date?: string | null;
  acquired_date?: string | null;
  invoice_no?: string | null;
  company_id?: number | null;
  company_label?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
};

export function companyLabel(code?: string | null, short?: string | null): string {
  if (code === 'IT') return 'ITL';
  return short || code || '—';
}

export function itemTypeLabel(v: string): string {
  return ITEM_TYPES.find((t) => t.value === v)?.label ?? v.replace(/_/g, ' ');
}

export function formatLkr(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 'Rs. 0.00';
  return `Rs. ${v.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function lineTotal(qty: number, unit: number, disc: number, tax: number): number {
  return Math.round((qty * unit - disc + tax) * 100) / 100;
}

export function emptyLine(): ExpenditureLine {
  return {
    item_name: '',
    item_type: 'laptop',
    brand: '',
    model: '',
    quantity: 1,
    unit_price_lkr: 0,
    discount_lkr: 0,
    tax_lkr: 0,
    counts_as_physical: true,
  };
}
