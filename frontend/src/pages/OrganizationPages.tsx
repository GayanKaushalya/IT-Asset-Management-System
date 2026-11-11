import MetaListPage from './MetaListPage';

export function CompaniesPage() {
  return (
    <MetaListPage
      title="Companies"
      subtitle="Indra Group operating companies in ITAM"
      endpoint="/api/companies"
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'short_name', label: 'Short name' },
        { key: 'name', label: 'Name' },
      ]}
    />
  );
}

export function LocationsPage() {
  return (
    <MetaListPage
      title="Locations"
      subtitle="Sites and branches across companies"
      endpoint="/api/locations"
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'city', label: 'City' },
        { key: 'company_id', label: 'Company ID' },
      ]}
    />
  );
}

export function DepartmentsPage() {
  return (
    <MetaListPage
      title="Departments"
      subtitle="Organizational departments linked to companies"
      endpoint="/api/departments"
      columns={[
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'company_id', label: 'Company ID' },
        { key: 'location_id', label: 'Location ID' },
      ]}
    />
  );
}

export function SuppliersPage() {
  return (
    <MetaListPage
      title="Suppliers"
      subtitle="Vendors and service providers"
      endpoint="/api/suppliers"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'contact_person', label: 'Contact' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
      ]}
      searchKeys={['name', 'contact_person', 'email', 'phone']}
    />
  );
}
