import {
  FormEvent,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ActionsMenu from '../components/ActionsMenu';
import AssetAttachments, { uploadStagedAssetFiles } from '../components/AssetAttachments';
import AssetQrModal from '../components/AssetQrModal';
import EmployeeNameInput from '../components/EmployeeNameInput';
import AssetIcon from '../components/ui/AssetIcon';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import PageHeader from '../components/ui/PageHeader';
import StatusBadge, {
  assetStatusLabel,
  assetStatusTone,
  type BadgeTone,
} from '../components/ui/StatusBadge';
import TableSettingsMenu, { type PageSize } from '../components/ui/TableSettingsMenu';
import PaginationBar from '../components/ui/PaginationBar';
import { api } from '../services/client';
import { clearOrgMetaCache, getOrgMeta } from '../services/metaCache';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ui/Toast';
import AssetLifecycleTimeline from './AssetLifecycleTimeline';
import PcKitPanel from './PcKitPanel';
import PcReplaceHardwareModal from './PcReplaceHardwareModal';
import { DATE_INPUT_MIN as DATE_MIN } from '../lib/dateInput';

const PAGE_SIZE_KEY = 'itams.assets.pageSize';

function readStoredPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (raw === 5 || raw === 10 || raw === 20 || raw === 50 || raw === 100 || raw === 500) return raw;
  } catch {
    /* ignore */
  }
  return 50;
}
type Asset = Record<string, unknown>;
type Company = { id: number; code: string; short_name: string; name: string };
type Loc = { id: number; company_id: number; code?: string; name: string };
type Dept = { id: number; company_id: number; code?: string; name: string; location_id?: number | null };

type CategoryTab = 'all' | 'laptop' | 'mobile_phone' | 'pc' | 'others';
type CompanyTab = 'IT' | 'IMS' | 'ISP' | 'SIM';

/** Head-office location codes — always first / default in PC Inventory & Other assets */
const HEAD_OFFICE_CODES: Record<CompanyTab, string[]> = {
  IT: ['KANDY_HO'],
  IMS: ['BR_201'],
  ISP: ['KANDY'],
  SIM: ['SIM_POOL', 'KANDY_HO'],
};

/** Default branch for PC Inventory / Other assets (ITL → Head Office - Kandy). */
function headOfficeLocationId(
  companyTab: CompanyTab,
  companyLocations: { id: number; code?: string; name: string }[],
): number | null {
  const headCodes = HEAD_OFFICE_CODES[companyTab] ?? [];
  for (const code of headCodes) {
    const hit = companyLocations.find((l) => (l.code ?? '').toUpperCase() === code);
    if (hit) return hit.id;
  }
  const byName = companyLocations.find(
    (l) => /head\s*office/i.test(l.name) && /kandy/i.test(l.name),
  );
  if (byName) return byName.id;
  return companyLocations[0]?.id ?? null;
}

const CATEGORY_FROM_PATH: Record<string, CategoryTab> = {
  all: 'all',
  laptop: 'laptop',
  'mobile-phones': 'mobile_phone',
  pc: 'pc',
  others: 'others',
};

const CATEGORY_TITLES: Record<CategoryTab, string> = {
  all: 'PC Inventory',
  laptop: 'Laptops',
  mobile_phone: 'Mobile Phones',
  pc: 'Newly Purchased PCs',
  others: 'Other assets',
};

const OTHER_ITEM_OPTIONS = [
  'Printers',
  'Access point',
  'Pendrives',
  'Other essentials',
] as const;

const COMPANY_TABS: { id: CompanyTab; label: string }[] = [
  { id: 'IT', label: 'ITL' },
  { id: 'IMS', label: 'IMS' },
  { id: 'ISP', label: 'ISP' },
  { id: 'SIM', label: 'SIM' },
];

/** SIM company tab is only for Mobile phones */
function companyTabsForCategory(category: CategoryTab): { id: CompanyTab; label: string }[] {
  if (category === 'mobile_phone') return COMPANY_TABS;
  return COMPANY_TABS.filter((t) => t.id !== 'SIM');
}

/** PC assignment chain max (backend HandoverSlotSync::MAX_PERSONS_PC). */
const MAX_CHAIN_PERSONS_PC = 8;
/** Laptop / phone handover chain max. */
const MAX_CHAIN_PERSONS_DEFAULT = 4;
/** SIM cards: up to 10 employees in the handover chain. */
const MAX_CHAIN_PERSONS_SIM = 10;
/** Always show this many slots for PCs; scroll when the chain grows past this. */
const VISIBLE_CHAIN_SLOTS = 4;
const CHAIN_ORDS = [
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
  '6th',
  '7th',
  '8th',
  '9th',
  '10th',
] as const;

type SimCompanyCode = 'IT' | 'IMS' | 'ISP';

function maxChainPersons(category: string, asset?: { is_sim?: unknown } | null): number {
  if (category === 'pc') return MAX_CHAIN_PERSONS_PC;
  if (category === 'mobile_phone' && asBool(asset?.is_sim)) return MAX_CHAIN_PERSONS_SIM;
  return MAX_CHAIN_PERSONS_DEFAULT;
}

function companyUiLabel(code?: unknown): string {
  const c = String(code ?? '')
    .trim()
    .toUpperCase();
  if (c === 'IT' || c === 'ITL') return 'ITL';
  if (c === 'IMS') return 'IMS';
  if (c === 'ISP') return 'ISP';
  if (c === 'SIM') return 'SIM';
  if (c === 'FOTON') return 'Foton';
  return c || '—';
}

function chainOrdinal(n: number): string {
  return CHAIN_ORDS[n - 1] ?? `${n}th`;
}

function chainSlotTitle(n: number, isPc: boolean): string {
  if (n === 1) return isPc ? '1st Assignee (Original)' : '1st Custodian (Original)';
  return isPc ? `${chainOrdinal(n)} Assignee` : `${chainOrdinal(n)} Handover Person`;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 't' || v === 'true';
}

const emptyForm = {
  name: '',
  department_id: '',
  location_id: '',
  serial_number: '',
  supplier: '',
  invoice_no: '',
  brand: '',
  model: '',
  amount: '',
  capacity: '',
  hdd: '',
  ssd: '',
  processor: '',
  ram: '',
  other: '',
  date: '',
  warranty: '',
  warranty_period: '',
  item_name: '',
  specification: '',
  handover_date: '',
  other_category: 'other',
  imei_number: '',
  imei_number_2: '',
  phone_number: '',
  first_handover_person: '',
  handed_over_on: '',
  return_date: '',
  status: 'available',
  monitor_brand: '',
  windows_version: '',
  has_power_cable: true,
  has_vga_cable: true,
  has_keyboard: true,
  has_mouse: false,
  has_ups: true,
  ups_brand: '',
  ups_model: '650',
  ups_purchase_date: '',
  ups_warranty_period: '',
  ups_warranty_expires_on: '',
  has_charger: true,
  has_data_cable: true,
  has_back_cover: true,
  /** new = top of list; old = legacy/pre-Excel stock at bottom */
  entry_type: 'new' as 'new' | 'old',
};

const STATUS_OPTIONS: { value: string; label: string; tone: BadgeTone }[] = [
  { value: 'available', label: 'Available', tone: 'available' },
  { value: 'deployed', label: 'Assigned', tone: 'assigned' },
  { value: 'under_repair', label: 'Under repair', tone: 'repair' },
  { value: 'lost', label: 'Lost / stolen', tone: 'lost' },
  { value: 'disposed', label: 'Disposed', tone: 'disposed' },
];

const UPS_BRAND_OPTIONS = ['Prolink', 'DCP', 'Hikvision'] as const;

const WINDOWS_VERSION_OPTIONS = [
  'Windows 11',
  'Windows 10',
  'Windows 8',
  'Windows 7',
] as const;

/** Shared PC / UPS warranty period choices */
const WARRANTY_PERIOD_OPTIONS = [
  '3 months',
  '6 months',
  '1 year',
  '2 years',
  'Expired',
] as const;

/** Other assets warranty period choices */
const OTHER_WARRANTY_PERIOD_OPTIONS = [
  '3 months',
  '6 months',
  '1 year',
  '2 years',
  '3 years',
] as const;

