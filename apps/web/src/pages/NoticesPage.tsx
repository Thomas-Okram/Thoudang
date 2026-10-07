import { EmptyState, Page } from '../components/Page';

export function NoticesPage() {
  return (
    <Page
      title="Notices"
      subtitle="Deficiency notices in English and Manipuri for citizens to correct their application."
    >
      <EmptyState
        heading="No notices drafted"
        body="When a case needs a citizen correction, a notice is drafted from proofread templates for the officer to review and print."
      />
    </Page>
  );
}
