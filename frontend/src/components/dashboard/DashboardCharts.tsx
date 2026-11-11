import type { CSSProperties } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AssetsByCompanyPoint, AssetsByStatusPoint, WarrantyExpiryItem } from '../../types/dashboard';

const COMPANY_COLORS = ['#1a5c45', '#c45c26', '#2f6fed'];
const STATUS_COLORS: Record<string, string> = {
  available: '#2f9e6b',
  deployed: '#2f6fed',
  under_repair: '#d4a017',
  disposed: '#8a8f98',
};

interface ChartsProps {
  assetsByCompany: AssetsByCompanyPoint[];
  assetsByStatus: AssetsByStatusPoint[];
  upcomingWarranties: WarrantyExpiryItem[];
  warrantyWindowDays: 30 | 60 | 90;
}

export function AssetsByCompanyPie({ data }: { data: AssetsByCompanyPoint[] }) {
  const chartData = data.map((d) => ({ name: d.shortName, value: d.count }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label>
          {chartData.map((_, index) => (
            <Cell key={chartData[index].name} fill={COMPANY_COLORS[index % COMPANY_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => [`${value} assets`, 'Count']} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function AssetStatusBar({ data }: { data: AssetsByStatusPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" name="Assets" radius={[6, 6, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#1a5c45'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function WarrantyTrend({
  items,
  windowDays,
}: {
  items: WarrantyExpiryItem[];
  windowDays: 30 | 60 | 90;
}) {
  const filtered = items.filter((i) => i.daysRemaining <= windowDays);
  const chartData = filtered.map((i) => ({
    label: i.assetTag,
    daysRemaining: i.daysRemaining,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} label={{ value: 'Days left', angle: -90, position: 'insideLeft' }} />
        <Tooltip />
        <Line type="monotone" dataKey="daysRemaining" stroke="#c45c26" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DashboardCharts(props: ChartsProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.25rem',
      }}
    >
      <section style={panelStyle}>
        <h3 style={titleStyle}>Assets by Sub-Company</h3>
        <AssetsByCompanyPie data={props.assetsByCompany} />
      </section>

      <section style={panelStyle}>
        <h3 style={titleStyle}>Asset Status</h3>
        <AssetStatusBar data={props.assetsByStatus} />
      </section>

      <section style={{ ...panelStyle, gridColumn: '1 / -1' }}>
        <h3 style={titleStyle}>Warranty expirations (next {props.warrantyWindowDays} days)</h3>
        <WarrantyTrend items={props.upcomingWarranties} windowDays={props.warrantyWindowDays} />
      </section>
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e4ebe7',
  borderRadius: 12,
  padding: '1rem 1.1rem 0.5rem',
};

const titleStyle: CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: 15,
  fontWeight: 650,
  color: '#16382c',
};
