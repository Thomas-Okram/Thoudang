import { EmptyState, Page } from '../components/Page';

export function TrustReportPage() {
  return (
    <Page
      title="Trust Report"
      subtitle="How accurate is the system, is it fair across communities, and what are the safeguards?"
    >
      <EmptyState
        heading="Report not generated yet"
        body="Field-level extraction accuracy, the name-matching fairness table (Meitei, Pangal, Naga, Kuki-Zo) and the safeguards list will be shown here."
      />
    </Page>
  );
}
