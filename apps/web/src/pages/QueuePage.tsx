import { EmptyState, Page } from '../components/Page';

export function QueuePage() {
  return (
    <Page
      title="Queue"
      subtitle="Cases sorted by priority: Ready, Needs citizen correction, Officer attention."
    >
      <EmptyState
        heading="The queue is empty"
        body="Screened cases will be sorted here. Elderly (80+), widowed, disabled and displaced applicants are prioritised."
      />
    </Page>
  );
}
