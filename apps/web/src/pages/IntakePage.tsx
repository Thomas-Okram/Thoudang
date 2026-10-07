import { EmptyState, Page } from '../components/Page';

export function IntakePage() {
  return (
    <Page
      title="Intake"
      subtitle="Upload an application packet: form, Aadhaar, bank passbook, voter ID."
    >
      <EmptyState
        heading="No packets uploaded yet"
        body="Drag-and-drop, phone upload and batch intake will appear here. Every document is read by the AI, then checked by deterministic rules."
      />
    </Page>
  );
}
