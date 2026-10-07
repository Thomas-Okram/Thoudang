import { useParams } from 'react-router';
import { EmptyState, Page } from '../components/Page';

export function CasePage() {
  const { caseId } = useParams();
  return (
    <Page
      title={caseId ? `Case ${caseId}` : 'Case'}
      subtitle="Document image, extracted fields with evidence, flags, and the officer's decision."
    >
      <EmptyState
        heading={caseId ? 'Case details are not available yet' : 'No case selected'}
        body="Open a case from the Queue to review it. Every flag shows its evidence; the officer accepts or overrides with a reason."
      />
    </Page>
  );
}