function dash(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/** Format GB values without trailing .0 (e.g. 8.0 → "8", 8.5 → "8.5") */
function formatGb(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return String(v).trim();
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Parse user-entered GB (accepts "8", "8GB", "500 GB") → number or null */
function parseGbInput(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (raw === '') return null;
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Laptop standard warranty: purchase date + 2 years → warranty void date */
function warrantyVoidFromPurchase(purchaseDate: string): string {
  return warrantyExpiryFromPeriod(purchaseDate, '2 years');
}

/** Add a warranty period (3 months / 6 months / 1 year / 2 years) to a start date. */
function warrantyExpiryFromPeriod(startDate: string, period: string): string {
  const p = period.trim().toLowerCase();
  if (p === 'expired') return '';
  const raw = startDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return '';
  if (p === '3 months' || p === '3 month') {
    dt.setUTCMonth(dt.getUTCMonth() + 3);
  } else if (p === '6 months' || p === '6 month') {
    dt.setUTCMonth(dt.getUTCMonth() + 6);
  } else if (p === '1 year' || p === '1 years') {
    dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  } else if (p === '2 years' || p === '2 year') {
    dt.setUTCFullYear(dt.getUTCFullYear() + 2);
  } else if (p === '3 years' || p === '3 year') {
    dt.setUTCFullYear(dt.getUTCFullYear() + 3);
  } else {
    return '';
  }
  return dt.toISOString().slice(0, 10);
}

/** Mobile phone warranty: original handover date + 1 year → warranty void date */
function warrantyVoidFromHandover(handoverDate: string): string {
  const raw = handoverDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return '';
  dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  return dt.toISOString().slice(0, 10);
}

function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Temporary custody label while an asset is Available after Mark returned (not a person). */
const IT_CUSTODY_HOLDER = 'IT Department';

function isItCustodyHolder(name: string): boolean {
  return name.trim().toLowerCase() === IT_CUSTODY_HOLDER.toLowerCase();
}

function currentHolderName(r: Asset): string {
  // Prefer real current allocation; avoid treating originally-assigned / slot 1 as "holds now"
  const name =
    r.allocated_person ??
    r.current_holder ??
    (r.handover_open ? r.assigned_person_name : null) ??
    (r.handover_open ? r.pc_name : null);
  const trimmed = name == null || String(name).trim() === '' ? '' : String(name).trim();
  if (trimmed) return trimmed;
  // Available with no person → show IT Department custody in the list
  if (String(r.status ?? '').toLowerCase() === 'available') return IT_CUSTODY_HOLDER;
  return '';
}

function isCurrentHolderOriginal(r: Asset): boolean {
  const holder = currentHolderName(r);
  if (!holder || isItCustodyHolder(holder)) return false;
  const original = r.original_assigned_person != null ? String(r.original_assigned_person) : '';
  return (
    r.allocated_is_original === true ||
    r.allocated_is_original === 't' ||
    (original !== '' && original.toLowerCase() === holder.toLowerCase())
  );
}

function PersonNameCell({
  name,
  sign,
}: {
  name: string;
  sign?: 'current' | 'original' | 'holds_now' | null;
}) {
  if (!name) return <>{'—'}</>;
  return (
    <span className="person-name-cell">
      <strong className="person-name-text" title={name}>
        {name}
      </strong>
      {sign === 'holds_now' ? (
        <span className="person-sign holds-now">Holds now</span>
      ) : null}
      {sign === 'current' ? (
        <span className="person-sign current-holder">Current holder</span>
      ) : null}
      {sign === 'original' ? (
        <span className="person-sign originally-assigned">Originally assigned</span>
      ) : null}
    </span>
  );
}

function AssetStatusPill({ r }: { r: Asset }) {
  const status = String(r.status ?? 'available');
  return (
    <StatusBadge
      label={assetStatusLabel(status)}
      tone={assetStatusTone(status)}
      withIcon
    />
  );
}

function assetToForm(a: Asset): typeof emptyForm {
  const category = String(a.category ?? '');
  const isPersonAsset = category === 'laptop' || category === 'mobile_phone';
  const isOtherAsset = category === 'other' || category === 'printer';
  const holderName = isPersonAsset
    ? str(a.allocated_person ?? a.current_holder ?? a.assigned_person_name ?? a.pc_name)
    : isOtherAsset
      ? str(a.user_name ?? a.pc_name)
      : str(a.allocated_person ?? a.current_holder ?? a.pc_name);
  return {
    ...emptyForm,
    name: holderName,
    department_id: a.department_id != null ? String(a.department_id) : '',
    location_id: a.location_id != null ? String(a.location_id) : '',
    serial_number: str(a.serial_number),
    supplier: str(a.supplier_name),
    invoice_no: str(a.invoice_no),
    brand: str(a.brand),
    model: str(a.model),
    amount: a.purchase_amount_lkr != null ? String(a.purchase_amount_lkr) : '',
    capacity: a.storage_gb != null ? formatGb(a.storage_gb) : '',
    // Laptops: prefer dedicated SSD/HDD; legacy single storage_gb maps to SSD
    hdd:
      a.hdd_gb != null
        ? formatGb(a.hdd_gb)
        : category === 'laptop' &&
            a.ssd_gb == null &&
            a.storage_gb != null &&
            String(a.storage_type ?? '').toLowerCase() === 'hdd'
          ? formatGb(a.storage_gb)
          : '',
    ssd:
      a.ssd_gb != null
        ? formatGb(a.ssd_gb)
        : category === 'laptop' &&
            a.hdd_gb == null &&
            a.storage_gb != null &&
            String(a.storage_type ?? '').toLowerCase() !== 'hdd'
          ? formatGb(a.storage_gb)
          : '',
    processor: str(a.cpu),
    ram: a.ram_gb != null ? formatGb(a.ram_gb) : '',
    other: str(a.notes),
    date: str(a.purchase_date).slice(0, 10),
    warranty: str(a.warranty_expires_on).slice(0, 10),
    warranty_period: str(a.warranty_period),
    item_name: str(a.item_name),
    specification: str(a.specification),
    handover_date: str(a.handover_date).slice(0, 10),
    other_category: category === 'printer' || category === 'other' ? category : 'other',
    imei_number: str(a.imei_number),
    imei_number_2: str(a.imei_number_2),
    phone_number: str(a.phone_number),
    first_handover_person: str(a.first_handover_person),
    handed_over_on: str(a.handed_over_on).slice(0, 10),
    return_date: str(a.asset_return_date ?? a.return_date).slice(0, 10),
    status: str(a.status) || 'available',
    monitor_brand: str(a.monitor_brand),
    windows_version: str(a.windows_version),
    has_power_cable: asBool(a.has_power_cable),
    has_vga_cable: asBool(a.has_vga_cable),
    has_keyboard: asBool(a.has_keyboard),
    has_mouse: asBool(a.has_mouse),
    has_ups: asBool(a.has_ups),
    ups_brand: str(a.ups_brand),
    ups_model: str(a.ups_model) || (asBool(a.has_ups) ? '650' : ''),
    ups_purchase_date: str(a.ups_purchase_date).slice(0, 10),
    ups_warranty_period: str(a.ups_warranty_period),
    ups_warranty_expires_on: str(a.ups_warranty_expires_on).slice(0, 10),
    has_charger: a.has_charger === undefined || a.has_charger === null ? true : asBool(a.has_charger),
    has_data_cable:
      a.has_data_cable === undefined || a.has_data_cable === null ? true : asBool(a.has_data_cable),
    has_back_cover:
      a.has_back_cover === undefined || a.has_back_cover === null ? true : asBool(a.has_back_cover),
    entry_type: asBool(a.is_legacy) ? 'old' : 'new',
  };
}

export default function AssetsPage() {
  const { category: categorySlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const openedViewRef = useRef<string | null>(null);
  /** When opened from a report via ?returnTo=, close view returns there instead of staying on Assets. */
  const returnToRef = useRef<string | null>(null);
  /** When Update/Transfer is opened from the record view, closing edit restores that same view. */
  const returnToViewRef = useRef<{ id: number; category: string } | null>(null);
  const canManageKit = ['super_admin', 'it_admin', 'it_staff'].includes(user?.role ?? '');
  const categoryTab = categorySlug ? CATEGORY_FROM_PATH[categorySlug] : undefined;
  const activeCategory: CategoryTab = categoryTab ?? 'laptop';
  const isAllView = activeCategory === 'all';
  /** PCs tab = newly purchased register; All Branch = full location-tabbed fleet */
  const isPcStockView = activeCategory === 'pc';

  const [rows, setRows] = useState<Asset[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [q, setQ] = useState(() => searchParams.get('q') ?? '');
  const [error, setError] = useState('');
  const [companyTab, setCompanyTab] = useState<CompanyTab>('IT');
  /** Owning company for SIM cards (ITL / IMS / ISP) — used on the SIM tab form. */
  const [simFormCompany, setSimFormCompany] = useState<SimCompanyCode>('IT');
  const [locationTab, setLocationTab] = useState<number | null>(null);
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [editModalTab, setEditModalTab] = useState<
    'details' | 'handovers' | 'lifecycle' | 'kit' | 'attachments'
  >('details');
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
  const [editFormSection, setEditFormSection] = useState<
    'assignment' | 'device' | 'procurement' | 'warranty' | 'notes'
  >('assignment');
  const [statusHistory, setStatusHistory] = useState<
    { id: number; from_status?: string; to_status?: string; note?: string; created_at?: string; changed_by_name?: string }[]
  >([]);
  const [lostDateModalOpen, setLostDateModalOpen] = useState(false);
  const [lostEventDate, setLostEventDate] = useState('');
  const [statusEventNote, setStatusEventNote] = useState('');
  const [lifecycleRefreshKey, setLifecycleRefreshKey] = useState(0);
  const [pcReplaceOpen, setPcReplaceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);
  const [companyTransferAsset, setCompanyTransferAsset] = useState<Asset | null>(null);
  const [handoverForm, setHandoverForm] = useState({ person: '', date: '', remarks: '' });
  const [handoverSaving, setHandoverSaving] = useState(false);
  /** Mobile phone next-handover: confirm location / SIM / accessories before checkout */
  const [phoneHandoverDetails, setPhoneHandoverDetails] = useState<{
    location_id: string;
    department_id: string;
    phone_number: string;
    has_charger: boolean;
    has_data_cable: boolean;
    has_back_cover: boolean;
    remarks: string;
  } | null>(null);
  /** Mark returned: confirm accessories + capture return remarks */
  const [returnPopup, setReturnPopup] = useState<{
    handoverId: number;
    person: string;
    category: string;
    has_charger: boolean;
    has_data_cable: boolean;
    has_back_cover: boolean;
    accessoriesNote: string;
    remarks: string;
  } | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(() => readStoredPageSize());
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [newCount, setNewCount] = useState(0);
  const [oldCount, setOldCount] = useState(0);
  const [oldStockFromPage, setOldStockFromPage] = useState<number | null>(null);
  const assetsAbort = useRef<AbortController | null>(null);
  const assetsLoadGen = useRef(0);

  const isSimTab = categoryTab === 'mobile_phone' && companyTab === 'SIM';

  const activeCompany = useMemo(
    () => companies.find((c) => c.code === companyTab) ?? null,
    [companies, companyTab],
  );

  const simOwningCompany = useMemo(
    () => companies.find((c) => c.code === simFormCompany) ?? null,
    [companies, simFormCompany],
  );

  const createCategory =
    activeCategory === 'all'
      ? 'pc'
      : activeCategory === 'others'
        ? 'other'
        : activeCategory;

  const formCategory = editingCategory ?? createCategory;
  const isLaptopForm = formCategory === 'laptop';
  const isPcForm = formCategory === 'pc';
  const isPhoneForm = formCategory === 'mobile_phone';
  const isSimForm =
    isPhoneForm &&
    (asBool(editAsset?.is_sim) || (isSimTab && showAddModal));
  const isStudioForm = isLaptopForm || isPcForm || isPhoneForm;

  /** Company used for location / department dropdowns (SIM form uses ITL/IMS/ISP). */
  const formOrgCompany = isSimForm ? simOwningCompany : activeCompany;

  const companyLocations = useMemo(() => {
    const orgCode = isSimForm
      ? simFormCompany
      : isSimTab
        ? null
        : companyTab;
    const orgId = isSimForm
      ? formOrgCompany?.id
      : isSimTab
        ? null
        : activeCompany?.id;
    const simCompanyIds = isSimTab && !isSimForm
      ? new Set(
          companies
            .filter((c) => ['IT', 'IMS', 'ISP', 'SIM'].includes(String(c.code ?? '').toUpperCase()))
            .map((c) => c.id),
        )
      : null;
    const list = locations.filter((l) => {
      if (simCompanyIds) {
        if (!simCompanyIds.has(l.company_id)) return false;
      } else if (orgId != null && l.company_id !== orgId) {
        return false;
      }
      const code = (l.code ?? '').toUpperCase();
      // Drop generic schema seeds that aren't part of the branch list
      if (code === 'CMB_BR') return false;
      if (code === 'SIM_POOL') return false;
      if (orgCode === 'ISP' && code === 'KANDY_HO') return false;
      if (orgCode === 'IMS' && code === 'KANDY_HO') return false;
      return true;
    });
    const headCodes = HEAD_OFFICE_CODES[(orgCode as CompanyTab) || 'IT'] ?? [];
    return [...list].sort((a, b) => {
      const aCode = (a.code ?? '').toUpperCase();
      const bCode = (b.code ?? '').toUpperCase();
      const aHead = headCodes.indexOf(aCode);
      const bHead = headCodes.indexOf(bCode);
      const aRank = aHead >= 0 ? aHead : 999;
      const bRank = bHead >= 0 ? bHead : 999;
      if (aRank !== bRank) return aRank - bRank;
      // Keep ITL Foton branches together after regular branches
      const aFoton = aCode.startsWith('FOTON_') || /\bfoton\b/i.test(a.name) ? 1 : 0;
      const bFoton = bCode.startsWith('FOTON_') || /\bfoton\b/i.test(b.name) ? 1 : 0;
      if (aFoton !== bFoton) return aFoton - bFoton;
      return a.name.localeCompare(b.name);
    });
  }, [
    locations,
    activeCompany,
    companyTab,
    companies,
    isSimTab,
    isSimForm,
    simFormCompany,
    formOrgCompany,
  ]);

  const selectedLocation = useMemo(
    () => (locationTab != null ? companyLocations.find((l) => l.id === locationTab) ?? null : null),
    [locationTab, companyLocations],
  );

  const companyDepartments = useMemo(() => {
    const orgId = isSimForm
      ? formOrgCompany?.id
      : isSimTab
        ? null
        : activeCompany?.id;
    const simCompanyIds =
      isSimTab && !isSimForm
        ? new Set(
            companies
              .filter((c) => ['IT', 'IMS', 'ISP', 'SIM'].includes(String(c.code ?? '').toUpperCase()))
              .map((c) => c.id),
          )
        : null;
    const list = departments.filter((d) => {
      if (simCompanyIds) return simCompanyIds.has(d.company_id);
      if (orgId != null) return d.company_id === orgId;
      return true;
    });
    const orderCode = isSimForm ? simFormCompany : companyTab;
    const order =
      orderCode === 'IT'
        ? ['IT', 'HR', 'AUDIT', 'ADMIN', 'MAINTENANCE', 'IMPORT', 'ACCOUNTS', 'SALES', 'LEGAL', 'OTHER']
        : ['ACCOUNTS', 'SALES'];
    return [...list].sort((a, b) => {
      const ai = order.indexOf(String(a.code ?? '').toUpperCase());
      const bi = order.indexOf(String(b.code ?? '').toUpperCase());
      if (ai === -1 && bi === -1) return String(a.name).localeCompare(String(b.name));
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [
    departments,
    activeCompany,
    companyTab,
    companies,
    isSimTab,
    isSimForm,
    simFormCompany,
    formOrgCompany,
  ]);
  const canHandoverEdit =
    editingCategory === 'laptop' ||
    editingCategory === 'mobile_phone' ||
    editingCategory === 'pc';
  const isOthersView = activeCategory === 'others';
  const isOtherForm = formCategory === 'other';

  function applyPurchaseDate(date: string) {
    if (isLaptopForm || isPcForm || (isPhoneForm && !isSimForm)) {
      setForm((prev) => {
        const period = prev.warranty_period;
        const expiry =
          date && period ? warrantyExpiryFromPeriod(date, period) : period === 'Expired' ? '' : prev.warranty;
        return {
          ...prev,
          date,
          warranty: expiry || '',
        };
      });
      return;
    }
    setForm((prev) => ({ ...prev, date }));
  }

  async function loadMeta(force = false) {
    try {
      const meta = await getOrgMeta(force);
      setCompanies(meta.companies);
      setLocations(meta.locations);
      setDepartments(meta.departments);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }

  function isAbortError(e: unknown): boolean {
    return (
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError')
    );
  }

  /** @returns outcome so refresh can toast only on real success/failure */
  async function loadAssets(): Promise<'ok' | 'skipped' | 'aborted' | 'error'> {
    const gen = ++assetsLoadGen.current;

    assetsAbort.current?.abort();
    const ac = new AbortController();
    assetsAbort.current = ac;
    setListLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('category', activeCategory);
      if (isSimTab) {
        params.set('is_sim', '1');
        params.set('company_code', 'SIM');
      } else if (activeCompany) {
        params.set('company_id', String(activeCompany.id));
        params.set('company_code', activeCompany.code || companyTab);
      } else {
        params.set('company_code', companyTab);
      }
      if ((isAllView || isOthersView) && locationTab != null) {
        params.set('location_id', String(locationTab));
      } else if (
        (activeCategory === 'laptop' || activeCategory === 'mobile_phone' || isPcStockView) &&
        locationFilter
      ) {
        params.set('location_id', locationFilter);
      }
      if (isPcStockView) {
        // Newly purchased register — includes Assigned purchases tagged on create
        params.set('newly_purchased', '1');
      }
      if (
        (activeCategory === 'laptop' ||
          activeCategory === 'mobile_phone' ||
          isPcStockView ||
          isAllView ||
          isOthersView) &&
        statusFilter
      ) {
        params.set('status', statusFilter);
      }
      if (q.trim()) params.set('q', q.trim());
      params.set('limit', String(pageSize));
      params.set('page', String(page));

      const a = await api<{
        data: Asset[];
        meta?: {
          total?: number;
          page?: number;
          limit?: number;
          pages?: number;
          new_count?: number;
          old_count?: number;
          new_pages?: number;
          old_pages?: number;
          old_stock_from_page?: number | null;
        };
      }>(`/api/assets?${params.toString()}`, {
        signal: ac.signal,
      });
      if (gen !== assetsLoadGen.current || ac.signal.aborted) return 'aborted';
      setRows(a.data);
      const total = Number(a.meta?.total ?? a.data.length);
      const pages = Math.max(1, Number(a.meta?.pages ?? Math.ceil(total / pageSize) ?? 1));
      setTotalRows(total);
      setTotalPages(pages);
      setNewCount(Number(a.meta?.new_count ?? 0));
      setOldCount(Number(a.meta?.old_count ?? 0));
      setOldStockFromPage(
        a.meta?.old_stock_from_page != null && Number(a.meta.old_stock_from_page) > 0
          ? Number(a.meta.old_stock_from_page)
          : null,
      );
      if (a.meta?.page != null && Number(a.meta.page) !== page) {
        setPage(Number(a.meta.page));
      }
      setError('');
      return 'ok';
    } catch (e) {
      if (isAbortError(e) || ac.signal.aborted || gen !== assetsLoadGen.current) return 'aborted';
      setError(e instanceof Error ? e.message : 'Failed to load');
      return 'error';
    } finally {
      if (gen === assetsLoadGen.current) setListLoading(false);
    }
  }

  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* ignore */
    }
  }

  /** Range text — accounts for trailing Old stock page (all old rows together). */
  function assetsRangeLabel(): string {
    if (totalRows === 0) return '0 of 0';
    if (rows.length === 0) return `0 of ${totalRows}`;
    const onOldPage = oldStockFromPage != null && page >= oldStockFromPage;
    if (onOldPage) {
      const totalOld = oldCount > 0 ? oldCount : rows.length;
      return `Old stock 1 - ${rows.length} of ${totalOld}`;
    }
    const from = (page - 1) * pageSize + 1;
    const to = from + rows.length - 1;
    const newTotal = newCount > 0 ? newCount : totalRows;
    return `${from} - ${to} of ${newTotal}`;
  }

  async function refreshList() {
    const result = await loadAssets();
    if (result === 'ok') toast.success('List refreshed');
    else if (result === 'error') toast.error('Could not refresh — try again');
  }

  /** Reload open edit + view surfaces for an asset after handover / kit changes. */
  async function refreshOpenAssetViews(id: number, category: string): Promise<Asset | null> {
    try {
      const res = await api<{ data: Asset }>(`/api/assets/${category}/${id}`);
      const data = { ...res.data, category: String(res.data.category || category) };
      // Always patch the list row so Name / status / badges update without waiting on filters
      setRows((prev) =>
        prev.map((r) =>
          Number(r.id) === id && String(r.category || category) === category
            ? { ...r, ...data }
            : r,
        ),
      );
      setEditAsset((prev) => (prev && Number(prev.id) === id ? data : prev));
      setForm((prev) => {
        // Only overwrite the edit form when this asset is open for editing
        if (editingId === id && editingCategory === category) {
          return assetToForm(data);
        }
        return prev;
      });
      setDetail((prev) => (prev && Number(prev.id) === id ? data : prev));
      setQrAsset((prev) => (prev && Number(prev.id) === id ? data : prev));
      setCompanyTransferAsset((prev) => (prev && Number(prev.id) === id ? data : prev));
      return data;
    } catch {
      return null;
    }
  }

  /** Always reload the table after a mutation; retry until the list load succeeds. */
  async function reloadAfterMutation(refreshOpenEdit = false): Promise<void> {
    setLifecycleRefreshKey((k) => k + 1);
    // Brief settle so Postgres commits from the mutation are visible to the next SELECT
    await new Promise((r) => window.setTimeout(r, 60));
    let result = await loadAssets();
    if (result !== 'ok') {
      await new Promise((r) => window.setTimeout(r, 160));
      result = await loadAssets();
    }
    if (result !== 'ok') {
      await new Promise((r) => window.setTimeout(r, 280));
      await loadAssets();
    }
    if (refreshOpenEdit) {
      const id = editingId ?? (detail ? Number(detail.id) : null);
      const category =
        editingCategory ?? (detail ? String(detail.category ?? '') : null);
      if (id && category) {
        await refreshOpenAssetViews(id, category);
      }
    }
  }

  async function load() {
    await Promise.all([loadMeta(true), loadAssets()]);
  }

  useEffect(() => {
    clearOrgMetaCache();
    void loadMeta(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!categoryTab) return;
    setPage(1);
    setLocationFilter('');
    setStatusFilter('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, companyTab, locationTab]);

  useEffect(() => {
    if (!categoryTab) return;
    void loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, companyTab, locationTab, locationFilter, statusFilter, pageSize, page]);

  // Live search — debounce typing so we don't hit the API on every keystroke
  const skipSearchEffect = useRef(true);
  useEffect(() => {
    if (!categoryTab) return;
    if (skipSearchEffect.current) {
      skipSearchEffect.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      if (page !== 1) setPage(1);
      else void loadAssets();
    }, 400);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!isAllView && !isOthersView) return;
    if (companyLocations.length === 0) {
      setLocationTab(null);
      return;
    }
    const headId = headOfficeLocationId(companyTab, companyLocations);
    if (locationTab == null || !companyLocations.some((l) => l.id === locationTab)) {
      setLocationTab(headId);
    }
  }, [isAllView, isOthersView, companyTab, companyLocations, locationTab]);

  // SIM tab only exists on Mobile phones — leave it when switching category
  useEffect(() => {
    if (categoryTab !== 'mobile_phone' && companyTab === 'SIM') {
      setCompanyTab('IT');
    }
  }, [categoryTab, companyTab]);

  if (!categoryTab) {
    return <Navigate to="/assets/laptop" replace />;
  }

  function pickAssetStatus(next: string) {
    if (next === 'lost' && form.status !== 'lost') {
      setLostEventDate(new Date().toISOString().slice(0, 10));
      setLostDateModalOpen(true);
      return;
    }
    setForm((prev) => ({ ...prev, status: next }));
    if (next !== 'lost') setStatusEventNote('');
  }

  function confirmLostStolenDate() {
    if (!lostEventDate) {
      toast.error('Select the date the asset was lost / stolen');
      return;
    }
    setForm((prev) => ({ ...prev, status: 'lost' }));
    setStatusEventNote(`Lost / stolen on ${lostEventDate}`);
    setLostDateModalOpen(false);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError('');
    const category = editingCategory ?? createCategory;
    const savingSim =
      category === 'mobile_phone' &&
      (isSimTab || isSimForm || asBool(editAsset?.is_sim));
    const saveCompany = savingSim ? simOwningCompany : activeCompany;
    if (!saveCompany) {
      setError(savingSim ? 'Select company (ITL, IMS, or ISP)' : 'Company not found');
      toast.error(savingSim ? 'Select company (ITL, IMS, or ISP)' : 'Company not found');
      return;
    }
    const isPersonCat = category === 'laptop' || category === 'mobile_phone';
    // Name (current holder) is required for all laptop/phone statuses, including Available
    if (isPersonCat && !form.name.trim()) {
      setError(savingSim ? 'Owner name is required' : 'Name (current holder) is required');
      toast.error(savingSim ? 'Owner name is required' : 'Name (current holder) is required');
      return;
    }
    if (savingSim) {
      if (!form.phone_number.trim()) {
        setError('SIM number is required');
        toast.error('SIM number is required');
        return;
      }
      if (!form.location_id) {
        setError('Location is required');
        toast.error('Location is required');
        return;
      }
      if (!form.department_id) {
        setError('Department is required');
        toast.error('Department is required');
        return;
      }
    }
    if (category === 'pc' && !form.location_id) {
      setError('Select a branch / location');
      toast.error('Select a branch / location');
      return;
    }
    if (category === 'other' || category === 'printer') {
      if (!form.name.trim()) {
        setError('User name is required');
        toast.error('User name is required');
        return;
      }
      if (!form.department_id) {
        setError('Department is required');
        toast.error('Department is required');
        return;
      }
      if (!form.item_name.trim()) {
        setError('Item is required');
        toast.error('Item is required');
        return;
      }
      if (!form.location_id) {
        setError('Location is required');
        toast.error('Location is required');
        return;
      }
    }
    setSaving(true);
    try {
      let warranty = form.warranty || null;
      let warrantyNote = '';
      if (
        (category === 'laptop' || (category === 'mobile_phone' && !savingSim) || category === 'other' || category === 'printer')
      ) {
        const period = form.warranty_period.trim();
        if (period && period.toLowerCase() === 'expired') {
          warranty = null;
          warrantyNote = ' Warranty marked as expired.';
        } else if (form.date && period) {
          warranty = warrantyExpiryFromPeriod(form.date, period) || warranty;
          if (warranty) {
            warrantyNote = ` Warranty void date: ${formatDisplayDate(warranty)} (${period} from purchase).`;
          }
        } else if (!period) {
          warranty = null;
        }
      }

      const processor = String(form.processor ?? '').trim();
      const amountN = form.amount.trim() === '' ? null : Number(form.amount.replace(/,/g, ''));
      const payload: Record<string, unknown> = {
        company_id: saveCompany.id,
        category,
        name: form.name,
        // For laptops/phones, Name = current holder — keep pc_name in sync with allocated_person
        pc_name: isPersonCat ? form.name.trim() || null : form.name.trim() || null,
        department_id: form.department_id ? Number(form.department_id) : null,
        location_id: form.location_id ? Number(form.location_id) : null,
        serial_number: form.serial_number || null,
        supplier: form.supplier || null,
        invoice_no: form.invoice_no || null,
        brand: form.brand || null,
        model: savingSim ? form.model.trim() || 'SIM' : form.model || null,
        amount: Number.isFinite(amountN as number) ? amountN : null,
        processor: processor || null,
        cpu: processor || null,
        other: form.other || null,
        notes: form.other || null,
        // Acquired On = purchased date; default to today when left blank so Expenditure can count it
        date: String(form.date ?? '').trim() || new Date().toISOString().slice(0, 10),
        purchase_date: String(form.date ?? '').trim() || new Date().toISOString().slice(0, 10),
        warranty: savingSim ? null : warranty,
        warranty_expires_on: savingSim ? null : warranty,
        imei_number: form.imei_number || null,
        imei_number_2: form.imei_number_2 || null,
        phone_number: form.phone_number || null,
        status: form.status || 'available',
        ...(savingSim ? { is_sim: true } : {}),
        ...(statusEventNote.trim() ? { status_note: statusEventNote.trim() } : {}),
      };

      // Storage: PCs/laptops use separate HDD + SSD; phones keep a single capacity.
      if (category === 'pc') {
        // set below in PC block
      } else if (category === 'laptop') {
        const hddN = parseGbInput(form.hdd);
        const ssdN = parseGbInput(form.ssd);
        const ramN = parseGbInput(form.ram);
        payload.hdd = hddN;
        payload.ssd = ssdN;
        payload.hdd_gb = hddN;
        payload.ssd_gb = ssdN;
        payload.ram = ramN;
        payload.ram_gb = ramN;
        if ((hddN ?? 0) > 0 || (ssdN ?? 0) > 0) {
          payload.capacity = (hddN ?? 0) + (ssdN ?? 0);
          payload.storage_gb = (hddN ?? 0) + (ssdN ?? 0);
        } else {
          payload.capacity = null;
          payload.storage_gb = null;
        }
      } else {
        const capN = parseGbInput(form.capacity);
        const ramN = parseGbInput(form.ram);
        payload.capacity = capN;
        payload.storage_gb = capN;
        payload.ram = ramN;
        payload.ram_gb = ramN;
      }

      if (category === 'pc' && !editingId) {
        if (!activeCompany) {
          setError('Select a company subcategory (ITL, IMS, or ISP)');
          setSaving(false);
          return;
        }
        if (!form.location_id) {
          setError(
            'Select a branch / location — PC asset IDs are assigned per company + branch (e.g. ITL-KHO-PC-0001)',
          );
          setSaving(false);
          return;
        }
      }

      if (category === 'other' && !editingId) {
        if (!form.location_id) {
          setError(
            'Select a branch / location — other-asset IDs are assigned per company + branch (e.g. ITL-KHO-001)',
          );
          setSaving(false);
          return;
        }
      }

      if (category === 'pc') {
        const hddN = parseGbInput(form.hdd);
        const ssdN = parseGbInput(form.ssd);
        const ramN = parseGbInput(form.ram);
        const pcName = form.name.trim() || null;
        payload.name = pcName;
        payload.pc_name = pcName;
        // Keep Assigned to / Name columns in sync on the PCs tab
        payload.allocated_person = pcName;
        payload.hdd = hddN;
        payload.ssd = ssdN;
        payload.ram = ramN;
        payload.hdd_gb = hddN;
        payload.ssd_gb = ssdN;
        payload.ram_gb = ramN;
        if ((hddN ?? 0) > 0 || (ssdN ?? 0) > 0) {
          payload.capacity = (hddN ?? 0) + (ssdN ?? 0);
          payload.storage_gb = (hddN ?? 0) + (ssdN ?? 0);
        }
        payload.monitor_brand = form.monitor_brand.trim() || null;
        payload.windows_version = form.windows_version.trim() || null;
        payload.has_power_cable = form.has_power_cable;
        payload.has_vga_cable = form.has_vga_cable;
        payload.has_keyboard = form.has_keyboard;
        payload.has_mouse = form.has_mouse;
        payload.has_ups = form.has_ups;
        payload.ups_brand = form.has_ups ? (form.ups_brand.trim() || null) : null;
        payload.ups_model = form.has_ups
          ? (form.ups_model.trim() || '650')
          : null;
        payload.ups_purchase_date = form.has_ups
          ? form.ups_purchase_date.trim() || null
          : null;
        payload.ups_warranty_period = form.has_ups
          ? form.ups_warranty_period.trim() || null
          : null;
        const upsExpiry =
          form.has_ups && form.ups_purchase_date && form.ups_warranty_period
            ? warrantyExpiryFromPeriod(form.ups_purchase_date, form.ups_warranty_period)
            : form.has_ups
              ? form.ups_warranty_expires_on.trim() || null
              : null;
        payload.ups_warranty_expires_on = upsExpiry;
        payload.warranty_period = form.warranty_period.trim() || null;
        const pcPeriod = form.warranty_period.trim();
        if (pcPeriod.toLowerCase() === 'expired') {
          payload.warranty = null;
          payload.warranty_expires_on = null;
        } else if (form.date && pcPeriod) {
          payload.warranty = warrantyExpiryFromPeriod(form.date, pcPeriod);
          payload.warranty_expires_on = payload.warranty;
        }
        // Clear UPS expiry when period is Expired (even if purchase date missing)
        if (
          form.has_ups &&
          String(form.ups_warranty_period).trim().toLowerCase() === 'expired'
        ) {
          payload.ups_warranty_expires_on = null;
        }
      }

      if (category === 'laptop') {
        payload.has_mouse = form.has_mouse;
        payload.warranty_period = form.warranty_period.trim() || null;
        const laptopPeriod = form.warranty_period.trim();
        if (!laptopPeriod || laptopPeriod.toLowerCase() === 'expired') {
          payload.warranty = null;
          payload.warranty_expires_on = null;
        } else if (form.date.trim()) {
          const laptopExpiry = warrantyExpiryFromPeriod(form.date, laptopPeriod);
          payload.warranty = laptopExpiry || null;
          payload.warranty_expires_on = laptopExpiry || null;
        }
      }

      if (category === 'mobile_phone') {
        if (!savingSim) {
          payload.has_charger = form.has_charger;
          payload.has_data_cable = form.has_data_cable;
          payload.has_back_cover = form.has_back_cover;
          payload.warranty_period = form.warranty_period.trim() || null;
          const phonePeriod = form.warranty_period.trim();
          if (!phonePeriod || phonePeriod.toLowerCase() === 'expired') {
            payload.warranty = null;
            payload.warranty_expires_on = null;
          } else if (form.date.trim()) {
            const phoneExpiry = warrantyExpiryFromPeriod(form.date, phonePeriod);
            payload.warranty = phoneExpiry || null;
            payload.warranty_expires_on = phoneExpiry || null;
          }
        } else {
          payload.has_charger = false;
          payload.has_data_cable = false;
          payload.has_back_cover = false;
          payload.warranty_period = null;
          payload.warranty = null;
          payload.warranty_expires_on = null;
        }
      }

      if (category === 'laptop' || category === 'mobile_phone') {
        // New → top of list; Old → Old stock pages. Only send on create, or when user toggles it.
        const nowLegacy = form.entry_type === 'old';
        if (!editingId) {
          payload.is_legacy = nowLegacy;
          payload.entry_type = form.entry_type;
        } else if (editAsset && asBool(editAsset.is_legacy) !== nowLegacy) {
          payload.is_legacy = nowLegacy;
          payload.entry_type = form.entry_type;
        }
      }

      if (category === 'other' || category === 'printer') {
        // Other assets: user_name = first assigned user (set on create only; locked afterward)
        if (category === 'other') {
          if (!editingId) {
            payload.user_name = form.name.trim() || null;
            payload.pc_name = form.name.trim() || null;
          }
        } else {
          payload.user_name = form.name.trim() || null;
        }
        payload.item_name = form.item_name.trim() || null;
        payload.specification = form.specification.trim() || null;
        payload.warranty_period = form.warranty_period.trim() || null;
        payload.handover_date = form.handover_date.trim() || null;
        payload.remark = form.other || null;
        payload.notes = form.other || null;
        // Dates optional — blank purchase/handover dates keep old stock out of IT expenditure
        payload.date = form.date.trim() || null;
        payload.purchase_date = form.date.trim() || null;
        if (form.date.trim() && form.warranty_period.trim()) {
          const otherExpiry = warrantyExpiryFromPeriod(form.date, form.warranty_period);
          payload.warranty = otherExpiry || null;
          payload.warranty_expires_on = otherExpiry || null;
        } else {
          payload.warranty = null;
          payload.warranty_expires_on = null;
        }
      }

      if (isPersonCat) {
        const holderName = form.name.trim() || null;
        payload.allocated_person = holderName;
        payload.pc_name = holderName;
        payload.name = holderName;
        if (!editingId) {
          // Name (holder) on create = originally assigned = 1st handover person
          const originalPerson = (form.first_handover_person || form.name).trim();
          payload.first_handover_person = originalPerson || null;
          payload.original_assigned_person = originalPerson || null;
          payload.allocated_person = originalPerson || form.name.trim() || null;
          payload.pc_name = payload.allocated_person;
          payload.name = payload.allocated_person;
          payload.handed_over_on =
            form.handed_over_on ||
            form.date ||
            (originalPerson ? new Date().toISOString().slice(0, 10) : null);
          payload.original_assigned_on = payload.handed_over_on;
          payload.return_date = form.return_date || null;
        }
      } else if (category !== 'other') {
        payload.first_handover_person = form.first_handover_person || null;
        payload.handed_over_on = form.handed_over_on || null;
        payload.return_date = form.return_date || null;
      }

      if (editingId && editingCategory) {
        const updated = await api<{ data: Asset }>(`/api/assets/${editingCategory}/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (!updated?.data) {
          throw new Error('Update succeeded but no asset data was returned');
        }
        const savedId = editingId;
        const savedCat = editingCategory;
        // Prefer a fresh GET (handovers / allocated / status) so the list never keeps stale Name
        let fresh = updated.data;
        try {
          const full = await api<{ data: Asset }>(`/api/assets/${savedCat}/${savedId}`);
          if (full?.data) fresh = full.data;
        } catch {
          /* PUT payload is still applied below */
        }
        const merged = {
          ...fresh,
          category: String(fresh.category || savedCat),
          status: fresh.status ?? payload.status,
        } as Asset;
        setRows((prev) =>
          prev.map((r) =>
            Number(r.id) === savedId && String(r.category || savedCat) === savedCat
              ? { ...r, ...merged }
              : r,
          ),
        );
        toast.success(`Asset updated successfully.${warrantyNote}`);
        returnToViewRef.current = null;
        setForm(emptyForm);
        setPendingAttachmentFiles([]);
        setStatusEventNote('');
        setLostEventDate('');
        setEditingId(null);
        setEditingCategory(null);
        setEditAsset(null);
        setEditModalTab('details');
        setShowAddModal(false);
        await reloadAfterMutation();
        // Fresh GET after list reload — reopen the same record view
        const refreshed = await refreshOpenAssetViews(savedId, savedCat);
        if (refreshed) {
          setDetail(refreshed);
        } else {
          setDetail(merged);
        }
      } else {
        const created = await api<{ data?: Asset }>('/api/assets', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const newId = Number(created?.data?.id ?? 0);
        const newCat = String(created?.data?.category || category || '');
        let attachNote = '';
        if (newId > 0 && newCat && pendingAttachmentFiles.length > 0) {
          try {
            const n = await uploadStagedAssetFiles(newCat, newId, pendingAttachmentFiles);
            attachNote = n > 0 ? ` ${n} file${n === 1 ? '' : 's'} attached.` : '';
          } catch (attachErr) {
            attachNote = ' (asset saved; some attachments failed to upload)';
            toast.error(
              attachErr instanceof Error ? attachErr.message : 'Attachment upload failed',
            );
          }
        }
        toast.success(`Asset added successfully.${warrantyNote}${attachNote}`);
        setForm(emptyForm);
        setPendingAttachmentFiles([]);
        setStatusEventNote('');
        setLostEventDate('');
        setEditingId(null);
        setEditingCategory(null);
        setEditAsset(null);
        setEditModalTab('details');
        setShowAddModal(false);
        await reloadAfterMutation();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function closeEditModal() {
    const backToView = returnToViewRef.current;
    returnToViewRef.current = null;
    setShowAddModal(false);
    setEditingId(null);
    setEditingCategory(null);
    setEditAsset(null);
    setEditModalTab('details');
    setPendingAttachmentFiles([]);
    setHandoverForm({ person: '', date: '', remarks: '' });
    setStatusEventNote('');
    setLostEventDate('');
    setLostDateModalOpen(false);
    if (backToView) {
      void openDetails(backToView.id, backToView.category);
    }
  }

  async function refreshEditAsset(id: number, category: string) {
    const data = await refreshOpenAssetViews(id, category);
    if (!data) {
      throw new Error('Could not reload asset');
    }
    return data;
  }

  async function openEdit(
    id: number,
    category: string,
    tab: 'details' | 'handovers' | 'lifecycle' | 'kit' | 'attachments' = 'details',
  ) {
    setError('');
    try {
      const res = await api<{ data: Asset }>(`/api/assets/${category}/${id}`);
      setForm(assetToForm(res.data));
      setEditAsset(res.data);
      const co = String(res.data.company_code ?? '')
        .trim()
        .toUpperCase();
      if (co === 'IMS' || co === 'ISP') setSimFormCompany(co);
      else if (co === 'IT' || co === 'ITL') setSimFormCompany('IT');
      else setSimFormCompany('IT');
      setEditingId(id);
      setEditingCategory(category);
      setEditModalTab(tab);
      setEditFormSection('assignment');
      setHandoverForm({ person: '', date: new Date().toISOString().slice(0, 10), remarks: '' });
      setShowAddModal(true);
      try {
        const hist = await api<{ data: typeof statusHistory }>(
          `/api/assets/${category}/${id}/status-history`,
        );
        setStatusHistory(hist.data ?? []);
      } catch {
        setStatusHistory([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load asset');
    }
  }

  async function onDelete(id: number, category: string, tag: string) {
    if (!window.confirm(`Delete asset ${tag}? This cannot be undone.`)) return;
    setDeletingId(id);
    setError('');
    try {
      await api(`/api/assets/${category}/${id}`, { method: 'DELETE' });
      if (detail && Number(detail.id) === id) setDetail(null);
      toast.success(`Asset ${tag} deleted`);
      await reloadAfterMutation();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  }

  const addLabel =
    activeCategory === 'laptop'
      ? 'Add laptop'
      : activeCategory === 'mobile_phone'
        ? isSimTab
          ? 'Add SIM'
          : 'Add mobile phone'
        : activeCategory === 'pc'
          ? 'Add newly purchased PC'
          : activeCategory === 'all'
            ? 'Add PC'
            : activeCategory === 'others'
              ? 'Add other asset'
              : 'Add asset';

  const showBrandCol =
    !isSimTab &&
    (categoryTab === 'laptop' || categoryTab === 'mobile_phone' || categoryTab === 'pc' || isAllView);
  const showSimNumberCol = isSimTab;
  const showCompanyCol = isSimTab;
  const showTypeCol = false;
  /** Hide Location column on PC Inventory only when a specific branch is selected */
  const showLocationCol = !isAllView || locationTab == null;
  const isPersonAsset = categoryTab === 'laptop' || categoryTab === 'mobile_phone';

  async function openQr(id: number, category: string, fallback?: Asset) {
    // Show list row immediately, then refresh with full detail (IMEI etc.)
    setQrAsset({ ...(fallback ?? {}), category });
    try {
      const res = await api<{ data: Asset }>(`/api/assets/${category}/${id}`);
      setQrAsset({ ...res.data, category: String(res.data.category || category) });
    } catch {
      /* keep fallback row data */
    }
  }

  async function openDetails(id: number, category: string) {
    setDetailLoading(true);
    setError('');
    try {
      const res = await api<{ data: Asset }>(`/api/assets/${category}/${id}`);
      setDetail(res.data);
      setHandoverForm({ person: '', date: new Date().toISOString().slice(0, 10), remarks: '' });
      try {
        const hist = await api<{ data: typeof statusHistory }>(
          `/api/assets/${category}/${id}/status-history`,
        );
        setStatusHistory(hist.data ?? []);
      } catch {
        setStatusHistory([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load details');
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetailView() {
    setDetail(null);
    const dest = returnToRef.current;
    returnToRef.current = null;
    if (dest && dest.startsWith('/') && !dest.startsWith('//')) {
      navigate(dest);
    }
  }

  // Open asset view when arriving from a report / expenditure deep link: ?view=123&company=IT&returnTo=/reports/...
  useEffect(() => {
    const viewRaw = searchParams.get('view');
    if (!viewRaw) {
      openedViewRef.current = null;
      return;
    }
    const id = Number(viewRaw);
    if (!Number.isFinite(id) || id < 1) return;
    const gate = `${activeCategory}:${viewRaw}`;
    if (openedViewRef.current === gate) return;
    openedViewRef.current = gate;

    const returnTo = (searchParams.get('returnTo') || '').trim();
    if (returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      returnToRef.current = returnTo;
    }

    const companyRaw = (searchParams.get('company') || '').trim().toUpperCase();
    if (
      companyRaw === 'IMS' ||
      companyRaw === 'ISP' ||
      companyRaw === 'IT' ||
      companyRaw === 'ITL' ||
      companyRaw === 'SIM'
    ) {
      setCompanyTab(companyRaw === 'ITL' ? 'IT' : (companyRaw as CompanyTab));
    }

    const apiCategory =
      activeCategory === 'all'
        ? 'pc'
        : activeCategory === 'others'
          ? 'other'
          : activeCategory === 'mobile_phone'
            ? 'mobile_phone'
            : activeCategory === 'laptop'
              ? 'laptop'
              : activeCategory === 'pc'
                ? 'pc'
                : 'laptop';

    void openDetails(id, apiCategory).finally(() => {
      // Drop deep-link params so closing the modal does not reopen it
      const next = new URLSearchParams(searchParams);
      next.delete('view');
      next.delete('company');
      next.delete('returnTo');
      setSearchParams(next, { replace: true });
    });
  }, [searchParams, activeCategory, setSearchParams]);

  function openPhoneHandoverDetailsIfNeeded(): boolean {
    const target = editAsset;
    if (!target || !editingId || !editingCategory) return false;
    const cat = String(target.category || editingCategory);
    // 2nd+ mobile handover: ask whether branch / SIM / accessories changed for the new holder
    if (cat === 'mobile_phone' && Boolean(target.handover_open)) {
      setPhoneHandoverDetails({
        location_id: target.location_id != null ? String(target.location_id) : '',
        department_id: target.department_id != null ? String(target.department_id) : '',
        phone_number: String(target.phone_number ?? ''),
        has_charger:
          target.has_charger === undefined || target.has_charger === null
            ? true
            : asBool(target.has_charger),
        has_data_cable:
          target.has_data_cable === undefined || target.has_data_cable === null
            ? true
            : asBool(target.has_data_cable),
        has_back_cover:
          target.has_back_cover === undefined || target.has_back_cover === null
            ? true
            : asBool(target.has_back_cover),
        remarks: handoverForm.remarks,
      });
      return true;
    }
    return false;
  }

  async function onHandOver() {
    const target = editAsset;
    if (!target || !editingId || !editingCategory || handoverSaving) return;
    const person = handoverForm.person.trim();
    if (!person) {
      setError('Enter the handover person name');
      return;
    }
    if (!handoverForm.date) {
      setError('Handover date is required');
      return;
    }
    const currentHolder = String(
      target.allocated_person ?? target.current_holder ?? target.assigned_person_name ?? '',
    ).trim();
    if (
      target.handover_open &&
      currentHolder &&
      currentHolder.toLowerCase() === person.toLowerCase()
    ) {
      setError(`Already allocated to ${currentHolder}. Choose a different person for the next handover.`);
      toast.error('Cannot hand over to the same person again');
      return;
    }
    if (openPhoneHandoverDetailsIfNeeded()) return;
    await completeHandOver();
  }

  async function completeHandOver(
    details?: {
      location_id: string;
      department_id: string;
      phone_number: string;
      has_charger: boolean;
      has_data_cable: boolean;
      has_back_cover: boolean;
      remarks?: string;
    } | null,
  ) {
    const target = editAsset;
    if (!target || !editingId || !editingCategory || handoverSaving) return;
    const person = handoverForm.person.trim();
    if (!person || !handoverForm.date) return;
    setHandoverSaving(true);
    setError('');
    try {
      const cat = String(target.category || editingCategory);
      const remarks = String(details?.remarks ?? handoverForm.remarks ?? '').trim();
      const body: Record<string, unknown> = {
        asset_id: Number(target.id),
        asset_type: cat,
        assigned_person_name: person,
        handover_date: handoverForm.date,
        checkout_remarks: remarks || null,
      };
      if (cat === 'mobile_phone' && details) {
        body.location_id = details.location_id ? Number(details.location_id) : null;
        body.department_id = details.department_id ? Number(details.department_id) : null;
        body.phone_number = details.phone_number.trim() || null;
        body.has_charger = details.has_charger;
        body.has_data_cable = details.has_data_cable;
        body.has_back_cover = details.has_back_cover;
      }
      await api('/api/handovers/checkout', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success(`Handed over to ${person}`);
      setHandoverForm({ person: '', date: new Date().toISOString().slice(0, 10), remarks: '' });
      setPhoneHandoverDetails(null);
      // Refresh edit + view surfaces first so tabs show new holder / SIM / branch immediately
      await refreshOpenAssetViews(editingId, editingCategory);
      await reloadAfterMutation(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Handover failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setHandoverSaving(false);
    }
  }

  function openReturnPopup() {
    const target = editAsset;
    if (!target || !editingId || !editingCategory) return;
    const handovers = Array.isArray(target.handovers) ? (target.handovers as Asset[]) : [];
    const current = handovers.find((h) => h.is_current || h.is_open);
    if (!current) {
      toast.error('No open handover to return');
      return;
    }
    const cat = String(target.category || editingCategory);
    setReturnPopup({
      handoverId: Number(current.id),
      person: String(current.assigned_person_name ?? 'current holder'),
      category: cat,
      has_charger:
        target.has_charger === undefined || target.has_charger === null
          ? true
          : asBool(target.has_charger),
      has_data_cable:
        target.has_data_cable === undefined || target.has_data_cable === null
          ? true
          : asBool(target.has_data_cable),
      has_back_cover:
        target.has_back_cover === undefined || target.has_back_cover === null
          ? true
          : asBool(target.has_back_cover),
      accessoriesNote: String(target.accessories ?? ''),
      remarks: '',
    });
  }

  async function confirmReturnAsset() {
    if (!returnPopup || !editingId || !editingCategory || handoverSaving) return;
    const remarks = returnPopup.remarks.trim();
    if (!remarks) {
      toast.error('Return remarks are required');
      return;
    }
    setHandoverSaving(true);
    setError('');
    try {
      await api(`/api/handovers/${returnPopup.handoverId}/checkin`, {
        method: 'POST',
        body: JSON.stringify({
          return_condition: 'good',
          return_remarks: remarks,
          // Persist accessory confirmation on mobile phones at return time
          ...(returnPopup.category === 'mobile_phone'
            ? {
                has_charger: returnPopup.has_charger,
                has_data_cable: returnPopup.has_data_cable,
                has_back_cover: returnPopup.has_back_cover,
              }
            : {}),
        }),
      });
      // Optional: sync accessory flags on the phone record after return
      if (returnPopup.category === 'mobile_phone') {
        try {
          await api(`/api/assets/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify({
              category: 'mobile_phone',
              has_charger: returnPopup.has_charger,
              has_data_cable: returnPopup.has_data_cable,
              has_back_cover: returnPopup.has_back_cover,
            }),
          });
        } catch {
          /* check-in already succeeded — accessory sync is best-effort */
        }
      }
      setReturnPopup(null);
      toast.success('Returned — now held by IT Department');
      await refreshOpenAssetViews(editingId, editingCategory);
      await reloadAfterMutation(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Return failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setHandoverSaving(false);
    }
  }

  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="Asset Management"
        title={CATEGORY_TITLES[categoryTab]}
        subtitle={
          isAllView || isOthersView
            ? selectedLocation
              ? `${COMPANY_TABS.find((t) => t.id === companyTab)?.label ?? companyTab} · ${selectedLocation.name}`
              : `${COMPANY_TABS.find((t) => t.id === companyTab)?.label ?? companyTab} · All locations`
            : isPcStockView
              ? `New PC purchases for ${COMPANY_TABS.find((t) => t.id === companyTab)?.label ?? companyTab} (stays listed after Assigned). Full fleet is under PC Inventory.`
              : isSimTab
                ? 'Manage SIM cards for ITL, IMS, and ISP — company, location, department, and handover chain (up to 10)'
                : `Manage ${CATEGORY_TITLES[categoryTab].toLowerCase()} for ${COMPANY_TABS.find((t) => t.id === companyTab)?.label ?? companyTab}`
        }
      />
      {error ? <p className="error-text">{error}</p> : null}

      <div className="tabs-secondary company-tabs-row">
        {companyTabsForCategory(categoryTab).map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-btn${companyTab === tab.id ? ' active' : ''}`}
            onClick={() => {
              setCompanyTab(tab.id);
              // Location resets to that company's head office via effect
              if (isAllView || isOthersView) setLocationTab(null);
            }}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-primary company-tabs-add"
          onClick={() => {
            setError('');
            void loadMeta(true);
            if (isSimTab) {
              setSimFormCompany('IT');
            }
            setForm({
              ...emptyForm,
              // Other assets: leave purchase/handover dates blank (old stock must not hit expenditure)
              date: isOthersView ? '' : new Date().toISOString().slice(0, 10),
              handed_over_on: isSimTab ? new Date().toISOString().slice(0, 10) : '',
              model: isSimTab ? 'SIM' : '',
              location_id:
                (isAllView || isOthersView) && locationTab != null ? String(locationTab) : '',
              ...(isAllView || createCategory === 'pc'
                ? {
                    has_power_cable: true,
                    has_vga_cable: true,
                    has_keyboard: true,
                    has_mouse: true,
                    has_ups: true,
                    ups_model: '650',
                  }
                : {}),
            });
            setEditingId(null);
            setEditingCategory(isAllView ? 'pc' : isOthersView ? 'other' : null);
            setEditAsset(null);
            setShowAddModal(true);
          }}
        >
          + {addLabel}
        </button>
      </div>

      <div className="card asset-list-card">
        {categoryTab === 'laptop' ||
        categoryTab === 'mobile_phone' ||
        isPcStockView ||
        isAllView ||
        isOthersView ? (
          <div className="asset-filter-panel">
            <div
              className="asset-filter-grid"
              style={
                isAllView || isOthersView
                  ? { gridTemplateColumns: 'minmax(12rem, 1fr) minmax(0, 1.6fr) minmax(9rem, 0.85fr)' }
                  : undefined
              }
            >
              {isAllView || isOthersView ? (
                <label className="asset-filter-field">
                  <span className="asset-filter-label">Branch / location</span>
                  <select
                    className="asset-filter-control"
                    value={locationTab != null ? String(locationTab) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLocationTab(v ? Number(v) : null);
                      setPage(1);
                    }}
                  >
                    <option value="">All locations</option>
                    {companyLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="asset-filter-field">
                <span className="asset-filter-label">Search</span>
                <input
                  className="asset-filter-control"
                  placeholder={
                    isOthersView
                      ? 'Search ID / username / item / serial'
                      : isAllView || isPcStockView
                        ? 'Search tag, name, serial...'
                        : 'Search tag, holder, serial...'
                  }
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              <label className="asset-filter-field">
                <span className="asset-filter-label">Status</span>
                <StatusFilterSelect
                  value={statusFilter}
                  onChange={(v) => {
                    setStatusFilter(v);
                    setPage(1);
                  }}
                />
              </label>
              {!(isAllView || isOthersView) ? (
                <label className="asset-filter-field">
                  <span className="asset-filter-label">Location</span>
                  <select
                    className="asset-filter-control"
                    value={locationFilter}
                    onChange={(e) => {
                      setLocationFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All locations</option>
                    {companyLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="asset-filter-footer asset-filter-footer--end">
              <div className="asset-filter-actions">
                <button
                  type="button"
                  className="asset-filter-clear"
                  disabled={
                    !q &&
                    !statusFilter &&
                    !(isAllView || isOthersView
                      ? locationTab !== headOfficeLocationId(companyTab, companyLocations)
                      : locationFilter)
                  }
                  onClick={() => {
                    setQ('');
                    setStatusFilter('');
                    if (isAllView || isOthersView) {
                      setLocationTab(headOfficeLocationId(companyTab, companyLocations));
                    } else {
                      setLocationFilter('');
                    }
                    setPage(1);
                  }}
                >
                  Clear filters
                </button>
                {isPersonAsset && oldStockFromPage != null && oldCount > 0 ? (
                  <button
                    type="button"
                    className="asset-filter-clear"
                    style={{ color: '#b91c1c' }}
                    disabled={listLoading || page >= oldStockFromPage}
                    onClick={() => setPage(oldStockFromPage)}
                  >
                    Old stock ({oldCount})
                  </button>
                ) : null}
                {listLoading ? (
                  <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Loading…</span>
                ) : null}
                <TableSettingsMenu
                  pageSize={pageSize}
                  onPageSizeChange={changePageSize}
                  onRefresh={() => void refreshList()}
                  refreshing={listLoading}
                  rangeLabel={assetsRangeLabel()}
                />
                <PaginationBar
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  disabled={listLoading}
                  oldStockFromPage={isPersonAsset ? oldStockFromPage : null}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="toolbar">
            <input
              className="input"
              placeholder="Search tag / name / serial"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search assets"
            />
            {listLoading ? (
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Loading…</span>
            ) : null}
            <TableSettingsMenu
              pageSize={pageSize}
              onPageSizeChange={changePageSize}
              onRefresh={() => void refreshList()}
              refreshing={listLoading}
              rangeLabel={assetsRangeLabel()}
            />
            <PaginationBar
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              disabled={listLoading}
              oldStockFromPage={isPersonAsset ? oldStockFromPage : null}
            />
          </div>
        )}
        <div
          className={`asset-table-scroll${
            pageSize === 10 && rows.length >= 10 ? ' asset-table-scroll--fit-10' : ''
          }`}
          style={
            pageSize === 10 && rows.length >= 10
              ? ({
                  ['--asset-visible-rows']: String(Math.max(rows.length, 1)),
                } as CSSProperties)
              : undefined
          }
        >
          <table className="table asset-data-table">
            <thead>
              <tr>
                {isOthersView ? (
                  <>
                    <th className="col-tag">Asset ID</th>
                    <th>First assigned user</th>
                    <th>Department</th>
                    <th>Item</th>
                    {locationTab == null ? <th className="col-location">Location</th> : null}
                    <th>Handover date</th>
                    <th></th>
                  </>
                ) : (
                  <>
                    {showTypeCol ? <th className="col-type">Type</th> : null}
                    <th className="col-tag">Asset ID</th>
                    {showCompanyCol ? <th className="col-company">Company</th> : null}
                    <th className="col-name">{isSimTab ? 'Owner name' : 'Name'}</th>
                    {showLocationCol ? <th className="col-location">Location</th> : null}
                    {showBrandCol ? <th className="col-brand">Brand</th> : null}
                    {showSimNumberCol ? <th className="col-sim">SIM number</th> : null}
                    {!isSimTab ? <th className="col-sn">S/N</th> : null}
                    <th className="col-assigned">
                      {isSimTab
                        ? 'Department'
                        : isPersonAsset || categoryTab === 'pc' || isAllView
                          ? 'Originally assigned'
                          : 'Assigned to'}
                    </th>
                    <th className="col-status">Status</th>
                    <th className="col-actions"></th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={
                    isOthersView
                      ? 6 + (locationTab == null ? 1 : 0)
                      : (showTypeCol ? 1 : 0) +
                        (showLocationCol ? 1 : 0) +
                        (showBrandCol ? 1 : 0) +
                        (showCompanyCol ? 1 : 0) +
                        (showSimNumberCol ? 1 : 0) +
                        (isSimTab ? 0 : 1) +
                        5
                  }>
                    <EmptyState
                      title={
                        (isAllView || isOthersView) && selectedLocation
                          ? `No ${isOthersView ? 'other assets' : 'branch PCs'} at ${selectedLocation.name}`
                          : isAllView || isOthersView
                            ? `No ${isOthersView ? 'other assets' : 'PCs'} for this company`
                            : isPcStockView
                              ? 'No newly purchased PCs'
                              : isSimTab
                                ? 'No SIM cards found'
                                : `No ${CATEGORY_TITLES[categoryTab].toLowerCase()} found`
                      }
                      description={
                        (isAllView || isOthersView) && selectedLocation
                          ? `Add ${isOthersView ? 'an other asset' : 'a PC'} for the ${selectedLocation.name} branch, or switch location.`
                          : isAllView || isOthersView
                            ? 'Try another location filter, or add a new asset for this company.'
                            : isPcStockView
                              ? 'Add a newly purchased PC for ITL, IMS, or ISP with a branch. Older fleet PCs stay under PC Inventory.'
                              : 'Register an asset or switch company tabs to continue.'
                      }
                      action={
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            setForm({
                              ...emptyForm,
                              date: isOthersView ? '' : new Date().toISOString().slice(0, 10),
                              location_id:
                                (isAllView || isOthersView) && locationTab != null
                                  ? String(locationTab)
                                  : '',
                              ...(isAllView || createCategory === 'pc'
                                ? {
                                    has_power_cable: true,
                                    has_vga_cable: true,
                                    has_keyboard: true,
                                    has_mouse: true,
                                    has_ups: true,
                                    ups_model: '650',
                                  }
                                : {}),
                            });
                            setEditingId(null);
                            setEditingCategory(isAllView ? 'pc' : isOthersView ? 'other' : null);
                            setShowAddModal(true);
                          }}
                        >
                          + {addLabel}
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.flatMap((r, index) => {
                  const rowCategory = String(r.category || createCategory);
                  const rowIsPersonAsset =
                    rowCategory === 'laptop' || rowCategory === 'mobile_phone';
                  const rowShowsHolderBadges =
                    rowIsPersonAsset || rowCategory === 'pc';
                  const isLegacyRow = Boolean(r.is_legacy);
                  const prevLegacy = index > 0 ? Boolean(rows[index - 1].is_legacy) : false;
                  const showOldStockHeader =
                    rowIsPersonAsset && isLegacyRow && !prevLegacy;
                  const tableColSpan = isOthersView
                    ? 6 + (locationTab == null ? 1 : 0)
                    : (showTypeCol ? 1 : 0) +
                      (showLocationCol ? 1 : 0) +
                      (showBrandCol ? 1 : 0) +
                      (showCompanyCol ? 1 : 0) +
                      (showSimNumberCol ? 1 : 0) +
                      (isSimTab ? 0 : 1) +
                      5;
                  const out: ReactNode[] = [];
                  if (showOldStockHeader) {
                    out.push(
                      <tr key="old-stock-section" className="old-stock-section-row">
                        <td colSpan={tableColSpan}>
                          <span className="old-stock-section-label">Old stock</span>
                        </td>
                      </tr>,
                    );
                  }
                  out.push(
                  <tr
                    key={`${rowCategory}-${String(r.id)}`}
                    className={`asset-row-click${isLegacyRow ? ' old-stock-row' : ''}`}
                    role="button"
                    tabIndex={0}
                    title="Open asset view"
                    onClick={() => void openDetails(Number(r.id), rowCategory)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openDetails(Number(r.id), rowCategory);
                      }
                    }}
                  >
                    {isOthersView ? (
                      <>
                        <td className="col-tag">
                          <strong className="cell-oneline" title={String(r.asset_tag ?? '')}>
                            {dash(r.asset_tag)}
                          </strong>
                        </td>
                        <td>{dash(r.user_name ?? r.pc_name)}</td>
                        <td>{dash(r.department_name)}</td>
                        <td>{dash(r.item_name)}</td>
                        {locationTab == null ? (
                          <td className="col-location">{dash(r.location_name)}</td>
                        ) : null}
                        <td>{dash(r.handover_date ? String(r.handover_date).slice(0, 10) : '')}</td>
                      </>
                    ) : (
                      <>
                        {showTypeCol ? (
                          <td className="col-type">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <AssetIcon type={rowCategory} />
                              <span style={{ textTransform: 'capitalize', fontSize: '0.82rem' }}>
                                {rowCategory.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </td>
                        ) : null}
                        <td className="col-tag">
                          {r.former_asset_tag ? (
                            <div className="transfer-tag-stack">
                              <strong className="cell-oneline" title={String(r.asset_tag)}>
                                {String(r.asset_tag)}
                              </strong>
                              <span className="transfer-tag-former">{String(r.former_asset_tag)}</span>
                            </div>
                          ) : (
                            <strong className="cell-oneline" title={String(r.asset_tag)}>
                              {String(r.asset_tag)}
                            </strong>
                          )}
                        </td>
                        {showCompanyCol ? (
                          <td className="col-company">
                            <span className="cell-oneline">{companyUiLabel(r.company_code)}</span>
                          </td>
                        ) : null}
                        <td className="col-name">
                          {rowShowsHolderBadges ? (
                            <PersonNameCell
                              name={currentHolderName(r)}
                              sign={
                                currentHolderName(r)
                                  ? isItCustodyHolder(currentHolderName(r))
                                    ? 'holds_now'
                                    : isCurrentHolderOriginal(r)
                                      ? 'original'
                                      : 'current'
                                  : null
                              }
                            />
                          ) : (
                            <span
                              className="cell-oneline cell-oneline--strong"
                              title={String(currentHolderName(r) || r.pc_name || '')}
                            >
                              {dash(currentHolderName(r) || r.pc_name)}
                            </span>
                          )}
                        </td>
                        {showLocationCol ? (
                          <td className="col-location">
                            <span className="cell-oneline" title={String(r.location_name ?? '')}>
                              {dash(r.location_name)}
                            </span>
                          </td>
                        ) : null}
                        {showBrandCol ? (
                          <td className="col-brand">
                            <span className="cell-oneline">{dash(r.brand)}</span>
                          </td>
                        ) : null}
                        {showSimNumberCol ? (
                          <td className="col-sim">
                            <span className="cell-oneline" title={String(r.phone_number ?? '')}>
                              {dash(r.phone_number)}
                            </span>
                          </td>
                        ) : null}
                        {!isSimTab ? (
                          <td className="col-sn">
                            <span className="cell-oneline" title={String(r.serial_number ?? '')}>
                              {dash(r.serial_number)}
                            </span>
                          </td>
                        ) : null}
                        <td className="col-assigned">
                          {isSimTab ? (
                            <span className="cell-oneline" title={String(r.department_name ?? '')}>
                              {dash(r.department_name)}
                            </span>
                          ) : rowShowsHolderBadges ? (
                            <PersonNameCell
                              name={
                                r.original_assigned_person != null && String(r.original_assigned_person) !== ''
                                  ? String(r.original_assigned_person)
                                  : ''
                              }
                              sign={
                                r.original_assigned_person != null && String(r.original_assigned_person) !== ''
                                  ? 'original'
                                  : null
                              }
                            />
                          ) : (
                            <span
                              className="cell-oneline cell-oneline--strong"
                              title={currentHolderName(r) || ''}
                            >
                              {currentHolderName(r) ? currentHolderName(r) : '—'}
                            </span>
                          )}
                        </td>
                        <td className="col-status">
                          <AssetStatusPill r={r} />
                        </td>
                      </>
                    )}
                    <td
                      className="col-actions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <ActionsMenu
                        onView={() => void openDetails(Number(r.id), rowCategory)}
                        onUpdate={() => void openEdit(Number(r.id), rowCategory)}
                        onDelete={() => void onDelete(Number(r.id), rowCategory, String(r.asset_tag))}
                        onQr={() => void openQr(Number(r.id), rowCategory, r)}
                        deleteBusy={deletingId === Number(r.id)}
                      />
                    </td>
                  </tr>,
                  );
                  return out;
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AssetQrModal open={!!qrAsset} asset={qrAsset} onClose={() => setQrAsset(null)} />

      <Modal
        open={lostDateModalOpen}
        title="Lost / stolen date"
        subtitle="When was this asset lost or stolen? This is stored with the status change."
        onClose={() => setLostDateModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-soft" onClick={() => setLostDateModalOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmLostStolenDate}>
              Confirm
            </button>
          </>
        }
      >
        <label className="asset-field" style={{ display: 'grid', gap: '0.35rem' }}>
          <span className="asset-field-label">Date lost / stolen</span>
          <input
            className="input"
            type="date"
            min={DATE_MIN}
            value={lostEventDate}
            onChange={(e) => setLostEventDate(e.target.value)}
          />
        </label>
      </Modal>

      {showAddModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!saving && !handoverSaving) closeEditModal();
          }}
        >
          <div
            className={`asset-modal${editingId ? ' asset-modal--studio' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="asset-modal-head">
              <div className="asset-modal-title-wrap">
                <div className="asset-modal-icon" aria-hidden>
                  <ModalCategoryIcon category={editingCategory ?? categoryTab} />
                </div>
                <div>
                  {editingId ? (
                    <>
                      <div className="asset-modal-title-row">
                        <p className="asset-modal-kicker">Asset Record</p>
                        <span
                          className={`avm-pill ${statusPillTone(String(editAsset?.status ?? form.status ?? 'available'))}`}
                        >
                          {String(editAsset?.status ?? form.status) === 'deployed'
                            ? 'In Service'
                            : statusViewLabel(String(editAsset?.status ?? form.status ?? 'available'))}
                        </span>
                      </div>
                      <h3 className="asset-modal-title">
                        {dash(editAsset?.asset_tag)}{' '}
                        <span className="asset-modal-title-muted">
                          / Update · {COMPANY_TABS.find((t) => t.id === companyTab)?.label} Specifications
                        </span>
                      </h3>
                    </>
                  ) : (
                    <>
                      <p className="asset-modal-kicker">New asset</p>
                      <h3 className="asset-modal-title">
                        {addLabel} · {COMPANY_TABS.find((t) => t.id === companyTab)?.label}
                      </h3>
                      <p className="asset-modal-hint">Asset tag is auto-generated when you save.</p>
                    </>
                  )}
                </div>
              </div>
              <div className="asset-modal-head-right">
                {editingId ? (
                  <div className="edit-modal-tabs">
                    <button
                      type="button"
                      className={`tab-btn sm${editModalTab === 'details' ? ' active' : ''}`}
                      onClick={() => setEditModalTab('details')}
                    >
                      Asset details
                    </button>
                    {canHandoverEdit ? (
                      <button
                        type="button"
                        className={`tab-btn sm${editModalTab === 'handovers' ? ' active' : ''}`}
                        onClick={() => setEditModalTab('handovers')}
                      >
                        {editingCategory === 'pc' ? 'Assignments' : 'Handovers'}
                        {(() => {
                          const fromHistory = Array.isArray(editAsset?.handovers)
                            ? (editAsset.handovers as Asset[]).length
                            : 0;
                          const maxSlots = maxChainPersons(
                            String(editingCategory || editAsset?.category || ''),
                            editAsset,
                          );
                          const fromSlots = Array.from({ length: maxSlots }, (_, i) => i + 1).filter(
                            (i) => String(editAsset?.[`handover_person_${i}`] ?? '').trim(),
                          ).length;
                          const n = Math.max(fromHistory, fromSlots);
                          return n > 0 ? <span className="tab-count">{n}</span> : null;
                        })()}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`tab-btn sm${editModalTab === 'lifecycle' ? ' active' : ''}`}
                      onClick={() => setEditModalTab('lifecycle')}
                    >
                      Lifecycle
                    </button>
                    <button
                      type="button"
                      className={`tab-btn sm${editModalTab === 'attachments' ? ' active' : ''}`}
                      onClick={() => setEditModalTab('attachments')}
                    >
                      Attachments
                    </button>
                    {editingCategory === 'pc' ? (
                      <button
                        type="button"
                        className={`tab-btn sm${editModalTab === 'kit' ? ' active' : ''}`}
                        onClick={() => setEditModalTab('kit')}
                      >
                        Kit
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="asset-modal-close"
                  disabled={saving || handoverSaving}
                  aria-label="Close"
                  onClick={closeEditModal}
                >
                  <IconClose />
                </button>
              </div>
            </div>

            {editModalTab === 'lifecycle' && editingId && editingCategory ? (
              <div className="asset-modal-panel">
                <div className="lifecycle-history-scroll">
                  <AssetLifecycleTimeline
                    category={editingCategory}
                    assetId={editingId}
                    refreshKey={lifecycleRefreshKey}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {editingCategory === 'pc' && canManageKit ? (
                    <button type="button" className="btn btn-primary" onClick={() => setPcReplaceOpen(true)}>
                      Replace PC hardware
                    </button>
                  ) : null}
                  {editingCategory === 'pc' ? (
                    <button type="button" className="btn btn-soft" onClick={() => setEditModalTab('kit')}>
                      Manage kit
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-soft" onClick={() => setEditModalTab('details')}>
                    Back to details
                  </button>
                </div>
              </div>
            ) : null}

            {editModalTab === 'attachments' && editingId && editingCategory ? (
              <div className="asset-modal-panel">
                <AssetAttachments category={editingCategory} assetId={editingId} />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginTop: '0.85rem',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <button type="button" className="btn btn-soft" onClick={() => setEditModalTab('details')}>
                    Back to asset details
                  </button>
                </div>
              </div>
            ) : null}

            {editModalTab === 'kit' && editingId && editingCategory === 'pc' ? (
              <div className="asset-modal-panel">
                <PcKitPanel
                  pcId={editingId}
                  canManage={canManageKit}
                  refreshKey={lifecycleRefreshKey}
                  onChanged={() => {
                    setLifecycleRefreshKey((k) => k + 1);
                    void refreshEditAsset(editingId, editingCategory);
                    void reloadAfterMutation(true);
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-soft" onClick={() => setEditModalTab('lifecycle')}>
                    View lifecycle
                  </button>
                  <button type="button" className="btn btn-soft" onClick={() => setEditModalTab('details')}>
                    Back to details
                  </button>
                </div>
              </div>
            ) : null}

            {editModalTab === 'handovers' && editingId && editAsset ? (
              <HandoverEditPanel
                asset={editAsset}
                companyCode={companyTab}
                mode={String(editAsset.category || editingCategory) === 'pc' ? 'assignment' : 'handover'}
                handoverForm={handoverForm}
                setHandoverForm={setHandoverForm}
                handoverSaving={handoverSaving}
                error={error}
                onHandOver={() => void onHandOver()}
                onReturn={() => openReturnPopup()}
                onRefresh={async (patch) => {
                  if (patch && editingId) {
                    setEditAsset((prev) =>
                      prev && Number(prev.id) === editingId
                        ? ({ ...prev, ...patch, handovers: patch.handovers ?? prev.handovers } as Asset)
                        : prev,
                    );
                    if (detail && Number(detail.id) === editingId) {
                      setDetail((prev) =>
                        prev
                          ? ({ ...prev, ...patch, handovers: patch.handovers ?? prev.handovers } as Asset)
                          : prev,
                      );
                    }
                  }
                  return refreshEditAsset(
                    editingId,
                    editingCategory || String(editAsset?.category || 'mobile_phone'),
                  );
                }}
                onListRefresh={async () => {
                  setLifecycleRefreshKey((k) => k + 1);
                  await reloadAfterMutation(true);
                }}
                onClose={closeEditModal}
                onBack={() => setEditModalTab('details')}
              />
            ) : editModalTab === 'lifecycle' || editModalTab === 'kit' || editModalTab === 'attachments' ? null : (
            <form noValidate onSubmit={(e) => void onSave(e)}>
              <div className={isStudioForm ? 'asset-form-sections-wrap' : 'asset-form-grid'}>
                {isOtherForm ? (
                  <>
                    <Field label="First assigned user *" icon={<IconUser />}>
                      <EmployeeNameInput
                        required
                        companyCode={companyTab}
                        placeholder="Type first assigned employee…"
                        value={form.name}
                        onChange={(name) => setForm((prev) => ({ ...prev, name }))}
                        disabled={Boolean(editingId && String(editAsset?.user_name ?? '').trim())}
                      />
                    </Field>
                    <Field label="Department *" icon={<IconBuilding />}>
                      <select
                        className="asset-control bare"
                        required
                        value={form.department_id}
                        onChange={(e) => setForm((prev) => ({ ...prev, department_id: e.target.value }))}
                      >
                        <option value="">Select department</option>
                        {companyDepartments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Item *" icon={<IconTag />}>
                      <select
                        className="asset-control bare"
                        required
                        value={form.item_name}
                        onChange={(e) => setForm((prev) => ({ ...prev, item_name: e.target.value }))}
                      >
                        <option value="">Select item</option>
                        {OTHER_ITEM_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                        {form.item_name &&
                        !(OTHER_ITEM_OPTIONS as readonly string[]).includes(form.item_name) ? (
                          <option value={form.item_name}>{form.item_name}</option>
                        ) : null}
                      </select>
                    </Field>
                    <Field label="Purchased date (optional)" icon={<IconCalendar />}>
                      <input
                        className="asset-control bare"
                        type="date" min={DATE_MIN}
                        value={form.date}
                        onChange={(e) => {
                          const date = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            date,
                            warranty:
                              date && prev.warranty_period
                                ? warrantyExpiryFromPeriod(date, prev.warranty_period)
                                : '',
                          }));
                        }}
                      />
                    </Field>
                    <Field label="Handover date (optional)" icon={<IconCalendar />}>
                      <input
                        className="asset-control bare"
                        type="date" min={DATE_MIN}
                        value={form.handover_date}
                        onChange={(e) => setForm((prev) => ({ ...prev, handover_date: e.target.value }))}
                      />
                    </Field>
                    <p
                      style={{
                        gridColumn: '1 / -1',
                        margin: '-0.35rem 0 0.25rem',
                        fontSize: '0.78rem',
                        color: 'var(--muted)',
                      }}
                    >
                      Leave dates blank for old stock so they are excluded from IT expenditure.
                    </p>
                    <Field label="Branch / location *" icon={<IconPin />}>
                      <select
                        className="asset-control bare"
                        required
                        value={form.location_id}
                        onChange={(e) => setForm((prev) => ({ ...prev, location_id: e.target.value }))}
                      >
                        <option value="">Select branch</option>
                        {companyLocations.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </Field>
                    {!editingId ? (
                      <p
                        style={{
                          gridColumn: '1 / -1',
                          margin: '-0.35rem 0 0.25rem',
                          fontSize: '0.78rem',
                          color: 'var(--muted)',
                        }}
                      >
                        Asset ID is auto-assigned per company + branch (e.g. ITL-KHO-001,
                        IMS-201-001). Each branch starts at 001. Username stays as the first
                        assigned user.
                      </p>
                    ) : null}
                    {editingId ? (
                      <Field label="Asset ID" icon={<IconTag />}>
                        <input
                          className="asset-control bare"
                          value={String(editAsset?.asset_tag ?? '')}
                          readOnly
                          title="Asset ID cannot be changed"
                        />
                      </Field>
                    ) : null}
                    <Field label="S/N" icon={<IconBarcode />}>
                      <input className="asset-control bare" placeholder="Enter serial number" value={form.serial_number} onChange={(e) => setForm((prev) => ({ ...prev, serial_number: e.target.value }))} />
                    </Field>
                    <Field label="Brand" icon={<IconTag />}>
                      <input className="asset-control bare" placeholder="Enter brand" value={form.brand} onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))} />
                    </Field>
                    <Field label="Model" icon={<IconLaptop />}>
                      <input className="asset-control bare" placeholder="Enter model" value={form.model} onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))} />
                    </Field>
                    <Field label="Supplier" icon={<IconTruck />}>
                      <input className="asset-control bare" placeholder="Enter supplier" value={form.supplier} onChange={(e) => setForm((prev) => ({ ...prev, supplier: e.target.value }))} />
                    </Field>
                    <Field label="Invoice No" icon={<IconDoc />}>
                      <input className="asset-control bare" placeholder="Enter invoice number" value={form.invoice_no} onChange={(e) => setForm((prev) => ({ ...prev, invoice_no: e.target.value }))} />
                    </Field>
                    <Field label="Warranty period" icon={<IconCalendar />}>
                      <select
                        className="asset-control bare"
                        value={form.warranty_period}
                        onChange={(e) => {
                          const period = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            warranty_period: period,
                            warranty:
                              prev.date && period
                                ? warrantyExpiryFromPeriod(prev.date, period)
                                : '',
                          }));
                        }}
                      >
                        <option value="">Select period</option>
                        {OTHER_WARRANTY_PERIOD_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                        {form.warranty_period &&
                        !(OTHER_WARRANTY_PERIOD_OPTIONS as readonly string[]).includes(
                          form.warranty_period,
                        ) ? (
                          <option value={form.warranty_period}>{form.warranty_period}</option>
                        ) : null}
                      </select>
                    </Field>
                    <Field label="Warranty expires on" icon={<IconCalendar />}>
                      <input
                        className="asset-control bare"
                        type="date" min={DATE_MIN}
                        readOnly
                        value={
                          form.warranty ||
                          (form.date && form.warranty_period
                            ? warrantyExpiryFromPeriod(form.date, form.warranty_period)
                            : '')
                        }
                        title={
                          form.date && form.warranty_period
                            ? `Calculated from purchased date + ${form.warranty_period}`
                            : 'Select purchased date and warranty period'
                        }
                        placeholder="Select purchase date & period"
                      />
                    </Field>
                    <Field label="Amount (Rs.)" icon={<IconCoin />}>
                      <input className="asset-control bare" placeholder="Enter amount" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} />
                    </Field>
                    <Field label="Status" icon={<IconTag />}>
                      <StatusSelect value={form.status} onChange={pickAssetStatus} />
                    </Field>
                    {form.status === 'lost' && statusEventNote ? (
                      <p
                        style={{
                          gridColumn: '1 / -1',
                          margin: '-0.35rem 0 0.25rem',
                          fontSize: '0.78rem',
                          color: 'var(--muted)',
                        }}
                      >
                        {statusEventNote}
                      </p>
                    ) : null}
                    <Field label="Specification" icon={<IconNote />} className="span-2">
                      <textarea className="asset-control bare area" rows={3} placeholder="Enter specification" value={form.specification} onChange={(e) => setForm((prev) => ({ ...prev, specification: e.target.value }))} />
                    </Field>
                    <Field label="Remark" icon={<IconNote />} className="span-2">
                      <textarea className="asset-control bare area" rows={3} placeholder="Enter remark" value={form.other} onChange={(e) => setForm((prev) => ({ ...prev, other: e.target.value }))} />
                    </Field>
                    <div className="asset-field span-2" style={{ display: 'block' }}>
                      {editingId && editingCategory ? (
                        <AssetAttachments category={editingCategory} assetId={editingId} />
                      ) : (
                        <AssetAttachments
                          stagedFiles={pendingAttachmentFiles}
                          onStagedFilesChange={setPendingAttachmentFiles}
                        />
                      )}
                    </div>
                  </>
                ) : isStudioForm ? (
                  <div className={editingId ? 'aed-body' : 'asset-form-sections'}>
                    {editingId ? (
                      <aside className="aed-side">
                        <div className="aed-side-card">
                          <span className="aed-side-label">
                            {isSimForm ? 'SIM Card' : 'Registered Machine'}
                          </span>
                          <strong className="aed-side-title">
                            {isSimForm
                              ? form.phone_number.trim() ||
                                dash(editAsset?.phone_number) ||
                                'SIM'
                              : [form.brand, form.model].filter(Boolean).join(' ') ||
                                dash(editAsset?.brand) ||
                                (isPcForm ? 'Desktop PC' : isPhoneForm ? 'Mobile Phone' : 'Laptop')}
                          </strong>
                          <ul className="aed-side-specs">
                            {isSimForm ? (
                              <>
                                <li>{companyUiLabel(simFormCompany)}</li>
                                <li>
                                  {form.phone_number
                                    ? `SIM ${form.phone_number}`
                                    : 'SIM number —'}
                                </li>
                              </>
                            ) : (
                              <li>{form.model ? `Model ${form.model}` : 'Model —'}</li>
                            )}
                            {isSimForm ? null : isPhoneForm ? (
                              <>
                                <li>{form.imei_number ? `IMEI ${form.imei_number}` : 'IMEI —'}</li>
                                <li>
                                  {form.phone_number ? `Phone ${form.phone_number}` : 'Phone —'}
                                </li>
                              </>
                            ) : (
                              <>
                                <li>{form.processor || 'Processor —'}</li>
                                <li>{form.ram ? `${formatGb(form.ram)} GB RAM` : 'RAM —'}</li>
                                {isPcForm || isLaptopForm ? (
                                  <>
                                    <li>{form.ssd ? `${formatGb(form.ssd)} GB SSD` : 'SSD —'}</li>
                                    <li>{form.hdd ? `${formatGb(form.hdd)} GB HDD` : 'HDD —'}</li>
                                    {isPcForm ? (
                                      <li>
                                        {form.windows_version.trim()
                                          ? form.windows_version
                                          : 'Windows —'}
                                      </li>
                                    ) : null}
                                  </>
                                ) : (
                                  <li>
                                    {form.capacity
                                      ? `${formatGb(form.capacity)} GB`
                                      : 'Storage —'}
                                  </li>
                                )}
                              </>
                            )}
                            {isPcForm ? (
                              <li>
                                {form.monitor_brand
                                  ? `Monitor ${form.monitor_brand}`
                                  : 'Monitor —'}
                              </li>
                            ) : null}
                          </ul>
                        </div>
                        <div className="aed-side-card">
                          <span className="aed-side-label">Current Custody</span>
                          <strong className="aed-side-title">
                            {form.name.trim() ||
                              dash(
                                editAsset?.allocated_person ??
                                  editAsset?.current_holder ??
                                  editAsset?.assigned_person_name,
                              )}
                          </strong>
                          <ul className="aed-side-specs">
                            <li>
                              {companyDepartments.find((d) => String(d.id) === form.department_id)?.name ||
                                dash(editAsset?.department_name)}
                            </li>
                            <li>
                              {companyLocations.find((l) => String(l.id) === form.location_id)?.name ||
                                dash(editAsset?.location_name)}
                            </li>
                          </ul>
                        </div>
                        <nav className="aed-side-nav" aria-label="Form sections">
                          {(
                            [
                              ['assignment', 'Assignment & Status'],
                              ['device', isSimForm ? 'SIM Details' : 'Device Specifications'],
                              ...(isSimForm
                                ? []
                                : [['procurement', 'Supplier & Financials'] as const]),
                              [
                                'warranty',
                                isSimForm ? 'Issue & Handover' : 'Purchase & Warranty',
                              ] as const,
                              ['notes', 'Internal Notes'] as const,
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              className={`aed-nav-btn${editFormSection === id ? ' active' : ''}`}
                              onClick={() => {
                                setEditFormSection(id);
                                document.getElementById(`aed-sec-${id}`)?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start',
                                });
                              }}
                            >
                              <span>{label}</span>
                              {editFormSection === id ? <span className="aed-nav-active">Active</span> : null}
                            </button>
                          ))}
                        </nav>
                        <p className="aed-side-foot">
                          Last modified:{' '}
                          {editAsset?.updated_at
                            ? new Date(String(editAsset.updated_at)).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : '—'}
                        </p>
                      </aside>
                    ) : null}
                    <div className={editingId ? 'aed-main asset-form-sections' : 'asset-form-sections'}>
                    <FormSection
                      id="aed-sec-assignment"
                      title="Assignment & Custody"
                      icon={<IconUser />}
                    >
                      {isPcForm ? (
                        <Field label="Company (subcategory) *" icon={<IconBuilding />}>
                          <select
                            className="asset-control bare"
                            required
                            disabled={!!editingId}
                            value={companyTab}
                            onChange={(e) => {
                              const next = e.target.value as CompanyTab;
                              setCompanyTab(next);
                              setForm((prev) => ({ ...prev, location_id: '', department_id: '' }));
                            }}
                          >
                            {companyTabsForCategory('pc').map((tab) => (
                              <option key={tab.id} value={tab.id}>
                                {tab.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : null}
                      {isSimForm ? (
                        <Field label="Company *" icon={<IconBuilding />}>
                          <select
                            className="asset-control bare"
                            required
                            value={simFormCompany}
                            onChange={(e) => {
                              const next = e.target.value as SimCompanyCode;
                              setSimFormCompany(next);
                              setForm((prev) => ({ ...prev, location_id: '', department_id: '' }));
                            }}
                          >
                            <option value="IT">ITL</option>
                            <option value="IMS">IMS</option>
                            <option value="ISP">ISP</option>
                          </select>
                        </Field>
                      ) : null}
                      {(isLaptopForm || (isPhoneForm && !isSimForm)) ? (
                        <Field label="Type *" icon={<IconTag />}>
                          <EntryTypeSelect
                            value={form.entry_type}
                            onChange={(entry_type) => setForm((prev) => ({ ...prev, entry_type }))}
                          />
                        </Field>
                      ) : null}
                      <Field
                        label={
                          isPcForm
                            ? 'Name (assigned to)'
                            : isSimForm
                              ? 'Owner name *'
                              : 'Name (current holder) *'
                        }
                        icon={<IconUser />}
                      >
                        <EmployeeNameInput
                          required={!isPcForm}
                          allCompanies={isPcForm || isSimForm}
                          companyCode={isSimForm ? simFormCompany : companyTab === 'SIM' ? 'IT' : companyTab}
                          placeholder={
                            isPcForm
                              ? 'Employee name (optional for available stock)'
                              : isSimForm
                                ? 'Type owner / employee name…'
                                : 'Type employee name…'
                          }
                          value={form.name}
                          onChange={(name) => {
                            setForm((prev) => {
                              if (editingId) {
                                return { ...prev, name };
                              }
                              if (isPhoneForm) {
                                const handed =
                                  prev.handed_over_on || new Date().toISOString().slice(0, 10);
                                return {
                                  ...prev,
                                  name,
                                  first_handover_person: name,
                                  handed_over_on: handed,
                                };
                              }
                              if (isLaptopForm) {
                                return {
                                  ...prev,
                                  name,
                                  first_handover_person: name,
                                  handed_over_on:
                                    prev.handed_over_on || new Date().toISOString().slice(0, 10),
                                };
                              }
                              return { ...prev, name };
                            });
                          }}
                        />
                      </Field>
                      <Field label={isSimForm ? 'Department *' : 'Department'} icon={<IconBuilding />}>
                        <select
                          className="asset-control bare"
                          required={isSimForm}
                          value={form.department_id}
                          onChange={(e) => setForm((prev) => ({ ...prev, department_id: e.target.value }))}
                        >
                          <option value="">Select department</option>
                          {companyDepartments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        label={
                          isPcForm
                            ? 'Branch / Location *'
                            : isSimForm
                              ? 'Location *'
                              : 'Location'
                        }
                        icon={<IconPin />}
                      >
                        <select
                          className="asset-control bare"
                          required={isPcForm || isSimForm}
                          value={form.location_id}
                          onChange={(e) => setForm((prev) => ({ ...prev, location_id: e.target.value }))}
                        >
                          <option value="">Select branch</option>
                          {companyLocations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                          {/* Keep current branch selectable even if filtered from the branch list */}
                          {form.location_id &&
                          !companyLocations.some((l) => String(l.id) === form.location_id)
                            ? (() => {
                                const orphan = locations.find(
                                  (l) => String(l.id) === form.location_id,
                                );
                                return (
                                  <option key={`orphan-${form.location_id}`} value={form.location_id}>
                                    {orphan?.name || `Branch #${form.location_id}`}
                                  </option>
                                );
                              })()
                            : null}
                        </select>
                      </Field>
                      {isPcForm && !editingId ? (
                        <p
                          style={{
                            gridColumn: '1 / -1',
                            margin: '-0.35rem 0 0.25rem',
                            fontSize: '0.78rem',
                            color: 'var(--muted)',
                          }}
                        >
                          Choose company (ITL / IMS / ISP) and branch — asset ID is auto-assigned
                          (e.g. ITL-KHO-PC-0001, IMS-201-PC-0001, ISP-KDY-PC-0001). Set status
                          below (Available, Assigned, etc.) when adding.
                        </p>
                      ) : null}
                      {isSimForm ? null : (
                        <Field label="S/N (Serial Number)" icon={<IconBarcode />}>
                          <input
                            className="asset-control bare"
                            placeholder="Enter serial number"
                            value={form.serial_number}
                            onChange={(e) => setForm((prev) => ({ ...prev, serial_number: e.target.value }))}
                          />
                        </Field>
                      )}
                      <Field label="Asset Status" icon={<IconTag />}>
                        <StatusSelect value={form.status} onChange={pickAssetStatus} />
                      </Field>
                      {form.status === 'lost' && statusEventNote ? (
                        <p
                          style={{
                            gridColumn: '1 / -1',
                            margin: '-0.35rem 0 0.35rem',
                            fontSize: '0.78rem',
                            color: 'var(--muted)',
                          }}
                        >
                          {statusEventNote}
                        </p>
                      ) : null}
                      {editingId ? (
                        <Field label="Internal Asset Tag" icon={<IconTag />}>
                          <input
                            className="asset-control bare"
                            value={String(editAsset?.asset_tag ?? '')}
                            readOnly
                            title="Asset tag cannot be changed"
                          />
                        </Field>
                      ) : null}
                    </FormSection>

                    <FormSection
                      id="aed-sec-device"
                      title={isSimForm ? 'SIM Details' : 'Device Hardware Specifications'}
                      icon={isPcForm ? <IconPc /> : isPhoneForm ? <IconPhone /> : <IconLaptop />}
                      badge={
                        <span className="avm-pill muted">
                          {isPcForm
                            ? 'Desktop PC Category'
                            : isSimForm
                              ? 'SIM Card'
                              : isPhoneForm
                                ? 'Mobile Phone Category'
                                : 'Laptop Category'}
                        </span>
                      }
                    >
                      {isPcForm && editingId && canManageKit ? (
                        <div className="asset-field span-2" style={{ marginBottom: '0.35rem' }}>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.65rem',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.7rem 0.85rem',
                              borderRadius: 10,
                              border: '1px solid #e2e8f0',
                              background: '#f8fafc',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <strong style={{ display: 'block', fontSize: '0.88rem' }}>
                                Completely replacing this PC?
                              </strong>
                              <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                                Keeps the same asset tag and users. Old specs are logged on Lifecycle.
                              </span>
                            </div>
                            <button
                              type="button"
                              className="btn btn-soft"
                              onClick={() => setPcReplaceOpen(true)}
                            >
                              Replace PC hardware
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {isSimForm ? (
                        <>
                          <Field label="SIM number *" icon={<IconPhone />}>
                            <input
                              className="asset-control bare"
                              required
                              placeholder="Enter SIM / mobile number"
                              value={form.phone_number}
                              onChange={(e) => setForm((prev) => ({ ...prev, phone_number: e.target.value }))}
                            />
                          </Field>
                          <Field label="Package price (LKR)" icon={<IconCoin />}>
                            <input
                              className="asset-control bare"
                              placeholder="Enter package price"
                              value={form.amount}
                              onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                            />
                          </Field>
                        </>
                      ) : (
                        <>
                      <Field label="Brand" icon={<IconTag />}>
                        <input
                          className="asset-control bare"
                          placeholder="Enter brand"
                          value={form.brand}
                          onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                        />
                      </Field>
                      <Field
                        label={isPcForm || isPhoneForm ? 'Model' : 'Model Identifier'}
                        icon={isPcForm ? <IconPc /> : isPhoneForm ? <IconPhone /> : <IconLaptop />}
                      >
                        <input
                          className="asset-control bare"
                          placeholder="Enter model"
                          value={form.model}
                          onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                        />
                      </Field>
                      {isPhoneForm ? (
                        <>
                          <Field label="IMEI Number" icon={<IconBarcode />}>
                            <input
                              className="asset-control bare"
                              placeholder="Enter IMEI number"
                              value={form.imei_number}
                              onChange={(e) => setForm((prev) => ({ ...prev, imei_number: e.target.value }))}
                            />
                          </Field>
                          <Field label="IMEI Number 2" icon={<IconBarcode />}>
                            <input
                              className="asset-control bare"
                              placeholder="Second IMEI (dual-SIM)"
                              value={form.imei_number_2}
                              onChange={(e) => setForm((prev) => ({ ...prev, imei_number_2: e.target.value }))}
                            />
                          </Field>
                          <Field label="Phone No" icon={<IconPhone />}>
                            <input
                              className="asset-control bare"
                              placeholder="Enter phone number"
                              value={form.phone_number}
                              onChange={(e) => setForm((prev) => ({ ...prev, phone_number: e.target.value }))}
                            />
                          </Field>
                          <div className="asset-field span-2">
                            <span className="asset-field-label">Accessories</span>
                            <div className="asset-check-row">
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_charger}
                                  onChange={(e) =>
                                    setForm((prev) => ({ ...prev, has_charger: e.target.checked }))
                                  }
                                />
                                Charger
                              </label>
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_data_cable}
                                  onChange={(e) =>
                                    setForm((prev) => ({ ...prev, has_data_cable: e.target.checked }))
                                  }
                                />
                                Data cable
                              </label>
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_back_cover}
                                  onChange={(e) =>
                                    setForm((prev) => ({ ...prev, has_back_cover: e.target.checked }))
                                  }
                                />
                                Back cover
                              </label>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                      <Field
                        label={isPcForm ? 'Processor' : 'Processor (CPU)'}
                        icon={<IconChip />}
                      >
                        <input
                          className="asset-control bare"
                          placeholder="Enter processor"
                          value={form.processor}
                          onChange={(e) => setForm((prev) => ({ ...prev, processor: e.target.value }))}
                        />
                      </Field>
                      <Field
                        label={isPcForm ? 'RAM (GB)' : 'RAM Memory (GB)'}
                        icon={<IconRam />}
                      >
                        <input
                          className="asset-control bare"
                          placeholder="Enter RAM (GB)"
                          value={form.ram}
                          onChange={(e) => setForm((prev) => ({ ...prev, ram: e.target.value }))}
                        />
                      </Field>
                      {isPcForm || isLaptopForm ? (
                        <>
                          <Field label="SSD (GB)" icon={<IconStorage />}>
                            <input
                              className="asset-control bare"
                              placeholder="Enter SSD capacity (GB)"
                              value={form.ssd}
                              onChange={(e) => setForm((prev) => ({ ...prev, ssd: e.target.value }))}
                            />
                          </Field>
                          <Field label="HDD (GB)" icon={<IconStorage />}>
                            <input
                              className="asset-control bare"
                              placeholder="Enter HDD capacity (GB)"
                              value={form.hdd}
                              onChange={(e) => setForm((prev) => ({ ...prev, hdd: e.target.value }))}
                            />
                          </Field>
                          {isPcForm ? (
                            <Field label="Windows version" icon={<IconPc />}>
                              <select
                                className="asset-control bare"
                                value={form.windows_version}
                                onChange={(e) =>
                                  setForm((prev) => ({ ...prev, windows_version: e.target.value }))
                                }
                              >
                                <option value="">Select Windows version</option>
                                {WINDOWS_VERSION_OPTIONS.map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          ) : null}
                        </>
                      ) : (
                        <Field
                          label="Storage Capacity (GB)"
                          icon={<IconStorage />}
                        >
                          <input
                            className="asset-control bare"
                            placeholder="Enter capacity (GB)"
                            value={form.capacity}
                            onChange={(e) => setForm((prev) => ({ ...prev, capacity: e.target.value }))}
                          />
                        </Field>
                      )}
                      {isLaptopForm ? (
                        <div className="asset-field span-2">
                          <span className="asset-field-label">Accessories</span>
                          <div className="asset-check-row">
                            <label className="asset-check">
                              <input
                                type="checkbox"
                                checked={form.has_mouse}
                                onChange={(e) =>
                                  setForm((prev) => ({ ...prev, has_mouse: e.target.checked }))
                                }
                              />
                              Mouse given with this laptop
                            </label>
                          </div>
                        </div>
                      ) : null}
                      {isPcForm ? (
                        <>
                          <Field label="Monitor brand" icon={<IconTag />}>
                            <input
                              className="asset-control bare"
                              placeholder="Enter monitor brand"
                              value={form.monitor_brand}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, monitor_brand: e.target.value }))
                              }
                            />
                          </Field>
                          <div className="asset-field span-2">
                            <span className="asset-field-label">Accessories</span>
                            <div className="asset-check-row">
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_power_cable}
                                  onChange={(e) =>
                                    setForm((prev) => ({ ...prev, has_power_cable: e.target.checked }))
                                  }
                                />
                                Power cable
                              </label>
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_vga_cable}
                                  onChange={(e) =>
                                    setForm((prev) => ({ ...prev, has_vga_cable: e.target.checked }))
                                  }
                                />
                                VGA cable
                              </label>
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_keyboard}
                                  onChange={(e) =>
                                    setForm((prev) => ({ ...prev, has_keyboard: e.target.checked }))
                                  }
                                />
                                Keyboard
                              </label>
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_mouse}
                                  onChange={(e) =>
                                    setForm((prev) => ({ ...prev, has_mouse: e.target.checked }))
                                  }
                                />
                                Mouse
                              </label>
                              <label className="asset-check">
                                <input
                                  type="checkbox"
                                  checked={form.has_ups}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setForm((prev) => ({
                                      ...prev,
                                      has_ups: checked,
                                      ups_model: checked ? prev.ups_model.trim() || '650' : '',
                                      ups_brand: checked ? prev.ups_brand : '',
                                      ups_purchase_date: checked ? prev.ups_purchase_date : '',
                                      ups_warranty_period: checked ? prev.ups_warranty_period : '',
                                      ups_warranty_expires_on: checked
                                        ? prev.ups_warranty_expires_on
                                        : '',
                                    }));
                                  }}
                                />
                                UPS
                              </label>
                              {form.has_ups ? (
                                <>
                                  <select
                                    className="asset-control asset-ups-brand"
                                    value={form.ups_brand}
                                    onChange={(e) =>
                                      setForm((prev) => ({ ...prev, ups_brand: e.target.value }))
                                    }
                                  >
                                    <option value="">Select UPS brand</option>
                                    {UPS_BRAND_OPTIONS.map((brand) => (
                                      <option key={brand} value={brand}>
                                        {brand}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    className="asset-control asset-ups-model"
                                    placeholder="UPS model (e.g. 650)"
                                    value={form.ups_model}
                                    onChange={(e) =>
                                      setForm((prev) => ({ ...prev, ups_model: e.target.value }))
                                    }
                                  />
                                </>
                              ) : null}
                            </div>
                          </div>
                        </>
                      ) : null}
                        </>
                      )}
                      </>
                      )}
                    </FormSection>

                    {isSimForm ? null : (
                    <FormSection
                      id="aed-sec-procurement"
                      title="Procurement & Supplier Info"
                      icon={<IconTruck />}
                      badge={
                        form.invoice_no.trim() ? (
                          <span className="avm-pill ok">PO Ref Validated</span>
                        ) : null
                      }
                    >
                      <Field
                        label={isPhoneForm ? 'Vendor' : 'Supplier / Provider'}
                        icon={<IconTruck />}
                      >
                        <input
                          className="asset-control bare"
                          placeholder={
                            isPhoneForm ? 'Enter vendor' : 'Enter supplier / service provider'
                          }
                          value={form.supplier}
                          onChange={(e) => setForm((prev) => ({ ...prev, supplier: e.target.value }))}
                        />
                      </Field>
                      <Field label="Invoice Number" icon={<IconDoc />}>
                        <input
                          className="asset-control bare"
                          placeholder="Enter invoice number"
                          value={form.invoice_no}
                          onChange={(e) => setForm((prev) => ({ ...prev, invoice_no: e.target.value }))}
                        />
                      </Field>
                      <Field
                        label={isPhoneForm ? 'Price (LKR)' : 'Purchase Amount (LKR)'}
                        icon={<IconCoin />}
                      >
                        <input
                          className="asset-control bare"
                          placeholder="Enter amount"
                          value={form.amount}
                          onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                        />
                      </Field>
                    </FormSection>
                    )}

                    <FormSection
                      id="aed-sec-warranty"
                      title={isSimForm ? 'Issue & Handover Dates' : 'Purchase & Warranty'}
                      icon={<IconCalendar />}
                    >
                      {isSimForm ? (
                        <>
                          <Field label="Issue date" icon={<IconCalendar />}>
                            <input
                              className="asset-control bare"
                              type="date"
                              min={DATE_MIN}
                              value={form.date}
                              onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                            />
                          </Field>
                          <Field label="Handover date" icon={<IconCalendar />}>
                            <input
                              className="asset-control bare"
                              type="date"
                              min={DATE_MIN}
                              required={!!form.name.trim()}
                              value={form.handed_over_on}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  handed_over_on: e.target.value,
                                  first_handover_person:
                                    prev.first_handover_person || prev.name,
                                }))
                              }
                            />
                          </Field>
                          {!editingId ? (
                            <Field label="Originally assigned / 1st handover" icon={<IconUser />}>
                              <EmployeeNameInput
                                companyCode={simFormCompany}
                                allCompanies
                                placeholder="Same as owner on create"
                                value={form.first_handover_person}
                                onChange={(person) => {
                                  setForm((prev) => ({
                                    ...prev,
                                    first_handover_person: person,
                                    name: prev.name.trim() ? prev.name : person,
                                  }));
                                }}
                              />
                            </Field>
                          ) : null}
                        </>
                      ) : isPhoneForm ? (
                        <>
                          {!editingId ? (
                            <>
                              <Field label="Originally assigned / 1st handover" icon={<IconUser />}>
                                <EmployeeNameInput
                                  companyCode={companyTab}
                                  placeholder="Same as holder on create"
                                  value={form.first_handover_person}
                                  onChange={(person) => {
                                    setForm((prev) => ({
                                      ...prev,
                                      first_handover_person: person,
                                      name: prev.name.trim() ? prev.name : person,
                                    }));
                                  }}
                                />
                              </Field>
                              <Field label="Handover date" icon={<IconCalendar />}>
                                <input
                                  className="asset-control bare"
                                  type="date" min={DATE_MIN}
                                  required={
                                    !!(form.first_handover_person.trim() || form.name.trim())
                                  }
                                  value={form.handed_over_on}
                                  onChange={(e) =>
                                    setForm((prev) => ({
                                      ...prev,
                                      handed_over_on: e.target.value,
                                    }))
                                  }
                                />
                              </Field>
                            </>
                          ) : null}
                          <Field label="Purchase date" icon={<IconCalendar />}>
                            <input
                              className="asset-control bare"
                              type="date" min={DATE_MIN}
                              value={form.date}
                              onChange={(e) => applyPurchaseDate(e.target.value)}
                            />
                          </Field>
                          <Field label="Warranty period" icon={<IconCalendar />}>
                            <select
                              className="asset-control bare"
                              value={form.warranty_period}
                              onChange={(e) => {
                                const period = e.target.value;
                                setForm((prev) => ({
                                  ...prev,
                                  warranty_period: period,
                                  warranty:
                                    prev.date && period
                                      ? warrantyExpiryFromPeriod(prev.date, period)
                                      : '',
                                }));
                              }}
                            >
                              <option value="">Select period</option>
                              {WARRANTY_PERIOD_OPTIONS.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Warranty void date" icon={<IconCalendar />}>
                            {form.warranty_period === 'Expired' ? (
                              <input
                                className="asset-control bare"
                                readOnly
                                value="Expired"
                                title="Warranty marked as expired"
                              />
                            ) : (
                              <input
                                className="asset-control bare"
                                type="date" min={DATE_MIN}
                                readOnly
                                value={
                                  form.warranty ||
                                  (form.date && form.warranty_period
                                    ? warrantyExpiryFromPeriod(form.date, form.warranty_period)
                                    : '')
                                }
                                title={
                                  form.date && form.warranty_period
                                    ? `Calculated from purchase date + ${form.warranty_period}`
                                    : 'Select purchase date and warranty period'
                                }
                              />
                            )}
                          </Field>
                        </>
                      ) : (
                        <>
                          <Field
                            label={isPcForm ? 'Date (purchase)' : 'Acquired On'}
                            icon={<IconCalendar />}
                          >
                            <input
                              className="asset-control bare"
                              type="date" min={DATE_MIN}
                              value={form.date}
                              onChange={(e) => applyPurchaseDate(e.target.value)}
                            />
                          </Field>
                          {isLaptopForm || isPcForm ? (
                            <>
                              <Field
                                label={isLaptopForm ? 'Warranty period' : 'PC warranty period'}
                                icon={<IconCalendar />}
                              >
                                <select
                                  className="asset-control bare"
                                  value={form.warranty_period}
                                  onChange={(e) => {
                                    const period = e.target.value;
                                    setForm((prev) => ({
                                      ...prev,
                                      warranty_period: period,
                                      warranty:
                                        prev.date && period
                                          ? warrantyExpiryFromPeriod(prev.date, period)
                                          : prev.warranty,
                                    }));
                                  }}
                                >
                                  <option value="">Select period</option>
                                  {WARRANTY_PERIOD_OPTIONS.map((p) => (
                                    <option key={p} value={p}>
                                      {p}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field
                                label={isLaptopForm ? 'Warranty void date' : 'PC warranty expiry'}
                                icon={<IconCalendar />}
                              >
                                {form.warranty_period === 'Expired' ? (
                                  <input
                                    className="asset-control bare"
                                    readOnly
                                    value="Expired"
                                    title="Warranty marked as expired"
                                  />
                                ) : (
                                  <input
                                    className="asset-control bare"
                                    type="date" min={DATE_MIN}
                                    value={
                                      form.warranty ||
                                      (form.date && form.warranty_period
                                        ? warrantyExpiryFromPeriod(form.date, form.warranty_period)
                                        : '')
                                    }
                                    readOnly
                                    title="Calculated from purchase date + warranty period"
                                  />
                                )}
                              </Field>
                              {isPcForm && form.has_ups ? (
                                <>
                                  <Field label="UPS purchased date" icon={<IconCalendar />}>
                                    <input
                                      className="asset-control bare"
                                      type="date" min={DATE_MIN}
                                      value={form.ups_purchase_date}
                                      onChange={(e) => {
                                        const upsDate = e.target.value;
                                        setForm((prev) => ({
                                          ...prev,
                                          ups_purchase_date: upsDate,
                                          ups_warranty_expires_on:
                                            upsDate && prev.ups_warranty_period
                                              ? warrantyExpiryFromPeriod(
                                                  upsDate,
                                                  prev.ups_warranty_period,
                                                )
                                              : '',
                                        }));
                                      }}
                                    />
                                  </Field>
                                  <Field label="UPS warranty period" icon={<IconCalendar />}>
                                    <select
                                      className="asset-control bare"
                                      value={form.ups_warranty_period}
                                      onChange={(e) => {
                                        const period = e.target.value;
                                        setForm((prev) => ({
                                          ...prev,
                                          ups_warranty_period: period,
                                          ups_warranty_expires_on:
                                            prev.ups_purchase_date && period
                                              ? warrantyExpiryFromPeriod(
                                                  prev.ups_purchase_date,
                                                  period,
                                                )
                                              : '',
                                        }));
                                      }}
                                    >
                                      <option value="">Select period</option>
                                      {WARRANTY_PERIOD_OPTIONS.map((p) => (
                                        <option key={p} value={p}>
                                          {p}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="UPS warranty expiry" icon={<IconCalendar />}>
                                    {form.ups_warranty_period === 'Expired' ? (
                                      <input
                                        className="asset-control bare"
                                        readOnly
                                        value="Expired"
                                        title="UPS warranty marked as expired"
                                      />
                                    ) : (
                                      <input
                                        className="asset-control bare"
                                        type="date" min={DATE_MIN}
                                        value={
                                          form.ups_warranty_expires_on ||
                                          (form.ups_purchase_date && form.ups_warranty_period
                                            ? warrantyExpiryFromPeriod(
                                                form.ups_purchase_date,
                                                form.ups_warranty_period,
                                              )
                                            : '')
                                        }
                                        readOnly
                                        title="Calculated from UPS purchased date + warranty period"
                                      />
                                    )}
                                  </Field>
                                </>
                              ) : null}
                            </>
                          ) : (
                            <Field label="Warranty expiry" icon={<IconCalendar />}>
                              <input
                                className="asset-control bare"
                                type="date" min={DATE_MIN}
                                value={form.warranty}
                                onChange={(e) => setForm((prev) => ({ ...prev, warranty: e.target.value }))}
                              />
                            </Field>
                          )}
                        </>
                      )}
                    </FormSection>

                    <FormSection
                      id="aed-sec-notes"
                      title={isSimForm ? 'Internal Notes (handovers)' : 'Internal Notes'}
                      icon={<IconNote />}
                    >
                      <Field
                        label={isSimForm ? 'Internal note' : 'Other / notes'}
                        icon={<IconNote />}
                        className="span-2"
                      >
                        <textarea
                          className="asset-control bare area"
                          rows={3}
                          maxLength={2000}
                          placeholder={
                            isSimForm
                              ? 'Notes about this SIM and its handovers…'
                              : 'Enter any additional notes...'
                          }
                          value={form.other}
                          onChange={(e) => setForm((prev) => ({ ...prev, other: e.target.value }))}
                        />
                        <p
                          style={{
                            margin: '0.35rem 0 0',
                            textAlign: 'right',
                            color: 'var(--muted)',
                            fontSize: '0.78rem',
                          }}
                        >
                          {form.other.length} / 2000 characters
                        </p>
                      </Field>
                      <div className="asset-field span-2" style={{ display: 'block' }}>
                        {editingId && editingCategory ? (
                          <AssetAttachments category={editingCategory} assetId={editingId} />
                        ) : (
                          <AssetAttachments
                            stagedFiles={pendingAttachmentFiles}
                            onStagedFilesChange={setPendingAttachmentFiles}
                          />
                        )}
                      </div>
                      {!editingId && isLaptopForm ? (
                        <>
                          <Field label="Originally assigned / 1st handover" icon={<IconUser />}>
                            <EmployeeNameInput
                              companyCode={companyTab}
                              placeholder="Same as holder on create"
                              value={form.first_handover_person}
                              onChange={(person) => {
                                setForm((prev) => ({
                                  ...prev,
                                  first_handover_person: person,
                                  name: prev.name.trim() ? prev.name : person,
                                }));
                              }}
                            />
                          </Field>
                          <Field label="Handover date *" icon={<IconCalendar />}>
                            <input
                              className="asset-control bare"
                              type="date" min={DATE_MIN}
                              required={!!(form.first_handover_person.trim() || form.name.trim())}
                              value={form.handed_over_on}
                              onChange={(e) => setForm((prev) => ({ ...prev, handed_over_on: e.target.value }))}
                            />
                          </Field>
                        </>
                      ) : null}
                    </FormSection>
                    </div>
                  </div>
                ) : null}
              </div>

              {error ? <p className="error-text" style={{ marginTop: '0.85rem' }}>{error}</p> : null}

              <div className={`asset-modal-footer${editingId ? ' asset-modal-footer--studio' : ''}`}>
                {editingId ? (
                  <p className="aed-foot-note">
                    <span className="aed-foot-check" aria-hidden>
                      ✓
                    </span>
                    All unsaved changes are tracked locally.
                  </p>
                ) : (
                  <span />
                )}
                <div className="asset-modal-footer-actions">
                  <button
                    type="button"
                    className="btn asset-cancel-btn"
                    disabled={saving}
                    onClick={closeEditModal}
                  >
                    Cancel
                  </button>
                  {editingId && canHandoverEdit ? (
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => setEditModalTab('handovers')}
                    >
                      Go to Handovers →
                    </button>
                  ) : null}
                  <button type="submit" className="btn btn-primary asset-save-btn" disabled={saving}>
                    <IconSave />
                    {saving ? 'Saving…' : editingId ? 'Update asset' : 'Save asset'}
                  </button>
                </div>
              </div>
            </form>
            )}
          </div>
        </div>
      ) : null}

      {detail ? (
        <AssetViewModal
          asset={detail}
          statusHistory={statusHistory}
          viewingCompanyTab={companyTab}
          onClose={closeDetailView}
          onTransfer={() => {
            const cat = String(detail.category ?? categoryTab);
            const id = Number(detail.id);
            returnToViewRef.current = { id, category: cat };
            setDetail(null);
            void openEdit(id, cat, 'handovers');
          }}
          onCompanyTransfer={() => {
            setCompanyTransferAsset(detail);
          }}
          onEdit={() => {
            const cat = String(detail.category ?? categoryTab);
            const id = Number(detail.id);
            returnToViewRef.current = { id, category: cat };
            setDetail(null);
            void openEdit(id, cat);
          }}
          onAttachments={() => {
            const cat = String(detail.category ?? categoryTab);
            const id = Number(detail.id);
            returnToViewRef.current = { id, category: cat };
            setDetail(null);
            void openEdit(id, cat, 'attachments');
          }}
        />
      ) : null}

      {companyTransferAsset ? (
        <CompanyTransferModal
          asset={companyTransferAsset}
          companies={companies}
          locations={locations}
          departments={departments}
          onClose={() => setCompanyTransferAsset(null)}
          onDone={async (updated) => {
            setCompanyTransferAsset(null);
            const code = String(updated.company_code ?? '')
              .trim()
              .toUpperCase();
            const nextTab: CompanyTab =
              code === 'IMS' ? 'IMS' : code === 'ISP' ? 'ISP' : 'IT';
            // Jump to destination company + search new tag so the row is visible immediately
            setCompanyTab(nextTab);
            setLocationFilter('');
            setStatusFilter('');
            setPage(1);
            setQ(String(updated.asset_tag ?? ''));
            toast.success(
              `Now under ${companyUiLabel(code)} as ${String(updated.asset_tag ?? '')}. Reprint the QR label.`,
            );
            setDetail(updated);
            setQrAsset(updated);
            await reloadAfterMutation();
          }}
        />
      ) : null}

      <PcReplaceHardwareModal
        open={pcReplaceOpen && editingCategory === 'pc' && !!editingId}
        asset={editAsset}
        onClose={() => setPcReplaceOpen(false)}
        onReplaced={(updated) => {
          setEditAsset(updated);
          setForm(assetToForm(updated));
          setDetail((prev) => (prev && Number(prev.id) === Number(updated.id) ? updated : prev));
          setLifecycleRefreshKey((k) => k + 1);
          void reloadAfterMutation(true);
          setEditModalTab('lifecycle');
        }}
      />

      {phoneHandoverDetails ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!handoverSaving) setPhoneHandoverDetails(null);
          }}
        >
          <div
            className="modal-card"
            style={{ width: 'min(520px, 100%)' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="phone-ho-title"
          >
            <div className="modal-head">
              <div>
                <h3 id="phone-ho-title" style={{ margin: 0 }}>
                  Update for next holder?
                </h3>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '0.88rem' }}>
                  Handing over to <strong>{handoverForm.person.trim() || '—'}</strong>. Change branch,
                  department, SIM, or accessories if they differ for this person — or leave as-is.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                disabled={handoverSaving}
                onClick={() => setPhoneHandoverDetails(null)}
              >
                Cancel
              </button>
            </div>

            <div className="phone-ho-grid">
              <label className="phone-ho-field">
                <span>Branch / location</span>
                <select
                  className="input"
                  value={phoneHandoverDetails.location_id}
                  disabled={handoverSaving}
                  onChange={(e) =>
                    setPhoneHandoverDetails((prev) =>
                      prev ? { ...prev, location_id: e.target.value } : prev,
                    )
                  }
                >
                  <option value="">— Clear —</option>
                  {companyLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  {phoneHandoverDetails.location_id &&
                  !companyLocations.some((l) => String(l.id) === phoneHandoverDetails.location_id) ? (
                    <option value={phoneHandoverDetails.location_id}>
                      {locations.find((l) => String(l.id) === phoneHandoverDetails.location_id)?.name ||
                        `Branch #${phoneHandoverDetails.location_id}`}
                    </option>
                  ) : null}
                </select>
              </label>

              <label className="phone-ho-field">
                <span>Department</span>
                <select
                  className="input"
                  value={phoneHandoverDetails.department_id}
                  disabled={handoverSaving}
                  onChange={(e) =>
                    setPhoneHandoverDetails((prev) =>
                      prev ? { ...prev, department_id: e.target.value } : prev,
                    )
                  }
                >
                  <option value="">— Clear —</option>
                  {companyDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="phone-ho-field phone-ho-field--full">
                <span>SIM / phone number</span>
                <input
                  className="input"
                  type="text"
                  placeholder="Leave blank if unchanged or no SIM"
                  value={phoneHandoverDetails.phone_number}
                  disabled={handoverSaving}
                  onChange={(e) =>
                    setPhoneHandoverDetails((prev) =>
                      prev ? { ...prev, phone_number: e.target.value } : prev,
                    )
                  }
                />
              </label>

              <div className="phone-ho-field phone-ho-field--full">
                <span>Accessories with this phone</span>
                <div className="phone-ho-checks">
                  <label className="asset-check">
                    <input
                      type="checkbox"
                      checked={phoneHandoverDetails.has_charger}
                      disabled={handoverSaving}
                      onChange={(e) =>
                        setPhoneHandoverDetails((prev) =>
                          prev ? { ...prev, has_charger: e.target.checked } : prev,
                        )
                      }
                    />
                    Charger
                  </label>
                  <label className="asset-check">
                    <input
                      type="checkbox"
                      checked={phoneHandoverDetails.has_data_cable}
                      disabled={handoverSaving}
                      onChange={(e) =>
                        setPhoneHandoverDetails((prev) =>
                          prev ? { ...prev, has_data_cable: e.target.checked } : prev,
                        )
                      }
                    />
                    Data cable
                  </label>
                  <label className="asset-check">
                    <input
                      type="checkbox"
                      checked={phoneHandoverDetails.has_back_cover}
                      disabled={handoverSaving}
                      onChange={(e) =>
                        setPhoneHandoverDetails((prev) =>
                          prev ? { ...prev, has_back_cover: e.target.checked } : prev,
                        )
                      }
                    />
                    Back cover
                  </label>
                </div>
              </div>

              <label className="phone-ho-field phone-ho-field--full">
                <span>Handover remarks</span>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Optional note for this handover (shown on the acceptance report)"
                  value={phoneHandoverDetails.remarks}
                  disabled={handoverSaving}
                  onChange={(e) =>
                    setPhoneHandoverDetails((prev) =>
                      prev ? { ...prev, remarks: e.target.value } : prev,
                    )
                  }
                />
              </label>
            </div>

            <div className="hod-foot" style={{ marginTop: '1.1rem' }}>
              <button
                type="button"
                className="btn btn-soft"
                disabled={handoverSaving}
                onClick={() => setPhoneHandoverDetails(null)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={handoverSaving}
                onClick={() => void completeHandOver(phoneHandoverDetails)}
              >
                {handoverSaving ? 'Handing over…' : 'Confirm handover'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {returnPopup ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!handoverSaving) setReturnPopup(null);
          }}
        >
          <div
            className="modal-card"
            style={{ width: 'min(520px, 100%)' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-popup-title"
          >
            <div className="modal-head">
              <div>
                <h3 id="return-popup-title" style={{ margin: 0 }}>
                  Mark returned
                </h3>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '0.88rem' }}>
                  Confirm accessories returned from <strong>{returnPopup.person}</strong>. Status becomes
                  Available and custody moves to <strong>IT Department</strong> until the next handover.
                  Original handover history is kept.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                disabled={handoverSaving}
                onClick={() => setReturnPopup(null)}
              >
                Cancel
              </button>
            </div>

            <div className="phone-ho-grid">
              {returnPopup.category === 'mobile_phone' ? (
                <div className="phone-ho-field phone-ho-field--full">
                  <span>Accessories provided at handover</span>
                  <div className="phone-ho-checks">
                    <label className="asset-check">
                      <input
                        type="checkbox"
                        checked={returnPopup.has_charger}
                        disabled={handoverSaving}
                        onChange={(e) =>
                          setReturnPopup((prev) =>
                            prev ? { ...prev, has_charger: e.target.checked } : prev,
                          )
                        }
                      />
                      Charger
                    </label>
                    <label className="asset-check">
                      <input
                        type="checkbox"
                        checked={returnPopup.has_data_cable}
                        disabled={handoverSaving}
                        onChange={(e) =>
                          setReturnPopup((prev) =>
                            prev ? { ...prev, has_data_cable: e.target.checked } : prev,
                          )
                        }
                      />
                      Data cable
                    </label>
                    <label className="asset-check">
                      <input
                        type="checkbox"
                        checked={returnPopup.has_back_cover}
                        disabled={handoverSaving}
                        onChange={(e) =>
                          setReturnPopup((prev) =>
                            prev ? { ...prev, has_back_cover: e.target.checked } : prev,
                          )
                        }
                      />
                      Back cover
                    </label>
                  </div>
                  {returnPopup.accessoriesNote ? (
                    <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--muted)' }}>
                      Note: {returnPopup.accessoriesNote}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="phone-ho-field phone-ho-field--full">
                  <span>Accessories</span>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--muted)' }}>
                    {returnPopup.accessoriesNote.trim()
                      ? returnPopup.accessoriesNote
                      : 'No accessory checklist for this asset type — add any return notes below.'}
                  </p>
                </div>
              )}

              <label className="phone-ho-field phone-ho-field--full">
                <span>Return remarks *</span>
                <textarea
                  className="input"
                  rows={3}
                  required
                  placeholder="Condition / missing items / notes (shown on View while with IT Department)"
                  value={returnPopup.remarks}
                  disabled={handoverSaving}
                  onChange={(e) =>
                    setReturnPopup((prev) =>
                      prev ? { ...prev, remarks: e.target.value } : prev,
                    )
                  }
                />
              </label>
            </div>

            <div className="hod-foot" style={{ marginTop: '1.1rem' }}>
              <button
                type="button"
                className="btn btn-soft"
                disabled={handoverSaving}
                onClick={() => setReturnPopup(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={handoverSaving || !returnPopup.remarks.trim()}
                onClick={() => void confirmReturnAsset()}
              >
                {handoverSaving ? 'Saving…' : 'Confirm return'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .phone-ho-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.85rem 0.75rem;
          margin-top: 0.85rem;
        }
        .phone-ho-field {
          display: grid;
          gap: 0.35rem;
          min-width: 0;
        }
        .phone-ho-field--full { grid-column: 1 / -1; }
        .phone-ho-field > span {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #6b7280;
        }
        .phone-ho-checks {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem 1.1rem;
          padding: 0.55rem 0.65rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #f8fafc;
        }
        .hod-remarks {
          display: grid;
          gap: 0.35rem;
          margin-top: 0.75rem;
        }
        .hod-remarks > span {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #6b7280;
        }
        .hod-remarks textarea {
          resize: vertical;
          min-height: 2.6rem;
        }
        @media (max-width: 560px) {
          .phone-ho-grid { grid-template-columns: 1fr; }
        }
        .transfer-tag-stack { display: grid; gap: 0.15rem; min-width: 0; }
        .transfer-tag-former {
          font-size: 0.82rem;
          font-weight: 700;
          color: #dc2626;
          line-height: 1.25;
        }
        .old-stock-section-row td {
          background: #f8fafc;
          border-top: 2px solid #e2e8f0;
          padding: 0.55rem 0.75rem !important;
        }
        .old-stock-section-label {
          display: inline-flex;
          align-items: center;
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #b91c1c;
          background: #fee2e2;
          border: 1px solid #fecaca;
          border-radius: 999px;
          padding: 0.2rem 0.65rem;
        }
        .asset-row-click {
          cursor: pointer;
        }
        .asset-row-click:hover td {
          background: #f8fafc;
        }
        .asset-row-click:focus-visible {
          outline: 2px solid #93c5fd;
          outline-offset: -2px;
        }
        .old-stock-row td {
          background: #fffafa;
        }
        .avm-transfer-banner {
          margin: 0 1.35rem 0.85rem;
          padding: 0.75rem 0.95rem;
          border-radius: 10px;
          border: 1px solid #fcd34d;
          background: #fffbeb;
          color: #92400e;
          font-size: 0.86rem;
          line-height: 1.45;
        }
        .avm-transfer-banner strong { color: #78350f; }
        .avm-transfer-banner p { margin: 0.25rem 0 0; }
        .tabs-primary, .tabs-secondary {
          display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 0.85rem;
        }
        .tabs-secondary { margin-bottom: 1rem; }
        .company-tabs-row {
          align-items: center;
        }
        .company-tabs-add {
          margin-left: auto;
          white-space: nowrap;
          padding: 0.28rem 0.75rem;
          font-size: 0.8rem;
          line-height: 1.2;
          border-radius: 999px;
          font-weight: 650;
        }
        .tab-btn {
          border: 1px solid var(--border); background: #fff; color: var(--muted);
          border-radius: 999px; padding: 0.28rem 0.75rem; font-size: 0.8rem; font-weight: 650;
          cursor: pointer; line-height: 1.2;
        }
        .tab-btn.sm { padding: 0.22rem 0.65rem; font-size: 0.76rem; }
        .tab-btn.active { background: var(--navy); border-color: var(--navy); color: #fff; }
        .tabs-secondary .tab-btn.active { background: #2563eb; border-color: #2563eb; }
        .edit-modal-tabs {
          display: inline-flex;
          flex-wrap: nowrap;
          align-items: center;
          gap: 0.15rem;
          margin: 0;
          padding: 0.22rem;
          background: #eef2f7;
          border-radius: 999px;
          border: none;
        }
        .edit-modal-tabs .tab-btn {
          border: none;
          background: transparent;
          color: #475569;
          border-radius: 999px;
          padding: 0.38rem 0.95rem;
          font-size: 0.8rem;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
          box-shadow: none;
        }
        .edit-modal-tabs .tab-btn.sm {
          padding: 0.38rem 0.95rem;
          font-size: 0.8rem;
        }
        .edit-modal-tabs .tab-btn:hover:not(.active) {
          color: #1e293b;
          background: rgba(255, 255, 255, 0.55);
        }
        .edit-modal-tabs .tab-btn.active {
          background: #2563eb;
          border-color: transparent;
          color: #fff;
          font-weight: 700;
          box-shadow: 0 1px 2px rgba(37, 99, 235, 0.25);
        }
        .handover-panel.in-edit { margin-top: 0; padding-top: 0; border-top: none; }
        .hod-assign-top {
          flex-shrink: 0;
          padding: 0.95rem 1.15rem 0;
          position: relative;
          z-index: 30;
          overflow: visible;
          background: #fff;
        }
        .hod-scroll {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 0.95rem 1.15rem 1rem;
          display: grid;
          gap: 1rem;
          position: relative;
          z-index: 1;
        }
        .handover-summary-grid {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem;
        }
        .handover-summary-card {
          border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.85rem 1rem;
          display: grid; gap: 0.35rem; background: #fff;
        }
        .handover-summary-card.original { border-color: #86efac; background: #f0fdf4; }
        .handover-summary-card.current { border-color: #93c5fd; background: #eff6ff; }
        .handover-summary-card .slot-label {
          font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase;
          color: #6b7280; font-weight: 750;
        }
        .handover-summary-card strong {
          font-size: 1.05rem; color: #111827; font-weight: 750; line-height: 1.3;
        }
        .hod-date-line {
          display: inline-flex; align-items: center; gap: 0.35rem;
          color: #6b7280; font-size: 0.84rem;
        }
        .hod-date-line svg { width: 14px; height: 14px; flex-shrink: 0; color: #9ca3af; }
        .handover-assign-box {
          border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.9rem 1rem; background: #f8fafc;
        }
        .handover-assign-box h4 {
          margin: 0 0 0.65rem; font-size: 0.95rem; font-weight: 700; color: #111827;
        }
        .handover-help { margin: 0.55rem 0 0; color: #6b7280; font-size: 0.8rem; line-height: 1.45; }
        .hod-section-title {
          margin: 0 0 0.55rem; font-size: 0.95rem; font-weight: 700; color: #111827;
        }
        .hod-foot {
          flex-shrink: 0;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.15rem;
          background: #fff;
          border-top: 1px solid #eef0f3;
        }
        .hod-foot .btn {
          padding: 0.42rem 0.9rem;
          font-size: 0.84rem;
          border-radius: 8px;
        }
        .handover-panel.in-edit .btn-primary {
          background: #2563eb;
          border-color: #2563eb;
          color: #fff;
        }
        .handover-panel.in-edit .btn-primary:hover:not(:disabled) {
          background: #1d4ed8;
          border-color: #1d4ed8;
        }
        .modal-backdrop {
          position: fixed; inset: 0; background: rgba(17,24,39,0.45);
          display: grid; place-items: center; padding: 1rem; z-index: 50;
        }
        .modal-card {
          width: min(760px, 100%); max-height: 90vh; overflow: auto;
          background: #fff; border-radius: 16px; padding: 1.25rem 1.35rem;
          box-shadow: 0 24px 60px rgba(17,24,39,0.35);
        }
        .modal-card.detail-wide { width: min(880px, 100%); }
        .modal-card.avm-card {
          width: min(1180px, 100%);
          max-height: 94vh;
          padding: 0;
          background: #ffffff;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border-radius: 16px;
        }
        .avm-head {
          display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start;
          padding: 1.15rem 1.4rem 1rem; background: #fff; border-bottom: 1px solid #eef0f3;
        }
        .avm-head-left { display: flex; gap: 0.75rem; align-items: flex-start; min-width: 0; }
        .avm-icon {
          width: 40px; height: 40px; border-radius: 10px; background: #eff6ff; color: #2563eb;
          display: grid; place-items: center; flex-shrink: 0; margin-top: 2px;
        }
        .avm-icon svg { width: 20px; height: 20px; }
        .avm-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.5rem; }
        .avm-title { margin: 0; font-size: 1.35rem; font-weight: 800; color: #111827; letter-spacing: -0.02em; }
        .avm-pill {
          display: inline-flex; align-items: center; gap: 0.3rem;
          border-radius: 999px; padding: 0.2rem 0.7rem; font-size: 0.72rem; font-weight: 700;
          white-space: nowrap; flex-shrink: 0;
        }
        .avm-pill.ok { background: #dcfce7; color: #166534; }
        .avm-pill.ok::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
        .avm-pill.muted { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
        .avm-pill.info { background: #dbeafe; color: #1d4ed8; }
        .avm-pill.warn { background: #ffedd5; color: #c2410c; }
        .avm-pill.danger { background: #fee2e2; color: #b91c1c; }
        .avm-pill.check::before { content: '✓'; font-size: 0.7rem; }
        .avm-sub { margin: 0.3rem 0 0; color: #6b7280; font-size: 0.875rem; }
        .avm-head-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
        .avm-body {
          display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
          gap: 1.1rem; padding: 1.05rem 1.35rem; overflow: hidden; flex: 1; min-height: 0;
          background: #f8fafc; align-items: stretch;
        }
        .avm-col {
          display: flex; flex-direction: column; gap: 0.9rem;
          min-width: 0; min-height: 0; max-height: 100%;
          overflow-x: hidden; overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 0.2rem;
          scrollbar-gutter: stable;
        }
        /* Right column: chain keeps full 2×2; ledger/lifecycle scroll in remaining space */
        .avm-col--right {
          overflow: hidden;
          scrollbar-gutter: auto;
          padding-right: 0;
        }
        .avm-panel {
          background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
          padding: 0.95rem 1rem; box-shadow: none;
        }
        .avm-col--right .avm-panel--chain,
        .avm-col--right .avm-panel--lifecycle {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        /* Never shrink/clip the 4 handover slots at 100% zoom */
        .avm-col--right .avm-panel--chain {
          flex: 0 0 auto;
          overflow: visible;
        }
        .avm-col--right .avm-panel--lifecycle {
          flex: 1 1 0;
          overflow: hidden;
        }
        .avm-panel-head {
          display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;
          margin-bottom: 0.8rem;
        }
        .avm-panel-head h4 {
          margin: 0; font-size: 0.7rem; letter-spacing: 0.07em; text-transform: uppercase;
          color: #6b7280; font-weight: 750;
        }
        .avm-assignee-box {
          border: 1px solid #eef2f7; background: #f8fafc; border-radius: 10px;
          padding: 0.75rem 0.85rem; display: flex; gap: 0.7rem; align-items: flex-start;
        }
        .avm-avatar {
          width: 42px; height: 42px; border-radius: 999px; background: #1e3a8a; color: #fff;
          display: grid; place-items: center; font-weight: 750; font-size: 0.82rem; flex-shrink: 0;
        }
        .avm-assignee-box strong { display: block; font-size: 0.95rem; color: #111827; line-height: 1.3; }
        .avm-meta-line {
          display: flex; align-items: center; gap: 0.35rem; color: #6b7280; font-size: 0.8rem; margin-top: 0.22rem;
        }
        .avm-meta-line svg { width: 12px; height: 12px; flex-shrink: 0; color: #9ca3af; }
        .avm-assignee-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; margin-top: 0.75rem;
        }
        .avm-kv span { display: block; font-size: 0.7rem; color: #9ca3af; font-weight: 650; margin-bottom: 0.15rem; }
        .avm-kv strong { font-size: 0.88rem; color: #111827; font-weight: 650; word-break: break-word; }
        .avm-spec-list { display: grid; gap: 0.62rem; }
        .avm-spec-row {
          display: grid;
          grid-template-columns: minmax(7.5rem, 38%) minmax(0, 1fr);
          align-items: start;
          column-gap: 0.65rem;
          font-size: 0.875rem; padding-bottom: 0.55rem; border-bottom: 1px solid #f3f4f6;
          min-width: 0;
        }
        .avm-spec-row:last-child { border-bottom: none; padding-bottom: 0; }
        .avm-spec-row > span { color: #6b7280; font-weight: 500; min-width: 0; }
        .avm-spec-row > strong {
          color: #111827; font-weight: 650; text-align: right;
          display: inline-flex; align-items: center; justify-content: flex-end; gap: 0.3rem;
          min-width: 0; max-width: 100%;
        }
        .avm-spec-row--sn {
          grid-template-columns: 1fr;
          row-gap: 0.28rem;
        }
        .avm-spec-row--sn > strong {
          justify-content: flex-start;
          text-align: left;
          width: 100%;
        }
        .avm-spec-val {
          min-width: 0; line-height: 1.35;
        }
        .avm-spec-row--sn .avm-spec-val {
          white-space: nowrap;
          overflow-x: auto;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
        }
        .avm-copy {
          border: none; background: transparent; color: #9ca3af; cursor: pointer;
          padding: 0; margin: 0; display: inline-flex; flex-shrink: 0; line-height: 1;
        }
        .avm-copy:hover { color: #2563eb; }
        .avm-copy svg { width: 13px; height: 13px; display: block; }
        .avm-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.8rem; }
        .avm-mini {
          background: #f8fafc; border: 1px solid #eef2f7; border-radius: 10px; padding: 0.7rem 0.75rem;
        }
        .avm-mini span { display: block; font-size: 0.7rem; color: #9ca3af; font-weight: 650; margin-bottom: 0.25rem; }
        .avm-mini strong { font-size: 0.98rem; color: #111827; }
        .avm-right-head { margin-bottom: 0.1rem; align-items: flex-start !important; }
        .avm-right-head h3 { margin: 0; font-size: 1.05rem; color: #111827; font-weight: 750; }
        .avm-right-head p { margin: 0.28rem 0 0; color: #6b7280; font-size: 0.82rem; line-height: 1.4; max-width: 36rem; }
        .avm-chain-label {
          margin: 0.9rem 0 0.55rem; font-size: 0.7rem; letter-spacing: 0.07em;
          text-transform: uppercase; color: #6b7280; font-weight: 750;
        }
        .avm-chain {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.55rem;
          flex: 0 0 auto;
          align-content: start;
          /* Reserve space for a full 2×2 so 3rd/4th slots are never clipped */
          min-height: calc(2 * 7.1rem + 0.55rem);
        }
        /* Keep a 2×2 (4-slot) viewport; scroll only when 5th+ assignee is added (PCs) */
        .avm-chain--scroll {
          max-height: calc(2 * 7.1rem + 0.55rem);
          min-height: calc(2 * 7.1rem + 0.55rem);
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 0.15rem;
        }
        .avm-slot {
          border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.65rem 0.75rem;
          background: #fff; min-height: 7.1rem; height: 100%;
          display: flex; flex-direction: column; gap: 0.22rem;
        }
        .avm-slot.active { border-color: #60a5fa; background: #eff6ff; box-shadow: inset 0 0 0 1px #93c5fd; }
        .avm-slot.original { border-color: #86efac; background: #f0fdf4; }
        .avm-slot.original.active {
          border-color: #60a5fa;
          background: linear-gradient(180deg, #f0fdf4 0%, #eff6ff 100%);
          box-shadow: inset 0 0 0 1px #93c5fd;
        }
        .avm-slot.vacant { border-style: dashed; border-color: #fb923c; background: #fff7ed; }
        .avm-slot.locked { background: #f9fafb; border-color: #e5e7eb; color: #9ca3af; }
        .avm-slot-top { display: flex; justify-content: space-between; align-items: center; gap: 0.25rem; }
        .avm-slot-n {
          font-size: 0.68rem; letter-spacing: 0.04em; text-transform: uppercase;
          color: #6b7280; font-weight: 750;
        }
        .avm-slot-state {
          font-size: 0.68rem; font-weight: 750; border-radius: 999px; padding: 0.12rem 0.45rem;
        }
        .avm-slot-state.vacant { background: #ffedd5; color: #c2410c; }
        .avm-slot-state.locked { background: #e5e7eb; color: #6b7280; }
        .avm-slot strong { font-size: 0.9rem; color: #111827; line-height: 1.3; }
        .avm-slot.locked strong { color: #9ca3af; }
        .avm-slot .slot-date { color: #6b7280; font-size: 0.78rem; }
        .avm-slot-badges { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: auto; padding-top: 0.4rem; }
        .avm-slot-btn {
          margin-top: auto; border: 1px dashed #fb923c; background: #fff; color: #ea580c;
          border-radius: 8px; padding: 0.5rem 0.45rem; font-size: 0.8rem; font-weight: 700;
          cursor: pointer; width: 100%;
        }
        .avm-slot-btn:hover { background: #fff7ed; }
        .avm-locked-ico { margin: 0.55rem auto 0.2rem; color: #9ca3af; display: grid; place-items: center; }
        .avm-locked-ico svg { width: 22px; height: 22px; }
        .avm-timeline {
          display: grid; gap: 0; position: relative;
          flex: 1 1 auto; min-height: 0;
          align-content: start;
          /* Fill leftover panel space; scroll only if content exceeds it */
          overflow-x: hidden; overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 0.15rem;
        }
        .avm-tl-item {
          display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 0.65rem;
          position: relative; padding-bottom: 0.65rem;
          align-self: start;
        }
        .avm-tl-item:last-child { padding-bottom: 0; }
        .avm-tl-item:not(:last-child)::before {
          content: ''; position: absolute; left: 7px; top: 14px; bottom: 0; width: 2px; background: #e5e7eb;
        }
        .avm-tl-dot {
          width: 14px; height: 14px; border-radius: 50%; margin-top: 3px; border: 2px solid #fff;
          box-shadow: 0 0 0 1px #e5e7eb; background: #94a3b8;
        }
        .avm-tl-dot.green { background: #22c55e; box-shadow: 0 0 0 1px #86efac; }
        .avm-tl-dot.blue { background: #2563eb; box-shadow: 0 0 0 1px #93c5fd; }
        .avm-tl-item strong { display: block; font-size: 0.9rem; color: #111827; }
        .avm-tl-item p { margin: 0.15rem 0 0; color: #6b7280; font-size: 0.82rem; line-height: 1.35; }
        .avm-tl-item time { display: block; margin-top: 0.2rem; color: #9ca3af; font-size: 0.76rem; }
        .avm-empty { color: #9ca3af; font-size: 0.86rem; margin: 0; }
        .avm-foot {
          display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap;
          padding: 0.55rem 1.15rem; background: #fff; border-top: 1px solid #eef0f3;
          min-height: 0;
        }
        .avm-tag-id span { display: block; font-size: 0.65rem; color: #9ca3af; font-weight: 650; margin-bottom: 0.05rem; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.2; }
        .avm-tag-id strong { font-size: 0.88rem; color: #111827; line-height: 1.2; }
        .avm-foot-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: flex-end; align-items: center; }
        .avm-foot-actions .avm-btn-outline,
        .avm-foot-actions .avm-btn-primary {
          display: inline-flex; align-items: center; gap: 0.3rem;
          border-radius: 8px; padding: 0.38rem 0.75rem; font-size: 0.84rem;
          cursor: pointer; white-space: nowrap; line-height: 1.2;
        }
        .avm-foot-actions .avm-btn-outline svg,
        .avm-foot-actions .avm-btn-primary svg {
          width: 13px; height: 13px; flex-shrink: 0;
        }
        .avm-foot-actions .avm-btn-outline {
          background: #fff; border: 1px solid #d1d5db; color: #374151; font-weight: 650;
        }
        .avm-foot-actions .avm-btn-outline:hover { background: #f9fafb; }
        .avm-foot-actions .avm-btn-primary {
          background: #2563eb; border: 1px solid #2563eb; color: #fff; font-weight: 700;
        }
        .avm-foot-actions .avm-btn-primary:hover { background: #1d4ed8; }
        @media (max-width: 980px) {
          .avm-body { grid-template-columns: 1fr; overflow: auto; }
          .avm-col { overflow: visible; max-height: none; padding-right: 0; scrollbar-gutter: auto; }
          .avm-col--right {
            overflow: visible; max-height: none;
          }
          .avm-col--right .avm-panel--chain,
          .avm-col--right .avm-panel--lifecycle { flex: none; overflow: visible; }
          .avm-chain--scroll { max-height: 14rem; }
          .avm-timeline { max-height: none; overflow: visible; }
        }
        @media (max-width: 560px) {
          .avm-chain { grid-template-columns: 1fr; }
          .avm-chain--scroll { max-height: 20rem; }
          .avm-assignee-grid, .avm-mini-grid { grid-template-columns: 1fr; }
        }
        .lifecycle-history-scroll {
          max-height: min(52vh, 28rem);
          overflow: auto;
          overscroll-behavior: contain;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
        }
        .lifecycle-history-scroll .table { margin: 0; }
        @media print {
          .modal-backdrop { position: static; background: #fff; padding: 0; display: block; }
          .modal-card.avm-card { box-shadow: none; max-height: none; width: 100%; }
          .avm-head-actions, .avm-foot-actions, .avm-slot-btn, .avm-copy { display: none !important; }
          .avm-body { background: #fff; }
        }
        .handover-panel {
          margin-top: 1.15rem; padding-top: 1rem; border-top: 1px solid var(--border);
          display: grid; gap: 1rem;
        }
        /* Exact handover design: 4 cards in one row */
        .handover-panel.in-edit .handover-slot-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.65rem;
          align-content: start;
        }
        .handover-panel.in-edit .handover-slot-grid:has(> :nth-child(5)) {
          max-height: 12.5rem;
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 0.15rem;
        }
        .handover-slot-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.65rem;
        }
        .handover-slot {
          position: relative;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 0.7rem 0.8rem 0.75rem;
          display: grid;
          gap: 0.22rem;
          background: #fff;
          min-height: 6.5rem;
          align-content: start;
        }
        .handover-slot.empty {
          border-style: solid;
          border-color: #e5e7eb;
          background: #fff;
          opacity: 1;
        }
        .handover-slot.next-available {
          border-style: dashed;
          border-color: #d1d5db;
          background: #fafafa;
        }
        .handover-panel.view-handovers {
          margin-top: 1.15rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
        }
        .handover-slot.current {
          border-color: #93c5fd;
          background: #eff6ff;
          box-shadow: inset 0 0 0 1px #93c5fd;
        }
        .handover-slot.original {
          border-color: #86efac;
          background: #f0fdf4;
        }
        .handover-slot.original.current {
          border-color: #93c5fd;
          background: linear-gradient(180deg, #f0fdf4 0%, #eff6ff 100%);
          box-shadow: inset 0 0 0 1px #93c5fd;
        }
        .handover-slot .slot-label {
          font-size: 0.7rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #9ca3af;
          font-weight: 700;
        }
        .handover-slot.current .slot-label { color: #2563eb; }
        .handover-slot.original .slot-label { color: #166534; }
        .handover-slot .avm-slot-badges {
          display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.25rem;
        }
        .handover-slot .slot-next-dot {
          position: absolute;
          top: 0.65rem;
          right: 0.7rem;
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          background: #3b82f6;
        }
        .handover-slot strong {
          font-size: 0.92rem;
          font-weight: 700;
          color: #111827;
          line-height: 1.3;
          word-break: break-word;
        }
        .handover-slot.empty strong,
        .handover-slot.next-available strong {
          color: #9ca3af;
          font-weight: 600;
        }
        .handover-slot .slot-date { color: #9ca3af; font-size: 0.78rem; }
        .handover-badge.next-slot {
          background: #f3f4f6;
          color: #6b7280;
          width: fit-content;
          margin-top: 0.15rem;
        }
        .handover-current {
          display: flex; flex-wrap: wrap; gap: 0.55rem 0.85rem; align-items: baseline;
        }
        .handover-current strong { font-size: 1.05rem; }
        .handover-badge {
          border-radius: 999px;
          padding: 0.15rem 0.55rem; font-size: 0.78rem; font-weight: 700;
        }
        .handover-badge.holds-now {
          background: #dbeafe; color: #1d4ed8;
          width: fit-content;
          margin-top: 0.15rem;
        }
        .handover-badge.originally {
          background: #dcfce7; color: #166534;
        }
        .person-name-cell {
          display: inline-flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          gap: 0.1rem;
          line-height: 1.2;
          max-width: none;
          min-width: 0;
          overflow: visible;
        }
        .person-name-text {
          color: #111827;
          font-weight: 700;
          font-size: 0.8rem;
          white-space: nowrap;
          overflow: visible;
          text-overflow: clip;
          max-width: none;
          display: inline-block;
        }
        .person-sign {
          display: inline-block; border-radius: 999px;
          padding: 0.04rem 0.38rem; font-size: 0.58rem; font-weight: 700;
          line-height: 1.15;
          flex-shrink: 0;
        }
        .person-sign.current-holder {
          background: #dbeafe; color: #1d4ed8;
        }
        .person-sign.holds-now {
          background: #e0e7ff; color: #3730a3;
        }
        .person-sign.originally-assigned {
          background: #dcfce7; color: #166534;
        }
        .handover-meta { color: var(--muted); font-size: 0.86rem; }
        .handover-actions {
          display: flex; flex-wrap: wrap; gap: 0.55rem; align-items: center;
          overflow: visible; position: relative;
        }
        .handover-actions .input,
        .handover-actions .emp-suggest { min-width: 160px; flex: 1; }
        .hod-field {
          display: flex; align-items: center; gap: 0.45rem;
          border: 1px solid #e5e7eb; border-radius: 10px; background: #fff;
          padding: 0 0.7rem; min-height: 42px; flex: 1; min-width: 160px;
          overflow: visible; position: relative;
        }
        .hod-field:focus-within {
          border-color: #93c5fd;
          box-shadow: 0 0 0 3px rgba(147, 197, 253, 0.3);
        }
        /* Clip only date fields (native calendar icon); keep emp suggest visible */
        .hod-field:has(input[type="date"]) {
          overflow: hidden;
        }
        .hod-field svg { width: 15px; height: 15px; color: #9ca3af; flex-shrink: 0; }
        .hod-field .input,
        .hod-field .asset-control {
          border: none; outline: none; background: transparent; width: 100%;
          padding: 0.55rem 0; font-size: 0.9rem; min-width: 0;
        }
        /* Hide native date picker icon — custom IconCalendar is shown on the left */
        .hod-field input[type="date"] {
          position: relative;
        }
        .hod-field input[type="date"]::-webkit-calendar-picker-indicator {
          opacity: 0;
          display: block;
          position: absolute;
          inset: 0;
          width: auto;
          height: auto;
          margin: 0;
          padding: 0;
          cursor: pointer;
        }
        .hod-field input[type="date"]::-webkit-inner-spin-button {
          display: none;
        }
        .hod-field .emp-suggest { flex: 1; min-width: 0; }
        .handover-assign-box {
          position: relative;
          overflow: visible;
        }
        .handover-history {
          border: 1px solid #e5e7eb; border-radius: 12px; padding: 0.85rem 1rem; background: #fff;
          display: flex; flex-direction: column; min-height: 0;
        }
        .assign-timeline-card .avm-panel-head {
          display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;
        }
        .assign-timeline-card .avm-timeline {
          margin-top: 0.15rem;
          max-height: min(42vh, 22rem);
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .handover-history .table-scroll {
          max-height: min(38vh, 18rem);
          overflow: auto;
          overscroll-behavior: contain;
        }
        .handover-history .table {
          width: 100%;
        }
        .handover-history .table th {
          font-size: 0.68rem; letter-spacing: 0.05em; text-transform: uppercase;
          color: #9ca3af; font-weight: 700;
        }
        .handover-history .table td:nth-child(2) { font-weight: 700; color: #111827; }
        .handover-history .table tr.is-current td { background: #f0fdf4; }
        @media (max-width: 960px) {
          .handover-panel.in-edit .handover-slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .handover-slot-grid,
          .handover-panel.in-edit .handover-slot-grid,
          .handover-summary-grid { grid-template-columns: 1fr; }
        }
        .modal-head {
          display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start;
          margin-bottom: 1rem;
        }
        .asset-modal {
          width: min(920px, 100%);
          max-height: 92vh;
          overflow: auto;
          background: #fff;
          border-radius: 18px;
          padding: 1.35rem 1.5rem 1.25rem;
          box-shadow: 0 28px 70px rgba(17,24,39,0.28);
        }
        .asset-modal--studio {
          width: min(1180px, 100%);
          padding: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #f8fafc;
        }
        .asset-modal--studio .asset-modal-head {
          margin: 0;
          padding: 0.85rem 1.15rem;
          background: #fff;
          border-bottom: 1px solid #eef0f3;
          align-items: center;
        }
        .asset-modal--studio .edit-modal-tabs { margin: 0; }
        .asset-modal--studio form {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 0.9rem 1.1rem 0;
        }
        .asset-modal--studio .handover-panel.in-edit {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          padding: 0;
          display: flex;
          flex-direction: column;
          background: #fff;
        }
        .asset-modal-head {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
          margin-bottom: 1.15rem;
        }
        .asset-modal-head-right {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          flex-shrink: 0;
        }
        .asset-modal-title-wrap {
          display: flex;
          gap: 0.85rem;
          align-items: flex-start;
          min-width: 0;
        }
        .asset-modal-title-row {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: wrap;
        }
        .asset-modal-icon {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: #dbeafe;
          color: #2563eb;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .asset-modal-icon svg { width: 20px; height: 20px; }
        .asset-modal-kicker {
          margin: 0;
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #9ca3af;
          font-weight: 650;
        }
        .asset-modal-title {
          margin: 0.15rem 0 0;
          font-size: 1.2rem;
          color: #111827;
          font-weight: 750;
        }
        .asset-modal-title-muted {
          color: #6b7280;
          font-weight: 600;
          font-size: 0.95rem;
        }
        .asset-modal-hint {
          margin: 0.3rem 0 0;
          color: #6b7280;
          font-size: 0.9rem;
        }
        .asset-modal-close {
          width: 36px;
          height: 36px;
          border: none;
          background: transparent;
          color: #9ca3af;
          border-radius: 10px;
          cursor: pointer;
          display: grid;
          place-items: center;
        }
        .asset-modal-close:hover { background: #f3f4f6; color: #374151; }
        .asset-modal-close svg { width: 18px; height: 18px; }
        .edit-modal-tabs .tab-count {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 1.15rem; height: 1.15rem; margin-left: 0.35rem;
          border-radius: 999px; background: #dbe3ee; color: #475569;
          font-size: 0.68rem; font-weight: 750; padding: 0 0.3rem;
        }
        .edit-modal-tabs .tab-btn.active .tab-count {
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
        }
        .aed-body {
          display: grid;
          grid-template-columns: minmax(210px, 240px) minmax(0, 1fr);
          gap: 0.9rem;
          align-items: start;
        }
        .aed-side {
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
          position: sticky;
          top: 0;
        }
        .aed-side-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 0.75rem 0.85rem;
        }
        .aed-side-label {
          display: block;
          font-size: 0.68rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #9ca3af;
          font-weight: 750;
          margin-bottom: 0.35rem;
        }
        .aed-side-title {
          display: block;
          font-size: 0.92rem;
          color: #111827;
          font-weight: 750;
          line-height: 1.3;
          margin-bottom: 0.4rem;
        }
        .aed-side-specs {
          list-style: none; margin: 0; padding: 0;
          display: grid; gap: 0.2rem;
          color: #6b7280; font-size: 0.78rem;
        }
        .aed-side-nav {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 0.35rem;
          display: grid;
          gap: 0.2rem;
        }
        .aed-nav-btn {
          display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;
          border: none; background: transparent; text-align: left;
          padding: 0.55rem 0.65rem; border-radius: 8px; cursor: pointer;
          color: #4b5563; font-size: 0.82rem; font-weight: 600;
        }
        .aed-nav-btn:hover { background: #f3f4f6; }
        .aed-nav-btn.active { background: #eff6ff; color: #1d4ed8; }
        .aed-nav-active {
          font-size: 0.65rem; font-weight: 750; letter-spacing: 0.04em;
          text-transform: uppercase; color: #2563eb;
          background: #dbeafe; border-radius: 999px; padding: 0.12rem 0.4rem;
        }
        .aed-side-foot {
          margin: 0.15rem 0 0; padding: 0 0.2rem;
          color: #9ca3af; font-size: 0.72rem; line-height: 1.35;
        }
        .aed-main { min-width: 0; }
        .aed-foot-note {
          margin: 0; display: inline-flex; align-items: center; gap: 0.4rem;
          color: #6b7280; font-size: 0.8rem;
        }
        .aed-foot-check {
          width: 18px; height: 18px; border-radius: 999px; background: #dcfce7; color: #166534;
          display: inline-grid; place-items: center; font-size: 0.7rem; font-weight: 800;
        }
        .asset-form-sections-wrap {
          display: flex;
          flex-direction: column;
          gap: 0.95rem;
        }
        .asset-form-sections {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }
        .asset-form-section {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          overflow: visible;
          background: #fff;
          scroll-margin-top: 0.75rem;
        }
        .asset-form-section-head {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.6rem 0.9rem;
          background: #f8fafc;
          border-bottom: 1px solid #eef2f7;
        }
        .asset-form-section-badge { margin-left: auto; }
        .asset-form-section-icon {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          background: #dbeafe;
          color: #2563eb;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .asset-form-section-icon svg {
          width: 15px;
          height: 15px;
        }
        .asset-form-section-head h4 {
          margin: 0;
          font-size: 0.92rem;
          font-weight: 700;
          color: #1e3a8a;
        }
        .asset-form-section .asset-form-grid {
          padding: 0.95rem 1rem 1.05rem;
        }
        .asset-form-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.9rem 1rem;
        }
        .asset-field { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
        .asset-field.span-2 { grid-column: span 2; }
        .asset-field-label {
          font-size: 0.82rem;
          font-weight: 600;
          color: #374151;
        }
        .req-star {
          color: #dc2626;
          font-weight: 700;
        }
        .asset-cancel-btn {
          background: #fff;
          border: 1.5px solid #2563eb;
          color: #2563eb;
          font-weight: 650;
        }
        .asset-cancel-btn:hover {
          background: #eff6ff;
        }
        .asset-check-row {
          display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.15rem;
          border: 1px solid #e5e7eb; border-radius: 12px; background: #fff;
          padding: 0.7rem 0.9rem; min-height: 46px;
        }
        .asset-check {
          display: inline-flex; align-items: center; gap: 0.4rem;
          font-size: 0.9rem; color: #111827; font-weight: 550; cursor: pointer;
          user-select: none;
        }
        .asset-check input {
          width: 1rem; height: 1rem; accent-color: #2563eb; cursor: pointer;
        }
        .asset-ups-model {
          width: 7.5rem; min-width: 6rem; flex: 0 0 auto;
          border: 1px solid #e5e7eb; border-radius: 8px;
          padding: 0.4rem 0.55rem; font-size: 0.88rem;
        }
        .asset-ups-brand {
          width: 9.5rem; min-width: 8rem; flex: 0 0 auto;
          border: 1px solid #e5e7eb; border-radius: 8px;
          padding: 0.4rem 0.55rem; font-size: 0.88rem;
          background: #fff;
        }
        .asset-field-box {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          padding: 0 0.75rem;
          min-height: 46px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .asset-field-box:focus-within {
          border-color: #93c5fd;
          box-shadow: 0 0 0 3px rgba(147, 197, 253, 0.35);
        }
        .asset-field-box.tall {
          align-items: flex-start;
          padding-top: 0.7rem;
          min-height: 110px;
        }
        .asset-field-icon {
          color: #9ca3af;
          display: inline-flex;
          flex-shrink: 0;
        }
        .asset-field-icon svg { width: 16px; height: 16px; }
        .status-select {
          position: relative;
          width: 100%;
          min-width: 0;
        }
        .status-select-trigger {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          border: none;
          background: transparent;
          padding: 0.55rem 0;
          font-size: 0.9rem;
          font-weight: 600;
          color: #111827;
          cursor: pointer;
          text-align: left;
        }
        .status-select-trigger:focus { outline: none; }
        .status-select-chevron {
          margin-left: auto;
          width: 14px;
          height: 14px;
          color: #9ca3af;
          flex-shrink: 0;
        }
        .status-select-menu {
          position: absolute;
          left: -2.4rem;
          right: -0.65rem;
          top: calc(100% + 0.45rem);
          z-index: 40;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.14);
          padding: 0.35rem;
          display: grid;
          gap: 0.15rem;
        }
        .status-select-option {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          width: 100%;
          border: none;
          background: transparent;
          border-radius: 8px;
          padding: 0.5rem 0.65rem;
          font-size: 0.88rem;
          font-weight: 600;
          color: #111827;
          cursor: pointer;
          text-align: left;
        }
        .status-select-option:hover,
        .status-select-option.is-active {
          background: #f3f4f6;
        }
        .status-select-option.is-active { font-weight: 700; }
        .status-filter-select {
          width: 100%;
          position: relative;
        }
        .status-filter-select .status-select-trigger.asset-filter-control {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.32rem 0.7rem;
          min-height: 2.15rem;
          border: 1px solid #dbe3ee !important;
          border-radius: 8px !important;
          background: #fff !important;
          box-shadow: none;
          cursor: pointer;
          text-align: left;
          font-size: 0.84rem;
          font-weight: 500;
          color: #0f172a;
        }
        .status-filter-select .status-select-trigger.asset-filter-control:focus,
        .status-filter-select .status-select-trigger.asset-filter-control[aria-expanded='true'] {
          border-color: #93c5fd !important;
          box-shadow: 0 0 0 3px rgba(147, 197, 253, 0.35);
        }
        .status-filter-select .status-select-menu {
          left: 0;
          right: 0;
          border-radius: 8px;
          border: 1px solid #dbe3ee;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
        }
        .status-filter-all {
          color: #94a3b8;
          font-weight: 500;
          font-size: 0.84rem;
        }
        .status-dot {
          width: 1.55rem;
          height: 1.55rem;
          border-radius: 999px;
          display: inline-grid;
          place-items: center;
          flex-shrink: 0;
        }
        .status-dot svg { width: 0.85rem; height: 0.85rem; }
        .status-dot.tone-available { background: #dbeafe; color: #1d4ed8; }
        .status-dot.tone-assigned { background: #dcfce7; color: #166534; }
        .status-dot.tone-repair { background: #fef3c7; color: #b45309; }
        .status-dot.tone-lost { background: #fee2e2; color: #b91c1c; }
        .status-dot.tone-disposed { background: #f1f5f9; color: #64748b; }
        .asset-control.bare {          border: none;
          outline: none;
          background: transparent;
          width: 100%;
          padding: 0.7rem 0;
          color: #111827;
          font-size: 0.92rem;
        }
        .asset-control.bare.area {
          resize: vertical;
          min-height: 88px;
          line-height: 1.4;
          padding-top: 0;
        }
        .asset-control.bare::placeholder { color: #9ca3af; }
        .asset-dates {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }
        .asset-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 0.65rem;
          margin-top: 1.25rem;
          padding-top: 0.35rem;
        }
        .asset-modal-footer--studio {
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin: 0;
          padding: 0.55rem 1.1rem;
          background: #fff;
          border-top: 1px solid #eef0f3;
          position: sticky;
          bottom: 0;
        }
        .asset-modal-footer-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          justify-content: flex-end;
          margin-left: auto;
        }
        .asset-modal-footer--studio .btn {
          padding: 0.4rem 0.8rem;
          font-size: 0.84rem;
          border-radius: 8px;
        }
        .asset-modal-footer--studio .asset-save-btn svg { width: 13px; height: 13px; }
        .asset-modal--studio .asset-modal-panel {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 0.9rem 1.1rem 1rem;
        }
        .asset-save-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
        }
        .asset-save-btn svg { width: 15px; height: 15px; }
        .detail-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;
        }
        .detail-item {
          background: #f9fafb; border: 1px solid var(--border); border-radius: 10px; padding: 0.7rem 0.8rem;
        }
        .detail-item > span:first-child {
          display: block; font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--muted); font-weight: 650; margin-bottom: 0.25rem;
        }
        .detail-item strong { font-size: 0.95rem; font-weight: 600; color: var(--text); word-break: break-word; }
        @media (max-width: 980px) {
          .aed-body { grid-template-columns: 1fr; }
          .aed-side { position: static; }
          .asset-modal-head-right { flex-wrap: wrap; justify-content: flex-end; }
        }
        @media (max-width: 860px) {
          .asset-form-grid { grid-template-columns: 1fr; }
          .asset-field.span-2 { grid-column: span 1; }
          .handover-summary-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function warrantyState(expires: unknown): { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  const raw = String(expires ?? '').trim();
  if (!raw) return { label: 'No warranty date', tone: 'muted' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { label: 'Warranty unknown', tone: 'muted' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: 'Coverage expired', tone: 'danger' };
  if (days <= 60) return { label: 'Expiring soon', tone: 'warn' };
  return { label: 'Coverage Valid', tone: 'ok' };
}

function statusViewLabel(status: string): string {
  switch (status) {
    case 'deployed':
      return 'Assigned & Active';
    case 'available':
      return 'Available';
    case 'under_repair':
      return 'Under Repair';
    case 'lost':
      return 'Lost / Stolen';
    case 'disposed':
      return 'Disposed';
    default:
      return assetStatusLabel(status);
  }
}

function statusPillTone(status: string): 'ok' | 'info' | 'warn' | 'danger' | 'muted' {
  switch (status) {
    case 'deployed':
      return 'ok';
    case 'available':
      return 'info';
    case 'under_repair':
      return 'warn';
    case 'lost':
    case 'disposed':
      return 'danger';
    default:
      return 'muted';
  }
}

function categoryTierLabel(category: string): string {
  switch (category) {
    case 'laptop':
      return 'Tier-1 Hardware';
    case 'mobile_phone':
      return 'Mobile Device';
    case 'pc':
      return 'Workstation';
    case 'other':
      return 'Other Asset';
    default:
      return 'IT Asset';
  }
}

function CategoryViewIcon({ category }: { category: string }) {
  if (category === 'mobile_phone') return <IconPhone />;
  if (category === 'pc') return <IconPc />;
  if (category === 'other') return <IconTag />;
  return <IconLaptop />;
}

function IconCopy() {
  return (
    <svg {...svgProps()}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function IconTransfer() {
  return (
    <svg {...svgProps()}>
      <path d="M7 7h11l-3-3M17 17H6l3 3M7 7v4M17 17v-4" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg {...svgProps()}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CompanyTransferModal({
  asset,
  companies,
  locations,
  departments,
  onClose,
  onDone,
}: {
  asset: Asset;
  companies: Company[];
  locations: Loc[];
  departments: Dept[];
  onClose: () => void;
  onDone: (updated: Asset) => void | Promise<void>;
}) {
  const toast = useToast();
  const category = String(asset.category ?? 'laptop');
  const fromCode = String(asset.company_code ?? '').toUpperCase();
  const fromId = Number(asset.company_id ?? 0);
  const [toCompanyId, setToCompanyId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const destCompanies = companies.filter((c) => {
    const code = String(c.code ?? '').toUpperCase();
    if (!['IT', 'IMS', 'ISP'].includes(code)) return false;
    if (fromId > 0) return Number(c.id) !== fromId;
    return code !== fromCode && !(fromCode === 'ITL' && code === 'IT');
  });

  const destCompany = destCompanies.find((c) => String(c.id) === toCompanyId) ?? null;
  const destLocations = locations.filter(
    (l) => destCompany && Number(l.company_id) === Number(destCompany.id),
  );
  const destDepartments = departments.filter(
    (d) => destCompany && Number(d.company_id) === Number(destCompany.id),
  );

  async function submit() {
    if (!toCompanyId) {
      toast.error('Select the destination company');
      return;
    }
    if (!locationId) {
      toast.error('Select a branch / location');
      return;
    }
    if ((category === 'other' || category === 'printer') && !departmentId) {
      toast.error('Select a department');
      return;
    }
    if (!transferDate) {
      toast.error('Select the transfer date');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ data: Asset; message?: string }>(
        `/api/assets/${category}/${Number(asset.id)}/transfer-company`,
        {
          method: 'POST',
          body: JSON.stringify({
            company_id: Number(toCompanyId),
            location_id: Number(locationId),
            department_id: departmentId ? Number(departmentId) : null,
            transfer_date: transferDate,
            note: note.trim() || undefined,
          }),
        },
      );
      await onDone(res.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not transfer asset');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ width: 'min(480px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <h3 style={{ margin: 0 }}>Transfer to company</h3>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--muted)', fontSize: '0.86rem' }}>
              Move {dash(asset.asset_tag)} from {companyUiLabel(asset.company_code)} to another
              Indra company. A new asset tag is assigned and the QR must be reprinted.
            </p>
          </div>
          <button type="button" className="asset-modal-close" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.84rem', fontWeight: 650 }}>
            Destination company *
            <select
              className="asset-control"
              value={toCompanyId}
              onChange={(e) => {
                setToCompanyId(e.target.value);
                setLocationId('');
                setDepartmentId('');
              }}
            >
              <option value="">Select company</option>
              {destCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {companyUiLabel(c.code)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.84rem', fontWeight: 650 }}>
            Branch / location *
            <select
              className="asset-control"
              value={locationId}
              disabled={!toCompanyId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Select location</option>
              {destLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.84rem', fontWeight: 650 }}>
            Department {category === 'other' || category === 'printer' ? '*' : '(optional)'}
            <select
              className="asset-control"
              value={departmentId}
              disabled={!toCompanyId}
              required={category === 'other' || category === 'printer'}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">—</option>
              {destDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.84rem', fontWeight: 650 }}>
            Transfer date *
            <input
              className="asset-control"
              type="date" min={DATE_MIN}
              required
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.84rem', fontWeight: 650 }}>
            Note (optional)
            <input
              className="asset-control"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Employee moved ITL → ISP"
            />
          </label>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            Current holder and handover history stay on this asset. Former tag{' '}
            <strong>{dash(asset.asset_tag)}</strong> is kept for search.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.1rem' }}>
          <button type="button" className="btn btn-soft" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Transferring…' : 'Transfer & retag'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssetViewModal({
  asset,
  statusHistory,
  viewingCompanyTab,
  onClose,
  onTransfer,
  onCompanyTransfer,
  onEdit,
  onAttachments,
}: {
  asset: Asset;
  statusHistory: {
    id: number;
    from_status?: string;
    to_status?: string;
    note?: string;
    created_at?: string;
    changed_by_name?: string;
  }[];
  viewingCompanyTab?: string;
  onClose: () => void;
  onTransfer: () => void;
  onCompanyTransfer: () => void;
  onEdit: () => void;
  onAttachments: () => void;
}) {
  const toast = useToast();
  const category = String(asset.category ?? 'laptop');
  const status = String(asset.status ?? 'available');
  const tag = String(asset.asset_tag ?? '');
  const formerTag = String(asset.former_asset_tag ?? '').trim();
  const fromCompanyLabel = companyUiLabel(
    asset.transferred_from_company_code ?? asset.transferred_from_company_short,
  );
  const toCompanyLabel = companyUiLabel(asset.company_code);
  const transferredAt = asset.company_transferred_at
    ? String(asset.company_transferred_at).slice(0, 10)
    : '';
  const hasCompanyTransfer = Boolean(formerTag || asset.transferred_from_company_id);
  const viewingFromOldCompany =
    hasCompanyTransfer &&
    viewingCompanyTab != null &&
    companyUiLabel(viewingCompanyTab) === fromCompanyLabel &&
    companyUiLabel(viewingCompanyTab) !== toCompanyLabel;
  const canCompanyTransfer =
    (category === 'laptop' ||
      category === 'mobile_phone' ||
      category === 'pc' ||
      category === 'other' ||
      category === 'printer') &&
    status !== 'disposed';
  const modelLine = [asset.brand, asset.model].filter(Boolean).map(String).join(' ').trim()
    || String(asset.item_name ?? asset.pc_name ?? 'Asset');
  const locationName = String(asset.location_name ?? '').trim();
  const deptName = String(asset.department_name ?? '').trim();
  const history = Array.isArray(asset.handovers) ? (asset.handovers as Asset[]) : [];
  const isAvailableStatus = status.toLowerCase() === 'available';
  const isOtherAssetView = category === 'other' || category === 'printer';
  const rawHolder = String(
    asset.allocated_person
      ?? asset.current_holder
      ?? asset.assigned_person_name
      // Other assets: first assigned user lives on user_name (no handover slots)
      ?? (isOtherAssetView ? asset.user_name ?? asset.pc_name : '')
      ?? '',
  ).trim();
  // Temporary custody location after Mark returned (not a person / chain slot)
  // Other assets may legitimately list "IT Department" as the first assigned user.
  const holder =
    rawHolder ||
    (isAvailableStatus && !asset.handover_open && !isOtherAssetView ? IT_CUSTODY_HOLDER : '');
  const itCustodyNow =
    !isOtherAssetView &&
    isAvailableStatus &&
    !asset.handover_open &&
    isItCustodyHolder(holder);
  // Special return remark: visible in View only while Available / with IT Department
  const activeReturnRemarks = (() => {
    if (!itCustodyNow) return '';
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.is_open || h.is_current) continue;
      const note = String(h.return_remarks ?? '').trim();
      if (note) return note;
    }
    return '';
  })();
  const assignedOn = String(
    asset.allocated_on ?? asset.handed_over_display ?? asset.original_assigned_on ?? '',
  ).slice(0, 10);
  const currentNo = Number(asset.current_handover_no ?? 0);
  const maxChain = maxChainPersons(category, asset);
  const allocType = itCustodyNow
    ? 'IT custody (temporary)'
    : currentNo >= 1 && currentNo <= maxChain
      ? currentNo === 1
        ? 'Primary Issue (1st)'
        : `${chainOrdinal(currentNo)} Handover`
      : holder
        ? 'Assigned'
        : 'Unassigned';
  const warranty = warrantyState(asset.warranty_expires_on);
  const isSimAsset = asBool(asset.is_sim) || String(asset.model ?? '').toUpperCase() === 'SIM';

  // Prefer handover history as source of truth; fall back to denormalized columns.
  // Collapse consecutive same-person rows so duplicates never pad 3rd/4th slots.
  // Laptop/PC/phone: "IT Department" is temporary custody only (not a chain person).
  // Other assets: user_name is the first assigned user — keep it even if "IT Department".
  const chainSource: { person: string; on: string; returned: string; isCurrent: boolean }[] = [];
  const pushChain = (
    person: string,
    on: string,
    returned: string,
    isCurrent: boolean,
    allowItDept = false,
  ) => {
    const name = person.trim();
    if (!name) return;
    if (isItCustodyHolder(name) && !allowItDept) return;
    const prev = chainSource[chainSource.length - 1];
    if (prev && prev.person.toLowerCase() === name.toLowerCase()) {
      prev.on = prev.on || on;
      prev.returned = returned || prev.returned;
      prev.isCurrent = prev.isCurrent || isCurrent;
      if (isCurrent) prev.returned = '';
      return;
    }
    chainSource.push({ person: name, on, returned: isCurrent ? '' : returned, isCurrent });
  };

  // 1st Custodian must always be the first assigned user (every asset type)
  const firstAssigned = String(
    asset.original_assigned_person
      ?? asset.handover_person_1
      ?? asset.first_handover_person
      ?? asset.user_name
      ?? (isOtherAssetView ? asset.pc_name : '')
      ?? '',
  ).trim();
  const firstAssignedOn = String(
    asset.original_assigned_on
      ?? asset.handover_on_1
      ?? asset.handed_over_on
      ?? asset.handover_date
      ?? asset.allocated_on
      ?? '',
  ).slice(0, 10);
  const allowItAsFirst = isOtherAssetView && isItCustodyHolder(firstAssigned);

  if (history.length > 0) {
    history.forEach((h, idx) => {
      const personName = String(h.assigned_person_name ?? '').trim();
      const matchesHolder =
        Boolean(asset.handover_open) &&
        holder !== '' &&
        personName.toLowerCase() === holder.toLowerCase();
      pushChain(
        personName,
        String(h.handover_date ?? '').slice(0, 10),
        h.return_date ? String(h.return_date).slice(0, 10) : '',
        Boolean(h.is_current || h.is_open) ||
          (Boolean(asset.handover_open) && currentNo === idx + 1) ||
          matchesHolder,
        allowItAsFirst && personName.toLowerCase() === firstAssigned.toLowerCase(),
      );
    });
  } else {
    for (let n = 1; n <= maxChain; n++) {
      const person = String(
        asset[`handover_person_${n}`]
          ?? (n === 1 ? firstAssigned : '')
          ?? '',
      ).trim();
      const on = String(
        asset[`handover_on_${n}`]
          ?? (n === 1 ? firstAssignedOn : '')
          ?? '',
      ).slice(0, 10);
      const matchesHolder =
        holder !== '' &&
        person.toLowerCase() === holder.toLowerCase() &&
        (Boolean(asset.handover_open) || (isOtherAssetView && status.toLowerCase() === 'deployed'));
      pushChain(
        person,
        on,
        '',
        matchesHolder ||
          (Boolean(asset.handover_open) &&
            (currentNo === n || (currentNo === 0 && matchesHolder))) ||
          (isOtherAssetView && n === 1 && status.toLowerCase() === 'deployed' && person !== ''),
        n === 1 && allowItAsFirst,
      );
    }
  }

  // Guarantee slot 1 = first assigned user (prepend / move to front if history omitted them)
  if (firstAssigned && (!isItCustodyHolder(firstAssigned) || allowItAsFirst)) {
    const key = firstAssigned.toLowerCase();
    const existingIdx = chainSource.findIndex((s) => s.person.toLowerCase() === key);
    const firstIsCurrent =
      (Boolean(asset.handover_open) && holder !== '' && holder.toLowerCase() === key) ||
      (isOtherAssetView &&
        status.toLowerCase() === 'deployed' &&
        (holder === '' || holder.toLowerCase() === key));
    if (existingIdx === -1) {
      chainSource.unshift({
        person: firstAssigned,
        on: firstAssignedOn,
        returned: '',
        isCurrent: firstIsCurrent,
      });
    } else if (existingIdx > 0) {
      const [moved] = chainSource.splice(existingIdx, 1);
      moved.isCurrent = moved.isCurrent || firstIsCurrent;
      chainSource.unshift(moved);
    } else if (firstIsCurrent) {
      chainSource[0].isCurrent = true;
    }
  }

  // When custody is open, force exactly one "Holds Now" / "Assigned Now" on the current holder
  if (holder && Boolean(asset.handover_open)) {
    const hk = holder.toLowerCase();
    let currentIdx = -1;
    for (let i = chainSource.length - 1; i >= 0; i--) {
      if (chainSource[i].person.toLowerCase() === hk) {
        currentIdx = i;
        break;
      }
    }
    if (currentIdx >= 0) {
      chainSource.forEach((s, i) => {
        if (i === currentIdx) {
          s.isCurrent = true;
          s.returned = '';
        } else {
          s.isCurrent = false;
        }
      });
    }
  }

  const filledCount = Math.min(chainSource.length, maxChain);
  const nextVacant = filledCount < maxChain ? filledCount + 1 : null;
  // PCs / SIMs: show a window of slots and scroll when the chain grows.
  const displayCount =
    category === 'pc' || isSimAsset
      ? Math.min(maxChain, Math.max(VISIBLE_CHAIN_SLOTS, filledCount + (nextVacant ? 1 : 0)))
      : maxChain;
  const slots = Array.from({ length: displayCount }, (_, i) => {
    const n = i + 1;
    const src = chainSource[n - 1];
    const person = src?.person ?? '';
    const on = src?.on ?? '';
    const returned = src?.returned ?? '';
    const isCurrent = Boolean(src?.isCurrent) && person !== '';
    return { n, person, on, returned, isCurrent };
  });
  const chainScrollable =
    (category === 'pc' || isSimAsset) && displayCount > VISIBLE_CHAIN_SLOTS;

  const hardwareRows: { label: string; value: string; copy?: boolean }[] =
    category === 'mobile_phone' && isSimAsset
      ? [
          { label: 'Company', value: companyUiLabel(asset.company_code) },
          { label: 'SIM Number', value: String(asset.phone_number ?? ''), copy: true },
          { label: 'Department', value: String(asset.department_name ?? '') },
          { label: 'Location', value: String(asset.location_name ?? '') },
          {
            label: 'Issue date',
            value: asset.purchase_date ? String(asset.purchase_date).slice(0, 10) : '',
          },
          {
            label: 'Handover date',
            value: asset.handed_over_on
              ? String(asset.handed_over_on).slice(0, 10)
              : asset.original_assigned_on
                ? String(asset.original_assigned_on).slice(0, 10)
                : '',
          },
          { label: 'Internal note', value: String(asset.notes ?? '') },
        ]
      : category === 'mobile_phone'
      ? [
          { label: 'Device Model', value: modelLine },
          { label: 'Serial Number (S/N)', value: String(asset.serial_number ?? ''), copy: true },
          { label: 'IMEI Number', value: String(asset.imei_number ?? '') },
          { label: 'IMEI Number 2', value: String(asset.imei_number_2 ?? '') },
          { label: 'Phone Number', value: String(asset.phone_number ?? '') },
          {
            label: 'Accessories',
            value: [
              asBool(asset.has_charger ?? true) ? 'Charger' : null,
              asBool(asset.has_data_cable ?? true) ? 'Data cable' : null,
              asBool(asset.has_back_cover ?? true) ? 'Back cover' : null,
              asset.accessories ? String(asset.accessories) : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—',
          },
        ]
      : category === 'other'
        ? [
            { label: 'Item', value: String(asset.item_name ?? '') },
            { label: 'Brand / Model', value: modelLine },
            { label: 'Serial Number (S/N)', value: String(asset.serial_number ?? ''), copy: true },
            { label: 'Specification', value: String(asset.specification ?? '') },
            { label: 'Remarks', value: String(asset.notes ?? '') },
          ]
        : [
            { label: 'Device Model', value: modelLine },
            { label: 'Serial Number (S/N)', value: String(asset.serial_number ?? ''), copy: true },
            { label: 'Processor', value: String(asset.cpu ?? '') },
            {
              label: 'Installed RAM',
              value:
                asset.ram_gb != null && String(asset.ram_gb) !== ''
                  ? `${formatGb(asset.ram_gb)} GB`
                  : '',
            },
            ...(category === 'pc'
              ? [
                  {
                    label: 'SSD',
                    value:
                      asset.ssd_gb != null && String(asset.ssd_gb) !== ''
                        ? `${formatGb(asset.ssd_gb)} GB`
                        : '',
                  },
                  {
                    label: 'HDD',
                    value:
                      asset.hdd_gb != null && String(asset.hdd_gb) !== ''
                        ? `${formatGb(asset.hdd_gb)} GB`
                        : '',
                  },
                  { label: 'Windows version', value: String(asset.windows_version ?? '') },
                  { label: 'Monitor brand', value: String(asset.monitor_brand ?? '') },
                  {
                    label: 'PC warranty',
                    value: [
                      asset.warranty_period,
                      asset.warranty_expires_on
                        ? `expires ${String(asset.warranty_expires_on).slice(0, 10)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  },
                  {
                    label: 'Cables / UPS',
                    value: [
                      asBool(asset.has_power_cable) ? 'Power cable' : null,
                      asBool(asset.has_vga_cable) ? 'VGA cable' : null,
                      asBool(asset.has_keyboard) ? 'Keyboard' : null,
                      asBool(asset.has_mouse) ? 'Mouse' : null,
                      asBool(asset.has_ups)
                        ? [
                            'UPS',
                            asset.ups_brand,
                            asset.ups_model,
                            asset.ups_purchase_date
                              ? `bought ${String(asset.ups_purchase_date).slice(0, 10)}`
                              : null,
                            asset.ups_warranty_period,
                            asset.ups_warranty_expires_on
                              ? `expires ${String(asset.ups_warranty_expires_on).slice(0, 10)}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' ')
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—',
                  },
                ]
              : category === 'laptop'
                ? [
                    {
                      label: 'SSD',
                      value:
                        asset.ssd_gb != null && String(asset.ssd_gb) !== ''
                          ? `${formatGb(asset.ssd_gb)} GB`
                          : asset.storage_gb != null &&
                              String(asset.storage_gb) !== '' &&
                              asset.hdd_gb == null &&
                              String(asset.storage_type ?? '').toLowerCase() !== 'hdd'
                            ? `${formatGb(asset.storage_gb)} GB`
                            : '',
                    },
                    {
                      label: 'HDD',
                      value:
                        asset.hdd_gb != null && String(asset.hdd_gb) !== ''
                          ? `${formatGb(asset.hdd_gb)} GB`
                          : asset.storage_gb != null &&
                              String(asset.storage_gb) !== '' &&
                              asset.ssd_gb == null &&
                              String(asset.storage_type ?? '').toLowerCase() === 'hdd'
                            ? `${formatGb(asset.storage_gb)} GB`
                            : '',
                    },
                    {
                      label: 'Mouse',
                      value: asBool(asset.has_mouse) ? 'Issued with laptop' : 'Not issued',
                    },
                    { label: 'Other Peripherals', value: String(asset.notes ?? '') || '—' },
                  ]
                : [
                    {
                      label: 'Storage Capacity',
                      value:
                        asset.storage_gb != null && String(asset.storage_gb) !== ''
                          ? `${formatGb(asset.storage_gb)} GB`
                          : '',
                    },
                    { label: 'Other Peripherals', value: String(asset.notes ?? '') || '—' },
                  ]),
          ];

  async function copyText(text: string, label: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy');
    }
  }

  const registeredLine = locationName
    ? `Registered in Fixed Asset Register (${locationName})`
    : 'Registered in Fixed Asset Register';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card avm-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="avm-head">
          <div className="avm-head-left">
            <div className="avm-icon" aria-hidden>
              <CategoryViewIcon category={category} />
            </div>
            <div>
              <div className="avm-title-row">
                <h3 className="avm-title">{dash(tag)}</h3>
                <span className={`avm-pill ${statusPillTone(status)}`}>{statusViewLabel(status)}</span>
                <span className="avm-pill muted">{categoryTierLabel(category)}</span>
              </div>
              <p className="avm-sub">
                {modelLine} · {registeredLine}
              </p>
            </div>
          </div>
          <div className="avm-head-actions">
            <button type="button" className="asset-modal-close" aria-label="Close" onClick={onClose}>
              <IconClose />
            </button>
          </div>
        </header>

        {hasCompanyTransfer ? (
          <div className="avm-transfer-banner" role="status">
            <strong>
              Transferred from {fromCompanyLabel} → {toCompanyLabel}
              {transferredAt ? ` on ${transferredAt}` : ''}
            </strong>
            <p>
              Former tag <strong>{formerTag || '—'}</strong>
              {' · '}
              Now under <strong>{tag || '—'}</strong>.
              {viewingFromOldCompany
                ? ` This record is shown under ${fromCompanyLabel} for history; active inventory is under ${toCompanyLabel}.`
                : ' Reprint the QR label for the new asset tag.'}
            </p>
          </div>
        ) : null}

        <div className="avm-body">
          <div className="avm-col">
            <section className="avm-panel">
              <div className="avm-panel-head">
                <h4>Current Assignee</h4>
                {itCustodyNow ? (
                  <span className="avm-pill info check">Holds now</span>
                ) : holder ? (
                  <span className="avm-pill info check">Holds Device</span>
                ) : (
                  <span className="avm-pill muted">Unassigned</span>
                )}
              </div>
              {holder ? (
                <>
                  <div className="avm-assignee-box">
                    <div className="avm-avatar" aria-hidden>
                      {initialsFromName(holder)}
                    </div>
                    <div>
                      <strong>{holder}</strong>
                      {itCustodyNow ? (
                        <div className="avm-meta-line">
                          Temporary location — not a person. Item is Available until next handover.
                        </div>
                      ) : null}
                      {!itCustodyNow && deptName ? (
                        <div className="avm-meta-line">
                          <IconBuilding /> {deptName}
                        </div>
                      ) : null}
                      {!itCustodyNow && locationName ? (
                        <div className="avm-meta-line">
                          <IconPin /> {locationName}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="avm-assignee-grid">
                    <div className="avm-kv">
                      <span>Assignment Date</span>
                      <strong>{assignedOn || '—'}</strong>
                    </div>
                    <div className="avm-kv">
                      <span>Allocation Type</span>
                      <strong>{allocType}</strong>
                    </div>
                  </div>
                  {activeReturnRemarks ? (
                    <div className="avm-return-remarks" style={{ marginTop: '0.75rem' }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: 'var(--muted)',
                          marginBottom: '0.25rem',
                        }}
                      >
                        Return remarks
                      </span>
                      <p style={{ margin: 0, fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>
                        {activeReturnRemarks}
                      </p>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                        Shown while with IT Department; clears from this view after the next handover.
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="avm-empty">
                  {category === 'pc'
                    ? 'No current assignee. Use Assign to record who uses this branch PC.'
                    : 'No current assignee. Use Transfer Custody to allocate this asset.'}
                </p>
              )}
            </section>

            <section className="avm-panel">
              <div className="avm-panel-head">
                <h4>Hardware Specifications</h4>
                <span className="avm-pill muted">OEM Verified</span>
              </div>
              <div className="avm-spec-list">
                {hardwareRows.map((row) => (
                  <div
                    key={row.label}
                    className={`avm-spec-row${row.copy ? ' avm-spec-row--sn' : ''}`}
                  >
                    <span>{row.label}</span>
                    <strong>
                      <span className="avm-spec-val">{row.value?.trim() ? row.value : '—'}</span>
                      {row.copy && row.value?.trim() ? (
                        <button
                          type="button"
                          className="avm-copy"
                          aria-label="Copy serial"
                          onClick={() => void copyText(row.value, 'Serial number')}
                        >
                          <IconCopy />
                        </button>
                      ) : null}
                    </strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="avm-panel">
              <div className="avm-panel-head">
                <h4>Procurement & Warranty</h4>
                <span className={`avm-pill ${warranty.tone}`}>{warranty.label}</span>
              </div>
              <div className="avm-mini-grid">
                <div className="avm-mini">
                  <span>{asBool(asset.is_sim) ? 'Package price' : 'Purchase Value'}</span>
                  <strong>
                    {asset.purchase_amount_lkr != null && String(asset.purchase_amount_lkr) !== ''
                      ? `LKR ${Number(asset.purchase_amount_lkr).toLocaleString('en-LK')}`
                      : '—'}
                  </strong>
                </div>
                <div className="avm-mini">
                  <span>Vendor / Partner</span>
                  <strong>{dash(asset.supplier_name)}</strong>
                </div>
              </div>
              <div className="avm-spec-list">
                <div className="avm-spec-row">
                  <span>Invoice Number</span>
                  <strong>{dash(asset.invoice_no)}</strong>
                </div>
                <div className="avm-spec-row">
                  <span>Purchased date</span>
                  <strong>{dash(asset.purchase_date ?? asset.handover_date)}</strong>
                </div>
                {asset.warranty_period ? (
                  <div className="avm-spec-row">
                    <span>Warranty period</span>
                    <strong>{dash(asset.warranty_period)}</strong>
                  </div>
                ) : null}
                <div className="avm-spec-row">
                  <span>Warranty void</span>
                  <strong>{dash(asset.warranty_expires_on)}</strong>
                </div>
              </div>
            </section>
          </div>

          <div className="avm-col avm-col--right">
            <section className="avm-panel avm-panel--chain">
              <div className="avm-panel-head avm-right-head" style={{ alignItems: 'flex-start' }}>
                <div>
                  <h3>
                    {category === 'pc'
                      ? 'Branch Assignment History'
                      : 'Custody Lifecycle & Handovers'}
                  </h3>
                  <p>
                    {category === 'pc'
                      ? 'Track employees assigned to this PC at the branch when people leave or change.'
                      : 'Multi-stage custody progression for asset tracking and verification integrity.'}
                  </p>
                </div>
                <span className="avm-pill muted">Chain Policy: Max {maxChain} Persons</span>
              </div>

              <p className="avm-chain-label">
                {category === 'pc' ? 'Assignment Chain' : 'Handover Persons Chain'}
              </p>
              <div className={`avm-chain${chainScrollable ? ' avm-chain--scroll' : ''}`}>
                {slots.map((s) => {
                  const locked = Boolean(nextVacant && s.n > nextVacant);
                  const vacant = !s.person && s.n === nextVacant;
                  const slotTitle = chainSlotTitle(s.n, category === 'pc');
                  if (locked) {
                    return (
                      <div key={s.n} className="avm-slot locked">
                        <div className="avm-slot-top">
                          <span className="avm-slot-n">{slotTitle}</span>
                          <span className="avm-slot-state locked">Locked</span>
                        </div>
                        <div className="avm-locked-ico" aria-hidden>
                          <IconLock />
                        </div>
                        <span className="slot-date" style={{ textAlign: 'center' }}>
                          Unlocks after previous step
                        </span>
                      </div>
                    );
                  }
                  if (vacant || !s.person) {
                    return (
                      <div key={s.n} className="avm-slot vacant">
                        <div className="avm-slot-top">
                          <span className="avm-slot-n">{slotTitle}</span>
                          <span className="avm-slot-state vacant">Vacant</span>
                        </div>
                        <strong>— Unassigned</strong>
                        <button type="button" className="avm-slot-btn" onClick={onTransfer}>
                          {category === 'pc' ? '+ Assign employee' : '+ Assign Handover'}
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={s.n}
                      className={`avm-slot${s.n === 1 ? ' original' : ''}${s.isCurrent ? ' active' : ''}`}
                    >
                      <div className="avm-slot-top">
                        <span className="avm-slot-n">{slotTitle}</span>
                      </div>
                      <strong>{s.person}</strong>
                      <span className="slot-date">{s.on || '—'}</span>
                      <div className="avm-slot-badges">
                        {s.n === 1 ? <span className="handover-badge originally">Originally Assigned</span> : null}
                        {s.isCurrent ? (
                          <span className="handover-badge holds-now">
                            {category === 'pc' ? 'Assigned Now' : 'Holds Now'}
                          </span>
                        ) : s.returned ? (
                          <span className="avm-pill muted">
                            {category === 'pc' ? 'Left' : 'Returned'} {s.returned}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="avm-panel avm-panel--lifecycle">
              <div className="avm-panel-head">
                <h4>Lifecycle History & System Logs</h4>
                <span className="avm-pill muted">Auto-tracked</span>
              </div>
              <div className="avm-timeline">
                <div className="avm-tl-item">
                  <span className="avm-tl-dot green" aria-hidden />
                  <div>
                    <strong>Asset Registered & Tagged</strong>
                    <p>
                      Automated intake · {tag} logged into Fixed Asset Register
                      {locationName ? ` (${locationName})` : ''}.
                    </p>
                    <time>
                      {asset.purchase_date
                        ? String(asset.purchase_date)
                        : asset.created_at
                          ? new Date(String(asset.created_at)).toLocaleString('en-LK')
                          : '—'}
                    </time>
                  </div>
                </div>
                {holder ? (
                  <div className="avm-tl-item">
                    <span className="avm-tl-dot blue" aria-hidden />
                    <div>
                      <strong>
                        {deptName
                          ? `Assigned to ${deptName.replace(/Dept\.?$/i, '').trim()} Representative`
                          : 'Assigned to Custodian'}
                      </strong>
                      <p>
                        Custody granted to {holder}
                        {assignedOn ? ` · ${assignedOn}` : ''}.
                      </p>
                      <time>{assignedOn || '—'}</time>
                    </div>
                  </div>
                ) : null}
                {statusHistory.map((h) => (
                  <div key={h.id} className="avm-tl-item">
                    <span className="avm-tl-dot" aria-hidden />
                    <div>
                      <strong>
                        Status → {h.to_status ? assetStatusLabel(h.to_status) : 'Updated'}
                      </strong>
                      <p>
                        {h.from_status ? `${assetStatusLabel(h.from_status)} → ` : ''}
                        {h.to_status ? assetStatusLabel(h.to_status) : '—'}
                        {h.changed_by_name ? ` · by ${h.changed_by_name}` : ''}
                        {h.note ? ` · ${h.note}` : ''}
                      </p>
                      <time>
                        {h.created_at ? new Date(h.created_at).toLocaleString('en-LK') : '—'}
                      </time>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="avm-foot">
          <div className="avm-tag-id">
            <span>Asset Tag ID</span>
            <strong>{dash(tag)}</strong>
            {formerTag ? (
              <span style={{ display: 'block', fontSize: '0.72rem', color: '#b45309', marginTop: '0.15rem' }}>
                Was {formerTag}
              </span>
            ) : null}
          </div>
          <div className="avm-foot-actions">
            <button type="button" className="avm-btn-outline" onClick={onClose}>
              Close
            </button>
            <button type="button" className="avm-btn-outline" onClick={onEdit}>
              Update
            </button>
            <button type="button" className="avm-btn-outline" onClick={onAttachments}>
              Attachments
            </button>
            {canCompanyTransfer ? (
              <button type="button" className="avm-btn-outline" onClick={onCompanyTransfer}>
                Transfer company
              </button>
            ) : null}
            {category === 'laptop' || category === 'mobile_phone' || category === 'pc' ? (
              <button type="button" className="avm-btn-primary" onClick={onTransfer}>
                <IconTransfer /> {category === 'pc' ? 'Assign employee' : 'Transfer Custody'}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function HandoverEditPanel({
  asset,
  companyCode,
  mode = 'handover',
  handoverForm,
  setHandoverForm,
  handoverSaving,
  error,
  onHandOver,
  onReturn,
  onRefresh,
  onListRefresh,
  onClose,
  onBack,
}: {
  asset: Asset;
  companyCode: string;
  /** PCs use assignment wording (branch employees over time); laptops/phones use handover */
  mode?: 'handover' | 'assignment';
  handoverForm: { person: string; date: string; remarks: string };
  setHandoverForm: (v: { person: string; date: string; remarks: string }) => void;
  handoverSaving: boolean;
  error: string;
  onHandOver: () => void;
  onReturn: () => void;
  onRefresh: (patch?: Asset) => Promise<unknown>;
  onListRefresh: () => void | Promise<void>;
  onClose: () => void;
  onBack: () => void;
}) {
  const isAssignment = mode === 'assignment';
  const toast = useToast();
  const assetCategory = String(asset.category ?? (isAssignment ? 'pc' : 'laptop'));
  const maxChain = maxChainPersons(assetCategory, asset);
  const slotCount = Array.from({ length: maxChain }, (_, i) => i + 1).filter((n) => {
    const v = asset[`handover_person_${n}`];
    return v != null && String(v).trim() !== '';
  }).length;
  const historyFromApi = Array.isArray(asset.handovers) ? (asset.handovers as Asset[]) : [];
  const filledSlotNos = Array.from({ length: maxChain }, (_, i) => i + 1).filter(
    (i) => String(asset[`handover_person_${i}`] ?? '').trim() !== '',
  );
  const lastFilledSlot = filledSlotNos[filledSlotNos.length - 1] ?? 0;
  const openCustody = Boolean(asset.handover_open);
  // Prefer API history; if denormalized slots have extra people, append them so the table never lags
  const historyRows: Asset[] = (() => {
    if (historyFromApi.length === 0) {
      return filledSlotNos.map((n) => {
        const person = String(asset[`handover_person_${n}`] ?? '').trim();
        const date = String(
          asset[`handover_on_${n}`] ?? (n === 1 ? asset.original_assigned_on : '') ?? '',
        ).slice(0, 10);
        const isLast = n === lastFilledSlot;
        const ordinal = chainOrdinal(n);
        return {
          id: `slot-${n}`,
          handover_no: n,
          handover_label: isAssignment ? `${ordinal} assignment` : `${ordinal} handover`,
          assigned_person_name: person,
          handover_date: date || null,
          return_date: null,
          is_open: openCustody && isLast,
          is_current: openCustody && isLast,
          _from_slot: true,
        } as Asset;
      });
    }
    const rows = [...historyFromApi];
    const known = new Set(
      rows.map((h) => str(h.assigned_person_name).trim().toLowerCase()).filter(Boolean),
    );
    for (const n of filledSlotNos) {
      const person = String(asset[`handover_person_${n}`] ?? '').trim();
      if (!person || known.has(person.toLowerCase())) continue;
      const date = String(asset[`handover_on_${n}`] ?? '').slice(0, 10);
      const ordinal = chainOrdinal(rows.length + 1);
      rows.push({
        id: `slot-${n}`,
        handover_no: rows.length + 1,
        handover_label: isAssignment ? `${ordinal} assignment` : `${ordinal} handover`,
        assigned_person_name: person,
        handover_date: date || null,
        return_date: null,
        is_open: false,
        is_current: false,
        _from_slot: true,
      } as Asset);
      known.add(person.toLowerCase());
    }
    return rows;
  })();
  const used = Math.max(historyFromApi.length, slotCount, historyRows.length);
  const atMax = used >= maxChain;
  const nextLabel = used < maxChain ? chainOrdinal(used + 1) : chainOrdinal(maxChain);
  const chainTitle = isAssignment
    ? `Assignment history (max ${maxChain})`
    : `Handover persons (max ${maxChain})`;
  const historyTitle = isAssignment ? 'Assignment history' : 'Handover history';
  const assignHeading = atMax
    ? `Maximum ${maxChain} ${isAssignment ? 'assignees' : 'handover persons'} reached`
    : `Assign ${nextLabel} ${isAssignment ? 'assignee' : 'handover person'}`;
  const dateLabel = isAssignment ? 'Assigned date' : 'Handover date';
  const leftLabel = isAssignment ? 'Left / ended' : 'Returned';
  const helpText = isAssignment
    ? `Track who used this branch PC over time. When an employee leaves, assign the next person — history is kept (max ${maxChain}).`
    : '1st person becomes originally assigned and allocated. Later persons update allocated only. Each needs a handover date. You can also edit any previous owner below without changing the others.';

  const [editHandoverId, setEditHandoverId] = useState<number | null>(null);
  const [editPerson, setEditPerson] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editReturnDate, setEditReturnDate] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  async function startEditHandover(h: Asset) {
    const hid = Number(h.id);
    const fromSlot = Boolean(h._from_slot) || !Number.isFinite(hid) || hid < 1;
    if (fromSlot) {
      // Slot-only rows have no DB id — refresh triggers ensureHandoversFromSlots, then edit the real row
      try {
        const refreshed = (await onRefresh()) as Asset | undefined;
        const person = str(h.assigned_person_name).trim().toLowerCase();
        const date = str(h.handover_date).slice(0, 10);
        const list = Array.isArray(refreshed?.handovers) ? (refreshed.handovers as Asset[]) : [];
        const match =
          list.find(
            (r) =>
              str(r.assigned_person_name).trim().toLowerCase() === person &&
              str(r.handover_date).slice(0, 10) === date,
          ) ??
          list.find((r) => str(r.assigned_person_name).trim().toLowerCase() === person) ??
          (Number.isFinite(Number(h.handover_no)) ? list[Number(h.handover_no) - 1] : undefined);
        const mid = Number(match?.id);
        if (!match || !Number.isFinite(mid) || mid < 1) {
          toast.error('No handover record to edit yet — try again after the page reloads');
          return;
        }
        setEditHandoverId(mid);
        setEditPerson(str(match.assigned_person_name));
        setEditDate(str(match.handover_date).slice(0, 10));
        setEditReturnDate(str(match.return_date).slice(0, 10));
        return;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not load handover for edit');
        return;
      }
    }
    setEditHandoverId(hid);
    setEditPerson(str(h.assigned_person_name));
    setEditDate(str(h.handover_date).slice(0, 10));
    setEditReturnDate(str(h.return_date).slice(0, 10));
  }

  function cancelEditHandover() {
    setEditHandoverId(null);
    setEditPerson('');
    setEditDate('');
    setEditReturnDate('');
  }

  async function saveEditHandover() {
    if (!editHandoverId) return;
    const person = editPerson.trim();
    if (!person) {
      toast.error('Person name is required');
      return;
    }
    if (!editDate) {
      toast.error(`${dateLabel} is required`);
      return;
    }
    if (editReturnDate && editReturnDate < editDate) {
      toast.error(`${leftLabel} cannot be before ${dateLabel.toLowerCase()}`);
      return;
    }
    setEditSaving(true);
    try {
      const res = await api<{
        data?: Asset;
        asset?: Asset;
        handovers?: Asset[];
        message?: string;
      }>(`/api/handovers/${editHandoverId}`, {
        method: 'PUT',
        body: JSON.stringify({
          assigned_person_name: person,
          handover_date: editDate,
          return_date: editReturnDate || null,
        }),
      });
      toast.success(isAssignment ? 'Assignment record updated' : 'Handover record updated');
      cancelEditHandover();
      const patch =
        res.asset && typeof res.asset === 'object'
          ? ({
              ...res.asset,
              handovers: res.handovers ?? res.asset.handovers,
            } as Asset)
          : res.handovers
            ? ({ ...asset, handovers: res.handovers } as Asset)
            : undefined;
      const refreshed = await onRefresh(patch);
      if (!refreshed) {
        toast.error('Saved, but could not reload asset — reopen Handovers');
      }
      await Promise.resolve(onListRefresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update handover');
    } finally {
      setEditSaving(false);
    }
  }

  const assignActions = (
    <div className="handover-assign-box">
      <h4>{assignHeading}</h4>
      <div className="handover-actions">
        <div className="hod-field">
          <IconUser />
          <EmployeeNameInput
            inputClassName="input"
            companyCode={companyCode}
            placeholder="Type employee name…"
            value={handoverForm.person}
            disabled={atMax || handoverSaving}
            onChange={(person) => setHandoverForm({ ...handoverForm, person })}
          />
        </div>
        <div className="hod-field" style={{ flex: '0 1 11rem', minWidth: '10rem' }}>
          <IconCalendar />
          <input
            className="input"
            type="date" min={DATE_MIN}
            value={handoverForm.date}
            disabled={atMax || handoverSaving}
            onChange={(e) => setHandoverForm({ ...handoverForm, date: e.target.value })}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={handoverSaving || atMax}
          onClick={onHandOver}
        >
          {handoverSaving
            ? '…'
            : asset.handover_open
              ? isAssignment
                ? 'Assign to next →'
                : 'Hand over to next →'
              : isAssignment
                ? 'Assign'
                : 'Allocate'}
        </button>
        {asset.handover_open ? (
          <button type="button" className="btn btn-soft" disabled={handoverSaving} onClick={onReturn}>
            {isAssignment ? 'Mark left' : 'Mark returned'}
          </button>
        ) : null}
      </div>
      {!isAssignment ? (
        <label className="hod-remarks">
          <span>Handover remarks</span>
          <textarea
            className="input"
            rows={2}
            placeholder="Optional note for this handover (shown on the acceptance report)"
            value={handoverForm.remarks}
            disabled={atMax || handoverSaving}
            onChange={(e) => setHandoverForm({ ...handoverForm, remarks: e.target.value })}
          />
        </label>
      ) : null}
      <p className="handover-help">{helpText}</p>
    </div>
  );

  const panelFoot = (
    <div className="hod-foot">
      <button type="button" className="btn btn-soft" disabled={handoverSaving} onClick={onClose}>
        Close
      </button>
      <button type="button" className="btn btn-primary" onClick={onBack}>
        Back to asset details
      </button>
    </div>
  );

  // Exact design: always show full chain for laptop/phone (4); PC shows filled+next (max 8)
  const nextSlotNo = atMax ? 0 : used + 1;
  const visibleSlotCount = isAssignment
    ? Math.min(maxChain, Math.max(VISIBLE_CHAIN_SLOTS, used + (atMax ? 0 : 1)))
    : maxChain;

  return (
    <div className="handover-panel in-edit">
      <div className="hod-scroll">
        <div className="handover-slots">
          <h4 className="hod-section-title">{chainTitle}</h4>
          <div className="handover-slot-grid">
            {Array.from({ length: visibleSlotCount }, (_, i) => i + 1).map((n) => {
              const historyList = Array.isArray(asset.handovers) ? (asset.handovers as Asset[]) : [];
              const fromHistory = historyList[n - 1] ?? null;
              // Prefer history (same as VIEW); fall back to denormalized slots
              const personRaw =
                fromHistory?.assigned_person_name ??
                asset[`handover_person_${n}`] ??
                (n === 1
                  ? asset.original_assigned_person ??
                    asset.first_handover_person ??
                    asset.user_name
                  : null);
              const on =
                fromHistory?.handover_date ??
                asset[`handover_on_${n}`] ??
                (n === 1
                  ? asset.original_assigned_on ??
                    asset.handed_over_on ??
                    asset.handover_date
                  : null);
              const person = personRaw != null ? String(personRaw).trim() : '';
              const hasPerson = person !== '';
              const open = Boolean(asset.handover_open);
              const holder = String(
                asset.allocated_person ?? asset.current_holder ?? asset.assigned_person_name ?? '',
              )
                .trim()
                .toLowerCase();
              const currentNo = Number(asset.current_handover_no ?? 0);
              const matchesHolder =
                open && hasPerson && holder !== '' && person.toLowerCase() === holder;
              const isCurrent =
                hasPerson &&
                (Boolean(fromHistory?.is_current || fromHistory?.is_open) ||
                  matchesHolder ||
                  (open && (currentNo === n || (currentNo < 1 && n === used && matchesHolder))));
              const isOriginal = hasPerson && n === 1;
              const isNext = !hasPerson && n === nextSlotNo;
              const label = chainOrdinal(n);
              return (
                <div
                  key={n}
                  className={`handover-slot${hasPerson ? '' : ' empty'}${isOriginal ? ' original' : ''}${isCurrent ? ' current' : ''}${isNext ? ' next-available' : ''}`}
                >
                  {isNext ? <span className="slot-next-dot" aria-hidden /> : null}
                  <span className="slot-label">{label}</span>
                  <strong>{hasPerson ? person : '—'}</strong>
                  <span className="slot-date">
                    {dateLabel}: {on ? String(on).slice(0, 10) : '—'}
                  </span>
                  <div className="avm-slot-badges">
                    {isOriginal ? (
                      <span className="handover-badge originally">Originally Assigned</span>
                    ) : null}
                    {isCurrent ? (
                      <span className="handover-badge holds-now">
                        {isAssignment ? 'Assigned Now' : 'Holds Now'}
                      </span>
                    ) : null}
                    {isNext ? (
                      <span className="handover-badge next-slot">Next Slot Available</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {assignActions}

        <div className="handover-history">
          <h4 className="hod-section-title">{historyTitle}</h4>
          {historyRows.length > 0 ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Person</th>
                    <th>{dateLabel}</th>
                    <th>{leftLabel}</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((h) => {
                    const hid = Number(h.id);
                    const fromSlot = Boolean(h._from_slot) || !Number.isFinite(hid) || hid < 1;
                    const editing =
                      editHandoverId != null &&
                      (editHandoverId === hid ||
                        (fromSlot &&
                          str(h.assigned_person_name).trim().toLowerCase() ===
                            editPerson.trim().toLowerCase()));
                    const personName = String(h.assigned_person_name ?? '').trim();
                    const hn = Number(h.handover_no);
                    const ordinal =
                      Number.isFinite(hn) && hn >= 1 && hn <= maxChain ? chainOrdinal(hn) : '';
                    const label = ordinal
                      ? `${ordinal} ${isAssignment ? 'assignment' : 'handover'}`
                      : String(h.handover_label ?? h.handover_no ?? '');
                    return (
                      <tr
                        key={String(h.id)}
                        className={h.is_current || h.is_open ? 'is-current' : undefined}
                      >
                        <td>{label}</td>
                        <td>
                          {editing ? (
                            <EmployeeNameInput
                              inputClassName="input"
                              companyCode={companyCode}
                              placeholder="Type employee name…"
                              value={editPerson}
                              onChange={setEditPerson}
                              disabled={editSaving}
                            />
                          ) : (
                            dash(personName)
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <input
                              className="input"
                              type="date" min={DATE_MIN}
                              value={editDate}
                              disabled={editSaving}
                              onChange={(e) => setEditDate(e.target.value)}
                            />
                          ) : (
                            dash(h.handover_date)
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <input
                              className="input"
                              type="date"
                              value={editReturnDate}
                              disabled={editSaving}
                              min={editDate || DATE_MIN}
                              onChange={(e) => setEditReturnDate(e.target.value)}
                              title={
                                isAssignment
                                  ? 'Left / ended date — clear to keep as current'
                                  : 'Returned date — clear to keep as current'
                              }
                              aria-label={leftLabel}
                            />
                          ) : (
                            dash(h.return_date)
                          )}
                        </td>
                        <td>
                          {editing ? (
                            editReturnDate ? (
                              <StatusBadge status="inactive" label="PREVIOUS" />
                            ) : (
                              <StatusBadge tone="success" label="CURRENT" />
                            )
                          ) : h.is_current || h.is_open ? (
                            <StatusBadge tone="success" label="CURRENT" />
                          ) : (
                            <StatusBadge status="inactive" label="PREVIOUS" />
                          )}
                        </td>
                        <td>
                          {editing ? (
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={editSaving}
                                onClick={() => void saveEditHandover()}
                              >
                                {editSaving ? '…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-soft"
                                disabled={editSaving}
                                onClick={cancelEditHandover}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-soft"
                              disabled={editSaving || handoverSaving}
                              onClick={() => void startEditHandover(h)}
                              title={
                                fromSlot
                                  ? 'Creates a handover record if needed, then edits'
                                  : undefined
                              }
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              {isAssignment ? 'No assignments recorded yet.' : 'No handovers recorded yet.'}
            </p>
          )}
        </div>

        {error ? <p className="error-text">{error}</p> : null}
      </div>
      {panelFoot}
    </div>
  );
}

function FormSection({
  title,
  icon,
  children,
  id,
  badge,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  id?: string;
  badge?: ReactNode;
}) {
  return (
    <section className="asset-form-section" id={id}>
      <header className="asset-form-section-head">
        <span className="asset-form-section-icon" aria-hidden>
          {icon}
        </span>
        <h4>{title}</h4>
        {badge ? <div className="asset-form-section-badge">{badge}</div> : null}
      </header>
      <div className="asset-form-grid">{children}</div>
    </section>
  );
}

const ENTRY_TYPE_OPTIONS: { value: 'new' | 'old'; label: string; tone: 'assigned' | 'lost' }[] = [
  { value: 'new', label: 'New', tone: 'assigned' },
  { value: 'old', label: 'Old', tone: 'lost' },
];

function EntryTypeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: 'new' | 'old';
  onChange: (value: 'new' | 'old') => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    ENTRY_TYPE_OPTIONS.find((o) => o.value === value) ?? ENTRY_TYPE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="status-select" ref={rootRef}>
      <button
        type="button"
        className="status-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <StatusBadge tone={selected.tone} label={selected.label} />
        <svg className="status-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="status-select-menu" role="listbox">
          {ENTRY_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === selected.value}
              className={`status-select-option${opt.value === selected.value ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <StatusBadge tone={opt.tone} label={opt.label} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    STATUS_OPTIONS.find((o) => o.value === value) ?? STATUS_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="status-select" ref={rootRef}>
      <button
        type="button"
        className="status-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <StatusBadge label={selected.label} tone={selected.tone} withIcon />
        <svg className="status-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="status-select-menu" role="listbox">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === selected.value}
              className={`status-select-option${opt.value === selected.value ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <StatusBadge label={opt.label} tone={opt.tone} withIcon />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** White-box Status filter — options use the same icon pills as the table. */
function StatusFilterSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = STATUS_OPTIONS.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="status-select status-filter-select" ref={rootRef}>
      <button
        type="button"
        className="status-select-trigger asset-filter-control"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <StatusBadge label={selected.label} tone={selected.tone} withIcon />
        ) : (
          <span className="status-filter-all">All statuses</span>
        )}
        <svg className="status-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="status-select-menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={value === ''}
            className={`status-select-option${value === '' ? ' is-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick('')}
          >
            <span>All statuses</span>
          </button>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`status-select-option${opt.value === value ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(opt.value)}
            >
              <StatusBadge label={opt.label} tone={opt.tone} withIcon />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  icon,
  children,
  className = '',
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const tall = className.includes('span-2');
  const required = label.includes('*');
  const labelText = label.replace(/\s*\*\s*$/, '').trim();
  return (
    <label className={`asset-field ${className}`.trim()}>
      <span className="asset-field-label">
        {labelText}
        {required ? <span className="req-star"> *</span> : null}
      </span>
      <span className={`asset-field-box${tall ? ' tall' : ''}`}>
        <span className="asset-field-icon">{icon}</span>
        {children}
      </span>
    </label>
  );
}

function ModalCategoryIcon({ category }: { category: string }) {
  if (category === 'mobile_phone') return <IconPhone />;
  if (category === 'pc') return <IconPc />;
  if (category === 'others' || category === 'printer' || category === 'other') return <IconTag />;
  return <IconLaptop />;
}

function svgProps(props?: SVGProps<SVGSVGElement>) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

function IconClose() {
  return (
    <svg {...svgProps()}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg {...svgProps()}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg {...svgProps()}>
      <path d="M4 21h16M6 21V5h8v16M14 9h4v12M9 9h2M9 13h2M9 17h2" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg {...svgProps()}>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

function IconBarcode() {
  return (
    <svg {...svgProps()}>
      <path d="M4 7v10M8 7v10M11 7v10M15 7v10M19 7v10" />
    </svg>
  );
}

function IconTruck() {
  return (
    <svg {...svgProps()}>
      <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg {...svgProps()}>
      <path d="M8 3h6l4 4v14H8z" />
      <path d="M14 3v4h4M10 12h6M10 16h6" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg {...svgProps()}>
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconLaptop() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="5" width="18" height="11" rx="2" />
      <path d="M2 19h20" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg {...svgProps()}>
      <rect x="8" y="2" width="8" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function IconPc() {
  return (
    <svg {...svgProps()}>
      <rect x="2" y="4" width="20" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function IconCoin() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10M9.5 9.5c.6-1 1.7-1.5 2.8-1.5 1.7 0 2.7 1 2.7 2.2 0 2.5-5 1.6-5 4.1 0 1.1 1 2.2 2.8 2.2 1.2 0 2.1-.5 2.7-1.4" />
    </svg>
  );
}

function IconStorage() {
  return (
    <svg {...svgProps()}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  );
}

function IconChip() {
  return (
    <svg {...svgProps()}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M9 3v4M12 3v4M15 3v4M9 17v4M12 17v4M15 17v4M3 9h4M3 12h4M3 15h4M17 9h4M17 12h4M17 15h4" />
    </svg>
  );
}

function IconRam() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="8" width="18" height="8" rx="1.5" />
      <path d="M6 8V6M10 8V6M14 8V6M18 8V6M7 16v2M11 16v2M15 16v2" />
    </svg>
  );
}

function IconNote() {
  return (
    <svg {...svgProps()}>
      <path d="M5 4h10l4 4v12H5z" />
      <path d="M15 4v4h4M8 12h8M8 16h6" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}
